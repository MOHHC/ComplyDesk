import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { AI_PROVIDER } from '../ai/ai-provider.token';
import { AiProvider } from '../ai/ai-provider.interface';

const TOP_K_CHUNKS = 5;
const CONCURRENCY = 4;

// PolicyChunk's ivfflat index was built WITH (lists = 100); pgvector
// defaults ivfflat.probes to 1, i.e. ~1% of lists get scanned per query.
// PolicyChunk is a shared, RLS-protected, multi-tenant table, and RLS
// filters candidate rows *after* the index has already picked which
// ~1% to look at — so a tenant whose chunks are a small slice of the
// whole table can get back fewer than TOP_K_CHUNKS candidates (even
// zero) despite having plenty of relevant policy text, and this gets
// worse as more tenants' chunks accumulate in the table. Raising
// probes to the full list count makes this an exhaustive scan of every
// list — no different, recall-wise, than not approximating at all —
// which is affordable because gap analysis is on-demand, capped at 5
// runs/hour/tenant, and issues only ~18 of these queries per run: the
// latency this trades away is immaterial next to a wrong-looking
// "no coverage found" result. (Not moving to HNSW: not needed at this
// project's scale.)
const IVFFLAT_PROBES = 100;

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

@Injectable()
export class GapAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  async run() {
    const tx = this.tx();
    const tenantId = this.cls.get('tenantId')!;
    const userId = this.cls.get('userId')!;

    const controls = await tx.control.findMany({ orderBy: [{ category: 'asc' }, { code: 'asc' }] });
    // Only chunks belonging to a fully-processed document: a document
    // whose upload failed partway through (e.g. embed() threw after
    // some chunks were already inserted) leaves READY-looking rows
    // behind even though its status is FAILED/PROCESSING — those must
    // not silently contribute partial content to coverage checks.
    const chunkCount = await tx.policyChunk.count({ where: { document: { status: 'READY' } } });

    const gapRun = await tx.gapAnalysisRun.create({ data: { tenantId, runById: userId } });

    // Transaction-local (SET LOCAL semantics via set_config's third
    // argument), same as setTenantContext — a plain SET would persist on
    // the pooled connection and silently apply to the next tenant's
    // request that borrows it. See IVFFLAT_PROBES above for why this is
    // needed at all. Applies to every per-control query the loop below
    // issues, since they all run on this same `tx`.
    await tx.$executeRaw`SELECT set_config('ivfflat.probes', ${String(IVFFLAT_PROBES)}, true)`;

    await runWithConcurrency(controls, CONCURRENCY, async (control) => {
      if (chunkCount === 0) {
        return tx.gapAnalysisResult.create({
          data: {
            tenantId,
            runId: gapRun.id,
            controlId: control.id,
            covered: false,
            reasoning: 'No policy documents uploaded',
          },
        });
      }

      const embedding = await this.ai.embed(control.description);
      const candidates = await tx.$queryRaw<Array<{ id: string; chunkIndex: number; content: string }>>`
        SELECT "PolicyChunk"."id", "PolicyChunk"."chunkIndex", "PolicyChunk"."content"
        FROM "PolicyChunk"
        JOIN "PolicyDocument" ON "PolicyDocument"."id" = "PolicyChunk"."documentId"
        WHERE "PolicyDocument"."status" = 'READY'
        ORDER BY "PolicyChunk"."embedding" <=> ${JSON.stringify(embedding)}::vector
        LIMIT ${TOP_K_CHUNKS}
      `;

      // candidateChunks is numbered by *position in this list*, not by
      // the candidates' document-relative `chunkIndex` column: chunkIndex
      // restarts at 0 for every PolicyDocument (see
      // PolicyDocumentsService.upload's per-document loop), so with two
      // or more policy documents the top-K candidates can contain
      // multiple chunks sharing the same chunkIndex value, making that
      // value ambiguous as a citation key. Position in this array is
      // unambiguous by construction, and ChunkSummary.index is
      // documented as exactly that.
      const coverage = await this.ai.checkControlCoverage({
        control: { code: control.code, title: control.title, description: control.description },
        candidateChunks: candidates.map((c, i) => ({ index: i, content: c.content })),
      });

      const citedChunk = coverage.citedChunkIndex !== null
        ? candidates[coverage.citedChunkIndex]
        : undefined;

      return tx.gapAnalysisResult.create({
        data: {
          tenantId,
          runId: gapRun.id,
          controlId: control.id,
          covered: coverage.covered,
          reasoning: coverage.reasoning,
          citationChunkId: citedChunk?.id ?? null,
        },
      });
    });

    return this.latest();
  }

  async latest() {
    const tx = this.tx();
    const latestRun = await tx.gapAnalysisRun.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!latestRun) return null;

    const results = await tx.gapAnalysisResult.findMany({
      where: { runId: latestRun.id },
      include: { control: true, citationChunk: { include: { document: true } } },
    });
    return { runId: latestRun.id, createdAt: latestRun.createdAt, results };
  }
}

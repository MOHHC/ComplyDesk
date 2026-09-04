import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { AI_PROVIDER } from '../ai/ai-provider.token';
import { AiProvider } from '../ai/ai-provider.interface';

const TOP_K_CHUNKS = 5;
const CONCURRENCY = 4;

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
    const chunkCount = await tx.policyChunk.count();

    const gapRun = await tx.gapAnalysisRun.create({ data: { tenantId, runById: userId } });

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
        SELECT "id", "chunkIndex", "content"
        FROM "PolicyChunk"
        ORDER BY "embedding" <=> ${JSON.stringify(embedding)}::vector
        LIMIT ${TOP_K_CHUNKS}
      `;

      const coverage = await this.ai.checkControlCoverage({
        control: { code: control.code, title: control.title, description: control.description },
        candidateChunks: candidates.map((c) => ({ index: c.chunkIndex, content: c.content })),
      });

      const citedChunk = coverage.citedChunkIndex !== null
        ? candidates.find((c) => c.chunkIndex === coverage.citedChunkIndex)
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

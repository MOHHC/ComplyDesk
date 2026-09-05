import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiProvider,
  ChunkSummary,
  ClassificationResult,
  ControlSummary,
  CoverageResult,
} from './ai-provider.interface';
import { embedWithPipeline, getLocalEmbeddingPipeline } from './local-embedding';

const CLASSIFICATION_MODEL = 'claude-haiku-4-5-20251001';
const COVERAGE_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;

// Anthropic's SDK default (timeout: 10 minutes, maxRetries: 2, and a
// timed-out request is itself retried — see the SDK's own client.d.ts
// note that a request can therefore take much longer than `timeout`
// before settling) is unusable here: both call sites run inside a
// bounded Prisma transaction (TenantTransactionMiddleware and its
// per-route subclasses), and outliving that transaction doesn't
// gracefully degrade — it kills the transaction's pooled connection out
// from under the request. Each call site gets its own budget, sized well
// under its transaction's timeout so a slow-but-not-hung API call still
// leaves room for the surrounding DB work:
//  - classifyEvidence runs once, inline, inside the 15s evidence-upload
//    transaction (see tenant-transaction.middleware.ts). No retry: a
//    retry's backoff-plus-second-attempt could alone approach the
//    budget, and EvidenceService.upload already treats any failure here
//    (including a timeout) as best-effort — see its comment: "No retry
//    — the review endpoint has nothing to review until a future upload
//    succeeds in classifying."
//  - checkControlCoverage runs up to 18 times per gap-analysis run
//    through a 4-worker pool (see runWithConcurrency in
//    gap-analysis.service.ts) inside that route's 75s transaction
//    (gap-analysis-transaction.middleware.ts). One retry is affordable
//    per call — worst case ~41s for that one call — because the worker
//    pool keeps the other 3 workers making progress on the remaining
//    controls in parallel, and this method already degrades a failed
//    call to a single control rather than failing the whole run (see
//    below).
const CLASSIFICATION_TIMEOUT_MS = 6_000;
const CLASSIFICATION_MAX_RETRIES = 0;
const COVERAGE_TIMEOUT_MS = 20_000;
const COVERAGE_MAX_RETRIES = 1;

const CLASSIFICATION_TOOL = {
  name: 'submit_classification',
  description: 'Submit which control this evidence most likely satisfies.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestedControlCode: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['suggestedControlCode', 'confidence', 'reasoning'],
  },
};

const COVERAGE_TOOL = {
  name: 'submit_coverage',
  description: 'Submit whether the candidate policy chunks address the control.',
  input_schema: {
    type: 'object' as const,
    properties: {
      covered: { type: 'boolean' },
      reasoning: { type: 'string' },
      citedChunkIndex: { type: ['number', 'null'] },
    },
    required: ['covered', 'reasoning', 'citedChunkIndex'],
  },
};

function describeControls(controls: ControlSummary[]): string {
  return controls.map((c) => `- ${c.code}: ${c.title} — ${c.description}`).join('\n');
}

@Injectable()
export class ClaudeAiProvider implements AiProvider {
  private readonly logger = new Logger(ClaudeAiProvider.name);
  // Client-level timeout/maxRetries are a fallback only — every call site
  // below passes its own explicit RequestOptions sized to its transaction
  // budget (see the constants above). This fallback uses the tighter,
  // no-retry classification budget, since an un-overridden call is more
  // likely to be a future call site added without thinking through its
  // transaction envelope, and failing fast is the safer default for that.
  private readonly client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: CLASSIFICATION_TIMEOUT_MS,
    maxRetries: CLASSIFICATION_MAX_RETRIES,
  });

  async classifyEvidence(input: {
    mimeType: string;
    content: Buffer | string;
    controls: ControlSummary[];
  }): Promise<ClassificationResult> {
    const prompt = `You are reviewing evidence uploaded against one of these compliance controls:\n${describeControls(
      input.controls,
    )}\n\nWhich control does this evidence most likely satisfy? If none clearly apply, say so.`;

    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = input.mimeType.startsWith('image/')
      ? [
          { type: 'text', text: prompt },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
              data: (input.content as Buffer).toString('base64'),
            },
          },
        ]
      : [{ type: 'text', text: `${prompt}\n\nEvidence content:\n${input.content}` }];

    const response = await this.client.messages.create(
      {
        model: CLASSIFICATION_MODEL,
        max_tokens: MAX_TOKENS,
        tools: [CLASSIFICATION_TOOL],
        tool_choice: { type: 'tool', name: 'submit_classification' },
        messages: [{ role: 'user', content: contentBlocks }],
      },
      { timeout: CLASSIFICATION_TIMEOUT_MS, maxRetries: CLASSIFICATION_MAX_RETRIES },
    );

    const toolUse = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) {
      // Forced tool_choice makes a missing tool_use block rare, but not
      // impossible (max_tokens truncation mid-tool-use, an API-level
      // refusal) — throw explicitly rather than casting `undefined` to
      // ClassificationResult and handing the caller a value that lies
      // about its own type. EvidenceService.upload already catches and
      // logs classification failures without failing the upload itself.
      throw new Error(
        `Claude response for evidence classification contained no tool_use block (stop_reason=${response.stop_reason})`,
      );
    }
    return toolUse.input as ClassificationResult;
  }

  async embed(text: string): Promise<number[]> {
    const pipeline = await getLocalEmbeddingPipeline();
    return embedWithPipeline(pipeline, text);
  }

  async checkControlCoverage(input: {
    control: ControlSummary;
    candidateChunks: ChunkSummary[];
  }): Promise<CoverageResult> {
    const chunkText = input.candidateChunks
      .map((c) => `[chunk ${c.index}] ${c.content}`)
      .join('\n\n');
    const prompt = `Control ${input.control.code}: ${input.control.title} — ${input.control.description}\n\nCandidate policy excerpts:\n${chunkText}\n\nDo these excerpts show this control is addressed? If yes, cite the chunk index that most directly supports it.`;

    // Unlike classifyEvidence, nothing in this method may throw: it runs
    // inside GapAnalysisService's runWithConcurrency worker pool, and an
    // uncaught error here — a network failure, an API error, a timeout,
    // as well as the missing-tool_use case below — rejects that worker's
    // Promise.all, 500s the whole /gap-analysis/run request, and
    // discards every other control's already-computed result from a run
    // that already spent most of the tenant's 5/hour rate budget. One
    // bad response degrading to "coverage check unavailable" for that
    // single control is far cheaper than losing the entire run.
    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create(
        {
          model: COVERAGE_MODEL,
          max_tokens: MAX_TOKENS,
          tools: [COVERAGE_TOOL],
          tool_choice: { type: 'tool', name: 'submit_coverage' },
          messages: [{ role: 'user', content: prompt }],
        },
        { timeout: COVERAGE_TIMEOUT_MS, maxRetries: COVERAGE_MAX_RETRIES },
      );
    } catch (error) {
      this.logger.error(
        `Claude API call failed during control coverage check for control ${input.control.code}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.coverageUnavailable();
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) {
      this.logger.error(
        `Claude response for control coverage check contained no tool_use block for control ${input.control.code} (stop_reason=${response.stop_reason})`,
      );
      return this.coverageUnavailable();
    }
    return toolUse.input as CoverageResult;
  }

  private coverageUnavailable(): CoverageResult {
    return { covered: false, reasoning: 'coverage check unavailable', citedChunkIndex: null };
  }
}

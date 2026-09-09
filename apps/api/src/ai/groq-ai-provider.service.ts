import { Injectable, Logger } from '@nestjs/common';
import Groq, { APIError } from 'groq-sdk';
import { ChunkSummary, ControlSummary, CoverageResult } from './ai-provider.interface';

// Groq handles gap-analysis coverage checks specifically because they're
// text-only (candidate policy chunks, never images) — Gemini remains the
// provider for classifyEvidence, which needs vision support for image
// evidence. See CompositeAiProvider for how the two are wired together
// behind the one AiProvider interface GapAnalysisService depends on.
//
// llama-3.3-70b-versatile (the original choice, matching the task's ask)
// was confirmed dead against this project's real key: a live gap-analysis
// run 404'd every one of 18 calls with "The model
// `llama-3.3-70b-versatile` does not exist or you do not have access to
// it" (code: model_not_found). Querying GET /openai/v1/models directly
// against the same key confirmed it — no llama-3.3 model of any kind is
// in this account's catalog; Groq appears to have retired it entirely,
// not just gated it behind a different tier. openai/gpt-oss-120b is what
// this replaces it with: it IS in the live model list, and — unlike
// llama-3.3-70b-versatile, which per-model limits couldn't be confirmed
// for at all in Groq's own rate-limits doc — it's one of the models that
// doc's free-tier table names explicitly, so its numbers below are
// confirmed from Groq's own documentation, not inferred from a
// deprecated model's page. A capable general-purpose model, well within
// what a short structured-JSON coverage judgment over a handful of
// policy excerpts needs.
const COVERAGE_MODEL = 'openai/gpt-oss-120b';
const COVERAGE_MAX_TOKENS = 2048;
const COVERAGE_TIMEOUT_MS = 20_000;
const COVERAGE_RETRY_ATTEMPTS = 2; // 1 retry, same shape as Gemini's coverage budget

// Confirmed against Groq's own rate-limits documentation for
// openai/gpt-oss-120b specifically (not a third-party tracker, and not
// carried over from llama-3.3-70b-versatile's now-irrelevant numbers —
// see COVERAGE_MODEL above): 30 requests/minute, 1,000 requests/day. Both
// are far more generous than Gemini's confirmed 5 RPM / ~20-per-day
// ceiling, which is what let GapAnalysisTransactionMiddleware's timeout
// come down from 300s to 60s (see that file) — a full 18-control run no
// longer spends ~255s just waiting on the pacer. A real 18-control run
// against this model completed in ~49s wall-clock with zero 429s at this
// pacer's setting, well inside that 60s budget.
//
// Paced at 80% of the documented 30 RPM ceiling (24/min), the same
// margin-under-the-ceiling approach Gemini's pacer uses, rather than the
// full 30 — not because 30 is known to be wrong, but because Gemini's own
// documented limit turned out to clip real calls at the edges even when
// paced exactly at it, and a live run here never got the chance to test
// pacing at the full 30 (only 18 calls were made, all comfortably under a
// minute). Revisit if a run with more controls, or concurrent tenants,
// ever produces a real 429.
const GROQ_FREE_TIER_RPM = 24;
const MIN_CALL_INTERVAL_MS = Math.ceil(60_000 / GROQ_FREE_TIER_RPM);

function describeChunks(candidateChunks: ChunkSummary[]): string {
  return candidateChunks.map((c) => `[chunk ${c.index}] ${c.content}`).join('\n\n');
}

/**
 * Groq's chat-completions API doesn't offer the same responseSchema
 * enforcement Gemini's does for every model — structured-output support
 * (`response_format: { type: 'json_schema' }`) is limited to a subset of
 * models Groq documents separately, and llama-3.3-70b-versatile isn't
 * confirmed among them. Using the broadly-supported `json_object` mode
 * instead (valid JSON, but not schema-constrained) means the exact
 * shape has to be spelled out in the prompt itself, and the response
 * needs the same defensive JSON.parse guard Gemini's coverage check
 * already carries for the same reason: a model can emit syntactically
 * broken JSON (most often truncated by the token cap), and this method
 * must never throw — see the class-level comment on why.
 */
const RESPONSE_SHAPE_INSTRUCTION =
  'Respond with ONLY a JSON object of this exact shape, no other text: ' +
  '{"covered": boolean, "reasoning": string, "citedChunkIndex": number | null}';

@Injectable()
export class GroqAiProvider {
  private readonly logger = new Logger(GroqAiProvider.name);
  private readonly client = new Groq({ apiKey: process.env.GROQ_API_KEY });

  // Same shared, process-wide pacer pattern as GeminiAiProvider's — see
  // that class for the full race-free reasoning (synchronous read/write,
  // no `await` in between). A separate instance/budget from Gemini's:
  // the two are now genuinely different providers with different quotas,
  // not two call sites sharing one credential.
  private nextAvailableAt = 0;

  private async throttle(): Promise<void> {
    const now = Date.now();
    const scheduledAt = Math.max(now, this.nextAvailableAt);
    this.nextAvailableAt = scheduledAt + MIN_CALL_INTERVAL_MS;
    const waitMs = scheduledAt - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /**
   * Runs up to 18 times per gap-analysis run through
   * GapAnalysisService's runWithConcurrency worker pool. Nothing in this
   * method may throw: an uncaught error here rejects that worker's
   * Promise.all, 500s the whole /gap-analysis/run request, and discards
   * every other control's already-computed result — see
   * GeminiAiProvider.checkControlCoverage's original version of this
   * same contract for the full rationale (this method replaces that
   * one; Gemini no longer handles coverage checks).
   */
  async checkControlCoverage(input: {
    control: ControlSummary;
    candidateChunks: ChunkSummary[];
  }): Promise<CoverageResult> {
    const prompt = `Control ${input.control.code}: ${input.control.title} — ${input.control.description}\n\nCandidate policy excerpts:\n${describeChunks(
      input.candidateChunks,
    )}\n\nDo these excerpts show this control is addressed? If yes, cite the chunk index that most directly supports it.\n\n${RESPONSE_SHAPE_INSTRUCTION}`;

    await this.throttle();

    let content: string | null;
    try {
      const response = await this.client.chat.completions.create(
        {
          model: COVERAGE_MODEL,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          max_tokens: COVERAGE_MAX_TOKENS,
        },
        { timeout: COVERAGE_TIMEOUT_MS, maxRetries: COVERAGE_RETRY_ATTEMPTS - 1 },
      );
      content = response.choices[0]?.message.content ?? null;
    } catch (error) {
      const status = error instanceof APIError ? error.status : undefined;
      this.logger.error(
        `Groq API call failed during control coverage check for control ${input.control.code} (status=${status}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.coverageUnavailable();
    }

    if (!content) {
      this.logger.error(
        `Groq response for control coverage check had no message content for control ${input.control.code}`,
      );
      return this.coverageUnavailable();
    }
    try {
      return JSON.parse(content) as CoverageResult;
    } catch (error) {
      this.logger.error(
        `Groq response for control coverage check was not valid JSON for control ${input.control.code}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.coverageUnavailable();
    }
  }

  private coverageUnavailable(): CoverageResult {
    return { covered: false, reasoning: 'coverage check unavailable', citedChunkIndex: null };
  }
}

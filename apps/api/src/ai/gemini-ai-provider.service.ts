import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, ApiError, Type } from '@google/genai';
import {
  AiProvider,
  ChunkSummary,
  ClassificationResult,
  ControlSummary,
  CoverageResult,
} from './ai-provider.interface';
import { embedWithPipeline, getLocalEmbeddingPipeline } from './local-embedding';

// Same model for both calls: classification doesn't need Pro-tier
// reasoning, and using one model means both call sites share a single
// rate-limit bucket (see the pacer below) instead of two independently
// tracked ones.
//
// gemini-2.5-flash was the original choice (matching the task's ask),
// but this project's API key returned a live 404 against it —
// "This model models/gemini-2.5-flash is no longer available to new
// users. Please update your code to use models/gemini-3.6-flash" —
// confirmed against the real API, not assumed. gemini-3.6-flash is what
// that error named, and is what's actually running here. Both calls
// (short structured JSON out of a text/vision classification prompt, a
// coverage check over a handful of policy excerpts) are well within
// either model's capability, so this pin exists only because 2.5-flash
// was unavailable to this specific account, not because 3.6 was needed
// on its own merits — worth confirming still holds if this key or
// account tier ever changes.
const CLASSIFICATION_MODEL = 'gemini-3.6-flash';
const COVERAGE_MODEL = 'gemini-3.6-flash';
// Split, not shared: a live gap-analysis run hit a truncated (invalid)
// JSON response from checkControlCoverage under a single shared 1024
// cap — coverage's `reasoning` has to justify itself against a whole
// candidate-chunk prompt and runs noticeably longer than
// classification's, which just names a control and a short rationale.
// Both still go through the JSON.parse try/catch below regardless (a
// bigger cap lowers how often truncation happens; it doesn't guarantee
// it can't).
const CLASSIFICATION_MAX_OUTPUT_TOKENS = 1024;
const COVERAGE_MAX_OUTPUT_TOKENS = 2048;

// Confirmed against the real API, not estimated: a live 429 during
// gap-analysis testing returned
// `quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"`,
// `quotaValue: "5"` for gemini-3.6-flash — the actual free-tier ceiling
// is 5 requests/minute, not the "roughly 10-15/min" figure this was
// originally sized against (which held for gemini-2.5-flash, a
// different, less-restricted model — see CLASSIFICATION_MODEL above for
// why this project ended up on 3.6 instead). Paced at exactly 5/min, a
// live run still degraded 4 of 18 controls to "coverage check
// unavailable": the observed `retryDelay`s ranged 3s-57s, meaning the
// quota window isn't a clean fixed-per-minute bucket aligned with this
// pacer's own clock, so pacing at the nominal limit still clips it at
// the edges. 4 (a 20% margin under the confirmed ceiling) is chosen to
// absorb that, not because 5 itself was wrong. It's a single
// process-wide pacer (not per-tenant): the GEMINI_API_KEY is one
// project-wide credential shared by every tenant, so the thing being
// protected is the project's quota, not any one tenant's.
const GEMINI_FREE_TIER_RPM = 4;
const MIN_CALL_INTERVAL_MS = Math.ceil(60_000 / GEMINI_FREE_TIER_RPM);

// Per-call HTTP timeout/retry budgets — see the equivalent constant
// block this replaced in the prior Claude implementation for the
// original rationale (bounding a call to fit inside its Prisma
// transaction's timeout). The numbers below account for the pacer wait
// above ALSO consuming part of that budget:
//  - classifyEvidence: runs inline inside the evidence-upload
//    transaction (EvidenceTransactionMiddleware — see that file for why
//    it needed its own, longer-than-default timeout once this was
//    actually measured against a real call instead of FakeAiProvider's
//    instant response). It does not block on the pacer (see
//    MAX_CLASSIFICATION_PACER_WAIT_MS below) — if the shared pacer is
//    more than a few seconds out, it skips the call outright rather than
//    let the wait eat further into the transaction budget. No retry:
//    same reasoning as before (EvidenceService.upload already treats any
//    failure here as best-effort), plus a retry would itself need to
//    wait for another pacer slot.
//
//    Text and image classification get DIFFERENT timeouts, not one
//    shared value, because their real measured latency is genuinely
//    different in kind, not just variance around the same number:
//      - text: 20s reflects real round trips observed against the live
//        Gemini API from this dev environment. gemini-3.6-flash's real
//        latency for a short text prompt varied from ~9s to a genuine
//        timeout past 12s across successive live calls, wide enough
//        variance that two earlier, smaller guesses (6s sized by parity
//        with the old Claude implementation's numbers, then 12s after
//        the first measurement) each undershot the next real call and
//        aborted it mid-flight.
//      - image: a real image-evidence upload through the actual web UI
//        came back with classification: null — traced end-to-end
//        (temporary logging at every boundary: rate limit consumed,
//        Gemini call reached with the correct inlineData payload, call
//        aborted by OUR OWN 20s client timeout, not a real API error)
//        to this same 20s value being applied to image calls too,
//        which had never been measured on their own — vision input is
//        real, additional work for the model, not noise around the
//        text number. Removing the timeout entirely and re-uploading
//        the same real image measured a genuine ~48s round trip
//        (generateContent called at :20, resolved at :08 the next
//        minute) before the model returned a correct, well-formed
//        classification. 90s keeps real margin above that single
//        measurement — the same ~1.5-2x margin the text budget carries
//        over ITS slowest observed call — rather than sitting at the
//        edge of the one data point gathered so far.
//  - checkControlCoverage: runs up to 18 times per gap-analysis run,
//    always through the pacer (see GapAnalysisTransactionMiddleware,
//    whose timeout was raised to fit ~18 paced, rate-limited calls — see
//    that file's comment for the full budget derivation). Coverage
//    checks are text-only (candidate policy chunks, never images), so
//    they keep using CLASSIFICATION_TIMEOUT_MS's sibling, COVERAGE_TIMEOUT_MS,
//    below — untouched by this split.
const CLASSIFICATION_TIMEOUT_MS = 20_000;
const IMAGE_CLASSIFICATION_TIMEOUT_MS = 90_000;
const CLASSIFICATION_RETRY_ATTEMPTS = 1; // 1 = the original call only, no retry
const MAX_CLASSIFICATION_PACER_WAIT_MS = 3_000;
const COVERAGE_TIMEOUT_MS = 20_000;
const COVERAGE_RETRY_ATTEMPTS = 2; // 2 = original call + one retry

const CLASSIFICATION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    suggestedControlCode: { type: Type.STRING, nullable: true },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ['suggestedControlCode', 'confidence', 'reasoning'],
};

const COVERAGE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    covered: { type: Type.BOOLEAN },
    reasoning: { type: Type.STRING },
    citedChunkIndex: { type: Type.INTEGER, nullable: true },
  },
  required: ['covered', 'reasoning', 'citedChunkIndex'],
};

function describeControls(controls: ControlSummary[]): string {
  return controls.map((c) => `- ${c.code}: ${c.title} — ${c.description}`).join('\n');
}

@Injectable()
export class GeminiAiProvider implements AiProvider {
  private readonly logger = new Logger(GeminiAiProvider.name);
  private readonly client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Shared pacer state — see MIN_CALL_INTERVAL_MS above. Deliberately a
  // plain instance field, not a Map keyed by tenant: the quota it
  // protects is the project's, not any one tenant's, and
  // GeminiAiProvider is a Nest singleton, so this is naturally
  // process-wide. Read and written synchronously (no `await` in
  // between) in both reserveSlot() and the wait check below, which is
  // what makes concurrent callers (GapAnalysisService's 4-worker pool)
  // race-free without a real mutex — JS never interleaves between two
  // synchronous statements.
  private nextAvailableAt = 0;

  private peekWaitMs(): number {
    return Math.max(0, this.nextAvailableAt - Date.now());
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const scheduledAt = Math.max(now, this.nextAvailableAt);
    this.nextAvailableAt = scheduledAt + MIN_CALL_INTERVAL_MS;
    const waitMs = scheduledAt - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  async classifyEvidence(input: {
    mimeType: string;
    content: Buffer | string;
    controls: ControlSummary[];
  }): Promise<ClassificationResult> {
    // Don't block the evidence-upload transaction waiting for a pacer
    // slot — if the shared budget is congested, skip the call outright.
    // EvidenceService.upload already treats a thrown error here as
    // best-effort (caught, logged, upload still succeeds with no
    // classification), so this reuses that exact path rather than
    // needing its own handling.
    const waitMs = this.peekWaitMs();
    if (waitMs > MAX_CLASSIFICATION_PACER_WAIT_MS) {
      throw new Error(
        `Gemini rate pacer is congested (next available slot in ${waitMs}ms) — skipping classification to protect the upload's transaction budget`,
      );
    }
    await this.throttle();

    const prompt = `You are reviewing evidence uploaded against one of these compliance controls:\n${describeControls(
      input.controls,
    )}\n\nWhich control does this evidence most likely satisfy? If none clearly apply, say so.`;

    const isImage = input.mimeType.startsWith('image/');
    const parts = isImage
      ? [
          { text: prompt },
          {
            inlineData: {
              mimeType: input.mimeType,
              data: (input.content as Buffer).toString('base64'),
            },
          },
        ]
      : [{ text: `${prompt}\n\nEvidence content:\n${input.content}` }];

    const response = await this.client.models.generateContent({
      model: CLASSIFICATION_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: CLASSIFICATION_RESPONSE_SCHEMA,
        maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS,
        httpOptions: {
          timeout: isImage ? IMAGE_CLASSIFICATION_TIMEOUT_MS : CLASSIFICATION_TIMEOUT_MS,
          retryOptions: { attempts: CLASSIFICATION_RETRY_ATTEMPTS },
        },
      },
    });

    if (!response.text) {
      // response.text returns undefined when the top candidate has no
      // text parts — e.g. a safety block, or a MAX_TOKENS finish with
      // nothing generated yet. Mirrors the prior Claude implementation's
      // "no tool_use block" guard: throw rather than hand the caller a
      // value that lies about its own shape, since a structured-JSON
      // response is exactly what a caller of this method is trusting to
      // exist.
      const finishReason = response.candidates?.[0]?.finishReason;
      throw new Error(
        `Gemini response for evidence classification had no text content (finishReason=${finishReason})`,
      );
    }
    try {
      return JSON.parse(response.text) as ClassificationResult;
    } catch (error) {
      // responseSchema constrains the model's *target* shape but Gemini
      // can still emit a syntactically broken string — most commonly a
      // truncated one, cut off mid-token by maxOutputTokens on a verbose
      // response, which is exactly the finishReason worth surfacing
      // here. Observed for real during gap-analysis testing (see the
      // equivalent guard in checkControlCoverage): the raw JSON.parse
      // SyntaxError, left unguarded, propagated all the way out of this
      // method as an unrelated-looking parse error instead of the
      // classification failure it actually is.
      const finishReason = response.candidates?.[0]?.finishReason;
      throw new Error(
        `Gemini response for evidence classification was not valid JSON (finishReason=${finishReason}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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

    // Unlike classifyEvidence, this always waits for its pacer slot
    // rather than skipping — see GapAnalysisTransactionMiddleware for
    // why its transaction timeout was raised to accommodate that.
    //
    // Nothing in this method may throw: it runs inside
    // GapAnalysisService's runWithConcurrency worker pool, and an
    // uncaught error here — a network failure, an API error, a timeout,
    // as well as the missing-text case below — rejects that worker's
    // Promise.all, 500s the whole /gap-analysis/run request, and
    // discards every other control's already-computed result from a run
    // that already spent most of the tenant's 5/hour rate budget. One
    // bad response degrading to "coverage check unavailable" for that
    // single control is far cheaper than losing the entire run.
    await this.throttle();

    let response: Awaited<ReturnType<typeof this.client.models.generateContent>>;
    try {
      response = await this.client.models.generateContent({
        model: COVERAGE_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: COVERAGE_RESPONSE_SCHEMA,
          maxOutputTokens: COVERAGE_MAX_OUTPUT_TOKENS,
          httpOptions: {
            timeout: COVERAGE_TIMEOUT_MS,
            retryOptions: { attempts: COVERAGE_RETRY_ATTEMPTS },
          },
        },
      });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined;
      this.logger.error(
        `Gemini API call failed during control coverage check for control ${input.control.code} (status=${status}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.coverageUnavailable();
    }

    if (!response.text) {
      const finishReason = response.candidates?.[0]?.finishReason;
      this.logger.error(
        `Gemini response for control coverage check had no text content for control ${input.control.code} (finishReason=${finishReason})`,
      );
      return this.coverageUnavailable();
    }
    try {
      return JSON.parse(response.text) as CoverageResult;
    } catch (error) {
      // Live-observed, not theoretical: a real gap-analysis run threw
      // "Unterminated string in JSON" here and crashed the whole
      // /gap-analysis/run request — responseSchema constrains the
      // model's target shape, but doesn't guarantee the string it emits
      // is well-formed (most likely truncated mid-token by
      // maxOutputTokens on a verbose response). Same rationale as the
      // try/catch around the API call above: this method may not throw,
      // so a parse failure degrades this one control instead of taking
      // down the run.
      const finishReason = response.candidates?.[0]?.finishReason;
      this.logger.error(
        `Gemini response for control coverage check was not valid JSON for control ${input.control.code} (finishReason=${finishReason}): ${
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

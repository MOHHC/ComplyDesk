import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GeminiAiProvider } from './gemini-ai-provider.service';

/**
 * Real-API smoke test for GeminiAiProvider.classifyEvidence's image
 * (vision) path — companion to the deterministic mocked test in
 * gemini-ai-provider.spec.ts ("classifyEvidence gives image
 * classification a meaningfully larger timeout than text").
 *
 * That mocked test is the actual regression guard: it asserts the code
 * is CONFIGURED with a large-enough, distinct timeout for image calls,
 * and reliably fails/passes on every run regardless of network
 * conditions. This test cannot do the same job — while investigating a
 * real image evidence upload through the actual web UI that came back
 * with classification: null (root-caused to a client-side timeout
 * tuned only against text-classification latency and silently reused
 * for image calls — see IMAGE_CLASSIFICATION_TIMEOUT_MS's comment in
 * gemini-ai-provider.service.ts for the full trace), a live repro of
 * the exact same image sometimes completed in under 5 seconds and
 * sometimes took a genuine ~48-58 seconds for the identical call. Real
 * Gemini latency is itself too variable for a single live call to
 * reliably prove or disprove that a given timeout is too short — a fast
 * run can pass even against the old, buggy shared timeout by chance.
 *
 * What this test IS good for: proving the real, whole call path — the
 * actual inlineData payload shape, the actual API contract, the actual
 * model — still works end-to-end and returns a well-formed result,
 * which FakeAiProvider (used everywhere else, including e2e) can never
 * exercise since it resolves instantly for every mimeType regardless of
 * whether the real request shape is even valid. That's a different, and
 * still real, gap this project's "tests never call real APIs" norm
 * otherwise leaves uncovered.
 *
 * Guarded by TWO conditions, not one, so it can never run by accident:
 * GEMINI_API_KEY must be set AND RUN_REAL_GEMINI_TESTS=1 must be passed
 * explicitly. `npm test` alone never triggers this, matching the
 * project's default; a developer (or a deliberately-configured CI job)
 * opts in with:
 *
 *   RUN_REAL_GEMINI_TESTS=1 npm test -w apps/api -- gemini-ai-provider.image-classification
 *
 * The test image is a real fixture (test/fixtures/sample-evidence-
 * screenshot.png, 400x300 with rendered text), not a trivial 1x1 pixel,
 * so it at least exercises genuine vision processing rather than an
 * edge case the model could special-case away.
 */
const RUN_REAL_TEST = Boolean(process.env.GEMINI_API_KEY) && process.env.RUN_REAL_GEMINI_TESTS === '1';

(RUN_REAL_TEST ? describe : describe.skip)('GeminiAiProvider.classifyEvidence — real Gemini API (image)', () => {
  it(
    'classifies a real image end-to-end against the live API and returns a well-formed result',
    async () => {
      const provider = new GeminiAiProvider();
      const image = readFileSync(join(__dirname, '../../test/fixtures/sample-evidence-screenshot.png'));

      const result = await provider.classifyEvidence({
        mimeType: 'image/png',
        content: image,
        controls: [
          {
            code: 'AC-01',
            title: 'Timely Access Revocation on Offboarding',
            description:
              'All access to company systems, applications, and shared accounts is revoked within 24 hours of an employee or contractor departure.',
          },
        ],
      });

      expect(typeof result.suggestedControlCode === 'string' || result.suggestedControlCode === null).toBe(true);
      expect(typeof result.confidence).toBe('number');
      expect(typeof result.reasoning).toBe('string');
      expect(result.reasoning.length).toBeGreaterThan(0);
    },
    120_000, // real network call; comfortably above IMAGE_CLASSIFICATION_TIMEOUT_MS even on a slow run, per the variance noted above
  );
});

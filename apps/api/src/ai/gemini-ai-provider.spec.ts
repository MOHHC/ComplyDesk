const mockGenerateContent = jest.fn();
jest.mock('@google/genai', () => {
  // Object.create(actual) makes the real module the prototype of the
  // mocked one: only GoogleGenAI is shadowed as an own property below,
  // and every other export (Type, ApiError, ...) falls through to the
  // real module via the prototype chain — this works regardless of
  // whether those exports are enumerable, unlike spreading `...actual`.
  const actual = jest.requireActual('@google/genai');
  return Object.assign(Object.create(actual), {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: { generateContent: mockGenerateContent },
    })),
  });
});

import { ApiError } from '@google/genai';
import { GeminiAiProvider } from './gemini-ai-provider.service';

describe('GeminiAiProvider', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  const controls = [
    { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
  ];

  it('classifyEvidence sends a JSON-schema-constrained request and parses the response text', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ suggestedControlCode: 'AC-01', confidence: 0.87, reasoning: 'matches access review language' }),
    });

    const provider = new GeminiAiProvider();
    const result = await provider.classifyEvidence({
      mimeType: 'text/plain',
      content: 'we reviewed access quarterly',
      controls,
    });

    expect(result).toEqual({
      suggestedControlCode: 'AC-01',
      confidence: 0.87,
      reasoning: 'matches access review language',
    });
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.6-flash',
        config: expect.objectContaining({ responseMimeType: 'application/json' }),
      }),
    );
  });

  it('classifyEvidence sends an inlineData image part for image mimeTypes', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ suggestedControlCode: null, confidence: 0, reasoning: 'unclear' }),
    });

    const provider = new GeminiAiProvider();
    await provider.classifyEvidence({
      mimeType: 'image/png',
      content: Buffer.from('fake-image-bytes'),
      controls,
    });

    const call = mockGenerateContent.mock.calls[0][0];
    const parts = call.contents[0].parts;
    expect(parts.some((p: { inlineData?: unknown }) => 'inlineData' in p)).toBe(true);
  });

  it('classifyEvidence gives image classification a meaningfully larger timeout than text', async () => {
    // Live-observed, not hypothetical: a real image evidence upload
    // through the actual web UI came back with classification: null.
    // Traced end-to-end, the Gemini call was reached with the correct
    // inlineData payload but got aborted by our own client-side
    // timeout — the SAME constant text classification used, never
    // separately measured for image (vision) input. A real repro with
    // that timeout removed measured a genuine ~48s round trip before
    // the model returned a correct classification — vision input is a
    // real, additional processing cost, not variance around the text
    // number. This test is deliberately NOT a real-API timing test
    // (see gemini-ai-provider.image-classification.real-api.spec.ts's
    // own comment for why a single live call can't reliably prove a
    // timeout was too short — real Gemini latency is itself too
    // variable to reproduce on demand): it asserts the two code paths
    // are actually CONFIGURED differently, which is what regressed
    // originally and what a mock can catch deterministically every run.
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ suggestedControlCode: 'AC-01', confidence: 0.9, reasoning: 'ok' }),
    });

    // classifyEvidence doesn't block on the shared pacer — it skips
    // outright when congested (see the pacer describe block below) — so
    // a second call issued immediately after the first would throw
    // "congested" rather than reach generateContent at all. Use fake
    // timers to advance past the pacer's own interval between the two
    // calls, same pattern the pacing tests below already use.
    jest.useFakeTimers();
    try {
      const provider = new GeminiAiProvider();

      const first = provider.classifyEvidence({ mimeType: 'text/plain', content: 'we reviewed access quarterly', controls });
      await jest.advanceTimersByTimeAsync(0);
      await first;
      const textTimeout = mockGenerateContent.mock.calls[0][0].config.httpOptions.timeout;

      mockGenerateContent.mockClear();
      await jest.advanceTimersByTimeAsync(15_000); // clear the pacer's MIN_CALL_INTERVAL_MS
      const second = provider.classifyEvidence({ mimeType: 'image/png', content: Buffer.from('fake-image-bytes'), controls });
      await jest.advanceTimersByTimeAsync(0);
      await second;
      const imageTimeout = mockGenerateContent.mock.calls[0][0].config.httpOptions.timeout;

      // Not just "different" — large enough on its own to cover the ~48s
      // real measurement with real margin, so a future edit that widens
      // the text budget instead of the image one still fails this test.
      expect(imageTimeout).toBeGreaterThanOrEqual(60_000);
      expect(imageTimeout).toBeGreaterThan(textTimeout);
    } finally {
      jest.useRealTimers();
    }
  });

  it('checkControlCoverage sends a JSON-schema-constrained request and parses the response text', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ covered: true, reasoning: 'chunk 0 addresses this directly', citedChunkIndex: 0 }),
    });

    const provider = new GeminiAiProvider();
    const result = await provider.checkControlCoverage({
      control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
      candidateChunks: [{ index: 0, content: 'we review all access grants every quarter' }],
    });

    expect(result).toEqual({ covered: true, reasoning: 'chunk 0 addresses this directly', citedChunkIndex: 0 });
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.6-flash' }),
    );
  });

  it('classifyEvidence throws when the response has no text content', async () => {
    // response.text is `string | undefined` per the SDK — undefined when
    // the top candidate has no text parts (e.g. a safety block). Throw
    // rather than hand the caller a value that lies about its shape;
    // EvidenceService.upload already catches and logs classification
    // failures without failing the upload itself.
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      candidates: [{ finishReason: 'SAFETY' }],
    });

    const provider = new GeminiAiProvider();
    await expect(
      provider.classifyEvidence({
        mimeType: 'text/plain',
        content: 'we reviewed access quarterly',
        controls,
      }),
    ).rejects.toThrow(/no text content/);
  });

  it('classifyEvidence throws (not a raw SyntaxError) when the response text is not valid JSON', async () => {
    // Live-observed, not hypothetical: a real gap-analysis run got back
    // a truncated JSON string from Gemini (most likely cut off
    // mid-token by maxOutputTokens on a verbose response) and an
    // unguarded JSON.parse threw a raw SyntaxError that looked nothing
    // like a classification failure. responseSchema constrains the
    // model's target shape but doesn't guarantee the emitted string is
    // well-formed.
    mockGenerateContent.mockResolvedValue({
      text: '{"suggestedControlCode": "AC-01", "confidence": 0.9, "reasoning": "the eviden',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });

    const provider = new GeminiAiProvider();
    await expect(
      provider.classifyEvidence({
        mimeType: 'text/plain',
        content: 'we reviewed access quarterly',
        controls,
      }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('checkControlCoverage falls back to a safe result when the response has no text content', async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });

    const provider = new GeminiAiProvider();
    const result = await provider.checkControlCoverage({
      control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
      candidateChunks: [{ index: 0, content: 'we review all access grants every quarter' }],
    });

    expect(result).toEqual({
      covered: false,
      reasoning: 'coverage check unavailable',
      citedChunkIndex: null,
    });
  });

  it('checkControlCoverage degrades instead of throwing when the response text is not valid JSON', async () => {
    // This is the exact bug a live gap-analysis run hit: a truncated
    // JSON string reached JSON.parse unguarded, and the raw SyntaxError
    // propagated out of checkControlCoverage, out of runWithConcurrency's
    // Promise.all, and 500'd the whole /gap-analysis/run request —
    // discarding every other control's already-computed result in that
    // run. This must degrade the one control instead, same as every
    // other failure mode this method already guards.
    mockGenerateContent.mockResolvedValue({
      text: '{"covered": true, "reasoning": "chunk 0 addresses this because the polic',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });

    const provider = new GeminiAiProvider();
    const result = await provider.checkControlCoverage({
      control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
      candidateChunks: [{ index: 0, content: 'we review all access grants every quarter' }],
    });

    expect(result).toEqual({
      covered: false,
      reasoning: 'coverage check unavailable',
      citedChunkIndex: null,
    });
  });

  it('checkControlCoverage degrades instead of throwing when the API call itself fails', async () => {
    // A rejected generateContent() — a network error, a 429, a 5xx — is
    // not the same failure as "the response came back with no text": it
    // never produces a `response` to inspect at all. This must be caught
    // at the call itself, not just guarded past missing text, or an
    // outage still 500s /gap-analysis/run and discards every other
    // control's already-computed result in that run.
    mockGenerateContent.mockRejectedValue(new ApiError({ message: 'rate limited', status: 429 }));

    const provider = new GeminiAiProvider();
    const result = await provider.checkControlCoverage({
      control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
      candidateChunks: [{ index: 0, content: 'we review all access grants every quarter' }],
    });

    expect(result).toEqual({
      covered: false,
      reasoning: 'coverage check unavailable',
      citedChunkIndex: null,
    });
  });

  it('checkControlCoverage passes an explicit timeout and retry budget bounded well under its transaction budget', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ covered: true, reasoning: 'ok', citedChunkIndex: 0 }),
    });

    const provider = new GeminiAiProvider();
    await provider.checkControlCoverage({
      control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
      candidateChunks: [{ index: 0, content: 'we review all access grants every quarter' }],
    });

    const { httpOptions } = mockGenerateContent.mock.calls[0][0].config;
    expect(httpOptions.timeout).toBeLessThanOrEqual(20_000);
    expect(httpOptions.retryOptions.attempts).toBeLessThanOrEqual(2);
  });

  it('classifyEvidence passes an explicit timeout and one retry, bounded well under its transaction budget', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ suggestedControlCode: 'AC-01', confidence: 0.9, reasoning: 'ok' }),
    });

    const provider = new GeminiAiProvider();
    await provider.classifyEvidence({
      mimeType: 'text/plain',
      content: 'we reviewed access quarterly',
      controls,
    });

    const { httpOptions } = mockGenerateContent.mock.calls[0][0].config;
    // 25s, not the literal CLASSIFICATION_TIMEOUT_MS value: this asserts
    // the call stays comfortably under EvidenceTransactionMiddleware's
    // transaction budget with real margin, not the exact constant, so a
    // deliberate future retune doesn't require touching this test unless
    // it actually threatens that budget.
    expect(httpOptions.timeout).toBeLessThanOrEqual(25_000);
    // One retry (attempts=2), not zero: a real cold-boot verification of
    // the image-classification timeout fix hit a distinct failure mode —
    // Gemini's own server returning 504 DEADLINE_EXCEEDED — which zero
    // retries had no way to absorb. See CLASSIFICATION_RETRY_ATTEMPTS's
    // comment in gemini-ai-provider.service.ts for the full rationale.
    expect(httpOptions.retryOptions.attempts).toBe(2);
  });

  describe('rate pacing (free-tier RPM protection)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('spaces consecutive checkControlCoverage calls at least MIN_CALL_INTERVAL_MS apart', async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ covered: false, reasoning: 'ok', citedChunkIndex: null }),
      });

      const provider = new GeminiAiProvider();
      const input = {
        control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
        candidateChunks: [{ index: 0, content: 'irrelevant text' }],
      };

      const first = provider.checkControlCoverage(input);
      await jest.advanceTimersByTimeAsync(0);
      await first;
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // The second call must not reach the API immediately — it has to
      // wait out the pacer's minimum interval first.
      const second = provider.checkControlCoverage(input);
      await jest.advanceTimersByTimeAsync(0);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // Advancing by just under the interval (MIN_CALL_INTERVAL_MS =
      // ceil(60_000 / GEMINI_FREE_TIER_RPM) = 15_000ms at the service's
      // current RPM=4) still shouldn't release it...
      await jest.advanceTimersByTimeAsync(14_999);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // ...but the full interval does.
      await jest.advanceTimersByTimeAsync(1);
      await second;
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('classifyEvidence skips the call outright when the pacer is congested, rather than blocking the upload transaction', async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ covered: false, reasoning: 'ok', citedChunkIndex: null }),
      });

      const provider = new GeminiAiProvider();

      // Reserve the pacer far into the future with a coverage call (which
      // always waits, never skips) so the next slot is well beyond
      // classifyEvidence's small tolerance.
      const coveragePromise = provider.checkControlCoverage({
        control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
        candidateChunks: [{ index: 0, content: 'irrelevant text' }],
      });
      await jest.advanceTimersByTimeAsync(0);
      await coveragePromise;
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // The pacer's next slot is now ~15s out. classifyEvidence's
      // tolerance is 3s, so this must reject without ever calling the API
      // a second time.
      await expect(
        provider.classifyEvidence({
          mimeType: 'text/plain',
          content: 'we reviewed access quarterly',
          controls,
        }),
      ).rejects.toThrow(/congested/);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });
});

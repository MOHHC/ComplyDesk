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

    it('classifyEvidence skips the call outright when the pacer is congested, rather than blocking the upload transaction', async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ suggestedControlCode: 'AC-01', confidence: 0.9, reasoning: 'ok' }),
      });

      const provider = new GeminiAiProvider();
      const input = { mimeType: 'text/plain', content: 'we reviewed access quarterly', controls };

      // The first call reserves the pacer's next slot, ~15s out
      // (MIN_CALL_INTERVAL_MS = ceil(60_000 / GEMINI_FREE_TIER_RPM) at
      // the service's current RPM=4).
      const first = provider.classifyEvidence(input);
      await jest.advanceTimersByTimeAsync(0);
      await first;
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // A second call issued immediately after sees that ~15s wait,
      // which is well past classifyEvidence's own 3s tolerance — it must
      // reject outright rather than block the upload transaction
      // waiting it out.
      await expect(provider.classifyEvidence(input)).rejects.toThrow(/congested/);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });
});

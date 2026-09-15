const mockCreate = jest.fn();
jest.mock('groq-sdk', () => {
  // Unlike @google/genai (a plain named export, shadowed elsewhere in
  // this file's sibling specs via Object.create(actual)), groq-sdk's
  // `default` export is a getter-only property on the real module —
  // Object.assign onto Object.create(actual) throws trying to overwrite
  // it. List exactly what's needed instead: the mocked client as
  // `default`, and the real APIError re-exported unchanged for tests
  // that construct one.
  const actual = jest.requireActual('groq-sdk');
  const MockGroq = jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  return { __esModule: true, default: MockGroq, APIError: actual.APIError };
});

import { GroqAiProvider } from './groq-ai-provider.service';

function chatCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('GroqAiProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const input = {
    control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
    candidateChunks: [{ index: 0, content: 'we review all access grants every quarter' }],
  };

  it('checkControlCoverage sends a json_object-constrained request and parses the response content', async () => {
    mockCreate.mockResolvedValue(
      chatCompletion(JSON.stringify({ covered: true, reasoning: 'chunk 0 addresses this directly', citedChunkIndex: 0 })),
    );

    const provider = new GroqAiProvider();
    const result = await provider.checkControlCoverage(input);

    expect(result).toEqual({ covered: true, reasoning: 'chunk 0 addresses this directly', citedChunkIndex: 0 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-oss-120b',
        response_format: { type: 'json_object' },
      }),
      expect.anything(),
    );
  });

  it('checkControlCoverage falls back to a safe result when the response has no message content', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: null } }] });

    const provider = new GroqAiProvider();
    const result = await provider.checkControlCoverage(input);

    expect(result).toEqual({
      covered: false,
      reasoning: 'Coverage check unavailable (empty response from provider). Re-run gap analysis to retry this control.',
      citedChunkIndex: null,
    });
  });

  it('checkControlCoverage degrades instead of throwing when the response content is not valid JSON', async () => {
    // Same defensive posture as GeminiAiProvider's equivalent guard (see
    // that class's history): json_object mode guarantees syntactically
    // valid JSON in principle, but a token-capped response can still be
    // truncated mid-object. This must degrade the one control instead of
    // taking down the whole /gap-analysis/run request.
    mockCreate.mockResolvedValue(chatCompletion('{"covered": true, "reasoning": "chunk 0 addresses this because the polic'));

    const provider = new GroqAiProvider();
    const result = await provider.checkControlCoverage(input);

    expect(result).toEqual({
      covered: false,
      reasoning: 'Coverage check unavailable (malformed response from provider). Re-run gap analysis to retry this control.',
      citedChunkIndex: null,
    });
  });

  it('checkControlCoverage degrades instead of throwing when the API call itself fails, and records the status code', async () => {
    const { APIError } = jest.requireActual('groq-sdk');
    mockCreate.mockRejectedValue(new APIError(429, { message: 'rate limited' }, 'rate limited', new Headers()));

    const provider = new GroqAiProvider();
    const result = await provider.checkControlCoverage(input);

    expect(result).toEqual({
      covered: false,
      reasoning: 'Coverage check unavailable (provider error, status 429). Re-run gap analysis to retry this control.',
      citedChunkIndex: null,
    });
  });

  it('checkControlCoverage passes an explicit timeout and retry budget bounded well under its transaction budget', async () => {
    mockCreate.mockResolvedValue(chatCompletion(JSON.stringify({ covered: true, reasoning: 'ok', citedChunkIndex: 0 })));

    const provider = new GroqAiProvider();
    await provider.checkControlCoverage(input);

    const [, options] = mockCreate.mock.calls[0];
    expect(options.timeout).toBeLessThanOrEqual(20_000);
    expect(options.maxRetries).toBeLessThanOrEqual(2);
  });

  describe('rate pacing (free-tier RPM protection)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('spaces consecutive checkControlCoverage calls at least MIN_CALL_INTERVAL_MS apart', async () => {
      mockCreate.mockResolvedValue(chatCompletion(JSON.stringify({ covered: false, reasoning: 'ok', citedChunkIndex: null })));

      const provider = new GroqAiProvider();

      const first = provider.checkControlCoverage(input);
      await jest.advanceTimersByTimeAsync(0);
      await first;
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // The second call must not reach the API immediately — it has to
      // wait out the pacer's minimum interval first.
      const second = provider.checkControlCoverage(input);
      await jest.advanceTimersByTimeAsync(0);
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Advancing by just under the interval (MIN_CALL_INTERVAL_MS =
      // ceil(60_000 / GROQ_FREE_TIER_RPM) = 2_500ms at the service's
      // current RPM=24) still shouldn't release it...
      await jest.advanceTimersByTimeAsync(2_499);
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // ...but the full interval does.
      await jest.advanceTimersByTimeAsync(1);
      await second;
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });
});

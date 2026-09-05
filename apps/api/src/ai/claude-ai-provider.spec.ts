const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

import { ClaudeAiProvider } from './claude-ai-provider.service';

describe('ClaudeAiProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const controls = [
    { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
  ];

  it('classifyEvidence sends a forced tool call and parses the tool_use block', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'submit_classification',
          input: { suggestedControlCode: 'AC-01', confidence: 0.87, reasoning: 'matches access review language' },
        },
      ],
    });

    const provider = new ClaudeAiProvider();
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
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        tool_choice: { type: 'tool', name: 'submit_classification' },
      }),
    );
  });

  it('classifyEvidence sends an image content block for image mimeTypes', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'tool_use', name: 'submit_classification', input: { suggestedControlCode: null, confidence: 0, reasoning: 'unclear' } },
      ],
    });

    const provider = new ClaudeAiProvider();
    await provider.classifyEvidence({
      mimeType: 'image/png',
      content: Buffer.from('fake-image-bytes'),
      controls,
    });

    const call = mockCreate.mock.calls[0][0];
    const contentBlocks = call.messages[0].content;
    expect(contentBlocks.some((b: { type: string }) => b.type === 'image')).toBe(true);
  });

  it('checkControlCoverage sends a forced tool call and parses the tool_use block', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'submit_coverage',
          input: { covered: true, reasoning: 'chunk 0 addresses this directly', citedChunkIndex: 0 },
        },
      ],
    });

    const provider = new ClaudeAiProvider();
    const result = await provider.checkControlCoverage({
      control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
      candidateChunks: [{ index: 0, content: 'we review all access grants every quarter' }],
    });

    expect(result).toEqual({ covered: true, reasoning: 'chunk 0 addresses this directly', citedChunkIndex: 0 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5' }),
    );
  });

  it('classifyEvidence throws when the response has no tool_use block', async () => {
    // Forced tool_choice makes this rare (max_tokens truncation
    // mid-tool-use, an API-level refusal) but not impossible. Casting
    // undefined through `as ClassificationResult` would hand the caller
    // a value that lies about its own shape; this path must throw
    // instead so it surfaces as a caught, logged failure in
    // EvidenceService.upload rather than a silent bad classification.
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      stop_reason: 'end_turn',
    });

    const provider = new ClaudeAiProvider();
    await expect(
      provider.classifyEvidence({
        mimeType: 'text/plain',
        content: 'we reviewed access quarterly',
        controls,
      }),
    ).rejects.toThrow(/no tool_use block/);
  });

  it('checkControlCoverage falls back to a safe result when the response has no tool_use block', async () => {
    // Unlike classifyEvidence, this path runs inside
    // GapAnalysisService's runWithConcurrency loop: throwing here would
    // 500 the whole /gap-analysis/run request and discard every other
    // control's already-computed result. It must degrade to a safe
    // per-control fallback instead.
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      stop_reason: 'end_turn',
    });

    const provider = new ClaudeAiProvider();
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
});

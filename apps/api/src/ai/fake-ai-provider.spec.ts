import { FakeAiProvider } from './fake-ai-provider.service';

describe('FakeAiProvider', () => {
  const controls = [
    { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
    { code: 'AC-02', title: 'MFA', description: 'Multi-factor authentication enforced' },
  ];

  it('classifies based on a marker in the content, defaulting to the first control', async () => {
    const provider = new FakeAiProvider();

    const marked = await provider.classifyEvidence({
      mimeType: 'text/plain',
      content: 'CLASSIFY_AS:AC-02 some evidence text',
      controls,
    });
    expect(marked.suggestedControlCode).toBe('AC-02');
    expect(marked.confidence).toBeGreaterThan(0);

    const unmarked = await provider.classifyEvidence({
      mimeType: 'text/plain',
      content: 'plain evidence text with no marker',
      controls,
    });
    expect(unmarked.suggestedControlCode).toBe('AC-01');
  });

  it('reports a reasoned no-match result for NO_MATCH-marked content', async () => {
    const provider = new FakeAiProvider();
    const result = await provider.classifyEvidence({
      mimeType: 'text/plain',
      content: 'NO_MATCH this evidence fits nothing',
      controls,
    });
    expect(result.suggestedControlCode).toBeNull();
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it('throws for FAIL_CLASSIFICATION-marked content, simulating a provider error', async () => {
    const provider = new FakeAiProvider();
    await expect(
      provider.classifyEvidence({
        mimeType: 'text/plain',
        content: 'FAIL_CLASSIFICATION this call should blow up',
        controls,
      }),
    ).rejects.toThrow();
  });

  it('produces a deterministic embedding of fixed length for the same text', async () => {
    const provider = new FakeAiProvider();
    const first = await provider.embed('hello world');
    const second = await provider.embed('hello world');
    const different = await provider.embed('something else entirely');

    expect(first).toHaveLength(384);
    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
  });

  it('reports coverage based on a marker in the control description', async () => {
    const provider = new FakeAiProvider();

    const covered = await provider.checkControlCoverage({
      control: { code: 'AC-01', title: 'x', description: 'COVERED:0 access reviews' },
      candidateChunks: [{ index: 0, content: 'we review access quarterly' }],
    });
    expect(covered.covered).toBe(true);
    expect(covered.citedChunkIndex).toBe(0);

    const notCovered = await provider.checkControlCoverage({
      control: { code: 'AC-02', title: 'x', description: 'no marker here' },
      candidateChunks: [{ index: 0, content: 'unrelated text' }],
    });
    expect(notCovered.covered).toBe(false);
    expect(notCovered.citedChunkIndex).toBeNull();
  });
});

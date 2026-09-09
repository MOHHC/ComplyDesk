import { CompositeAiProvider } from './composite-ai-provider.service';
import { GeminiAiProvider } from './gemini-ai-provider.service';
import { GroqAiProvider } from './groq-ai-provider.service';

/**
 * The direct answer to "confirm gap analysis now calls Groq, not
 * Gemini": GapAnalysisService only ever calls AiProvider.checkControlCoverage
 * (and .embed, unrelated to this change) — it has no idea CompositeAiProvider
 * or either concrete provider even exists. So the thing worth asserting
 * isn't gap-analysis behavior itself (already covered by
 * gap-analysis.e2e-spec.ts against FakeAiProvider), it's that the single
 * class actually bound to AI_PROVIDER (see ai.module.ts) routes each
 * AiProvider method to the correct concrete provider — spied here so a
 * future edit that accidentally reverts checkControlCoverage to Gemini,
 * or routes classifyEvidence to Groq, fails a test instead of silently
 * shipping.
 */
describe('CompositeAiProvider', () => {
  const buildProvider = () => {
    const gemini = {
      classifyEvidence: jest.fn().mockResolvedValue({ suggestedControlCode: 'AC-01', confidence: 0.9, reasoning: 'gemini said so' }),
      embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      // Deliberately present on the mock (a real GeminiAiProvider no
      // longer has this method at all) so that if checkControlCoverage
      // were ever mistakenly routed back to Gemini, this test would
      // catch it actually being called rather than just erroring on a
      // missing method.
      checkControlCoverage: jest.fn(),
    } as unknown as GeminiAiProvider;
    const groq = {
      checkControlCoverage: jest.fn().mockResolvedValue({ covered: true, reasoning: 'groq said so', citedChunkIndex: 0 }),
      classifyEvidence: jest.fn(),
      embed: jest.fn(),
    } as unknown as GroqAiProvider;
    return { provider: new CompositeAiProvider(gemini, groq), gemini, groq };
  };

  const controls = [{ code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' }];
  const coverageInput = {
    control: { code: 'AC-01', title: 'Access reviews', description: 'Quarterly access reviews' },
    candidateChunks: [{ index: 0, content: 'we review all access grants every quarter' }],
  };

  it('routes checkControlCoverage to Groq, not Gemini', async () => {
    const { provider, gemini, groq } = buildProvider();

    const result = await provider.checkControlCoverage(coverageInput);

    expect(result).toEqual({ covered: true, reasoning: 'groq said so', citedChunkIndex: 0 });
    expect(groq.checkControlCoverage).toHaveBeenCalledTimes(1);
    expect(groq.checkControlCoverage).toHaveBeenCalledWith(coverageInput);
    expect((gemini as unknown as { checkControlCoverage: jest.Mock }).checkControlCoverage).not.toHaveBeenCalled();
  });

  it('routes classifyEvidence to Gemini, not Groq', async () => {
    const { provider, gemini, groq } = buildProvider();
    const input = { mimeType: 'text/plain', content: 'we reviewed access quarterly', controls };

    const result = await provider.classifyEvidence(input);

    expect(result).toEqual({ suggestedControlCode: 'AC-01', confidence: 0.9, reasoning: 'gemini said so' });
    expect(gemini.classifyEvidence).toHaveBeenCalledTimes(1);
    expect(gemini.classifyEvidence).toHaveBeenCalledWith(input);
    expect(groq.classifyEvidence).not.toHaveBeenCalled();
  });

  it('routes embed to Gemini (the local/bundled model), not Groq', async () => {
    const { provider, gemini, groq } = buildProvider();

    const result = await provider.embed('some control description');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(gemini.embed).toHaveBeenCalledTimes(1);
    expect(gemini.embed).toHaveBeenCalledWith('some control description');
    expect(groq.embed).not.toHaveBeenCalled();
  });
});

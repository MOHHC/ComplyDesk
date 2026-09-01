import { embedWithPipeline } from './local-embedding';

describe('embedWithPipeline', () => {
  it('calls the pipeline with mean pooling and normalization, and returns a plain number array', async () => {
    const fakePipeline = jest.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });

    const result = await embedWithPipeline(fakePipeline, 'some policy text');

    expect(fakePipeline).toHaveBeenCalledWith('some policy text', { pooling: 'mean', normalize: true });
    expect(Array.isArray(result)).toBe(true);
    expect(result.map((n) => Math.round(n * 10) / 10)).toEqual([0.1, 0.2, 0.3]);
  });
});

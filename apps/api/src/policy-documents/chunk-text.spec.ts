import { chunkText } from './chunk-text';

describe('chunkText', () => {
  it('returns an empty array for empty/whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('returns a single chunk when the text fits within one chunk size', () => {
    const text = 'a'.repeat(1000);
    expect(chunkText(text)).toEqual([text]);
  });

  it('splits long text into overlapping chunks that together cover the whole input', () => {
    const text = 'a'.repeat(5000) + 'b'.repeat(5000);
    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk after the first starts inside the previous chunk's
    // tail (overlap), and the final chunk reaches the end of the input.
    for (let i = 1; i < chunks.length; i += 1) {
      const prevEndsWith = chunks[i - 1].slice(-100);
      expect(chunks[i].startsWith(prevEndsWith.slice(0, 50))).toBe(
        text.includes(prevEndsWith.slice(0, 50), text.indexOf(chunks[i - 1])),
      );
    }
    expect(chunks[chunks.length - 1].endsWith('b')).toBe(true);
  });
});

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
    // Real constants from chunk-text.ts (kept in sync deliberately, not
    // re-derived from the chunker's own output): a 3200-char chunk size
    // with a 400-char overlap.
    const CHUNK_SIZE_CHARS = 3200;
    const OVERLAP_CHARS = 400;

    // Distinguishable content: a repeating digit sequence '0123456789...'
    // so every 1-char position in the 10,000-char input has a unique
    // "signature" within any 10-char window — unlike a homogeneous run
    // of one character, a slice of this text can only match the input
    // at the position it actually came from.
    let text = '';
    for (let i = 0; i < 10000; i += 1) {
      text += String(i % 10);
    }
    const chunks = chunkText(text);

    // Exact chunk count and sizes for this input, derived from the
    // documented sliding-window algorithm: chunk 0 is [0, 3200), each
    // subsequent chunk starts 400 chars before the previous one ended,
    // and the last chunk is whatever remains.
    expect(chunks.length).toBe(4);
    expect(chunks[0].length).toBe(CHUNK_SIZE_CHARS);
    expect(chunks[1].length).toBe(CHUNK_SIZE_CHARS);
    expect(chunks[2].length).toBe(CHUNK_SIZE_CHARS);
    // start positions: 0, 2800, 5600, 8400 (each += CHUNK_SIZE_CHARS -
    // OVERLAP_CHARS); the last chunk runs from 8400 to the end (10000).
    expect(chunks[3].length).toBe(10000 - 8400);

    // Literal overlap contract: each chunk's last OVERLAP_CHARS chars
    // equal the next chunk's first OVERLAP_CHARS chars.
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].slice(0, OVERLAP_CHARS)).toBe(chunks[i - 1].slice(-OVERLAP_CHARS));
    }

    // The whole input is covered: chunks reconstruct the original text
    // when overlaps are stripped.
    let reconstructed = chunks[0];
    for (let i = 1; i < chunks.length; i += 1) {
      reconstructed += chunks[i].slice(OVERLAP_CHARS);
    }
    expect(reconstructed).toBe(text);
  });
});

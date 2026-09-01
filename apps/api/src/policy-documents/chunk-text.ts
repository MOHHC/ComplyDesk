// ~4 chars/token is a rough but serviceable approximation without
// pulling in a full tokenizer just for chunk sizing.
const CHUNK_SIZE_CHARS = 3200; // ~800 tokens
const OVERLAP_CHARS = 400; // ~100 tokens

export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= CHUNK_SIZE_CHARS) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end === trimmed.length) break;
    start = end - OVERLAP_CHARS;
  }
  return chunks;
}

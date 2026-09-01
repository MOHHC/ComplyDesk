import { PDFParse } from 'pdf-parse';

const MIN_EXTRACTED_TEXT_LENGTH = 9;

export interface ExtractedText {
  text: string;
  hasText: boolean;
}

/**
 * Shared by evidence classification and policy document processing.
 * PDFs with no text layer (a scanned image with no OCR run) come back
 * with empty/near-empty text — hasText: false lets callers skip the LLM
 * call entirely rather than send it nothing, per the spec's decision not
 * to add an OCR fallback in this phase.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<ExtractedText> {
  if (mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText({ pageJoiner: '' });
    const trimmed = result.text.trim();
    await parser.destroy();
    return { text: trimmed, hasText: trimmed.length >= MIN_EXTRACTED_TEXT_LENGTH };
  }
  const text = buffer.toString('utf-8').trim();
  return { text, hasText: text.length >= MIN_EXTRACTED_TEXT_LENGTH };
}

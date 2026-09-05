import { extractText } from './extract-text';

describe('extractText', () => {
  it('extracts plain text directly for non-PDF mimeTypes', async () => {
    const result = await extractText(Buffer.from('hello policy text'), 'text/plain');
    expect(result).toEqual({ text: 'hello policy text', hasText: true });
  });

  it('reports hasText: false for near-empty content', async () => {
    const result = await extractText(Buffer.from('  '), 'text/plain');
    expect(result.hasText).toBe(false);
  });

  it('extracts text from a real PDF buffer via pdf-parse', async () => {
    // A minimal single-page PDF containing the text "Hello PDF", built
    // by hand rather than fixture-loaded so the test has no external
    // binary dependency.
    const pdfBuffer = Buffer.from(
      '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 200 100]/Contents 5 0 R>>endobj\n' +
        '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
        '5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 10 50 Td (Hello PDF) Tj ET\nendstream endobj\n' +
        'trailer<</Root 1 0 R>>',
    );
    const result = await extractText(pdfBuffer, 'application/pdf');
    expect(result.text).toContain('Hello PDF');
    expect(result.hasText).toBe(true);
  });

  it('reports hasText: false for a PDF with no extractable text layer', async () => {
    const emptyPdf = Buffer.from(
      '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R>>endobj\n' +
        '4 0 obj<</Length 0>>stream\nendstream endobj\n' +
        'trailer<</Root 1 0 R>>',
    );
    const result = await extractText(emptyPdf, 'application/pdf');
    expect(result.hasText).toBe(false);
  });
});

export interface ControlSummary {
  code: string;
  title: string;
  description: string;
}

export interface ChunkSummary {
  // Position of this chunk within the candidate list passed to
  // checkControlCoverage, NOT a document-relative chunk id — a
  // document-relative index is ambiguous once more than one document
  // contributes candidates (every document's chunks restart at 0).
  // CoverageResult.citedChunkIndex is expected back in these same terms.
  index: number;
  content: string;
}

export interface ClassificationResult {
  suggestedControlCode: string | null;
  confidence: number;
  reasoning: string;
}

export interface CoverageResult {
  covered: boolean;
  reasoning: string;
  citedChunkIndex: number | null;
}

/**
 * Provider-agnostic boundary for every external-AI call in the app.
 * GeminiAiProvider is the real implementation (Gemini for reasoning,
 * a local model for embeddings); FakeAiProvider is the deterministic
 * test double swapped in via the AI_PROVIDER DI token so no test ever
 * makes a real network call or loads real model weights.
 */
export interface AiProvider {
  classifyEvidence(input: {
    mimeType: string;
    content: Buffer | string;
    controls: ControlSummary[];
  }): Promise<ClassificationResult>;

  embed(text: string): Promise<number[]>;

  checkControlCoverage(input: {
    control: ControlSummary;
    candidateChunks: ChunkSummary[];
  }): Promise<CoverageResult>;
}

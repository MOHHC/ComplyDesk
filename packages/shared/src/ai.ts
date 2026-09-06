export type ClassificationReviewStatus = "PENDING" | "CONFIRMED" | "OVERRIDDEN" | "DISMISSED";
export type ClassificationDecision = "confirm" | "override" | "dismiss";

/**
 * A control as it appears nested inside another resource (a
 * classification's suggestion, a gap-analysis result) via a plain Prisma
 * `include`. Deliberately not the `Control` type from ./controls — that
 * type's `status`/`lastEvidenceAt` are computed by ControlsService at
 * request time, not raw columns, and are never present here.
 */
export interface ControlRef {
  id: string;
  code: string;
  category: string;
  title: string;
  description: string;
}

export interface EvidenceClassification {
  id: string;
  evidenceId: string;
  suggestedControlId: string | null;
  suggestedControl: ControlRef | null;
  confidence: number;
  reasoning: string;
  reviewStatus: ClassificationReviewStatus;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export type PolicyDocStatus = "PROCESSING" | "READY" | "FAILED";

export interface PolicyDocument {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  status: PolicyDocStatus;
  uploadedById: string;
  createdAt: string;
}

export interface PolicyChunkRef {
  id: string;
  chunkIndex: number;
  content: string;
  document: { id: string; fileName: string };
}

export interface GapAnalysisResult {
  id: string;
  runId: string;
  controlId: string;
  covered: boolean;
  reasoning: string;
  citationChunkId: string | null;
  control: ControlRef;
  citationChunk: PolicyChunkRef | null;
}

export interface GapAnalysisReport {
  runId: string;
  createdAt: string;
  results: GapAnalysisResult[];
}

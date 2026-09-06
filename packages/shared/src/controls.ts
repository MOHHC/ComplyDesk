import type { Role } from "./roles";
import type { EvidenceClassification } from "./ai";

export type ControlStatus = "no_evidence" | "has_evidence" | "evidence_expired";

export interface Control {
  id: string;
  code: string;
  category: string;
  title: string;
  description: string;
  evidenceGuidance: string;
  refreshIntervalDays: number;
  status: ControlStatus;
  lastEvidenceAt: string | null;
}

export interface Evidence {
  id: string;
  controlId: string;
  uploadedById: string;
  notes: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  collectedAt: string;
  downloadUrl: string;
  classification: EvidenceClassification | null;
}

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

export interface Task {
  id: string;
  controlId: string | null;
  assigneeId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: string | null;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface ReadinessSummary {
  totalControls: number;
  controlsWithValidEvidencePercent: number;
  controlsMissingEvidence: number;
  evidenceExpiringSoon: number;
}

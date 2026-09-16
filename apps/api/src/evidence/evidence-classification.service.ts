import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { extractText } from '../common/extract-text';
import { ObjectStorageService } from '../storage/object-storage.service';
import { AI_PROVIDER } from '../ai/ai-provider.token';
import { AiProvider } from '../ai/ai-provider.interface';
import { ClassificationDecision } from './dto/review-classification.dto';

const MAX_STORED_ERROR_MESSAGE_LENGTH = 500;

/**
 * Classification is best-effort annotation on top of an evidence upload
 * that has already succeeded — an AI provider failure here must never fail
 * the upload itself (see EvidenceService.upload).
 *
 * "Best-effort" used to mean a failed attempt left no row at all — the
 * same shape as never having attempted classification in the first place.
 * A real user report (a genuine Gemini 503) showed why that's wrong: the
 * UI had no way to tell "we tried and it broke" apart from "nothing ever
 * ran", and no way to retry either. Every attempt — from upload or from
 * retry() — now always ends in a persisted row via persistOutcome(),
 * tagged COMPLETED or FAILED, so the two are never confused again.
 *
 * review() and retry() also carry no per-user ownership check, for the
 * same reason as EvidenceService.upload: controls/evidence are tenant-wide
 * with no assignee concept, so any CONTRIBUTOR may act on any control's
 * evidence. Confirmed intended, not a missing "own work only" check.
 */
@Injectable()
export class EvidenceClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly storage: ObjectStorageService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  /**
   * Runs the AI call and persists the result — COMPLETED with whatever
   * the provider decided (including a reasoned "nothing fits", which is
   * a successful outcome, not a failure), or FAILED with the provider's
   * own error message if the call itself broke. Never throws for a
   * provider failure; only a DB error persisting the row escapes, which
   * callers already treat as a last-resort, log-and-continue case.
   */
  async classify(evidenceId: string, controlId: string, fileBuffer: Buffer, mimeType: string) {
    const tx = this.tx();
    const tenantId = this.cls.get('tenantId')!;
    const controls = await tx.control.findMany({
      where: {},
      select: { code: true, title: true, description: true },
    });

    try {
      let suggestion: { suggestedControlCode: string | null; confidence: number; reasoning: string };

      if (mimeType.startsWith('image/')) {
        suggestion = await this.ai.classifyEvidence({ mimeType, content: fileBuffer, controls });
      } else {
        const { text, hasText } = await extractText(fileBuffer, mimeType);
        suggestion = hasText
          ? await this.ai.classifyEvidence({ mimeType, content: text, controls })
          : { suggestedControlCode: null, confidence: 0, reasoning: 'no extractable text' };
      }

      const suggestedControl = suggestion.suggestedControlCode
        ? await tx.control.findFirst({ where: { code: suggestion.suggestedControlCode } })
        : null;

      return this.persistOutcome(tx, tenantId, evidenceId, {
        status: 'COMPLETED',
        suggestedControlId: suggestedControl?.id ?? null,
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.persistOutcome(tx, tenantId, evidenceId, {
        status: 'FAILED',
        suggestedControlId: null,
        confidence: 0,
        reasoning: `Classification failed: ${message.slice(0, MAX_STORED_ERROR_MESSAGE_LENGTH)}`,
      });
    }
  }

  /** Same "always ends in a persisted row" contract as classify(), for
   * the one case that never reaches an AI call at all: the tenant's
   * hourly classification budget was already spent (see
   * EvidenceService.upload). A distinct reasoning string, but the same
   * FAILED status and the same retry path, since from the user's side
   * both are just "no result yet, try again". */
  async recordSkipped(evidenceId: string, controlId: string) {
    const tx = this.tx();
    const tenantId = this.cls.get('tenantId')!;
    return this.persistOutcome(tx, tenantId, evidenceId, {
      status: 'FAILED',
      suggestedControlId: null,
      confidence: 0,
      reasoning: 'Skipped — this workspace has reached its hourly AI classification limit. Try again in a bit.',
    });
  }

  /**
   * Re-runs classification for an evidence file that already exists —
   * failed, skipped, or even previously completed — re-reading its bytes
   * from object storage rather than requiring the original upload buffer
   * still be in memory. Rate limiting for this path is enforced by
   * TenantRateLimitGuard's @RateLimit('classification') on the retry
   * route (a throwing 429, appropriate for a single explicit user
   * action), not repeated here.
   */
  async retry(controlId: string, evidenceId: string) {
    const tx = this.tx();
    const evidence = await tx.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.controlId !== controlId) {
      throw new NotFoundException('Evidence not found');
    }

    const fileBuffer = await this.storage.download(evidence.fileKey);
    return this.classify(evidenceId, controlId, fileBuffer, evidence.mimeType);
  }

  /** Single write path for both classify() and recordSkipped(): upsert
   * keyed on evidenceId (unique per evidence), so a retry replaces the
   * prior outcome in place instead of colliding with it. Any earlier
   * human review decision is reset — a fresh AI result invalidates a
   * review made against the old one, whether that was a real suggestion
   * or a failure message. */
  private persistOutcome(
    tx: ReturnType<EvidenceClassificationService['tx']>,
    tenantId: string,
    evidenceId: string,
    outcome: {
      status: 'COMPLETED' | 'FAILED';
      suggestedControlId: string | null;
      confidence: number;
      reasoning: string;
    },
  ) {
    return tx.evidenceClassification.upsert({
      where: { evidenceId },
      create: {
        tenantId,
        evidenceId,
        ...outcome,
      },
      update: {
        ...outcome,
        reviewStatus: 'PENDING',
        reviewedById: null,
        reviewedAt: null,
      },
    });
  }

  async review(controlId: string, evidenceId: string, decision: ClassificationDecision) {
    const tx = this.tx();
    const classification = await tx.evidenceClassification.findUnique({ where: { evidenceId } });
    if (!classification) {
      throw new NotFoundException('No classification found for this evidence');
    }

    const userId = this.cls.get('userId')!;
    const reviewStatus = decision === 'confirm' ? 'CONFIRMED' : decision === 'dismiss' ? 'DISMISSED' : 'OVERRIDDEN';

    if (decision === 'override') {
      if (!classification.suggestedControlId) {
        throw new BadRequestException('No suggested control to move this evidence to');
      }
      await tx.evidence.update({
        where: { id: evidenceId },
        data: { controlId: classification.suggestedControlId },
      });
    }

    return tx.evidenceClassification.update({
      where: { evidenceId },
      data: { reviewStatus, reviewedById: userId, reviewedAt: new Date() },
    });
  }
}

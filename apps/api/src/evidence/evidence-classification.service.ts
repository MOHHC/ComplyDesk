import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { extractText } from '../common/extract-text';
import { AI_PROVIDER } from '../ai/ai-provider.token';
import { AiProvider } from '../ai/ai-provider.interface';
import { ClassificationDecision } from './dto/review-classification.dto';

/**
 * Classification is best-effort annotation on top of an evidence upload
 * that has already succeeded — a Claude failure here must never fail
 * the upload itself (see EvidenceService.upload).
 */
@Injectable()
export class EvidenceClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  async classify(evidenceId: string, controlId: string, fileBuffer: Buffer, mimeType: string) {
    const tx = this.tx();
    const tenantId = this.cls.get('tenantId')!;
    const controls = await tx.control.findMany({
      where: {},
      select: { code: true, title: true, description: true },
    });

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

    return tx.evidenceClassification.create({
      data: {
        tenantId,
        evidenceId,
        suggestedControlId: suggestedControl?.id ?? null,
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
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

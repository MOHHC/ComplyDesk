import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { ObjectStorageService } from '../storage/object-storage.service';
import { EvidenceClassificationService } from './evidence-classification.service';
import { TenantRateLimitGuard } from '../rate-limit/tenant-rate-limit.guard';

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly storage: ObjectStorageService,
    private readonly classification: EvidenceClassificationService,
    private readonly rateLimit: TenantRateLimitGuard,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  /**
   * Uploads to object storage before inserting the metadata row, not the
   * other way around: there's no transaction spanning Postgres and S3, so
   * one of the two can end up out of sync if the other step fails. This
   * ordering fails toward an orphaned, harmless object in the bucket
   * (nothing references it, cleanup is cosmetic) rather than a database
   * row pointing at a file that doesn't exist, which would break every
   * future download of it.
   */
  async upload(
    controlId: string,
    file: Express.Multer.File,
    notes: string | undefined,
  ) {
    const tx = this.tx();
    const control = await tx.control.findUnique({ where: { id: controlId } });
    if (!control) {
      throw new NotFoundException('Control not found');
    }

    const tenantId = this.cls.get('tenantId')!;
    const userId = this.cls.get('userId')!;
    const key = this.storage.buildKey(tenantId, controlId, file.originalname);
    await this.storage.upload(key, file.buffer, file.mimetype);

    const evidence = await tx.evidence.create({
      data: {
        tenantId,
        controlId,
        uploadedById: userId,
        notes,
        fileKey: key,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
    });

    let classificationRow = null;
    try {
      // The classification rate limit must degrade classification, not
      // reject the upload: losing a customer's evidence file because an
      // annotation budget ran out is wrong for a product whose core job
      // is evidence collection (spec section B). When the tenant's
      // hourly classification budget is spent, skip the AI call
      // entirely and store no classification — same shape as the
      // existing best-effort failure path below.
      if (this.rateLimit.tryConsume('classification', tenantId)) {
        classificationRow = await this.classification.classify(evidence.id, controlId, file.buffer, file.mimetype);
      } else {
        this.logger.warn(
          `Skipping evidence classification for evidenceId=${evidence.id} controlId=${controlId} tenantId=${tenantId}: hourly classification rate limit reached`,
        );
      }
    } catch (error) {
      // Best-effort: classification failing must never fail the upload
      // that already succeeded. No retry — the review endpoint has
      // nothing to review until a future upload succeeds in classifying.
      this.logger.error(
        `Evidence classification failed for evidenceId=${evidence.id} controlId=${controlId} tenantId=${tenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return { ...evidence, classification: classificationRow };
  }

  async listForControl(controlId: string) {
    const tx = this.tx();
    const control = await tx.control.findUnique({ where: { id: controlId } });
    if (!control) {
      throw new NotFoundException('Control not found');
    }

    const rows = await tx.evidence.findMany({
      where: { controlId },
      orderBy: { collectedAt: 'desc' },
      include: { classification: { include: { suggestedControl: true } } },
    });

    return Promise.all(
      rows.map(async (row: (typeof rows)[number]) => ({
        ...row,
        downloadUrl: await this.storage.getDownloadUrl(row.fileKey),
      })),
    );
  }
}

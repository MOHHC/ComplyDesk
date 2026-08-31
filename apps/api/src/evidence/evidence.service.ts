import { Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { ObjectStorageService } from '../storage/object-storage.service';

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly storage: ObjectStorageService,
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

    return tx.evidence.create({
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
    });

    return Promise.all(
      rows.map(async (row: (typeof rows)[number]) => ({
        ...row,
        downloadUrl: await this.storage.getDownloadUrl(row.fileKey),
      })),
    );
  }
}

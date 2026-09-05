import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { ObjectStorageService } from '../storage/object-storage.service';
import { extractText } from '../common/extract-text';
import { chunkText } from './chunk-text';
import { AI_PROVIDER } from '../ai/ai-provider.token';
import { AiProvider } from '../ai/ai-provider.interface';

const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'text/plain', 'text/markdown']);

@Injectable()
export class PolicyDocumentsService {
  private readonly logger = new Logger(PolicyDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly storage: ObjectStorageService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  async upload(file: Express.Multer.File) {
    if (!ACCEPTED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}". Only PDF, plain text, and Markdown are accepted.`,
      );
    }

    const tx = this.tx();
    const tenantId = this.cls.get('tenantId')!;
    const userId = this.cls.get('userId')!;
    const key = this.storage.buildKey(tenantId, 'policy-docs', file.originalname);
    await this.storage.upload(key, file.buffer, file.mimetype);

    const document = await tx.policyDocument.create({
      data: {
        tenantId,
        fileKey: key,
        fileName: file.originalname,
        mimeType: file.mimetype,
        uploadedById: userId,
        status: 'PROCESSING',
      },
    });

    try {
      const { text, hasText } = await extractText(file.buffer, file.mimetype);
      if (!hasText) {
        return tx.policyDocument.update({ where: { id: document.id }, data: { status: 'FAILED' } });
      }

      const chunks = chunkText(text);
      for (let i = 0; i < chunks.length; i += 1) {
        const embedding = await this.ai.embed(chunks[i]);
        await tx.$executeRaw`
          INSERT INTO "PolicyChunk" ("id", "tenantId", "documentId", "chunkIndex", "content", "embedding")
          VALUES (gen_random_uuid()::text, ${tenantId}, ${document.id}, ${i}, ${chunks[i]}, ${JSON.stringify(embedding)}::vector)
        `;
      }

      return tx.policyDocument.update({ where: { id: document.id }, data: { status: 'READY' } });
    } catch (error) {
      this.logger.error(
        `Policy document processing failed for documentId=${document.id} tenantId=${tenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      return tx.policyDocument.update({ where: { id: document.id }, data: { status: 'FAILED' } });
    }
  }

  async list() {
    const tx = this.tx();
    return tx.policyDocument.findMany({ orderBy: { createdAt: 'desc' } });
  }
}

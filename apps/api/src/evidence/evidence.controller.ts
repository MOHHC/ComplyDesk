import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { TenantRateLimitGuard } from '../rate-limit/tenant-rate-limit.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { DemoReadOnlyGuard } from '../common/demo-tenant.guard';
import { EvidenceService } from './evidence.service';
import { EvidenceClassificationService } from './evidence-classification.service';
import { UploadEvidenceDto } from './dto/upload-evidence.dto';
import { ReviewClassificationDto } from './dto/review-classification.dto';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller('controls/:controlId/evidence')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRateLimitGuard)
export class EvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly classification: EvidenceClassificationService,
  ) {}

  // Any CONTRIBUTOR, any control — controls/evidence are tenant-wide with
  // no assignee, unlike Task. See EvidenceService for the full note.
  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.CONTRIBUTOR)
  @UseGuards(DemoReadOnlyGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  @Audit({ action: 'evidence.upload', model: 'evidence' })
  upload(
    @Param('controlId') controlId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadEvidenceDto,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.evidence.upload(controlId, file, dto.notes);
  }

  // No @Roles(): any member, including AUDITOR, can view/download evidence.
  @Get()
  list(@Param('controlId') controlId: string) {
    return this.evidence.listForControl(controlId);
  }

  @Patch(':evidenceId/classification')
  @Roles(Role.OWNER, Role.ADMIN, Role.CONTRIBUTOR)
  @Audit({ action: 'evidence.reclassify', model: 'evidenceClassification', idParam: 'evidenceId' })
  review(
    @Param('controlId') controlId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() dto: ReviewClassificationDto,
  ) {
    return this.classification.review(controlId, evidenceId, dto.decision);
  }

  // Same roles as upload — retrying is re-attempting the same AI step
  // upload already tries best-effort, so whoever could have uploaded
  // (and so triggered classification in the first place) can retry it.
  // Rate-limited the same as any other AI-calling route, but as a
  // throwing guard here rather than upload's non-throwing tryConsume:
  // this is one explicit user action, not a step that must degrade
  // gracefully underneath something else that already succeeded.
  @Post(':evidenceId/classification/retry')
  @Roles(Role.OWNER, Role.ADMIN, Role.CONTRIBUTOR)
  @UseGuards(DemoReadOnlyGuard)
  @RateLimit('classification')
  @Audit({ action: 'evidence.retryClassification', model: 'evidenceClassification', idParam: 'evidenceId' })
  retryClassification(@Param('controlId') controlId: string, @Param('evidenceId') evidenceId: string) {
    return this.classification.retry(controlId, evidenceId);
  }
}

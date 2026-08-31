import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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
import { EvidenceService } from './evidence.service';
import { UploadEvidenceDto } from './dto/upload-evidence.dto';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller('controls/:controlId/evidence')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.CONTRIBUTOR)
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
}

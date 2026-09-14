import {
  BadRequestException,
  Controller,
  Get,
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
import { DemoReadOnlyGuard } from '../common/demo-tenant.guard';
import { PolicyDocumentsService } from './policy-documents.service';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB, matching evidence uploads

@Controller('policy-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PolicyDocumentsController {
  constructor(private readonly policyDocuments: PolicyDocumentsService) {}

  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.CONTRIBUTOR)
  @UseGuards(DemoReadOnlyGuard)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  @Audit({ action: 'policydocument.upload' })
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.policyDocuments.upload(file);
  }

  @Get()
  list() {
    return this.policyDocuments.list();
  }
}

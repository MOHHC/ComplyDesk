import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AiModule } from '../ai/ai.module';
import { PolicyDocumentsController } from './policy-documents.controller';
import { PolicyDocumentsService } from './policy-documents.service';

@Module({
  imports: [StorageModule, AiModule],
  controllers: [PolicyDocumentsController],
  providers: [PolicyDocumentsService],
})
export class PolicyDocumentsModule {}

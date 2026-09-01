import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AiModule } from '../ai/ai.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import { EvidenceClassificationService } from './evidence-classification.service';

@Module({
  imports: [StorageModule, AiModule, RateLimitModule],
  controllers: [EvidenceController],
  providers: [EvidenceService, EvidenceClassificationService],
})
export class EvidenceModule {}

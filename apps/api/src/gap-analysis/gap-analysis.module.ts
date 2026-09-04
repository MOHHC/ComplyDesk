import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { GapAnalysisController } from './gap-analysis.controller';
import { GapAnalysisService } from './gap-analysis.service';

@Module({
  imports: [AiModule, RateLimitModule],
  controllers: [GapAnalysisController],
  providers: [GapAnalysisService],
})
export class GapAnalysisModule {}

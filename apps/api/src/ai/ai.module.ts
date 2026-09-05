import { Module } from '@nestjs/common';
import { AI_PROVIDER } from './ai-provider.token';
import { GeminiAiProvider } from './gemini-ai-provider.service';

@Module({
  providers: [{ provide: AI_PROVIDER, useClass: GeminiAiProvider }],
  exports: [AI_PROVIDER],
})
export class AiModule {}

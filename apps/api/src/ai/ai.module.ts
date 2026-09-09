import { Module } from '@nestjs/common';
import { AI_PROVIDER } from './ai-provider.token';
import { GeminiAiProvider } from './gemini-ai-provider.service';
import { GroqAiProvider } from './groq-ai-provider.service';
import { CompositeAiProvider } from './composite-ai-provider.service';

@Module({
  providers: [
    GeminiAiProvider,
    GroqAiProvider,
    { provide: AI_PROVIDER, useClass: CompositeAiProvider },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}

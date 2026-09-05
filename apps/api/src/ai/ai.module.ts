import { Module } from '@nestjs/common';
import { AI_PROVIDER } from './ai-provider.token';
import { ClaudeAiProvider } from './claude-ai-provider.service';

@Module({
  providers: [{ provide: AI_PROVIDER, useClass: ClaudeAiProvider }],
  exports: [AI_PROVIDER],
})
export class AiModule {}

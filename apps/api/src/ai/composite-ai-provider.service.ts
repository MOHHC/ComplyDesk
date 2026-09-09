import { Injectable } from '@nestjs/common';
import {
  AiProvider,
  ChunkSummary,
  ClassificationResult,
  ControlSummary,
  CoverageResult,
} from './ai-provider.interface';
import { GeminiAiProvider } from './gemini-ai-provider.service';
import { GroqAiProvider } from './groq-ai-provider.service';

/**
 * The one class actually bound to AI_PROVIDER — everything else (Nest
 * DI, GapAnalysisService, EvidenceClassificationService) depends on the
 * AiProvider interface without knowing two different providers sit
 * behind it. Routing:
 *   - classifyEvidence -> Gemini, which supports vision (image evidence)
 *   - embed             -> Gemini's local/bundled embedding model
 *   - checkControlCoverage -> Groq, text-only work that benefits from
 *     Groq's much higher free-tier throughput and speed
 *
 * AiProvider itself is unchanged — this class is the thing that changed
 * underneath it, not the contract callers see.
 */
@Injectable()
export class CompositeAiProvider implements AiProvider {
  constructor(
    private readonly gemini: GeminiAiProvider,
    private readonly groq: GroqAiProvider,
  ) {}

  classifyEvidence(input: {
    mimeType: string;
    content: Buffer | string;
    controls: ControlSummary[];
  }): Promise<ClassificationResult> {
    return this.gemini.classifyEvidence(input);
  }

  embed(text: string): Promise<number[]> {
    return this.gemini.embed(text);
  }

  checkControlCoverage(input: {
    control: ControlSummary;
    candidateChunks: ChunkSummary[];
  }): Promise<CoverageResult> {
    return this.groq.checkControlCoverage(input);
  }
}

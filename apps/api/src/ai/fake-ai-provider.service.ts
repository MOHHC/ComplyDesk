import { Injectable } from '@nestjs/common';
import {
  AiProvider,
  ChunkSummary,
  ClassificationResult,
  ControlSummary,
  CoverageResult,
} from './ai-provider.interface';

/**
 * Deterministic test double — no network call, no local model load.
 * Fixture conventions (used by e2e specs to steer specific outcomes):
 *  - classifyEvidence: content containing "CLASSIFY_AS:<code>" suggests
 *    that control code; otherwise it suggests the first control given.
 *  - embed: a fixed-length pseudo-embedding derived from a simple string
 *    hash, so identical text always embeds identically.
 *  - checkControlCoverage: a control description containing
 *    "COVERED:<n>" is reported covered, citing candidate position <n> —
 *    i.e. `n` is an index into the `candidateChunks` array passed in
 *    (ChunkSummary.index), not any document-relative chunk id; otherwise
 *    not covered.
 */
@Injectable()
export class FakeAiProvider implements AiProvider {
  async classifyEvidence(input: {
    mimeType: string;
    content: Buffer | string;
    controls: ControlSummary[];
  }): Promise<ClassificationResult> {
    const text = typeof input.content === 'string' ? input.content : input.content.toString('utf-8');
    const match = text.match(/CLASSIFY_AS:(\S+)/);
    const code = match ? match[1] : (input.controls[0]?.code ?? null);
    return { suggestedControlCode: code, confidence: code ? 0.9 : 0, reasoning: 'fake provider suggestion' };
  }

  async embed(text: string): Promise<number[]> {
    const DIMENSIONS = 384;
    const vector = new Array<number>(DIMENSIONS).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      const bucket = (text.charCodeAt(i) * (i + 1)) % DIMENSIONS;
      vector[bucket] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }

  async checkControlCoverage(input: {
    control: ControlSummary;
    candidateChunks: ChunkSummary[];
  }): Promise<CoverageResult> {
    const match = input.control.description.match(/COVERED:(\d+)/);
    if (!match) {
      return { covered: false, reasoning: 'fake provider: no coverage found', citedChunkIndex: null };
    }
    const citedChunkIndex = Number(match[1]);
    return { covered: true, reasoning: 'fake provider: coverage found', citedChunkIndex };
  }
}

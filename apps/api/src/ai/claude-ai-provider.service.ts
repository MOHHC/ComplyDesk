import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiProvider,
  ChunkSummary,
  ClassificationResult,
  ControlSummary,
  CoverageResult,
} from './ai-provider.interface';

const CLASSIFICATION_MODEL = 'claude-haiku-4-5-20251001';
const COVERAGE_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;

const CLASSIFICATION_TOOL = {
  name: 'submit_classification',
  description: 'Submit which control this evidence most likely satisfies.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestedControlCode: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['suggestedControlCode', 'confidence', 'reasoning'],
  },
};

const COVERAGE_TOOL = {
  name: 'submit_coverage',
  description: 'Submit whether the candidate policy chunks address the control.',
  input_schema: {
    type: 'object' as const,
    properties: {
      covered: { type: 'boolean' },
      reasoning: { type: 'string' },
      citedChunkIndex: { type: ['number', 'null'] },
    },
    required: ['covered', 'reasoning', 'citedChunkIndex'],
  },
};

function describeControls(controls: ControlSummary[]): string {
  return controls.map((c) => `- ${c.code}: ${c.title} — ${c.description}`).join('\n');
}

/**
 * Real reasoning implementation. embed() is intentionally not
 * implemented here — see LocalEmbeddingService (Task 5), mixed in via
 * composition so this class's tests never need to load a real model.
 */
@Injectable()
export class ClaudeAiProvider implements Pick<AiProvider, 'classifyEvidence' | 'checkControlCoverage'> {
  private readonly client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async classifyEvidence(input: {
    mimeType: string;
    content: Buffer | string;
    controls: ControlSummary[];
  }): Promise<ClassificationResult> {
    const prompt = `You are reviewing evidence uploaded against one of these compliance controls:\n${describeControls(
      input.controls,
    )}\n\nWhich control does this evidence most likely satisfy? If none clearly apply, say so.`;

    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = input.mimeType.startsWith('image/')
      ? [
          { type: 'text', text: prompt },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
              data: (input.content as Buffer).toString('base64'),
            },
          },
        ]
      : [{ type: 'text', text: `${prompt}\n\nEvidence content:\n${input.content}` }];

    const response = await this.client.messages.create({
      model: CLASSIFICATION_MODEL,
      max_tokens: MAX_TOKENS,
      tools: [CLASSIFICATION_TOOL],
      tool_choice: { type: 'tool', name: 'submit_classification' },
      messages: [{ role: 'user', content: contentBlocks }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
    );
    return toolUse?.input as ClassificationResult;
  }

  async checkControlCoverage(input: {
    control: ControlSummary;
    candidateChunks: ChunkSummary[];
  }): Promise<CoverageResult> {
    const chunkText = input.candidateChunks
      .map((c) => `[chunk ${c.index}] ${c.content}`)
      .join('\n\n');
    const prompt = `Control ${input.control.code}: ${input.control.title} — ${input.control.description}\n\nCandidate policy excerpts:\n${chunkText}\n\nDo these excerpts show this control is addressed? If yes, cite the chunk index that most directly supports it.`;

    const response = await this.client.messages.create({
      model: COVERAGE_MODEL,
      max_tokens: MAX_TOKENS,
      tools: [COVERAGE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_coverage' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
    );
    return toolUse?.input as CoverageResult;
  }
}

import { NotFoundException } from '@nestjs/common';
import { EvidenceClassificationService } from './evidence-classification.service';

describe('EvidenceClassificationService', () => {
  const buildService = () => {
    const prisma = {
      control: { findMany: jest.fn().mockResolvedValue([{ code: 'AC-01', title: 'x', description: 'y' }]) },
      evidenceClassification: { upsert: jest.fn((args: any) => ({ id: 'row-1', ...args.create, ...args.update })) },
      evidence: { findUnique: jest.fn() },
    } as any;
    const store = new Map<string, unknown>([['tenantId', 'tenant-1'], ['userId', 'user-1']]);
    const cls = {
      get: jest.fn((key: string) => store.get(key)),
    } as any;
    const storage = {
      download: jest.fn(),
    } as any;
    const ai = {
      classifyEvidence: jest.fn(),
    } as any;
    return {
      service: new EvidenceClassificationService(prisma, cls, storage, ai),
      prisma,
      storage,
      ai,
    };
  };

  describe('classify', () => {
    it('persists a COMPLETED row with the suggestion when the AI call succeeds', async () => {
      const { service, prisma, ai } = buildService();
      prisma.control.findFirst = jest.fn().mockResolvedValue({ id: 'control-1' });
      ai.classifyEvidence.mockResolvedValue({
        suggestedControlCode: 'AC-01',
        confidence: 0.9,
        reasoning: 'looks right',
      });

      const result = await service.classify('evidence-1', 'control-1', Buffer.from('some text'), 'text/plain');

      expect(result.status).toBe('COMPLETED');
      expect(result.suggestedControlId).toBe('control-1');
      const upsertArgs = prisma.evidenceClassification.upsert.mock.calls[0][0];
      expect(upsertArgs.create.status).toBe('COMPLETED');
      expect(upsertArgs.update.reviewStatus).toBe('PENDING');
    });

    it('persists a COMPLETED row with no suggestion for a reasoned no-match, not a failure', async () => {
      const { service, ai } = buildService();
      ai.classifyEvidence.mockResolvedValue({
        suggestedControlCode: null,
        confidence: 0.1,
        reasoning: 'nothing here matches a known control',
      });

      const result = await service.classify('evidence-1', 'control-1', Buffer.from('some text'), 'text/plain');

      expect(result.status).toBe('COMPLETED');
      expect(result.suggestedControlId).toBeNull();
      expect(result.reasoning).toContain('nothing here matches');
    });

    it('persists a FAILED row with the error message when the AI call throws', async () => {
      const { service, ai } = buildService();
      ai.classifyEvidence.mockRejectedValue(new Error('503 UNAVAILABLE: model overloaded'));

      const result = await service.classify('evidence-1', 'control-1', Buffer.from('some text'), 'text/plain');

      expect(result.status).toBe('FAILED');
      expect(result.suggestedControlId).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toContain('Classification failed');
      expect(result.reasoning).toContain('503 UNAVAILABLE');
    });

    it('truncates an excessively long error message rather than storing it whole', async () => {
      const { service, ai } = buildService();
      ai.classifyEvidence.mockRejectedValue(new Error('x'.repeat(2000)));

      const result = await service.classify('evidence-1', 'control-1', Buffer.from('some text'), 'text/plain');

      expect(result.reasoning.length).toBeLessThan(600);
    });
  });

  describe('recordSkipped', () => {
    it('persists a FAILED row explaining the rate limit, without calling the AI provider', async () => {
      const { service, ai } = buildService();
      const result = await service.recordSkipped('evidence-1', 'control-1');

      expect(ai.classifyEvidence).not.toHaveBeenCalled();
      expect(result.status).toBe('FAILED');
      expect(result.reasoning).toMatch(/hourly/i);
    });
  });

  describe('retry', () => {
    it('404s when the evidence does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.evidence.findUnique.mockResolvedValue(null);

      await expect(service.retry('control-1', 'evidence-1')).rejects.toThrow(NotFoundException);
    });

    it("404s when the evidence exists but belongs to a different control", async () => {
      const { service, prisma } = buildService();
      prisma.evidence.findUnique.mockResolvedValue({
        id: 'evidence-1',
        controlId: 'some-other-control',
        fileKey: 'key',
        mimeType: 'text/plain',
      });

      await expect(service.retry('control-1', 'evidence-1')).rejects.toThrow(NotFoundException);
    });

    it('re-downloads the stored file and re-runs classification, turning a prior FAILED result into COMPLETED', async () => {
      const { service, prisma, storage, ai } = buildService();
      prisma.evidence.findUnique.mockResolvedValue({
        id: 'evidence-1',
        controlId: 'control-1',
        fileKey: 'tenant-1/control-1/some-key.txt',
        mimeType: 'text/plain',
      });
      prisma.control.findFirst = jest.fn().mockResolvedValue({ id: 'control-1' });
      storage.download.mockResolvedValue(Buffer.from('the stored evidence content'));
      ai.classifyEvidence.mockResolvedValue({
        suggestedControlCode: 'AC-01',
        confidence: 0.85,
        reasoning: 'recovered on retry',
      });

      const result = await service.retry('control-1', 'evidence-1');

      expect(storage.download).toHaveBeenCalledWith('tenant-1/control-1/some-key.txt');
      expect(result.status).toBe('COMPLETED');
      expect(result.reasoning).toBe('recovered on retry');
    });
  });
});

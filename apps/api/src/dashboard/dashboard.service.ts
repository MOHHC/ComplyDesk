import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { computeControlStatus, getLatestEvidenceMap, isExpiringSoon } from '../controls/control-status';

export interface ReadinessSummary {
  totalControls: number;
  controlsWithValidEvidencePercent: number;
  controlsMissingEvidence: number;
  evidenceExpiringSoon: number;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  async readiness(): Promise<ReadinessSummary> {
    const tx = this.tx();
    const controls = await tx.control.findMany();
    const latestByControl = await getLatestEvidenceMap(
      tx,
      controls.map((c: (typeof controls)[number]) => c.id),
    );
    const now = new Date();

    let withValidEvidence = 0;
    let missing = 0;
    let expiringSoon = 0;

    for (const control of controls) {
      const lastEvidenceAt = latestByControl.get(control.id) ?? null;
      const status = computeControlStatus(control.refreshIntervalDays, lastEvidenceAt, now);
      if (status === 'has_evidence') withValidEvidence++;
      if (status === 'no_evidence') missing++;
      if (isExpiringSoon(control.refreshIntervalDays, lastEvidenceAt, now)) expiringSoon++;
    }

    const total = controls.length;
    return {
      totalControls: total,
      // Rounded to one decimal place rather than truncated, so e.g. 5/18
      // reads as 27.8% instead of a misleadingly precise-looking 27%.
      controlsWithValidEvidencePercent:
        total === 0 ? 0 : Math.round((withValidEvidence / total) * 1000) / 10,
      controlsMissingEvidence: missing,
      evidenceExpiringSoon: expiringSoon,
    };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { computeControlStatus, getLatestEvidenceMap } from './control-status';
import { ListControlsQueryDto } from './dto/list-controls-query.dto';

@Injectable()
export class ControlsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  async list(filter: ListControlsQueryDto) {
    const tx = this.tx();
    const controls = await tx.control.findMany({
      where: filter.category ? { category: filter.category } : undefined,
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });

    const latestByControl = await getLatestEvidenceMap(
      tx,
      controls.map((c) => c.id),
    );
    const now = new Date();
    const withStatus = controls.map((control) => {
      const lastEvidenceAt = latestByControl.get(control.id) ?? null;
      return {
        ...control,
        status: computeControlStatus(control.refreshIntervalDays, lastEvidenceAt, now),
        lastEvidenceAt,
      };
    });

    return filter.status ? withStatus.filter((c) => c.status === filter.status) : withStatus;
  }

  async findOne(id: string) {
    const tx = this.tx();
    const control = await tx.control.findUnique({ where: { id } });
    if (!control) {
      throw new NotFoundException('Control not found');
    }

    const latestByControl = await getLatestEvidenceMap(tx, [id]);
    const lastEvidenceAt = latestByControl.get(id) ?? null;
    return {
      ...control,
      status: computeControlStatus(control.refreshIntervalDays, lastEvidenceAt),
      lastEvidenceAt,
    };
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Role, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppClsStore } from '../common/cls-keys';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  private tx() {
    return this.cls.get('tenantTx') ?? this.prisma;
  }

  async create(dto: CreateTaskDto) {
    const tx = this.tx();
    const tenantId = this.cls.get('tenantId')!;

    const control = await tx.control.findUnique({ where: { id: dto.controlId } });
    if (!control) {
      throw new NotFoundException('Control not found');
    }
    const assigneeMembership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: dto.assigneeId } },
    });
    if (!assigneeMembership) {
      throw new BadRequestException('Assignee is not a member of this workspace');
    }

    return tx.task.create({
      data: {
        tenantId,
        controlId: dto.controlId,
        assigneeId: dto.assigneeId,
        title: dto.title,
        description: dto.description,
        dueDate: new Date(dto.dueDate),
      },
    });
  }

  async list(filter: ListTasksQueryDto) {
    const tx = this.tx();
    return tx.task.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
        ...(filter.controlId ? { controlId: filter.controlId } : {}),
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async findOne(id: string) {
    const tx = this.tx();
    const task = await tx.task.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  /** Full edit: reassign, retitle, change due date/description/status.
   * Reserved for OWNER/ADMIN at the controller — see updateStatus() for
   * the narrower self-service path CONTRIBUTOR gets instead. */
  async update(id: string, dto: UpdateTaskDto) {
    const tx = this.tx();
    const existing = await tx.task.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    if (dto.assigneeId && dto.assigneeId !== existing.assigneeId) {
      const tenantId = this.cls.get('tenantId')!;
      const assigneeMembership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: dto.assigneeId } },
      });
      if (!assigneeMembership) {
        throw new BadRequestException('Assignee is not a member of this workspace');
      }
    }

    return tx.task.update({
      where: { id },
      data: {
        assigneeId: dto.assigneeId,
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: dto.status,
      },
    });
  }

  /** OWNER/ADMIN can move any task; a CONTRIBUTOR can only move a task
   * assigned to themselves — the ownership check the RolesGuard's
   * per-route role list can't express, so it lives here instead. */
  async updateStatus(id: string, status: TaskStatus) {
    const tx = this.tx();
    const existing = await tx.task.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    const role = this.cls.get('role');
    const userId = this.cls.get('userId');
    if (role === Role.CONTRIBUTOR && existing.assigneeId !== userId) {
      throw new ForbiddenException('You can only update tasks assigned to you');
    }

    return tx.task.update({ where: { id }, data: { status } });
  }
}

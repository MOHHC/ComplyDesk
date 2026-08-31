import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { Audit } from '../audit/audit.decorator';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  @Audit({ action: 'task.create', model: 'task' })
  create(@Body() dto: CreateTaskDto) {
    return this.tasks.create(dto);
  }

  // No @Roles(): every role, including AUDITOR, can view tasks.
  @Get()
  list(@Query() query: ListTasksQueryDto) {
    return this.tasks.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasks.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.ADMIN)
  @Audit({ action: 'task.update', model: 'task' })
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(id, dto);
  }

  // CONTRIBUTOR is admitted at the guard, then TasksService restricts
  // them to tasks they're assigned to — RolesGuard has no concept of
  // "the same role, but only over your own row".
  @Patch(':id/status')
  @Roles(Role.OWNER, Role.ADMIN, Role.CONTRIBUTOR)
  @Audit({ action: 'task.updateStatus', model: 'task' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTaskStatusDto) {
    return this.tasks.updateStatus(id, dto.status);
  }
}

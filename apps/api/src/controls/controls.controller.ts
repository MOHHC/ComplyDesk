import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { ControlsService } from './controls.service';
import { ListControlsQueryDto } from './dto/list-controls-query.dto';

/** No @Roles() on either route: every membership role, including AUDITOR,
 * can view controls. */
@Controller('controls')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ControlsController {
  constructor(private readonly controls: ControlsService) {}

  @Get()
  list(@Query() query: ListControlsQueryDto) {
    return this.controls.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.controls.findOne(id);
  }
}

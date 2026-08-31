import { IsIn, IsOptional, IsString } from 'class-validator';
import { CONTROL_STATUSES, ControlStatus } from '../control-status';

export class ListControlsQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(CONTROL_STATUSES)
  status?: ControlStatus;
}

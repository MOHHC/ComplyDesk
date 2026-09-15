import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateInviteDto {
  @IsEnum(Role)
  role!: Role;
}

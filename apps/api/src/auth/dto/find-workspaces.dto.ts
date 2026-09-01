import { IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';

export class FindWorkspacesDto {
  // See SignupDto's email field for why this normalization exists.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;
}

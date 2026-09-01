import { IsEmail, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import type { LoginInput } from '@complydesk/shared';

export class LoginDto implements LoginInput {
  // See SignupDto's email field for why this normalization exists.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

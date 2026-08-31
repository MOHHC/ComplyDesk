import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import type { SignupInput } from '@complydesk/shared';

export class SignupDto implements SignupInput {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  tenantName: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'tenantSlug must be lowercase letters, numbers, and hyphens only',
  })
  tenantSlug: string;
}

import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { SignupInput } from '@complydesk/shared';

/**
 * Postgres text equality is case-sensitive and User.email has no
 * case-insensitive index — so without this, "Owner@x.com" at signup and
 * "owner@x.com" at login are two different strings to the database, and
 * login fails with the generic "Invalid email or password" (looks
 * exactly like a wrong password to the user, since the lookup and the
 * bcrypt check return the identical message). Very easy to trigger for
 * real: a mobile keyboard autocapitalizing the first letter of one field
 * and not the other, or a password manager normalizing case differently
 * than what was typed.
 *
 * Normalized once, here, at the API boundary that both signup and login
 * already pass through (main.ts's ValidationPipe has transform: true, so
 * this runs before the value ever reaches AuthService) rather than at
 * each call site, so no future caller can reintroduce the mismatch by
 * forgetting to normalize.
 */
export class SignupDto implements SignupInput {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
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

  // Normalized before validation, same as email above: without this,
  // typing "MyCompany" as a workspace URL fails @Matches outright with a
  // 400 rather than simply becoming "mycompany". It also means the slug
  // the server stores can legitimately differ from the one submitted,
  // which is exactly why the client must build its redirect from the
  // slug in the signup *response* rather than from its own form state.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'tenantSlug must be lowercase letters, numbers, and hyphens only',
  })
  tenantSlug: string;
}

import { plainToInstance } from 'class-transformer';
import { SignupDto } from './signup.dto';
import { LoginDto } from './login.dto';

/**
 * Pins the exact mechanism behind the signup/login email-case bug: both
 * DTOs must normalize email to lowercase (and trim whitespace) during the
 * same class-transformer pass main.ts's ValidationPipe({ transform: true })
 * runs on every request, before AuthService ever sees the value. Without
 * this, "Owner@x.com" at signup and "owner@x.com" at login are different
 * strings to Postgres's case-sensitive text equality, and login fails
 * with the same generic message as a wrong password.
 */
describe('email normalization', () => {
  it('lowercases and trims SignupDto.email', () => {
    const dto = plainToInstance(SignupDto, {
      email: '  Owner@Example.COM  ',
      password: 'password123',
      name: 'Ada',
      tenantName: 'Acme',
      tenantSlug: 'acme',
    });
    expect(dto.email).toBe('owner@example.com');
  });

  it('lowercases and trims LoginDto.email', () => {
    const dto = plainToInstance(LoginDto, {
      email: '  Owner@Example.COM  ',
      password: 'password123',
    });
    expect(dto.email).toBe('owner@example.com');
  });

  it('produces the same normalized value regardless of the case typed at signup vs login', () => {
    const signup = plainToInstance(SignupDto, {
      email: 'Owner@Example.com',
      password: 'x',
      name: 'x',
      tenantName: 'x',
      tenantSlug: 'x',
    });
    const login = plainToInstance(LoginDto, {
      email: 'owner@EXAMPLE.com',
      password: 'x',
    });
    expect(signup.email).toBe(login.email);
  });
});

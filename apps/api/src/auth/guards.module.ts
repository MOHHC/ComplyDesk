import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { WorkspaceLookupThrottleGuard } from './workspace-lookup-throttle.guard';

/**
 * JwtAuthGuard and RolesGuard are referenced via @UseGuards() in every
 * feature controller (Controls, Evidence, Tasks, Dashboard, Auth), each
 * living in its own module. Cross-module re-export of a guard (declare
 * it as a provider in one module, export it, import that module
 * elsewhere) turned out not to reliably share the single instance: Nest
 * would attempt to re-resolve JwtAuthGuard's constructor params (notably
 * JwtService) from the *consuming* module's own scope, which doesn't
 * have JwtModule imported, and fail. Making this module @Global()
 * sidesteps that entirely — every module sees the same guard instances
 * without needing to import anything, the same pattern PrismaModule and
 * SeedControlsModule already use.
 */
// The fallback only exists so local dev and tests run without setup. It
// is in a public repository, so anyone could sign tokens with it: in
// production a missing JWT_SECRET must stop the API from booting rather
// than quietly fall back.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  // WorkspaceLookupThrottleGuard holds per-IP counters in instance
  // state, so it must be a singleton provider — a new instance per use
  // would reset the window on every request and enforce nothing.
  providers: [JwtAuthGuard, RolesGuard, WorkspaceLookupThrottleGuard],
  exports: [JwtAuthGuard, RolesGuard, WorkspaceLookupThrottleGuard, JwtModule],
})
export class GuardsModule {}

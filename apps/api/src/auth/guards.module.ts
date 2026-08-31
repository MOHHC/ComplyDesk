import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';

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
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard, JwtModule],
})
export class GuardsModule {}

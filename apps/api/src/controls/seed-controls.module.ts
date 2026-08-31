import { Global, Module } from '@nestjs/common';
import { SeedControlsService } from './seed-controls.service';

/** Global, like PrismaModule: the seed data is read once and needed by
 * AuthService (signup) without pulling all of ControlsModule's HTTP
 * surface into AuthModule's dependency graph. */
@Global()
@Module({
  providers: [SeedControlsService],
  exports: [SeedControlsService],
})
export class SeedControlsModule {}

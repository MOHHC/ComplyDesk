import { Module } from '@nestjs/common';
import { TenantRateLimitGuard } from './tenant-rate-limit.guard';

@Module({
  providers: [TenantRateLimitGuard],
  exports: [TenantRateLimitGuard],
})
export class RateLimitModule {}

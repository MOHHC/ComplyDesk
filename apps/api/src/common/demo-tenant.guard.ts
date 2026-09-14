import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from './cls-keys';

/**
 * Applied per-method (not per-controller) to the handful of mutating,
 * AI-cost, narrative-breaking actions on the public demo tenant: evidence
 * upload, classification retry, policy-document upload, gap-analysis
 * run. Read-only routes (list/get, and reviewing an existing AI
 * suggestion) stay open — the whole point of the demo tenant is to be
 * explorable, just not editable by anonymous visitors.
 */
@Injectable()
export class DemoReadOnlyGuard implements CanActivate {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  canActivate(_context: ExecutionContext): boolean {
    if (this.cls.get('isDemoTenant')) {
      throw new ForbiddenException(
        'This is the public demo workspace — uploads and AI runs are disabled here so one visitor can\'t spoil the next one\'s demo. Sign up for your own workspace to try this for real.',
      );
    }
    return true;
  }
}

import { SetMetadata } from '@nestjs/common';

export type RateLimitName = 'classification' | 'gapAnalysis';

export const RATE_LIMIT_KEY = 'rateLimit';

export const RateLimit = (name: RateLimitName) => SetMetadata(RATE_LIMIT_KEY, name);

// e2e tests write real rows, so they target the Neon "test" branch
// (see `neon branches create --name test --parent production`) instead
// of the "production" branch apps/api normally runs against.
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '..', '.env.test') });

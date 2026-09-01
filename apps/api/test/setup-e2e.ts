// e2e tests write real rows, so they target the Neon "test" branch
// (see `neon branches create --name test --parent production`) instead
// of the "production" branch apps/api normally runs against.
//
// jest-e2e.json caps maxWorkers (JSON can't carry the reasoning, so it
// lives here): these suites all hit one small remote Neon compute, and
// TenantTransactionMiddleware holds a Postgres transaction open for the
// full duration of every request. Letting Jest default to one worker per
// core ran all suites at once and produced cascading timeouts — a whole
// suite would fail because its first test timed out and left no fixture
// for the rest, which looks alarmingly like a logic regression but is
// pure harness contention. Cap the concurrency instead of inflating
// timeouts, so a real slowdown still surfaces as a failure.
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '..', '.env.test') });

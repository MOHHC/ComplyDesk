// Follow-up to seed-demo-tenant.mjs, run against the same database the
// API is pointed at (uses apps/api/.env — so run this locally with
// production credentials loaded, the same way any other one-off Prisma
// script in this repo would be). Flips Tenant.isDemo to true for slug
// "demo", which is what makes DemoReadOnlyGuard start blocking evidence
// upload, classification retry, policy-document upload, and
// gap-analysis run for it — the one thing the public API has no route
// for, since a tenant can't mark itself as the demo tenant.
//
// (The "failed classification, retry available" showcase row needed no
// hand-authoring at all in the end: seeding 5 evidence uploads back to
// back genuinely tripped Gemini's free-tier rate pacer on one of them,
// producing a real FAILED row with a real reasoning message. Left as-is
// — more honest than faking one, and the retry button on it is fully
// real.)
//
// Run:
//   node scripts/mark-tenant-demo.mjs

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Owner connection (DATABASE_URL_UNPOOLED), same as prisma.config.ts —
// not app_runtime, since this is an operator script running outside any
// request's tenant-scoped transaction, with no app.tenant_id to set.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL_UNPOOLED });
const prisma = new PrismaClient({ adapter });

async function main() {
  const tenant = await prisma.tenant.update({
    where: { slug: 'demo' },
    data: { isDemo: true },
  });
  console.log(`Marked tenant "${tenant.slug}" (${tenant.id}) as isDemo=true.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

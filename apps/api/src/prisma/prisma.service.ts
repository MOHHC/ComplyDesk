import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // The running app connects as app_runtime (least-privilege: DML
    // only, no schema changes, no BYPASSRLS — see the
    // add_rls_and_app_runtime_role migration), never as the table
    // owner. Falls back to DATABASE_URL (the owner's pooled connection)
    // on branches that don't have app_runtime provisioned yet — RLS is
    // rolled out to the Neon "test" branch only so far, not production.
    //
    // Pool tuning, measured against the real Neon branch rather than
    // guessed: with pg's defaults (idle connections dropped after 10s),
    // every request after a short pause paid a brand-new TLS + SCRAM
    // handshake — ~2000 ms per query from a distant client, in a 20s-gap
    // test. Holding idle connections for 5 minutes plus TCP keepalive
    // brought the same query to ~150-350 ms. Five minutes is also when
    // Neon suspends an idle compute (scale-to-zero), so there is nothing
    // to gain by holding connections longer.
    //
    // connectionTimeoutMillis bounds a connect that has to wake a
    // suspended compute (typically 1-2 s). pg's default is "wait
    // forever", which turns a stuck wake-up into a request that never
    // answers instead of one that fails and can be retried.
    const adapter = new PrismaPg({
      connectionString:
        process.env.APP_RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL,
      idleTimeoutMillis: 5 * 60 * 1000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

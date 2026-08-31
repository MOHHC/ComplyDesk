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
    const adapter = new PrismaPg({
      connectionString:
        process.env.APP_RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL,
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

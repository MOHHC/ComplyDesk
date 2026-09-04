import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { TenantMiddleware } from './common/tenant.middleware';
import { TenantTransactionMiddleware } from './common/tenant-transaction.middleware';
import { GapAnalysisTransactionMiddleware } from './gap-analysis/gap-analysis-transaction.middleware';
import { AuthModule } from './auth/auth.module';
import { SeedControlsModule } from './controls/seed-controls.module';
import { ControlsModule } from './controls/controls.module';
import { EvidenceModule } from './evidence/evidence.module';
import { TasksModule } from './tasks/tasks.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MembersModule } from './members/members.module';
import { AuditModule } from './audit/audit.module';
import { PolicyDocumentsModule } from './policy-documents/policy-documents.module';
import { GapAnalysisModule } from './gap-analysis/gap-analysis.module';

const GAP_ANALYSIS_RUN_ROUTE = { path: 'gap-analysis/run', method: RequestMethod.POST };

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    PrismaModule,
    SeedControlsModule,
    AuthModule,
    ControlsModule,
    EvidenceModule,
    TasksModule,
    DashboardModule,
    MembersModule,
    // Registers AuditInterceptor globally (APP_INTERCEPTOR) so every
    // controller gets audit coverage without remembering to add it.
    AuditModule,
    PolicyDocumentsModule,
    GapAnalysisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Order matters: TenantMiddleware resolves cls.tenantId first;
    // one of the two TenantTransactionMiddleware variants below then
    // opens the tenant-scoped transaction guards and handlers run
    // inside. Every route gets TenantMiddleware first, then exactly one
    // transaction middleware — the gap-analysis run route gets the
    // longer-timeout variant (GapAnalysisTransactionMiddleware, see
    // that file for why), every other route is unchanged.
    consumer.apply(TenantMiddleware).forRoutes('*');
    consumer
      .apply(TenantTransactionMiddleware)
      .exclude(GAP_ANALYSIS_RUN_ROUTE)
      .forRoutes('*');
    consumer
      .apply(GapAnalysisTransactionMiddleware)
      .forRoutes(GAP_ANALYSIS_RUN_ROUTE);
  }
}

import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { TenantMiddleware } from './common/tenant.middleware';
import { TenantTransactionMiddleware } from './common/tenant-transaction.middleware';
import { GapAnalysisTransactionMiddleware } from './gap-analysis/gap-analysis-transaction.middleware';
import { PolicyDocumentsTransactionMiddleware } from './policy-documents/policy-documents-transaction.middleware';
import { EvidenceTransactionMiddleware } from './evidence/evidence-transaction.middleware';
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
import { InvitesModule } from './invites/invites.module';

const GAP_ANALYSIS_RUN_ROUTE = { path: 'gap-analysis/run', method: RequestMethod.POST };
const POLICY_DOCUMENTS_UPLOAD_ROUTE = { path: 'policy-documents', method: RequestMethod.POST };
const EVIDENCE_UPLOAD_ROUTE = { path: 'controls/:controlId/evidence', method: RequestMethod.POST };
const EVIDENCE_RETRY_CLASSIFICATION_ROUTE = {
  path: 'controls/:controlId/evidence/:evidenceId/classification/retry',
  method: RequestMethod.POST,
};

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
    InvitesModule,
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
    // one of the TenantTransactionMiddleware variants below then opens
    // the tenant-scoped transaction guards and handlers run inside.
    // Every route gets TenantMiddleware first, then exactly one
    // transaction middleware — the gap-analysis run route, the
    // policy-document upload route, and the two evidence-classification
    // routes (upload, retry) each get their own longer-timeout variant
    // (GapAnalysisTransactionMiddleware, PolicyDocumentsTransactionMiddleware,
    // EvidenceTransactionMiddleware — see those files for why), every
    // other route is unchanged. Retry shares EVIDENCE_UPLOAD_ROUTE's
    // middleware, not its own: it makes the exact same classifyEvidence()
    // call upload does, just re-triggered by hand, so it needs the same
    // budget.
    consumer.apply(TenantMiddleware).forRoutes('*');
    consumer
      .apply(TenantTransactionMiddleware)
      .exclude(GAP_ANALYSIS_RUN_ROUTE, POLICY_DOCUMENTS_UPLOAD_ROUTE, EVIDENCE_UPLOAD_ROUTE, EVIDENCE_RETRY_CLASSIFICATION_ROUTE)
      .forRoutes('*');
    consumer
      .apply(GapAnalysisTransactionMiddleware)
      .forRoutes(GAP_ANALYSIS_RUN_ROUTE);
    consumer
      .apply(PolicyDocumentsTransactionMiddleware)
      .forRoutes(POLICY_DOCUMENTS_UPLOAD_ROUTE);
    consumer
      .apply(EvidenceTransactionMiddleware)
      .forRoutes(EVIDENCE_UPLOAD_ROUTE, EVIDENCE_RETRY_CLASSIFICATION_ROUTE);
  }
}

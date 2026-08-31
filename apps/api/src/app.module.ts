import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { TenantMiddleware } from './common/tenant.middleware';
import { TenantTransactionMiddleware } from './common/tenant-transaction.middleware';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Order matters: TenantMiddleware resolves cls.tenantId first;
    // TenantTransactionMiddleware then opens the tenant-scoped
    // transaction guards and handlers run inside.
    consumer
      .apply(TenantMiddleware, TenantTransactionMiddleware)
      .forRoutes('*');
  }
}

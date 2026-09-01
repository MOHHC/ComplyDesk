import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Request } from 'express';
import { catchError, defer, from, mergeMap, Observable, throwError } from 'rxjs';
import { AppClsStore } from '../common/cls-keys';
import { AUDIT_KEY, AuditOptions } from './audit.decorator';
import { SKIP_AUDIT_KEY } from './skip-audit.decorator';
import { diffRows, redactBody } from './diff';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_ID_PARAM = 'id';

/**
 * Records every mutating request to AuditEvent, scoped to the request's
 * tenant transaction so the write shares the request's atomicity (an
 * audit-write failure rolls back the mutation with it) and its RLS
 * context (nothing here can write into another tenant's log).
 *
 * Two things this interceptor cannot see, by construction of the Nest
 * pipeline rather than by oversight:
 *  - A Guard rejecting the request (e.g. RolesGuard's 403) never reaches
 *    an interceptor at all — guards run first and short-circuit before
 *    interceptors are invoked. Denied attempts are visible in ordinary
 *    request logs, not here.
 *  - Requests with no resolved tenant (signup, before its own tenant
 *    exists) have no tenantTx to scope a write to. AuthService.signup
 *    writes its own audit.signup row directly inside its transaction,
 *    once the tenant it belongs to exists.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!MUTATING_METHODS.has(req.method)) {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    const tx = this.cls.get('tenantTx');
    if (!tx) {
      return next.handle();
    }

    const options = this.reflector.getAllAndOverride<AuditOptions | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const successStatus = this.defaultSuccessStatus(context);
    const idParam = options?.idParam ?? DEFAULT_ID_PARAM;
    const targetId = req.params?.[idParam] as string | undefined;

    // Read "before" ahead of the handler running — it has to happen here,
    // not in the success branch, since the handler is what mutates the row.
    const before$ =
      options?.model && targetId
        ? defer(() => from(this.readRow(tx, options.model!, targetId)))
        : defer(() => from(Promise.resolve(null)));

    return before$.pipe(
      mergeMap((before) =>
        next.handle().pipe(
          mergeMap((result) =>
            from(
              this.write(tx, req, options, before, result, successStatus).then(() => result),
            ),
          ),
          catchError((err) => {
            const statusCode = err?.getStatus?.() ?? err?.status ?? 500;
            return from(this.write(tx, req, options, before, null, statusCode)).pipe(
              mergeMap(() => throwError(() => err)),
            );
          }),
        ),
      ),
    );
  }

  private defaultSuccessStatus(context: ExecutionContext): number {
    const explicit = this.reflector.getAllAndOverride<number | undefined>(HTTP_CODE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (explicit) return explicit;
    const method = context.switchToHttp().getRequest<Request>().method;
    // Mirrors Nest's own default (POST -> 201, everything else -> 200),
    // since the framework hasn't applied it to the response yet at the
    // point this interceptor runs.
    return method === 'POST' ? 201 : 200;
  }

  private async readRow(
    tx: Record<string, any>,
    model: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await tx[model].findUnique({ where: { id } });
    } catch {
      return null;
    }
  }

  private async write(
    tx: Record<string, any>,
    req: Request,
    options: AuditOptions | undefined,
    before: Record<string, unknown> | null,
    result: unknown,
    statusCode: number,
  ): Promise<void> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return;

    const action = options?.action ?? `${req.method} ${req.route?.path ?? req.path}`;
    const after =
      result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
    const targetType = options?.model
      ? options.model.charAt(0).toUpperCase() + options.model.slice(1)
      : (req.route?.path?.split('/')[1] ?? 'unknown');
    const targetId =
      req.params?.[options?.idParam ?? DEFAULT_ID_PARAM] ?? (after?.id as string | undefined);

    const diff = options?.model
      ? diffRows(before, after)
      : req.body && Object.keys(req.body).length > 0
        ? { body: { before: null, after: redactBody(req.body) } }
        : null;

    await tx.auditEvent.create({
      data: {
        tenantId,
        actorUserId: this.cls.get('userId') ?? null,
        action,
        targetType,
        targetId: targetId ?? null,
        diff: diff ?? undefined,
        method: req.method,
        path: req.route?.path ?? req.path,
        statusCode,
      },
    });
  }
}

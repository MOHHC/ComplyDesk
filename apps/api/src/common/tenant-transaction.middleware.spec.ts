import { EventEmitter } from 'node:events';
import { TenantTransactionMiddleware } from './tenant-transaction.middleware';

describe('TenantTransactionMiddleware', () => {
  const buildDeps = () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback(tx),
      ),
    } as any;
    const store = new Map<string, unknown>();
    const cls = {
      get: jest.fn((key: string) => store.get(key)),
      set: jest.fn((key: string, value: unknown) => store.set(key, value)),
    } as any;
    return { prisma, cls, tx };
  };

  const buildRes = (statusCode: number, headersSent = false) => {
    const res = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headersSent: boolean;
    };
    res.statusCode = statusCode;
    res.headersSent = headersSent;
    return res;
  };

  it('skips opening a transaction when no tenant is set on this request', async () => {
    const { prisma, cls } = buildDeps();
    const middleware = new TenantTransactionMiddleware(prisma, cls);
    const next = jest.fn();

    await middleware.use({} as any, buildRes(200) as any, next);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('opens a transaction, sets tenant context, stores tx in cls, and resolves on a successful response', async () => {
    const { prisma, cls, tx } = buildDeps();
    cls.set('tenantId', 'tenant-1');
    const middleware = new TenantTransactionMiddleware(prisma, cls);
    const res = buildRes(200);
    const next = jest.fn(() => {
      queueMicrotask(() => res.emit('finish'));
    });

    await middleware.use({} as any, res as any, next);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(cls.set).toHaveBeenCalledWith('tenantTx', tx);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next(err) when the response ends in a 5xx and headers were not yet sent', async () => {
    const { prisma, cls } = buildDeps();
    cls.set('tenantId', 'tenant-1');
    const middleware = new TenantTransactionMiddleware(prisma, cls);
    const res = buildRes(500, false);
    const next = jest.fn(() => {
      queueMicrotask(() => res.emit('finish'));
    });

    await middleware.use({} as any, res as any, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[1][0]).toBeInstanceOf(Error);
  });

  it('does not call next(err) again when a 5xx response already had headers sent', async () => {
    const { prisma, cls } = buildDeps();
    cls.set('tenantId', 'tenant-1');
    const middleware = new TenantTransactionMiddleware(prisma, cls);
    const res = buildRes(500, true);
    const next = jest.fn(() => {
      queueMicrotask(() => res.emit('finish'));
    });

    await middleware.use({} as any, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

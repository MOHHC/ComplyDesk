import { diffRows, redactBody } from './diff';

describe('diffRows', () => {
  it('returns null when both sides are missing', () => {
    expect(diffRows(null, null)).toBeNull();
  });

  it('diffs every field against null for a create', () => {
    const diff = diffRows(null, { id: '1', title: 'New', status: 'TODO' });
    expect(diff).toEqual({
      id: { before: null, after: '1' },
      title: { before: null, after: 'New' },
      status: { before: null, after: 'TODO' },
    });
  });

  it('only includes fields that actually changed', () => {
    const diff = diffRows(
      { id: '1', title: 'Same', status: 'TODO' },
      { id: '1', title: 'Same', status: 'DONE' },
    );
    expect(diff).toEqual({ status: { before: 'TODO', after: 'DONE' } });
  });

  it('returns null when nothing changed', () => {
    const row = { id: '1', title: 'Same' };
    expect(diffRows(row, { ...row })).toBeNull();
  });

  it('excludes sensitive and noisy fields even when they differ', () => {
    const diff = diffRows(
      { id: '1', passwordHash: 'a', tenantId: 't1', updatedAt: new Date(0) },
      { id: '1', passwordHash: 'b', tenantId: 't2', updatedAt: new Date(1) },
    );
    expect(diff).toBeNull();
  });

  it('serializes Date fields to ISO strings for comparison and storage', () => {
    const diff = diffRows(
      { dueDate: new Date('2026-01-01T00:00:00.000Z') },
      { dueDate: new Date('2026-02-01T00:00:00.000Z') },
    );
    expect(diff).toEqual({
      dueDate: { before: '2026-01-01T00:00:00.000Z', after: '2026-02-01T00:00:00.000Z' },
    });
  });
});

describe('redactBody', () => {
  it('redacts known sensitive fields', () => {
    expect(redactBody({ email: 'a@b.com', password: 'secret' })).toEqual({
      email: 'a@b.com',
      password: '[redacted]',
    });
  });

  it('passes through non-object bodies unchanged', () => {
    expect(redactBody(undefined)).toBeUndefined();
    expect(redactBody(null)).toBeNull();
  });
});

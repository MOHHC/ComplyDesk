import { computeControlStatus, isExpiringSoon } from './control-status';

describe('computeControlStatus', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('is no_evidence when nothing has ever been collected', () => {
    expect(computeControlStatus(90, null, now)).toBe('no_evidence');
  });

  it('is has_evidence when the refresh window has not closed', () => {
    const collectedAt = new Date('2026-05-01T00:00:00Z'); // 31 days ago
    expect(computeControlStatus(90, collectedAt, now)).toBe('has_evidence');
  });

  it('is evidence_expired once the refresh window has closed', () => {
    const collectedAt = new Date('2026-01-01T00:00:00Z'); // 151 days ago
    expect(computeControlStatus(90, collectedAt, now)).toBe('evidence_expired');
  });

  it('treats the exact boundary instant as still valid, and one ms later as expired', () => {
    const windowMs = 90 * 24 * 60 * 60 * 1000;
    const collectedAt = new Date(now.getTime() - windowMs);
    expect(computeControlStatus(90, collectedAt, now)).toBe('has_evidence');

    const oneMsEarlier = new Date(collectedAt.getTime() - 1);
    expect(computeControlStatus(90, oneMsEarlier, now)).toBe('evidence_expired');
  });
});

describe('isExpiringSoon', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('is false with no evidence at all (that is no_evidence, not expiring)', () => {
    expect(isExpiringSoon(90, null, now)).toBe(false);
  });

  it('is false when the refresh window closes well outside 30 days', () => {
    const collectedAt = new Date('2026-05-25T00:00:00Z'); // expires ~ Aug 23
    expect(isExpiringSoon(90, collectedAt, now)).toBe(false);
  });

  it('is true when valid evidence expires within the next 30 days', () => {
    const collectedAt = new Date('2026-03-10T00:00:00Z'); // expires ~ Jun 8
    expect(isExpiringSoon(90, collectedAt, now)).toBe(true);
  });

  it('is false once the window has already closed (that is evidence_expired, not expiring soon)', () => {
    const collectedAt = new Date('2026-01-01T00:00:00Z');
    expect(isExpiringSoon(90, collectedAt, now)).toBe(false);
  });
});

import { parseSubdomain } from './subdomain';

describe('parseSubdomain', () => {
  it('extracts the subdomain from a *.localhost dev host', () => {
    expect(parseSubdomain('acme.localhost:3000')).toBe('acme');
  });

  it('returns null for bare localhost', () => {
    expect(parseSubdomain('localhost:3000')).toBeNull();
  });

  it('extracts the subdomain from a production host', () => {
    expect(parseSubdomain('acme.complydesk.com')).toBe('acme');
  });

  it('returns null for the bare root domain', () => {
    expect(parseSubdomain('complydesk.com')).toBeNull();
  });

  it('returns null for reserved subdomains', () => {
    expect(parseSubdomain('www.complydesk.com')).toBeNull();
    expect(parseSubdomain('app.complydesk.com')).toBeNull();
    expect(parseSubdomain('api.complydesk.com')).toBeNull();
  });

  it('returns null when no host header is present', () => {
    expect(parseSubdomain(undefined)).toBeNull();
  });
});

import { buildTenantHost, buildTenantUrl, parseSubdomain } from '@complydesk/shared';

/**
 * buildTenantHost is what moves the browser to the right workspace after
 * signup and from the root-domain workspace picker. Getting it wrong
 * sends a freshly-signed-up user to a host whose subdomain resolves to
 * some *other* tenant — the exact failure that produced a 401 that
 * looked like a wrong password.
 */
describe('buildTenantHost', () => {
  it('adds a subdomain to a bare dev host, preserving the port', () => {
    expect(buildTenantHost('localhost:3000', 'acme')).toBe('acme.localhost:3000');
  });

  it('replaces an existing tenant subdomain rather than nesting under it', () => {
    // The signup-on-the-wrong-subdomain case: signing up "acme" while
    // sitting on other.localhost must land on acme.localhost, never
    // acme.other.localhost.
    expect(buildTenantHost('other.localhost:3000', 'acme')).toBe('acme.localhost:3000');
  });

  it('works with no port', () => {
    expect(buildTenantHost('localhost', 'acme')).toBe('acme.localhost');
  });

  it('adds a subdomain to a bare production domain', () => {
    expect(buildTenantHost('complydesk.com', 'acme')).toBe('acme.complydesk.com');
  });

  it('replaces an existing subdomain on a production domain', () => {
    expect(buildTenantHost('other.complydesk.com', 'acme')).toBe('acme.complydesk.com');
  });

  it('strips a reserved subdomain instead of nesting under it', () => {
    // parseSubdomain deliberately reports null for "www" (it's not a
    // tenant), but it still has to be stripped here — otherwise this
    // returns acme.www.complydesk.com.
    expect(parseSubdomain('www.complydesk.com')).toBeNull();
    expect(buildTenantHost('www.complydesk.com', 'acme')).toBe('acme.complydesk.com');
  });

  it('leaves IP hosts untouched, since they cannot carry subdomains', () => {
    expect(buildTenantHost('127.0.0.1:3000', 'acme')).toBe('127.0.0.1:3000');
  });

  it('round-trips: whatever it builds, parseSubdomain reads back as the same tenant', () => {
    for (const host of ['localhost:3000', 'other.localhost:3000', 'complydesk.com']) {
      expect(parseSubdomain(buildTenantHost(host, 'acme'))).toBe('acme');
    }
  });
});

describe('buildTenantUrl', () => {
  it('builds an absolute URL preserving protocol and port', () => {
    expect(
      buildTenantUrl({ protocol: 'http:', host: 'localhost:3000' }, 'acme', '/dashboard'),
    ).toBe('http://acme.localhost:3000/dashboard');
  });

  it('preserves https', () => {
    expect(
      buildTenantUrl({ protocol: 'https:', host: 'complydesk.com' }, 'acme', '/login'),
    ).toBe('https://acme.complydesk.com/login');
  });
});

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api']);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function parseSubdomain(host: string | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') return null;

  const parts = hostname.split('.');
  if (parts[parts.length - 1] === 'localhost') {
    return parts.length >= 2 ? parts[0] : null;
  }
  if (parts.length <= 2) return null;

  const subdomain = parts[0];
  return RESERVED_SUBDOMAINS.has(subdomain) ? null : subdomain;
}

/**
 * The host with any leading subdomain label removed — the "root" the
 * tenant subdomains hang off. Note this strips reserved labels too
 * (www.complydesk.com -> complydesk.com), which parseSubdomain
 * deliberately does not report as a tenant; the two answer different
 * questions and must not be conflated.
 */
function rootHostname(hostname: string): string {
  if (IPV4.test(hostname)) return hostname;

  const parts = hostname.split('.');
  if (parts[parts.length - 1] === 'localhost') {
    // "test.localhost" -> "localhost"; bare "localhost" is already root.
    return parts.length >= 2 ? parts[parts.length - 1] : hostname;
  }
  // "test.complydesk.com" -> "complydesk.com"; "complydesk.com" is root.
  return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
}

/**
 * Rewrites a host to point at a given tenant's subdomain, preserving the
 * port and replacing any subdomain already present. Used to move the
 * browser to the right workspace after signup, and from the root-domain
 * workspace picker.
 *
 * Returns the host unchanged for IP addresses, which can't carry
 * subdomains at all — callers get something still navigable rather than
 * a silently broken URL like "acme.127.0.0.1".
 */
export function buildTenantHost(host: string, slug: string): string {
  const [hostname, port] = splitHostPort(host);
  if (IPV4.test(hostname)) return host;

  const root = rootHostname(hostname);
  return port ? `${slug}.${root}:${port}` : `${slug}.${root}`;
}

function splitHostPort(host: string): [string, string | undefined] {
  const [hostname, port] = host.toLowerCase().split(':');
  return [hostname, port];
}

/** Absolute URL on the tenant's own subdomain, preserving protocol/port. */
export function buildTenantUrl(
  location: { protocol: string; host: string },
  slug: string,
  path: string,
): string {
  return `${location.protocol}//${buildTenantHost(location.host, slug)}${path}`;
}

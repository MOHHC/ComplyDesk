const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api']);

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

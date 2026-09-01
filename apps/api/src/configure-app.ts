import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * The CORS policy and global ValidationPipe that every real request goes
 * through. Pulled out of main.ts's bootstrap() so e2e tests — which build
 * the app via Test.createTestingModule() + createNestApplication(),
 * never touching bootstrap() at all — can apply the exact same
 * configuration instead of silently running with none.
 *
 * That gap was real, not hypothetical: it let a DTO whose @Transform
 * decorator normalizes email casing pass every e2e test while doing
 * nothing at all in that environment, because no ValidationPipe was ever
 * registered to run it. The bug it was meant to catch only surfaced once
 * this helper existed and e2e tests started calling it.
 */

/**
 * The web app runs on the tenant's own subdomain (acme.localhost:3000,
 * acme.complydesk.com, ...), not on a single fixed origin, so a plain
 * string match against WEB_ORIGIN rejects every tenant subdomain's CORS
 * preflight. Allow WEB_ORIGIN's host itself and any subdomain of it,
 * on the same protocol and port.
 */
export function buildCorsOriginCallback(webOrigin: string) {
  const allowed = new URL(webOrigin);
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin) {
      // No Origin header: non-browser clients (curl, server-to-server).
      callback(null, true);
      return;
    }
    try {
      const requestOrigin = new URL(origin);
      const sameHost =
        requestOrigin.hostname === allowed.hostname ||
        requestOrigin.hostname.endsWith(`.${allowed.hostname}`);
      const sameScheme = requestOrigin.protocol === allowed.protocol;
      const samePort = requestOrigin.port === allowed.port;
      callback(null, sameHost && sameScheme && samePort);
    } catch {
      callback(null, false);
    }
  };
}

export function configureApp(app: INestApplication): void {
  app.enableCors({
    origin: buildCorsOriginCallback(process.env.WEB_ORIGIN ?? 'http://localhost:3000'),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}

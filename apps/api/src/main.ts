import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * The web app runs on the tenant's own subdomain (acme.localhost:3000,
 * acme.complydesk.com, ...), not on a single fixed origin, so a plain
 * string match against WEB_ORIGIN rejects every tenant subdomain's CORS
 * preflight. Allow WEB_ORIGIN's host itself and any subdomain of it,
 * on the same protocol and port.
 */
function buildCorsOriginCallback(webOrigin: string) {
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: buildCorsOriginCallback(process.env.WEB_ORIGIN ?? 'http://localhost:3000'),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();

import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Config } from './config.js';
import { clientIdentity } from './sessions/client-identity.js';

/** HTTP setup shared by the server and the end-to-end tests. */
export function configureApp(app: NestExpressApplication, config: Config): void {
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(cookieParser(config.SESSION_SECRET));
  app.use(clientIdentity(config.SESSION_SECRET));
  // A 100 000-character script can exceed Express's 100 kB default once UTF-8 encoded.
  app.useBodyParser('json', { limit: '512kb' });
}

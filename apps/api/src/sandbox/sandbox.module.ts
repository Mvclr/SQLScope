import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { CONFIG, type Config } from '../config.js';
import { SANDBOX_DB } from '../infrastructure/infrastructure.module.js';
import { SandboxProvisioner } from './provisioner.js';
import { SessionConnections } from './session-connections.js';

@Module({
  providers: [
    {
      provide: SandboxProvisioner,
      inject: [SANDBOX_DB],
      useFactory: (admin: pg.Pool) => new SandboxProvisioner(admin),
    },
    {
      provide: SessionConnections,
      inject: [SANDBOX_DB, CONFIG],
      useFactory: (admin: pg.Pool, config: Config) =>
        new SessionConnections(admin, config.SANDBOX_DATABASE_URL, config.STATEMENT_TIMEOUT_MS),
    },
  ],
  exports: [SandboxProvisioner, SessionConnections],
})
export class SandboxModule implements OnApplicationShutdown {
  constructor(@Inject(SessionConnections) private readonly connections: SessionConnections) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connections.releaseAll();
  }
}

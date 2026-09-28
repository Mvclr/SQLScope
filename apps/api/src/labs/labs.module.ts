import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { EventsModule } from '../events/events.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { LabConnections } from './lab-connections.js';
import { LabRunService } from './lab-run.service.js';
import { LabRunWatcher } from './lab-run.watcher.js';
import { LabsController } from './labs.controller.js';
import { SandboxManagerClient } from './sandbox-manager.client.js';

@Module({
  imports: [SessionsModule, EventsModule, RateLimitModule],
  controllers: [LabsController],
  providers: [
    {
      provide: SandboxManagerClient,
      inject: [CONFIG],
      useFactory: (config: Config) =>
        new SandboxManagerClient(config.SANDBOX_MANAGER_URL, config.SANDBOX_MANAGER_TOKEN),
    },
    {
      provide: LabConnections,
      inject: [CONFIG],
      useFactory: (config: Config) => new LabConnections(config.STATEMENT_TIMEOUT_MS),
    },
    LabRunService,
    LabRunWatcher,
  ],
  exports: [LabRunService],
})
export class LabsModule implements OnApplicationShutdown {
  constructor(@Inject(LabConnections) private readonly connections: LabConnections) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connections.releaseAll();
  }
}

import { Module } from '@nestjs/common';
import { EventsController } from '../events/events.controller.js';
import { EventsModule } from '../events/events.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SandboxModule } from '../sandbox/sandbox.module.js';
import { SessionReaper } from './session-reaper.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  imports: [EventsModule, SandboxModule, RateLimitModule],
  controllers: [SessionsController, EventsController],
  providers: [SessionService, SessionGuard, SessionReaper],
  exports: [SessionService, SessionGuard, SessionReaper],
})
export class SessionsModule {}

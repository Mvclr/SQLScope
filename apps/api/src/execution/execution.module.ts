import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SandboxModule } from '../sandbox/sandbox.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { AnalysisService } from './analysis.service.js';
import { ExecutionController } from './execution.controller.js';
import { ExecutionService } from './execution.service.js';

@Module({
  imports: [SessionsModule, EventsModule, SandboxModule, RateLimitModule],
  controllers: [ExecutionController],
  providers: [ExecutionService, AnalysisService],
})
export class ExecutionModule {}

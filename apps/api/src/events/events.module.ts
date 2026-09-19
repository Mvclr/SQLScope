import { Module } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PRISMA } from '../infrastructure/infrastructure.module.js';
import { SessionEventBus } from './session-event-bus.js';
import { SessionLog } from './session-log.js';

@Module({
  providers: [
    SessionEventBus,
    {
      provide: SessionLog,
      inject: [PRISMA],
      useFactory: (prisma: PrismaClient) => new SessionLog(prisma),
    },
  ],
  exports: [SessionEventBus, SessionLog],
})
export class EventsModule {}

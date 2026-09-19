import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { SessionGuard, sessionOf } from '../sessions/session.guard.js';
import { ExecutionService } from './execution.service.js';

const ExecuteRequest = z.object({ sql: z.string().min(1).max(100_000) });

@Controller('sessions/current')
@UseGuards(SessionGuard, RateLimitGuard)
export class ExecutionController {
  constructor(private readonly execution: ExecutionService) {}

  /** Always 200 when the script ran: SQL errors are results, not HTTP failures. */
  @Post('execute')
  @HttpCode(200)
  @RateLimit({ name: 'execute', windowSeconds: 60, perClient: 120, perSession: 60 })
  async execute(@Req() request: Request, @Body() body: unknown) {
    const parsed = ExecuteRequest.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    return this.execution.execute(sessionOf(request), parsed.data.sql);
  }
}

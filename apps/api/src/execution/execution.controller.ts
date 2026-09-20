import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { SessionGuard, sessionOf } from '../sessions/session.guard.js';
import { AnalysisService } from './analysis.service.js';
import { ExecutionService } from './execution.service.js';

const ExecuteRequest = z.object({ sql: z.string().min(1).max(100_000) });
const AnalyzeRequest = ExecuteRequest.extend({
  runs: z.coerce.number().int().min(1).max(10).optional(),
});

@Controller('sessions/current')
@UseGuards(SessionGuard, RateLimitGuard)
export class ExecutionController {
  constructor(
    private readonly execution: ExecutionService,
    private readonly analysis: AnalysisService,
  ) {}

  /** Always 200 when the script ran: SQL errors are results, not HTTP failures. */
  @Post('execute')
  @HttpCode(200)
  @RateLimit({ name: 'execute', windowSeconds: 60, perClient: 120, perSession: 60 })
  async execute(@Req() request: Request, @Body() body: unknown) {
    const parsed = ExecuteRequest.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    return this.execution.execute(sessionOf(request), parsed.data.sql);
  }

  /** Explains a query, measures it when it only reads, and compares with the last run. */
  @Post('analyze')
  @HttpCode(200)
  @RateLimit({ name: 'analyze', windowSeconds: 60, perClient: 60, perSession: 30 })
  async analyze(@Req() request: Request, @Body() body: unknown) {
    const parsed = AnalyzeRequest.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    const result = await this.analysis.analyzeQuery(
      sessionOf(request),
      parsed.data.sql,
      parsed.data.runs,
    );
    if (!result.ok) throw new BadRequestException(result.error);
    return result.value;
  }

  /** Security report of the session database (ADR 0006). */
  @Get('report')
  @RateLimit({ name: 'report', windowSeconds: 60, perClient: 30, perSession: 15 })
  report(@Req() request: Request) {
    return this.analysis.report(sessionOf(request));
  }
}

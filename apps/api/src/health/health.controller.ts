import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { evaluate, HEALTH_CHECKS, type HealthCheck, type Readiness } from './health-check.js';

const CHECK_TIMEOUT_MS = 2_000;

@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_CHECKS) private readonly checks: HealthCheck[]) {}

  /** Liveness: the process is up. Touches no dependency, so it never flaps with them. */
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: every dependency answers. 503 tells the orchestrator to hold traffic. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<Readiness> {
    const readiness = await evaluate(this.checks, CHECK_TIMEOUT_MS);
    if (readiness.status !== 'ready') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return readiness;
  }
}

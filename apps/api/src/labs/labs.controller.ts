import {
  type ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { SessionGuard, sessionOf } from '../sessions/session.guard.js';
import { LabRunService, type RunRefusal } from './lab-run.service.js';
import { ManagerUnavailableError } from './sandbox-manager.client.js';

/** Any transport failure to the manager is a temporary outage of the T2 feature: 503. */
@Catch(ManagerUnavailableError)
class ManagerExceptionFilter implements ExceptionFilter {
  catch(_error: ManagerUnavailableError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .header('retry-after', '30')
      .json({
        message: 'O laboratório no servidor está indisponível agora. Tente em instantes.',
        code: 'manager-unavailable',
      });
  }
}

const AppRequest = z.object({
  input: z.string().max(2_000),
  mode: z.enum(['concatenated', 'parameterized']),
});
const ExecuteRequest = z.object({ sql: z.string().min(1).max(100_000) });

const NOT_READY_MESSAGE: Record<RunRefusal, { status: HttpStatus; body: object }> = {
  'no-run': {
    status: HttpStatus.NOT_FOUND,
    body: { message: 'Nenhum laboratório em andamento nesta sessão.', code: 'no-run' },
  },
  'not-ready': {
    status: HttpStatus.CONFLICT,
    body: { message: 'O sandbox ainda não está pronto.', code: 'not-ready' },
  },
};

function refuse(refusal: RunRefusal): never {
  const { status, body } = NOT_READY_MESSAGE[refusal];
  throw new HttpException(body, status);
}

@Controller('labs')
@UseGuards(SessionGuard, RateLimitGuard)
@UseFilters(ManagerExceptionFilter)
export class LabsController {
  constructor(private readonly runs: LabRunService) {}

  /** Starts a lab (or returns the session's running one). 202: the sandbox may be queued. */
  @Post(':labId/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'lab-start', windowSeconds: 3_600, perClient: 30, perSession: 10 })
  async start(@Req() request: Request, @Param('labId') labId: string) {
    const result = await this.runs.start(sessionOf(request), labId);
    if (result.ok) return result.value;
    switch (result.error) {
      case 'unknown-lab':
        throw new HttpException(
          { message: 'Laboratório desconhecido ou que não roda no servidor.', code: 'unknown-lab' },
          HttpStatus.NOT_FOUND,
        );
      case 'client-limit':
        throw new HttpException(
          { message: 'Você já tem um laboratório em andamento.', code: 'client-limit' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'capacity':
        throw new HttpException(
          {
            message: 'Todos os sandboxes estão ocupados. Tente em alguns minutos.',
            code: 'capacity',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
    }
  }

  @Get('runs/current')
  @RateLimit({ name: 'lab-status', windowSeconds: 60, perClient: 240, perSession: 120 })
  async current(@Req() request: Request) {
    const view = await this.runs.status(sessionOf(request).id);
    if (!view) throw new HttpException({ code: 'no-run' }, HttpStatus.NOT_FOUND);
    return view;
  }

  @Post('runs/current/claim')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'lab-claim', windowSeconds: 60, perClient: 60, perSession: 30 })
  async claim(@Req() request: Request) {
    const result = await this.runs.claim(sessionOf(request).id);
    return result.ok ? result.value : refuse(result.error);
  }

  @Post('runs/current/app')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'lab-app', windowSeconds: 60, perClient: 120, perSession: 60 })
  async app(@Req() request: Request, @Body() body: unknown) {
    const parsed = AppRequest.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    const result = await this.runs.runApp(
      sessionOf(request).id,
      parsed.data.input,
      parsed.data.mode,
    );
    return result.ok ? result.value : refuse(result.error);
  }

  @Post('runs/current/execute')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'lab-execute', windowSeconds: 60, perClient: 120, perSession: 60 })
  async execute(@Req() request: Request, @Body() body: unknown) {
    const parsed = ExecuteRequest.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    const result = await this.runs.runConsole(sessionOf(request).id, parsed.data.sql);
    return result.ok ? result.value : refuse(result.error);
  }

  @Delete('runs/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ name: 'lab-release', windowSeconds: 60, perClient: 60, perSession: 30 })
  async release(@Req() request: Request) {
    await this.runs.release(sessionOf(request).id);
  }
}

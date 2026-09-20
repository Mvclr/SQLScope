import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { PRISMA } from '../infrastructure/infrastructure.module.js';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { UserGuard, userOf } from './user.guard.js';

const SaveProject = z.object({
  name: z.string().trim().min(1).max(120),
  /** The statements that rebuild the schema, in order. */
  scripts: z.array(z.string().max(100_000)).min(1).max(500),
});

const MAX_PROJECTS = 50;

/**
 * Saved sessions. A project is the SQL that built a schema, not a database: opening one
 * replays it into a fresh sandbox, so nothing outlives its session but the statements.
 */
@Controller('projects')
@UseGuards(UserGuard, RateLimitGuard)
export class ProjectsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  async list(@Req() request: Request) {
    const projects = await this.prisma.project.findMany({
      where: { userId: userOf(request).id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
    return projects;
  }

  @Get(':id')
  async get(@Req() request: Request, @Param('id') id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, userId: userOf(request).id },
    });
    if (!project) throw new NotFoundException({ message: 'Projeto não encontrado.' });
    return project;
  }

  @Post()
  @RateLimit({ name: 'save-project', windowSeconds: 3_600, perClient: 120 })
  async save(@Req() request: Request, @Body() body: unknown) {
    const parsed = SaveProject.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));

    const userId = userOf(request).id;
    const { name, scripts } = parsed.data;

    // Counting and inserting in one serialisable transaction: two tabs saving at the same
    // moment would both read 49 and both insert, and the limit would not be one.
    const save = () =>
      this.prisma.$transaction(
        async (tx) => {
          if ((await tx.project.count({ where: { userId } })) >= MAX_PROJECTS) {
            throw new BadRequestException({
              message: `Você já tem ${MAX_PROJECTS} projetos salvos. Apague algum para salvar outro.`,
            });
          }
          return tx.project.create({
            data: { userId, name, scripts: scripts as Prisma.InputJsonValue },
            select: { id: true, name: true, createdAt: true, updatedAt: true },
          });
        },
        { isolationLevel: 'Serializable' },
      );

    // PostgreSQL aborts one of two conflicting transactions; the loser simply goes again.
    return save().catch((error: unknown) =>
      isWriteConflict(error) ? save() : Promise.reject(error),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() request: Request, @Param('id') id: string) {
    const { count } = await this.prisma.project.deleteMany({
      where: { id, userId: userOf(request).id },
    });
    if (count === 0) throw new NotFoundException({ message: 'Projeto não encontrado.' });
  }
}

/**
 * A transaction PostgreSQL rolled back because another one touched the same rows
 * (`40001`/`40P01`, which Prisma reports as `P2034`). Nothing was written, so running it
 * again is safe and is what the server should do instead of blaming the user.
 */
function isWriteConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P2034' || code === '40001' || code === '40P01';
}

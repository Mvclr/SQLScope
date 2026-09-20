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
    if ((await this.prisma.project.count({ where: { userId } })) >= MAX_PROJECTS) {
      throw new BadRequestException({
        message: `Você já tem ${MAX_PROJECTS} projetos salvos. Apague algum para salvar outro.`,
      });
    }
    return this.prisma.project.create({
      data: {
        userId,
        name: parsed.data.name,
        scripts: parsed.data.scripts as Prisma.InputJsonValue,
      },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
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

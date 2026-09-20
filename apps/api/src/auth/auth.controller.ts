import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { CONFIG, type Config } from '../config.js';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { sessionIdFromCookie } from '../sessions/session.guard.js';
import { AuthService } from './auth.service.js';
import { USER_COOKIE, userIdFromCookie } from './user.guard.js';

const Credentials = z.object({
  email: z.email().max(320),
  // Length beats composition rules; long passphrases are both safer and easier.
  password: z.string().min(10).max(200),
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'register', windowSeconds: 3_600, perClient: 10 })
  async register(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    const { email, password } = this.parse(body);
    const created = await this.auth.signUp(email, password);
    if (!created.ok) throw new ConflictException({ message: 'Este e-mail já tem conta.' });

    await this.signIn(request, response, created.value.id);
    response.status(HttpStatus.CREATED);
    return { id: created.value.id, email: created.value.email };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'login', windowSeconds: 900, perClient: 20 })
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    const { email, password } = this.parse(body);
    const user = await this.auth.signIn(email, password);
    // Same answer either way: which half was wrong is not the caller's business.
    if (!user.ok) throw new UnauthorizedException({ message: 'E-mail ou senha incorretos.' });

    await this.signIn(request, response, user.value.id);
    return { id: user.value.id, email: user.value.email };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(USER_COOKIE, this.cookieOptions());
  }

  /**
   * Who the browser is, if anybody. Not guarded: "nobody is signed in" is the answer to
   * this question, not a failure to answer it, and every visitor asks it once.
   */
  @Get('me')
  async me(@Req() request: Request) {
    const id = userIdFromCookie(request);
    const user = id ? await this.auth.findById(id) : null;
    return { user: user && { id: user.id, email: user.email } };
  }

  private parse(body: unknown) {
    const parsed = Credentials.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    return parsed.data;
  }

  /** Signs the browser in and hands it the sandbox it was already using. */
  private async signIn(request: Request, response: Response, userId: string) {
    response.cookie(USER_COOKIE, userId, this.cookieOptions());
    await this.auth.claimSession(userId, sessionIdFromCookie(request));
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: this.config.COOKIE_SECURE,
      path: '/',
      maxAge: THIRTY_DAYS_MS,
    };
  }
}

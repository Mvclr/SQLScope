import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { err, ok, type Result } from '@sqlscope/core';
import type { PrismaClient, User } from '../generated/prisma/client.js';
import { PRISMA } from '../infrastructure/infrastructure.module.js';

export type SignUpRefusal = 'email-taken';
export type SignInRefusal = 'invalid-credentials';

/**
 * OWASP's argon2id baseline: 19 MiB, two passes. Slow on purpose — a stolen database of
 * hashes should not turn into a database of passwords.
 */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class AuthService {
  /**
   * A real hash of a value nobody knows. Verifying against it costs the same as verifying
   * a genuine one, so an unknown e-mail takes as long to reject as a wrong password.
   */
  private readonly decoyHash = hash(randomBytes(32).toString('hex'), ARGON2);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async signUp(email: string, password: string): Promise<Result<User, SignUpRefusal>> {
    const normalized = normalizeEmail(email);
    if (await this.prisma.user.findUnique({ where: { email: normalized } })) {
      return err('email-taken');
    }
    return ok(
      await this.prisma.user.create({
        data: { email: normalized, passwordHash: await hash(password, ARGON2) },
      }),
    );
  }

  /**
   * Verifies a password. A missing account still pays for one hash, so the response time
   * does not reveal which e-mails exist.
   */
  async signIn(email: string, password: string): Promise<Result<User, SignInRefusal>> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    const against = user?.passwordHash ?? (await this.decoyHash);
    const matches = await verify(against, password).catch(() => false);
    return user && matches ? ok(user) : err('invalid-credentials');
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** Attaches the sandbox the browser is already using to the account that just signed in. */
  async claimSession(userId: string, sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId: null },
      data: { userId },
    });
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

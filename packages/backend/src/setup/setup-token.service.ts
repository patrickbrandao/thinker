import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';

/**
 * One-time setup token (#29).
 *
 * On a fresh install (no user yet) the backend generates a random token,
 * keeps only its SHA-256 in memory and prints the token to the server log.
 * The setup wizard must present it, so whoever reaches a freshly exposed
 * instance first cannot claim it without access to the logs. The token stops
 * working once the first admin exists and is never written anywhere else.
 *
 * Each process keeps its own token: run the first setup against a single
 * replica.
 */
@Injectable()
export class SetupTokenService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupTokenService.name);
  private tokenHash: Buffer | null = null;

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const rows = (await this.dataSource.query(
        `SELECT EXISTS (SELECT 1 FROM "user") AS "exists"`,
      )) as Array<{ exists: boolean }>;
      if (rows[0]?.exists !== true) this.issue();
    } catch (error) {
      // The auth tables may not exist yet (tests without Better Auth's
      // schema). The wizard issues a token lazily when it is first used.
      this.logger.debug(
        `Setup token not issued at boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** True when a token is waiting to be used. */
  get hasToken(): boolean {
    return this.tokenHash !== null;
  }

  /**
   * Generates a new token, replacing any previous one, and prints it to the
   * log. Returns it for callers that need it (tests).
   */
  issue(): string {
    const token = randomBytes(24).toString('base64url');
    this.tokenHash = digest(token);
    this.logger.warn(
      `No admin account exists yet. Open /setup and enter this one-time setup token: ${token}`,
    );
    return token;
  }

  /** Issues a token only if none is pending. */
  ensureIssued(): void {
    if (!this.tokenHash) this.issue();
  }

  /** Constant-time check of a presented token against the pending one. */
  verify(token: string | undefined | null): boolean {
    if (!this.tokenHash || typeof token !== 'string' || token.length === 0) return false;
    return timingSafeEqual(digest(token), this.tokenHash);
  }

  /** Invalidates the token once the first admin exists. */
  consume(): void {
    this.tokenHash = null;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

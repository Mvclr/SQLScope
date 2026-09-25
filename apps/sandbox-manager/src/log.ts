/** The slice of pino the services use, so tests can pass a silent stand-in. */
export interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const silentLog: Log = { info() {}, warn() {}, error() {} };

/** Injected everywhere a deadline is computed, so tests can move time forward. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

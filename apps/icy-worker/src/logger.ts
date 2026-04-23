/**
 * Structured JSON logger. Emits one NDJSON line per event to stdout.
 * Fly.io captures stdout; downstream aggregators (session 2+) can filter by event name.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEvent {
  level: LogLevel;
  event: string;
  fields?: Record<string, unknown>;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

function emit(entry: LogEvent): void {
  const payload = {
    ts: new Date().toISOString(),
    level: entry.level,
    event: entry.event,
    ...(entry.fields ?? {}),
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

export const logger: Logger = {
  info: (event, fields) => emit({ level: "info", event, fields }),
  warn: (event, fields) => emit({ level: "warn", event, fields }),
  error: (event, fields) => emit({ level: "error", event, fields }),
};

/**
 * Structured Logger
 *
 * Lightweight structured logger for ThoughtLayer library code.
 * JSON output with level, timestamp, component, and context.
 * No external dependencies.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  component: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface LoggerConfig {
  level: LogLevel;
  json: boolean;
}

let globalConfig: LoggerConfig = {
  level: 'warn',
  json: false,
};

/**
 * Configure the global logger.
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Create a component-scoped logger.
 */
export function createLogger(component: string) {
  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[globalConfig.level];
  }

  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      component,
      message,
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
    };

    if (globalConfig.json) {
      const stream = level === 'error' || level === 'warn' ? console.error : console.log;
      stream(JSON.stringify(entry));
    } else {
      const prefix = `[${component}]`;
      const stream = level === 'error' || level === 'warn' ? console.error : console.log;
      if (context && Object.keys(context).length > 0) {
        stream(`${prefix} ${message}`, context);
      } else {
        stream(`${prefix} ${message}`);
      }
    }
  }

  return {
    debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
    info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
    warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
    error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
  };
}

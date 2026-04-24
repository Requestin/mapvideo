import pino, { type LoggerOptions } from 'pino';

// Level is controlled by LOG_LEVEL env var; 'info' in production, 'debug'
// is typical for dev. Acceptable values: fatal|error|warn|info|debug|trace|silent.
const level = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';

const options: LoggerOptions = {
  name: 'mapvideo-backend',
  level,
  // Do not leak secrets that may appear in bound child-logger bindings.
  redact: {
    paths: ['password', 'password_hash', 'token', '*.password', '*.token', '*.password_hash'],
    censor: '[REDACTED]',
  },
};

// Dev: pino-pretty transport for colored, human-readable lines.
// Prod: plain newline-delimited JSON to stdout — ready for any log collector.
if (!isProduction) {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  };
}

export const logger = pino(options);

/**
 * Logging utility that respects environment
 */

const isDevelopment = process.env.NODE_ENV === 'development';

export const logger = {
  log: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.log(...args);
    }
  },
  
  error: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.error(...args);
    }
    // TODO: In production, send to monitoring service (e.g., Sentry)
    // if (!isDevelopment) {
    //   sendToMonitoring({ level: 'error', message: args });
    // }
  },
  
  warn: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },
  
  info: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.info(...args);
    }
  },
};

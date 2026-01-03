// Logging utility for debug output
// Set DEBUG env variable to enable: DEBUG=true npm run dev

const DEBUG = process.env.DEBUG === 'true';

export const logger = {
  debug: (message: string, data?: any) => {
    if (DEBUG) {
      console.log(`[DEBUG] ${message}`, data || '');
    }
  },
  
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${message}`, data || '');
  },
  
  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data || '');
  },
  
  error: (message: string, data?: any) => {
    console.error(`[ERROR] ${message}`, data || '');
  },
};

export default logger;

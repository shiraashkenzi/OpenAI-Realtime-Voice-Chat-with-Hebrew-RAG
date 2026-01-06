/**
 * Configuration constants for the application
 */

export const AUDIO_CONFIG = {
  SAMPLE_RATE: 24000,
  BITS_PER_SAMPLE: 16,
} as const;

export const TEXT_ANALYSIS = {
  MIN_QUESTION_LENGTH: 10, // Minimum chars to consider as question
  SESSION_UPDATE_DELAY_MS: 50,
  INSTRUCTIONS_RESET_DELAY_MS: 200,
  SEARCH_CACHE_TTL_MS: 60000, // 1 minute
} as const;

export const API_CONFIG = {
  MAX_INPUT_LENGTH: 500,
  REQUEST_TIMEOUT_MS: 10000,
} as const;

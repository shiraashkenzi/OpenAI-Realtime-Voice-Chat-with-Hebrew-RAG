/**
 * Input sanitization utilities
 */

import { API_CONFIG } from '@/app/constants/config';

/**
 * Sanitize user input to prevent XSS and limit length
 */
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .slice(0, API_CONFIG.MAX_INPUT_LENGTH)
    .replace(/[<>]/g, ''); // Basic XSS prevention
}

/**
 * Validate search query
 */
export function isValidQuery(query: string): boolean {
  const sanitized = sanitizeInput(query);
  return sanitized.length > 0 && sanitized.length <= API_CONFIG.MAX_INPUT_LENGTH;
}

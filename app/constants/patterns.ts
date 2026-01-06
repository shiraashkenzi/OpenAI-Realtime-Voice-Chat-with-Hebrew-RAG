/**
 * Text pattern matching for greeting and question detection
 */

export const GREETING_PATTERNS = {
  he: ['שלום', 'היי', 'הי', 'מה נשמע', 'מה קורה', 'בוקר טוב', 'ערב טוב'],
  en: ['hello', 'hi', 'hey', 'good morning', 'good evening'],
} as const;

export const QUESTION_WORDS = {
  he: ['מה', 'איך', 'למה', 'מתי', 'איפה', 'כמה', 'האם'],
  en: ['what', 'how', 'why', 'when', 'where', 'which'],
} as const;

/**
 * Check if text is a casual greeting
 */
export function isGreeting(text: string): boolean {
  const allGreetings = [...GREETING_PATTERNS.he, ...GREETING_PATTERNS.en];
  const pattern = new RegExp(`^(${allGreetings.join('|')})\\s*[?!.]*\\s*$`, 'i');
  return pattern.test(text.trim());
}

/**
 * Check if text has question indicators
 */
export function hasQuestionIndicator(text: string): boolean {
  const allQuestionWords = [...QUESTION_WORDS.he, ...QUESTION_WORDS.en];
  const wordPattern = new RegExp(`(${allQuestionWords.join('|')})`, 'i');
  return wordPattern.test(text) || text.includes('?');
}

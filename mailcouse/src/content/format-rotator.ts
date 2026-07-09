// Plain text / HTML alternation

import { EmailFormat } from './types';

// HTML templates with randomized class names
const HTML_TEMPLATES = [
  `<div style="font-family: Arial, sans-serif; line-height: 1.6;">
    <p>{{body}}</p>
    <p style="margin-top: 20px;">{{signature}}</p>
  </div>`,
  `<div style="font-family: Helvetica, sans-serif; line-height: 1.5;">
    <p>{{body}}</p>
    <p style="margin-top: 15px; color: #555;">{{signature}}</p>
  </div>`,
  `<div style="font-family: sans-serif; line-height: 1.7;">
    {{body}}
    <p style="margin-top: 25px;">{{signature}}</p>
  </div>`,
];

// Random class names for HTML variation
const CLASS_NAMES = [
  'content', 'message', 'email-body', 'main-text',
  'body-content', 'message-body', 'email-content',
];

/**
 * Convert plain text to HTML with random variations
 */
export function textToHtml(text: string, signature?: string): string {
  const template = HTML_TEMPLATES[Math.floor(Math.random() * HTML_TEMPLATES.length)];
  const className = CLASS_NAMES[Math.floor(Math.random() * CLASS_NAMES.length)];

  let html = template
    .replace('{{body}}', text.split('\n').map(line => `<p>${line}</p>`).join(''))
    .replace('{{signature}}', signature || '');

  // Randomize class names
  html = html.replace(/class="[^"]*"/g, `class="${className}-${Math.random().toString(36).substr(2, 5)}"`);

  return html;
}

/**
 * Format email based on format type
 */
export function formatEmail(
  content: string,
  format: EmailFormat,
  signature?: string
): string {
  if (format === 'html') {
    return textToHtml(content, signature);
  }
  return content;
}

/**
 * Alternate format for a batch of emails
 */
export function alternateFormats(count: number): EmailFormat[] {
  const formats: EmailFormat[] = [];
  for (let i = 0; i < count; i++) {
    formats.push(i % 2 === 0 ? 'plain' : 'html');
  }
  // Shuffle to avoid predictable patterns
  return shuffleArray(formats);
}

/**
 * Get random format
 */
export function getRandomFormat(): EmailFormat {
  return Math.random() > 0.5 ? 'html' : 'plain';
}

/**
 * Shuffle array (Fisher-Yates)
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

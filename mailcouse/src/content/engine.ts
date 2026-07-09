// Main content engine orchestrator

import { query } from '../db/connection';
import { parseSpintax, countVariations, generateVariations } from './spintax-processor';
import { resolveTokens, stripUnresolvedTokens, createDefaultTokens } from './personalizer';
import { formatEmail, getRandomFormat } from './format-rotator';
import { checkSpam, cleanSpam } from './spam-guard';
import { getTemplate } from './template-manager';
import { OPENING_LINES, SIGNATURES } from './types';
import { RenderedEmail, PersonalizationTokens, EmailFormat, LengthTier } from './types';

/**
 * Generate a rendered email from template and tokens
 */
export async function generateEmail(
  templateId: string,
  tokens: PersonalizationTokens,
  options: {
    format?: EmailFormat;
    opening_line?: string;
    signature?: string;
  } = {}
): Promise<RenderedEmail> {
  // Get template
  const template = await getTemplate(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // Parse spintax for subject and body
  let subject = parseSpintax(template.subject_spintax);
  let body = parseSpintax(template.body_spintax);

  // Add opening line if provided
  if (options.opening_line) {
    body = `${options.opening_line}\n\n${body}`;
  }

  // Add signature
  const signature = options.signature || SIGNATURES[Math.floor(Math.random() * SIGNATURES.length)];
  body = `${body}\n\n${signature}`;

  // Resolve personalization tokens
  subject = resolveTokens(subject, tokens);
  body = resolveTokens(body, tokens);

  // Strip any unresolved tokens
  subject = stripUnresolvedTokens(subject);
  body = stripUnresolvedTokens(body);

  // Check for spam
  const spamCheck = checkSpam(`${subject}\n${body}`);
  if (!spamCheck.passed) {
    const cleaned = cleanSpam(`${subject}\n${body}`);
    const cleanedParts = cleaned.cleaned.split('\n\n');
    subject = cleanedParts[0] || subject;
    body = cleanedParts.slice(1).join('\n\n') || body;
  }

  // Format email
  const format = options.format || template.format || getRandomFormat();
  const formattedBody = formatEmail(body, format, signature);

  // Generate variation ID
  const variationId = `${templateId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return {
    subject,
    body: formattedBody,
    format,
    from_name: tokens.sender_name || '',
    variation_id: variationId,
  };
}

/**
 * Generate multiple variations of an email
 */
export async function generateVariationsBatch(
  templateId: string,
  tokens: PersonalizationTokens,
  count: number
): Promise<RenderedEmail[]> {
  const template = await getTemplate(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const variations: RenderedEmail[] = [];
  const usedSubjects = new Set<string>();

  for (let i = 0; i < count; i++) {
    let subject: string;
    let attempts = 0;

    // Ensure unique subject lines
    do {
      subject = parseSpintax(template.subject_spintax);
      subject = resolveTokens(subject, tokens);
      subject = stripUnresolvedTokens(subject);
      attempts++;
    } while (usedSubjects.has(subject) && attempts < 50);

    usedSubjects.add(subject);

    // Get random opening line for this industry
    const industryLines = OPENING_LINES[tokens.industry || 'cybersecurity'] || OPENING_LINES.cybersecurity;
    const openingLine = industryLines[Math.floor(Math.random() * industryLines.length)];

    // Generate email with unique variation
    const email = await generateEmail(templateId, tokens, {
      opening_line: openingLine,
      format: getRandomFormat(),
    });

    // Override subject with unique one
    email.subject = subject;
    variations.push(email);
  }

  return variations;
}

/**
 * Get content statistics
 */
export async function getContentStats(): Promise<{
  templates: number;
  variations_per_template: number;
  spam_rules: number;
}> {
  const templateResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM templates'
  );

  return {
    templates: parseInt(String(templateResult.rows[0]?.count || '0')),
    variations_per_template: 50, // Target from TSD
    spam_rules: 25, // Approximate number of spam rules
  };
}

// Template CRUD and versioning

import { query } from '../db/connection';
import { Template, EmailFormat, LengthTier } from './types';

/**
 * Create a new template
 */
export async function createTemplate(template: {
  name: string;
  industry: string;
  subject_spintax: string;
  body_spintax: string;
  format?: EmailFormat;
  length_tier?: LengthTier;
}): Promise<Template> {
  const result = await query<Template>(
    `INSERT INTO templates (id, name, industry, subject_spintax, body_spintax, format, length_tier, version, created_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, 1, NOW())
     RETURNING *`,
    [
      template.name,
      template.industry,
      template.subject_spintax,
      template.body_spintax,
      template.format || 'plain',
      template.length_tier || 'medium',
    ]
  );

  return result.rows[0];
}

/**
 * Get template by ID
 */
export async function getTemplate(id: string): Promise<Template | null> {
  const result = await query<Template>(
    'SELECT * FROM templates WHERE id = $1',
    [id]
  );

  return result.rows[0] || null;
}

/**
 * Get templates by industry
 */
export async function getTemplatesByIndustry(
  industry: string
): Promise<Template[]> {
  const result = await query<Template>(
    'SELECT * FROM templates WHERE industry = $1 ORDER BY version DESC',
    [industry]
  );

  return result.rows;
}

/**
 * Update template
 */
export async function updateTemplate(
  id: string,
  updates: Partial<{
    name: string;
    subject_spintax: string;
    body_spintax: string;
    format: EmailFormat;
    length_tier: LengthTier;
  }>
): Promise<Template | null> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return null;

  values.push(id);
  const result = await query<Template>(
    `UPDATE templates SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

/**
 * Create new version of template
 */
export async function createNewVersion(
  templateId: string,
  updates: Partial<{
    subject_spintax: string;
    body_spintax: string;
    format: EmailFormat;
    length_tier: LengthTier;
  }>
): Promise<Template> {
  // Get current template
  const current = await getTemplate(templateId);
  if (!current) throw new Error('Template not found');

  // Get latest version number
  const versionResult = await query<{ max_version: number }>(
    'SELECT MAX(version) as max_version FROM templates WHERE name = $1',
    [current.name]
  );

  const newVersion = (versionResult.rows[0]?.max_version || 0) + 1;

  // Create new version
  return createTemplate({
    name: current.name,
    industry: current.industry,
    subject_spintax: updates.subject_spintax || current.subject_spintax,
    body_spintax: updates.body_spintax || current.body_spintax,
    format: updates.format || current.format,
    length_tier: updates.length_tier || current.length_tier,
  });
}

/**
 * Delete template
 */
export async function deleteTemplate(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM templates WHERE id = $1',
    [id]
  );

  return (result.rowCount || 0) > 0;
}

/**
 * Get template statistics
 */
export async function getTemplateStats(): Promise<{
  total: number;
  by_industry: { industry: string; count: number }[];
  by_format: { format: string; count: number }[];
}> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM templates'
  );

  const industryResult = await query<{ industry: string; count: number }>(
    'SELECT industry, COUNT(*) as count FROM templates GROUP BY industry'
  );

  const formatResult = await query<{ format: string; count: number }>(
    'SELECT format, COUNT(*) as count FROM templates GROUP BY format'
  );

  return {
    total: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_industry: industryResult.rows.map((r) => ({
      industry: r.industry,
      count: parseInt(String(r.count)),
    })),
    by_format: formatResult.rows.map((r) => ({
      format: r.format,
      count: parseInt(String(r.count)),
    })),
  };
}

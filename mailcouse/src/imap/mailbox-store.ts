import bcrypt from 'bcryptjs';
import { simpleParser } from 'mailparser';
import { query, transaction } from '../db/connection';

export type MailboxAccount = {
  id: string;
  organization_id: string;
  customer_domain_id: string | null;
  email: string;
  display_name: string | null;
  quota_mb: number;
  active: boolean;
  imap_enabled: boolean;
  smtp_enabled: boolean;
  smtp_tier: string;
};

export type MailboxFolder = {
  id: string;
  mailbox_id: string;
  name: string;
  special_use: string | null;
  uid_validity: number;
  uid_next: number;
};

export type MailboxMessage = {
  id: string;
  mailbox_id: string;
  folder_id: string;
  uid: number;
  raw_source: string;
  subject: string | null;
  from_text: string | null;
  to_text: string | null;
  body_text: string | null;
  body_html: string | null;
  internal_date: Date;
  size: number;
  flags: string[];
};

function addressText(value: any): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.map((item) => item.text).filter(Boolean).join(', ') || null;
  return value.text || null;
}

const DEFAULT_FOLDERS = [
  { name: 'INBOX', special_use: '\\Inbox' },
  { name: 'Sent', special_use: '\\Sent' },
  { name: 'Drafts', special_use: '\\Drafts' },
  { name: 'Trash', special_use: '\\Trash' },
  { name: 'Junk', special_use: '\\Junk' },
  { name: 'Archive', special_use: '\\Archive' },
];

export function normalizeMailboxEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function isValidMailboxEmail(email: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeMailboxEmail(email));
}

export async function ensureDefaultFolders(mailboxId: string): Promise<void> {
  for (const folder of DEFAULT_FOLDERS) {
    await query(
      `INSERT INTO mailbox_folders (mailbox_id, name, special_use)
       VALUES ($1, $2, $3)
       ON CONFLICT (mailbox_id, name) DO NOTHING`,
      [mailboxId, folder.name, folder.special_use]
    );
  }
}

export async function createMailboxAccount(input: {
  orgId: string;
  customerDomainId: string;
  email: string;
  displayName?: string | null;
  password: string;
  quotaMb?: number;
  active?: boolean;
  imapEnabled?: boolean;
  smtpEnabled?: boolean;
  smtpTier?: string;
}): Promise<{ id: string }> {
  const email = normalizeMailboxEmail(input.email);
  const hash = await bcrypt.hash(input.password, 10);
  const result = await query<{ id: string }>(
    `INSERT INTO mailbox_accounts
       (organization_id, customer_domain_id, email, display_name, password_hash, quota_mb, active, imap_enabled, smtp_enabled, smtp_tier)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.orgId,
      input.customerDomainId,
      email,
      input.displayName || null,
      hash,
      input.quotaMb || 1024,
      input.active !== false,
      input.imapEnabled !== false,
      input.smtpEnabled !== false,
      input.smtpTier || 'personal',
    ]
  );
  await ensureDefaultFolders(result.rows[0].id);
  return result.rows[0];
}

export async function updateMailboxAccount(input: {
  id: string;
  orgId: string;
  displayName?: string | null;
  password?: string | null;
  quotaMb?: number;
  active?: boolean;
  imapEnabled?: boolean;
  smtpEnabled?: boolean;
  smtpTier?: string;
}): Promise<void> {
  const hash = input.password ? await bcrypt.hash(input.password, 10) : null;
  await query(
    `UPDATE mailbox_accounts
     SET display_name = $1,
         quota_mb = $2,
         active = $3,
         imap_enabled = $4,
         smtp_enabled = $5,
         smtp_tier = $6,
         password_hash = COALESCE($7, password_hash)
     WHERE id = $8 AND organization_id = $9`,
    [
      input.displayName || null,
      input.quotaMb || 1024,
      input.active !== false,
      input.imapEnabled !== false,
      input.smtpEnabled !== false,
      input.smtpTier || 'personal',
      hash,
      input.id,
      input.orgId,
    ]
  );
  await ensureDefaultFolders(input.id);
}

export async function authenticateMailbox(emailInput: string, password: string, remoteAddr?: string): Promise<MailboxAccount | null> {
  const email = normalizeMailboxEmail(emailInput);
  const result = await query<MailboxAccount & { password_hash: string }>(
    `SELECT id, organization_id, customer_domain_id, email, display_name, quota_mb, active, imap_enabled, smtp_enabled, smtp_tier, password_hash
     FROM mailbox_accounts
     WHERE LOWER(email) = $1`,
    [email]
  );
  const mailbox = result.rows[0];
  const success = !!mailbox && mailbox.active && mailbox.imap_enabled && await bcrypt.compare(password || '', mailbox.password_hash);
  await query(
    `INSERT INTO mailbox_auth_logs (mailbox_id, email, protocol, remote_addr, success, details)
     VALUES ($1, $2, 'imap', $3, $4, $5)`,
    [mailbox?.id || null, email, remoteAddr || null, success, success ? 'Login accepted' : 'Login rejected']
  );
  if (!success) return null;
  await query('UPDATE mailbox_accounts SET last_login_at = NOW() WHERE id = $1', [mailbox.id]);
  return mailbox;
}

export async function listFolders(mailboxId: string): Promise<MailboxFolder[]> {
  await ensureDefaultFolders(mailboxId);
  const result = await query<MailboxFolder>(
    'SELECT id, mailbox_id, name, special_use, uid_validity, uid_next FROM mailbox_folders WHERE mailbox_id = $1 ORDER BY CASE WHEN name = $2 THEN 0 ELSE 1 END, name',
    [mailboxId, 'INBOX']
  );
  return result.rows;
}

export async function getFolder(mailboxId: string, folderName: string): Promise<MailboxFolder | null> {
  await ensureDefaultFolders(mailboxId);
  const rawName = (folderName || 'INBOX').trim();
  const cleanName = rawName.replace(/^INBOX[./]/i, '').trim();
  const leafName = rawName.split(/[./\\]+/).filter(Boolean).pop()?.trim() || 'INBOX';

  const result = await query<MailboxFolder>(
    `SELECT id, mailbox_id, name, special_use, uid_validity, uid_next 
     FROM mailbox_folders 
     WHERE mailbox_id = $1 
       AND (
         LOWER(name) = LOWER($2) 
         OR LOWER(name) = LOWER($3) 
         OR LOWER(name) = LOWER($4)
         OR LOWER(special_use) = LOWER($5)
         OR LOWER(special_use) = LOWER($6)
       )
     ORDER BY 
       CASE 
         WHEN LOWER(name) = LOWER($2) THEN 0 
         WHEN LOWER(name) = LOWER($3) THEN 1
         WHEN LOWER(name) = LOWER($4) THEN 2
         ELSE 3 
       END
     LIMIT 1`,
    [
      mailboxId,
      rawName,
      cleanName || rawName,
      leafName,
      `\\${leafName}`,
      `\\${cleanName || rawName}`
    ]
  );
  return result.rows[0] || null;
}

export async function getFolderStats(folderId: string): Promise<{ exists: number; unseen: number; uidNext: number; uidValidity: number }> {
  const result = await query<{ exists: string; unseen: string; uid_next: number; uid_validity: number }>(
    `SELECT COUNT(mm.id)::text as exists,
            COUNT(mm.id) FILTER (WHERE NOT (mm.flags @> ARRAY['\\Seen']::TEXT[]))::text as unseen,
            mf.uid_next,
            mf.uid_validity
     FROM mailbox_folders mf
     LEFT JOIN mailbox_messages mm ON mm.folder_id = mf.id
     WHERE mf.id = $1
     GROUP BY mf.uid_next, mf.uid_validity`,
    [folderId]
  );
  const row = result.rows[0];
  return {
    exists: parseInt(row?.exists || '0', 10),
    unseen: parseInt(row?.unseen || '0', 10),
    uidNext: row?.uid_next || 1,
    uidValidity: row?.uid_validity || 1,
  };
}

export async function appendMessage(input: {
  mailboxId: string;
  folderName?: string;
  rawSource: string;
  flags?: string[];
  internalDate?: Date;
}): Promise<MailboxMessage> {
  const folder = await getFolder(input.mailboxId, input.folderName || 'INBOX');
  if (!folder) throw new Error('Mailbox folder not found');
  const parsed = await simpleParser(Buffer.from(input.rawSource));
  return transaction(async (client) => {
    const folderResult = await client.query<{ uid_next: number }>(
      'UPDATE mailbox_folders SET uid_next = uid_next + 1 WHERE id = $1 RETURNING uid_next - 1 as uid_next',
      [folder.id]
    );
    const uid = folderResult.rows[0].uid_next;
    const messageResult = await client.query<MailboxMessage>(
      `INSERT INTO mailbox_messages
         (mailbox_id, folder_id, uid, raw_source, headers_json, subject, from_text, to_text, body_text, body_html, internal_date, size, flags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()), $12, $13)
       RETURNING *`,
      [
        input.mailboxId,
        folder.id,
        uid,
        input.rawSource,
        JSON.stringify(Object.fromEntries(parsed.headers || new Map())),
        parsed.subject || null,
        addressText(parsed.from),
        addressText(parsed.to),
        parsed.text || null,
        parsed.html || null,
        input.internalDate || null,
        Buffer.byteLength(input.rawSource),
        input.flags || [],
      ]
    );
    return messageResult.rows[0];
  });
}

export async function listMessages(folderId: string, limit = 50): Promise<MailboxMessage[]> {
  const result = await query<MailboxMessage>(
    'SELECT * FROM mailbox_messages WHERE folder_id = $1 ORDER BY uid DESC LIMIT $2',
    [folderId, limit]
  );
  return result.rows;
}

export async function listMessagesBySequence(folderId: string): Promise<MailboxMessage[]> {
  const result = await query<MailboxMessage>(
    'SELECT * FROM mailbox_messages WHERE folder_id = $1 ORDER BY uid ASC',
    [folderId]
  );
  return result.rows;
}

export async function setMessageFlags(folderId: string, uid: number, flags: string[]): Promise<void> {
  await query(
    'UPDATE mailbox_messages SET flags = $1 WHERE folder_id = $2 AND uid = $3',
    [Array.from(new Set(flags)), folderId, uid]
  );
}

export async function searchMessages(folderId: string, term?: string): Promise<number[]> {
  if (!term || term.toUpperCase() === 'ALL') {
    const all = await query<{ uid: number }>('SELECT uid FROM mailbox_messages WHERE folder_id = $1 ORDER BY uid ASC', [folderId]);
    return all.rows.map((r) => r.uid);
  }
  const needle = `%${term}%`;
  const result = await query<{ uid: number }>(
    `SELECT uid FROM mailbox_messages
     WHERE folder_id = $1 AND (subject ILIKE $2 OR from_text ILIKE $2 OR to_text ILIKE $2 OR body_text ILIKE $2)
     ORDER BY uid ASC`,
    [folderId, needle]
  );
  return result.rows.map((r) => r.uid);
}

export async function moveMessages(
  mailboxId: string,
  sourceFolderId: string,
  targetFolderId: string,
  uids: number[]
): Promise<Array<{ sourceUid: number; destUid: number }>> {
  console.log('[MAILCOUSE DB moveMessages:START]', { mailboxId, sourceFolderId, targetFolderId, uids });
  if (!uids || uids.length === 0) return [];
  return transaction(async (client) => {
    const msgsResult = await client.query<MailboxMessage>(
      'SELECT * FROM mailbox_messages WHERE folder_id = $1 AND uid = ANY($2::int[]) ORDER BY uid ASC',
      [sourceFolderId, uids]
    );
    const msgs = msgsResult.rows;
    console.log('[MAILCOUSE DB moveMessages:FOUND]', { count: msgs.length, uids: msgs.map((m) => m.uid) });
    if (msgs.length === 0) return [];

    const folderResult = await client.query<{ base_uid: number }>(
      'UPDATE mailbox_folders SET uid_next = uid_next + $1 WHERE id = $2 RETURNING uid_next - $1 as base_uid',
      [msgs.length, targetFolderId]
    );
    const baseUid = folderResult.rows[0].base_uid;
    const mapping: Array<{ sourceUid: number; destUid: number }> = [];

    for (let i = 0; i < msgs.length; i++) {
      const destUid = baseUid + i;
      await client.query(
        'UPDATE mailbox_messages SET folder_id = $1, uid = $2 WHERE id = $3',
        [targetFolderId, destUid, msgs[i].id]
      );
      mapping.push({ sourceUid: msgs[i].uid, destUid });
    }
    console.log('[MAILCOUSE DB moveMessages:SUCCESS]', { movedCount: mapping.length, mapping });
    return mapping;
  });
}

export async function copyMessages(
  mailboxId: string,
  sourceFolderId: string,
  targetFolderId: string,
  uids: number[]
): Promise<Array<{ sourceUid: number; destUid: number }>> {
  console.log('[MAILCOUSE DB copyMessages:START]', { mailboxId, sourceFolderId, targetFolderId, uids });
  if (!uids || uids.length === 0) return [];
  return transaction(async (client) => {
    const msgsResult = await client.query<MailboxMessage>(
      'SELECT * FROM mailbox_messages WHERE folder_id = $1 AND uid = ANY($2::int[]) ORDER BY uid ASC',
      [sourceFolderId, uids]
    );
    const msgs = msgsResult.rows;
    console.log('[MAILCOUSE DB copyMessages:FOUND]', { count: msgs.length, uids: msgs.map((m) => m.uid) });
    if (msgs.length === 0) return [];

    const folderResult = await client.query<{ base_uid: number }>(
      'UPDATE mailbox_folders SET uid_next = uid_next + $1 WHERE id = $2 RETURNING uid_next - $1 as base_uid',
      [msgs.length, targetFolderId]
    );
    const baseUid = folderResult.rows[0].base_uid;
    const mapping: Array<{ sourceUid: number; destUid: number }> = [];

    for (let i = 0; i < msgs.length; i++) {
      const destUid = baseUid + i;
      const m = msgs[i];
      await client.query(
        `INSERT INTO mailbox_messages
           (mailbox_id, folder_id, uid, raw_source, headers_json, subject, from_text, to_text, body_text, body_html, internal_date, size, flags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          mailboxId,
          targetFolderId,
          destUid,
          m.raw_source,
          (m as any).headers_json,
          m.subject,
          m.from_text,
          m.to_text,
          m.body_text,
          m.body_html,
          m.internal_date,
          m.size,
          m.flags || [],
        ]
      );
      mapping.push({ sourceUid: m.uid, destUid });
    }
    console.log('[MAILCOUSE DB copyMessages:SUCCESS]', { copiedCount: mapping.length, mapping });
    return mapping;
  });
}

export async function expungeMessages(folderId: string, uids?: number[]): Promise<number[]> {
  console.log('[MAILCOUSE DB expungeMessages:START]', { folderId, uids });
  let sql: string;
  let params: any[];

  if (uids && uids.length > 0) {
    sql = `DELETE FROM mailbox_messages 
           WHERE folder_id = $1 
             AND uid = ANY($2::int[])
             AND (
               '\\Deleted' = ANY(flags) 
               OR '\\\\Deleted' = ANY(flags) 
               OR 'Deleted' = ANY(flags) 
               OR flags::text ILIKE '%Deleted%'
               OR TRUE
             )
           RETURNING uid`;
    params = [folderId, uids];
  } else {
    sql = `DELETE FROM mailbox_messages 
           WHERE folder_id = $1 
             AND (
               '\\Deleted' = ANY(flags) 
               OR '\\\\Deleted' = ANY(flags) 
               OR 'Deleted' = ANY(flags) 
               OR flags::text ILIKE '%Deleted%'
             )
           RETURNING uid`;
    params = [folderId];
  }

  const result = await query<{ uid: number }>(sql, params);
  const deletedUids = result.rows.map((r) => r.uid);
  console.log('[MAILCOUSE DB expungeMessages:SUCCESS]', { deletedCount: deletedUids.length, deletedUids });
  return deletedUids;
}

export async function deleteMessageByUid(folderId: string, uid: number): Promise<boolean> {
  console.log('[MAILCOUSE DB deleteMessageByUid:START]', { folderId, uid });
  const result = await query('DELETE FROM mailbox_messages WHERE folder_id = $1 AND uid = $2', [folderId, uid]);
  const deleted = (result.rowCount ?? 0) > 0;
  console.log('[MAILCOUSE DB deleteMessageByUid:RESULT]', { folderId, uid, deleted });
  return deleted;
}

export async function deleteMessageById(mailboxId: string, messageId: string): Promise<boolean> {
  console.log('[MAILCOUSE DB deleteMessageById:START]', { mailboxId, messageId });
  const result = await query('DELETE FROM mailbox_messages WHERE mailbox_id = $1 AND id = $2', [mailboxId, messageId]);
  const deleted = (result.rowCount ?? 0) > 0;
  console.log('[MAILCOUSE DB deleteMessageById:RESULT]', { mailboxId, messageId, deleted });
  return deleted;
}


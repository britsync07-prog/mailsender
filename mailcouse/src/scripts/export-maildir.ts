import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { query, closePool } from '../db/connection';

type StoredMessage = {
  email: string;
  folder_name: string;
  raw_source: string;
  flags: string[];
  internal_date: Date;
};

const MAIL_ROOT = process.env.DOVECOT_MAIL_ROOT || '/var/vmail';

function mailboxPath(email: string, folder: string): string {
  const [localPart, domain] = email.toLowerCase().split('@');
  if (!localPart || !domain || /[^a-z0-9.+_-]/i.test(localPart) || /[^a-z0-9.-]/i.test(domain)) {
    throw new Error(`Unsafe mailbox address: ${email}`);
  }
  const root = path.join(MAIL_ROOT, domain, localPart, 'Maildir');
  if (folder.toUpperCase() === 'INBOX') return root;
  const safeFolder = folder.replace(/[^a-zA-Z0-9._ -]/g, '_');
  return path.join(root, `.${safeFolder}`);
}

function flagSuffix(flags: string[]): string {
  const map: Record<string, string> = {
    '\\Seen': 'S', '\\Answered': 'R', '\\Flagged': 'F', '\\Deleted': 'T', '\\Draft': 'D',
  };
  return Array.from(new Set((flags || []).map((flag) => map[flag]).filter(Boolean))).sort().join('');
}

async function main(): Promise<void> {
  const result = await query<StoredMessage>(
    `SELECT ma.email, mf.name AS folder_name, mm.raw_source, mm.flags, mm.internal_date
     FROM mailbox_messages mm
     JOIN mailbox_accounts ma ON ma.id = mm.mailbox_id
     JOIN mailbox_folders mf ON mf.id = mm.folder_id
     WHERE ma.active = true
     ORDER BY ma.email, mf.name, mm.uid`
  );

  for (const message of result.rows) {
    const folder = mailboxPath(message.email, message.folder_name);
    const seen = (message.flags || []).includes('\\Seen');
    const target = path.join(folder, seen ? 'cur' : 'new');
    await fs.mkdir(target, { recursive: true, mode: 0o750 });
    await fs.mkdir(path.join(folder, 'tmp'), { recursive: true, mode: 0o750 });
    const timestamp = Math.floor(new Date(message.internal_date).getTime() / 1000);
    const name = `${timestamp}.${crypto.randomUUID()}.${os.hostname()}${seen ? `:2,${flagSuffix(message.flags)}` : ''}`;
    await fs.writeFile(path.join(target, name), message.raw_source, { mode: 0o640, flag: 'wx' });
  }
  console.log(`Exported ${result.rows.length} message(s) to ${MAIL_ROOT}`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closePool());

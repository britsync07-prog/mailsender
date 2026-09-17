import net from 'net';
import tls from 'tls';
import fs from 'fs';
import { simpleParser } from 'mailparser';
import {
  appendMessage,
  authenticateMailbox,
  copyMessages,
  deleteMessageByUid,
  expungeMessages,
  getFolder,
  getFolderStats,
  listFolders,
  listMessagesBySequence,
  MailboxAccount,
  MailboxFolder,
  MailboxMessage,
  moveMessages,
  searchMessages,
  setMessageFlags,
} from './mailbox-store';
import { config } from '../config';
import {
  formatImapEnvelope,
  formatImapBodyStructure,
  formatInternalDate,
  extractMessageSection,
} from './rfc3501-formatter';

type ImapSessionState = {
  user: MailboxAccount | null;
  selected: MailboxFolder | null;
  secure: boolean;
  buffer: Buffer;
  pendingLiteral: null | {
    tag: string;
    folderName: string;
    flags: string[];
    bytes: number;
  };
};

function quote(value: string): string {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function splitCommand(line: string): { tag: string; command: string; rest: string } {
  const match = line.match(/^(\S+)\s+(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return { tag: '*', command: '', rest: '' };
  return { tag: match[1], command: match[2].toUpperCase(), rest: match[3] || '' };
}

function parseLogin(rest: string): { username: string; password: string } | null {
  const match = rest.match(/^\s*(?:"([^"]+)"|(\S+))\s+(?:"([^"]*)"|(\S+))\s*$/);
  if (!match) return null;
  return { username: match[1] || match[2], password: match[3] || match[4] || '' };
}

function parseFolderName(rest: string): string {
  const quoted = rest.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  return rest.trim().split(/\s+/)[0] || 'INBOX';
}

function parseListArgs(rest: string): { ref: string; pattern: string } {
  const parts: string[] = [];
  const regex = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = regex.exec(rest)) !== null) {
    parts.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return {
    ref: parts[0] ?? '',
    pattern: parts[1] ?? '',
  };
}

function parseFlags(input: string): string[] {
  const match = input.match(/\(([^)]*)\)/);
  if (match) {
    return match[1].split(/\s+/).map((f) => f.trim()).filter(Boolean);
  }
  const tokens = input.trim().split(/\s+/);
  const flagIdx = tokens.findIndex((t) => /^[+-]?FLAGS(?:\.SILENT)?$/i.test(t));
  if (flagIdx !== -1) {
    return tokens.slice(flagIdx + 1).map((f) => f.trim()).filter(Boolean);
  }
  return [];
}

function matchesRange(val: number, rangeStr: string, maxVal: number): boolean {
  const numVal = Number(val);
  if (!rangeStr || rangeStr === '*') return maxVal > 0 ? numVal === maxVal : false;
  if (rangeStr === '1:*') return numVal >= 1 && (maxVal === 0 || numVal <= maxVal);
  for (const part of rangeStr.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes(':')) {
      const [aRaw, bRaw] = trimmed.split(':');
      const a = aRaw === '*' ? maxVal : parseInt(aRaw, 10);
      const b = bRaw === '*' ? maxVal : parseInt(bRaw, 10);
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      if (numVal >= min && numVal <= max) return true;
    } else {
      const n = trimmed === '*' ? maxVal : parseInt(trimmed, 10);
      if (numVal === n) return true;
    }
  }
  return false;
}

function formatFlags(flags: string[]): string {
  return `(${Array.from(new Set(flags || [])).join(' ')})`;
}

function write(socket: net.Socket, line: string): void {
  console.log(`[MAILCOUSE IMAP >> SEND] [${socket.remoteAddress || 'local'}:${socket.remotePort || 0}] ${line}`);
  socket.write(`${line}\r\n`);
}

function getTlsOptions(): { key: Buffer; cert: Buffer } | null {
  const key = config.dns.tlsKey ? fs.readFileSync(String(config.dns.tlsKey)) : undefined;
  const cert = config.dns.tlsCert ? fs.readFileSync(String(config.dns.tlsCert)) : undefined;
  return key && cert ? { key, cert } : null;
}

function parseFetchTokens(input: string): string[] {
  const trimmed = input.trim();
  const content = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  const tokens: string[] = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);

    if (/\s/.test(ch) && parenDepth === 0 && bracketDepth === 0) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function expandFetchItems(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (upper === 'ALL') {
      expanded.push('FLAGS', 'INTERNALDATE', 'RFC822.SIZE', 'ENVELOPE');
    } else if (upper === 'FAST') {
      expanded.push('FLAGS', 'INTERNALDATE', 'RFC822.SIZE');
    } else if (upper === 'FULL') {
      expanded.push('FLAGS', 'INTERNALDATE', 'RFC822.SIZE', 'ENVELOPE', 'BODY');
    } else {
      expanded.push(token);
    }
  }
  return expanded;
}

const msgMetadataCache = new Map<string, { envelope: string; bodyStructure: string }>();

async function getMessageMetadata(msg: MailboxMessage): Promise<{ envelope: string; bodyStructure: string }> {
  const cached = msgMetadataCache.get(msg.id);
  if (cached) return cached;
  try {
    const parsed = await simpleParser(Buffer.from(msg.raw_source));
    const envelope = formatImapEnvelope(parsed);
    const bodyStructure = formatImapBodyStructure(parsed, msg.raw_source);
    const meta = { envelope, bodyStructure };
    if (msgMetadataCache.size > 2000) {
      const firstKey = msgMetadataCache.keys().next().value;
      if (firstKey) msgMetadataCache.delete(firstKey);
    }
    msgMetadataCache.set(msg.id, meta);
    return meta;
  } catch (err) {
    return {
      envelope: `(NIL ${quote(msg.subject || '')} NIL NIL NIL NIL NIL NIL NIL NIL)`,
      bodyStructure: `("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" ${msg.size} 1 NIL NIL NIL NIL)`,
    };
  }
}

async function sendFetchResponse(
  socket: net.Socket,
  seq: number,
  msg: MailboxMessage,
  requestedItems: string[],
  isUidCommand: boolean,
  folderId: string
): Promise<void> {
  const items = requestedItems.length > 0 ? requestedItems : ['FLAGS', 'RFC822.SIZE', 'BODY[]'];
  const responseParts: string[] = [];
  const literals: Array<{ label: string; content: string }> = [];
  let markSeen = false;
  let uidAdded = false;

  if (isUidCommand) {
    responseParts.push(`UID ${msg.uid}`);
    uidAdded = true;
  }

  for (const item of items) {
    const upper = item.toUpperCase();
    if (upper === 'UID') {
      if (!uidAdded) {
        responseParts.push(`UID ${msg.uid}`);
        uidAdded = true;
      }
    } else if (upper === 'FLAGS') {
      responseParts.push(`FLAGS ${formatFlags(msg.flags)}`);
    } else if (upper === 'INTERNALDATE') {
      responseParts.push(`INTERNALDATE ${formatInternalDate(msg.internal_date)}`);
    } else if (upper === 'RFC822.SIZE') {
      responseParts.push(`RFC822.SIZE ${msg.size}`);
    } else if (upper === 'ENVELOPE') {
      const meta = await getMessageMetadata(msg);
      responseParts.push(`ENVELOPE ${meta.envelope}`);
    } else if (upper === 'BODYSTRUCTURE') {
      const meta = await getMessageMetadata(msg);
      responseParts.push(`BODYSTRUCTURE ${meta.bodyStructure}`);
    } else if (upper === 'BODY') {
      const meta = await getMessageMetadata(msg);
      responseParts.push(`BODY ${meta.bodyStructure}`);
    } else if (upper === 'RFC822') {
      markSeen = true;
      literals.push({ label: 'RFC822', content: msg.raw_source });
    } else if (upper === 'RFC822.HEADER') {
      const content = extractMessageSection(msg.raw_source, 'HEADER');
      literals.push({ label: 'RFC822.HEADER', content });
    } else if (upper === 'RFC822.TEXT') {
      markSeen = true;
      const content = extractMessageSection(msg.raw_source, 'TEXT');
      literals.push({ label: 'RFC822.TEXT', content });
    } else if (upper.startsWith('BODY[') || upper.startsWith('BODY.PEEK[')) {
      const isPeek = upper.startsWith('BODY.PEEK[');
      if (!isPeek) markSeen = true;
      const match = item.match(/^BODY(?:\.PEEK)?\[(.*)\]$/i);
      const section = match ? match[1] : '';
      const content = extractMessageSection(msg.raw_source, section);
      literals.push({ label: `BODY[${section}]`, content });
    }
  }

  if (markSeen && !(msg.flags || []).includes('\\Seen')) {
    const updatedFlags = Array.from(new Set([...(msg.flags || []), '\\Seen']));
    msg.flags = updatedFlags;
    await setMessageFlags(folderId, msg.uid, updatedFlags);
  }

  if (literals.length === 0) {
    write(socket, `* ${seq} FETCH (${responseParts.join(' ')})`);
  } else {
    let prefix = `* ${seq} FETCH (`;
    if (responseParts.length > 0) {
      prefix += responseParts.join(' ') + ' ';
    }
    for (let l = 0; l < literals.length; l++) {
      const lit = literals[l];
      const byteLen = Buffer.byteLength(lit.content, 'utf8');
      if (l === 0) {
        socket.write(`${prefix}${lit.label} {${byteLen}}\r\n`);
      } else {
        socket.write(` ${lit.label} {${byteLen}}\r\n`);
      }
      socket.write(lit.content);
    }
    socket.write(')\r\n');
  }
}

async function handleCommand(socket: net.Socket, state: ImapSessionState, line: string, startTls?: (tag: string) => void): Promise<void> {
  console.log(`[MAILCOUSE IMAP << RECV] [${socket.remoteAddress || 'local'}:${socket.remotePort || 0}] ${line}`);
  const { tag, command, rest } = splitCommand(line);
  if (!command) return write(socket, `${tag} BAD Invalid command`);

  if (command === 'CAPABILITY') {
    const caps = ['IMAP4rev1', 'AUTH=PLAIN', 'UIDPLUS', 'SPECIAL-USE', 'MOVE'];
    if (startTls && !state.secure && getTlsOptions()) caps.splice(1, 0, 'STARTTLS');
    write(socket, `* CAPABILITY ${caps.join(' ')}`);
    return write(socket, `${tag} OK CAPABILITY completed`);
  }

  if (command === 'NOOP') return write(socket, `${tag} OK NOOP completed`);
  if (command === 'LOGOUT') {
    write(socket, '* BYE Logging out');
    write(socket, `${tag} OK LOGOUT completed`);
    socket.end();
    return;
  }

  if (command === 'STARTTLS') {
    if (!startTls || state.secure) return write(socket, `${tag} BAD STARTTLS is not available`);
    if (!getTlsOptions()) return write(socket, `${tag} NO TLS is not configured`);
    startTls(tag);
    return;
  }

  if (command === 'LOGIN') {
    const parsed = parseLogin(rest);
    if (!parsed) return write(socket, `${tag} BAD LOGIN requires username and password`);
    const user = await authenticateMailbox(parsed.username, parsed.password, socket.remoteAddress || undefined);
    if (!user) return write(socket, `${tag} NO Authentication failed`);
    state.user = user;
    return write(socket, `${tag} OK LOGIN completed`);
  }

  if (!state.user) return write(socket, `${tag} NO Authentication required`);

  if (command === 'LIST' || command === 'LSUB') {
    const { pattern } = parseListArgs(rest);
    // Delimiter probe (RFC 3501 § 6.3.8: empty mailbox argument returns delimiter)
    if (pattern === '') {
      write(socket, '* LIST (\\Noselect) "/" ""');
      return write(socket, `${tag} OK ${command} completed`);
    }

    const folders = await listFolders(state.user.id);
    for (const folder of folders) {
      const attrs = folder.special_use ? `(${folder.special_use})` : '()';
      write(socket, `* LIST ${attrs} "/" ${quote(folder.name)}`);
    }
    return write(socket, `${tag} OK ${command} completed`);
  }

  if (command === 'SELECT' || command === 'EXAMINE') {
    const folder = await getFolder(state.user.id, parseFolderName(rest));
    if (!folder) return write(socket, `${tag} NO Mailbox does not exist`);
    state.selected = folder;
    const stats = await getFolderStats(folder.id);
    write(socket, '* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)');
    write(socket, `* ${stats.exists} EXISTS`);
    write(socket, `* ${stats.unseen} RECENT`);
    write(socket, `* OK [UIDVALIDITY ${stats.uidValidity}] UIDs valid`);
    write(socket, `* OK [UIDNEXT ${stats.uidNext}] Predicted next UID`);
    write(socket, '* OK [PERMANENTFLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft \\*)] Flags permitted');
    return write(socket, `${tag} OK [READ-WRITE] ${command} completed`);
  }

  if (!state.selected && ['FETCH', 'UID', 'STORE', 'SEARCH', 'MOVE', 'COPY', 'EXPUNGE'].includes(command)) {
    return write(socket, `${tag} NO Select a mailbox first`);
  }

  if (command === 'FETCH' || (command === 'UID' && rest.toUpperCase().startsWith('FETCH '))) {
    const isUid = command === 'UID';
    const fetchRest = isUid ? rest.replace(/^FETCH\s+/i, '') : rest;
    const firstSpace = fetchRest.trim().indexOf(' ');
    const rangeStr = firstSpace !== -1 ? fetchRest.trim().slice(0, firstSpace) : fetchRest.trim();
    const attPart = firstSpace !== -1 ? fetchRest.trim().slice(firstSpace + 1).trim() : '';

    const tokens = parseFetchTokens(attPart);
    const requestedItems = expandFetchItems(tokens);

    const messages = await listMessagesBySequence(state.selected!.id);
    const maxUid = messages.length > 0 ? Math.max(...messages.map((m) => m.uid)) : 0;
    const maxSeq = messages.length;

    const matched = isUid
      ? messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ msg }) => matchesRange(msg.uid, rangeStr, maxUid))
      : messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ seq }) => matchesRange(seq, rangeStr, maxSeq));

    console.log(`[MAILCOUSE IMAP FETCH] folder=${state.selected!.name} isUid=${isUid} range=${rangeStr} matched=${matched.length}/${messages.length} items=[${requestedItems.join(' ')}]`);

    for (const { seq, msg } of matched) {
      await sendFetchResponse(socket, seq, msg, requestedItems, isUid, state.selected!.id);
    }
    return write(socket, `${tag} OK ${command} completed`);
  }

  if (command === 'STORE' || (command === 'UID' && rest.toUpperCase().startsWith('STORE '))) {
    const isUid = command === 'UID';
    const storeRest = isUid ? rest.replace(/^STORE\s+/i, '') : rest;
    const parts = storeRest.trim().split(/\s+/);
    const rangeStr = parts[0];
    const mode = (parts[1] || '').toUpperCase();
    const newFlags = parseFlags(storeRest);
    const messages = await listMessagesBySequence(state.selected!.id);
    const maxUid = messages.length > 0 ? Math.max(...messages.map((m) => m.uid)) : 0;
    const maxSeq = messages.length;

    let matched = isUid
      ? messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ msg }) => matchesRange(msg.uid, rangeStr, maxUid))
      : messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ seq }) => matchesRange(seq, rangeStr, maxSeq));

    // Failsafe 1: if sequence-based STORE matched nothing, check if rangeStr matches msg.uid
    if (!isUid && matched.length === 0) {
      matched = messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ msg }) => matchesRange(msg.uid, rangeStr, maxUid));
    }
    // Failsafe 2: if UID STORE matched nothing, check if rangeStr matches seq
    if (isUid && matched.length === 0) {
      matched = messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ seq }) => matchesRange(seq, rangeStr, maxSeq));
    }

    console.log(`[MAILCOUSE IMAP STORE] Folder: ${state.selected!.name}, range: ${rangeStr}, mode: ${mode}, flags: [${newFlags.join(' ')}], matched: ${matched.length}/${messages.length}`);

    for (const { seq, msg } of matched) {
      let flags = msg.flags || [];
      if (mode.startsWith('+')) flags = Array.from(new Set([...flags, ...newFlags]));
      else if (mode.startsWith('-')) flags = flags.filter((f) => !newFlags.includes(f));
      else flags = newFlags;
      msg.flags = flags;
      await setMessageFlags(state.selected!.id, msg.uid, flags);
      const attrs = isUid
        ? `UID ${msg.uid} FLAGS ${formatFlags(flags)}`
        : `FLAGS ${formatFlags(flags)}`;
      if (!mode.includes('.SILENT')) {
        write(socket, `* ${seq} FETCH (${attrs})`);
      }
    }
    return write(socket, `${tag} OK ${isUid ? 'UID STORE' : 'STORE'} completed`);
  }

  if (command === 'SEARCH' || (command === 'UID' && rest.toUpperCase().startsWith('SEARCH '))) {
    const isUid = command === 'UID';
    const searchRest = isUid ? rest.replace(/^SEARCH\s+/i, '') : rest;
    const textMatch = searchRest.match(/TEXT\s+"?([^"]+)"?/i);
    const matchingUids = await searchMessages(state.selected!.id, textMatch ? textMatch[1] : 'ALL');
    const messages = await listMessagesBySequence(state.selected!.id);
    const uidSet = new Set(matchingUids);
    const resultIds = isUid
      ? matchingUids
      : messages.map((m, i) => ({ seq: i + 1, uid: m.uid })).filter(({ uid }) => uidSet.has(uid)).map(({ seq }) => seq);
    return write(socket, `* SEARCH ${resultIds.join(' ')}\r\n${tag} OK SEARCH completed`);
  }

  if (command === 'MOVE' || (command === 'UID' && rest.toUpperCase().startsWith('MOVE '))) {
    const isUid = command === 'UID';
    const moveRest = isUid ? rest.replace(/^MOVE\s+/i, '') : rest;
    const firstSpace = moveRest.trim().indexOf(' ');
    if (firstSpace === -1) return write(socket, `${tag} BAD MOVE requires sequence and mailbox name`);
    const rangeStr = moveRest.trim().slice(0, firstSpace).trim();
    const targetFolderPart = moveRest.trim().slice(firstSpace + 1).trim();
    const targetFolderName = parseFolderName(targetFolderPart);

    const targetFolder = await getFolder(state.user.id, targetFolderName);
    if (!targetFolder) {
      console.warn(`[MAILCOUSE IMAP MOVE] Target folder not found: "${targetFolderName}" for user ${state.user.email}`);
      return write(socket, `${tag} NO [TRYCREATE] Mailbox does not exist`);
    }

    const messages = await listMessagesBySequence(state.selected!.id);
    const maxUid = messages.length > 0 ? Math.max(...messages.map((m) => m.uid)) : 0;
    const maxSeq = messages.length;

    let matched = isUid
      ? messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ msg }) => matchesRange(msg.uid, rangeStr, maxUid))
      : messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ seq }) => matchesRange(seq, rangeStr, maxSeq));

    // Failsafe 1: if sequence-based MOVE matched nothing, check if rangeStr matches msg.uid
    if (!isUid && matched.length === 0) {
      matched = messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ msg }) => matchesRange(msg.uid, rangeStr, maxUid));
    }
    // Failsafe 2: if UID MOVE matched nothing, check if rangeStr matches seq
    if (isUid && matched.length === 0) {
      matched = messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ seq }) => matchesRange(seq, rangeStr, maxSeq));
    }

    console.log(`[MAILCOUSE IMAP MOVE] Selected: ${state.selected!.name}, Target: ${targetFolder.name}, Range: ${rangeStr}, isUid: ${isUid}, Matched: ${matched.length}/${messages.length}`);

    if (matched.length === 0) {
      console.log(`[MAILCOUSE IMAP MOVE] No matching messages found for range ${rangeStr}`);
      return write(socket, `${tag} OK MOVE completed`);
    }

    const uidsToMove = matched.map((m) => m.msg.uid);
    const moved = await moveMessages(state.user.id, state.selected!.id, targetFolder.id, uidsToMove);

    // Untagged EXPUNGE in descending sequence order
    const sortedDesc = [...matched].sort((a, b) => b.seq - a.seq);
    for (const item of sortedDesc) {
      write(socket, `* ${item.seq} EXPUNGE`);
    }

    if (moved.length === 0) {
      return write(socket, `${tag} OK MOVE completed`);
    }

    const srcUids = moved.map((m) => m.sourceUid).join(',');
    const dstUids = moved.map((m) => m.destUid).join(',');
    return write(socket, `${tag} OK [COPYUID ${targetFolder.uid_validity} ${srcUids} ${dstUids}] MOVE completed`);
  }

  if (command === 'COPY' || (command === 'UID' && rest.toUpperCase().startsWith('COPY '))) {
    const isUid = command === 'UID';
    const copyRest = isUid ? rest.replace(/^COPY\s+/i, '') : rest;
    const firstSpace = copyRest.trim().indexOf(' ');
    if (firstSpace === -1) return write(socket, `${tag} BAD COPY requires sequence and mailbox name`);
    const rangeStr = copyRest.trim().slice(0, firstSpace).trim();
    const targetFolderPart = copyRest.trim().slice(firstSpace + 1).trim();
    const targetFolderName = parseFolderName(targetFolderPart);

    const targetFolder = await getFolder(state.user.id, targetFolderName);
    if (!targetFolder) {
      console.warn(`[MAILCOUSE IMAP COPY] Target folder not found: "${targetFolderName}" for user ${state.user.email}`);
      return write(socket, `${tag} NO [TRYCREATE] Mailbox does not exist`);
    }

    const messages = await listMessagesBySequence(state.selected!.id);
    const maxUid = messages.length > 0 ? Math.max(...messages.map((m) => m.uid)) : 0;
    const maxSeq = messages.length;

    let matched = isUid
      ? messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ msg }) => matchesRange(msg.uid, rangeStr, maxUid))
      : messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ seq }) => matchesRange(seq, rangeStr, maxSeq));

    if (!isUid && matched.length === 0) {
      matched = messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ msg }) => matchesRange(msg.uid, rangeStr, maxUid));
    }
    if (isUid && matched.length === 0) {
      matched = messages.map((msg, i) => ({ seq: i + 1, msg })).filter(({ seq }) => matchesRange(seq, rangeStr, maxSeq));
    }

    console.log(`[MAILCOUSE IMAP COPY] Selected: ${state.selected!.name}, Target: ${targetFolder.name}, Range: ${rangeStr}, isUid: ${isUid}, Matched: ${matched.length}/${messages.length}`);

    if (matched.length === 0) {
      return write(socket, `${tag} OK COPY completed`);
    }

    const uidsToCopy = matched.map((m) => m.msg.uid);
    const copied = await copyMessages(state.user.id, state.selected!.id, targetFolder.id, uidsToCopy);

    if (copied.length === 0) {
      return write(socket, `${tag} OK COPY completed`);
    }

    const srcUids = copied.map((m) => m.sourceUid).join(',');
    const dstUids = copied.map((m) => m.destUid).join(',');
    return write(socket, `${tag} OK [COPYUID ${targetFolder.uid_validity} ${srcUids} ${dstUids}] COPY completed`);
  }

  if (command === 'EXPUNGE' || (command === 'UID' && rest.toUpperCase().startsWith('EXPUNGE'))) {
    const isUid = command === 'UID';
    const expungeRest = isUid ? rest.replace(/^EXPUNGE\s*/i, '').trim() : '';
    const messages = await listMessagesBySequence(state.selected!.id);
    const maxUid = messages.length > 0 ? Math.max(...messages.map((m) => m.uid)) : 0;

    let targetUids: number[] | undefined;
    if (isUid && expungeRest) {
      targetUids = messages
        .filter((m) => matchesRange(m.uid, expungeRest, maxUid))
        .map((m) => m.uid);
    }

    console.log(`[MAILCOUSE IMAP EXPUNGE] Folder: ${state.selected!.name}, isUid: ${isUid}, targetUids: ${targetUids ? targetUids.join(',') : 'ALL'}`);

    const deletedUids = await expungeMessages(state.selected!.id, targetUids);
    const deletedUidSet = new Set(deletedUids);

    const toExpunge = messages
      .map((msg, i) => ({ seq: i + 1, uid: msg.uid }))
      .filter(({ uid }) => deletedUidSet.has(uid))
      .sort((a, b) => b.seq - a.seq);

    for (const item of toExpunge) {
      write(socket, `* ${item.seq} EXPUNGE`);
    }

    return write(socket, `${tag} OK ${isUid ? 'UID EXPUNGE' : 'EXPUNGE'} completed`);
  }

  if (command === 'APPEND') {
    const literal = rest.match(/\{(\d+)\}\s*$/);
    if (!literal) return write(socket, `${tag} BAD APPEND requires a literal message`);
    state.pendingLiteral = {
      tag,
      folderName: parseFolderName(rest),
      flags: parseFlags(rest),
      bytes: parseInt(literal[1], 10),
    };
    socket.write('+ Ready for literal data\r\n');
    return;
  }

  return write(socket, `${tag} BAD Command not implemented`);
}

function handleData(socket: net.Socket, state: ImapSessionState, chunk: Buffer, startTls?: (tag: string) => void): void {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  void processBuffer(socket, state, startTls).catch((err) => {
    console.error('IMAP command error:', err);
    write(socket, '* BAD Internal server error');
  });
}

async function processBuffer(socket: net.Socket, state: ImapSessionState, startTls?: (tag: string) => void): Promise<void> {
  if (state.pendingLiteral) {
    const literal = state.pendingLiteral;
    if (state.buffer.length < literal.bytes) return;
    const rawBuffer = state.buffer.subarray(0, literal.bytes);
    state.buffer = state.buffer.subarray(literal.bytes);
    if (state.buffer.length > 0 && state.buffer[0] === 13) state.buffer = state.buffer.subarray(1);
    if (state.buffer.length > 0 && state.buffer[0] === 10) state.buffer = state.buffer.subarray(1);

    if (!state.user) {
      write(socket, `${literal.tag} NO Authentication required`);
    } else {
      const raw = rawBuffer.toString('utf8');
      await appendMessage({ mailboxId: state.user.id, folderName: literal.folderName, flags: literal.flags, rawSource: raw });
      write(socket, `${literal.tag} OK APPEND completed`);
    }
    state.pendingLiteral = null;
  }

  let index = state.buffer.indexOf(10);
  while (index >= 0 && !state.pendingLiteral) {
    const lineBuffer = state.buffer.subarray(0, index);
    state.buffer = state.buffer.subarray(index + 1);
    const line = lineBuffer.toString('utf8').replace(/\r$/, '');
    if (line.trim()) await handleCommand(socket, state, line, startTls);
    index = state.buffer.indexOf(10);
  }
}

export function createImapServer(implicitTls = false): net.Server | tls.Server {
  const listener = (socket: net.Socket) => {
    const state: ImapSessionState = { user: null, selected: null, secure: implicitTls, buffer: Buffer.alloc(0), pendingLiteral: null };
    let activeSocket: net.Socket = socket;
    let dataHandler: ((chunk: Buffer | string) => void) | null = null;
    const attachDataHandler = (target: net.Socket, startTls?: (tag: string) => void) => {
      dataHandler = (chunk) => handleData(target, state, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), startTls);
      target.on('data', dataHandler);
      target.on('error', (err) => console.error('IMAP socket error:', err.message));
    };
    const startTls = (tag: string) => {
      const options = getTlsOptions();
      if (!options) return write(activeSocket, `${tag} NO TLS is not configured`);
      write(activeSocket, `${tag} OK Begin TLS negotiation now`);
      if (dataHandler) activeSocket.removeListener('data', dataHandler);
      const secureSocket = new tls.TLSSocket(activeSocket, { isServer: true, ...options });
      activeSocket = secureSocket;
      state.secure = true;
      attachDataHandler(secureSocket);
    };
    write(socket, `* OK ${config.dns.heloHostname} IMAP4rev1 ready`);
    attachDataHandler(socket, implicitTls ? undefined : startTls);
  };

  if (!implicitTls) return net.createServer(listener);
  const options = getTlsOptions();
  if (!options) throw new Error('IMAPS requires DNS_TLS_KEY and DNS_TLS_CERT');
  return tls.createServer(options, listener);
}

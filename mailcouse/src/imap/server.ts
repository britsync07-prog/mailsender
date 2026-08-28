import net from 'net';
import tls from 'tls';
import fs from 'fs';
import {
  appendMessage,
  authenticateMailbox,
  getFolder,
  getFolderStats,
  listFolders,
  listMessagesBySequence,
  MailboxAccount,
  MailboxFolder,
  searchMessages,
  setMessageFlags,
} from './mailbox-store';
import { config } from '../config';

type ImapSessionState = {
  user: MailboxAccount | null;
  selected: MailboxFolder | null;
  secure: boolean;
  buffer: string;
  pendingLiteral: null | {
    tag: string;
    folderName: string;
    flags: string[];
    bytes: number;
    prefix: string;
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

function parseFlags(input: string): string[] {
  const match = input.match(/\(([^)]*)\)/);
  if (!match) return [];
  return match[1].split(/\s+/).map((f) => f.trim()).filter(Boolean);
}

function parseSequence(sequence: string, count: number): number[] {
  if (!sequence || sequence === '*') return count ? [count] : [];
  if (sequence === '1:*') return Array.from({ length: count }, (_, i) => i + 1);
  const ids = new Set<number>();
  for (const part of sequence.split(',')) {
    if (part.includes(':')) {
      const [aRaw, bRaw] = part.split(':');
      const a = aRaw === '*' ? count : parseInt(aRaw, 10);
      const b = bRaw === '*' ? count : parseInt(bRaw, 10);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= count) ids.add(i);
    } else {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= count) ids.add(n);
    }
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function formatFlags(flags: string[]): string {
  return `(${(flags || []).join(' ')})`;
}

function write(socket: net.Socket, line: string): void {
  socket.write(`${line}\r\n`);
}

function getTlsOptions(): { key: Buffer; cert: Buffer } | null {
  const key = config.dns.tlsKey ? fs.readFileSync(String(config.dns.tlsKey)) : undefined;
  const cert = config.dns.tlsCert ? fs.readFileSync(String(config.dns.tlsCert)) : undefined;
  return key && cert ? { key, cert } : null;
}

async function handleCommand(socket: net.Socket, state: ImapSessionState, line: string, startTls?: (tag: string) => void): Promise<void> {
  const { tag, command, rest } = splitCommand(line);
  if (!command) return write(socket, `${tag} BAD Invalid command`);

  if (command === 'CAPABILITY') {
    const caps = ['IMAP4rev1', 'AUTH=PLAIN', 'UIDPLUS', 'SPECIAL-USE'];
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
    write(socket, '* OK [PERMANENTFLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)] Flags permitted');
    return write(socket, `${tag} OK [READ-WRITE] ${command} completed`);
  }

  if (!state.selected && ['FETCH', 'UID', 'STORE', 'SEARCH'].includes(command)) {
    return write(socket, `${tag} NO Select a mailbox first`);
  }

  if (command === 'FETCH' || (command === 'UID' && rest.toUpperCase().startsWith('FETCH '))) {
    const fetchRest = command === 'UID' ? rest.replace(/^FETCH\s+/i, '') : rest;
    const seq = fetchRest.trim().split(/\s+/)[0];
    const messages = await listMessagesBySequence(state.selected!.id);
    const indexes = parseSequence(seq, messages.length);
    for (const index of indexes) {
      const msg = messages[index - 1];
      if (!msg) continue;
      const attrs = command === 'UID'
        ? `UID ${msg.uid} FLAGS ${formatFlags(msg.flags)} RFC822.SIZE ${msg.size} BODY[] {${Buffer.byteLength(msg.raw_source)}}`
        : `FLAGS ${formatFlags(msg.flags)} RFC822.SIZE ${msg.size} BODY[] {${Buffer.byteLength(msg.raw_source)}}`;
      write(socket, `* ${index} FETCH (${attrs}`);
      socket.write(msg.raw_source);
      socket.write('\r\n)\r\n');
    }
    return write(socket, `${tag} OK FETCH completed`);
  }

  if (command === 'STORE' || (command === 'UID' && rest.toUpperCase().startsWith('STORE '))) {
    const storeRest = command === 'UID' ? rest.replace(/^STORE\s+/i, '') : rest;
    const parts = storeRest.trim().split(/\s+/);
    const seq = parts[0];
    const mode = (parts[1] || '').toUpperCase();
    const newFlags = parseFlags(storeRest);
    const messages = await listMessagesBySequence(state.selected!.id);
    const indexes = parseSequence(seq, messages.length);
    for (const index of indexes) {
      const msg = messages[index - 1];
      if (!msg) continue;
      let flags = msg.flags || [];
      if (mode.startsWith('+')) flags = Array.from(new Set([...flags, ...newFlags]));
      else if (mode.startsWith('-')) flags = flags.filter((f) => !newFlags.includes(f));
      else flags = newFlags;
      await setMessageFlags(state.selected!.id, msg.uid, flags);
      write(socket, `* ${index} FETCH (FLAGS ${formatFlags(flags)})`);
    }
    return write(socket, `${tag} OK STORE completed`);
  }

  if (command === 'SEARCH' || (command === 'UID' && rest.toUpperCase().startsWith('SEARCH '))) {
    const searchRest = command === 'UID' ? rest.replace(/^SEARCH\s+/i, '') : rest;
    const textMatch = searchRest.match(/TEXT\s+"?([^"]+)"?/i);
    const ids = await searchMessages(state.selected!.id, textMatch ? textMatch[1] : 'ALL');
    return write(socket, `* SEARCH ${ids.join(' ')}\r\n${tag} OK SEARCH completed`);
  }

  if (command === 'APPEND') {
    const literal = rest.match(/\{(\d+)\}\s*$/);
    if (!literal) return write(socket, `${tag} BAD APPEND requires a literal message`);
    state.pendingLiteral = {
      tag,
      folderName: parseFolderName(rest),
      flags: parseFlags(rest),
      bytes: parseInt(literal[1], 10),
      prefix: '',
    };
    socket.write('+ Ready for literal data\r\n');
    return;
  }

  return write(socket, `${tag} BAD Command not implemented`);
}

function handleData(socket: net.Socket, state: ImapSessionState, chunk: Buffer, startTls?: (tag: string) => void): void {
  state.buffer += chunk.toString('utf8');
  void processBuffer(socket, state, startTls).catch((err) => {
    console.error('IMAP command error:', err);
    write(socket, '* BAD Internal server error');
  });
}

async function processBuffer(socket: net.Socket, state: ImapSessionState, startTls?: (tag: string) => void): Promise<void> {
  if (state.pendingLiteral) {
    const literal = state.pendingLiteral;
    if (Buffer.byteLength(state.buffer) < literal.bytes) return;
    const raw = state.buffer.slice(0, literal.bytes);
    state.buffer = state.buffer.slice(literal.bytes).replace(/^\r?\n/, '');
    if (!state.user) {
      write(socket, `${literal.tag} NO Authentication required`);
    } else {
      await appendMessage({ mailboxId: state.user.id, folderName: literal.folderName, flags: literal.flags, rawSource: raw });
      write(socket, `${literal.tag} OK APPEND completed`);
    }
    state.pendingLiteral = null;
  }

  let index = state.buffer.indexOf('\n');
  while (index >= 0 && !state.pendingLiteral) {
    const line = state.buffer.slice(0, index).replace(/\r$/, '');
    state.buffer = state.buffer.slice(index + 1);
    if (line.trim()) await handleCommand(socket, state, line, startTls);
    index = state.buffer.indexOf('\n');
  }
}

export function createImapServer(implicitTls = false): net.Server | tls.Server {
  const listener = (socket: net.Socket) => {
    const state: ImapSessionState = { user: null, selected: null, secure: implicitTls, buffer: '', pendingLiteral: null };
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

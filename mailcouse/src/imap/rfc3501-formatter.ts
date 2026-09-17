import { simpleParser, ParsedMail, AddressObject } from 'mailparser';

function escapeString(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function quote(val: string | null | undefined): string {
  if (val === null || val === undefined) return 'NIL';
  return `"${escapeString(String(val))}"`;
}

/**
 * Formats a Date object into RFC 3501 INTERNALDATE format:
 * "DD-Mon-YYYY HH:MM:SS +ZZZZ" (e.g. "17-Sep-2026 16:55:31 +0000")
 */
export function formatInternalDate(date: Date): string {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  const secs = String(d.getUTCSeconds()).padStart(2, '0');
  return `"${day}-${month}-${year} ${hours}:${mins}:${secs} +0000"`;
}

/**
 * Formats an RFC 2822 date string or Date object for the ENVELOPE structure.
 */
function formatEnvelopeDate(date: Date | string | undefined): string {
  if (!date) return 'NIL';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return quote(String(date));
  return quote(d.toUTCString());
}

/**
 * Formats a list of email addresses into RFC 3501 ENVELOPE address structure:
 * ((name route mailbox host)...) or NIL
 */
function formatAddressList(addrObj: AddressObject | AddressObject[] | undefined | null): string {
  if (!addrObj) return 'NIL';
  const list: Array<{ name?: string; address?: string }> = [];

  const items = Array.isArray(addrObj) ? addrObj : [addrObj];
  for (const item of items) {
    if (item && item.value && Array.isArray(item.value)) {
      for (const val of item.value) {
        if (val.address) {
          list.push({ name: val.name || undefined, address: val.address });
        }
      }
    } else if (item && (item as any).text) {
      const match = (item as any).text.match(/^(?:([^<]+)\s+<)?([^>]+)>?$/);
      if (match) {
        list.push({ name: match[1]?.trim(), address: match[2]?.trim() });
      }
    }
  }

  if (list.length === 0) return 'NIL';

  const parts = list.map((a) => {
    const name = a.name ? quote(a.name) : 'NIL';
    const route = 'NIL';
    const [mailbox, host] = (a.address || '').split('@');
    return `(${name} ${route} ${quote(mailbox || '')} ${quote(host || '')})`;
  });

  return `(${parts.join('')})`;
}

/**
 * Formats the RFC 3501 ENVELOPE string:
 * (date subject from sender reply-to to cc bcc in-reply-to message-id)
 */
export function formatImapEnvelope(parsed: ParsedMail): string {
  const dateStr = formatEnvelopeDate(parsed.date);
  const subjectStr = quote(parsed.subject || '');
  const fromStr = formatAddressList(parsed.from);
  const senderStr = fromStr; // Default sender to from if not distinct
  const replyToStr = formatAddressList(parsed.replyTo) !== 'NIL' ? formatAddressList(parsed.replyTo) : fromStr;
  const toStr = formatAddressList(parsed.to);
  const ccStr = formatAddressList(parsed.cc);
  const bccStr = formatAddressList(parsed.bcc);
  const inReplyToStr = parsed.inReplyTo ? quote(parsed.inReplyTo) : 'NIL';
  const messageIdStr = parsed.messageId ? quote(parsed.messageId) : 'NIL';

  return `(${dateStr} ${subjectStr} ${fromStr} ${senderStr} ${replyToStr} ${toStr} ${ccStr} ${bccStr} ${inReplyToStr} ${messageIdStr})`;
}

function countLines(str: string): number {
  if (!str) return 0;
  return str.split(/\r?\n/).length;
}

/**
 * Formats a single-part text MIME node into RFC 3501 BODYSTRUCTURE / BODY item.
 */
function formatTextPart(subtype: 'PLAIN' | 'HTML', text: string, charset: string = 'UTF-8'): string {
  const size = Buffer.byteLength(text || '', 'utf8');
  const lines = countLines(text || '');
  return `("TEXT" "${subtype}" ("CHARSET" "${charset}") NIL NIL "7BIT" ${size} ${lines} NIL NIL NIL NIL)`;
}

/**
 * Formats a single attachment MIME node into RFC 3501 BODYSTRUCTURE / BODY item.
 */
function formatAttachmentPart(att: any): string {
  const contentType = (att.contentType || 'application/octet-stream').toUpperCase();
  const [type, subtype] = contentType.includes('/') ? contentType.split('/') : ['APPLICATION', contentType];
  const filename = att.filename || 'attachment';
  const size = att.size || (att.content ? Buffer.byteLength(att.content) : 0);
  const disposition = ((att.contentDisposition || att.disposition || 'attachment') as string).toUpperCase();
  const cid = att.cid ? quote(att.cid) : 'NIL';

  return `("${type}" "${subtype}" ("NAME" ${quote(filename)}) ${cid} NIL "BASE64" ${size} NIL ("${disposition}" ("FILENAME" ${quote(filename)})) NIL NIL)`;
}

/**
 * Extracts boundary string from raw source or headers
 */
function extractBoundary(rawSource: string, pattern: RegExp): string | null {
  const match = rawSource.match(pattern);
  return match ? match[1] : null;
}

/**
 * Formats the RFC 3501 BODYSTRUCTURE or BODY string.
 * Accurately describes singlepart, multipart/alternative, and multipart/mixed
 * with attachment metadata (filename, type, size, disposition).
 */
export function formatImapBodyStructure(parsed: ParsedMail, rawSource: string): string {
  const hasHtml = Boolean(parsed.html && parsed.html.length > 0);
  const hasText = Boolean(parsed.text && parsed.text.length > 0) || !hasHtml;
  const attachments = parsed.attachments || [];
  const hasAttachments = attachments.length > 0;

  const textPart = hasText ? formatTextPart('PLAIN', parsed.text || '') : null;
  const htmlPart = hasHtml ? formatTextPart('HTML', parsed.html || '') : null;

  // 1. Build the core message body part
  let bodyStructure: string;
  if (textPart && htmlPart) {
    // Both text and html -> multipart/alternative
    const altBoundary = extractBoundary(rawSource, /boundary="?([0-9a-zA-Z'()+_,-./:=?]+)"?/i) || 'alternative-boundary';
    bodyStructure = `(${textPart} ${htmlPart} "ALTERNATIVE" ("BOUNDARY" ${quote(altBoundary)}) NIL NIL NIL)`;
  } else if (htmlPart) {
    bodyStructure = htmlPart;
  } else {
    bodyStructure = textPart || formatTextPart('PLAIN', '');
  }

  // 2. If no attachments, return the core body structure
  if (!hasAttachments) {
    return bodyStructure;
  }

  // 3. With attachments -> multipart/mixed containing body part and each attachment part
  const mixedBoundary = extractBoundary(rawSource, /multipart\/mixed;\s*boundary="?([0-9a-zA-Z'()+_,-./:=?]+)"?/i) || 'mixed-boundary';
  const attParts = attachments.map(formatAttachmentPart);

  return `((${bodyStructure} ${attParts.join(' ')}) "MIXED" ("BOUNDARY" ${quote(mixedBoundary)}) NIL NIL NIL)`;
}

/**
 * Extracts specific sections of a message for BODY[...] and BODY.PEEK[...] queries:
 * - HEADER
 * - TEXT
 * - HEADER.FIELDS (...)
 * - HEADER.FIELDS.NOT (...)
 * - Part indices (1, 2, 1.MIME, etc.)
 */
export function extractMessageSection(rawSource: string, sectionStr: string): string {
  const cleanSection = sectionStr.trim().toUpperCase();

  // Entire message requested
  if (!cleanSection || cleanSection === '[]' || cleanSection === '') {
    return rawSource;
  }

  // Split headers and body
  const splitIdx = rawSource.search(/\r?\n\r?\n/);
  const header = splitIdx !== -1 ? rawSource.slice(0, splitIdx) : rawSource;
  const body = splitIdx !== -1 ? rawSource.slice(splitIdx).replace(/^\r?\n\r?\n/, '') : '';

  // RFC822.HEADER or BODY[HEADER]
  if (cleanSection === 'HEADER' || cleanSection === 'RFC822.HEADER') {
    return header + '\r\n\r\n';
  }

  // RFC822.TEXT or BODY[TEXT]
  if (cleanSection === 'TEXT' || cleanSection === 'RFC822.TEXT') {
    return body;
  }

  // HEADER.FIELDS (...)
  const fieldsMatch = cleanSection.match(/HEADER\.FIELDS\s*\(([^)]+)\)/i);
  if (fieldsMatch) {
    const requestedFields = fieldsMatch[1].split(/\s+/).map((f) => f.trim().toLowerCase()).filter(Boolean);
    const lines = header.split(/\r?\n/);
    const extracted: string[] = [];
    let capturing = false;

    for (const line of lines) {
      if (/^\s/.test(line)) {
        // Folded header continuation
        if (capturing) extracted.push(line);
      } else {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          const fieldName = line.slice(0, colonIdx).trim().toLowerCase();
          capturing = requestedFields.includes(fieldName);
          if (capturing) extracted.push(line);
        } else {
          capturing = false;
        }
      }
    }
    return extracted.join('\r\n') + '\r\n\r\n';
  }

  // Part numbers (e.g. 1, 2, 1.MIME, 2.MIME)
  const partMatch = cleanSection.match(/^(\d+)(?:\.(MIME))?$/);
  if (partMatch) {
    const partIdx = parseInt(partMatch[1], 10) - 1;
    const isMime = Boolean(partMatch[2]);
    const parts = getMimeParts(rawSource);
    if (parts[partIdx]) {
      return isMime ? parts[partIdx].mimeHeaders + '\r\n\r\n' : parts[partIdx].body;
    }
  }

  // Default fallback: return whole message
  return rawSource;
}

function getMimeParts(rawSource: string): Array<{ mimeHeaders: string; body: string }> {
  const match = rawSource.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!match) return [];
  const boundary = match[1];
  const parts = rawSource.split(`--${boundary}`);
  const result: Array<{ mimeHeaders: string; body: string }> = [];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].replace(/^[\r\n]+/, '');
    if (part.startsWith('--')) break;
    const splitIdx = part.search(/\r?\n\r?\n/);
    if (splitIdx !== -1) {
      result.push({
        mimeHeaders: part.slice(0, splitIdx),
        body: part.slice(splitIdx).replace(/^\r?\n\r?\n/, '').replace(/[\r\n]+$/, ''),
      });
    } else {
      result.push({ mimeHeaders: '', body: part.replace(/[\r\n]+$/, '') });
    }
  }
  return result;
}

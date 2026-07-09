import { DEFAULT_HEADER_CONFIG, HeaderRandomizerConfig, GeneratedHeaders, MessageIdPattern } from './types';

let config: HeaderRandomizerConfig = DEFAULT_HEADER_CONFIG;

export function configureHeaderRandomizer(cfg: Partial<HeaderRandomizerConfig>): void {
  config = { ...config, ...cfg };
}

export function resetHeaderRandomizer(): void {
  config = DEFAULT_HEADER_CONFIG;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomHex(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 16).toString(16);
  }
  return result;
}

function shortUUID(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateMessageId(pattern: MessageIdPattern, domain: string, jobId: string): string {
  switch (pattern) {
    case 'uuid_at_domain':
      return `<${jobId}@${domain}>`;
    case 'random_at_domain':
      return `<${randomHex(32)}@${domain}>`;
    case 'timestamp_hash_at_domain':
      return `<${Date.now().toString(36)}.${randomHex(8)}@${domain}>`;
    case 'short_uuid_at_domain':
      return `<${shortUUID()}@${domain}>`;
    default:
      return `<${jobId}@${domain}>`;
  }
}

function generateReceivedHeader(domain: string): string {
  const hosts = ['mail', 'smtp', 'mx', 'relay', 'outbound'];
  const host = pickRandom(hosts);
  const ipOctets = Array.from({ length: 4 }, () => Math.floor(Math.random() * 255));
  const ip = ipOctets.join('.');
  const now = new Date();
  const adjusted = new Date(now.getTime() - Math.floor(Math.random() * 10) * 1000);
  return `from ${host}.${domain} (${host}.${domain} [${ip}]) by ${pickRandom(hosts)}.${domain} with ${pickRandom(['ESMTP', 'SMTP', 'LMTP'])}; ${adjusted.toUTCString()}`;
}

function generateListUnsubscribe(domain: string, jobId: string): string {
  const format = pickRandom(config.listUnsubscribeFormats);
  switch (format.type) {
    case 'mailto':
      return `<mailto:unsubscribe@${domain}>`;
    case 'url':
      if (format.urlTemplate) {
        return `<${format.urlTemplate.replace('{domain}', domain).replace('{job_id}', jobId).replace('{short_id}', shortUUID())}>`;
      }
      return `<mailto:unsubscribe@${domain}>`;
    case 'both':
      return `<mailto:unsubscribe@${domain}>, <${(format.urlTemplate || '').replace('{domain}', domain).replace('{job_id}', jobId).replace('{short_id}', shortUUID())}>`;
    default:
      return `<mailto:unsubscribe@${domain}>`;
  }
}

export function buildHeaders(
  domain: string,
  jobId: string,
  subject: string,
  fromName: string,
  preHeaders?: Record<string, string>
): GeneratedHeaders {
  const pattern = pickRandom(config.messageIdPatterns);
  const messageId = generateMessageId(pattern, domain, jobId);
  const listUnsub = generateListUnsubscribe(domain, jobId);

  const headers: GeneratedHeaders = {
    'Message-ID': messageId,
    'Date': new Date().toUTCString(),
    'Precedence': pickRandom(['bulk', 'list', 'junk']),
    'List-Unsubscribe': listUnsub,
  };

  if (preHeaders) {
    for (const [key, value] of Object.entries(preHeaders)) {
      headers[key] = value;
    }
  }

  if (Math.random() > 0.5) {
    headers['X-Mailer'] = pickRandom(config.xMailers);
  }

  if (Math.random() > 0.7) {
    headers['User-Agent'] = pickRandom(config.userAgents);
  }

  if (config.injectReceivedHeaders && Math.random() > 0.3) {
    headers['Received'] = generateReceivedHeader(domain);
  }

  return headers;
}

export function reorderHeaders(headers: Record<string, string | undefined>): Array<{ key: string; value: string }> {
  const orderTemplate = pickRandom(config.headerOrderTemplates);
  const ordered: Array<{ key: string; value: string }> = [];
  const used = new Set<string>();

  for (const key of orderTemplate) {
    const value = headers[key];
    if (value !== undefined) {
      ordered.push({ key, value });
      used.add(key);
    }
  }

  for (const [key, value] of Object.entries(headers)) {
    if (!used.has(key) && value !== undefined) {
      ordered.push({ key, value });
    }
  }

  return ordered;
}

export function buildMimeHeaders(
  domain: string,
  jobId: string,
  subject: string,
  fromName: string,
  preHeaders?: Record<string, string>
): Array<{ key: string; value: string }> {
  const headers = buildHeaders(domain, jobId, subject, fromName, preHeaders);

  headers['MIME-Version'] = '1.0';
  headers['Content-Type'] = 'text/plain; charset=UTF-8';
  headers['Content-Transfer-Encoding'] = pickRandom(['7bit', '8bit', 'quoted-printable']);

  return reorderHeaders(headers);
}

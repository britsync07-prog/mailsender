// Postal-exact port of Domain model (domain.rb) + HasDNSChecks concern (has_dns_checks.rb)

import * as dns from 'dns';
import { config } from '../config';
import { query } from '../db/connection';

export const VERIFICATION_EMAIL_ALIASES = ['webmaster', 'postmaster', 'admin', 'administrator', 'hostmaster'] as const;
export const VERIFICATION_METHODS = ['DNS', 'Email'] as const;

export interface DNSStatus {
  status: string | null;
  error: string | null;
}

export interface DomainDNSChecks {
  spf: DNSStatus;
  dkim: DNSStatus;
  mx: DNSStatus;
  return_path: DNSStatus;
}

export function parentDomains(name: string): string[] {
  const parts = name.split('.');
  const result: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    result.push(parts.slice(i).join('.'));
  }
  return result;
}

export function verificationEmailAddresses(name: string): string[] {
  return parentDomains(name).flatMap((domain) =>
    VERIFICATION_EMAIL_ALIASES.map((a) => `${a}@${domain}`)
  );
}

export function generateVerificationToken(method: string): string {
  if (method === 'Email') {
    return String(Math.floor(Math.random() * 999999)).padStart(6, '0');
  }
  return generateAlphanumeric(32);
}

function generateAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateDKIMIdentifierString(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function spfRecord(): string {
  return `v=spf1 a mx include:${config.dns.spfInclude} ~all`;
}

export function dkimRecord(publicKey: string): string {
  return `v=DKIM1; t=s; h=sha256; p=${publicKey};`;
}

export function dkimIdentifier(dkimIdentifierString: string): string {
  return `${config.dns.dkimIdentifier}-${dkimIdentifierString}`;
}

export function dkimRecordName(dkimIdentifierString: string): string {
  return `${dkimIdentifier(dkimIdentifierString)}._domainkey`;
}

export function returnPathDomain(name: string): string {
  return `${config.dns.customReturnPathPrefix}.${name}`;
}

export function dnsVerificationString(verificationToken: string): string {
  return `${config.dns.domainVerifyPrefix} ${verificationToken}`;
}

export function dnsOk(checks: DomainDNSChecks): boolean {
  return (
    checks.spf.status === 'OK' &&
    checks.dkim.status === 'OK' &&
    ['OK', 'Missing'].includes(checks.mx.status || '') &&
    ['OK', 'Missing'].includes(checks.return_path.status || '')
  );
}

function dnsResolverServers(): string[] {
  return (process.env.DNS_RESOLVERS || '1.1.1.1,8.8.8.8,9.9.9.9')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function resolveTxtFromServer(name: string, server?: string): Promise<string[]> {
  try {
    const resolver = server ? new dns.promises.Resolver() : dns.promises;
    if (server && 'setServers' in resolver) resolver.setServers([server]);
    const records = await resolver.resolveTxt(name);
    return records.map((r) => r.join(''));
  } catch {
    return [];
  }
}

async function resolveMxFromServer(name: string, server?: string): Promise<string[]> {
  try {
    const resolver = server ? new dns.promises.Resolver() : dns.promises;
    if (server && 'setServers' in resolver) resolver.setServers([server]);
    const records = await resolver.resolveMx(name);
    return records.map((r) => r.exchange);
  } catch {
    return [];
  }
}

async function resolveCnameFromServer(name: string, server?: string): Promise<string[]> {
  try {
    const resolver = server ? new dns.promises.Resolver() : dns.promises;
    if (server && 'setServers' in resolver) resolver.setServers([server]);
    return await resolver.resolveCname(name);
  } catch {
    return [];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function resolveTxt(name: string): Promise<string[]> {
  const all: string[] = [];
  all.push(...await resolveTxtFromServer(name));
  for (const server of dnsResolverServers()) {
    all.push(...await resolveTxtFromServer(name, server));
  }
  return unique(all);
}

async function resolveTxtSources(name: string): Promise<string[][]> {
  const sources: string[][] = [];
  const system = await resolveTxtFromServer(name);
  if (system.length > 0) sources.push(system);
  for (const server of dnsResolverServers()) {
    const records = await resolveTxtFromServer(name, server);
    if (records.length > 0) sources.push(records);
  }
  return sources;
}

async function resolveMx(name: string): Promise<string[]> {
  const all: string[] = [];
  all.push(...await resolveMxFromServer(name));
  for (const server of dnsResolverServers()) {
    all.push(...await resolveMxFromServer(name, server));
  }
  return unique(all);
}

async function resolveCname(name: string): Promise<string[]> {
  const all: string[] = [];
  all.push(...await resolveCnameFromServer(name));
  for (const server of dnsResolverServers()) {
    all.push(...await resolveCnameFromServer(name, server));
  }
  return unique(all);
}
export async function checkSpfRecord(name: string): Promise<DNSStatus> {
  const result = await resolveTxt(name);
  const spfRecords = result.filter((r) => /^v=spf1/.test(r));
  if (spfRecords.length === 0) {
    return { status: 'Missing', error: 'No SPF record exists for this domain' };
  }
  const suitable = spfRecords.filter((r) => new RegExp(`include:\\s*${escapeRegex(config.dns.spfInclude)}`).test(r));
  if (suitable.length === 0) {
    return { status: 'Invalid', error: `An SPF record exists but it doesn't include ${config.dns.spfInclude}` };
  }
  return { status: 'OK', error: null };
}

// ─── DKIM ─────────────────────────────────────────────────

export async function checkDkimRecord(name: string, identifierString: string, expectedRecord: string): Promise<DNSStatus> {
  const domain = `${dkimRecordName(identifierString)}.${name}`;
  const sources = await resolveTxtSources(domain);
  if (sources.length === 0) {
    return { status: 'Missing', error: `No TXT records were returned for ${domain}` };
  }

  for (const records of sources) {
    const sanitised = records.map((r) => r.trim().endsWith(';') ? r.trim() : `${r.trim()};`);
    if (sanitised.length === 1 && sanitised[0] === expectedRecord) {
      return { status: 'OK', error: null };
    }
  }

  const merged = unique(sources.flat());
  if (merged.length > 1) {
    return { status: 'Invalid', error: `There are ${merged.length} records for at ${domain}. There should only be one.` };
  }
  return {
    status: 'Invalid',
    error: `The DKIM record at ${domain} does not match the record we have provided. Please check it has been copied correctly.`,
  };
}
export async function checkMxRecords(name: string): Promise<DNSStatus> {
  const records = await resolveMx(name);
  if (records.length === 0) {
    return { status: 'Missing', error: `There are no MX records for ${name}` };
  }
  const expected = config.dns.mxRecords.map((r) => r.toLowerCase().replace(/\.$/, ''));
  const present = records.map((r) => r.toLowerCase().replace(/\.$/, ''));
  const missing = expected.filter((r) => !present.includes(r));
  if (missing.length === 0) {
    return { status: 'OK', error: null };
  }
  if (missing.length === expected.length) {
    return { status: 'Missing', error: 'You have MX records but none of them point to us.' };
  }
  return {
    status: 'Invalid',
    error: `MX ${missing.length === 1 ? 'record' : 'records'} for ${missing.join(', ')} are missing and are required.`,
  };
}

// ─── Return Path ──────────────────────────────────────────

export async function checkReturnPathRecord(name: string): Promise<DNSStatus> {
  const rpDomain = returnPathDomain(name);
  const records = await resolveCname(rpDomain);
  if (records.length === 0) {
    return { status: 'Missing', error: `There is no return path record at ${rpDomain}` };
  }
  const target = records[0].toLowerCase().replace(/\.$/, '');
  const expected = config.dns.returnPathDomain.toLowerCase().replace(/\.$/, '');
  if (target === expected) {
    return { status: 'OK', error: null };
  }
  return {
    status: 'Invalid',
    error: `There is a CNAME record at ${rpDomain} but it points to ${records[0]} which is incorrect. It should point to ${config.dns.returnPathDomain}.`,
  };
}

export async function checkDomainDNS(name: string, identifierString: string, expectedDkimRecord: string): Promise<{ checks: DomainDNSChecks; ok: boolean }> {
  const [spf, dkim, mx, return_path] = await Promise.all([
    checkSpfRecord(name),
    checkDkimRecord(name, identifierString, expectedDkimRecord),
    checkMxRecords(name),
    checkReturnPathRecord(name),
  ]);
  const checks: DomainDNSChecks = { spf, dkim, mx, return_path };
  return { checks, ok: dnsOk(checks) };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findVerifiedDomainForAddress(
  domainOrEmail: string,
  orgId: string
): Promise<{ id: string; domain: string } | null> {
  const domainPart = domainOrEmail.includes('@') ? domainOrEmail.split('@')[1].toLowerCase().trim() : domainOrEmail.toLowerCase().trim();
  const parentDoms = parentDomains(domainPart);
  if (parentDoms.length === 0) return null;

  const placeholders = parentDoms.map((_, i) => `$${i + 2}`).join(', ');
  const result = await query<{ id: string; domain: string }>(
    `SELECT id, domain FROM customer_domains
     WHERE LOWER(domain) IN (${placeholders}) AND organization_id = $1 AND verified = true`,
    [orgId, ...parentDoms]
  );

  if (result.rows.length === 0) return null;
  const sorted = result.rows.sort((a, b) => b.domain.length - a.domain.length);
  return sorted[0];
}

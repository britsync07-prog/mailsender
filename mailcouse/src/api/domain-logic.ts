// Postal-exact port of Domain model (domain.rb) + HasDNSChecks concern (has_dns_checks.rb)

import * as dns from 'dns';
import { config } from '../config';

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

async function resolveTxt(name: string): Promise<string[]> {
  try {
    const records = await dns.promises.resolveTxt(name);
    return records.map((r) => r.join(''));
  } catch {
    return [];
  }
}

async function resolveMx(name: string): Promise<string[]> {
  try {
    const records = await dns.promises.resolveMx(name);
    return records.map((r) => r.exchange);
  } catch {
    return [];
  }
}

async function resolveCname(name: string): Promise<string[]> {
  try {
    return await dns.promises.resolveCname(name);
  } catch {
    return [];
  }
}

// ─── SPF ──────────────────────────────────────────────────

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
  const records = await resolveTxt(domain);
  if (records.length === 0) {
    return { status: 'Missing', error: `No TXT records were returned for ${domain}` };
  }
  if (records.length > 1) {
    return { status: 'Invalid', error: `There are ${records.length} records for at ${domain}. There should only be one.` };
  }
  const sanitised = records[0].trim().endsWith(';') ? records[0].trim() : `${records[0].trim()};`;
  if (sanitised !== expectedRecord) {
    return {
      status: 'Invalid',
      error: `The DKIM record at ${domain} does not match the record we have provided. Please check it has been copied correctly.`,
    };
  }
  return { status: 'OK', error: null };
}

// ─── MX ───────────────────────────────────────────────────

export async function checkMxRecords(name: string): Promise<DNSStatus> {
  const records = await resolveMx(name);
  if (records.length === 0) {
    return { status: 'Missing', error: `There are no MX records for ${name}` };
  }
  const expected = config.dns.mxRecords.map((r) => r.toLowerCase());
  const present = records.map((r) => r.toLowerCase());
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
  if (records.length === 1 && records[0] === config.dns.returnPathDomain) {
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

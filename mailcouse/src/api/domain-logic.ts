// Postal-exact port of Domain model (domain.rb) + HasDNSChecks concern (has_dns_checks.rb)

import * as dns from 'dns';
import * as net from 'net';
import { config } from '../config';
import { query } from '../db/connection';

export const VERIFICATION_EMAIL_ALIASES = ['webmaster', 'postmaster', 'admin', 'administrator', 'hostmaster'] as const;
export const VERIFICATION_METHODS = ['DNS', 'Email'] as const;

export interface DNSStatus {
  status: string | null;
  error: string | null;
  checked_name?: string;
  expected?: string;
  found?: string | null;
  selector?: string;
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

export function dkimSelectorRecordName(selector: string): string {
  return `${selector}._domainkey`;
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

function configuredOutboundIps(): string[] {
  return [config.dns.outboundIpv4, config.dns.outboundIpv6].filter(Boolean);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function ipv4Matches(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function expandIpv6(ip: string): bigint | null {
  try {
    const [headRaw, tailRaw] = ip.toLowerCase().split('::');
    const head = headRaw ? headRaw.split(':').filter(Boolean) : [];
    const tail = tailRaw ? tailRaw.split(':').filter(Boolean) : [];
    const fill = new Array(8 - head.length - tail.length).fill('0');
    const parts = ip.includes('::') ? [...head, ...fill, ...tail] : ip.toLowerCase().split(':');
    if (parts.length !== 8) return null;
    return parts.reduce((acc, part) => {
      const n = parseInt(part || '0', 16);
      if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error('bad ipv6');
      return (acc << 16n) + BigInt(n);
    }, 0n);
  } catch {
    return null;
  }
}

function ipv6Matches(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
  const ipInt = expandIpv6(ip);
  const baseInt = expandIpv6(base);
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  const mask = bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
  return (ipInt & mask) === (baseInt & mask);
}

async function spfAuthorizesIp(domain: string, ip: string, seen = new Set<string>()): Promise<boolean> {
  if (seen.has(domain)) return false;
  seen.add(domain);
  const spf = (await resolveTxt(domain)).find((r) => /^v=spf1\b/i.test(r));
  if (!spf) return false;
  const mechanisms = spf.split(/\s+/).slice(1);
  for (const mechanism of mechanisms) {
    const token = mechanism.replace(/^[+?~-]/, '');
    if (net.isIPv4(ip) && token.startsWith('ip4:') && ipv4Matches(ip, token.slice(4))) return true;
    if (net.isIPv6(ip) && token.startsWith('ip6:') && ipv6Matches(ip, token.slice(4))) return true;
    if (token.startsWith('include:') && await spfAuthorizesIp(token.slice(8), ip, seen)) return true;
  }
  return false;
}

export async function checkSpfRecord(name: string): Promise<DNSStatus> {
  const result = await resolveTxt(name);
  const spfRecords = result.filter((r) => /^v=spf1\b/i.test(r));
  if (spfRecords.length === 0) {
    return { status: 'Missing', error: 'No SPF record exists for this domain', checked_name: name, found: null };
  }
  if (spfRecords.length > 1) {
    return { status: 'Invalid', error: `There are ${spfRecords.length} SPF records for ${name}. There should only be one.`, checked_name: name, found: spfRecords.join(' | ') };
  }
  const outboundIps = configuredOutboundIps();
  for (const ip of outboundIps) {
    if (!await spfAuthorizesIp(name, ip)) {
      return {
        status: 'Invalid',
        error: `Outbound ${net.isIPv6(ip) ? 'IPv6' : 'IPv4'} ${ip} is not authorized by SPF for ${name}`,
        checked_name: name,
        expected: `SPF must authorize ${ip}`,
        found: spfRecords[0],
      };
    }
  }
  if (outboundIps.length === 0 && !new RegExp(`include:\\s*${escapeRegex(config.dns.spfInclude)}`).test(spfRecords[0])) {
    return { status: 'Invalid', error: `An SPF record exists but it doesn't include ${config.dns.spfInclude}`, checked_name: name, expected: spfRecord(), found: spfRecords[0] };
  }
  return { status: 'OK', error: null, checked_name: name, expected: outboundIps.length ? `SPF authorizes ${outboundIps.join(', ')}` : spfRecord(), found: spfRecords[0] };
}

export async function checkDkimRecord(name: string, selector: string, expectedRecord: string): Promise<DNSStatus> {
  const checkedName = `${selector}._domainkey.${name}`;
  const sources = await resolveTxtSources(checkedName);
  if (sources.length === 0) {
    return { status: 'Missing', error: `No TXT records were returned for ${checkedName}`, checked_name: checkedName, expected: expectedRecord, found: null, selector };
  }

  for (const records of sources) {
    const sanitised = records.map((r) => r.trim().endsWith(';') ? r.trim() : `${r.trim()};`);
    if (sanitised.length === 1 && sanitised[0] === expectedRecord) {
      return { status: 'OK', error: null, checked_name: checkedName, expected: expectedRecord, found: sanitised[0], selector };
    }
  }

  const merged = unique(sources.flat()).map((r) => r.trim().endsWith(';') ? r.trim() : `${r.trim()};`);
  if (merged.length > 1) {
    return { status: 'Invalid', error: `There are ${merged.length} records at ${checkedName}. There should only be one.`, checked_name: checkedName, expected: expectedRecord, found: merged.join(' | '), selector };
  }
  return {
    status: 'Invalid',
    error: `The DKIM record at ${checkedName} does not match the public key used for signing.`,
    checked_name: checkedName,
    expected: expectedRecord,
    found: merged[0] || null,
    selector,
  };
}

export async function checkMxRecords(name: string): Promise<DNSStatus> {
  const records = await resolveMx(name);
  if (records.length === 0) {
    return { status: 'Missing', error: `There are no MX records for ${name}`, checked_name: name, found: null };
  }
  const expected = config.dns.mxRecords.map((r) => r.toLowerCase().replace(/\.$/, ''));
  const present = records.map((r) => r.toLowerCase().replace(/\.$/, ''));
  const missing = expected.filter((r) => !present.includes(r));
  if (missing.length === 0) {
    return { status: 'OK', error: null, checked_name: name, expected: expected.join(', '), found: records.join(', ') };
  }
  if (missing.length === expected.length) {
    return { status: 'Missing', error: 'You have MX records but none of them point to us.', checked_name: name, expected: expected.join(', '), found: records.join(', ') };
  }
  return {
    status: 'Invalid',
    error: `MX ${missing.length === 1 ? 'record' : 'records'} for ${missing.join(', ')} are missing and are required.`,
    checked_name: name,
    expected: expected.join(', '),
    found: records.join(', '),
  };
}

export async function checkReturnPathRecord(name: string): Promise<DNSStatus> {
  const rpDomain = returnPathDomain(name);
  const records = await resolveCname(rpDomain);
  if (records.length === 0) {
    return { status: 'Missing', error: `There is no return path record at ${rpDomain}`, checked_name: rpDomain, expected: config.dns.returnPathDomain, found: null };
  }
  const target = records[0].toLowerCase().replace(/\.$/, '');
  const expected = config.dns.returnPathDomain.toLowerCase().replace(/\.$/, '');
  if (target === expected) {
    return { status: 'OK', error: null, checked_name: rpDomain, expected: config.dns.returnPathDomain, found: records[0] };
  }
  return {
    status: 'Invalid',
    error: `There is a CNAME record at ${rpDomain} but it points to ${records[0]} which is incorrect. It should point to ${config.dns.returnPathDomain}.`,
    checked_name: rpDomain,
    expected: config.dns.returnPathDomain,
    found: records[0],
  };
}

export async function checkDomainDNS(name: string, selector: string, expectedDkimRecord: string): Promise<{ checks: DomainDNSChecks; ok: boolean }> {
  const [spf, dkim, mx, return_path] = await Promise.all([
    checkSpfRecord(name),
    checkDkimRecord(name, selector, expectedDkimRecord),
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

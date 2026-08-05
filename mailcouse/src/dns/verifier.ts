import { promises as dns } from 'dns';
import { checkSpfRecord, dkimRecord, checkDkimRecord } from '../api/domain-logic';

export interface DNSVerificationResult {
  domain: string;
  dkim: { selector: string; found: boolean; value?: string };
  spf: { found: boolean; value?: string; status?: string; error?: string | null };
  dmarc: { found: boolean; value?: string };
  nameservers: string[];
  all_good: boolean;
}

export async function verifyDKIMRecord(
  domain: string,
  selector: string
): Promise<{ found: boolean; value?: string }> {
  try {
    const records = await dns.resolveTxt(`${selector}._domainkey.${domain}`);
    const value = records.flat().join('');
    return { found: true, value };
  } catch {
    return { found: false };
  }
}

export async function verifySPFRecord(domain: string): Promise<{ found: boolean; value?: string; status?: string; error?: string | null }> {
  const result = await checkSpfRecord(domain);
  return { found: !!result.found, value: result.found || undefined, status: result.status || undefined, error: result.error };
}

export async function verifyDMARCRecord(domain: string): Promise<{ found: boolean; value?: string }> {
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    const dmarc = records
      .map((r) => r.join(''))
      .find((r) => r.startsWith('v=DMARC1'));
    return dmarc ? { found: true, value: dmarc } : { found: false };
  } catch {
    return { found: false };
  }
}

export async function verifyNameservers(domain: string): Promise<string[]> {
  try {
    const ns = await dns.resolveNs(domain);
    return ns;
  } catch {
    return [];
  }
}

export async function verifyDomainDNS(
  domain: string,
  selector: string,
  publicKey = ''
): Promise<DNSVerificationResult> {
  const dkimStatus = publicKey ? await checkDkimRecord(domain, selector, dkimRecord(publicKey)) : null;
  const dkim = dkimStatus ? { found: dkimStatus.status === 'OK', value: dkimStatus.found || undefined } : await verifyDKIMRecord(domain, selector);
  const spf = await verifySPFRecord(domain);
  const dmarc = await verifyDMARCRecord(domain);
  const nameservers = await verifyNameservers(domain);

  return {
    domain,
    dkim: { selector, ...dkim },
    spf,
    dmarc,
    nameservers,
    all_good: dkim.found && spf.found && spf.status !== 'Invalid' && dmarc.found,
  };
}

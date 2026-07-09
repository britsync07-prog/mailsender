import { promises as dns } from 'dns';

export interface DNSVerificationResult {
  domain: string;
  dkim: { selector: string; found: boolean; value?: string };
  spf: { found: boolean; value?: string };
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

export async function verifySPFRecord(domain: string): Promise<{ found: boolean; value?: string }> {
  try {
    const records = await dns.resolveTxt(domain);
    const spf = records
      .map((r) => r.join(''))
      .find((r) => r.startsWith('v=spf1'));
    return spf ? { found: true, value: spf } : { found: false };
  } catch {
    return { found: false };
  }
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
  selector: string
): Promise<DNSVerificationResult> {
  const dkim = await verifyDKIMRecord(domain, selector);
  const spf = await verifySPFRecord(domain);
  const dmarc = await verifyDMARCRecord(domain);
  const nameservers = await verifyNameservers(domain);

  return {
    domain,
    dkim: { selector, ...dkim },
    spf,
    dmarc,
    nameservers,
    all_good: dkim.found && spf.found && dmarc.found,
  };
}

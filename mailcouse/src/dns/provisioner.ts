import { query } from '../db/connection';
import { CloudflareClient } from '../cloudflare/client';
import { generateKeyPair, getDKIMDNSRecord } from '../dkim/key-generator';
import { encryptPrivateKey } from '../dkim/key-store';
import { buildSPFRecord, buildDMARCRecord } from './record-builder';
import { verifyDomainDNS } from './verifier';
import type { ProvisionResult } from '../cloudflare/types';

export async function provisionDomain(
  domainId: string
): Promise<ProvisionResult> {
  const errors: string[] = [];

  const domainRow = await query<{
    id: string;
    domain: string;
    industry: string;
    cloudflare_zone_id: string;
  }>('SELECT id, domain, industry, cloudflare_zone_id FROM domains WHERE id = $1', [domainId]);

  if (domainRow.rows.length === 0) {
    return { success: false, dns_records: { dkim: false, spf: false, dmarc: false }, verified: false, errors: ['Domain not found'] };
  }

  const domain = domainRow.rows[0];
  const cf = new CloudflareClient();
  let zoneId = domain.cloudflare_zone_id;

  try {
    if (!zoneId) {
      const zone = await cf.createZone(domain.domain);
      zoneId = zone.id;

      await query(
        'UPDATE domains SET cloudflare_zone_id = $1 WHERE id = $2',
        [zoneId, domain.id]
      );
    } else {
      try {
        await cf.getZone(zoneId);
      } catch {
        errors.push('Cloudflare zone not found, may need manual recreation');
      }
    }

    const dkimKeyPair = generateKeyPair();
    const dkimRecord = getDKIMDNSRecord(dkimKeyPair.publicKey, dkimKeyPair.selector, domain.domain);

    try {
      await cf.upsertDNSRecord(zoneId, {
        type: 'TXT',
        name: dkimRecord.name,
        content: dkimRecord.value,
      });
    } catch (e) {
      errors.push(`DKIM DNS record failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    try {
      const spfRecord = buildSPFRecord(domain.domain, {
        ipAddresses: [],
        policy: '~all',
      });
      await cf.upsertDNSRecord(zoneId, {
        type: 'TXT',
        name: spfRecord.name,
        content: spfRecord.content,
      });
    } catch (e) {
      errors.push(`SPF DNS record failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    try {
      const dmarcRecord = buildDMARCRecord(domain.domain, {
        policy: 'none',
      });
      await cf.upsertDNSRecord(zoneId, {
        type: 'TXT',
        name: dmarcRecord.name,
        content: dmarcRecord.content,
      });
    } catch (e) {
      errors.push(`DMARC DNS record failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    const encryptedKey = encryptPrivateKey(dkimKeyPair.privateKey);
    await query(
      `UPDATE subdomains
       SET dkim_selector = $1, dkim_private_key = $2
       WHERE domain_id = $3`,
      [dkimKeyPair.selector, encryptedKey, domain.id]
    );

    await query(
      `UPDATE domains
       SET dns_provisioned = true, status = 'active'
       WHERE id = $1`,
      [domain.id]
    );

    const dkimFound = !errors.some((e) => e.includes('DKIM'));
    const spfFound = !errors.some((e) => e.includes('SPF'));
    const dmarcFound = !errors.some((e) => e.includes('DMARC'));

    let verified = false;
    try {
      const verification = await verifyDomainDNS(domain.domain, dkimKeyPair.selector);
      verified = verification.all_good;
      if (!verified) {
        errors.push(`DNS verification failed: DKIM=${verification.dkim.found}, SPF=${verification.spf.found}, DMARC=${verification.dmarc.found}`);
      }

      await query(
        `UPDATE subdomains SET dns_verified = $1 WHERE domain_id = $2`,
        [verified, domain.id]
      );
    } catch (e) {
      errors.push(`DNS verification error: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    return {
      success: errors.length === 0,
      zone_id: zoneId,
      dns_records: { dkim: dkimFound, spf: spfFound, dmarc: dmarcFound },
      verified,
      errors,
    };
  } catch (e) {
    return {
      success: false,
      dns_records: { dkim: false, spf: false, dmarc: false },
      verified: false,
      errors: [e instanceof Error ? e.message : 'Provisioning failed'],
    };
  }
}

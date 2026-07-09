import type { SPFConfig, DMARCConfig, DNSRecordSpec, CAAConfig, MXConfig } from './types';

export function buildSPFRecord(domain: string, config: SPFConfig): DNSRecordSpec {
  const mechanisms: string[] = ['v=spf1'];

  if (config.ipAddresses) {
    for (const ip of config.ipAddresses) {
      mechanisms.push(`ip4:${ip}`);
    }
  }

  if (config.aRecords) {
    for (const a of config.aRecords) {
      mechanisms.push(`a:${a}`);
    }
  }

  if (config.mxRecords) {
    for (const mx of config.mxRecords) {
      mechanisms.push(`mx:${mx}`);
    }
  }

  if (config.includeDomains) {
    for (const inc of config.includeDomains) {
      mechanisms.push(`include:${inc}`);
    }
  }

  if (config.exists) {
    for (const e of config.exists) {
      mechanisms.push(`exists:${e}`);
    }
  }

  if (config.redirect) {
    mechanisms.push(`redirect=${config.redirect}`);
  }

  if (config.exp) {
    mechanisms.push(`exp=${config.exp}`);
  }

  mechanisms.push(config.policy || '~all');

  return {
    name: domain,
    type: 'TXT',
    content: mechanisms.join(' '),
    ttl: 300,
  };
}

export function buildDMARCRecord(domain: string, config: DMARCConfig): DNSRecordSpec {
  const tags: string[] = [`v=DMARC1`, `p=${config.policy}`];

  if (config.subdomainPolicy) {
    tags.push(`sp=${config.subdomainPolicy}`);
  }

  if (config.alignmentDkim) {
    tags.push(`adkim=${config.alignmentDkim}`);
  }

  if (config.alignmentSpf) {
    tags.push(`aspf=${config.alignmentSpf}`);
  }

  if (config.aggregateReportUri) {
    tags.push(`rua=mailto:${config.aggregateReportUri}`);
  }

  if (config.forensicReportUri) {
    tags.push(`ruf=mailto:${config.forensicReportUri}`);
  }

  if (config.percentage !== undefined) {
    tags.push(`pct=${config.percentage}`);
  }

  if (config.reportingInterval !== undefined) {
    tags.push(`ri=${config.reportingInterval}`);
  }

  if (config.failureReporting) {
    const fo: string[] = [];
    if (config.failureReporting.dkim) fo.push('d');
    if (config.failureReporting.spf) fo.push('s');
    if (fo.length > 0) {
      tags.push(`fo=${fo.join(':')}`);
    }
  }

  return {
    name: `_dmarc.${domain}`,
    type: 'TXT',
    content: tags.join('; '),
    ttl: 300,
  };
}

export function buildDKIMRecordSpec(
  domain: string,
  selector: string,
  publicKeyBase64: string
): DNSRecordSpec {
  return {
    name: `${selector}._domainkey.${domain}`,
    type: 'TXT',
    content: `v=DKIM1; k=rsa; p=${publicKeyBase64}`,
    ttl: 300,
  };
}

export function buildCAAConfig(domain: string, config: { flags: number; tag: 'issue' | 'issuewild' | 'iodef'; value: string }): DNSRecordSpec {
  return {
    name: domain,
    type: 'TXT',
    content: `${config.flags} ${config.tag} "${config.value}"`,
    ttl: 300,
  };
}

export function buildMXRecord(domain: string, host: string, priority: number): DNSRecordSpec {
  return {
    name: domain,
    type: 'MX',
    content: `${priority} ${host}`,
    ttl: 300,
  };
}

export function parseSPFRecord(spfValue: string): SPFConfig {
  const mechanisms: SPFConfig = { ipAddresses: [], policy: '~all' };

  if (!spfValue.startsWith('v=spf1')) {
    return mechanisms;
  }

  const parts = spfValue.split(' ');
  for (const part of parts) {
    if (part.startsWith('ip4:')) {
      mechanisms.ipAddresses.push(part.substring(4));
    } else if (part.startsWith('include:')) {
      if (!mechanisms.includeDomains) mechanisms.includeDomains = [];
      mechanisms.includeDomains.push(part.substring(8));
    } else if (part.startsWith('a:')) {
      if (!mechanisms.aRecords) mechanisms.aRecords = [];
      mechanisms.aRecords.push(part.substring(2));
    } else if (part.startsWith('mx:')) {
      if (!mechanisms.mxRecords) mechanisms.mxRecords = [];
      mechanisms.mxRecords.push(part.substring(3));
    } else if (part.startsWith('exists:')) {
      if (!mechanisms.exists) mechanisms.exists = [];
      mechanisms.exists.push(part.substring(7));
    } else if (part.startsWith('redirect=')) {
      mechanisms.redirect = part.substring(9);
    } else if (part.startsWith('exp=')) {
      mechanisms.exp = part.substring(4);
    } else if (part === '-all' || part === '~all' || part === '+all' || part === '?all') {
      mechanisms.policy = part;
    }
  }

  return mechanisms;
}

export function parseDMARCRecord(dmarcValue: string): Required<Pick<DMARCConfig, 'policy'>> & Partial<DMARCConfig> {
  const config: Required<Pick<DMARCConfig, 'policy'>> & Partial<DMARCConfig> = { policy: 'none' };

  if (!dmarcValue.startsWith('v=DMARC1')) {
    return config;
  }

  const tags = dmarcValue.split(';');
  for (const tag of tags) {
    const [key, ...rest] = tag.trim().split('=');
    const value = rest.join('=');
    switch (key.trim()) {
      case 'p':
        if (value === 'none' || value === 'quarantine' || value === 'reject') {
          config.policy = value;
        }
        break;
      case 'sp':
        if (value === 'none' || value === 'quarantine' || value === 'reject') {
          config.subdomainPolicy = value;
        }
        break;
      case 'rua':
        config.aggregateReportUri = value.replace(/^mailto:/, '');
        break;
      case 'ruf':
        config.forensicReportUri = value.replace(/^mailto:/, '');
        break;
      case 'pct':
        config.percentage = parseInt(value, 10);
        break;
      case 'adkim':
        if (value === 'r' || value === 's') config.alignmentDkim = value;
        break;
      case 'aspf':
        if (value === 'r' || value === 's') config.alignmentSpf = value;
        break;
      case 'ri':
        config.reportingInterval = parseInt(value, 10);
        break;
    }
  }

  return config;
}

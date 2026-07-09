import { buildMimeHeaders } from '../fingerprint/header-randomizer';
import { storeOutboundThreadInfo } from '../threading/manager';
import { JobPayload } from '../queue/types';

export interface EmailContent {
  from: string;
  to: string;
  subject: string;
  body: string;
  mimeHeaders: Array<{ key: string; value: string }>;
}

export async function buildEmail(job: JobPayload, templateSubject: string, templateBody: string): Promise<EmailContent> {
  const subject = templateSubject
    .replace(/\{\{first_name\}\}/g, job.first_name || '')
    .replace(/\{\{company_name\}\}/g, job.company || '')
    .replace(/\{\{industry\}\}/g, job.industry || '');

  const body = templateBody
    .replace(/\{\{first_name\}\}/g, job.first_name || '')
    .replace(/\{\{company_name\}\}/g, job.company || '')
    .replace(/\{\{industry\}\}/g, job.industry || '')
    .replace(/\{\{pain_point\}\}/g, job.pain_point || '');

  const from = `${job.sender_name} <${job.subdomain}>`;

  const threadInfo = await storeOutboundThreadInfo(
    job.lead_id,
    job.email,
    subject,
    job.subdomain_id,
    job.job_id,
    from,
    job.email,
    body.substring(0, 200),
    job.industry
  );

  const preHeaders: Record<string, string> = { 'Subject': subject };

  if (threadInfo.inReplyTo) {
    preHeaders['In-Reply-To'] = threadInfo.inReplyTo;
  }
  if (threadInfo.references && threadInfo.references.length > 0) {
    preHeaders['References'] = threadInfo.references.join(' ');
  }

  const mimeHeaders = buildMimeHeaders(job.subdomain, job.job_id, subject, job.sender_name, preHeaders);

  return {
    from,
    to: job.email,
    subject,
    body,
    mimeHeaders,
  };
}

export async function buildReplyEmail(
  from: string,
  to: string,
  subject: string,
  body: string,
  originalMessageId: string,
  subdomain: string,
  jobId: string
): Promise<EmailContent> {
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const preHeaders: Record<string, string> = {
    'Subject': replySubject,
    'In-Reply-To': originalMessageId,
    'References': originalMessageId,
  };

  const mimeHeaders = buildMimeHeaders(subdomain, jobId, replySubject, from, preHeaders);

  return {
    from,
    to,
    subject: replySubject,
    body,
    mimeHeaders,
  };
}

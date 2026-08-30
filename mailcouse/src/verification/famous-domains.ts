/**
 * Famous and most used email provider domains.
 * The entire domain (e.g. gmail.com, outlook.com) must NEVER be added to the suppression list.
 * However, confirmed nonexistent individual addresses (e.g. confirmed-nonexistent@gmail.com)
 * may be suppressed upon verified permanent failure.
 */
export const FAMOUS_EMAIL_DOMAINS = new Set<string>([
  // Google
  'gmail.com',
  'googlemail.com',
  'google.com',

  // Microsoft
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.es',
  'hotmail.it',
  'outlook.co.uk',
  'outlook.fr',
  'outlook.de',
  'outlook.es',
  'windowslive.com',
  'passport.com',

  // Yahoo
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'yahoo.co.uk',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.es',
  'yahoo.it',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.co.jp',
  'yahoo.com.br',
  'yahoo.in',

  // Apple
  'icloud.com',
  'me.com',
  'mac.com',

  // AOL
  'aol.com',
  'aim.com',

  // Zoho
  'zoho.com',
  'zohomail.com',

  // Proton
  'proton.me',
  'protonmail.com',
  'pm.me',

  // GMX / Mail.com / European Providers
  'mail.com',
  'email.com',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  't-online.de',
  'freenet.de',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'laposte.net',
  'libero.it',
  'virgilio.it',
  'tin.it',
  'alice.it',
  'tiscali.it',

  // Major US ISPs
  'comcast.net',
  'att.net',
  'sbcglobal.net',
  'verizon.net',
  'cox.net',
  'charter.net',
  'spectrum.net',
  'bellsouth.net',
  'earthlink.net',
  'optonline.net',
  'frontier.com',
  'windstream.net',
  'centurylink.net',

  // UK ISPs
  'btinternet.com',
  'virginmedia.com',
  'sky.com',
  'talktalk.net',

  // Eastern European / Russian
  'yandex.ru',
  'yandex.com',
  'mail.ru',
  'inbox.ru',
  'list.ru',
  'bk.ru',

  // Asian Providers
  'naver.com',
  'daum.net',
  'hanmail.net',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'aliyun.com',
  'foxmail.com',
  'rediffmail.com',
]);

/**
 * Checks whether an entry is an entire famous domain or wildcard domain pattern.
 * e.g. "gmail.com", "@gmail.com", "*@gmail.com" -> true (MUST NEVER BE SUPPRESSED)
 * "user@gmail.com" -> false (Individual address may be suppressed on confirmed hard bounce)
 */
export function isEntireFamousDomain(target: string): boolean {
  if (!target) return false;
  const str = String(target).trim().toLowerCase();

  // Check if it's a domain name without local-part or a wildcard
  if (!str.includes('@')) {
    return FAMOUS_EMAIL_DOMAINS.has(str);
  }

  const parts = str.split('@');
  const localPart = parts[0];
  const domain = parts[1];

  // If localPart is empty, wildcard, or root
  if (!localPart || localPart === '*' || localPart === '%') {
    return FAMOUS_EMAIL_DOMAINS.has(domain);
  }

  return false;
}

/**
 * Checks whether a domain name belongs to a famous/major provider.
 */
export function isFamousDomain(emailOrDomain: string): boolean {
  if (!emailOrDomain) return false;
  const str = String(emailOrDomain).trim().toLowerCase();
  const domain = str.includes('@') ? str.split('@')[1] : str;
  return FAMOUS_EMAIL_DOMAINS.has(domain);
}

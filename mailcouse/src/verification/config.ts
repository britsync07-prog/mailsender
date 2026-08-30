import { VerifierClientConfig } from './types';

export const verifierConfig: VerifierClientConfig = {
  enabled: process.env.VERIFIER_ENABLED !== 'false',
  serviceUrl: process.env.VERIFIER_SERVICE_URL || process.env.VERIFIER_URL || 'http://127.0.0.1:8090/v1/verify',
  apiKey: process.env.VERIFIER_API_KEY || '',
  timeoutMs: parseInt(process.env.VERIFIER_TIMEOUT_MS || '5000', 10),
  failureMode: (process.env.VERIFIER_FAILURE_MODE?.toLowerCase() === 'block' ? 'block' : 'allow') as 'allow' | 'block',
  cacheEnabled: process.env.VERIFIER_CACHE_ENABLED !== 'false',
  cacheTtlSuccessSec: parseInt(process.env.VERIFICATION_CACHE_TTL || '86400', 10),     // 24 hours
  cacheTtlNegativeSec: parseInt(process.env.NEGATIVE_CACHE_TTL || '86400', 10),       // 24 hours
  cacheTtlUnknownSec: parseInt(process.env.UNKNOWN_CACHE_TTL || '3600', 10),          // 1 hour
};

import fetch from 'node-fetch';
import { verifierConfig } from './config';
import { VerificationResult } from './types';

/**
 * Calls the local/internal Email Verifier microservice (Go + AfterShip/email-verifier).
 */
export async function verifyEmailViaApi(email: string): Promise<VerificationResult> {
  const url = verifierConfig.serviceUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), verifierConfig.timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (verifierConfig.apiKey) {
      headers['X-API-Key'] = verifierConfig.apiKey;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: email.trim() }),
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Verifier HTTP ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as VerificationResult;
    return data;
  } catch (error: any) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Checks if the Email Verifier microservice is healthy and reachable.
 */
export async function checkVerifierHealth(): Promise<boolean> {
  try {
    const healthUrl = verifierConfig.serviceUrl.replace(/\/v1\/verify.*$/, '/health');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(healthUrl, { signal: controller.signal as any });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

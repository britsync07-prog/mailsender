// Stage: External AfterShip Email Verifier Stage

import { StageResult } from '../types';
import { verifyRecipient } from '../../verification';

export async function validateWithVerifierService(email: string): Promise<StageResult> {
  const startTime = Date.now();
  try {
    const result = await verifyRecipient(email);

    return {
      stage: 'smtp_handshake',
      passed: result.allowed,
      error: result.allowed ? undefined : result.reason,
      duration_ms: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      stage: 'smtp_handshake',
      passed: false,
      error: `Verifier error: ${error.message}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

import { Router, Request, Response } from 'express';
import { verifyBatch, verifyEmailAddress } from '../validation/email-existence';

const router = Router();

// POST /api/verify  { emails: string[], force?: boolean, concurrency?: number }
router.post('/', async (req: Request, res: Response) => {
  try {
    const emails: unknown = req.body?.emails;
    if (typeof req.body?.email === 'string') {
      const result = await verifyEmailAddress(req.body.email, req.body?.force === true);
      return res.json({ results: [result] });
    }
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'provide "emails": string[] or "email": string' });
    }
    if (emails.length > 500) {
      return res.status(400).json({ error: 'max 500 emails per request' });
    }
    const results = await verifyBatch(emails as string[], {
      force: req.body?.force === true,
      concurrency: typeof req.body?.concurrency === 'number' ? req.body.concurrency : undefined,
    });
    const summary = {
      valid: results.filter(r => r.status === 'valid').length,
      invalid: results.filter(r => r.status === 'invalid').length,
      catch_all: results.filter(r => r.status === 'catch_all').length,
      unknown: results.filter(r => r.status === 'unknown').length,
    };
    res.json({ summary, results });
  } catch (err: any) {
    console.error('verify route error:', err?.message);
    res.status(500).json({ error: 'verification failed' });
  }
});

// GET /api/verify?email=some@address
router.get('/', async (req: Request, res: Response) => {
  const email = String(req.query.email || '');
  if (!email) return res.status(400).json({ error: '?email= required' });
  try {
    const result = await verifyEmailAddress(email, req.query.force === '1');
    res.json(result);
  } catch (err: any) {
    console.error('verify route error:', err?.message);
    res.status(500).json({ error: 'verification failed' });
  }
});

export default router;

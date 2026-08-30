import request from 'supertest';
import express from 'express';
import sendRoutes from '../send-routes';
import * as verificationModule from '../../verification';
import * as db from '../../db/connection';
import * as keyStore from '../../dkim/key-store';
import * as gate from '../../warmup/gate';
import * as dns from 'dns';
import nodemailer from 'nodemailer';

jest.mock('../../verification');
jest.mock('../../db/connection');
jest.mock('../../dkim/key-store');
jest.mock('../../warmup/gate');
jest.mock('dns', () => ({
  promises: {
    resolveMx: jest.fn(),
    resolve4: jest.fn(),
  },
}));
jest.mock('nodemailer');

const app = express();
app.use(express.json());
app.use('/api/send', sendRoutes);

describe('Send Routes Pre-Send Verification Layer', () => {
  const mockVerify = verificationModule.verifyRecipient as jest.MockedFunction<typeof verificationModule.verifyRecipient>;
  const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
  const mockGetDKIM = keyStore.getDKIMPrivateKey as jest.MockedFunction<typeof keyStore.getDKIMPrivateKey>;
  const mockWarmupGate = gate.checkWarmupGate as jest.MockedFunction<typeof gate.checkWarmupGate>;
  const mockResolveMx = dns.promises.resolveMx as jest.MockedFunction<typeof dns.promises.resolveMx>;
  const mockResolve4 = dns.promises.resolve4 as jest.MockedFunction<typeof dns.promises.resolve4>;
  const mockCreateTransport = nodemailer.createTransport as jest.MockedFunction<typeof nodemailer.createTransport>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should block send when recipient is rejected by verification policy (422 Unprocessable Entity)', async () => {
    mockVerify.mockResolvedValueOnce({
      email: 'invalid@example.com',
      decision: 'block',
      allowed: false,
      reason: 'No MX records exist',
      source: 'verifier',
      duration_ms: 15,
      suggestion: 'example.org',
    });

    const res = await request(app)
      .post('/api/send')
      .send({
        to: 'invalid@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.decision).toBe('block');
    expect(res.body.error).toContain('Verification rejected: No MX records exist');
    expect(res.body.suggestion).toContain('Did you mean invalid@example.org?');
    // Existing sending logic should NOT have been invoked
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it('should block send when recipient is on suppression list (403 Forbidden)', async () => {
    mockVerify.mockResolvedValueOnce({
      email: 'suppressed@example.com',
      decision: 'block',
      allowed: false,
      reason: 'Recipient is on suppression list (hard_bounce)',
      source: 'suppression',
      duration_ms: 2,
    });

    const res = await request(app)
      .post('/api/send')
      .send({
        to: 'suppressed@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.decision).toBe('block');
    expect(res.body.error).toContain('suppression list');
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it('should proceed to existing send flow when recipient is allowed by verifier', async () => {
    mockVerify.mockResolvedValueOnce({
      email: 'valid@example.com',
      decision: 'allow',
      allowed: true,
      reason: 'Recipient address verified and deliverable',
      source: 'verifier',
      duration_ms: 45,
    });

    // Mock active subdomain
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'sub-1',
        subdomain: 's1.noblecircle.online',
        sender_name: 'Noble Sender',
        root_domain: 'noblecircle.online',
      }],
      rowCount: 1,
    } as any);

    // Warmup gate passes
    mockWarmupGate.mockResolvedValueOnce({ passed: true } as any);

    // DNS MX resolution
    mockResolveMx.mockResolvedValueOnce([
      { exchange: 'mail.example.com', priority: 10 },
    ] as any);
    mockResolve4.mockResolvedValueOnce(['93.184.216.34']);

    // DKIM key
    mockGetDKIM.mockResolvedValueOnce({
      selector: 'postal',
      privateKey: 'mock-key',
    } as any);

    // Leads query
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'lead-1' }], rowCount: 1 } as any);
    // Sent message insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'msg-1' }], rowCount: 1 } as any);
    // Update lead count
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    // Update sent message status
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    // Update subdomain count
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    // Mock nodemailer transport
    const mockSendMail = jest.fn().mockResolvedValueOnce({ response: '250 2.0.0 Ok: queued' });
    const mockClose = jest.fn();
    mockCreateTransport.mockReturnValueOnce({
      sendMail: mockSendMail,
      close: mockClose,
    } as any);

    const res = await request(app)
      .post('/api/send')
      .send({
        to: 'valid@example.com',
        subject: 'Hello World',
        body: 'Test Message',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.response_message).toBe('250 2.0.0 Ok: queued');
    expect(mockSendMail).toHaveBeenCalled();
  });
});

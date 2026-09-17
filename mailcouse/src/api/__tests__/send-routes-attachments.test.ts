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

describe('Send Routes Attachments Integration', () => {
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

  it('should process attachments, send via nodemailer, and insert into message_attachments', async () => {
    mockVerify.mockResolvedValueOnce({
      email: 'client@example.com',
      decision: 'allow',
      allowed: true,
      reason: 'OK',
      source: 'verifier',
      duration_ms: 10,
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
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sent-msg-123' }], rowCount: 1 } as any);
    // message_attachments insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'att-sent-1' }], rowCount: 1 } as any);
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

    const testPdfContent = Buffer.from('%PDF-1.4 test document').toString('base64');

    const res = await request(app)
      .post('/api/send')
      .send({
        to: 'client@example.com',
        subject: 'Contract Agreement',
        body: 'Please review the attached contract.',
        attachments: [
          {
            filename: 'contract.pdf',
            contentType: 'application/pdf',
            content: testPdfContent,
            encoding: 'base64',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify nodemailer sendMail was invoked with attachment
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const sendMailOptions = mockSendMail.mock.calls[0][0];
    expect(sendMailOptions.attachments).toBeDefined();
    expect(sendMailOptions.attachments).toHaveLength(1);
    expect(sendMailOptions.attachments[0].filename).toBe('contract.pdf');
    expect(sendMailOptions.attachments[0].contentType).toBe('application/pdf');

    // Verify sent_messages insert included has_attachment and attachment_count
    const insertSentCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO sent_messages')
    );
    expect(insertSentCall).toBeDefined();
    expect(insertSentCall![0]).toContain('has_attachment');
    expect(insertSentCall![0]).toContain('attachment_count');
    expect(insertSentCall![1]).toContain(true);
    expect(insertSentCall![1]).toContain(1);

    // Verify message_attachments insert was performed
    const insertAttCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO message_attachments')
    );
    expect(insertAttCall).toBeDefined();
    const attParams = insertAttCall![1] as any[];
    expect(attParams[0]).toBe('sent-msg-123');
    expect(attParams[1]).toBe('contract.pdf');
    expect(attParams[2]).toBe('application/pdf');
  });
});

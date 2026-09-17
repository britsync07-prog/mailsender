import net from 'net';
import { createImapServer } from '../server';
import {
  authenticateMailbox,
  getFolder,
  getFolderStats,
  listFolders,
  listMessagesBySequence,
  appendMessage,
} from '../mailbox-store';

jest.mock('../../db/connection', () => {
  const actual = jest.requireActual('../../db/connection');
  return {
    ...actual,
    query: jest.fn(),
    transaction: jest.fn((cb) => cb({ query: jest.fn() })),
  };
});

jest.mock('../mailbox-store', () => ({
  authenticateMailbox: jest.fn(),
  getFolder: jest.fn(),
  getFolderStats: jest.fn(),
  listFolders: jest.fn(),
  listMessagesBySequence: jest.fn(),
  moveMessages: jest.fn(),
  copyMessages: jest.fn(),
  expungeMessages: jest.fn(),
  setMessageFlags: jest.fn(),
  searchMessages: jest.fn(),
  appendMessage: jest.fn(),
}));

describe('IMAP Server Attachment Handling & RFC 3501 Compliance', () => {
  let server: net.Server;
  let port: number;

  const samplePdfContent = Buffer.from('%PDF-1.7 sample pdf content for testing');
  const samplePdfBase64 = samplePdfContent.toString('base64');

  const sampleRawMimeWithAttachment = [
    'Date: Thu, 17 Sep 2026 16:55:31 +0000',
    'From: "Mr Mokless" <mdsaimon552723@gmail.com>',
    'To: saimon@ascentraconsulting.co.uk',
    'Subject: Jsjs',
    'Message-ID: <00000000000079b3f3065baef93c@google.com>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="00000000000079b3f1065baef939"',
    '',
    '--00000000000079b3f1065baef939',
    'Content-Type: multipart/alternative; boundary="00000000000079b3f0065baef937"',
    '',
    '--00000000000079b3f0065baef937',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    'Jsjs',
    '--00000000000079b3f0065baef937',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    '<div dir="auto">Jsjs</div>',
    '--00000000000079b3f0065baef937--',
    '--00000000000079b3f1065baef939',
    'Content-Type: application/pdf; name="cover page (1).pdf"',
    'Content-Disposition: attachment; filename="cover page (1).pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    samplePdfBase64,
    '--00000000000079b3f1065baef939--',
  ].join('\r\n');

  const mockMailbox = {
    id: 'user-1',
    email: 'test@example.com',
    password_hash: 'hash',
    imap_enabled: true,
    smtp_tier: 'personal',
  };

  const mockInbox = {
    id: 'folder-1',
    mailbox_id: 'user-1',
    name: 'INBOX',
    special_use: '\\Inbox',
    uid_validity: 12345,
    uid_next: 100,
  };

  const mockMessage = {
    id: '7e50020a-b2a2-4266-beb3-603effde5c35',
    mailbox_id: 'user-1',
    folder_id: 'folder-1',
    uid: 42,
    raw_source: sampleRawMimeWithAttachment,
    subject: 'Jsjs',
    from_text: '"Mr Mokless" <mdsaimon552723@gmail.com>',
    to_text: 'saimon@ascentraconsulting.co.uk',
    body_text: 'Jsjs',
    body_html: '<div dir="auto">Jsjs</div>',
    internal_date: new Date('2026-09-17T16:55:31.000Z'),
    size: Buffer.byteLength(sampleRawMimeWithAttachment),
    flags: ['\\Seen'],
    has_attachment: true,
    attachment_count: 1,
  };

  beforeAll((done) => {
    server = createImapServer(false) as net.Server;
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as net.AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  const createClient = (): Promise<{ client: net.Socket; send: (cmd: string) => Promise<string> }> => {
    return new Promise((resolve) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        let buffer = '';
        let pendingResolve: ((val: string) => void) | null = null;

        client.on('data', (data) => {
          buffer += data.toString();
          if (pendingResolve && (buffer.includes(' OK ') || buffer.includes(' NO ') || buffer.includes(' BAD ') || buffer.startsWith('+ '))) {
            const out = buffer;
            buffer = '';
            const res = pendingResolve;
            pendingResolve = null;
            res(out);
          }
        });

        const send = (cmd: string): Promise<string> => {
          return new Promise((res) => {
            pendingResolve = res;
            client.write(`${cmd}\r\n`);
          });
        };

        // Wait for initial greeting
        client.once('data', () => {
          buffer = '';
          resolve({ client, send });
        });
      });
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (authenticateMailbox as jest.Mock).mockResolvedValue(mockMailbox);
    (getFolder as jest.Mock).mockResolvedValue(mockInbox);
    (getFolderStats as jest.Mock).mockResolvedValue({
      exists: 1,
      unseen: 0,
      uidNext: 100,
      uidValidity: 12345,
    });
    (listMessagesBySequence as jest.Mock).mockResolvedValue([mockMessage]);
  });

  it('should authenticate and select INBOX', async () => {
    const { client, send } = await createClient();
    const loginRes = await send('A01 LOGIN test@example.com password');
    expect(loginRes).toContain('A01 OK LOGIN completed');

    const selectRes = await send('A02 SELECT INBOX');
    expect(selectRes).toContain('A02 OK [READ-WRITE] SELECT completed');
    expect(selectRes).toContain('* 1 EXISTS');
    expect(selectRes).toContain('[UIDVALIDITY 12345]');
    client.end();
  });

  it('should return RFC 3501 BODYSTRUCTURE describing attachment when requested', async () => {
    const { client, send } = await createClient();
    await send('A01 LOGIN test@example.com password');
    await send('A02 SELECT INBOX');

    const fetchRes = await send('A03 UID FETCH 42 (BODYSTRUCTURE)');
    expect(fetchRes).toContain('A03 OK UID completed');
    expect(fetchRes).toContain('* 1 FETCH');
    expect(fetchRes).toContain('BODYSTRUCTURE');
    // Must describe PDF attachment with filename and type
    expect(fetchRes).toContain('"APPLICATION" "PDF"');
    expect(fetchRes).toContain('"cover page (1).pdf"');
    expect(fetchRes).toContain('"BASE64"');
    expect(fetchRes).toContain('("ATTACHMENT" ("FILENAME" "cover page (1).pdf"))');
    // Must not dump full literal body when only BODYSTRUCTURE requested
    expect(fetchRes).not.toContain('BODY[] {');
    client.end();
  });

  it('should return ENVELOPE with parsed headers and addresses', async () => {
    const { client, send } = await createClient();
    await send('A01 LOGIN test@example.com password');
    await send('A02 SELECT INBOX');

    const fetchRes = await send('A03 UID FETCH 42 (ENVELOPE)');
    expect(fetchRes).toContain('A03 OK UID completed');
    expect(fetchRes).toContain('ENVELOPE');
    expect(fetchRes).toContain('"Jsjs"');
    expect(fetchRes).toContain('"Mr Mokless"');
    expect(fetchRes).toContain('"mdsaimon552723"');
    expect(fetchRes).toContain('"gmail.com"');
    expect(fetchRes).toContain('"saimon"');
    expect(fetchRes).toContain('"ascentraconsulting.co.uk"');
    client.end();
  });

  it('should return summary items (UID FLAGS INTERNALDATE RFC822.SIZE ENVELOPE BODYSTRUCTURE) in single response', async () => {
    const { client, send } = await createClient();
    await send('A01 LOGIN test@example.com password');
    await send('A02 SELECT INBOX');

    const fetchRes = await send('A03 UID FETCH 42 (UID FLAGS INTERNALDATE RFC822.SIZE ENVELOPE BODYSTRUCTURE)');
    expect(fetchRes).toContain('A03 OK UID completed');
    expect(fetchRes).toContain('UID 42');
    expect(fetchRes).toContain('FLAGS (\\Seen)');
    expect(fetchRes).toContain('INTERNALDATE "17-Sep-2026');
    expect(fetchRes).toContain(`RFC822.SIZE ${mockMessage.size}`);
    expect(fetchRes).toContain('ENVELOPE');
    expect(fetchRes).toContain('BODYSTRUCTURE');
    // No raw body literal
    expect(fetchRes).not.toContain('BODY[] {');
    client.end();
  });

  it('should return raw literal when BODY[] or BODY.PEEK[] is requested', async () => {
    const { client, send } = await createClient();
    await send('A01 LOGIN test@example.com password');
    await send('A02 SELECT INBOX');

    const fetchRes = await send('A03 UID FETCH 42 (BODY.PEEK[])');
    expect(fetchRes).toContain('A03 OK UID completed');
    expect(fetchRes).toContain(`BODY[] {${mockMessage.size}}`);
    expect(fetchRes).toContain('Subject: Jsjs');
    expect(fetchRes).toContain('filename="cover page (1).pdf"');
    expect(fetchRes).toContain(samplePdfBase64);
    client.end();
  });

  it('should extract specific header fields with BODY.PEEK[HEADER.FIELDS (...)]', async () => {
    const { client, send } = await createClient();
    await send('A01 LOGIN test@example.com password');
    await send('A02 SELECT INBOX');

    const fetchRes = await send('A03 UID FETCH 42 (BODY.PEEK[HEADER.FIELDS (Subject From)])');
    expect(fetchRes).toContain('A03 OK UID completed');
    expect(fetchRes).toContain('BODY[HEADER.FIELDS (Subject From)]');
    expect(fetchRes).toContain('Subject: Jsjs');
    expect(fetchRes).toContain('From: "Mr Mokless" <mdsaimon552723@gmail.com>');
    expect(fetchRes).not.toContain('MIME-Version: 1.0');
    client.end();
  });

  it('should handle APPEND with attachment literals without corruption', async () => {
    const { client } = await createClient();
    (appendMessage as jest.Mock).mockResolvedValueOnce({
      id: 'new-msg-1',
      uid: 43,
      has_attachment: true,
      attachment_count: 1,
    });

    const sendRaw = (text: string): Promise<string> => {
      return new Promise((resolve) => {
        let buffer = '';
        const onData = (data: Buffer) => {
          buffer += data.toString();
          if (buffer.includes(' OK ') || buffer.includes(' NO ') || buffer.startsWith('+ ')) {
            client.off('data', onData);
            resolve(buffer);
          }
        };
        client.on('data', onData);
        client.write(text);
      });
    };

    await sendRaw('A01 LOGIN test@example.com password\r\n');

    const appendCmd = `A02 APPEND "INBOX" (\\Seen) {${Buffer.byteLength(sampleRawMimeWithAttachment)}}\r\n`;
    const prompt = await sendRaw(appendCmd);
    expect(prompt).toContain('+ Ready for literal data');

    // Send literal bytes followed by CRLF
    const appendDone = await sendRaw(`${sampleRawMimeWithAttachment}\r\n`);
    expect(appendDone).toContain('A02 OK APPEND completed');
    expect(appendMessage).toHaveBeenCalledWith({
      mailboxId: 'user-1',
      folderName: 'INBOX',
      flags: ['\\Seen'],
      rawSource: sampleRawMimeWithAttachment,
    });

    client.end();
  });
});

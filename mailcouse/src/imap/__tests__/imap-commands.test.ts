import net from 'net';
import { createImapServer } from '../server';
import {
  authenticateMailbox,
  getFolder,
  getFolderStats,
  listFolders,
  listMessagesBySequence,
  moveMessages,
  copyMessages,
  expungeMessages,
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

describe('IMAP Server MOVE, COPY & EXPUNGE Commands', () => {
  let server: net.Server;
  let port: number;

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

  const sendCommand = (client: net.Socket, cmd: string): Promise<string> => {
    return new Promise((resolve) => {
      const onData = (data: Buffer) => {
        client.off('data', onData);
        resolve(data.toString());
      };
      client.on('data', onData);
      client.write(`${cmd}\r\n`);
    });
  };

  const connectClient = (): Promise<{ client: net.Socket; greeting: string }> => {
    return new Promise((resolve) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {});
      client.once('data', (data) => {
        resolve({ client, greeting: data.toString() });
      });
    });
  };

  it('should advertise MOVE in CAPABILITY', async () => {
    const { client, greeting } = await connectClient();
    expect(greeting).toContain('* OK');

    const res = await sendCommand(client, 'A01 CAPABILITY');
    expect(res).toContain('* CAPABILITY');
    expect(res).toContain('MOVE');
    expect(res).toContain('A01 OK CAPABILITY completed');

    client.end();
  });

  it('should execute UID MOVE and emit untagged EXPUNGE and tagged COPYUID', async () => {
    const { client } = await connectClient();

    // Mock authentication
    (authenticateMailbox as jest.Mock).mockResolvedValue({
      id: 'mb-123',
      email: 'test@example.com',
      active: true,
      imap_enabled: true,
    });

    const loginRes = await sendCommand(client, 'A02 LOGIN test@example.com pass123');
    expect(loginRes).toContain('A02 OK LOGIN completed');

    // Mock SELECT INBOX
    (getFolder as jest.Mock).mockImplementation((mbId, name) => {
      if (name.toUpperCase() === 'INBOX') {
        return Promise.resolve({ id: 'folder-inbox', mailbox_id: mbId, name: 'INBOX', uid_validity: 1001, uid_next: 10 });
      }
      if (name.toUpperCase() === 'TRASH') {
        return Promise.resolve({ id: 'folder-trash', mailbox_id: mbId, name: 'Trash', uid_validity: 2002, uid_next: 50 });
      }
      return Promise.resolve(null);
    });

    (getFolderStats as jest.Mock).mockResolvedValue({
      exists: 2,
      unseen: 1,
      uidNext: 10,
      uidValidity: 1001,
    });

    const selectRes = await sendCommand(client, 'A03 SELECT INBOX');
    expect(selectRes).toContain('A03 OK [READ-WRITE] SELECT completed');

    // Mock messages in INBOX: message 1 (uid 5), message 2 (uid 8)
    (listMessagesBySequence as jest.Mock).mockResolvedValue([
      { id: 'msg-1', uid: 5, flags: [], size: 120, raw_source: 'Subject: Hello\r\n\r\nHi' },
      { id: 'msg-2', uid: 8, flags: [], size: 150, raw_source: 'Subject: World\r\n\r\nTest' },
    ]);

    (moveMessages as jest.Mock).mockResolvedValue([
      { sourceUid: 8, destUid: 50 },
    ]);

    // Move message with UID 8 to Trash
    const moveRes = await sendCommand(client, 'A04 UID MOVE 8 Trash');
    expect(moveMessages).toHaveBeenCalledWith('mb-123', 'folder-inbox', 'folder-trash', [8]);
    expect(moveRes).toContain('* 2 EXPUNGE');
    expect(moveRes).toContain('A04 OK [COPYUID 2002 8 50] MOVE completed');

    client.end();
  });

  it('should support sequence-based MOVE with fallback to UID', async () => {
    const { client } = await connectClient();

    (authenticateMailbox as jest.Mock).mockResolvedValue({
      id: 'mb-123',
      email: 'test@example.com',
      active: true,
      imap_enabled: true,
    });
    await sendCommand(client, 'A01 LOGIN test@example.com pass123');
    await sendCommand(client, 'A02 SELECT INBOX');

    (listMessagesBySequence as jest.Mock).mockResolvedValue([
      { id: 'msg-1', uid: 105, flags: [], size: 120, raw_source: 'Subject: Hello\r\n\r\nHi' },
    ]);

    (moveMessages as jest.Mock).mockResolvedValue([
      { sourceUid: 105, destUid: 70 },
    ]);

    // Client sends MOVE with 105 (treating UID as sequence)
    const moveRes = await sendCommand(client, 'A03 MOVE 105 Trash');
    expect(moveMessages).toHaveBeenCalledWith('mb-123', 'folder-inbox', 'folder-trash', [105]);
    expect(moveRes).toContain('* 1 EXPUNGE');
    expect(moveRes).toContain('A03 OK [COPYUID 2002 105 70] MOVE completed');

    client.end();
  });

  it('should execute EXPUNGE and delete messages flagged \\Deleted', async () => {
    const { client } = await connectClient();

    (authenticateMailbox as jest.Mock).mockResolvedValue({
      id: 'mb-123',
      email: 'test@example.com',
      active: true,
      imap_enabled: true,
    });
    await sendCommand(client, 'A01 LOGIN test@example.com pass123');
    await sendCommand(client, 'A02 SELECT INBOX');

    (listMessagesBySequence as jest.Mock).mockResolvedValue([
      { id: 'msg-1', uid: 5, flags: ['\\Seen'], size: 120, raw_source: '...' },
      { id: 'msg-2', uid: 8, flags: ['\\Deleted'], size: 150, raw_source: '...' },
    ]);

    (expungeMessages as jest.Mock).mockResolvedValue([8]);

    const expungeRes = await sendCommand(client, 'A03 EXPUNGE');
    expect(expungeMessages).toHaveBeenCalledWith('folder-inbox', undefined);
    expect(expungeRes).toContain('* 2 EXPUNGE');
    expect(expungeRes).toContain('A03 OK EXPUNGE completed');

    client.end();
  });
});

import net from 'net';
import { once } from 'events';

jest.mock('../mailbox-store', () => ({
  appendMessage: jest.fn(),
  authenticateMailbox: jest.fn(),
  getFolder: jest.fn(),
  getFolderStats: jest.fn(),
  listFolders: jest.fn(),
  listMessagesBySequence: jest.fn(),
  searchMessages: jest.fn(),
  setMessageFlags: jest.fn(),
}));

jest.mock('../../config', () => ({
  config: {
    dns: {
      heloHostname: 'mail.test',
      tlsCert: '',
      tlsKey: '',
    },
  },
}));

import { createImapServer } from '../server';
import {
  authenticateMailbox,
  getFolder,
  getFolderStats,
  listFolders,
} from '../mailbox-store';

const mockedAuthenticateMailbox = authenticateMailbox as jest.MockedFunction<typeof authenticateMailbox>;
const mockedGetFolder = getFolder as jest.MockedFunction<typeof getFolder>;
const mockedGetFolderStats = getFolderStats as jest.MockedFunction<typeof getFolderStats>;
const mockedListFolders = listFolders as jest.MockedFunction<typeof listFolders>;

type ImapClient = {
  socket: net.Socket;
  waitFor(marker: string): Promise<string>;
};

async function connect(port: number): Promise<ImapClient> {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  let received = '';
  const waiters: Array<{ marker: string; resolve: (value: string) => void }> = [];
  socket.on('data', (chunk) => {
    received += chunk.toString('utf8');
    for (const waiter of waiters.splice(0)) {
      if (received.includes(waiter.marker)) waiter.resolve(received);
      else waiters.push(waiter);
    }
  });
  await once(socket, 'connect');
  return {
    socket,
    waitFor(marker: string) {
      if (received.includes(marker)) return Promise.resolve(received);
      return new Promise((resolve) => waiters.push({ marker, resolve }));
    },
  };
}

describe('IMAP Gmail compatibility', () => {
  const user = {
    id: 'mailbox-1', organization_id: 'org-1', customer_domain_id: 'domain-1',
    email: 'user@example.com', display_name: null, quota_mb: 1024,
    active: true, imap_enabled: true, smtp_enabled: true, smtp_tier: 'personal',
  };
  const inbox = { id: 'folder-1', mailbox_id: user.id, name: 'INBOX', special_use: '\\Inbox', uid_validity: 1, uid_next: 4 };
  let server: net.Server;

  beforeEach(() => {
    jest.resetAllMocks();
    mockedAuthenticateMailbox.mockResolvedValue(user);
    mockedGetFolder.mockResolvedValue(inbox);
    mockedGetFolderStats.mockResolvedValue({ exists: 3, unseen: 2, uidNext: 4, uidValidity: 1 });
    mockedListFolders.mockResolvedValue([inbox]);
    server = createImapServer(false) as net.Server;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('supports Gmail authentication and sync commands', async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as net.AddressInfo).port;
    const client = await connect(port);
    await client.waitFor('IMAP4rev1 ready');

    client.socket.write('a1 CAPABILITY\r\n');
    const capabilities = await client.waitFor('a1 OK CAPABILITY completed');
    expect(capabilities).toContain('AUTH=PLAIN');
    expect(capabilities).toContain('SASL-IR');
    expect(capabilities).toContain('IDLE');
    expect(capabilities).toContain('NAMESPACE');

    client.socket.write('a2 AUTHENTICATE PLAIN\r\n');
    await client.waitFor('+ ');
    client.socket.write(`${Buffer.from('\0user@example.com\0password').toString('base64')}\r\n`);
    await client.waitFor('a2 OK AUTHENTICATE completed');
    expect(mockedAuthenticateMailbox).toHaveBeenCalledWith('user@example.com', 'password', expect.any(String));

    client.socket.write('a3 ID ("name" "Gmail")\r\n');
    const id = await client.waitFor('a3 OK ID completed');
    expect(id).toContain('* ID ("name" "Mailcouse" "version" "1.0")');

    client.socket.write('a4 NAMESPACE\r\n');
    const namespace = await client.waitFor('a4 OK NAMESPACE completed');
    expect(namespace).toContain('* NAMESPACE (("" "/")) NIL NIL');

    client.socket.write('a5 STATUS "INBOX" (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)\r\n');
    const status = await client.waitFor('a5 OK STATUS completed');
    expect(status).toContain('* STATUS "INBOX" (MESSAGES 3 UNSEEN 2 UIDNEXT 4 UIDVALIDITY 1)');

    client.socket.write('a6 SELECT "INBOX"\r\n');
    await client.waitFor('a6 OK [READ-WRITE] SELECT completed');
    client.socket.write('a7 IDLE\r\n');
    await client.waitFor('+ idling');
    client.socket.write('DONE\r\n');
    await client.waitFor('a7 OK IDLE terminated');
    client.socket.end();
  });

  it('accepts a PLAIN initial response', async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as net.AddressInfo).port;
    const client = await connect(port);
    await client.waitFor('IMAP4rev1 ready');

    const credentials = Buffer.from('\0user@example.com\0password').toString('base64');
    client.socket.write(`b1 AUTHENTICATE PLAIN ${credentials}\r\n`);
    await client.waitFor('b1 OK AUTHENTICATE completed');
    expect(mockedAuthenticateMailbox).toHaveBeenCalledWith('user@example.com', 'password', expect.any(String));
    client.socket.end();
  });
});

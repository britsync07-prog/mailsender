import {
  appendMessage,
  getMessageAttachments,
  getSentMessageAttachments,
  getAttachmentById,
  getMailboxMessage,
  getFolder,
  copyMessages,
} from '../mailbox-store';
import { query, transaction } from '../../db/connection';

jest.mock('../../db/connection');

describe('Mailbox and Sent Attachments Management', () => {
  const mockQuery = query as jest.MockedFunction<typeof query>;
  const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('appendMessage with attachments', () => {
    it('should parse MIME attachment, set has_attachment=true, and insert into message_attachments', async () => {
      // Mock getFolder and ensureDefaultFolders
      mockQuery.mockImplementation(async (sql: any) => {
        if (typeof sql === 'string' && sql.includes('FROM mailbox_folders')) {
          return {
            rows: [{
              id: 'folder-1',
              mailbox_id: 'box-1',
              name: 'INBOX',
              special_use: null,
              uid_validity: 1,
              uid_next: 10,
            }],
            rowCount: 1,
          } as any;
        }
        return { rows: [], rowCount: 0 } as any;
      });

      const mockClient = {
        query: jest.fn(),
      };
      mockTransaction.mockImplementation(async (cb: any) => cb(mockClient));

      // Mock update uid_next
      mockClient.query.mockResolvedValueOnce({
        rows: [{ uid_next: 10 }],
        rowCount: 1,
      });

      // Mock insert message
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'msg-with-att-1',
          mailbox_id: 'box-1',
          folder_id: 'folder-1',
          uid: 10,
          subject: 'Invoice Attached',
          has_attachment: true,
          attachment_count: 1,
        }],
        rowCount: 1,
      });

      // Mock insert attachment
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'att-1' }],
        rowCount: 1,
      });

      const rawMime = [
        'From: sender@example.com',
        'To: receiver@example.com',
        'Subject: Invoice Attached',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="sep123"',
        '',
        '--sep123',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Please find your invoice attached.',
        '--sep123',
        'Content-Type: application/pdf; name="invoice_1001.pdf"',
        'Content-Disposition: attachment; filename="invoice_1001.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('%PDF-1.4 simulated pdf contents').toString('base64'),
        '--sep123--',
      ].join('\r\n');

      const result = await appendMessage({
        mailboxId: 'box-1',
        folderName: 'INBOX',
        rawSource: rawMime,
      });

      expect(result.id).toBe('msg-with-att-1');
      expect(mockClient.query).toHaveBeenCalledTimes(3);

      // Verify message insert received has_attachment = true and attachment_count = 1
      const insertMsgCall = mockClient.query.mock.calls[1];
      expect(insertMsgCall[0]).toContain('INSERT INTO mailbox_messages');
      expect(insertMsgCall[1]).toContain(true); // hasAttachment
      expect(insertMsgCall[1]).toContain(1); // attachmentCount

      // Verify attachment insert received filename and content_type
      const insertAttCall = mockClient.query.mock.calls[2];
      expect(insertAttCall[0]).toContain('INSERT INTO message_attachments');
      expect(insertAttCall[1][0]).toBe('msg-with-att-1');
      expect(insertAttCall[1][1]).toBe('invoice_1001.pdf');
      expect(insertAttCall[1][2]).toBe('application/pdf');
    });
  });

  describe('getMessageAttachments and getSentMessageAttachments', () => {
    it('should query message_attachments for mailbox message without data buffer', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'att-10',
          mailbox_message_id: 'msg-1',
          filename: 'document.pdf',
          content_type: 'application/pdf',
          size: 1024,
          disposition: 'attachment',
          content_id: null,
          created_at: new Date(),
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const list = await getMessageAttachments('msg-1');
      expect(list).toHaveLength(1);
      expect(list[0].filename).toBe('document.pdf');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE mailbox_message_id = $1'),
        ['msg-1']
      );
    });

    it('should query message_attachments for sent message', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'att-20',
          sent_message_id: 'sent-1',
          filename: 'report.xlsx',
          content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 2048,
          disposition: 'attachment',
          content_id: null,
          created_at: new Date(),
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const list = await getSentMessageAttachments('sent-1');
      expect(list).toHaveLength(1);
      expect(list[0].filename).toBe('report.xlsx');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE sent_message_id = $1'),
        ['sent-1']
      );
    });
  });

  describe('getAttachmentById', () => {
    it('should return attachment with binary data', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 test');
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'att-100',
          mailbox_message_id: 'msg-1',
          filename: 'test.pdf',
          content_type: 'application/pdf',
          size: pdfBuffer.length,
          disposition: 'attachment',
          content_id: null,
          data: pdfBuffer,
          created_at: new Date(),
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const att = await getAttachmentById('att-100');
      expect(att).not.toBeNull();
      expect(att?.id).toBe('att-100');
      expect(att?.filename).toBe('test.pdf');
      expect(att?.data).toEqual(pdfBuffer);
    });

    it('should return null if not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const att = await getAttachmentById('non-existent');
      expect(att).toBeNull();
    });
  });

  describe('getMailboxMessage', () => {
    it('should retrieve mailbox message along with its attachments', async () => {
      // 1. SELECT mm.*
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'msg-1',
          mailbox_id: 'box-1',
          subject: 'Hello with attachment',
          raw_source: '...',
          has_attachment: true,
          attachment_count: 1,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      // 2. getMessageAttachments
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'att-1',
          mailbox_message_id: 'msg-1',
          filename: 'spec.pdf',
          content_type: 'application/pdf',
          size: 512,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const message = await getMailboxMessage('box-1', 'msg-1');
      expect(message).not.toBeNull();
      expect(message?.id).toBe('msg-1');
      expect(message?.attachments).toHaveLength(1);
      expect(message?.attachments?.[0].filename).toBe('spec.pdf');
    });

    it('should perform on-the-fly backfill if raw_source has attachment but not yet in message_attachments', async () => {
      const rawMime = [
        'From: sender@example.com',
        'To: receiver@example.com',
        'Subject: Fallback Parse',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="bound"',
        '',
        '--bound',
        'Content-Type: text/plain',
        '',
        'Test body',
        '--bound',
        'Content-Type: text/plain; name="hello.txt"',
        'Content-Disposition: attachment; filename="hello.txt"',
        '',
        'Hello World Attachment Content',
        '--bound--',
      ].join('\r\n');

      // 1. SELECT mm.*
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'msg-legacy',
          mailbox_id: 'box-1',
          subject: 'Fallback Parse',
          raw_source: rawMime,
          has_attachment: false,
          attachment_count: 0,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      // 2. getMessageAttachments -> empty
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      // 3. INSERT INTO message_attachments
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'att-backfilled-1',
          mailbox_message_id: 'msg-legacy',
          filename: 'hello.txt',
          content_type: 'text/plain',
          size: 30,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      // 4. UPDATE mailbox_messages SET has_attachment = true
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const message = await getMailboxMessage('box-1', 'msg-legacy');
      expect(message).not.toBeNull();
      expect(message?.attachments).toHaveLength(1);
      expect(message?.attachments?.[0].filename).toBe('hello.txt');
      expect(message?.has_attachment).toBe(true);
      expect(message?.attachment_count).toBe(1);
    });
  });

  describe('copyMessages with attachments', () => {
    it('should copy has_attachment, attachment_count and duplicate rows in message_attachments', async () => {
      const mockClient = {
        query: jest.fn(),
      };
      mockTransaction.mockImplementation(async (cb: any) => cb(mockClient));

      // 1. SELECT * FROM mailbox_messages (source)
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'src-msg-1',
          mailbox_id: 'box-1',
          folder_id: 'folder-src',
          uid: 10,
          raw_source: '...',
          subject: 'Copied Attachment',
          has_attachment: true,
          attachment_count: 2,
          internal_date: new Date(),
          size: 100,
          flags: ['\\Seen'],
        }],
        rowCount: 1,
      });

      // 2. UPDATE mailbox_folders uid_next
      mockClient.query.mockResolvedValueOnce({
        rows: [{ base_uid: 50 }],
        rowCount: 1,
      });

      // 3. INSERT INTO mailbox_messages RETURNING id
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'dest-msg-1' }],
        rowCount: 1,
      });

      // 4. INSERT INTO message_attachments SELECT ...
      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 2,
      });

      const mapping = await copyMessages('box-1', 'folder-src', 'folder-dest', [10]);
      expect(mapping).toEqual([{ sourceUid: 10, destUid: 50 }]);

      // Verify destination message insert received has_attachment = true and attachment_count = 2
      const insertDestCall = mockClient.query.mock.calls[2];
      expect(insertDestCall[0]).toContain('INSERT INTO mailbox_messages');
      expect(insertDestCall[1]).toContain(true); // has_attachment
      expect(insertDestCall[1]).toContain(2); // attachment_count

      // Verify message_attachments clone query
      const cloneAttCall = mockClient.query.mock.calls[3];
      expect(cloneAttCall[0]).toContain('INSERT INTO message_attachments');
      expect(cloneAttCall[0]).toContain('SELECT $1, filename, content_type, size, disposition, content_id, data');
      expect(cloneAttCall[1]).toEqual(['dest-msg-1', 'src-msg-1']);
    });
  });
});

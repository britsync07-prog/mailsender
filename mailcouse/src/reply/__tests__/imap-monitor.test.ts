// Unit tests for IMAP monitor

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { getActiveIMAPConnections, getIMAPStatus } from '../imap-monitor';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('IMAP Monitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getActiveIMAPConnections', () => {
    it('should get active IMAP connections', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'sub-1', subdomain: 'test.example.com' },
          { id: 'sub-2', subdomain: 'mail.example.com' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const connections = await getActiveIMAPConnections();

      expect(connections).toHaveLength(2);
      expect(connections[0].subdomain_id).toBe('sub-1');
      expect(connections[0].imap_port).toBe(993);
    });
  });

  describe('getIMAPStatus', () => {
    it('should return IMAP status', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '50' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const status = await getIMAPStatus();

      expect(status.total_connections).toBe(50);
      expect(status.active).toBe(50);
    });
  });
});

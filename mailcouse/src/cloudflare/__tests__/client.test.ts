import { CloudflareClient } from '../client';

global.fetch = jest.fn();

describe('CloudflareClient', () => {
  let client: CloudflareClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new CloudflareClient({
      apiToken: 'test-token',
      accountId: 'test-account',
    });
  });

  describe('createZone', () => {
    it('should create a zone successfully', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          errors: [],
          messages: [],
          result: { id: 'zone-1', name: 'example.com', status: 'active', name_servers: ['ns1.example.com'] },
        }),
      });

      const zone = await client.createZone('example.com');
      expect(zone.id).toBe('zone-1');
      expect(zone.name).toBe('example.com');

      const callArgs = (fetch as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain('/zones');
      expect(callArgs[1].method).toBe('POST');
      const body = JSON.parse(callArgs[1].body);
      expect(body.name).toBe('example.com');
      expect(body.account.id).toBe('test-account');
    });

    it('should throw on API error', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          errors: [{ code: 1000, message: 'Zone already exists' }],
          messages: [],
          result: null,
        }),
      });

      await expect(client.createZone('example.com')).rejects.toThrow('Zone already exists');
    });
  });

  describe('listZones', () => {
    it('should list all zones', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          errors: [],
          messages: [],
          result: [{ id: 'zone-1', name: 'example.com' }],
          result_info: { page: 1, per_page: 20, total_pages: 1, count: 1, total_count: 1 },
        }),
      });

      const zones = await client.listZones();
      expect(zones).toHaveLength(1);
      expect(zones[0].id).toBe('zone-1');
    });
  });

  describe('getZone', () => {
    it('should get zone by ID', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          errors: [],
          messages: [],
          result: { id: 'zone-1', name: 'example.com' },
        }),
      });

      const zone = await client.getZone('zone-1');
      expect(zone.id).toBe('zone-1');
    });

    it('should throw on not found', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          errors: [{ code: 1000, message: 'Zone not found' }],
          messages: [],
          result: null,
        }),
      });

      await expect(client.getZone('bad-id')).rejects.toThrow('Zone not found');
    });
  });

  describe('getZoneByName', () => {
    it('should return zone when found', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          errors: [],
          messages: [],
          result: [{ id: 'zone-1', name: 'example.com' }],
          result_info: { page: 1, per_page: 20, total_pages: 1, count: 1, total_count: 1 },
        }),
      });

      const zone = await client.getZoneByName('example.com');
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe('zone-1');
    });

    it('should return null when not found', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          errors: [],
          messages: [],
          result: [],
          result_info: { page: 1, per_page: 20, total_pages: 0, count: 0, total_count: 0 },
        }),
      });

      const zone = await client.getZoneByName('nonexistent.com');
      expect(zone).toBeNull();
    });
  });

  describe('deleteZone', () => {
    it('should delete zone', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          errors: [],
          messages: [],
          result: null,
        }),
      });

      await expect(client.deleteZone('zone-1')).resolves.toBeUndefined();
    });
  });

  describe('DNS Records', () => {
    const mockRecord = {
      id: 'rec-1', zone_id: 'zone-1', zone_name: 'example.com',
      name: 'test.example.com', type: 'TXT', content: 'v=spf1',
      proxied: false, ttl: 300, created_on: '', modified_on: '',
    };

    it('should list DNS records', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true, errors: [], messages: [],
          result: [mockRecord],
          result_info: { page: 1, per_page: 20, total_pages: 1, count: 1, total_count: 1 },
        }),
      });

      const records = await client.listDNSRecords('zone-1');
      expect(records).toHaveLength(1);
    });

    it('should create DNS record', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true, errors: [], messages: [], result: mockRecord,
        }),
      });

      const record = await client.createDNSRecord('zone-1', {
        type: 'TXT', name: 'test.example.com', content: 'v=spf1',
      });
      expect(record.id).toBe('rec-1');
    });

    it('should update DNS record', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true, errors: [], messages: [], result: mockRecord,
        }),
      });

      const record = await client.updateDNSRecord('zone-1', 'rec-1', { content: 'v=spf1 include:_spf.example.com' });
      expect(record.id).toBe('rec-1');
    });

    it('should delete DNS record', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true, errors: [], messages: [], result: null,
        }),
      });

      await expect(client.deleteDNSRecord('zone-1', 'rec-1')).resolves.toBeUndefined();
    });

    it('should upsert - create when no existing', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true, errors: [], messages: [],
            result: [],
            result_info: { page: 1, per_page: 20, total_pages: 1, count: 0, total_count: 0 },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true, errors: [], messages: [], result: mockRecord,
          }),
        });

      const record = await client.upsertDNSRecord('zone-1', {
        type: 'TXT', name: 'test.example.com', content: 'v=spf1',
      });
      expect(record.id).toBe('rec-1');
    });

    it('should upsert - update when existing', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true, errors: [], messages: [],
            result: [mockRecord],
            result_info: { page: 1, per_page: 20, total_pages: 1, count: 1, total_count: 1 },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true, errors: [], messages: [], result: mockRecord,
          }),
        });

      const record = await client.upsertDNSRecord('zone-1', {
        type: 'TXT', name: 'test.example.com', content: 'v=spf1 ~all',
      });
      expect(record.id).toBe('rec-1');
    });
  });

  describe('HTTP error handling', () => {
    it('should handle non-ok response', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(client.listZones()).rejects.toThrow('401');
    });

    it('should handle network error', async () => {
      (fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(client.listZones()).rejects.toThrow('Network error');
    });
  });
});

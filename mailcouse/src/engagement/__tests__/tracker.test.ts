// Unit tests for engagement tracker

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { recordEvent, trackOpen, trackReply, trackClick, getLeadEvents, generateTrackingPixelUrl, generateClickTrackingUrl } from '../tracker';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Engagement Tracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordEvent', () => {
    it('should record an open event', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'event-1',
            lead_id: 'lead-1',
            event_type: 'open',
            created_at: new Date(),
          }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await recordEvent('open', 'lead-1', 'subdomain-1');

      expect(result.event_type).toBe('open');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should record a reply event', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'event-1',
            lead_id: 'lead-1',
            event_type: 'reply',
            created_at: new Date(),
          }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await recordEvent('reply', 'lead-1', undefined, {
        reply_content: 'Thanks for your email!',
      });

      expect(result.event_type).toBe('reply');
    });

    it('should record a click event', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'event-1',
            lead_id: 'lead-1',
            event_type: 'click',
            created_at: new Date(),
          }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await recordEvent('click', 'lead-1', undefined, {
        url: 'https://example.com',
      });

      expect(result.event_type).toBe('click');
    });
  });

  describe('trackOpen', () => {
    it('should track email open', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'event-1', lead_id: 'lead-1', event_type: 'open', created_at: new Date() }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await trackOpen({ lead_id: 'lead-1', subdomain_id: 'sub-1', timestamp: new Date() });

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('trackReply', () => {
    it('should track reply', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'event-1', lead_id: 'lead-1', event_type: 'reply', created_at: new Date() }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await trackReply({
        lead_id: 'lead-1',
        reply_content: 'Interested!',
        timestamp: new Date(),
      });

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('trackClick', () => {
    it('should track click', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'event-1', lead_id: 'lead-1', event_type: 'click', created_at: new Date() }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await trackClick({
        lead_id: 'lead-1',
        url: 'https://example.com',
        timestamp: new Date(),
      });

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('getLeadEvents', () => {
    it('should get events for a lead', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'event-1', lead_id: 'lead-1', event_type: 'open', created_at: new Date() },
          { id: 'event-2', lead_id: 'lead-1', event_type: 'click', created_at: new Date() },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const events = await getLeadEvents('lead-1');

      expect(events).toHaveLength(2);
    });
  });

  describe('generateTrackingPixelUrl', () => {
    it('should generate pixel URL with lead ID', () => {
      const url = generateTrackingPixelUrl('lead-123');
      expect(url).toContain('lid=lead-123');
      expect(url).toContain('/pixel.gif');
    });

    it('should include subdomain ID if provided', () => {
      const url = generateTrackingPixelUrl('lead-123', 'sub-456');
      expect(url).toContain('sid=sub-456');
    });
  });

  describe('generateClickTrackingUrl', () => {
    it('should generate click tracking URL', () => {
      const url = generateClickTrackingUrl('https://example.com', 'lead-123');
      expect(url).toContain('url=');
      expect(url).toContain('lid=lead-123');
      expect(url).toContain('/click');
    });
  });
});

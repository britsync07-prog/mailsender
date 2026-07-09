// Unit tests for FBL registrar

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { registerFBL, getFBLRegistrations, hasFBLRegistration, getAllActiveFBL } from '../fbl-registrar';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('FBL Registrar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerFBL', () => {
    it('should register FBL', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'reg-1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await registerFBL('example.com', 'gmail', 'https://callback.example.com');

      expect(result.success).toBe(true);
      expect(result.registration_id).toBe('reg-1');
    });

    it('should handle registration failure', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      const result = await registerFBL('example.com', 'gmail', 'https://callback.example.com');
      expect(result.success).toBe(false);
    });
  });

  describe('getFBLRegistrations', () => {
    it('should get registrations for domain', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ provider: 'gmail', status: 'active', registered_at: new Date() }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const regs = await getFBLRegistrations('example.com');
      expect(regs).toHaveLength(1);
    });
  });

  describe('hasFBLRegistration', () => {
    it('should return true if registration exists', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'reg-1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await hasFBLRegistration('example.com', 'gmail');
      expect(result).toBe(true);
    });

    it('should return false if no registration', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await hasFBLRegistration('example.com', 'gmail');
      expect(result).toBe(false);
    });
  });

  describe('getAllActiveFBL', () => {
    it('should get all active registrations', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { domain: 'example.com', provider: 'gmail', callback_url: 'https://callback.example.com' },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const regs = await getAllActiveFBL();
      expect(regs).toHaveLength(1);
    });
  });
});

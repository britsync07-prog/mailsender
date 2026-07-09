// API routes for Plan 1 — Lead Ingestion

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { importLeads, importFromCSV, getImportStats } from '../ingestion/importer';
import { LeadImportRequest, LeadSource, Industry } from '../ingestion/types';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

/**
 * POST /api/leads/import
 * Import leads from JSON body
 */
router.post('/import', async (req: Request, res: Response) => {
  try {
    const { leads, source, industry } = req.body as LeadImportRequest;

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({
        error: 'leads array is required and must not be empty',
      });
    }

    if (!source) {
      return res.status(400).json({
        error: 'source field is required',
      });
    }

    const result = await importLeads({ leads, source, industry });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Import error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/leads/import/csv
 * Import leads from CSV file upload
 */
router.post('/import/csv', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'CSV file is required',
      });
    }

    const source = (req.body.source as LeadSource) || 'csv_import';
    const industry = req.body.industry as Industry | undefined;

    const csvData = req.file.buffer.toString('utf-8');
    const result = await importFromCSV(csvData, source, industry);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('CSV import error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/leads/stats
 * Get import statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getImportStats();
    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/leads
 * List leads with pagination and filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;
    const industry = req.query.industry as string;
    const status = req.query.status as string;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (industry) {
      whereClause += ` AND industry = $${paramIndex++}`;
      params.push(industry);
    }
    if (status) {
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    const { query } = await import('../db/connection');

    const countResult = await query(
      `SELECT COUNT(*) as count FROM leads ${whereClause}`,
      params
    );

    const leadsResult = await query(
      `SELECT * FROM leads ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      data: {
        leads: leadsResult.rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.rows[0]?.count || '0'),
          pages: Math.ceil(parseInt(countResult.rows[0]?.count || '0') / limit),
        },
      },
    });
  } catch (error) {
    console.error('List error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

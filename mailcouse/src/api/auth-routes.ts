import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/connection';
import { config } from '../config';
import { authenticate } from './auth-middleware';

const router = Router();

router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name required' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const userResult = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id`,
      [email.toLowerCase(), hash, name]
    );
    const userId = userResult.rows[0].id;

    const orgResult = await query<{ id: string }>(
      `INSERT INTO organizations (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [name + '\'s Organization', userId]
    );
    const orgId = orgResult.rows[0].id;

    await query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [orgId, userId]
    );

    const token = jwt.sign(
      { userId, email: email.toLowerCase(), orgId, orgRole: 'owner' },
      config.platform.jwtSecret,
      { expiresIn: `${config.platform.sessionExpiryHours}h` }
    );

    const expiresAt = new Date(Date.now() + config.platform.sessionExpiryHours * 3600000);
    await query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [userId, token, expiresAt]
    );

    res.status(201).json({ token, user: { id: userId, email, name }, organization: { id: orgId } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const userResult = await query<{ id: string; email: string; password_hash: string; name: string }>(
      'SELECT id, email, password_hash, name FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const orgResult = await query<{ organization_id: string; role: string }>(
      `SELECT om.organization_id, om.role FROM organization_members om WHERE om.user_id = $1 LIMIT 1`,
      [user.id]
    );

    let orgId: string | undefined;
    let orgRole: string = 'member';
    if (orgResult.rows.length > 0) {
      orgId = orgResult.rows[0].organization_id;
      orgRole = orgResult.rows[0].role;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, orgId, orgRole },
      config.platform.jwtSecret,
      { expiresIn: `${config.platform.sessionExpiryHours}h` }
    );

    const expiresAt = new Date(Date.now() + config.platform.sessionExpiryHours * 3600000);
    await query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    res.json({ token, user: { id: user.id, email: user.email, name: user.name }, organization: orgId ? { id: orgId } : null });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization!;
    const token = header.substring(7);
    await query('DELETE FROM sessions WHERE token = $1', [token]);
    res.json({ message: 'Logged out' });
  } catch {
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const userResult = await query<{ id: string; email: string; name: string; admin: boolean }>(
      'SELECT id, email, name, admin FROM users WHERE id = $1',
      [req.user!.userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: userResult.rows[0] });
  } catch {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;

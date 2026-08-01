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

    await query(
      `INSERT INTO servers (organization_id, name, mode) VALUES ($1, $2, 'live')`,
      [orgId, name + '\'s Server']
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

router.post('/password-reset', async (req: Request, res: Response) => {
  try {
    const { email_address } = req.body;
    if (!email_address) return res.status(400).json({ error: 'E-mail address required' });
    const userResult = await query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [String(email_address).toLowerCase()]
    );
    if (userResult.rows.length > 0) {
      const token = require('crypto').randomBytes(24).toString('hex');
      const hash = require('crypto').createHash('sha256').update(token).digest('hex');
      await query(
        'UPDATE users SET reset_token_hash = $1, reset_token_expires_at = $2 WHERE id = $3',
        [hash, new Date(Date.now() + 3600000), userResult.rows[0].id]
      );
      return res.json({ message: 'We have sent you an e-mail with instructions to reset your password.', reset_token: token });
    }
    res.json({ message: 'We have sent you an e-mail with instructions to reset your password.' });
  } catch {
    res.status(500).json({ error: 'Failed to start password reset' });
  }
});

router.post('/password-reset/:token', async (req: Request, res: Response) => {
  try {
    const { password, password_confirmation } = req.body;
    if (!password || !password_confirmation) {
      return res.status(400).json({ error: 'Please choose a new password and enter it again to confirm' });
    }
    if (password !== password_confirmation) {
      return res.status(400).json({ error: 'Password confirmation doesn\'t match' });
    }
    const hash = require('crypto').createHash('sha256').update(req.params.token).digest('hex');
    const userResult = await query<{ id: string }>(
      'SELECT id FROM users WHERE reset_token_hash = $1 AND reset_token_expires_at > NOW()',
      [hash]
    );
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'This password reset link is invalid or has expired. Please request a new one.' });
    }
    const newHash = await bcrypt.hash(password, 12);
    await query(
      'UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = $2',
      [newHash, userResult.rows[0].id]
    );
    res.json({ message: 'Your password has been changed. You can now login with your new password.' });
  } catch {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

export default router;

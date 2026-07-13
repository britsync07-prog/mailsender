import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db/connection';

export interface AuthUser {
  userId: string;
  email: string;
  orgId?: string;
  orgRole?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.substring(7);
  try {
    const payload = jwt.verify(token, config.platform.jwtSecret) as any;
    req.user = {
      userId: payload.userId,
      email: payload.email,
      orgId: payload.orgId,
      orgRole: payload.orgRole,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireOrg(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.orgId) {
    return res.status(403).json({ error: 'Organization required' });
  }
  next();
}

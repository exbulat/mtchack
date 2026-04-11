import { Request, Response, NextFunction } from 'express';

export function getMwsHeaders(): Record<string, string> {
  const token = process.env.MWS_TABLES_TOKEN || '';
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export function mwsAuth(req: Request, res: Response, next: NextFunction) {
  const token = process.env.MWS_TABLES_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MWS_TABLES_TOKEN not configured' });
  }
  next();
}

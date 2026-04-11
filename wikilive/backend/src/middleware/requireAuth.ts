import { Request, Response, NextFunction } from 'express';
import { AUTH_COOKIE, parseCookieValue, verifyAuthToken } from '../auth-tokens';

export function loadAuthUser(req: Request, _res: Response, next: NextFunction): void {
  const raw = parseCookieValue(req.headers.cookie, AUTH_COOKIE);
  req.authUser = raw ? verifyAuthToken(raw) ?? undefined : undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Требуется вход' });
    return;
  }
  next();
}

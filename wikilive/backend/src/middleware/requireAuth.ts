import { Request, Response, NextFunction } from 'express';
import { AUTH_COOKIE, parseCookieValue, verifyAuthToken } from '../auth-tokens';

export function loadAuthUser(req: Request, res: Response, next: NextFunction): void {
  const raw = parseCookieValue(req.headers.cookie, AUTH_COOKIE);
  if (raw) {
    const user = verifyAuthToken(raw);
    if (user) {
      req.authUser = user;
    } else {
      // Токен есть, но невалидный (истёк или БД сброшена) — сразу чистим куку
      res.clearCookie(AUTH_COOKIE, { path: '/' });
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Требуется вход' });
    return;
  }
  next();
}

import { Request, Response, NextFunction } from 'express';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'http://localhost:3000').split(',');

// CSRF-защита: проверяем Origin/Referer на write-запросах
export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  // проверяем только write-методы
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (origin) {
    if (ALLOWED_ORIGINS.includes(origin)) return next();
    res.status(403).json({ error: 'CSRF: invalid Origin' });
    return;
  }

  if (referer) {
    try {
      const url = new URL(referer);
      const refererOrigin = `${url.protocol}//${url.host}`;
      if (ALLOWED_ORIGINS.includes(refererOrigin)) return next();
    } catch {
    }
    res.status(403).json({ error: 'CSRF: invalid Referer' });
    return;
  }

  res.status(403).json({ error: 'CSRF: missing Origin/Referer' });
  return;
}

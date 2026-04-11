import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    const base = (req.originalUrl || '').split('?')[0] || '';
    return base === '/api/health' || base.startsWith('/api/auth');
  },
});

export const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: 'Too many AI requests. Maximum 20 requests per minute.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});

export const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 50,
  message: 'Too many search requests. Maximum 50 per minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

export const tablesLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many table requests. Maximum 30 per minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many write operations. Maximum 50 per 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    return !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  },
});

import rateLimit from 'express-rate-limit';
import { Request } from 'express';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    const base = (req.originalUrl || '').split('?')[0] || '';
    return base === '/api/health';
  },
});

// Защита от brute-force: 20 неудачных попыток на IP в 15 минут
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});

export const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: 'Too many AI requests. Maximum 60 requests per minute.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});

export const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: 'Too many search requests. Maximum 200 per minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

export const tablesLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many table requests. Maximum 100 per minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many write operations. Maximum 300 per 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    return !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  },
});

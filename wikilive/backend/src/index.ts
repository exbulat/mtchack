import './env';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Server as HocuspocusServer } from '@hocuspocus/server';
import { PrismaClient } from '@prisma/client';
import pagesRouter from './routes/pages';
import tablesRouter from './routes/tables';
import aiRouter from './routes/ai';
import authRouter from './routes/auth';
import { loadAuthUser } from './middleware/requireAuth';
import { AUTH_COOKIE, parseCookieValue, verifyAuthToken } from './auth-tokens';
import {
  globalLimiter,
  aiLimiter,
  searchLimiter,
  tablesLimiter,
  writeLimiter,
} from './middleware/rateLimiter';

export const prisma = new PrismaClient();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '3002', 10);

app.use(helmet());
app.disable('x-powered-by');

app.use(cookieParser());
app.use(loadAuthUser);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'http://localhost:3000').split(',');
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body parsing with limits
app.use(express.json({ limit: '10mb' }));

// Global rate limiter (100 requests per 15 minutes)
app.use(globalLimiter);

app.use('/api/auth', authRouter);

// Apply specific rate limiters to routes
app.use('/api/pages', writeLimiter);
app.use('/api/pages/meta/search', searchLimiter);
app.use('/api/tables', tablesLimiter);
app.use('/api/ai', aiLimiter);

app.use('/api/pages', pagesRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/ai', aiRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const hocuspocus = HocuspocusServer.configure({
  port: WS_PORT,
  quiet: true,
  async onAuthenticate({ requestHeaders, connection }) {
    const cookieHeader =
      typeof requestHeaders.cookie === 'string' ? requestHeaders.cookie : undefined;
    const token = parseCookieValue(cookieHeader, AUTH_COOKIE);
    if (!token) {
      throw new Error('Unauthorized');
    }
    const user = verifyAuthToken(token);
    if (!user) {
      throw new Error('Unauthorized');
    }
    connection.isAuthenticated = true;
    return { user: { name: user.name, color: user.avatarColor } };
  },
  async onStoreDocument(data) {
    const pageId = data.documentName;
    try {
      await prisma.page.update({
        where: { id: pageId },
        data: { updatedAt: new Date() },
      });
    } catch (err) {
      console.error('[WS] Failed to update page:', err instanceof Error ? err.message : 'Unknown error');
    }
  },
});

void hocuspocus.listen().catch((err) => {
  console.error('[WS] Hocuspocus failed to start:', err instanceof Error ? err.message : 'Unknown error');
  process.exit(1);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] Backend running on port ${PORT}`);
  console.log(`[WS]  Hocuspocus collab on port ${WS_PORT}`);
});

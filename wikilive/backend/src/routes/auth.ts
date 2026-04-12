import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../index';
import { AUTH_COOKIE, signAuthToken } from '../auth-tokens';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

const AVATAR_COLORS = [
  '#6366f1',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#14b8a6',
  '#a855f7',
  '#eab308',
  '#ef4444',
];

function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const t = email.trim().toLowerCase();
  if (t.length < 3 || t.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t;
}

function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string') return null;
  if (password.length < 10 || password.length > 200) return null;
  return password;
}

function validateName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const t = name.trim();
  if (t.length < 1 || t.length > 80) return null;
  return t;
}

router.get('/me', (req: Request, res: Response) => {
  if (!req.authUser) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: {
      id: req.authUser.id,
      email: req.authUser.email,
      name: req.authUser.name,
      avatarColor: req.authUser.avatarColor,
    },
  });
});

router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const email = validateEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const name = validateName(req.body?.name);
    if (!email || !password || !name) {
      res.status(400).json({ error: 'Некорректные email, пароль или имя. Пароль должен быть длиной не менее 10 символов.' });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Пользователь с таким email уже есть' });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
    const user = await prisma.user.create({
      data: { email, passwordHash, name, avatarColor },
    });
    const authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarColor: user.avatarColor,
    };
    const token = signAuthToken(authUser);
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.status(201).json({ user: authUser });
  } catch {
    res.status(500).json({ error: 'Не удалось зарегистрироваться' });
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const email = validateEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    if (!email || !password) {
      res.status(400).json({ error: 'Некорректные email или пароль. Пароль должен быть длиной не менее 10 символов.' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'Неверный email или пароль' });
      return;
    }
    const authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarColor: user.avatarColor,
    };
    const token = signAuthToken(authUser);
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({ user: authUser });
  } catch {
    res.status(500).json({ error: 'Не удалось войти' });
  }
});

router.patch('/me', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const updates: { name?: string; avatarColor?: string } = {};
    if (req.body?.name !== undefined) {
      const name = validateName(req.body.name);
      if (!name) {
        res.status(400).json({ error: 'Некорректное имя' });
        return;
      }
      updates.name = name;
    }
    if (req.body?.avatarColor !== undefined) {
      const color = req.body.avatarColor;
      if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
        res.status(400).json({ error: 'Некорректный цвет' });
        return;
      }
      updates.avatarColor = color;
    }
    const user = await prisma.user.update({
      where: { id: req.authUser.id },
      data: updates,
    });
    const authUser = { id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor };
    const token = signAuthToken(authUser);
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({ user: authUser });
  } catch {
    res.status(500).json({ error: 'Не удалось обновить профиль' });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
  res.json({ ok: true });
});

export default router;

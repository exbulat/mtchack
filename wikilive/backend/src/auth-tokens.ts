import jwt from 'jsonwebtoken';

export const AUTH_COOKIE = 'wikilive_auth';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
};

export type JwtAuthPayload = AuthUser & { sub: string };

export function getJwtSecret(): string {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    throw new Error('COOKIE_SECRET environment variable is required. Set it before starting the server.');
  }
  return secret;
}

export function signAuthToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      color: user.avatarColor,
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

export function verifyAuthToken(token: string): JwtAuthPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & {
      email?: string;
      name?: string;
      color?: string;
    };
    const id = decoded.sub;
    if (!id || typeof decoded.email !== 'string' || typeof decoded.name !== 'string') return null;
    return {
      sub: id,
      id,
      email: decoded.email,
      name: decoded.name,
      avatarColor: typeof decoded.color === 'string' ? decoded.color : '#6366f1',
    };
  } catch {
    return null;
  }
}

export function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=').trim());
  }
  return null;
}

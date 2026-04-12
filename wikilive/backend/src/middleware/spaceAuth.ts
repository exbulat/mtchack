import { Request, Response, NextFunction } from 'express';
import { SpaceRole } from '@prisma/client';
import { prisma } from '../index';

// расширяем Request инфой о членстве в пространстве
declare global {
  namespace Express {
    interface Request {
      spaceMember?: { role: SpaceRole; spaceId: string; userId: string } | null;
    }
  }
}

const ROLE_HIERARCHY: Record<SpaceRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  EDITOR: 2,
  READER: 1,
};

// загружает членство пользователя в пространстве, не отклоняет сам
export async function loadSpaceMember(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const spaceId = req.params.spaceId;
  if (!spaceId || !req.authUser) {
    req.spaceMember = null;
    return next();
  }

  try {
    const membership = await prisma.spaceMember.findFirst({
      where: { spaceId, userId: req.authUser.id },
    });
    if (membership) {
      req.spaceMember = { role: membership.role, spaceId, userId: membership.userId };
    } else {
      // владелец может не быть в таблице SpaceMember
      const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { ownerId: true } });
      if (space && space.ownerId === req.authUser.id) {
        req.spaceMember = { role: 'OWNER', spaceId, userId: req.authUser.id };
      } else {
        req.spaceMember = null;
      }
    }
  } catch {
    req.spaceMember = null;
  }
  return next();
}

// отклоняет если пользователь не участник пространства
export function requireSpaceMember(req: Request, res: Response, next: NextFunction): void {
  if (!req.spaceMember) {
    res.status(403).json({ error: 'Access denied: not a member of this space' });
    return;
  }
  next();
}

// отклоняет если роль ниже требуемой
export function requireSpaceRole(minRole: SpaceRole) {
  const minLevel = ROLE_HIERARCHY[minRole];
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.spaceMember) {
      res.status(403).json({ error: 'Access denied: not a member of this space' });
      return;
    }
    if (ROLE_HIERARCHY[req.spaceMember.role] < minLevel) {
      res.status(403).json({ error: `Access denied: requires ${minRole} role or above` });
      return;
    }
    next();
  };
}

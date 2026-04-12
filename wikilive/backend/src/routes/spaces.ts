import { Router, Request, Response } from 'express';
import { Prisma, ViewType } from '@prisma/client';
import { prisma } from '../index';
import { requireAuth } from '../middleware/requireAuth';
import { loadSpaceMember, requireSpaceMember, requireSpaceRole } from '../middleware/spaceAuth';
import {
  validateSpaceName,
  validateUserId,
  validateSpaceRole,
  validateFileTitle,
  validateJsonContent,
} from '../middleware/validators';

const router = Router();

router.use(requireAuth);

router.post('/', async (req: Request, res: Response) => {
  try {
    const rawName = req.body?.name;
    const name = validateSpaceName(rawName) || 'Новое пространство';
    const userId = req.authUser!.id;
    const space = await prisma.space.create({
      data: {
        name,
        ownerId: userId,
      },
    });
    await prisma.spaceMember.create({
      data: {
        spaceId: space.id,
        userId,
        role: 'OWNER',
      },
    });
    res.json(space);
  } catch (e) {
    console.error('[POST /spaces]', e);
    res.status(500).json({ error: 'Failed to create space' });
  }
});

router.get('/mine', async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const memberships = await prisma.spaceMember.findMany({
      where: { userId, space: { deletedAt: null } },
      include: { space: true },
    });
    const result = memberships.map((m) => ({ ...m.space, myRole: m.role }));
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch user spaces' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const owned = await prisma.space.findMany({
      where: { ownerId: userId, deletedAt: null },
      include: { owner: true, members: { include: { user: true } }, files: true },
    });
    const joined = await prisma.space.findMany({
      where: {
        AND: [
          { deletedAt: null },
          { members: { some: { userId } } },
        ],
      },
      include: { owner: true, members: { include: { user: true } }, files: true },
    });
    const all = [...owned, ...joined.filter((s) => !owned.find((o) => o.id === s.id))];
    res.json(all);
  } catch {
    res.status(500).json({ error: 'Failed to fetch spaces' });
  }
});

router.get('/:spaceId', loadSpaceMember, requireSpaceMember, async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.spaceId!;
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      include: { owner: true, members: { include: { user: true } }, files: true },
    });
    if (!space) return res.status(404).json({ error: 'Space not found' });
    res.json(space);
  } catch {
    res.status(500).json({ error: 'Failed to fetch space' });
  }
});

router.get('/:spaceId/members', loadSpaceMember, requireSpaceMember, async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.spaceId!;
    const space = await prisma.space.findUnique({ where: { id: spaceId }, include: { members: { include: { user: true } } } });
    if (!space) return res.status(404).json({ error: 'Space not found' });
    res.json(space.members);
  } catch {
    res.status(500).json({ error: 'Failed to fetch space members' });
  }
});

router.post('/:spaceId/members', loadSpaceMember, requireSpaceRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.spaceId!;
    const rawEmail = req.body?.email;
    const rawRole = req.body?.role;
    if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    const email = rawEmail.trim().toLowerCase();
    const validRole = validateSpaceRole(rawRole) ?? 'READER';
    const inviterRole = req.spaceMember!.role;
    const ROLE_HIERARCHY: Record<string, number> = { OWNER: 4, ADMIN: 3, EDITOR: 2, READER: 1 };
    if (ROLE_HIERARCHY[validRole]! >= ROLE_HIERARCHY[inviterRole]!) {
      return res.status(403).json({ error: 'Cannot assign role equal or above your own' });
    }
    const targetUser = await prisma.user.findUnique({ where: { email } });
    if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });
    const existing = await prisma.spaceMember.findFirst({ where: { spaceId, userId: targetUser.id } });
    if (existing) return res.status(409).json({ error: 'Пользователь уже участник' });
    const invited = await prisma.spaceMember.create({
      data: { spaceId, userId: targetUser.id, role: validRole },
      include: { user: true },
    });
    res.json(invited);
  } catch {
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

router.patch('/:spaceId/members/:userId', loadSpaceMember, requireSpaceRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { spaceId, userId } = req.params as { spaceId: string; userId: string };
    const rawRole = req.body?.role;
    const validRole = validateSpaceRole(rawRole);
    if (!validRole) return res.status(400).json({ error: 'Valid role is required' });
    const ROLE_HIERARCHY: Record<string, number> = { OWNER: 4, ADMIN: 3, EDITOR: 2, READER: 1 };
    const myLevel = ROLE_HIERARCHY[req.spaceMember!.role]!;
    if (ROLE_HIERARCHY[validRole]! >= myLevel) {
      return res.status(403).json({ error: 'Cannot assign role equal or above your own' });
    }
    const target = await prisma.spaceMember.findFirst({ where: { spaceId, userId } });
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (ROLE_HIERARCHY[target.role]! >= myLevel) {
      return res.status(403).json({ error: 'Cannot modify member with equal or higher role' });
    }
    // Не позволяем OWNER'у снять с себя роль через этот эндпоинт
    if (target.role === 'OWNER') {
      return res.status(403).json({ error: 'Cannot change OWNER role' });
    }
    const updated = await prisma.spaceMember.update({
      where: { id: target.id },
      data: { role: validRole },
      include: { user: true },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

router.delete('/:spaceId/members/:userId', loadSpaceMember, requireSpaceRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { spaceId, userId } = req.params as { spaceId: string; userId: string };
    if (userId === req.authUser!.id) {
      return res.status(400).json({ error: 'Нельзя удалить себя' });
    }
    const ROLE_HIERARCHY: Record<string, number> = { OWNER: 4, ADMIN: 3, EDITOR: 2, READER: 1 };
    const myLevel = ROLE_HIERARCHY[req.spaceMember!.role]!;
    const target = await prisma.spaceMember.findFirst({ where: { spaceId, userId } });
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (ROLE_HIERARCHY[target.role]! >= myLevel) {
      return res.status(403).json({ error: 'Cannot remove member with equal or higher role' });
    }
    await prisma.spaceMember.delete({ where: { id: target.id } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// ── Страницы пространства ──

router.get('/:spaceId/pages', loadSpaceMember, requireSpaceMember, async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.spaceId!;
    const pages = await prisma.page.findMany({
      where: { spaceId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, icon: true, updatedAt: true, spaceId: true },
    });
    res.json(pages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch space pages' });
  }
});

router.post('/:spaceId/pages', loadSpaceMember, requireSpaceRole('EDITOR'), async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.spaceId!;
    const rawTitle = req.body?.title;
    const rawContent = req.body?.content;
    const rawIcon = req.body?.icon;
    const title = (typeof rawTitle === 'string' && rawTitle.trim()) ? rawTitle.trim() : 'Без названия';
    const content = validateJsonContent(rawContent);
    if (content === null) return res.status(400).json({ error: 'Content must be a valid object' });
    const icon = typeof rawIcon === 'string' ? rawIcon.substring(0, 50) : '';
    const page = await prisma.page.create({
      data: {
        title,
        content: content as Prisma.InputJsonValue,
        icon,
        spaceId,
        ownerId: req.authUser!.id,
      },
    });
    res.status(201).json(page);
  } catch (e) {
    console.error('[POST /:spaceId/pages]', e);
    res.status(500).json({ error: 'Failed to create page in space' });
  }
});

// ── Файлы пространства ──

router.post('/:spaceId/files', loadSpaceMember, requireSpaceRole('EDITOR'), async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.spaceId!;
    const rawTitle = req.body?.title;
    const rawContent = req.body?.content;
    const title = validateFileTitle(rawTitle) || 'Untitled';
    const content = validateJsonContent(rawContent);
    if (content === null) return res.status(400).json({ error: 'Content must be a valid object' });
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) return res.status(404).json({ error: 'Space not found' });
    const file = await prisma.file.create({
      data: {
        spaceId,
        title,
        content: content as Prisma.InputJsonValue,
        ownerId: req.authUser!.id,
      },
    });
    const viewTypes: { t: ViewType; name: string }[] = [
      { t: ViewType.TABLE, name: 'Таблица' },
      { t: ViewType.KANBAN, name: 'Канбан' },
      { t: ViewType.CALENDAR, name: 'Календарь' },
      { t: ViewType.GANTT, name: 'Диаграмма Ганта' },
    ];
    for (const vt of viewTypes) {
      await prisma.view.create({ data: { fileId: file.id, type: vt.t, name: vt.name } });
    }
    res.json(file);
  } catch {
    res.status(500).json({ error: 'Failed to create file' });
  }
});

router.patch('/:spaceId', loadSpaceMember, requireSpaceRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.spaceId!;
    const rawName = req.body?.name;
    const name = rawName !== undefined ? validateSpaceName(rawName) : undefined;
    if (rawName !== undefined && name === null) {
      return res.status(400).json({ error: 'Invalid space name' });
    }
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) return res.status(404).json({ error: 'Space not found' });
    const updated = await prisma.space.update({ where: { id: spaceId }, data: { name: name ?? space.name } });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update space' });
  }
});

router.put('/:spaceId', loadSpaceMember, requireSpaceRole('OWNER'), async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.spaceId!;
    const rawName = req.body?.name;
    const name = rawName !== undefined ? validateSpaceName(rawName) : undefined;
    if (rawName !== undefined && name === null) {
      return res.status(400).json({ error: 'Invalid space name' });
    }
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) return res.status(404).json({ error: 'Space not found' });
    const updated = await prisma.space.update({ where: { id: spaceId }, data: { name: name ?? space.name } });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update space' });
  }
});

router.delete('/:spaceId', loadSpaceMember, requireSpaceRole('OWNER'), async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.spaceId!;
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) return res.status(404).json({ error: 'Space not found' });
    await prisma.space.update({ where: { id: spaceId }, data: { deletedAt: new Date() } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete space' });
  }
});

export default router;

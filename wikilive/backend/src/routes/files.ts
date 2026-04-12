import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { requireAuth } from '../middleware/requireAuth';
import { validateViewType, validateViewName, validateJsonContent } from '../middleware/validators';

const router = Router();

router.use(requireAuth);

router.post('/:fileId/views', async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId!;
    const rawType = req.body?.type;
    const rawName = req.body?.name;
    const rawConfig = req.body?.config;

    const type = validateViewType(rawType);
    if (!type) return res.status(400).json({ error: 'Valid viewType is required (TABLE, KANBAN, CALENDAR, GANTT)' });

    const name = validateViewName(rawName);
    const config = validateJsonContent(rawConfig);
    if (config === null) return res.status(400).json({ error: 'Config must be a valid object' });

    const file = await prisma.file.findUnique({ where: { id: fileId }, include: { space: true } });
    if (!file) return res.status(404).json({ error: 'File not found' });

    const membership = await prisma.spaceMember.findFirst({
      where: { spaceId: file.spaceId, userId: req.authUser!.id },
    });
    if (!membership && file.space.ownerId !== req.authUser!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (membership?.role === 'READER') {
      return res.status(403).json({ error: 'READER cannot create views' });
    }

    const view = await prisma.view.create({
      data: {
        fileId,
        type,
        ...(name !== null && { name }),
        ...(config !== undefined && Object.keys(config).length > 0 && { config: config as Prisma.InputJsonValue }),
      },
    });
    res.status(201).json(view);
  } catch {
    res.status(500).json({ error: 'Failed to create view' });
  }
});

router.get('/:fileId/views', async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId!;
    const file = await prisma.file.findUnique({ where: { id: fileId }, include: { space: true } });
    if (!file) return res.status(404).json({ error: 'File not found' });

    const membership = await prisma.spaceMember.findFirst({
      where: { spaceId: file.spaceId, userId: req.authUser!.id },
    });
    if (!membership && file.space.ownerId !== req.authUser!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const views = await prisma.view.findMany({ where: { fileId } });
    res.json(views);
  } catch {
    res.status(500).json({ error: 'Failed to fetch views' });
  }
});

export default router;

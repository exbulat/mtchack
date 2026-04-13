import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
const SPACE_ROLE_LEVEL = { OWNER: 4, ADMIN: 3, EDITOR: 2, READER: 1 } as const;
const EMPTY_PAGE_CONTENT = { type: 'doc', content: [{ type: 'paragraph' }] } as const;
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'ftp:', 'ftps:']);
const MAX_CONTENT_DEPTH = 100;
const DEFAULT_PAGE_TITLE = 'Без названия';

function validateTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return null;
  return trimmed;
}

async function getUniquePersonalPageTitle(title: string, ownerId: string): Promise<string> {
  const normalizedBase = title.trim() || DEFAULT_PAGE_TITLE;
  const pages = await prisma.page.findMany({
    where: {
      ownerId,
      spaceId: null,
      deletedAt: null,
    },
    select: { title: true },
  });
  const takenTitles = new Set(pages.map((page) => page.title.trim().toLowerCase()));

  if (!takenTitles.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  let suffix = 2;
  while (takenTitles.has(`${normalizedBase} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }

  return `${normalizedBase} ${suffix}`;
}

function isSafeLinkHref(href: string): boolean {
  if (href.startsWith('/')) {
    return true;
  }

  try {
    const url = new URL(href, 'http://localhost');
    return SAFE_LINK_PROTOCOLS.has(url.protocol.toLowerCase());
  } catch {
    return false;
  }
}

function isSafeImageSrc(src: string): boolean {
  if (src.startsWith('/api/files/static/')) {
    return true;
  }

  try {
    const url = new URL(src, 'http://localhost');
    return url.origin === 'http://localhost' && url.pathname.startsWith('/api/files/static/');
  } catch {
    return false;
  }
}

function sanitizeContentNode(node: unknown, depth = 0): unknown {
  if (depth > MAX_CONTENT_DEPTH) {
    return null;
  }

  if (Array.isArray(node)) {
    return node
      .map((item) => sanitizeContentNode(item, depth + 1))
      .filter((item) => item !== null);
  }

  if (!node || typeof node !== 'object') {
    return node;
  }

  const input = node as Record<string, unknown>;
  const output: Record<string, unknown> = { ...input };

  if (Array.isArray(input.marks)) {
    output.marks = input.marks
      .map((mark) => {
        if (!mark || typeof mark !== 'object') return null;
        const markObj = mark as Record<string, unknown>;
        if (markObj.type !== 'link') {
          return sanitizeContentNode(markObj, depth + 1);
        }

        const attrs =
          markObj.attrs && typeof markObj.attrs === 'object'
            ? { ...(markObj.attrs as Record<string, unknown>) }
            : {};
        const href = typeof attrs.href === 'string' ? attrs.href.trim() : '';
        if (!href || !isSafeLinkHref(href)) {
          return null;
        }
        attrs.href = href;
        return { ...markObj, attrs };
      })
      .filter((mark) => mark !== null);
  }

  if (Array.isArray(input.content)) {
    output.content = input.content
      .map((child) => sanitizeContentNode(child, depth + 1))
      .filter((child) => child !== null);
  }

  if (input.type === 'image') {
    const attrs =
      input.attrs && typeof input.attrs === 'object'
        ? { ...(input.attrs as Record<string, unknown>) }
        : {};
    const src = typeof attrs.src === 'string' ? attrs.src.trim() : '';
    if (!src || !isSafeImageSrc(src)) {
      return null;
    }
    attrs.src = src;
    output.attrs = attrs;
  }

  if (input.type === 'mwsTable') {
    const attrs =
      input.attrs && typeof input.attrs === 'object'
        ? { ...(input.attrs as Record<string, unknown>) }
        : {};
    const dstId = typeof attrs.dstId === 'string' ? attrs.dstId.trim() : '';
    if (!/^dst[a-zA-Z0-9]{10,}$/.test(dstId)) {
      return null;
    }
    attrs.dstId = dstId;
    if (typeof attrs.title === 'string') {
      attrs.title = attrs.title.substring(0, 200);
    }
    const viewId = typeof attrs.viewId === 'string' ? attrs.viewId.trim() : '';
    if (viewId) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(viewId)) {
        delete attrs.viewId;
      } else {
        attrs.viewId = viewId;
      }
    } else {
      delete attrs.viewId;
    }
    if (typeof attrs.viewName === 'string') {
      attrs.viewName = attrs.viewName.substring(0, 200);
    } else {
      delete attrs.viewName;
    }
    output.attrs = attrs;
  }

  return output;
}

function sanitizeContent(content: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeContentNode(content, 0);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    return { ...EMPTY_PAGE_CONTENT };
  }
  return sanitized as Record<string, unknown>;
}

function validateContent(content: unknown): object | null {
  if (content === null || content === undefined) return { ...EMPTY_PAGE_CONTENT };
  if (typeof content !== 'object' || Array.isArray(content)) return null;
  return sanitizeContent(content as Record<string, unknown>);
}

function validateIcon(icon: unknown): string {
  if (typeof icon === 'string') return icon.substring(0, 50);
  return '';
}

type PageAccessRecord = {
  id: string;
  title: string;
  icon: string;
  ownerId: string | null;
  spaceId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  content: Prisma.JsonValue;
};

function withoutCollabState<T extends { collabState?: unknown }>(page: T): Omit<T, 'collabState'> {
  const { collabState: _collabState, ...rest } = page;
  return rest;
}

async function getSpaceRole(spaceId: string, userId: string): Promise<keyof typeof SPACE_ROLE_LEVEL | null> {
  const membership = await prisma.spaceMember.findFirst({
    where: { spaceId, userId },
    select: { role: true },
  });
  if (membership) {
    return membership.role;
  }

  const space = await prisma.space.findFirst({
    where: { id: spaceId, deletedAt: null },
    select: { ownerId: true },
  });
  if (space && space.ownerId === userId) {
    return 'OWNER';
  }
  return null;
}

async function canReadPage(page: Pick<PageAccessRecord, 'ownerId' | 'spaceId'>, userId: string): Promise<boolean> {
  if (page.ownerId === userId) {
    return true;
  }
  if (!page.spaceId) {
    return false;
  }
  return (await getSpaceRole(page.spaceId, userId)) !== null;
}

async function canEditPage(page: Pick<PageAccessRecord, 'ownerId' | 'spaceId'>, userId: string): Promise<boolean> {
  if (page.ownerId === userId) {
    return true;
  }
  if (!page.spaceId) {
    return false;
  }
  const role = await getSpaceRole(page.spaceId, userId);
  return role !== null && SPACE_ROLE_LEVEL[role] >= SPACE_ROLE_LEVEL.EDITOR;
}

async function resolveLinkedPageIds(
  sourcePage: Pick<PageAccessRecord, 'ownerId' | 'spaceId'>,
  refs: { ids: string[]; titles: string[] }
): Promise<string[]> {
  const normalizedTitles = Array.from(new Set(refs.titles.map((title) => title.trim()).filter(Boolean)));
  if (refs.ids.length === 0 && normalizedTitles.length === 0) {
    return [];
  }

  const pages = await prisma.page.findMany({
    where: sourcePage.spaceId
      ? {
          deletedAt: null,
          spaceId: sourcePage.spaceId,
          OR: [
            ...(refs.ids.length > 0 ? [{ id: { in: refs.ids } }] : []),
            ...(normalizedTitles.length > 0
              ? [{ title: { in: normalizedTitles, mode: 'insensitive' as const } }]
              : []),
          ],
        }
      : {
          deletedAt: null,
          ownerId: sourcePage.ownerId ?? undefined,
          spaceId: null,
          OR: [
            ...(refs.ids.length > 0 ? [{ id: { in: refs.ids } }] : []),
            ...(normalizedTitles.length > 0
              ? [{ title: { in: normalizedTitles, mode: 'insensitive' as const } }]
              : []),
          ],
        },
    select: { id: true, title: true },
  });

  const pageIds = new Set(pages.map((page) => page.id));
  const titleMap = new Map(pages.map((page) => [page.title.trim().toLowerCase(), page.id]));

  for (const title of normalizedTitles) {
    const pageId = titleMap.get(title.toLowerCase());
    if (pageId) {
      pageIds.add(pageId);
    }
  }

  return Array.from(pageIds);
}

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const pages = await prisma.page.findMany({
      where: { deletedAt: null, ownerId: req.authUser!.id, spaceId: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, icon: true, updatedAt: true, spaceId: true },
    });
    res.json(pages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

router.get('/meta/trash', requireAuth, async (req: Request, res: Response) => {
  try {
    const spaceId = typeof req.query.spaceId === 'string' ? req.query.spaceId : null;
    if (spaceId) {
      const role = await getSpaceRole(spaceId, req.authUser!.id);
      if (!role) {
        return res.status(403).json({ error: 'Нет прав на просмотр корзины этого пространства' });
      }
    }

    const pages = await prisma.page.findMany({
      where: spaceId
        ? { deletedAt: { not: null }, spaceId }
        : { deletedAt: { not: null }, ownerId: req.authUser!.id, spaceId: null },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, title: true, icon: true, deletedAt: true, spaceId: true },
    });
    res.json(pages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch trash' });
  }
});

router.get('/meta/graph', requireAuth, async (req: Request, res: Response) => {
  try {
    const spaceId = typeof req.query.spaceId === 'string' ? req.query.spaceId : null;
    if (spaceId) {
      const role = await getSpaceRole(spaceId, req.authUser!.id);
      if (!role) {
        return res.status(403).json({ error: 'Нет прав на просмотр графа этого пространства' });
      }
    }

    const pages = await prisma.page.findMany({
      where: spaceId
        ? { deletedAt: null, spaceId }
        : { deletedAt: null, ownerId: req.authUser!.id, spaceId: null },
      select: { id: true, title: true, icon: true, spaceId: true },
    });
    const pageIds = pages.map((p) => p.id);
    const links = await prisma.pageLink.findMany({
      where: { OR: [{ sourceId: { in: pageIds } }, { targetId: { in: pageIds } }] },
      select: { sourceId: true, targetId: true },
    });
    res.json({
      nodes: pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon })),
      edges: links.map((l) => ({ source: l.sourceId, target: l.targetId })),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch graph' });
  }
});

router.get('/meta/search', requireAuth, async (req: Request, res: Response) => {
  try {
    let q = (req.query.q as string) || '';
    const spaceId = typeof req.query.spaceId === 'string' ? req.query.spaceId : null;
    const MAX_SEARCH_LENGTH = 200;
    if (q.length > MAX_SEARCH_LENGTH) {
      q = q.substring(0, MAX_SEARCH_LENGTH);
    }
    q = q.trim();

    if (spaceId) {
      const role = await getSpaceRole(spaceId, req.authUser!.id);
      if (!role) {
        return res.status(403).json({ error: 'Нет прав на поиск в этом пространстве' });
      }
    }

    const pages = await prisma.page.findMany({
      where: spaceId
        ? { title: { contains: q, mode: 'insensitive' }, deletedAt: null, spaceId }
        : { title: { contains: q, mode: 'insensitive' }, deletedAt: null, ownerId: req.authUser!.id, spaceId: null },
      select: { id: true, title: true, icon: true, spaceId: true },
      take: 10,
    });
    res.json(pages);
  } catch {
    res.status(500).json({ error: 'Failed to search pages' });
  }
});

router.patch('/comments/:commentId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { text, resolved } = req.body;
    if (text !== undefined) {
      if (typeof text !== 'string') {
        return res.status(400).json({ error: 'Comment text must be a string' });
      }
      const trimmedText = text.trim();
      if (trimmedText.length === 0) {
        return res.status(400).json({ error: 'Comment text cannot be empty' });
      }
      if (trimmedText.length > 5000) {
        return res.status(400).json({ error: 'Comment text too long (max 5000 characters)' });
      }
    }
    if (resolved !== undefined && typeof resolved !== 'boolean') {
      return res.status(400).json({ error: 'Resolved must be a boolean' });
    }

    const commentId = req.params.commentId!;
    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    const page = await prisma.page.findUnique({
      where: { id: existing.pageId },
      select: { ownerId: true, spaceId: true, deletedAt: true },
    });
    if (!page || page.deletedAt) {
      return res.status(404).json({ error: 'Page not found' });
    }
    if (!(await canReadPage(page, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на изменение комментариев этой страницы' });
    }
    if (existing.authorId !== req.authUser!.id) {
      return res.status(403).json({ error: 'Нет прав на изменение этого комментария' });
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: {
        ...(text !== undefined && { text: text.trim() }),
        ...(resolved !== undefined && { resolved: Boolean(resolved) }),
      },
    });
    res.json({ ...updated, authorName: req.authUser!.name });
  } catch {
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

router.delete('/comments/:commentId', requireAuth, async (req: Request, res: Response) => {
  try {
    const commentId = req.params.commentId!;
    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    const page = await prisma.page.findUnique({
      where: { id: existing.pageId },
      select: { ownerId: true, spaceId: true, deletedAt: true },
    });
    if (!page || page.deletedAt) {
      return res.status(404).json({ error: 'Page not found' });
    }
    if (!(await canReadPage(page, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на удаление комментариев этой страницы' });
    }
    if (existing.authorId !== req.authUser!.id) {
      return res.status(403).json({ error: 'Нет прав на удаление этого комментария' });
    }
    await prisma.comment.delete({ where: { id: commentId } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = await prisma.page.findFirst({
      where: { id: req.params.id!, deletedAt: null },
      include: {
        incomingLinks: {
          include: { source: { select: { id: true, title: true, icon: true, spaceId: true } } },
        },
      },
    });
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canReadPage(page, req.authUser!.id))) {
      console.warn('[403] page read denied', {
        pageId: req.params.id,
        userId: req.authUser!.id,
        pageOwnerId: page.ownerId,
        pageSpaceId: page.spaceId,
      });
      return res.status(403).json({ error: 'Нет прав на просмотр этой страницы' });
    }
    const safePage = {
      ...page,
      content:
        page.content && typeof page.content === 'object' && !Array.isArray(page.content)
          ? sanitizeContent(page.content as Record<string, unknown>)
          : page.content,
    };
    res.json(withoutCollabState(safePage));
  } catch {
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, content, icon } = req.body;
    const requestedTitle = validateTitle(title) || DEFAULT_PAGE_TITLE;
    const validContent = validateContent(content);
    if (validContent === null) {
      return res.status(400).json({ error: 'Content must be a valid object' });
    }
    const validIcon = validateIcon(icon);
    const validTitle = await getUniquePersonalPageTitle(requestedTitle, req.authUser!.id);

    const payload: { title: string; icon: string; ownerId: string; content?: Prisma.InputJsonValue } = {
      title: validTitle,
      icon: validIcon,
      ownerId: req.authUser!.id,
    };
    if (validContent !== null) {
      payload.content = validContent as Prisma.InputJsonValue;
    }
    const page = await prisma.page.create({ data: payload });
    res.status(201).json(withoutCollabState(page));
  } catch {
    res.status(500).json({ error: 'Failed to create page' });
  }
});

router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, content, icon } = req.body;
    const existing = await prisma.page.findFirst({
      where: { id: req.params.id!, deletedAt: null },
    });
    if (!existing) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(existing as PageAccessRecord, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на редактирование этой страницы' });
    }
    if (title !== undefined) {
      const validTitle = validateTitle(title);
      if (validTitle === null) {
        return res.status(400).json({ error: 'Title must be 1-500 characters' });
      }
    }

    const updateData: Record<string, Prisma.InputJsonValue | string> = {
      ...(icon !== undefined && { icon }),
      ...(title !== undefined && { title: validateTitle(title) || 'Без названия' }),
    };
    if (content !== undefined) {
      const validContent = validateContent(content);
      if (validContent === null) {
        return res.status(400).json({ error: 'Content must be a valid object' });
      }
      updateData.content = validContent as Prisma.InputJsonValue;
    }

    const REVISION_INTERVAL_MS = 5 * 60 * 1000;
    const latestRevision = await prisma.pageRevision.findFirst({
      where: { pageId: req.params.id! },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const shouldCreateRevision =
      !latestRevision ||
      Date.now() - latestRevision.createdAt.getTime() > REVISION_INTERVAL_MS;

    if (shouldCreateRevision) {
      await prisma.pageRevision.create({
        data: {
          pageId: req.params.id!,
          content: existing.content as Prisma.InputJsonValue,
        },
      });

      const allRevisions = await prisma.pageRevision.findMany({
        where: { pageId: req.params.id! },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (allRevisions.length > 20) {
        const toDelete = allRevisions.slice(20).map((revision) => revision.id);
        await prisma.pageRevision.deleteMany({ where: { id: { in: toDelete } } });
      }
    }

    const page = await prisma.page.update({
      where: { id: req.params.id! },
      data: updateData,
    });

    if (content && typeof content === 'object' && !Array.isArray(content)) {
      await syncPageLinks(existing as PageAccessRecord, content as Record<string, unknown>);
    }

    res.json(withoutCollabState(page));
  } catch {
    res.status(500).json({ error: 'Failed to update page' });
  }
});

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.page.findFirst({
      where: { id: req.params.id!, deletedAt: null },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Page not found or already in trash' });
    }
    if (!(await canEditPage(existing as PageAccessRecord, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на удаление этой страницы' });
    }
    await prisma.page.update({
      where: { id: req.params.id! },
      data: { deletedAt: new Date() },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

router.post('/:id/restore', requireAuth, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.page.findFirst({
      where: { id: req.params.id!, deletedAt: { not: null } },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Page not found or not in trash' });
    }
    if (!(await canEditPage(existing as PageAccessRecord, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на восстановление этой страницы' });
    }
    await prisma.page.update({
      where: { id: req.params.id! },
      data: { deletedAt: null },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to restore page' });
  }
});

router.delete('/:id/permanent', requireAuth, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.page.findUnique({ where: { id: req.params.id! } });
    if (!existing) {
      return res.status(404).json({ error: 'Page not found' });
    }
    if (!(await canEditPage(existing as PageAccessRecord, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на удаление этой страницы' });
    }
    await prisma.page.delete({ where: { id: req.params.id! } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to permanently delete page' });
  }
});

router.get('/:id/backlinks', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = await prisma.page.findFirst({ where: { id: req.params.id!, deletedAt: null } });
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canReadPage(page as PageAccessRecord, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на просмотр этой страницы' });
    }
    const links = await prisma.pageLink.findMany({
      where: { targetId: req.params.id! },
      include: { source: { select: { id: true, title: true, icon: true, spaceId: true } } },
    });
    res.json(links.map((link) => link.source));
  } catch {
    res.status(500).json({ error: 'Failed to fetch backlinks' });
  }
});

router.get('/:id/revisions', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = await prisma.page.findFirst({ where: { id: req.params.id!, deletedAt: null } });
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canReadPage(page as PageAccessRecord, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на просмотр ревизий этой страницы' });
    }
    const revisions = await prisma.pageRevision.findMany({
      where: { pageId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json(revisions);
  } catch {
    res.status(500).json({ error: 'Failed to fetch revisions' });
  }
});

router.post('/:id/revisions/:revisionId/restore', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = await prisma.page.findUnique({ where: { id: req.params.id! } });
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    if (!(await canEditPage(page as PageAccessRecord, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на восстановление ревизий этой страницы' });
    }

    const revision = await prisma.pageRevision.findUnique({ where: { id: req.params.revisionId! } });
    if (!revision || revision.pageId !== page.id) {
      return res.status(404).json({ error: 'Revision not found' });
    }

    await prisma.pageRevision.create({
      data: {
        pageId: page.id,
        content: page.content as Prisma.InputJsonValue,
      },
    });

    const updated = await prisma.page.update({
      where: { id: page.id },
      data: { content: revision.content as Prisma.InputJsonValue },
    });

    if (revision.content && typeof revision.content === 'object' && !Array.isArray(revision.content)) {
      await syncPageLinks(page as PageAccessRecord, revision.content as Record<string, unknown>);
    }
    res.json(withoutCollabState(updated));
  } catch {
    res.status(500).json({ error: 'Failed to restore revision' });
  }
});

router.delete('/:id/revisions/:revisionId', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = await prisma.page.findUnique({ where: { id: req.params.id! } });
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    if (!(await canEditPage(page as PageAccessRecord, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на удаление ревизий этой страницы' });
    }
    const revision = await prisma.pageRevision.findUnique({ where: { id: req.params.revisionId! } });
    if (!revision || revision.pageId !== req.params.id!) {
      return res.status(404).json({ error: 'Revision not found' });
    }
    await prisma.pageRevision.delete({ where: { id: req.params.revisionId! } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete revision' });
  }
});

router.get('/:id/comments', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = await prisma.page.findFirst({ where: { id: req.params.id!, deletedAt: null } });
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canReadPage(page as PageAccessRecord, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на просмотр комментариев этой страницы' });
    }
    const comments = await prisma.comment.findMany({
      where: { pageId: req.params.id! },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const authorIds = [...new Set(comments.map((comment) => comment.authorId).filter(Boolean))];
    const authors = await prisma.user.findMany({
      where: { id: { in: authorIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(authors.map((author) => [author.id, author.name]));
    const enriched = comments.map((comment) => ({
      ...comment,
      authorName: nameMap.get(comment.authorId) || comment.authorId,
    }));
    res.json(enriched);
  } catch {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

router.post('/:id/comments', requireAuth, async (req: Request, res: Response) => {
  try {
    const { text, blockId } = req.body;

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    const trimmedText = String(text).trim();
    if (trimmedText.length > 5000) {
      return res.status(400).json({ error: 'Comment text too long (max 5000 characters)' });
    }

    let validatedBlockId = '';
    if (blockId) {
      if (typeof blockId !== 'string') {
        return res.status(400).json({ error: 'Invalid blockId format' });
      }
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(blockId)) {
        return res.status(400).json({ error: 'Invalid blockId format' });
      }
      validatedBlockId = blockId;
    }

    const page = await prisma.page.findFirst({
      where: { id: req.params.id!, deletedAt: null },
      select: { ownerId: true, spaceId: true },
    });
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    if (!(await canReadPage(page, req.authUser!.id))) {
      return res.status(403).json({ error: 'Нет прав на комментирование этой страницы' });
    }

    const comment = await prisma.comment.create({
      data: {
        pageId: req.params.id!,
        text: trimmedText,
        authorId: req.authUser!.id,
        blockId: validatedBlockId,
      },
    });
    res.status(201).json({ ...comment, authorName: req.authUser!.name });
  } catch {
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

async function syncPageLinks(
  sourcePage: Pick<PageAccessRecord, 'id' | 'ownerId' | 'spaceId'>,
  content: Record<string, unknown>
): Promise<void> {
  const refs = extractPageLinks(content);
  const targetIds = await resolveLinkedPageIds(sourcePage, refs);

  await prisma.pageLink.deleteMany({ where: { sourceId: sourcePage.id } });

  const uniqueTargetIds = Array.from(new Set(targetIds)).filter((targetId) => targetId !== sourcePage.id);
  if (uniqueTargetIds.length > 0) {
    await prisma.pageLink.createMany({
      data: uniqueTargetIds.map((targetId) => ({ sourceId: sourcePage.id, targetId })),
      skipDuplicates: true,
    });
  }
}

interface ExtractLinksContext {
  ids: Set<string>;
  titles: Set<string>;
  depth: number;
  maxDepth: number;
  maxResults: number;
  visited: WeakSet<object>;
}

function extractPageLinks(node: unknown): { ids: string[]; titles: string[] } {
  const context: ExtractLinksContext = {
    ids: new Set(),
    titles: new Set(),
    depth: 0,
    maxDepth: 100,
    maxResults: 1000,
    visited: new WeakSet(),
  };

  extractPageLinksRecursive(node, context);
  return { ids: Array.from(context.ids), titles: Array.from(context.titles) };
}

function extractPageLinksRecursive(node: unknown, context: ExtractLinksContext): void {
  if (context.depth > context.maxDepth) {
    console.warn('[Security] extractPageLinks: max depth exceeded, stopping recursion');
    return;
  }

  if (context.ids.size + context.titles.size >= context.maxResults) {
    console.warn('[Security] extractPageLinks: max results limit reached');
    return;
  }

  if (!node) return;

  if (typeof node === 'object' && node !== null) {
    if (context.visited.has(node as object)) {
      return;
    }
    context.visited.add(node as object);
  }

  const nodeObj = node as Record<string, unknown>;

  if (nodeObj.type === 'pageLink' && typeof nodeObj.attrs === 'object' && nodeObj.attrs !== null) {
    const attrs = nodeObj.attrs as Record<string, unknown>;
    if (typeof attrs.pageId === 'string') {
      context.ids.add(attrs.pageId);
    }
  }

  if (Array.isArray(nodeObj.marks)) {
    for (const mark of nodeObj.marks) {
      if (typeof mark !== 'object' || mark === null) {
        continue;
      }
      const markObj = mark as Record<string, unknown>;
      if (markObj.type !== 'wikiLink' || typeof markObj.attrs !== 'object' || markObj.attrs === null) {
        continue;
      }
      const attrs = markObj.attrs as Record<string, unknown>;
      if (typeof attrs.title === 'string' && attrs.title.trim()) {
        context.titles.add(attrs.title.trim());
      }
    }
  }

  if (Array.isArray(nodeObj.content)) {
    context.depth++;
    for (const child of nodeObj.content) {
      if (context.ids.size + context.titles.size >= context.maxResults) break;
      extractPageLinksRecursive(child, context);
    }
    context.depth--;
  }
}

export default router;

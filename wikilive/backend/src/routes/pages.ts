import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../index';

const router = Router();

function validateTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return null;
  return trimmed;
}

function validateContent(content: unknown): object | null {
  if (content === null || content === undefined) return {};
  if (typeof content !== 'object' || Array.isArray(content)) return null;
  return content as Record<string, unknown>;
}

function validateIcon(icon: unknown): string {
  if (typeof icon === 'string') return icon.substring(0, 50);
  return '';
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const pages = await prisma.page.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, icon: true, updatedAt: true },
    });
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

router.get('/meta/trash', async (_req: Request, res: Response) => {
  try {
    const pages = await prisma.page.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, title: true, icon: true, deletedAt: true },
    });
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trash' });
  }
});

router.get('/meta/graph', async (_req: Request, res: Response) => {
  try {
    const pages = await prisma.page.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true, icon: true },
    });
    const links = await prisma.pageLink.findMany({
      select: { sourceId: true, targetId: true },
    });
    res.json({
      nodes: pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon })),
      edges: links.map((l) => ({ source: l.sourceId, target: l.targetId })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch graph' });
  }
});

router.get('/meta/search', async (req: Request, res: Response) => {
  try {
    let q = (req.query.q as string) || '';
    const MAX_SEARCH_LENGTH = 200;
    if (q.length > MAX_SEARCH_LENGTH) {
      q = q.substring(0, MAX_SEARCH_LENGTH);
    }
    q = q.trim();
    
    const pages = await prisma.page.findMany({
      where: { title: { contains: q, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, title: true, icon: true },
      take: 10,
    });
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to search pages' });
  }
});

router.patch('/comments/:commentId', async (req: Request, res: Response) => {
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
    
    const updated = await prisma.comment.update({
      where: { id: req.params.commentId },
      data: {
        ...(text !== undefined && { text: text.trim() }),
        ...(resolved !== undefined && { resolved: Boolean(resolved) }),
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

router.delete('/comments/:commentId', async (req: Request, res: Response) => {
  try {
    await prisma.comment.delete({ where: { id: req.params.commentId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const page = await prisma.page.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: {
        incomingLinks: {
          include: { source: { select: { id: true, title: true, icon: true } } },
        },
      },
    });
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, content, icon } = req.body;
    const validTitle = validateTitle(title) || 'Без названия';
    const validContent = validateContent(content);
    if (validContent === null) {
      return res.status(400).json({ error: 'Content must be a valid object' });
    }
    const validIcon = validateIcon(icon);

    const page = await prisma.page.create({
      data: {
        title: validTitle,
        content: validContent,
        icon: validIcon,
      },
    });
    res.status(201).json(page);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create page' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { title, content, icon } = req.body;
    const existing = await prisma.page.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing) return res.status(404).json({ error: 'Page not found' });
    if (title !== undefined) {
      const validTitle = validateTitle(title);
      if (validTitle === null) {
        return res.status(400).json({ error: 'Title must be 1-500 characters' });
      }
    }
    if (content !== undefined) {
      const validContent = validateContent(content);
      if (validContent === null) {
        return res.status(400).json({ error: 'Content must be a valid object' });
      }
    }

    await prisma.pageRevision.create({
      data: {
        pageId: req.params.id,
        content: existing.content as Prisma.InputJsonValue,
      },
    });

    const page = await prisma.page.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title: validateTitle(title) || 'Без названия' }),
        ...(content !== undefined && {
          content: (validateContent(content) || {}) as Prisma.InputJsonValue,
        }),
        ...(icon !== undefined && { icon: validateIcon(icon) }),
      },
    });

    if (content) {
      await syncPageLinks(req.params.id, content);
    }

    res.json(page);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update page' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await prisma.page.updateMany({
      where: { id: req.params.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Page not found or already in trash' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

router.post('/:id/restore', async (req: Request, res: Response) => {
  try {
    const result = await prisma.page.updateMany({
      where: { id: req.params.id, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Page not found or not in trash' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore page' });
  }
});

router.delete('/:id/permanent', async (req: Request, res: Response) => {
  try {
    await prisma.page.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to permanently delete page' });
  }
});

router.get('/:id/backlinks', async (req: Request, res: Response) => {
  try {
    const links = await prisma.pageLink.findMany({
      where: { targetId: req.params.id },
      include: { source: { select: { id: true, title: true, icon: true } } },
    });
    res.json(links.map((l) => l.source));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch backlinks' });
  }
});

router.get('/:id/revisions', async (req: Request, res: Response) => {
  try {
    const revisions = await prisma.pageRevision.findMany({
      where: { pageId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json(revisions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch revisions' });
  }
});

router.post('/:id/revisions/:revisionId/restore', async (req: Request, res: Response) => {
  try {
    const page = await prisma.page.findUnique({ where: { id: req.params.id } });
    const revision = await prisma.pageRevision.findUnique({ where: { id: req.params.revisionId } });
    if (!page || !revision || revision.pageId !== page.id) {
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

    const revJson = revision.content;
    if (revJson && typeof revJson === 'object' && !Array.isArray(revJson)) {
      await syncPageLinks(page.id, revJson as Record<string, unknown>);
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore revision' });
  }
});

router.delete('/:id/revisions/:revisionId', async (req: Request, res: Response) => {
  try {
    const revision = await prisma.pageRevision.findUnique({ where: { id: req.params.revisionId } });
    if (!revision || revision.pageId !== req.params.id) {
      return res.status(404).json({ error: 'Revision not found' });
    }
    await prisma.pageRevision.delete({ where: { id: req.params.revisionId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete revision' });
  }
});

router.get('/:id/comments', async (req: Request, res: Response) => {
  try {
    const comments = await prisma.comment.findMany({
      where: { pageId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

router.post('/:id/comments', async (req: Request, res: Response) => {
  try {
    const { text, blockId } = req.body;
    
    // Validate text
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Comment text is required' });
    }
    
    const trimmedText = String(text).trim();
    if (trimmedText.length > 5000) {
      return res.status(400).json({ error: 'Comment text too long (max 5000 characters)' });
    }
    
    // Validate blockId format if provided
    let validatedBlockId = '';
    if (blockId) {
      if (typeof blockId !== 'string') {
        return res.status(400).json({ error: 'Invalid blockId format' });
      }
      // Only alphanumeric, hyphens, underscores
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(blockId)) {
        return res.status(400).json({ error: 'Invalid blockId format' });
      }
      validatedBlockId = blockId;
    }
    
    // SECURITY: NEVER trust authorId from client
    // Always use hardcoded "Вы" as author
    // In future with authentication, use req.user.id or req.user.name
    const comment = await prisma.comment.create({
      data: {
        pageId: req.params.id,
        text: trimmedText,
        authorId: 'Вы', // Hardcoded - prevents impersonation
        blockId: validatedBlockId,
      },
    });
    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// исходящие ссылки на другие страницы вытаскиваем из prosemirror-json и пишем в page_link
async function syncPageLinks(sourceId: string, content: Record<string, unknown>): Promise<void> {
  const targetIds = extractPageLinks(content);

  await prisma.pageLink.deleteMany({ where: { sourceId } });

  if (targetIds.length > 0) {
    await prisma.pageLink.createMany({
      data: targetIds.map((targetId) => ({ sourceId, targetId })),
      skipDuplicates: true,
    });
  }
}

/**
 * SECURITY: Extract page links with protection against:
 * - Stack overflow from deep recursion
 * - Exponential time complexity from circular references
 * - Memory exhaustion from huge result sets
 */
interface ExtractLinksContext {
  ids: Set<string>;
  depth: number;
  maxDepth: number;
  maxResults: number;
  visited: WeakSet<object>;
}

function extractPageLinks(node: unknown): string[] {
  const context: ExtractLinksContext = {
    ids: new Set(),
    depth: 0,
    maxDepth: 100, // Prevent stack overflow
    maxResults: 1000, // Limit result size
    visited: new WeakSet(),
  };

  extractPageLinksRecursive(node, context);
  return Array.from(context.ids);
}

function extractPageLinksRecursive(node: unknown, context: ExtractLinksContext): void {
  // Stop if we've hit depth limit (prevent stack overflow)
  if (context.depth > context.maxDepth) {
    console.warn('[Security] extractPageLinks: max depth exceeded, stopping recursion');
    return;
  }

  // Stop if we've hit result limit (prevent memory exhaustion)
  if (context.ids.size >= context.maxResults) {
    console.warn('[Security] extractPageLinks: max results limit reached');
    return;
  }

  if (!node) return;

  // Protect against circular references and revisiting
  if (typeof node === 'object' && node !== null) {
    if (context.visited.has(node as object)) {
      return;
    }
    context.visited.add(node as object);
  }

  // Type assertions for object iteration
  const nodeObj = node as Record<string, unknown>;

  // Extract pageId if this is a pageLink node
  if (nodeObj.type === 'pageLink' && typeof nodeObj.attrs === 'object' && nodeObj.attrs !== null) {
    const attrs = nodeObj.attrs as Record<string, unknown>;
    if (typeof attrs.pageId === 'string') {
      context.ids.add(attrs.pageId);
    }
  }

  // Recurse into content array
  if (Array.isArray(nodeObj.content)) {
    context.depth++;
    for (const child of nodeObj.content) {
      if (context.ids.size >= context.maxResults) break;
      extractPageLinksRecursive(child, context);
    }
    context.depth--;
  }
}

export default router;

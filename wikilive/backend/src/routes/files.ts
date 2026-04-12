import { Router, Request, Response } from 'express';
import express from 'express';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../index';
import { requireAuth } from '../middleware/requireAuth';
import { validateViewType, validateViewName, validateJsonContent } from '../middleware/validators';

const router = Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
]);

const STATIC_NAME_RE = /^[a-zA-Z0-9.-]+$/;

function sniffImageMime(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  const head = data.slice(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  return null;
}

function extToContentType(ext: string): string {
  const e = ext.toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  if (e === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

/** Разбор multipart/form-data без внешних пакетов: одно поле `image`. */
function extractImageFromMultipart(body: Buffer, contentType: string): { data: Buffer; mime: string } | null {
  const m = contentType.match(/\bboundary=(?:"([^"]+)"|([^;\s,]+))/i);
  if (!m) return null;
  const rawBoundary = m[1] ?? m[2];
  if (!rawBoundary) return null;
  const boundary = rawBoundary.trim().replace(/^["']|["']$/g, '');
  if (!boundary) return null;

  const boundaryLine = Buffer.from(`--${boundary}`, 'utf8');
  const parts: Buffer[] = [];
  let searchFrom = 0;
  while (true) {
    const i = body.indexOf(boundaryLine, searchFrom);
    if (i === -1) break;
    const after = i + boundaryLine.length;
    if (after + 1 < body.length && body[after] === 0x2d && body[after + 1] === 0x2d) {
      break;
    }
    let partStart = after;
    if (body[partStart] === 0x0d && body[partStart + 1] === 0x0a) partStart += 2;
    else if (body[partStart] === 0x0a) partStart += 1;
    const next = body.indexOf(boundaryLine, partStart);
    if (next === -1) {
      parts.push(body.slice(partStart));
      break;
    }
    let partEnd = next;
    if (partEnd >= 2 && body[partEnd - 2] === 0x0d && body[partEnd - 1] === 0x0a) partEnd -= 2;
    parts.push(body.slice(partStart, partEnd));
    searchFrom = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const headersStr = part.slice(0, headerEnd).toString('utf8');
    const isImageField =
      /\bname="image"/i.test(headersStr) ||
      /\bname='image'/i.test(headersStr) ||
      /\bname=\s*image\b/i.test(headersStr);
    if (!isImageField) continue;
    const data = part.slice(headerEnd + 4);
    const ctMatch = headersStr.match(/Content-Type:\s*([^\s;]+)/i);
    const mime = (ctMatch?.[1] ?? '').trim().toLowerCase();
    return { data, mime };
  }

  return null;
}

router.get('/static/:filename', requireAuth, async (req: Request, res: Response) => {
  try {
    const filename = req.params.filename ?? '';
    if (!STATIC_NAME_RE.test(filename) || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const resolved = path.resolve(UPLOAD_DIR, filename);
    const rootResolved = path.resolve(UPLOAD_DIR);
    if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat || !stat.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(filename);
    const buf = await fs.readFile(resolved);
    res.setHeader('Content-Type', extToContentType(ext));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  } catch {
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

router.use(requireAuth);

router.post(
  '/upload',
  express.raw({
    limit: `${MAX_IMAGE_BYTES + 256 * 1024}`,
    type: (req) => String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data'),
  }),
  async (req: Request, res: Response) => {
    try {
      const ct = String(req.headers['content-type'] || '');
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: 'Expected multipart body' });
      }

      const extracted = extractImageFromMultipart(body, ct);
      if (!extracted || extracted.data.length === 0) {
        return res.status(400).json({ error: 'Missing image field' });
      }

      if (extracted.data.length > MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: 'File too large (max 5 MB)' });
      }

      const sniffed = sniffImageMime(extracted.data);
      const mime = (sniffed || extracted.mime || 'application/octet-stream').toLowerCase();
      const ext = ALLOWED_MIME.get(mime);
      if (!ext) {
        return res.status(400).json({ error: 'Only JPG, PNG and GIF are allowed' });
      }

      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      const basename = `${randomUUID()}${ext}`;
      const dest = path.join(UPLOAD_DIR, basename);
      await fs.writeFile(dest, extracted.data);

      res.json({ url: `/api/files/static/${basename}` });
    } catch {
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

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

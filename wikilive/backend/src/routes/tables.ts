import { Router, Request, Response } from 'express';
import { getMwsHeaders, mwsAuth } from '../middleware/mwsAuth';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);
router.use(mwsAuth);

interface MwsSpaceItem {
  id?: string;
  spaceId?: string;
  name?: string;
}

interface MwsSpacesResponse {
  data?: { spaces?: MwsSpaceItem[] };
  spaces?: MwsSpaceItem[];
  [key: string]: unknown;
}

interface MwsNodesListResponse {
  data?: { nodes?: Record<string, unknown>[] };
  nodes?: Record<string, unknown>[];
  [key: string]: unknown;
}

const BASE_URL = () => process.env.MWS_TABLES_BASE_URL || 'https://tables.mws.ru';

const MAX_BODY_SIZE = 100_000;

function validateRecordsBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  if (!Array.isArray(obj.records)) return null;
  if (obj.records.length > 1000) return null;
  try {
    const serialized = JSON.stringify(obj);
    if (serialized.length > MAX_BODY_SIZE) return null;
  } catch {
    return null;
  }
  // только разрешённые ключи
  const allowedKeys = new Set(['records', 'fieldKey', 'viewId']);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) return null;
  }
  return obj;
}

function validateCreateDatasheetBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  try {
    const serialized = JSON.stringify(obj);
    if (serialized.length > MAX_BODY_SIZE) return null;
  } catch {
    return null;
  }
  const allowedKeys = new Set(['name', 'description', 'fields', 'records', 'views']);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) return null;
  }
  return obj;
}

function validateFieldsBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  if (!Array.isArray(obj.fields)) return null;
  if (obj.fields.length > 200) return null;
  try {
    const serialized = JSON.stringify(obj);
    if (serialized.length > MAX_BODY_SIZE) return null;
  } catch {
    return null;
  }
  const allowedKeys = new Set(['fields', 'fieldKey']);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) return null;
  }
  return obj;
}

function validateNodeUpdateBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  try {
    const serialized = JSON.stringify(obj);
    if (serialized.length > MAX_BODY_SIZE) return null;
  } catch {
    return null;
  }
  const allowedKeys = new Set(['name', 'title', 'description', 'content']);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) return null;
  }
  return obj;
}

function validateDstId(dstId: unknown): string | null {
  if (typeof dstId !== 'string') return null;
  if (!/^dst[a-zA-Z0-9]{10,}$/.test(dstId)) return null;
  return dstId;
}

function validateSpaceId(spaceId: unknown): string | null {
  if (typeof spaceId !== 'string') return null;
  if (!/^[a-zA-Z]{2,4}[a-zA-Z0-9]{10,}$/.test(spaceId)) return null;
  return spaceId;
}

function validateNodeId(nodeId: unknown): string | null {
  if (typeof nodeId !== 'string') return null;
  if (!/^[a-zA-Z]{2,4}[a-zA-Z0-9]{10,}$/.test(nodeId)) return null;
  return nodeId;
}

function validateStringParam(param: unknown, maxLength: number = 100): string | null {
  if (typeof param !== 'string') return null;
  const trimmed = param.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  if (!/^[a-zA-Z0-9_-]{1,}$/.test(trimmed)) return null;
  return trimmed;
}

function validateNumericParam(param: unknown, max: number = 1000): number | null {
  if (typeof param === 'string') {
    const num = parseInt(param, 10);
    if (isNaN(num) || num < 1 || num > max) return null;
    return num;
  }
  return null;
}

async function findNodeViaSpaces(nodeId: string): Promise<Record<string, unknown> | null> {
  const spacesResp = await fetch(`${BASE_URL()}/fusion/v1/spaces`, {
    headers: getMwsHeaders(),
  });
  if (!spacesResp.ok) return null;

  const spacesJson = await spacesResp.json().catch((): MwsSpacesResponse => ({})) as MwsSpacesResponse;
  const spaces: MwsSpaceItem[] = spacesJson?.data?.spaces || spacesJson?.spaces || [];

  for (const space of spaces) {
    const spaceId = validateSpaceId(space.id || space.spaceId);
    if (!spaceId) continue;

    const nodesResp = await fetch(
      `${BASE_URL()}/fusion/v1/spaces/${encodeURIComponent(spaceId)}/nodes`,
      { headers: getMwsHeaders() }
    );
    if (!nodesResp.ok) continue;

    const nodesJson = await nodesResp.json().catch((): MwsNodesListResponse => ({})) as MwsNodesListResponse;
    const nodes = nodesJson?.data?.nodes || nodesJson?.nodes || [];
    const found = nodes.find((node) => {
      const record = node as Record<string, unknown>;
      return record.id === nodeId || record.nodeId === nodeId;
    });

    if (found) {
      return {
        ...(found as Record<string, unknown>),
        spaceId,
      };
    }
  }

  return null;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    let spaceId = process.env.MWS_TABLES_SPACE_ID;

    // автодискавери: берём первый спейс если не задан
    if (!spaceId) {
      const spacesResp = await fetch(`${BASE_URL()}/fusion/v1/spaces`, {
        headers: getMwsHeaders(),
      });
      const spacesJson = await spacesResp.json().catch((): MwsSpacesResponse => ({})) as MwsSpacesResponse;
      if (!spacesResp.ok) {
        return res.status(spacesResp.status).json(spacesJson || { error: 'Failed to fetch spaces' });
      }
      const spaces: MwsSpaceItem[] = spacesJson?.data?.spaces || spacesJson?.spaces || [];
      const firstId = spaces[0]?.id || spaces[0]?.spaceId;
      const validFirstId = validateSpaceId(firstId);
      if (!validFirstId) {
        return res.status(404).json({ error: 'No MWS spaces available' });
      }
      spaceId = validFirstId;
    } else {
      const validSpaceId = validateSpaceId(spaceId);
      if (!validSpaceId) {
        return res.status(500).json({ error: 'MWS_TABLES_SPACE_ID has invalid format' });
      }
      spaceId = validSpaceId;
    }

    const includeAll = req.query.includeAll === '1' || req.query.includeAll === 'true';
    const qs = includeAll ? '' : '?type=Datasheet';
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/spaces/${encodeURIComponent(spaceId)}/nodes${qs}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to fetch tables' });
  }
});

router.get('/:dstId/fields', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/fields`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to fetch fields' });
  }
});

router.get('/:dstId/records', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const params = new URLSearchParams();
    const pageSize = validateNumericParam(req.query.pageSize, 500);
    const fieldKey = validateStringParam(req.query.fieldKey);
    if (req.query.pageSize && pageSize === null) {
      return res.status(400).json({ error: 'Invalid pageSize' });
    }
    if (req.query.fieldKey && fieldKey === null) {
      return res.status(400).json({ error: 'Invalid fieldKey' });
    }
    if (pageSize !== null) params.set('pageSize', pageSize.toString());
    if (fieldKey !== null) params.set('fieldKey', fieldKey);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/records${qs}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to fetch records' });
  }
});

router.patch('/:dstId/records', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const validatedBody = validateRecordsBody(req.body);
    if (!validatedBody) {
      return res.status(400).json({ error: 'Invalid request body: must contain records array with allowed keys only' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/records`,
      {
        method: 'PATCH',
        headers: getMwsHeaders(),
        body: JSON.stringify(validatedBody),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to update records' });
  }
});

router.get('/spaces', async (_req: Request, res: Response) => {
  try {
    const resp = await fetch(`${BASE_URL()}/fusion/v1/spaces`, {
      headers: getMwsHeaders(),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to fetch spaces from MWS Tables' });
  }
});

router.get('/spaces/:spaceId/nodes', async (req: Request, res: Response) => {
  try {
    const spaceId = validateSpaceId(req.params.spaceId);
    if (!spaceId) {
      return res.status(400).json({ error: 'Invalid space ID format' });
    }
    const queryStr = req.query.type 
      ? `?type=${encodeURIComponent(validateStringParam(req.query.type) || '')}`
      : '';
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/spaces/${encodeURIComponent(spaceId)}/nodes${queryStr}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to fetch nodes' });
  }
});

router.get('/nodes/:nodeId', async (req: Request, res: Response) => {
  try {
    const nodeId = validateNodeId(req.params.nodeId);
    if (!nodeId) {
      return res.status(400).json({ error: 'Invalid node ID format' });
    }
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/nodes/${encodeURIComponent(nodeId)}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json().catch(() => ({}));

    if (resp.status === 403) {
      const fallbackNode = await findNodeViaSpaces(nodeId);
      if (fallbackNode) {
        return res.json({
          accessLimited: true,
          data: {
            node: fallbackNode,
          },
        });
      }
    }

    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to fetch node details' });
  }
});

router.patch('/nodes/:nodeId', async (req: Request, res: Response) => {
  try {
    const nodeId = validateNodeId(req.params.nodeId);
    if (!nodeId) {
      return res.status(400).json({ error: 'Invalid node ID format' });
    }
    const validatedBody = validateNodeUpdateBody(req.body);
    if (!validatedBody) {
      return res.status(400).json({ error: 'Invalid node update body' });
    }

    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: 'PATCH',
        headers: getMwsHeaders(),
        body: JSON.stringify(validatedBody),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to update node' });
  }
});

router.get('/datasheets/:dstId/records', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }

    const params = new URLSearchParams();
    const pageSize = validateNumericParam(req.query.pageSize, 500);
    const pageNum = validateNumericParam(req.query.pageNum, 10000);
    const viewId = validateStringParam(req.query.viewId);
    const fieldKey = validateStringParam(req.query.fieldKey);
    
    if (pageSize) params.set('pageSize', pageSize.toString());
    if (pageNum) params.set('pageNum', pageNum.toString());
    if (viewId) params.set('viewId', viewId);
    if (fieldKey) params.set('fieldKey', fieldKey);

    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/records${qs}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to fetch records' });
  }
});

router.post('/datasheets/:dstId/records', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const validatedBody = validateRecordsBody(req.body);
    if (!validatedBody) {
      return res.status(400).json({ error: 'Invalid request body: must contain records array with allowed keys only' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/records`,
      {
        method: 'POST',
        headers: getMwsHeaders(),
        body: JSON.stringify(validatedBody),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to create records' });
  }
});

router.patch('/datasheets/:dstId/records', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const validatedBody = validateRecordsBody(req.body);
    if (!validatedBody) {
      return res.status(400).json({ error: 'Invalid request body: must contain records array with allowed keys only' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/records`,
      {
        method: 'PATCH',
        headers: getMwsHeaders(),
        body: JSON.stringify(validatedBody),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to update records' });
  }
});

router.delete('/datasheets/:dstId/records', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }

    const recordIds = req.query.recordIds as string;
    if (!recordIds || !/^[a-zA-Z0-9,_-]+$/.test(recordIds)) {
      return res.status(400).json({ error: 'Invalid record IDs format' });
    }
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/records?recordIds=${encodeURIComponent(recordIds)}`,
      {
        method: 'DELETE',
        headers: getMwsHeaders(),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to delete records' });
  }
});

router.get('/datasheets/:dstId/fields', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }

    const viewId = validateStringParam(req.query.viewId);
    const qs = viewId ? `?viewId=${encodeURIComponent(viewId)}` : '';
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/fields${qs}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to fetch fields' });
  }
});

router.patch('/datasheets/:dstId/fields', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const validatedBody = validateFieldsBody(req.body);
    if (!validatedBody) {
      return res.status(400).json({ error: 'Invalid request body: must contain fields array with allowed keys only' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/fields`,
      {
        method: 'PATCH',
        headers: getMwsHeaders(),
        body: JSON.stringify(validatedBody),
      }
    );
    const data = await resp.json().catch(() => ({}));
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to update fields' });
  }
});

router.get('/datasheets/:dstId/views', async (req: Request, res: Response) => {
  try {
    const dstId = validateDstId(req.params.dstId);
    if (!dstId) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/views`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to fetch views' });
  }
});

router.post('/spaces/:spaceId/datasheets', async (req: Request, res: Response) => {
  try {
    const spaceId = validateSpaceId(req.params.spaceId);
    if (!spaceId) {
      return res.status(400).json({ error: 'Invalid space ID format' });
    }
    const validatedBody = validateCreateDatasheetBody(req.body);
    if (!validatedBody) {
      return res.status(400).json({ error: 'Invalid request body: only name, description, fields, records, views allowed' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/spaces/${encodeURIComponent(spaceId)}/datasheets`,
      {
        method: 'POST',
        headers: getMwsHeaders(),
        body: JSON.stringify(validatedBody),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Failed to create datasheet' });
  }
});

export default router;

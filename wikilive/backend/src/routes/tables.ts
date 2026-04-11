import { Router, Request, Response } from 'express';
import { getMwsHeaders, mwsAuth } from '../middleware/mwsAuth';

const router = Router();
router.use(mwsAuth);

const BASE_URL = () => process.env.MWS_TABLES_BASE_URL || 'https://tables.mws.ru';

function validateDstId(dstId: unknown): boolean {
  if (typeof dstId !== 'string') return false;
  return /^dst[a-zA-Z0-9]{10,}$/.test(dstId);
}

function validateSpaceId(spaceId: unknown): boolean {
  if (typeof spaceId !== 'string') return false;
  return /^[a-zA-Z]{2,4}[a-zA-Z0-9]{10,}$/.test(spaceId);
}

function validateNodeId(nodeId: unknown): boolean {
  if (typeof nodeId !== 'string') return false;
  return /^[a-zA-Z]{2,4}[a-zA-Z0-9]{10,}$/.test(nodeId);
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

router.get('/', async (_req: Request, res: Response) => {
  try {
    const spaceId = process.env.MWS_TABLES_SPACE_ID;
    if (!spaceId) {
      return res.status(500).json({ error: 'MWS_TABLES_SPACE_ID not configured' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/spaces/${spaceId}/nodes?type=Datasheet`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch tables' });
  }
});

router.get('/:dstId/fields', async (req: Request, res: Response) => {
  try {
    const { dstId } = req.params;
    if (!validateDstId(dstId)) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${dstId}/fields`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch fields' });
  }
});

router.get('/:dstId/records', async (req: Request, res: Response) => {
  try {
    const { dstId } = req.params;
    if (!validateDstId(dstId)) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const params = new URLSearchParams();
    if (req.query.pageSize) params.set('pageSize', req.query.pageSize as string);
    if (req.query.fieldKey) params.set('fieldKey', req.query.fieldKey as string);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${dstId}/records${qs}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch records' });
  }
});

router.patch('/:dstId/records', async (req: Request, res: Response) => {
  try {
    const { dstId } = req.params;
    if (!validateDstId(dstId)) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${dstId}/records`,
      {
        method: 'PATCH',
        headers: getMwsHeaders(),
        body: JSON.stringify(req.body),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
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
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch spaces from MWS Tables' });
  }
});

// Get nodes in a space - PROTECTED
router.get('/spaces/:spaceId/nodes', async (req: Request, res: Response) => {
  try {
    const { spaceId } = req.params;
    
    // Validate spaceId
    if (!validateSpaceId(spaceId)) {
      return res.status(400).json({ error: 'Invalid space ID format' });
    }
    
    // Validate optional query params
    const queryStr = req.query.type 
      ? `?type=${encodeURIComponent(validateStringParam(req.query.type) || '')}`
      : '';
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/spaces/${encodeURIComponent(spaceId)}/nodes${queryStr}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch nodes' });
  }
});

// Get node details - PROTECTED
router.get('/nodes/:nodeId', async (req: Request, res: Response) => {
  try {
    const { nodeId } = req.params;
    
    // Validate nodeId
    if (!validateNodeId(nodeId)) {
      return res.status(400).json({ error: 'Invalid node ID format' });
    }
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/nodes/${encodeURIComponent(nodeId)}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch node details' });
  }
});

// Get records from a datasheet - PROTECTED
router.get('/datasheets/:dstId/records', async (req: Request, res: Response) => {
  try {
    const { dstId } = req.params;
    
    // Validate dstId
    if (!validateDstId(dstId)) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    
    // Validate and limit query params
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
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch records' });
  }
});

// Create records - PROTECTED
router.post('/datasheets/:dstId/records', async (req: Request, res: Response) => {
  try {
    const { dstId } = req.params;
    
    // Validate dstId
    if (!validateDstId(dstId)) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/records`,
      {
        method: 'POST',
        headers: getMwsHeaders(),
        body: JSON.stringify(req.body),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to create records' });
  }
});

// Update records (PATCH) - PROTECTED
router.patch('/datasheets/:dstId/records', async (req: Request, res: Response) => {
  try {
    const { dstId } = req.params;
    
    // Validate dstId
    if (!validateDstId(dstId)) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/records`,
      {
        method: 'PATCH',
        headers: getMwsHeaders(),
        body: JSON.stringify(req.body),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to update records' });
  }
});

// Delete records - PROTECTED (critical - encodeURIComponent for recordIds)
router.delete('/datasheets/:dstId/records', async (req: Request, res: Response) => {
  try {
    const { dstId } = req.params;
    
    // Validate dstId
    if (!validateDstId(dstId)) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    
    // Validate recordIds - must be comma-separated alphanumeric
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
  } catch (err) {
    res.status(502).json({ error: 'Failed to delete records' });
  }
});

// Get fields of a datasheet - PROTECTED
router.get('/datasheets/:dstId/fields', async (req: Request, res: Response) => {
  try {
    const { dstId } = req.params;
    
    // Validate dstId
    if (!validateDstId(dstId)) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    
    // Validate viewId if provided
    const viewId = validateStringParam(req.query.viewId);
    const qs = viewId ? `?viewId=${encodeURIComponent(viewId)}` : '';
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/fields${qs}`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch fields' });
  }
});

// Get views of a datasheet - PROTECTED
router.get('/datasheets/:dstId/views', async (req: Request, res: Response) => {
  try {
    const { dstId } = req.params;
    
    // Validate dstId
    if (!validateDstId(dstId)) {
      return res.status(400).json({ error: 'Invalid datasheet ID format' });
    }
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/datasheets/${encodeURIComponent(dstId)}/views`,
      { headers: getMwsHeaders() }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch views' });
  }
});

// Create datasheet - PROTECTED
router.post('/spaces/:spaceId/datasheets', async (req: Request, res: Response) => {
  try {
    const { spaceId } = req.params;
    
    // Validate spaceId
    if (!validateSpaceId(spaceId)) {
      return res.status(400).json({ error: 'Invalid space ID format' });
    }
    
    const resp = await fetch(
      `${BASE_URL()}/fusion/v1/spaces/${encodeURIComponent(spaceId)}/datasheets`,
      {
        method: 'POST',
        headers: getMwsHeaders(),
        body: JSON.stringify(req.body),
      }
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to create datasheet' });
  }
});

export default router;

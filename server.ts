import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'crypto';
import dotenv from 'dotenv';
import {
  initDatabaseSchema,
  testConnection,
  getItems,
  createItem,
  deleteItem,
} from './server/db.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';
const apiKey = process.env.HINGA_API_KEY;

app.use(express.json({ limit: '32kb' }));

function safeError(res: Response, status: number, code: string, error: unknown): void {
  console.error(`[${code}]`, error instanceof Error ? error.name : 'unknown_error');
  res.status(status).json({ success: false, error: code });
}

function requireApiKey(req: Request, res: Response, next: () => void): void {
  if (!isProduction) return next();
  if (!apiKey) {
    res.status(503).json({ success: false, error: 'api_not_configured' });
    return;
  }
  const supplied = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expected = Buffer.from(apiKey);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.status(401).json({ success: false, error: 'unauthorized' });
    return;
  }
  next();
}

app.use('/api', requireApiKey);

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const health = await testConnection();
    res.json(health);
  } catch (error: unknown) {
    safeError(res, 503, 'database_unavailable', error);
  }
});

app.get('/api/items', async (_req: Request, res: Response) => {
  try {
    const items = await getItems();
    res.json({ success: true, items });
  } catch (error: unknown) {
    safeError(res, 500, 'items_unavailable', error);
  }
});

app.post('/api/items', async (req: Request, res: Response) => {
  try {
    const { title, description } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
      res.status(400).json({ success: false, error: 'invalid_title' });
      return;
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 2_000)) {
      res.status(400).json({ success: false, error: 'invalid_description' });
      return;
    }
    const item = await createItem(title.trim(), typeof description === 'string' ? description.trim() : undefined);
    res.status(201).json({ success: true, item });
  } catch (error: unknown) {
    safeError(res, 500, 'item_creation_failed', error);
  }
});

app.delete('/api/items/:id', async (req: Request, res: Response) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      res.status(400).json({ success: false, error: 'invalid_id' });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ success: false, error: 'invalid_id' });
      return;
    }
    const deleted = await deleteItem(id);
    res.json({ success: true, deleted });
  } catch (error: unknown) {
    safeError(res, 500, 'item_deletion_failed', error);
  }
});

app.post('/api/seed', async (_req: Request, res: Response) => {
  if (isProduction) {
    res.status(404).json({ success: false, error: 'not_found' });
    return;
  }
  try {
    const samples = [
      { title: 'Karibu Neon Postgres', description: 'Hifadhidata ya kisasa ya Postgres kwenye Neon cloud' },
      { title: 'Tawi la Uzalishaji (Production)', description: 'Tawi: production (falling-moon-75342440)' },
      { title: 'Muunganisho wa Haraka (Pooled Connection)', description: 'Inatumia kiunganishi cha PgBouncer kwa kasi ya juu' },
    ];
    const results = [];
    for (const sample of samples) results.push(await createItem(sample.title, sample.description));
    res.json({ success: true, count: results.length, items: results });
  } catch (error: unknown) {
    safeError(res, 500, 'seed_failed', error);
  }
});

async function startServer() {
  if (isProduction && !apiKey) {
    throw new Error('HINGA_API_KEY lazima iwekwe kabla ya kuanzisha production API');
  }
  try {
    console.log('Kuunganisha na kuanzisha jedwali kwenye Neon Postgres...');
    await initDatabaseSchema();
    console.log('Jedwali la Neon Postgres (neon_items) lipo tayari.');
  } catch (error: unknown) {
    console.error('[database_initialization_failed]', error instanceof Error ? error.name : 'unknown_error');
    if (isProduction) throw error;
  }

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server inafanya kazi kwenye http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error: unknown) => {
  console.error('[server_start_failed]', error instanceof Error ? error.message : 'unknown_error');
  process.exitCode = 1;
});

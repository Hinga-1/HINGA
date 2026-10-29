import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { 
  initDatabaseSchema, 
  testConnection, 
  getItems, 
  createItem, 
  deleteItem 
} from './server/db.ts';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// API Routes
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const health = await testConnection();
    res.json(health);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ status: 'error', error: message });
  }
});

app.get('/api/items', async (_req: Request, res: Response) => {
  try {
    const items = await getItems();
    res.json({ success: true, items });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

app.post('/api/items', async (req: Request, res: Response) => {
  try {
    const { title, description } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Kichwa cha habari (title) kinahitajika' });
    }
    const item = await createItem(title.trim(), description?.trim());
    res.status(201).json({ success: true, item });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

app.delete('/api/items/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'ID isiyo sahihi' });
    }
    const deleted = await deleteItem(id);
    res.json({ success: true, deleted });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

app.post('/api/seed', async (_req: Request, res: Response) => {
  try {
    const samples = [
      { title: 'Karibu Neon Postgres', description: 'Hifadhidata ya kisasa ya Postgres kwenye Neon cloud' },
      { title: 'Tawi la Uzalishaji (Production)', description: 'Tawi: production (falling-moon-75342440)' },
      { title: 'Muunganisho wa Haraka (Pooled Connection)', description: 'Inatumia kiunganishi cha PgBouncer kwa kasi ya juu' },
    ];

    const results = [];
    for (const sample of samples) {
      const item = await createItem(sample.title, sample.description);
      results.push(item);
    }
    res.json({ success: true, count: results.length, items: results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// Server initialization & Vite middleware setup
async function startServer() {
  try {
    console.log('🔄 Kuunganisha na kuanzisha jedwali kwenye Neon Postgres...');
    await initDatabaseSchema();
    console.log('✅ Jedwali la Neon Postgres (neon_items) lipo tayari!');
  } catch (err) {
    console.error('⚠️ Hitilafu wakati wa kuanzisha jedwali:', err);
  }

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server inafanya kazi kwenye http://0.0.0.0:${PORT}`);
  });
}

startServer();

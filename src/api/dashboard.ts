import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { getDb } from '../db/schema';
import { getStats, getActiveProducts, getPendingApprovals, updateDecisionStatus } from '../db/queries';
import { getCronStatus } from '../scheduler/cron';
import { logger } from '../utils/logger';

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  // Serve dashboard HTML
  app.get('/dashboard', async (_req, reply) => {
    const htmlPath = path.join(__dirname, '../dashboard/public/index.html');
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      return reply.type('text/html').send(html);
    }
    return reply.type('text/html').send('<h1>Dashboard not built yet. Run: npm run build:dashboard</h1>');
  });

  // ─── Stats API ─────────────────────────────────────────────────────────

  app.get('/api/stats', async (_req, reply) => {
    try {
      const stats = getStats();
      const cronStatus = getCronStatus();
      return reply.send({ ...stats, cronJobs: cronStatus });
    } catch (err: unknown) {
      logger.error('Stats API error', { error: (err as Error).message });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Products API ───────────────────────────────────────────────────────

  app.get('/api/products', async (_req, reply) => {
    try {
      const products = getActiveProducts();
      return reply.send({ products, total: products.length });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  app.get('/api/products/profit', async (_req, reply) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT
          p.shopify_id,
          p.title,
          p.price,
          p.cost_price,
          p.category,
          COALESCE(p.price - p.cost_price, 0) AS profit_per_unit,
          CASE WHEN p.cost_price > 0 THEN ROUND(((p.price - p.cost_price) / p.price) * 100, 1) ELSE 0 END AS margin_pct,
          COUNT(DISTINCT o.id) AS estimated_sales,
          COALESCE(COUNT(DISTINCT o.id) * (p.price - COALESCE(p.cost_price, 0)), 0) AS estimated_profit
        FROM products p
        LEFT JOIN orders o ON o.raw_data LIKE '%' || p.shopify_id || '%'
        WHERE p.is_soft_deleted = 0 AND p.status = 'active'
        GROUP BY p.id
        ORDER BY estimated_profit DESC
      `).all();

      const totalRevenue = (db.prepare(`
        SELECT COALESCE(SUM(CAST(total_price AS REAL)), 0) as total FROM orders WHERE fulfillment_status != 'refunded'
      `).get() as { total: number }).total;

      return reply.send({ products: rows, totalRevenue });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ─── Orders API ─────────────────────────────────────────────────────────

  app.get('/api/orders', async (req, reply) => {
    try {
      const query = req.query as { limit?: string; status?: string };
      const limit = parseInt(query.limit ?? '50', 10);
      const db = getDb();

      let sql = 'SELECT * FROM orders';
      const params: unknown[] = [];
      if (query.status) {
        sql += ' WHERE fulfillment_status = ?';
        params.push(query.status);
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const orders = db.prepare(sql).all(...params);
      return reply.send({ orders, total: orders.length });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ─── AI Decisions API ──────────────────────────────────────────────────

  app.get('/api/decisions', async (req, reply) => {
    try {
      const query = req.query as { limit?: string; agent?: string };
      const limit = parseInt(query.limit ?? '50', 10);
      const db = getDb();

      let sql = 'SELECT * FROM ai_decisions';
      const params: unknown[] = [];
      if (query.agent) {
        sql += ' WHERE agent = ?';
        params.push(query.agent);
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const decisions = db.prepare(sql).all(...params);
      return reply.send({ decisions, total: decisions.length });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  app.get('/api/decisions/pending', async (_req, reply) => {
    try {
      const pending = getPendingApprovals();
      return reply.send({ decisions: pending, total: pending.length });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  app.post('/api/decisions/:id/approve', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      updateDecisionStatus(parseInt(id, 10), 'approved');
      logger.info(`Decision ${id} approved by human`);
      return reply.send({ success: true });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  app.post('/api/decisions/:id/reject', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      updateDecisionStatus(parseInt(id, 10), 'rejected');
      return reply.send({ success: true });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ─── Pricing History ───────────────────────────────────────────────────

  app.get('/api/pricing-history', async (req, reply) => {
    try {
      const query = req.query as { limit?: string };
      const limit = parseInt(query.limit ?? '100', 10);
      const db = getDb();
      const rows = db.prepare(`
        SELECT ph.*, p.title FROM pricing_history ph
        JOIN products p ON p.shopify_id = ph.shopify_id
        ORDER BY ph.changed_at DESC LIMIT ?
      `).all(limit);
      return reply.send({ history: rows });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ─── Marketing API ─────────────────────────────────────────────────────

  app.get('/api/marketing', async (req, reply) => {
    try {
      const query = req.query as { limit?: string };
      const limit = parseInt(query.limit ?? '50', 10);
      const db = getDb();
      const campaigns = db.prepare('SELECT * FROM marketing_campaigns ORDER BY created_at DESC LIMIT ?').all(limit);
      return reply.send({ campaigns });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  logger.info('Dashboard API routes registered');
}

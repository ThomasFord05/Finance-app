import { getDb } from './schema';

// ─── AI Decisions ──────────────────────────────────────────────────────────

export interface AiDecision {
  id?: number;
  agent: string;
  action: string;
  reasoning?: string;
  input_data?: string;
  output_data?: string;
  status?: string;
  requires_approval?: number;
  created_at?: string;
  executed_at?: string;
}

export function logDecision(decision: AiDecision): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO ai_decisions (agent, action, reasoning, input_data, output_data, status, requires_approval)
    VALUES (@agent, @action, @reasoning, @input_data, @output_data, @status, @requires_approval)
  `);
  const result = stmt.run({
    agent: decision.agent,
    action: decision.action,
    reasoning: decision.reasoning ?? null,
    input_data: decision.input_data ? JSON.stringify(decision.input_data) : null,
    output_data: decision.output_data ? JSON.stringify(decision.output_data) : null,
    status: decision.status ?? 'executed',
    requires_approval: decision.requires_approval ?? 0,
  });
  return result.lastInsertRowid as number;
}

export function updateDecisionStatus(id: number, status: string, output?: unknown): void {
  const db = getDb();
  db.prepare(`
    UPDATE ai_decisions SET status = ?, output_data = ?, executed_at = datetime('now') WHERE id = ?
  `).run(status, output ? JSON.stringify(output) : null, id);
}

export function getLastDecision(agent: string): AiDecision | null {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM ai_decisions WHERE agent = ? ORDER BY created_at DESC LIMIT 1
  `).get(agent) as AiDecision | null;
}

export function getPendingApprovals(): AiDecision[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM ai_decisions WHERE requires_approval = 1 AND status = 'pending_approval'
    ORDER BY created_at DESC
  `).all() as AiDecision[];
}

// ─── Products ──────────────────────────────────────────────────────────────

export interface ProductRecord {
  id?: number;
  shopify_id?: string;
  title: string;
  description?: string;
  price: number;
  cost_price?: number;
  vendor?: string;
  category?: string;
  tags?: string;
  target_audience?: string;
  source?: string;
  source_product_id?: string;
  status?: string;
}

export function upsertProduct(product: ProductRecord): number {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM products WHERE shopify_id = ?').get(product.shopify_id);
  if (existing) {
    db.prepare(`
      UPDATE products SET title=@title, price=@price, status=@status, updated_at=datetime('now')
      WHERE shopify_id=@shopify_id
    `).run(product);
    return (existing as { id: number }).id;
  }
  const result = db.prepare(`
    INSERT INTO products (shopify_id, title, description, price, cost_price, vendor, category, tags, target_audience, source, source_product_id, status)
    VALUES (@shopify_id, @title, @description, @price, @cost_price, @vendor, @category, @tags, @target_audience, @source, @source_product_id, @status)
  `).run({
    shopify_id: product.shopify_id ?? null,
    title: product.title,
    description: product.description ?? null,
    price: product.price,
    cost_price: product.cost_price ?? null,
    vendor: product.vendor ?? null,
    category: product.category ?? null,
    tags: product.tags ?? null,
    target_audience: product.target_audience ?? null,
    source: product.source ?? null,
    source_product_id: product.source_product_id ?? null,
    status: product.status ?? 'active',
  });
  return result.lastInsertRowid as number;
}

export function getActiveProducts(): ProductRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM products WHERE is_soft_deleted = 0 AND status = 'active'
    ORDER BY created_at DESC
  `).all() as ProductRecord[];
}

export function getProductByShopifyId(shopifyId: string): ProductRecord | null {
  const db = getDb();
  return db.prepare('SELECT * FROM products WHERE shopify_id = ?').get(shopifyId) as ProductRecord | null;
}

export function softDeleteProduct(shopifyId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE products SET is_soft_deleted = 1, status = 'archived', updated_at = datetime('now')
    WHERE shopify_id = ?
  `).run(shopifyId);
}

// ─── Pricing History ───────────────────────────────────────────────────────

export function logPriceChange(data: {
  product_id: number;
  shopify_id: string;
  old_price: number;
  new_price: number;
  reasoning?: string;
  competitor_prices?: unknown;
  sales_velocity?: number;
  ai_decision_id?: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO pricing_history (product_id, shopify_id, old_price, new_price, reasoning, competitor_prices, sales_velocity, ai_decision_id)
    VALUES (@product_id, @shopify_id, @old_price, @new_price, @reasoning, @competitor_prices, @sales_velocity, @ai_decision_id)
  `).run({
    ...data,
    competitor_prices: data.competitor_prices ? JSON.stringify(data.competitor_prices) : null,
    ai_decision_id: data.ai_decision_id ?? null,
  });
}

// ─── Orders ────────────────────────────────────────────────────────────────

export interface OrderRecord {
  shopify_order_id: string;
  shopify_order_number?: string;
  customer_email?: string;
  total_price?: number;
  fulfillment_status?: string;
  raw_data?: string;
}

export function upsertOrder(order: OrderRecord): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM orders WHERE shopify_order_id = ?').get(order.shopify_order_id);
  if (existing) {
    db.prepare(`
      UPDATE orders SET fulfillment_status=@fulfillment_status, updated_at=datetime('now')
      WHERE shopify_order_id=@shopify_order_id
    `).run(order);
  } else {
    db.prepare(`
      INSERT INTO orders (shopify_order_id, shopify_order_number, customer_email, total_price, fulfillment_status, raw_data)
      VALUES (@shopify_order_id, @shopify_order_number, @customer_email, @total_price, @fulfillment_status, @raw_data)
    `).run({
      shopify_order_id: order.shopify_order_id,
      shopify_order_number: order.shopify_order_number ?? null,
      customer_email: order.customer_email ?? null,
      total_price: order.total_price ?? null,
      fulfillment_status: order.fulfillment_status ?? 'pending',
      raw_data: order.raw_data ?? null,
    });
  }
}

export function updateOrderFulfillment(shopifyOrderId: string, data: {
  fulfillment_provider?: string;
  provider_order_id?: string;
  tracking_number?: string;
  tracking_url?: string;
  fulfillment_status?: string;
}): void {
  const db = getDb();
  const fields = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => `${k}=@${k}`)
    .join(', ');
  db.prepare(`UPDATE orders SET ${fields}, updated_at=datetime('now') WHERE shopify_order_id=@shopify_order_id`)
    .run({ ...data, shopify_order_id: shopifyOrderId });
}

export function getTodayOrderCount(): number {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM orders WHERE date(created_at) = date('now')
  `).get() as { count: number };
  return result.count;
}

// ─── Marketing ─────────────────────────────────────────────────────────────

export function logCampaign(data: {
  product_id?: number;
  shopify_id?: string;
  platform: string;
  campaign_type: string;
  headline?: string;
  body?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO marketing_campaigns (product_id, shopify_id, platform, campaign_type, headline, body, utm_source, utm_medium, utm_campaign, posted_at)
    VALUES (@product_id, @shopify_id, @platform, @campaign_type, @headline, @body, @utm_source, @utm_medium, @utm_campaign, datetime('now'))
  `).run({
    product_id: data.product_id ?? null,
    shopify_id: data.shopify_id ?? null,
    platform: data.platform,
    campaign_type: data.campaign_type,
    headline: data.headline ?? null,
    body: data.body ?? null,
    utm_source: data.utm_source ?? null,
    utm_medium: data.utm_medium ?? null,
    utm_campaign: data.utm_campaign ?? null,
  });
  return result.lastInsertRowid as number;
}

// ─── Stats ─────────────────────────────────────────────────────────────────

export function getStats(): {
  activeProducts: number;
  todayOrders: number;
  lastDecision: AiDecision | null;
  pendingApprovals: number;
} {
  const db = getDb();
  const activeProducts = (db.prepare('SELECT COUNT(*) as c FROM products WHERE is_soft_deleted=0 AND status="active"').get() as { c: number }).c;
  const todayOrders = getTodayOrderCount();
  const lastDecision = db.prepare('SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT 1').get() as AiDecision | null;
  const pendingApprovals = (db.prepare('SELECT COUNT(*) as c FROM ai_decisions WHERE requires_approval=1 AND status="pending_approval"').get() as { c: number }).c;
  return { activeProducts, todayOrders, lastDecision, pendingApprovals };
}

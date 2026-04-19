import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

const API_VERSION = '2024-01';
const RATE_LIMIT_DELAY_MS = 500; // conservative: 2 req/sec out of 40/sec limit

let shopifyClient: AxiosInstance;

function getClient(): AxiosInstance {
  if (!shopifyClient) {
    const storeUrl = process.env.SHOPIFY_STORE_URL;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!storeUrl || !accessToken) {
      throw new Error('Missing SHOPIFY_STORE_URL or SHOPIFY_ACCESS_TOKEN');
    }

    shopifyClient = axios.create({
      baseURL: `https://${storeUrl}/admin/api/${API_VERSION}`,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });

    shopifyClient.interceptors.response.use(
      res => res,
      async err => {
        if (err.response?.status === 429) {
          const retryAfter = parseInt(err.response.headers['retry-after'] ?? '2', 10);
          logger.warn(`Shopify rate limit hit. Waiting ${retryAfter}s`);
          await sleep(retryAfter * 1000);
          return shopifyClient(err.config);
        }
        throw err;
      }
    );
  }
  return shopifyClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Products ──────────────────────────────────────────────────────────────

export interface ShopifyProduct {
  id?: string;
  title: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status?: 'active' | 'archived' | 'draft';
  variants?: ShopifyVariant[];
  metafields?: ShopifyMetafield[];
  images?: Array<{ src: string; alt?: string }>;
}

export interface ShopifyVariant {
  price: string;
  sku?: string;
  inventory_quantity?: number;
  fulfillment_service?: string;
  requires_shipping?: boolean;
}

export interface ShopifyMetafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export async function createProduct(product: ShopifyProduct): Promise<ShopifyProduct> {
  const client = getClient();
  await sleep(RATE_LIMIT_DELAY_MS);

  const response = await client.post('/products.json', { product });
  logger.info(`Product created: ${product.title}`, { shopifyId: response.data.product.id });
  return response.data.product;
}

export async function updateProduct(productId: string, updates: Partial<ShopifyProduct>): Promise<ShopifyProduct> {
  const client = getClient();
  await sleep(RATE_LIMIT_DELAY_MS);

  const response = await client.put(`/products/${productId}.json`, { product: updates });
  return response.data.product;
}

export async function archiveProduct(productId: string): Promise<void> {
  await updateProduct(productId, { status: 'archived' });
  logger.info(`Product archived (soft delete): ${productId}`);
}

export async function listProducts(params?: {
  limit?: number;
  page_info?: string;
  status?: string;
}): Promise<ShopifyProduct[]> {
  const client = getClient();
  await sleep(RATE_LIMIT_DELAY_MS);

  const response = await client.get('/products.json', {
    params: { limit: params?.limit ?? 250, status: params?.status ?? 'active' },
  });
  return response.data.products;
}

// ─── Variants / Pricing ────────────────────────────────────────────────────

export async function updateVariantPrice(variantId: string, price: string): Promise<void> {
  const client = getClient();
  await sleep(RATE_LIMIT_DELAY_MS);

  await client.put(`/variants/${variantId}.json`, {
    variant: { id: variantId, price },
  });
  logger.info(`Variant price updated: ${variantId} → $${price}`);
}

// ─── Orders ────────────────────────────────────────────────────────────────

export interface ShopifyOrder {
  id: string;
  order_number: number;
  email: string;
  total_price: string;
  financial_status: string;
  fulfillment_status: string | null;
  line_items: Array<{
    id: string;
    product_id: string;
    variant_id: string;
    title: string;
    quantity: number;
    price: string;
    sku: string;
  }>;
  shipping_address: {
    first_name: string;
    last_name: string;
    address1: string;
    address2?: string;
    city: string;
    province: string;
    country: string;
    zip: string;
    phone?: string;
  };
  note?: string;
}

export async function getOrder(orderId: string): Promise<ShopifyOrder> {
  const client = getClient();
  const response = await client.get(`/orders/${orderId}.json`);
  return response.data.order;
}

export async function createFulfillment(orderId: string, data: {
  tracking_number: string;
  tracking_company?: string;
  tracking_url?: string;
  notify_customer?: boolean;
}): Promise<void> {
  const client = getClient();
  await sleep(RATE_LIMIT_DELAY_MS);

  await client.post(`/orders/${orderId}/fulfillments.json`, {
    fulfillment: {
      tracking_info: {
        number: data.tracking_number,
        company: data.tracking_company ?? 'Other',
        url: data.tracking_url,
      },
      notify_customer: data.notify_customer ?? true,
    },
  });
  logger.info(`Fulfillment created for order ${orderId}`, { tracking: data.tracking_number });
}

export async function createRefund(orderId: string, data: {
  amount: string;
  reason: string;
  note?: string;
}): Promise<void> {
  const client = getClient();
  await sleep(RATE_LIMIT_DELAY_MS);

  await client.post(`/orders/${orderId}/refunds.json`, {
    refund: {
      note: data.note ?? data.reason,
      transactions: [{
        kind: 'refund',
        amount: data.amount,
        gateway: 'manual',
      }],
    },
  });
  logger.info(`Refund created for order ${orderId}`, { amount: data.amount });
}

// ─── Collections ──────────────────────────────────────────────────────────

export async function getOrCreateCollection(title: string): Promise<string> {
  const client = getClient();
  await sleep(RATE_LIMIT_DELAY_MS);

  const listRes = await client.get('/custom_collections.json', { params: { title } });
  if (listRes.data.custom_collections.length > 0) {
    return listRes.data.custom_collections[0].id.toString();
  }

  const createRes = await client.post('/custom_collections.json', {
    custom_collection: { title, published: true },
  });
  return createRes.data.custom_collection.id.toString();
}

export async function addProductToCollection(collectionId: string, productId: string): Promise<void> {
  const client = getClient();
  await sleep(RATE_LIMIT_DELAY_MS);

  await client.post('/collects.json', {
    collect: { collection_id: collectionId, product_id: productId },
  });
}

// ─── Metafields ────────────────────────────────────────────────────────────

export async function setProductMetafield(productId: string, field: ShopifyMetafield): Promise<void> {
  const client = getClient();
  await sleep(RATE_LIMIT_DELAY_MS);

  await client.post(`/products/${productId}/metafields.json`, { metafield: field });
}

// ─── Sales Analytics ──────────────────────────────────────────────────────

export async function getOrdersForProduct(productId: string, days = 7): Promise<number> {
  const client = getClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const response = await client.get('/orders.json', {
    params: { status: 'any', created_at_min: since, limit: 250 },
  });

  const orders: ShopifyOrder[] = response.data.orders;
  return orders.reduce((count, order) => {
    const hasProduct = order.line_items.some(item => item.product_id === productId);
    return hasProduct ? count + 1 : count;
  }, 0);
}

export async function getProductWithVariants(productId: string): Promise<ShopifyProduct & { variants: ShopifyVariant[] }> {
  const client = getClient();
  const response = await client.get(`/products/${productId}.json`);
  return response.data.product;
}

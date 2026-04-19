import axios from 'axios';
import { callClaude, parseJsonFromClaude } from '../ai/claudeClient';
import { PRODUCT_DISCOVERY_SYSTEM } from '../ai/prompts';
import { createProduct, getOrCreateCollection, addProductToCollection, setProductMetafield } from '../shopify/client';
import { logDecision, upsertProduct } from '../db/queries';
import { logger } from '../utils/logger';

const MAX_AUTO_PRICE = parseFloat(process.env.MAX_PRODUCT_PRICE_AUTO ?? '500');

interface DiscoveredProduct {
  product_name: string;
  description: string;
  price: number;
  cost_estimate: number;
  target_audience: string;
  category: string;
  tags: string;
  trend_score: number;
  competition_level: 'low' | 'medium' | 'high';
  reasoning: string;
  source: string;
}

interface TrendData {
  source: string;
  products: Array<{ name: string; interest?: number; mentions?: number; price?: number; category?: string }>;
}

// ─── Data Sources ──────────────────────────────────────────────────────────

async function fetchSerpApiTrends(): Promise<TrendData> {
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    logger.warn('SERPAPI_KEY not set — skipping Google Trends');
    return { source: 'serpapi', products: [] };
  }

  try {
    const queries = ['trending products 2024', 'best selling dropship items', 'viral products online'];
    const results: Array<{ name: string; interest: number }> = [];

    for (const q of queries) {
      const res = await axios.get('https://serpapi.com/search', {
        params: { q, api_key: key, engine: 'google_trends', data_type: 'TIMESERIES' },
        timeout: 15_000,
      });

      const items: Array<{ query: string; value: number }> = res.data?.interest_over_time?.timeline_data
        ?.flatMap((d: { values: Array<{ query: string; value: number }> }) => d.values) ?? [];

      items.forEach(item => {
        results.push({ name: item.query, interest: item.value });
      });
    }

    return { source: 'serpapi_trends', products: results.slice(0, 20) };
  } catch (err: unknown) {
    logger.warn('SerpAPI trends fetch failed', { error: (err as Error).message });
    return { source: 'serpapi', products: [] };
  }
}

async function fetchCJDropshipping(): Promise<TrendData> {
  const key = process.env.CJ_DROPSHIPPING_API_KEY;
  if (!key) {
    logger.warn('CJ_DROPSHIPPING_API_KEY not set — skipping CJ catalog');
    return { source: 'cj_dropshipping', products: [] };
  }

  try {
    const res = await axios.get('https://developers.cjdropshipping.com/api2.0/v1/product/list', {
      headers: { 'CJ-Access-Token': key },
      params: { pageNum: 1, pageSize: 50, orderBy: 'SELLS', ascOrDesc: 'DESC' },
      timeout: 15_000,
    });

    const items = res.data?.data?.list ?? [];
    return {
      source: 'cj_dropshipping',
      products: items.map((p: { productNameEn: string; sellPrice: number; categoryName: string }) => ({
        name: p.productNameEn,
        price: p.sellPrice,
        category: p.categoryName,
      })),
    };
  } catch (err: unknown) {
    logger.warn('CJ Dropshipping fetch failed', { error: (err as Error).message });
    return { source: 'cj_dropshipping', products: [] };
  }
}

async function fetchRedditTrends(): Promise<TrendData> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT ?? 'autonomous-shopify-bot/1.0';

  if (!clientId || !clientSecret) {
    logger.warn('Reddit credentials not set — skipping Reddit');
    return { source: 'reddit', products: [] };
  }

  try {
    const tokenRes = await axios.post(
      'https://www.reddit.com/api/v1/access_token',
      'grant_type=client_credentials',
      {
        auth: { username: clientId, password: clientSecret },
        headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
      }
    );
    const token = tokenRes.data.access_token;

    const subreddits = ['entrepreneur', 'flipping', 'deals', 'ecommerce'];
    const posts: Array<{ name: string; mentions: number }> = [];

    for (const sub of subreddits) {
      const res = await axios.get(`https://oauth.reddit.com/r/${sub}/hot`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent },
        params: { limit: 25 },
        timeout: 10_000,
      });

      const items = res.data?.data?.children ?? [];
      items.forEach((child: { data: { title: string; score: number } }) => {
        posts.push({ name: child.data.title, mentions: child.data.score });
      });
    }

    return { source: 'reddit', products: posts.slice(0, 30) };
  } catch (err: unknown) {
    logger.warn('Reddit fetch failed', { error: (err as Error).message });
    return { source: 'reddit', products: [] };
  }
}

async function fetchTwitterTrends(): Promise<TrendData> {
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  if (!bearer) {
    logger.warn('TWITTER_BEARER_TOKEN not set — skipping Twitter');
    return { source: 'twitter', products: [] };
  }

  try {
    const hashtags = ['#trending', '#deals', '#musthave', '#viral', '#shopnow'];
    const tweets: Array<{ name: string; mentions: number }> = [];

    for (const tag of hashtags.slice(0, 2)) {
      const res = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
        headers: { Authorization: `Bearer ${bearer}` },
        params: {
          query: `${tag} -is:retweet lang:en`,
          max_results: 20,
          'tweet.fields': 'public_metrics',
        },
        timeout: 10_000,
      });

      const data = res.data?.data ?? [];
      data.forEach((tweet: { text: string; public_metrics: { like_count: number } }) => {
        tweets.push({ name: tweet.text.slice(0, 100), mentions: tweet.public_metrics?.like_count ?? 0 });
      });
    }

    return { source: 'twitter', products: tweets };
  } catch (err: unknown) {
    logger.warn('Twitter fetch failed', { error: (err as Error).message });
    return { source: 'twitter', products: [] };
  }
}

// ─── Main Agent ────────────────────────────────────────────────────────────

export class ProductDiscoveryAgent {
  async run(): Promise<void> {
    logger.info('ProductDiscoveryAgent: starting product discovery run');

    const [serpData, cjData, redditData, twitterData] = await Promise.allSettled([
      fetchSerpApiTrends(),
      fetchCJDropshipping(),
      fetchRedditTrends(),
      fetchTwitterTrends(),
    ]);

    const trendData: TrendData[] = [serpData, cjData, redditData, twitterData]
      .filter((r): r is PromiseFulfilledResult<TrendData> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(d => d.products.length > 0);

    if (trendData.length === 0) {
      logger.warn('No trend data available — skipping discovery run');
      return;
    }

    const userMessage = `Here is the current product trend data gathered from multiple sources:

${JSON.stringify(trendData, null, 2)}

Today's date: ${new Date().toISOString().split('T')[0]}

Select 5–10 products to add to the store. Follow all rules in the system prompt.`;

    logger.info('Sending trend data to Claude for product selection');

    const decisionId = logDecision({
      agent: 'productDiscovery',
      action: 'select_products',
      reasoning: 'Running 72-hour product discovery cycle',
      input_data: JSON.stringify(trendData),
      status: 'in_progress',
    });

    let products: DiscoveredProduct[];
    try {
      const response = await callClaude(PRODUCT_DISCOVERY_SYSTEM, userMessage, { useCache: true });
      products = parseJsonFromClaude<DiscoveredProduct[]>(response.content);
      logger.info(`Claude selected ${products.length} products`, {
        cacheRead: response.cacheReadTokens,
        cacheWrite: response.cacheWriteTokens,
      });
    } catch (err: unknown) {
      logger.error('Claude product selection failed', { error: (err as Error).message });
      logDecision({ agent: 'productDiscovery', action: 'select_products', status: 'failed', reasoning: (err as Error).message });
      return;
    }

    let created = 0;
    let flagged = 0;

    for (const product of products) {
      try {
        await this.addProductToShopify(product, decisionId);
        created++;
      } catch (err: unknown) {
        logger.error(`Failed to add product: ${product.product_name}`, { error: (err as Error).message });
      }
    }

    logger.info(`ProductDiscoveryAgent complete: ${created} created, ${flagged} flagged for approval`);
    logDecision({
      agent: 'productDiscovery',
      action: 'discovery_complete',
      reasoning: `Created ${created} products, ${flagged} flagged for human approval`,
      status: 'executed',
    });
  }

  private async addProductToShopify(product: DiscoveredProduct, decisionId: number): Promise<void> {
    const requiresApproval = product.price > MAX_AUTO_PRICE;

    if (requiresApproval) {
      logger.warn(`Product "${product.product_name}" priced at $${product.price} — flagging for human approval`);
      logDecision({
        agent: 'productDiscovery',
        action: 'add_product',
        reasoning: product.reasoning,
        input_data: JSON.stringify(product),
        status: 'pending_approval',
        requires_approval: 1,
      });
      return;
    }

    const shopifyProduct = await createProduct({
      title: product.product_name,
      body_html: `<p>${product.description}</p>`,
      product_type: product.category,
      tags: product.tags,
      status: 'active',
      variants: [{
        price: product.price.toFixed(2),
        requires_shipping: true,
        fulfillment_service: 'manual',
      }],
    });

    const shopifyId = shopifyProduct.id!.toString();

    upsertProduct({
      shopify_id: shopifyId,
      title: product.product_name,
      description: product.description,
      price: product.price,
      cost_price: product.cost_estimate,
      category: product.category,
      tags: product.tags,
      target_audience: product.target_audience,
      source: product.source,
      status: 'active',
    });

    const collectionId = await getOrCreateCollection(product.category);
    await addProductToCollection(collectionId, shopifyId);

    await setProductMetafield(shopifyId, {
      namespace: 'ai_meta',
      key: 'trend_score',
      value: product.trend_score.toString(),
      type: 'number_integer',
    });

    await setProductMetafield(shopifyId, {
      namespace: 'ai_meta',
      key: 'target_audience',
      value: product.target_audience,
      type: 'single_line_text_field',
    });

    logDecision({
      agent: 'productDiscovery',
      action: 'add_product',
      reasoning: product.reasoning,
      input_data: JSON.stringify(product),
      output_data: JSON.stringify({ shopify_id: shopifyId }),
      status: 'executed',
    });

    logger.info(`Added product: "${product.product_name}" at $${product.price}`, {
      shopifyId,
      category: product.category,
      trendScore: product.trend_score,
      decisionId,
    });
  }
}

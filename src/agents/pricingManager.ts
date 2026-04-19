import { callClaude, parseJsonFromClaude } from '../ai/claudeClient';
import { PRICING_SYSTEM } from '../ai/prompts';
import { listProducts, getOrdersForProduct, updateVariantPrice, getProductWithVariants, archiveProduct } from '../shopify/client';
import { logDecision, logPriceChange, softDeleteProduct, getProductByShopifyId } from '../db/queries';
import { logger } from '../utils/logger';
import axios from 'axios';

interface PricingDecision {
  product_id: string;
  new_price: number;
  reasoning: string;
  action: 'increase' | 'decrease' | 'hold';
}

interface CompetitorPrice {
  source: string;
  price: number;
  title: string;
}

async function fetchCompetitorPrices(productTitle: string): Promise<CompetitorPrice[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];

  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: { q: `${productTitle} buy online`, api_key: key, engine: 'google_shopping' },
      timeout: 15_000,
    });

    const results = res.data?.shopping_results ?? [];
    return results.slice(0, 5).map((r: { title: string; extracted_price: number; source: string }) => ({
      source: r.source,
      price: r.extracted_price,
      title: r.title,
    }));
  } catch {
    return [];
  }
}

export class PricingManager {
  async run(): Promise<void> {
    logger.info('PricingManager: starting pricing cycle');

    const products = await listProducts({ status: 'active' });
    logger.info(`PricingManager: evaluating ${products.length} products`);

    let updated = 0;
    let archived = 0;

    for (const product of products) {
      const productId = product.id!.toString();
      try {
        const result = await this.evaluateProduct(productId, product.title!);
        if (result === 'archived') archived++;
        else if (result === 'updated') updated++;
      } catch (err: unknown) {
        logger.error(`Pricing evaluation failed for ${product.title}`, { error: (err as Error).message });
      }
    }

    logger.info(`PricingManager complete: ${updated} prices updated, ${archived} products archived`);
  }

  private async evaluateProduct(productId: string, title: string): Promise<string> {
    const fullProduct = await getProductWithVariants(productId);
    const currentVariant = fullProduct.variants?.[0];
    if (!currentVariant) return 'skip';

    const currentPrice = parseFloat(currentVariant.price as unknown as string);

    const [salesLast7, salesLast14, competitorPrices] = await Promise.all([
      getOrdersForProduct(productId, 7),
      getOrdersForProduct(productId, 14),
      fetchCompetitorPrices(title),
    ]);

    // Flag for removal: 0 sales in 14 days
    if (salesLast14 === 0) {
      logger.info(`Archiving product with no sales in 14 days: ${title}`);
      await archiveProduct(productId);
      softDeleteProduct(productId);
      logDecision({
        agent: 'pricingManager',
        action: 'archive_product',
        reasoning: '0 sales in 14 days — removed from store',
        output_data: JSON.stringify({ shopify_id: productId, title }),
        status: 'executed',
      });
      return 'archived';
    }

    const dbProduct = getProductByShopifyId(productId);
    const costPrice = dbProduct?.cost_price ?? currentPrice * 0.4;
    const velocity = salesLast7 / 7;

    const userMessage = `Product: "${title}"
Current Price: $${currentPrice}
Cost Price: $${costPrice}
Sales last 7 days: ${salesLast7}
Sales last 14 days: ${salesLast14}
Sales velocity: ${velocity.toFixed(2)} units/day
Competitor Prices: ${JSON.stringify(competitorPrices)}
Minimum price floor (1.5x cost): $${(costPrice * 1.5).toFixed(2)}

Analyze and recommend a pricing action.`;

    const response = await callClaude(PRICING_SYSTEM, userMessage);
    const decision = parseJsonFromClaude<PricingDecision>(response.content);

    if (decision.action === 'hold') {
      logger.debug(`Pricing hold for "${title}": ${decision.reasoning}`);
      return 'held';
    }

    if (decision.new_price !== currentPrice) {
      const variantId = (currentVariant as unknown as { id: string }).id.toString();
      await updateVariantPrice(variantId, decision.new_price.toFixed(2));

      const decisionId = logDecision({
        agent: 'pricingManager',
        action: 'update_price',
        reasoning: decision.reasoning,
        input_data: JSON.stringify({ currentPrice, salesLast7, competitorPrices }),
        output_data: JSON.stringify(decision),
        status: 'executed',
      });

      if (dbProduct?.id) {
        logPriceChange({
          product_id: dbProduct.id,
          shopify_id: productId,
          old_price: currentPrice,
          new_price: decision.new_price,
          reasoning: decision.reasoning,
          competitor_prices: competitorPrices,
          sales_velocity: velocity,
          ai_decision_id: decisionId,
        });
      }

      logger.info(`Price updated for "${title}": $${currentPrice} → $${decision.new_price} (${decision.action})`);
      return 'updated';
    }

    return 'held';
  }
}

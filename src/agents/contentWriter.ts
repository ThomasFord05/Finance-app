import { callClaude, parseJsonFromClaude } from '../ai/claudeClient';
import { CONTENT_WRITER_SYSTEM, FEATURED_PRODUCTS_SYSTEM } from '../ai/prompts';
import { updateProduct, setProductMetafield, getOrCreateCollection, addProductToCollection } from '../shopify/client';
import { logDecision, getActiveProducts } from '../db/queries';
import { logger } from '../utils/logger';

interface ContentDecision {
  seo_title: string;
  seo_description: string;
  full_description: string;
  alt_text: string;
  collection: string;
  featured_priority: number;
}

interface FeaturedProduct {
  shopify_id: string;
  rank: 1 | 2 | 3;
  reasoning: string;
}

export class ContentWriter {
  async generateForProduct(shopifyId: string, productTitle: string, productDescription: string): Promise<void> {
    logger.info(`ContentWriter: generating content for "${productTitle}"`);

    const userMessage = `Product Title: ${productTitle}
Original Description: ${productDescription}
Shopify Product ID: ${shopifyId}

Generate SEO-optimized content for this product.`;

    const response = await callClaude(CONTENT_WRITER_SYSTEM, userMessage, { useCache: true });
    const content = parseJsonFromClaude<ContentDecision>(response.content);

    await updateProduct(shopifyId, {
      title: content.seo_title,
      body_html: content.full_description,
    });

    const collectionId = await getOrCreateCollection(content.collection);
    await addProductToCollection(collectionId, shopifyId);

    await Promise.all([
      setProductMetafield(shopifyId, {
        namespace: 'seo',
        key: 'title',
        value: content.seo_title,
        type: 'single_line_text_field',
      }),
      setProductMetafield(shopifyId, {
        namespace: 'seo',
        key: 'description',
        value: content.seo_description,
        type: 'single_line_text_field',
      }),
      setProductMetafield(shopifyId, {
        namespace: 'ai_meta',
        key: 'alt_text',
        value: content.alt_text,
        type: 'single_line_text_field',
      }),
      setProductMetafield(shopifyId, {
        namespace: 'ai_meta',
        key: 'featured_priority',
        value: content.featured_priority.toString(),
        type: 'number_integer',
      }),
    ]);

    logDecision({
      agent: 'contentWriter',
      action: 'generate_content',
      reasoning: `Generated SEO content and assigned to collection "${content.collection}"`,
      input_data: JSON.stringify({ shopifyId, productTitle }),
      output_data: JSON.stringify(content),
      status: 'executed',
    });

    logger.info(`Content written for "${productTitle}" → collection: "${content.collection}"`);
  }

  async updateFeaturedProducts(): Promise<void> {
    logger.info('ContentWriter: selecting featured products for homepage');

    const products = getActiveProducts();
    if (products.length === 0) {
      logger.info('No active products to feature');
      return;
    }

    const userMessage = `Active products in the store (${products.length} total):
${JSON.stringify(products.slice(0, 50), null, 2)}

Select the top 3 products to feature on the homepage this week.`;

    const response = await callClaude(FEATURED_PRODUCTS_SYSTEM, userMessage);
    const featured = parseJsonFromClaude<FeaturedProduct[]>(response.content);

    for (const item of featured) {
      await setProductMetafield(item.shopify_id, {
        namespace: 'homepage',
        key: 'featured_rank',
        value: item.rank.toString(),
        type: 'number_integer',
      });
    }

    logDecision({
      agent: 'contentWriter',
      action: 'update_featured',
      reasoning: 'Weekly homepage featured product rotation',
      output_data: JSON.stringify(featured),
      status: 'executed',
    });

    logger.info('Featured products updated', { featured: featured.map(f => f.shopify_id) });
  }
}

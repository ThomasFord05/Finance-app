import axios from 'axios';
import { callClaude, parseJsonFromClaude } from '../ai/claudeClient';
import { MARKETING_SYSTEM } from '../ai/prompts';
import { getActiveProducts, logCampaign, logDecision } from '../db/queries';
import { logger } from '../utils/logger';

interface CampaignVariant {
  platform: 'twitter' | 'instagram' | 'meta' | 'google';
  headline: string;
  body: string;
  cta: string;
  hashtags?: string;
  target_audience: string;
  utm_campaign: string;
}

// ─── Twitter / X ───────────────────────────────────────────────────────────

async function postToTwitter(text: string): Promise<string | null> {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    logger.warn('Twitter credentials not set — skipping post');
    return null;
  }

  try {
    const res = await axios.post(
      'https://api.twitter.com/2/tweets',
      { text },
      {
        headers: {
          Authorization: `OAuth oauth_consumer_key="${apiKey}",oauth_token="${accessToken}"`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      }
    );
    return res.data?.data?.id ?? null;
  } catch (err: unknown) {
    logger.warn('Twitter post failed', { error: (err as Error).message });
    return null;
  }
}

// ─── Main Agent ────────────────────────────────────────────────────────────

export class MarketingAgent {
  async run(): Promise<void> {
    logger.info('MarketingAgent: starting weekly marketing cycle');

    const products = getActiveProducts();
    if (products.length === 0) {
      logger.info('No active products to market');
      return;
    }

    const storeUrl = process.env.SHOPIFY_STORE_URL ?? 'your-store.myshopify.com';

    const userMessage = `Active products (${products.length} total):
${JSON.stringify(products.slice(0, 20), null, 2)}

Store URL: https://${storeUrl}

Generate 3 ad/organic campaign variants — one for Twitter, one for Instagram, one for Meta (Facebook).
Pick the best-performing product based on available data to feature.
Include UTM parameters in the campaign slug.`;

    const response = await callClaude(MARKETING_SYSTEM, userMessage, { useCache: true });
    const campaigns = parseJsonFromClaude<CampaignVariant[]>(response.content);

    logger.info(`MarketingAgent: generated ${campaigns.length} campaign variants`);

    let posted = 0;

    for (const campaign of campaigns) {
      const product = products[0];
      const utmUrl = `https://${storeUrl}/products?utm_source=${campaign.utm_campaign}&utm_medium=${campaign.platform}&utm_campaign=${campaign.utm_campaign}`;

      if (campaign.platform === 'twitter') {
        const tweetText = `${campaign.headline}\n\n${campaign.body}\n\n${campaign.hashtags ?? ''}\n${utmUrl}`.slice(0, 280);
        const tweetId = await postToTwitter(tweetText);
        if (tweetId) posted++;
      }

      logCampaign({
        product_id: product?.id,
        shopify_id: product?.shopify_id ?? undefined,
        platform: campaign.platform,
        campaign_type: 'organic',
        headline: campaign.headline,
        body: campaign.body,
        utm_source: campaign.utm_campaign,
        utm_medium: campaign.platform,
        utm_campaign: campaign.utm_campaign,
      });
    }

    logDecision({
      agent: 'marketingAgent',
      action: 'weekly_campaigns',
      reasoning: `Generated ${campaigns.length} campaign variants, posted ${posted} to social`,
      output_data: JSON.stringify(campaigns),
      status: 'executed',
    });

    logger.info(`MarketingAgent complete: ${campaigns.length} campaigns logged, ${posted} posted`);
  }
}

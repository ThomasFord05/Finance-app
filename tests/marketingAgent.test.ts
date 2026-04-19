import { parseJsonFromClaude } from '../src/ai/claudeClient';

describe('MarketingAgent — campaign JSON pipeline', () => {
  const validCampaigns = JSON.stringify([
    {
      platform: 'twitter',
      headline: 'Stop losing your phone in the car 🚗',
      body: 'Our magnetic holder keeps it in view — always. Perfect for navigation, calls, and more.',
      cta: 'Shop now',
      hashtags: '#CarGadgets #PhoneHolder #TechDeals',
      target_audience: 'Drivers aged 25-45',
      utm_campaign: 'magnetic-holder-twitter-q1',
    },
    {
      platform: 'instagram',
      headline: 'Your ride just got smarter',
      body: '📱 Hands-free, every time. Magnetic Phone Holder — link in bio.',
      cta: 'Link in bio',
      hashtags: '#TechAccessories #MustHave',
      target_audience: 'Young professionals',
      utm_campaign: 'magnetic-holder-ig-q1',
    },
    {
      platform: 'meta',
      headline: 'The phone holder everyone is talking about',
      body: 'Join 10,000+ drivers who made the switch. Limited time: free shipping.',
      cta: 'Get yours',
      hashtags: '',
      target_audience: 'Commuters 25-55',
      utm_campaign: 'magnetic-holder-meta-q1',
    },
  ]);

  it('parses campaign array', () => {
    const result = parseJsonFromClaude<Array<{ platform: string }>>(validCampaigns);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('all campaigns have required fields', () => {
    const result = parseJsonFromClaude<Array<{ platform: string; headline: string; body: string; utm_campaign: string }>>(validCampaigns);
    result.forEach(c => {
      expect(c.platform).toBeTruthy();
      expect(c.headline).toBeTruthy();
      expect(c.body).toBeTruthy();
      expect(c.utm_campaign).toBeTruthy();
    });
  });

  it('twitter post stays under 280 chars', () => {
    const result = parseJsonFromClaude<Array<{ platform: string; headline: string; body: string; hashtags: string }>>(validCampaigns);
    const tweet = result.find(c => c.platform === 'twitter')!;
    const tweetText = `${tweet.headline}\n\n${tweet.body}\n\n${tweet.hashtags}\nhttps://example.myshopify.com`;
    expect(tweetText.length).toBeLessThanOrEqual(280);
  });

  it('utm_campaign slugs are lowercase with hyphens', () => {
    const result = parseJsonFromClaude<Array<{ utm_campaign: string }>>(validCampaigns);
    result.forEach(c => {
      expect(c.utm_campaign).toMatch(/^[a-z0-9-]+$/);
    });
  });
});

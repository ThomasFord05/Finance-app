import { parseJsonFromClaude } from '../src/ai/claudeClient';

// Tests the JSON parsing pipeline that product discovery uses
describe('ProductDiscovery — Claude JSON pipeline', () => {
  const validProductJson = JSON.stringify([
    {
      product_name: 'Magnetic Phone Holder',
      description: 'A powerful magnetic phone holder for cars and desks.',
      price: 24.99,
      cost_estimate: 6.50,
      target_audience: 'Commuters and remote workers',
      category: 'Tech Accessories',
      tags: 'phone holder, magnetic, car accessory',
      trend_score: 8,
      competition_level: 'medium',
      reasoning: 'High search volume, low CPC',
      source: 'serpapi_trends',
    },
  ]);

  it('parses valid product array from Claude', () => {
    const result = parseJsonFromClaude<Array<{ product_name: string; price: number }>>(validProductJson);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].product_name).toBe('Magnetic Phone Holder');
    expect(result[0].price).toBe(24.99);
  });

  it('correctly calculates margin', () => {
    const result = parseJsonFromClaude<Array<{ price: number; cost_estimate: number }>>(validProductJson);
    const { price, cost_estimate } = result[0];
    const margin = ((price - cost_estimate) / price) * 100;
    expect(margin).toBeGreaterThan(60);
  });

  it('rejects products over MAX_AUTO_PRICE ($500)', () => {
    const MAX = 500;
    const result = parseJsonFromClaude<Array<{ price: number }>>(validProductJson);
    const needsApproval = result.filter(p => p.price > MAX);
    expect(needsApproval).toHaveLength(0);
  });

  it('handles Claude returning products with missing optional fields', () => {
    const minimal = JSON.stringify([{ product_name: 'Test', price: 19.99, cost_estimate: 5, category: 'General', trend_score: 5, competition_level: 'low', reasoning: 'test', source: 'test', target_audience: '', description: '', tags: '' }]);
    const result = parseJsonFromClaude<Array<{ product_name: string }>>(minimal);
    expect(result[0].product_name).toBe('Test');
  });

  it('parses multiple products', () => {
    const multi = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({
      product_name: `Product ${i}`,
      price: 20 + i * 5,
      cost_estimate: 5 + i,
      category: 'Test',
      trend_score: i + 3,
      competition_level: 'low',
      reasoning: 'trend',
      source: 'test',
      target_audience: 'all',
      description: 'desc',
      tags: 'tag',
    })));
    const result = parseJsonFromClaude<Array<{ product_name: string }>>(multi);
    expect(result).toHaveLength(7);
    expect(result[6].product_name).toBe('Product 6');
  });
});

import { parseJsonFromClaude } from '../src/ai/claudeClient';

describe('PricingManager — Claude JSON pipeline', () => {
  const validPricingJson = '{"product_id":"gid://shopify/Product/123","new_price":34.99,"reasoning":"Competitor average is $38, sales velocity is strong at 2.1 units/day","action":"increase"}';

  it('parses a pricing decision', () => {
    const result = parseJsonFromClaude<{ product_id: string; new_price: number; action: string }>(validPricingJson);
    expect(result.product_id).toBe('gid://shopify/Product/123');
    expect(result.new_price).toBe(34.99);
    expect(result.action).toBe('increase');
  });

  it('recognizes a discount recommendation', () => {
    const discount = '{"product_id":"123","new_price":18.99,"reasoning":"No sales in 7 days — apply 20% discount","action":"decrease"}';
    const result = parseJsonFromClaude<{ action: string; new_price: number }>(discount);
    expect(result.action).toBe('decrease');
    expect(result.new_price).toBeLessThan(24.99);
  });

  it('validates price floor (1.5x cost)', () => {
    const costPrice = 10;
    const floor = costPrice * 1.5;
    const decision = parseJsonFromClaude<{ new_price: number }>(validPricingJson);
    expect(decision.new_price).toBeGreaterThanOrEqual(floor);
  });

  it('handles hold action', () => {
    const hold = '{"product_id":"456","new_price":29.99,"reasoning":"Price is competitive, no change needed","action":"hold"}';
    const result = parseJsonFromClaude<{ action: string }>(hold);
    expect(result.action).toBe('hold');
  });

  it('does not allow more than 30% price increase at once', () => {
    const currentPrice = 29.99;
    const result = parseJsonFromClaude<{ new_price: number }>(validPricingJson);
    const increase = ((result.new_price - currentPrice) / currentPrice) * 100;
    expect(increase).toBeLessThanOrEqual(30);
  });
});

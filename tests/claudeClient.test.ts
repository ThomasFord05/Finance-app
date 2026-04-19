import { parseJsonFromClaude } from '../src/ai/claudeClient';

describe('parseJsonFromClaude', () => {
  it('parses a raw JSON array', () => {
    const raw = '[{"name":"test","price":9.99}]';
    const result = parseJsonFromClaude<Array<{ name: string; price: number }>>(raw);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test');
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n[{"id":1}]\n```';
    const result = parseJsonFromClaude<Array<{ id: number }>>(raw);
    expect(result[0].id).toBe(1);
  });

  it('extracts JSON from surrounding text', () => {
    const raw = 'Here are the products:\n[{"title":"Widget"}]\nEnd.';
    const result = parseJsonFromClaude<Array<{ title: string }>>(raw);
    expect(result[0].title).toBe('Widget');
  });

  it('parses a JSON object', () => {
    const raw = '{"product_id":"123","new_price":29.99,"action":"increase","reasoning":"high demand"}';
    const result = parseJsonFromClaude<{ product_id: string; new_price: number }>(raw);
    expect(result.product_id).toBe('123');
    expect(result.new_price).toBe(29.99);
  });

  it('throws on unparseable content', () => {
    expect(() => parseJsonFromClaude('no json here at all')).toThrow();
  });

  it('handles nested objects in array', () => {
    const raw = JSON.stringify([
      { product_name: 'Widget', price: 49.99, cost_estimate: 12.00, category: 'Gadgets', trend_score: 8 }
    ]);
    const result = parseJsonFromClaude<Array<{ product_name: string; trend_score: number }>>(raw);
    expect(result[0].trend_score).toBe(8);
  });
});

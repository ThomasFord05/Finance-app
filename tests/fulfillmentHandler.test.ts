import { parseJsonFromClaude } from '../src/ai/claudeClient';

describe('FulfillmentHandler — refund decision pipeline', () => {
  it('parses an approve decision', () => {
    const raw = '{"action":"approve","reasoning":"Customer received wrong item — full refund warranted"}';
    const result = parseJsonFromClaude<{ action: string; reasoning: string }>(raw);
    expect(result.action).toBe('approve');
  });

  it('parses a partial refund with percentage', () => {
    const raw = '{"action":"partial","reasoning":"Item received but slightly damaged","refund_percentage":50}';
    const result = parseJsonFromClaude<{ action: string; refund_percentage: number }>(raw);
    expect(result.action).toBe('partial');
    expect(result.refund_percentage).toBe(50);
  });

  it('parses a deny decision', () => {
    const raw = '{"action":"deny","reasoning":"Item was delivered as described, no defects reported within policy window"}';
    const result = parseJsonFromClaude<{ action: string }>(raw);
    expect(result.action).toBe('deny');
  });

  it('calculates correct partial refund amount', () => {
    const originalAmount = 49.99;
    const decision = parseJsonFromClaude<{ refund_percentage: number }>('{"action":"partial","reasoning":"minor issue","refund_percentage":50}');
    const refundAmount = originalAmount * (decision.refund_percentage / 100);
    expect(refundAmount).toBeCloseTo(24.995, 2);
  });
});

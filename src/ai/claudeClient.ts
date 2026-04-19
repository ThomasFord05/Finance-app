import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

let client: Anthropic;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export interface ClaudeResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  options: {
    maxRetries?: number;
    maxTokens?: number;
    useCache?: boolean;
  } = {}
): Promise<ClaudeResponse> {
  const { maxRetries = 3, maxTokens = MAX_TOKENS, useCache = true } = options;
  const anthropic = getClient();

  const systemBlock: Anthropic.MessageParam['content'] | Anthropic.TextBlockParam | Anthropic.CacheControlEphemeral = useCache
    ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } } as Anthropic.TextBlockParam & { cache_control: Anthropic.CacheControlEphemeral }]
    : systemPrompt;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemBlock as string,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find(b => b.type === 'text');
      const content = textBlock?.type === 'text' ? textBlock.text : '';

      const usage = response.usage as Anthropic.Usage & {
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };

      logger.debug('Claude API call succeeded', {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        attempt,
      });

      return {
        content,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      };
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      const isRateLimit = error.status === 429;
      const isServerError = (error.status ?? 0) >= 500;

      if ((isRateLimit || isServerError) && attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000;
        logger.warn(`Claude API attempt ${attempt} failed, retrying in ${backoff}ms`, { error: error.message });
        await sleep(backoff);
        continue;
      }

      logger.error('Claude API call failed permanently', { error: error.message, attempts: attempt });
      throw err;
    }
  }

  throw new Error('Claude API: max retries exceeded');
}

export function parseJsonFromClaude<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const jsonMatch = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error(`Claude returned no parseable JSON. Raw: ${raw.slice(0, 300)}`);
  }

  return JSON.parse(jsonMatch[1]) as T;
}

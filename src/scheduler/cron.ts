import cron from 'node-cron';
import { logger } from '../utils/logger';
import { ProductDiscoveryAgent } from '../agents/productDiscovery';
import { PricingManager } from '../agents/pricingManager';
import { ContentWriter } from '../agents/contentWriter';
import { MarketingAgent } from '../agents/marketingAgent';

interface CronJob {
  name: string;
  schedule: string;
  nextRun?: Date;
  task: cron.ScheduledTask;
}

const jobs: CronJob[] = [];

function schedule(name: string, expression: string, fn: () => Promise<void>): void {
  const task = cron.schedule(expression, async () => {
    logger.info(`[CRON] Starting: ${name}`);
    const start = Date.now();
    try {
      await fn();
      logger.info(`[CRON] Completed: ${name} in ${Date.now() - start}ms`);
    } catch (err: unknown) {
      logger.error(`[CRON] Failed: ${name}`, { error: (err as Error).message });
    }
  });

  jobs.push({ name, schedule: expression, task });
  logger.info(`[CRON] Registered: ${name} (${expression})`);
}

export function startAllCronJobs(): void {
  // Phase 1: Product discovery every 72 hours (3am on Mon/Thu/Sun)
  schedule('ProductDiscovery', '0 3 * * 0,1,4', async () => {
    const agent = new ProductDiscoveryAgent();
    await agent.run();
  });

  // Phase 2: Pricing review every 24 hours (2am daily)
  schedule('PricingManager', '0 2 * * *', async () => {
    const manager = new PricingManager();
    await manager.run();
  });

  // Phase 3: Featured product rotation weekly (Sunday 4am)
  schedule('FeaturedProductsRotation', '0 4 * * 0', async () => {
    const writer = new ContentWriter();
    await writer.updateFeaturedProducts();
  });

  // Phase 5: Marketing campaigns weekly (Monday 9am)
  schedule('MarketingAgent', '0 9 * * 1', async () => {
    const agent = new MarketingAgent();
    await agent.run();
  });

  logger.info(`[CRON] All jobs started (${jobs.length} total)`);
}

export function stopAllCronJobs(): void {
  jobs.forEach(j => j.task.stop());
  logger.info('[CRON] All jobs stopped');
}

export function getCronStatus(): Array<{ name: string; schedule: string; running: boolean }> {
  return jobs.map(j => ({
    name: j.name,
    schedule: j.schedule,
    running: true,
  }));
}

import 'dotenv/config';
import Fastify from 'fastify';
import { registerWebhooks } from './shopify/webhooks';
import { registerDashboardRoutes } from './api/dashboard';
import { startAllCronJobs, stopAllCronJobs } from './scheduler/cron';
import { getDb, closeDb } from './db/schema';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main(): Promise<void> {
  // Initialize DB
  getDb();
  logger.info('Database initialized');

  // Create Fastify server
  const app = Fastify({ logger: false });

  // Register routes
  await registerWebhooks(app);
  await registerDashboardRoutes(app);

  // Start cron jobs
  startAllCronJobs();

  // Start server
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`Server listening on http://0.0.0.0:${PORT}`);
  logger.info(`Dashboard: http://localhost:${PORT}/dashboard`);
  logger.info('Autonomous Shopify Store running');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    stopAllCronJobs();
    await app.close();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  logger.error('Fatal startup error', { error: err.message });
  process.exit(1);
});

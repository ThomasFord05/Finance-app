import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { upsertOrder } from '../db/queries';
import { FulfillmentHandler } from '../agents/fulfillmentHandler';

function verifyHmac(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('SHOPIFY_WEBHOOK_SECRET not set — skipping HMAC verification');
    return true;
  }
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

export async function registerWebhooks(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });

  app.post('/webhooks/orders/create', async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['x-shopify-hmac-sha256'] as string;
    const rawBody = req.body as Buffer;

    if (!signature || !verifyHmac(rawBody, signature)) {
      logger.warn('Invalid webhook signature for orders/create');
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const order = JSON.parse(rawBody.toString());
    logger.info(`Webhook: New order #${order.order_number}`, { orderId: order.id });

    upsertOrder({
      shopify_order_id: order.id.toString(),
      shopify_order_number: order.order_number?.toString(),
      customer_email: order.email,
      total_price: parseFloat(order.total_price ?? '0'),
      fulfillment_status: 'pending',
      raw_data: rawBody.toString(),
    });

    const handler = new FulfillmentHandler();
    handler.processOrder(order).catch(err => {
      logger.error('Async fulfillment failed', { error: err.message, orderId: order.id });
    });

    return reply.status(200).send({ received: true });
  });

  app.post('/webhooks/orders/updated', async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['x-shopify-hmac-sha256'] as string;
    const rawBody = req.body as Buffer;

    if (!signature || !verifyHmac(rawBody, signature)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const order = JSON.parse(rawBody.toString());
    logger.info(`Webhook: Order updated #${order.order_number}`);

    upsertOrder({
      shopify_order_id: order.id.toString(),
      fulfillment_status: order.fulfillment_status ?? 'pending',
    });

    return reply.status(200).send({ received: true });
  });

  app.post('/webhooks/refunds/create', async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['x-shopify-hmac-sha256'] as string;
    const rawBody = req.body as Buffer;

    if (!signature || !verifyHmac(rawBody, signature)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const refund = JSON.parse(rawBody.toString());
    logger.info(`Webhook: Refund request for order ${refund.order_id}`);

    const handler = new FulfillmentHandler();
    handler.handleRefundRequest(refund).catch(err => {
      logger.error('Refund handling failed', { error: err.message });
    });

    return reply.status(200).send({ received: true });
  });

  app.get('/health', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  logger.info('Webhooks registered');
}

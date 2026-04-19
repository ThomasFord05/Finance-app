import axios from 'axios';
import { callClaude, parseJsonFromClaude } from '../ai/claudeClient';
import { FULFILLMENT_SYSTEM } from '../ai/prompts';
import { createFulfillment, createRefund } from '../shopify/client';
import { logDecision, updateOrderFulfillment } from '../db/queries';
import { logger } from '../utils/logger';
import type { ShopifyOrder } from '../shopify/client';

interface CJOrderResponse {
  orderId: string;
  trackingNumber?: string;
  trackingUrl?: string;
}

interface RefundDecision {
  action: 'approve' | 'partial' | 'deny';
  reasoning: string;
  refund_percentage?: number;
}

// ─── CJ Dropshipping ───────────────────────────────────────────────────────

async function submitToCJDropshipping(order: ShopifyOrder): Promise<CJOrderResponse | null> {
  const key = process.env.CJ_DROPSHIPPING_API_KEY;
  if (!key) {
    logger.warn('CJ_DROPSHIPPING_API_KEY not set — skipping auto-fulfillment');
    return null;
  }

  try {
    const lineItems = order.line_items.map(item => ({
      vid: item.sku,
      quantity: item.quantity,
    }));

    const res = await axios.post(
      'https://developers.cjdropshipping.com/api2.0/v1/shopping/order/createOrderV2',
      {
        orderNumber: `shopify_${order.id}`,
        shippingZip: order.shipping_address.zip,
        shippingCountryCode: order.shipping_address.country,
        shippingPhone: order.shipping_address.phone ?? '',
        shippingCustomerName: `${order.shipping_address.first_name} ${order.shipping_address.last_name}`,
        shippingAddress: order.shipping_address.address1,
        shippingCity: order.shipping_address.city,
        shippingProvince: order.shipping_address.province,
        products: lineItems,
      },
      {
        headers: { 'CJ-Access-Token': key, 'Content-Type': 'application/json' },
        timeout: 20_000,
      }
    );

    const data = res.data?.data;
    return {
      orderId: data?.orderId ?? '',
      trackingNumber: data?.trackingNumber,
      trackingUrl: data?.trackingUrl,
    };
  } catch (err: unknown) {
    logger.error('CJ Dropshipping order submission failed', { error: (err as Error).message });
    return null;
  }
}

// ─── Main Handler ──────────────────────────────────────────────────────────

export class FulfillmentHandler {
  async processOrder(order: ShopifyOrder): Promise<void> {
    logger.info(`Processing order #${order.order_number}`, { orderId: order.id, total: order.total_price });

    const cjResult = await submitToCJDropshipping(order);

    if (cjResult) {
      updateOrderFulfillment(order.id.toString(), {
        fulfillment_provider: 'cj_dropshipping',
        provider_order_id: cjResult.orderId,
        tracking_number: cjResult.trackingNumber,
        tracking_url: cjResult.trackingUrl,
        fulfillment_status: cjResult.trackingNumber ? 'fulfilled' : 'submitted',
      });

      if (cjResult.trackingNumber) {
        await createFulfillment(order.id.toString(), {
          tracking_number: cjResult.trackingNumber,
          tracking_company: 'CJ Dropshipping',
          tracking_url: cjResult.trackingUrl,
          notify_customer: true,
        });
      }

      logDecision({
        agent: 'fulfillmentHandler',
        action: 'process_order',
        reasoning: `Auto-fulfilled via CJ Dropshipping`,
        input_data: JSON.stringify({ orderId: order.id, orderNumber: order.order_number }),
        output_data: JSON.stringify(cjResult),
        status: 'executed',
      });

      logger.info(`Order #${order.order_number} submitted to CJ Dropshipping`, {
        providerOrderId: cjResult.orderId,
        tracking: cjResult.trackingNumber ?? 'pending',
      });
    } else {
      updateOrderFulfillment(order.id.toString(), { fulfillment_status: 'manual_required' });
      logDecision({
        agent: 'fulfillmentHandler',
        action: 'process_order',
        reasoning: 'Auto-fulfillment unavailable — marked for manual review',
        input_data: JSON.stringify({ orderId: order.id }),
        status: 'pending_approval',
        requires_approval: 1,
      });
    }
  }

  async handleRefundRequest(refundData: { order_id: string; note?: string; transactions?: Array<{ amount: string }> }): Promise<void> {
    const orderId = refundData.order_id.toString();
    const customerMessage = refundData.note ?? 'No reason provided';
    const refundAmount = refundData.transactions?.[0]?.amount ?? '0';

    logger.info(`Processing refund request for order ${orderId}`);

    const userMessage = `Order ID: ${orderId}
Customer refund request message: "${customerMessage}"
Original transaction amount: $${refundAmount}

Decide whether to approve, partially approve, or deny this refund.`;

    const response = await callClaude(FULFILLMENT_SYSTEM, userMessage);
    const decision = parseJsonFromClaude<RefundDecision>(response.content);

    logDecision({
      agent: 'fulfillmentHandler',
      action: 'refund_decision',
      reasoning: decision.reasoning,
      input_data: JSON.stringify({ orderId, customerMessage }),
      output_data: JSON.stringify(decision),
      status: 'executed',
    });

    if (decision.action === 'approve') {
      await createRefund(orderId, {
        amount: refundAmount,
        reason: decision.reasoning,
      });
      logger.info(`Refund approved for order ${orderId}: $${refundAmount}`);
    } else if (decision.action === 'partial' && decision.refund_percentage) {
      const partialAmount = (parseFloat(refundAmount) * (decision.refund_percentage / 100)).toFixed(2);
      await createRefund(orderId, {
        amount: partialAmount,
        reason: decision.reasoning,
        note: `Partial refund (${decision.refund_percentage}%): ${decision.reasoning}`,
      });
      logger.info(`Partial refund for order ${orderId}: $${partialAmount} (${decision.refund_percentage}%)`);
    } else {
      logger.info(`Refund denied for order ${orderId}: ${decision.reasoning}`);
    }
  }
}

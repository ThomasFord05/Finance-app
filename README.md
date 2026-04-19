# Autonomous Shopify Store

An AI-operated e-commerce business that runs itself — powered by Claude (Anthropic) and Node.js/TypeScript.

## What It Does

| Phase | Agent | Schedule | Description |
|-------|-------|----------|-------------|
| 1 | `ProductDiscoveryAgent` | Every 72h | Scrapes trends → Claude picks products → auto-adds to Shopify |
| 2 | `PricingManager` | Every 24h | Checks sales velocity + competitor prices → Claude adjusts pricing |
| 3 | `ContentWriter` | On product add + weekly | Claude generates SEO titles, descriptions, meta tags |
| 4 | `FulfillmentHandler` | On webhook | Auto-submits orders to CJ Dropshipping, handles refunds via Claude |
| 5 | `MarketingAgent` | Weekly | Claude writes ad copy → posts to Twitter/X |

## Quick Start

### 1. Clone & Install

```bash
git clone <your-repo>
cd autonomous-shopify-store
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Fill in your API keys (see Environment Variables below)
```

### 3. Run

```bash
# Development
npm run dev

# Production
npm run build && npm start

# CLI Dashboard (terminal UI)
npm run dashboard
```

### 4. Open the Web Dashboard

Navigate to `http://localhost:3000/dashboard` in your browser.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SHOPIFY_STORE_URL` | ✅ | Your store URL e.g. `my-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | ✅ | Admin API access token (from Shopify Partners) |
| `SHOPIFY_WEBHOOK_SECRET` | ✅ | Webhook signing secret |
| `ANTHROPIC_API_KEY` | ✅ | From console.anthropic.com |
| `CJ_DROPSHIPPING_API_KEY` | ⚠️ | For auto-fulfillment |
| `SERPAPI_KEY` | ⚠️ | For Google Trends + competitor pricing |
| `TWITTER_BEARER_TOKEN` | ⚠️ | For Twitter trend data + posting |
| `REDDIT_CLIENT_ID` | ⚠️ | For Reddit trend data |

⚠️ = Optional but recommended. System degrades gracefully without these.

## Shopify Setup

1. Create a **Private App** in Shopify Admin → Apps → Develop apps
2. Enable these scopes: `read_products`, `write_products`, `read_orders`, `write_orders`, `read_inventory`, `write_inventory`
3. Add webhooks pointing to `https://your-domain.com/webhooks/orders/create` etc.

## Web Dashboard

Open `http://localhost:3000/dashboard` to access:

- **Overview** — Active products, today's orders, last AI decision, pending approvals
- **Products** — Full product list with margins
- **Profit** — Revenue, margin analysis, estimated profit per product
- **Orders** — Order status, fulfillment tracking
- **AI Decisions** — Full audit log of every autonomous decision
- **Approvals** — Human review queue for high-value items (>$500)
- **Marketing** — Campaign tracker with UTM performance
- **Scheduler** — Cron job status + pricing history

## Guardrails

- Products over `$500` are **flagged for human approval** — not auto-added
- All deletions are **soft deletes** (reversible)
- Every AI action is **logged to SQLite** with timestamp + reasoning
- Shopify API calls are **rate-limited** (500ms between requests)
- Webhooks verified via **HMAC-SHA256**

## Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set all environment variables in the Railway dashboard.

## Deploy to Render

1. Connect your GitHub repo to Render
2. Set **Build Command**: `npm install && npm run build`
3. Set **Start Command**: `npm start`
4. Add all environment variables in Render settings

## Project Structure

```
src/
  agents/
    productDiscovery.ts   ← Phase 1: AI product selection
    pricingManager.ts     ← Phase 2: Dynamic pricing
    contentWriter.ts      ← Phase 3: SEO content generation
    fulfillmentHandler.ts ← Phase 4: Order + refund automation
    marketingAgent.ts     ← Phase 5: Ad copy + social posting
  shopify/
    client.ts             ← Shopify Admin API wrapper
    webhooks.ts           ← Webhook handlers (HMAC verified)
  ai/
    claudeClient.ts       ← Anthropic SDK with retry + prompt caching
    prompts.ts            ← All system prompts centralized
  api/
    dashboard.ts          ← REST API for the web dashboard
  db/
    schema.ts             ← SQLite schema + initialization
    queries.ts            ← All database operations
  scheduler/
    cron.ts               ← All cron job definitions
  dashboard/
    public/index.html     ← Web dashboard (served by Fastify)
    cli.tsx               ← Terminal UI (ink/React)
  utils/
    logger.ts             ← Winston + daily rotating logs
  index.ts                ← Entry point
tests/                    ← Unit tests for all AI pipelines
data/                     ← SQLite database (auto-created)
logs/                     ← Daily rotating log files (auto-created)
```

## Running Tests

```bash
npm test
# or with coverage
npm test -- --coverage
```

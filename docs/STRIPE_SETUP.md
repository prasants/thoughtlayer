# Stripe Billing Setup

## Products to Create

### Pro Plan ($19/mo)
- **Product name:** ThoughtLayer Pro
- **Monthly price:** $19/mo (price_xxx)
- **Annual price:** $190/yr (price_xxx): save ~17%
- **Features:** Cloud sync, hosted embeddings, dashboard, analytics, priority support
- **Stripe metadata:** `plan: pro`

### Team Plan ($49/seat/mo)
- **Product name:** ThoughtLayer Team
- **Monthly price:** $49/seat/mo (price_xxx)
- **Annual price:** $490/seat/yr (price_xxx): save ~17%
- **Features:** Everything in Pro + shared knowledge bases, RBAC, audit log, SSO, SLA
- **Stripe metadata:** `plan: team`

## Setup Steps

1. **Create Stripe account** at stripe.com (or use existing)
2. **Create products** in Stripe Dashboard → Products
3. **Copy price IDs** into `site/pricing.js` (STRIPE_PRICING object)
4. **Set publishable key** in `site/pricing.js` (STRIPE_PK)
5. **Set up webhook endpoint** for subscription events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
6. **Add NPM_TOKEN** to GitHub repo secrets for CI publish

## Webhook Handler (Phase 2)

The webhook handler will run on the ThoughtLayer Cloud API (Supabase Edge Function or AWS Lambda).
It syncs subscription state to the user database and gates cloud features.

## Revenue Targets

- Month 1: $650 MRR (34 Pro, 0 Team)
- Month 6: $5K MRR (mix)
- Month 12: $15K MRR
- Month 18: $30K MRR
- 93% gross margins (compute cost ~$0.002/query)

// ThoughtLayer Stripe Pricing Integration
// This script handles the "Get Started" / "Subscribe" buttons on the pricing page.
// It redirects to Stripe Checkout for paid plans.

const STRIPE_PRICING = {
  // These will be replaced with real Stripe price IDs once products are created
  pro: {
    monthly: null, // price_xxx
    annual: null,  // price_xxx
  },
  team: {
    monthly: null, // price_xxx
    annual: null,  // price_xxx
  },
};

// Stripe publishable key (set after Stripe account is connected)
const STRIPE_PK = null; // pk_live_xxx or pk_test_xxx

async function subscribe(plan, interval = 'monthly') {
  if (!STRIPE_PK) {
    // Pre-launch: redirect to waitlist
    window.location.href = 'https://github.com/prasants/thoughtlayer';
    return;
  }

  const priceId = STRIPE_PRICING[plan]?.[interval];
  if (!priceId) {
    console.error(`No price ID for ${plan}/${interval}`);
    return;
  }

  // Redirect to Stripe Checkout (server-side session creation preferred for production)
  // For now, use client-side redirect
  const stripe = Stripe(STRIPE_PK);
  const { error } = await stripe.redirectToCheckout({
    lineItems: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    successUrl: `${window.location.origin}/welcome?plan=${plan}`,
    cancelUrl: `${window.location.origin}/#pricing`,
  });

  if (error) {
    console.error('Stripe error:', error.message);
  }
}

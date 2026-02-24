/*
 Minimal Express server for Stripe subscription flow and webhooks
 - POST /api/stripe/create-subscription (legacy - kept for compatibility)
 - POST /api/stripe/create-checkout-session (NEW - for Chrome Extension)
 - POST /api/stripe/verify-checkout-session (NEW - verify payment)
 - POST /api/stripe/create-portal-session
 - POST /api/stripe/webhook
 - POST /api/validate-license (validate license key from request body)

 Copy .env.example -> .env and set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
*/

const express = require('express');
const Stripe = require('stripe');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PORT = process.env.PORT || 3000;

if (!STRIPE_SECRET_KEY) {
  console.error('Missing STRIPE_SECRET_KEY in environment');
  process.exit(1);
}

const stripe = Stripe(STRIPE_SECRET_KEY);
const app = express();

app.use(cors());

// Need raw body for webhooks, JSON for everything else
app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// ============================================
// NEW: Create Stripe Checkout Session
// This is the recommended approach for Chrome Extensions
// ============================================
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  try {
    const { user_id, price_id, billing_cycle, success_url, cancel_url } = req.body || {};

    if (!price_id) {
      return res.status(400).json({ error: 'Missing price_id' });
    }

    console.log('[Stripe] Creating checkout session:', { user_id, price_id, billing_cycle });

    // Create or retrieve customer
    let customer;
    if (user_id) {
      // Try to find existing customer by user_id
      const existingCustomers = await stripe.customers.list({
        limit: 1,
        query: `metadata['user_id']:'${user_id}'`
      }).catch(() => ({ data: [] }));

      if (existingCustomers.data && existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
        console.log('[Stripe] Found existing customer:', customer.id);
      } else {
        customer = await stripe.customers.create({
          metadata: { user_id: user_id || 'unknown' }
        });
        console.log('[Stripe] Created new customer:', customer.id);
      }
    }

    // Create checkout session
    const sessionConfig = {
      mode: 'subscription',
      line_items: [{ price: price_id, quantity: 1 }],
      success_url: success_url || 'https://lisa-extension.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancel_url || 'https://lisa-extension.com/cancel',
      metadata: {
        user_id: user_id || 'unknown',
        billing_cycle: billing_cycle || 'month'
      },
      subscription_data: {
        metadata: {
          user_id: user_id || 'unknown'
        }
      }
    };

    if (customer) {
      sessionConfig.customer = customer.id;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log('[Stripe] Checkout session created:', session.id);

    res.json({
      session_id: session.id,
      url: session.url,
      customer_id: customer ? customer.id : null
    });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// NEW: Verify Checkout Session
// Called after user completes payment
// ============================================
app.post('/api/stripe/verify-checkout-session', async (req, res) => {
  try {
    const { session_id, user_id } = req.body || {};

    if (!session_id) {
      return res.status(400).json({ error: 'Missing session_id' });
    }

    console.log('[Stripe] Verifying checkout session:', session_id);

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription', 'customer']
    });

    res.json({
      status: session.status,
      payment_status: session.payment_status,
      subscription_id: session.subscription?.id || session.subscription,
      customer_id: session.customer?.id || session.customer,
      subscription_status: session.subscription?.status,
      current_period_end: session.subscription?.current_period_end
    });
  } catch (err) {
    console.error('Error verifying checkout session:', err);
    res.status(500).json({ error: err.message });
  }
});

// Legacy: Create subscription endpoint (kept for compatibility)
app.post('/api/stripe/create-subscription', async (req, res) => {
  try {
    const { user_id, price_id, billing_cycle, return_url } = req.body || {};

    if (!price_id) {
      return res.status(400).json({ error: 'Missing price_id' });
    }

    // Create a customer (or you would lookup existing by metadata/user mapping)
    const customer = await stripe.customers.create({ metadata: { user_id: user_id || 'unknown' } });

    // Create subscription in incomplete state so we can confirm payment on client
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price_id }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent']
    });

    const clientSecret = subscription.latest_invoice && subscription.latest_invoice.payment_intent
      ? subscription.latest_invoice.payment_intent.client_secret
      : null;

    res.json({
      subscription_id: subscription.id,
      client_secret: clientSecret,
      customer_id: customer.id
    });
  } catch (err) {
    console.error('Error creating subscription:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create billing portal session
app.post('/api/stripe/create-portal-session', async (req, res) => {
  try {
    const { customer_id, return_url } = req.body || {};
    if (!customer_id) return res.status(400).json({ error: 'Missing customer_id' });

    const session = await stripe.billingPortal.sessions.create({
      customer: customer_id,
      return_url: return_url || '/'
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating portal session:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get subscription status
app.get('/api/stripe/get-subscription', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing X-User-ID header', active: false });
    }

    console.log('[Stripe] Getting subscription for user:', userId);

    // Find customer by user_id metadata
    const customers = await stripe.customers.search({
      query: `metadata['user_id']:'${userId}'`,
      limit: 1
    }).catch(() => ({ data: [] }));

    if (!customers.data || customers.data.length === 0) {
      return res.json({ active: false, status: 'no_customer' });
    }

    const customer = customers.data[0];

    // Get active subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      // Check for trialing or past_due subscriptions
      const allSubs = await stripe.subscriptions.list({
        customer: customer.id,
        limit: 1
      });
      
      if (allSubs.data.length > 0) {
        const sub = allSubs.data[0];
        return res.json({
          active: sub.status === 'active' || sub.status === 'trialing',
          status: sub.status,
          id: sub.id,
          current_period_end: sub.current_period_end,
          plan_name: sub.items.data[0]?.price?.nickname || 'LISA Premium',
          amount: sub.items.data[0]?.price?.unit_amount,
          interval: sub.items.data[0]?.price?.recurring?.interval
        });
      }
      
      return res.json({ active: false, status: 'no_subscription' });
    }

    const subscription = subscriptions.data[0];

    res.json({
      active: true,
      status: subscription.status,
      id: subscription.id,
      current_period_end: subscription.current_period_end,
      plan_name: subscription.items.data[0]?.price?.nickname || 'LISA Premium',
      amount: subscription.items.data[0]?.price?.unit_amount,
      interval: subscription.items.data[0]?.price?.recurring?.interval
    });
  } catch (err) {
    console.error('Error getting subscription:', err);
    res.status(500).json({ error: err.message, active: false });
  }
});

// Cancel subscription
app.post('/api/stripe/cancel-subscription', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing X-User-ID header' });
    }

    console.log('[Stripe] Cancelling subscription for user:', userId);

    // Find customer by user_id metadata
    const customers = await stripe.customers.search({
      query: `metadata['user_id']:'${userId}'`,
      limit: 1
    }).catch(() => ({ data: [] }));

    if (!customers.data || customers.data.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const customer = customers.data[0];

    // Get active subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Cancel the subscription at period end
    const cancelled = await stripe.subscriptions.update(subscriptions.data[0].id, {
      cancel_at_period_end: true
    });

    res.json({
      success: true,
      status: cancelled.status,
      cancel_at_period_end: cancelled.cancel_at_period_end,
      current_period_end: cancelled.current_period_end
    });
  } catch (err) {
    console.error('Error cancelling subscription:', err);
    res.status(500).json({ error: err.message });
  }
});

// Stripe webhook endpoint
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn('STRIPE_WEBHOOK_SECRET not set; skipping signature verification');
    // If no secret configured, attempt to parse body (not recommended for production)
    try {
      const event = JSON.parse(req.body.toString());
      console.log('Received webhook event (raw):', event.type);
      return res.json({ received: true });
    } catch (err) {
      console.error('Failed to parse webhook payload without signature:', err.message);
      return res.status(400).send(`Webhook error: ${err.message}`);
    }
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event types you care about
  switch (event.type) {
    case 'checkout.session.completed':
      console.log('checkout.session.completed:', event.data.object.id);
      // Payment successful via Checkout
      // You could store subscription info in your DB here
      break;
    case 'invoice.payment_succeeded':
      console.log('invoice.payment_succeeded:', event.data.object.id);
      // TODO: mark subscription as active in your DB
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      console.log(`${event.type}:`, event.data.object.id);
      // TODO: sync subscription status to your DB
      break;
    case 'customer.subscription.deleted':
      console.log('customer.subscription.deleted:', event.data.object.id);
      // TODO: mark subscription as cancelled/ended in your DB
      break;
    default:
      console.log('Unhandled event type:', event.type);
  }

  res.json({ received: true });
});

// ============================================
// Validate License Key (key read from body, not URL)
// ============================================
app.post('/api/validate-license', async (req, res) => {
  try {
    const { key } = req.body || {};

    if (!key || typeof key !== 'string' || key.trim() === '') {
      return res.status(400).json({ valid: false, error: 'Missing license key' });
    }

    const licenseKey = key.trim();

    // Find customer by license_key metadata
    const customers = await stripe.customers.search({
      query: `metadata['license_key']:'${licenseKey}'`,
      limit: 1
    }).catch(() => ({ data: [] }));

    if (!customers.data || customers.data.length === 0) {
      return res.status(401).json({ valid: false });
    }

    const customer = customers.data[0];

    // Verify an active subscription exists for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return res.status(401).json({ valid: false });
    }

    const subscription = subscriptions.data[0];
    const interval = subscription.items.data[0]?.price?.recurring?.interval;
    const tier = interval === 'year' ? 'Pro Annual' : 'Pro';

    console.log('[License] Valid key accepted for customer:', customer.id);

    return res.json({ valid: true, tier });
  } catch (err) {
    console.error('[License] Validation error:', err);
    res.status(500).json({ valid: false, error: 'Validation failed' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Stripe server listening on port ${PORT}`);
});

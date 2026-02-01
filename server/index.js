/*
 Minimal Express server for Stripe subscription flow and webhooks
 - POST /api/stripe/create-subscription
 - POST /api/stripe/create-portal-session
 - POST /api/stripe/webhook

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
app.use(express.json());

// Create subscription endpoint
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

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Stripe server listening on port ${PORT}`);
});

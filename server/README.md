# LISA Stripe Server (local scaffold)

This is a minimal Express scaffold used by the extension to create Stripe subscriptions, open billing portal sessions, and receive Stripe webhooks.

Quick Setup

1. Copy `.env.example` to `.env` and fill in your secrets (DO NOT commit `.env`):

```bash
cp .env.example .env
# Edit .env and set your real values
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_WEBHOOK_SECRET=whsec_...
# PORT=3000
```

2. Install dependencies and start the server locally:

```bash
cd server
npm install
# development (auto-reloads with nodemon if installed)
npm run dev
# or to run once
npm run start
```

Local webhook testing (ngrok or Stripe CLI)

- Option A — ngrok (quick):

```bash
ngrok http 3000
# copy the HTTPS forwarding URL (e.g. https://abcd1234.ngrok.io)
# In the Stripe Dashboard → Developers → Webhooks add endpoint:
#   <HTTPS_FORWARDING_URL>/api/stripe/webhook
# Subscribe to events: invoice.payment_succeeded, customer.subscription.created,
# customer.subscription.updated, customer.subscription.deleted
```

- Option B — Stripe CLI (recommended for signing + local forwarding):

```bash
# Install: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
# In another terminal you can trigger test events:
stripe trigger invoice.payment_succeeded
stripe trigger customer.subscription.created
```

Important: When using the Stripe CLI the events are signed and forwarded, matching production behavior. If you use ngrok, register the ngrok URL in the Stripe Dashboard and copy the webhook signing secret into your app when available.

Railway / Production deploy notes

- Add the following environment variables in Railway (Project → Variables):

	- `STRIPE_SECRET_KEY` = your Stripe secret key (sk_live_...)
	- `STRIPE_WEBHOOK_SECRET` = the signing secret for your webhook endpoint (whsec_...)

- Ensure the deployed webhook URL is set in Stripe Dashboard to:

	`https://<your-railway-app>.up.railway.app/api/stripe/webhook`

- In Stripe Dashboard → Developers → Webhooks, use the above URL and subscribe to these events at minimum:

	- `invoice.payment_succeeded`
	- `customer.subscription.created`
	- `customer.subscription.updated`
	- `customer.subscription.deleted`

- After you add the webhook endpoint in Stripe, copy the **Signing secret** (starts with `whsec_`) into Railway as `STRIPE_WEBHOOK_SECRET`.

Security notes

- Never commit `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` to source control.
- Keep `STRIPE_SECRET_KEY` only on the server and never expose it to the extension or client-side code. The extension should use the publishable key only.

Quick verification checklist

1. Start server locally: `npm run dev` (from `server/`).
2. Start `stripe listen` or `ngrok` and register webhook in Stripe.
3. Trigger a test event from Stripe Dashboard or `stripe trigger` and confirm server logs show the event.
4. Confirm your app's database or logic marks subscriptions active when `invoice.payment_succeeded` occurs.

If you want, I can run the local server and a quick webhook test from this environment (requires `stripe` CLI or `ngrok`).

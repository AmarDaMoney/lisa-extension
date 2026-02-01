# LISA Core - Full Stripe Integration Setup Guide

Complete guide to implementing Stripe payment processing in the LISA Core extension.

## 🎯 Overview

This guide covers the full implementation of Stripe subscription payments, including:
- Secure payment processing with Stripe Payment Element
- Subscription management
- Premium tier activation
- Webhook handling
- User subscription status tracking

## 📋 Prerequisites

1. **Stripe Account** - Sign up at [stripe.com](https://stripe.com)
2. **Backend API** - Your Railway app backend ready to handle Stripe
3. **Extension Access** - Developer mode access to Chrome extensions

## 🚀 Step-by-Step Setup

### Phase 1: Stripe Configuration

#### 1.1 Create Stripe Products

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Navigate to **Products** → **Create Product**

**Monthly Plan:**
- Name: `LISA Core Premium - Monthly`
- Description: `Unlimited exports, LISA Hash, cloud sync, priority support`
- Pricing:
  - Recurring: Monthly
  - Amount: $9.99
  - Currency: USD
- Copy the **Price ID** (looks like `price_1234567890`)

**Annual Plan:**
- Name: `LISA Core Premium - Annual`
- Description: `Annual subscription with 17% discount`
- Pricing:
  - Recurring: Yearly
  - Amount: $99.90
  - Currency: USD
- Copy the **Price ID**

#### 1.2 Get API Keys

1. Go to **Developers** → **API Keys**
2. Copy **Publishable Key** (looks like `pk_test_51234567890`)
   - Test: `pk_test_...` (for development)
   - Live: `pk_live_...` (for production)
3. Copy **Secret Key** (keep secure - only for backend)

#### 1.3 Set Up Webhooks (Backend)

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. URL: `https://lisa-web-backend-production.up.railway.app/webhooks/stripe`
4. Events to listen:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy **Signing Secret** (for backend webhook verification)

---

### Phase 2: Extension Configuration

#### 2.1 Update Stripe Config

Edit [src/stripe/stripe-config.js](src/stripe/stripe-config.js):

```javascript
const STRIPE_CONFIG = {
  // Replace with your actual Stripe publishable key
  publishableKey: 'pk_test_YOUR_KEY_HERE',
  
  products: {
    premium_monthly: {
      priceId: 'price_1234567890',  // From step 1.1
      // ... rest of config
    },
    premium_annual: {
      priceId: 'price_0987654321',  // From step 1.1
      // ... rest of config
    }
  },
  
  apiBaseUrl: 'https://lisa-web-backend-production.up.railway.app/api'
};
```

#### 2.2 Update popup.html

Add Stripe scripts before closing `</body>` tag in [src/popup/popup.html](src/popup/popup.html):

```html
<!-- Stripe Payment Processing -->
<script src="stripe/stripe-config.js"></script>
<script src="stripe/stripe-client.js"></script>
<script src="stripe/stripe-subscription-modal.js"></script>
<script src="stripe/stripe-payment-manager.js"></script>

<!-- Stripe Payment Element Library (loaded dynamically by stripe-client.js) -->
<!-- No need to add manually - loaded via CDN in stripe-client.js -->

<script src="popup.js"></script>
</body>
```

#### 2.3 Update popup.js

Add Stripe initialization to [src/popup/popup.js](src/popup/popup.js):

**In constructor:**
```javascript
constructor() {
  // ... existing properties
  this.stripePaymentManager = null;
  this.stripeClient = null;
  this.init();
}
```

**In init() method, add after setupChatSwitchToggle():**
```javascript
async init() {
  // ... existing initialization
  this.setupChatSwitchToggle();
  await this.initializeStripe();  // ADD THIS LINE
}
```

**Replace the initiateSubscription() method:**
```javascript
async initiateSubscription() {
  try {
    if (!this.stripePaymentManager) {
      console.warn('[LISA] Stripe not initialized');
      window.open('https://buy.stripe.com/test_your_product_link', '_blank');
      return;
    }

    this.trackEvent('subscription_initiated');
    this.stripePaymentManager.openSubscriptionModal();
  } catch (error) {
    console.error('[LISA] Error opening subscription modal:', error);
    this.showError('Failed to open subscription modal');
  }
}
```

**Add new methods to LISAPopup class:**

```javascript
// Initialize Stripe integration
async initializeStripe() {
  try {
    if (typeof STRIPE_CONFIG === 'undefined') {
      console.warn('[LISA] Stripe config not loaded');
      return;
    }

    this.stripeClient = new StripeClient(
      STRIPE_CONFIG.publishableKey,
      STRIPE_CONFIG.apiBaseUrl
    );

    this.stripePaymentManager = new StripePaymentManager(
      this.stripeClient,
      STRIPE_CONFIG
    );

    await this.stripePaymentManager.init();
    console.log('[LISA] Stripe integration initialized');

    await this.checkSubscriptionStatus();
  } catch (error) {
    console.error('[LISA] Failed to initialize Stripe:', error);
  }
}

// Check if user has active subscription
async checkSubscriptionStatus() {
  try {
    if (!this.stripePaymentManager) return;

    const subscription = await this.stripePaymentManager.getSubscriptionStatus();

    if (subscription.active && this.userTier !== 'premium') {
      await chrome.storage.sync.set({
        userTier: 'premium',
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        subscriptionExpiresAt: subscription.current_period_end
      });

      this.userTier = 'premium';
      this.updateTierBadge();
    }
  } catch (error) {
    console.error('[LISA] Error checking subscription status:', error);
  }
}

// Handle upgrade button click
handleUpgradeClick() {
  if (this.userTier === 'premium') {
    this.openSubscriptionManagement();
  } else {
    this.initiateSubscription();
  }
  this.trackEvent('upgrade_clicked');
}
```

**Update upgrade button listener in setupEventListeners():**

Find:
```javascript
document.getElementById('upgradeBtn').addEventListener('click', () => {
  this.openUpgradeModal();
});
```

Replace with:
```javascript
document.getElementById('upgradeBtn').addEventListener('click', () => {
  this.handleUpgradeClick();
});
```

---

### Phase 3: Backend Implementation

See [STRIPE_BACKEND_API.md](STRIPE_BACKEND_API.md) for complete backend requirements.

**Minimum endpoints needed:**
1. `POST /api/stripe/create-subscription` - Create payment intent
2. `GET /api/stripe/get-subscription` - Get subscription status
3. `POST /api/stripe/verify-subscription` - Verify active subscription

**Webhook handlers:**
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

---

### Phase 4: Testing

#### 4.1 Test Mode Setup

1. Keep Stripe in test mode (keys start with `pk_test_` and `sk_test_`)
2. Use test credit card: **4242 4242 4242 4242**
3. Expiry: Any future date (e.g., 12/25)
4. CVC: Any 3 digits (e.g., 123)

#### 4.2 Load Extension in Test Mode

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select your extension folder

#### 4.3 Test Payment Flow

1. Click extension icon
2. Click **⭐ Upgrade** button
3. Click **Subscribe Now**
4. Select billing period (monthly/annual)
5. Enter test card details
6. Complete payment
7. Verify:
   - Payment success modal appears
   - User tier changes to "⭐ Premium"
   - Premium features enabled
   - Subscription stored in `chrome.storage.sync`

#### 4.4 Test Subscription Management

1. With premium user, click upgrade button again
2. Verify **Manage Subscription** modal opens
3. Test **Cancel Subscription** flow
4. Verify cancellation confirmation
5. Check user tier reverts to "Free"

---

### Phase 5: Production Deployment

#### 5.1 Update to Live Keys

1. Switch Stripe to **Live** mode
2. Update [src/stripe/stripe-config.js](src/stripe/stripe-config.js):
   ```javascript
   publishableKey: 'pk_live_YOUR_PRODUCTION_KEY',
   ```
3. Update backend with live Stripe keys
4. Update webhook endpoint to production URL

#### 5.2 Submit to Chrome Web Store

1. Increment version number in manifest.json
2. Test thoroughly with live payments (use small amount first)
3. Generate store listing
4. Submit extension to Chrome Web Store

#### 5.3 Monitor Payments

- Stripe Dashboard: Monitor charges, subscriptions, disputes
- Backend logs: Verify webhook processing
- Extension usage: Monitor premium tier activations

---

## 🔒 Security Checklist

- [ ] Stripe publishable key is public (safe to expose)
- [ ] Stripe secret key stored only on backend (never in extension)
- [ ] Backend validates all API requests
- [ ] Webhook signatures verified
- [ ] Rate limiting enabled on backend
- [ ] HTTPS only for all communications
- [ ] Test with live payments before going public

---

## 📊 Monitoring & Analytics

Track these metrics:

- **Subscription starts:** `subscriptions_total`
- **Subscription cancellations:** `subscriptions_canceled`
- **Failed payments:** `payments_failed`
- **Revenue:** `revenue_total`
- **User adoption:** `premium_tier_percentage`

Integration with analytics:

```javascript
// Track subscription event
this.trackEvent('subscription_completed', { 
  plan: 'monthly|annual',
  amount: 9.99,
  currency: 'usd'
});

// Track cancellation
this.trackEvent('subscription_canceled', {
  subscription_id: 'sub_XXXX',
  duration_days: 30
});
```

---

## 🆘 Troubleshooting

### Payment Element Not Showing

**Check:**
- Stripe config is loaded: `console.log(STRIPE_CONFIG)`
- Publishable key is valid (not empty)
- Stripe.js library loaded: Search for "Stripe" in Network tab
- Modal HTML injected: Check DOM for `#payment-element`

### Subscription Creation Fails

**Check:**
- Backend API is accessible: Test endpoint with curl/Postman
- Backend has Stripe secret key configured
- Price IDs are valid in Stripe dashboard
- Backend returns proper JSON response

### User Not Marked Premium

**Check:**
- Webhook received from Stripe: Check backend logs
- Webhook signature verified
- User ID matches between extension and backend
- Storage sync working: `chrome.storage.sync.get('userTier')`

### Test Card Declined

**Common test cards:**
- Success: `4242 4242 4242 4242`
- Decline (insufficient funds): `4000 0000 0000 0002`
- Decline (lost card): `4000 0000 0000 9995`

See [Stripe test cards](https://stripe.com/docs/testing) for more.

---

## 📚 Resources

- [Stripe API Documentation](https://stripe.com/docs/api)
- [Stripe Payment Element Docs](https://stripe.com/docs/payments/payment-element)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)

---

## 💬 Support

For issues or questions:
1. Check [STRIPE_BACKEND_API.md](STRIPE_BACKEND_API.md) for API details
2. Review [STRIPE_INTEGRATION_GUIDE.md](STRIPE_INTEGRATION_GUIDE.md) for code integration
3. Check Stripe dashboard for payment details
4. Enable debug logging: Set `DEBUG=true` in extension storage

---

**Last Updated:** February 2026  
**Version:** 1.0

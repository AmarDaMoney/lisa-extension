# Stripe Integration - Quick Reference

## Files Created

### Core Stripe Modules
- **[src/stripe/stripe-config.js](src/stripe/stripe-config.js)** - Configuration and API keys
- **[src/stripe/stripe-client.js](src/stripe/stripe-client.js)** - Stripe API client
- **[src/stripe/stripe-subscription-modal.js](src/stripe/stripe-subscription-modal.js)** - UI components and styling
- **[src/stripe/stripe-payment-manager.js](src/stripe/stripe-payment-manager.js)** - Payment orchestration

### Documentation
- **[STRIPE_SETUP.md](STRIPE_SETUP.md)** - 📖 Complete setup guide (START HERE)
- **[STRIPE_BACKEND_API.md](STRIPE_BACKEND_API.md)** - Backend API requirements
- **[STRIPE_INTEGRATION_GUIDE.md](STRIPE_INTEGRATION_GUIDE.md)** - Code integration details
- **[STRIPE_QUICK_REFERENCE.md](STRIPE_QUICK_REFERENCE.md)** - This file

## Key Changes to Existing Files

### manifest.json
- Added `https://js.stripe.com/*` to host_permissions
- Added backend API URL to host_permissions

### popup.html
- Need to add script imports for Stripe modules (see STRIPE_SETUP.md Phase 2.2)

### popup.js
- Need to add Stripe initialization (see STRIPE_SETUP.md Phase 2.3)

## Quick Setup Checklist

```
Phase 1: Stripe Dashboard
[ ] Create Stripe account
[ ] Create monthly product ($9.99)
[ ] Create annual product ($99.90)
[ ] Get API keys (publishable + secret)
[ ] Set up webhooks

Phase 2: Extension Configuration
[ ] Update stripe-config.js with your keys
[ ] Update popup.html with script imports
[ ] Update popup.js with initialization code

Phase 3: Backend Implementation
[ ] Implement /api/stripe/create-subscription
[ ] Implement /api/stripe/get-subscription
[ ] Implement /api/stripe/verify-subscription
[ ] Implement /api/stripe/cancel-subscription
[ ] Set up webhook handlers

Phase 4: Testing
[ ] Load extension in Chrome dev mode
[ ] Test payment flow with 4242 4242 4242 4242
[ ] Test subscription management
[ ] Test cancellation

Phase 5: Production
[ ] Switch to live Stripe keys
[ ] Test with live payment
[ ] Submit to Chrome Web Store
```

## Files Breakdown

### 1. stripe-config.js (Configuration)
- ✅ Complete
- Contains:
  - Stripe publishable key
  - Product IDs and pricing
  - API endpoints
  - Element styling

**Action needed:** Replace with your Stripe keys

```javascript
publishableKey: 'pk_test_YOUR_KEY' // → Update
priceId: 'price_YOUR_ID'             // → Update
```

### 2. stripe-client.js (Core Client)
- ✅ Complete
- Contains:
  - Stripe initialization
  - Payment element mounting
  - Subscription creation
  - Payment confirmation
  - Subscription management (get, cancel, verify)

**No changes needed** - Ready to use

### 3. stripe-subscription-modal.js (UI)
- ✅ Complete
- Contains:
  - HTML for payment modals
  - CSS styling
  - Event listeners setup
  - All modal templates

**No changes needed** - Ready to use

### 4. stripe-payment-manager.js (Orchestration)
- ✅ Complete
- Contains:
  - Payment flow management
  - Modal lifecycle
  - Success/error handling
  - Subscription management UI
  - User feedback (messages, loading states)

**No changes needed** - Ready to use

## Usage in popup.js

### Initialize Stripe (in init method)
```javascript
await this.initializeStripe();
```

### Open Payment Modal
```javascript
this.stripePaymentManager.openSubscriptionModal();
```

### Open Manage Subscription (for premium users)
```javascript
await this.stripePaymentManager.openManageSubscriptionModal();
```

### Get Subscription Status
```javascript
const subscription = await this.stripePaymentManager.getSubscriptionStatus();
if (subscription.active) {
  // User is premium
}
```

## User Flow

1. Free user clicks **⭐ Upgrade**
2. Payment modal opens
3. User selects monthly or annual
4. User enters card details
5. Payment processed
6. Success modal shown
7. User tier upgraded to premium
8. Premium features unlocked

## For Premium Users

1. Click **⭐ Premium** badge
2. Manage subscription modal opens
3. Options:
   - View subscription details
   - Update payment method (coming soon)
   - Cancel subscription

## Backend Integration Points

1. **Create Subscription**
   - Frontend: `stripe.createSubscription(priceId, 'month|year')`
   - Backend: `POST /api/stripe/create-subscription`
   - Returns: `{ client_secret, subscription_id }`

2. **Get Subscription**
   - Frontend: `stripe.getSubscription()`
   - Backend: `GET /api/stripe/get-subscription`
   - Returns: `{ active, id, status, amount, interval }`

3. **Verify Subscription**
   - Frontend: `stripe.verifyAndActivatePremium()`
   - Backend: `POST /api/stripe/verify-subscription`
   - Updates: User tier in Chrome storage

4. **Cancel Subscription**
   - Frontend: `stripe.cancelSubscription()`
   - Backend: `POST /api/stripe/cancel-subscription`
   - Updates: User tier back to free

## Testing

### Test Mode (Development)
- Keys: `pk_test_...` / `sk_test_...`
- Card: `4242 4242 4242 4242`
- Expiry: Any future date
- CVC: Any 3 digits

### Live Mode (Production)
- Keys: `pk_live_...` / `sk_live_...`
- Real payment processing
- Real credit cards

## Debugging

### Enable console logging
All Stripe operations log to console with `[LISA Stripe]` prefix:
```javascript
console.log('[LISA Stripe] Stripe initialized');
console.error('[LISA Stripe] Payment failed:', error);
```

### Check storage
```javascript
chrome.storage.sync.get(['userTier', 'subscriptionId', 'userID'], (result) => {
  console.log('Storage:', result);
});
```

### Stripe test events
Monitor Stripe dashboard for:
- `customer.subscription.created`
- `invoice.payment_succeeded`
- `customer.subscription.deleted`

## Environment Variables

All config in **stripe-config.js**:
```javascript
publishableKey      // Stripe public key
apiBaseUrl         // Backend API endpoint
products           // Product definitions
stripeElementsStyle // UI styling
currency           // USD
locale             // en
```

## Security Notes

- ✅ Publishable key is public (safe to expose)
- ✅ Payment Element handles card data securely
- ⚠️ Secret key must ONLY be on backend
- ✅ All payments processed server-side
- ✅ Backend validates all requests
- ✅ Webhooks verify Stripe signature

## Common Issues

| Issue | Solution |
|-------|----------|
| Payment modal not showing | Check stripe-config.js is loaded |
| 401 Unauthorized from backend | Verify user_id is being sent |
| Subscription not activating | Check webhook configuration |
| CSS not loading | Verify script order in popup.html |
| Stripe library not found | Check js.stripe.com is accessible |

## Next Steps

1. **Read** [STRIPE_SETUP.md](STRIPE_SETUP.md) - Full setup guide
2. **Get Keys** from Stripe dashboard
3. **Update** stripe-config.js
4. **Implement** backend endpoints
5. **Test** with test card
6. **Deploy** to production

## Support Documents

- 📖 **STRIPE_SETUP.md** - Complete step-by-step guide
- 📋 **STRIPE_BACKEND_API.md** - API specifications
- 💻 **STRIPE_INTEGRATION_GUIDE.md** - Code integration instructions
- 🚀 **This file** - Quick reference

---

**Need help?** Start with [STRIPE_SETUP.md](STRIPE_SETUP.md)

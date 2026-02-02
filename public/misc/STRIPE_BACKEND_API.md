# Stripe Integration - Backend API Requirements

This document outlines the backend API endpoints required for full Stripe integration with LISA Core Extension.

## Base URL
```
https://lisa-web-backend-production.up.railway.app/api
```

## Endpoints Required

### 1. Create Subscription
**POST** `/stripe/create-subscription`

Creates a Stripe subscription for the user.

**Request:**
```json
{
  "user_id": "user_XXXX_random",
  "price_id": "price_XXX",
  "billing_cycle": "month|year",
  "return_url": "chrome-extension://xxx/popup.html"
}
```

**Response (Success - 200):**
```json
{
  "subscription_id": "sub_XXXX",
  "client_secret": "pi_XXXX_secret_XXXX",
  "status": "pending|active",
  "current_period_start": 1700000000,
  "current_period_end": 1702678400
}
```

**Response (Error - 400/500):**
```json
{
  "error": "Error message",
  "error_code": "XXXX"
}
```

---

### 2. Get Subscription Status
**GET** `/stripe/get-subscription`

Retrieves current subscription status for a user.

**Headers:**
```
X-User-ID: user_XXXX_random
```

**Response (Success - 200):**
```json
{
  "active": true,
  "id": "sub_XXXX",
  "status": "active|past_due|canceled",
  "plan_name": "LISA Premium - Monthly",
  "amount": 999,
  "interval": "month|year",
  "current_period_start": 1700000000,
  "current_period_end": 1702678400,
  "cancel_at_period_end": false
}
```

**Response (No Subscription - 200):**
```json
{
  "active": false
}
```

---

### 3. Verify Subscription
**POST** `/stripe/verify-subscription`

Verifies subscription validity (useful for one-time checks after payment).

**Headers:**
```
X-User-ID: user_XXXX_random
```

**Response (Success - 200):**
```json
{
  "valid": true,
  "subscription_id": "sub_XXXX",
  "status": "active"
}
```

---

### 4. Cancel Subscription
**POST** `/stripe/cancel-subscription`

Cancels an active subscription.

**Headers:**
```
X-User-ID: user_XXXX_random
```

**Request:**
```json
{
  "immediate": false
}
```

**Response (Success - 200):**
```json
{
  "canceled": true,
  "subscription_id": "sub_XXXX",
  "cancellation_date": "2024-12-15T10:00:00Z"
}
```

---

### 5. Update Payment Method
**POST** `/stripe/update-payment-method`

Updates the payment method for an existing subscription (for future expansion).

**Headers:**
```
X-User-ID: user_XXXX_random
```

**Request:**
```json
{
  "payment_method_id": "pm_XXXX"
}
```

**Response (Success - 200):**
```json
{
  "updated": true,
  "subscription_id": "sub_XXXX"
}
```

---

## Webhook Events (Backend must handle)

The backend must set up Stripe webhook listeners for these events:

### 1. `customer.subscription.created`
- Create/store user subscription record
- Update user tier to premium

### 2. `customer.subscription.updated`
- Update subscription status in database

### 3. `customer.subscription.deleted`
- Mark subscription as canceled
- Downgrade user to free tier

### 4. `invoice.payment_succeeded`
- Log successful payment
- Send confirmation email (optional)
- Ensure user remains premium

### 5. `invoice.payment_failed`
- Log failed payment attempt
- Update subscription status
- Send failure notification email (optional)

### 6. `customer.subscription.trial_will_end`
- Prepare trial ending notifications (if using trials)

---

## User ID Management

The extension generates a unique user ID for each device:
```
Format: user_{timestamp}_{random_string}
Example: user_1700000000_a1b2c3d4e5
```

This ID is stored in `chrome.storage.sync` under key `userID` and used to link subscriptions to devices/users.

---

## Stripe Products Configuration

Your backend should have these Stripe products configured:

### Monthly Plan
- **Product:** LISA Core Premium - Monthly
- **Price ID:** `price_XXXX` (must be recurring, monthly)
- **Amount:** $9.99 USD
- **Recurring:** Monthly

### Annual Plan
- **Product:** LISA Core Premium - Annual
- **Price ID:** `price_XXXX` (must be recurring, annual)
- **Amount:** $99.90 USD ($99.90 = $8.32/month, 17% savings)
- **Recurring:** Yearly

---

## Security Considerations

1. **Always validate user_id** - Never trust client-side user identification
2. **Use HTTPS only** - All API calls must be encrypted
3. **Validate price_id** - Only allow whitelisted product IDs
4. **Rate limiting** - Implement rate limiting to prevent abuse
5. **Webhook signatures** - Always verify Stripe webhook signatures
6. **CORS** - Configure appropriate CORS headers for extension origin

---

## Error Handling

All endpoints should return appropriate HTTP status codes:

- `200` - Success
- `400` - Bad request (invalid parameters)
- `401` - Unauthorized (invalid user_id or token)
- `403` - Forbidden (user lacks permission)
- `404` - Not found (user/subscription not found)
- `409` - Conflict (subscription already exists)
- `429` - Too many requests (rate limited)
- `500` - Server error

---

## Testing

For development/testing:

1. Use Stripe Test API keys
2. Use test credit card: `4242 4242 4242 4242`
3. Any future expiration date
4. Any 3-digit CVC

---

## Implementation Timeline

1. **Phase 1:** Implement endpoints 1-3 (Create, Get, Verify subscription)
2. **Phase 2:** Implement endpoint 4 (Cancel subscription)
3. **Phase 3:** Set up webhook handlers
4. **Phase 4:** Implement endpoint 5 (Update payment method)
5. **Phase 5:** Add subscription management dashboard

---

## Support

For questions about Stripe integration, refer to:
- [Stripe API Documentation](https://stripe.com/docs)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- LISA Core Extension Stripe Module in `src/stripe/`

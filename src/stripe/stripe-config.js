/**
 * LISA Core - Stripe Configuration
 * Manages Stripe API keys and configuration
 */

const STRIPE_CONFIG = {
  // Use test key for development, production key for live
  publishableKey: 'pk_test_YOUR_STRIPE_PUBLISHABLE_KEY_HERE', // Replace with actual key
  
  // Stripe products configuration
  products: {
    premium_monthly: {
      priceId: 'price_YOUR_MONTHLY_PRICE_ID',
      name: 'LISA Core Premium - Monthly',
      amount: 999, // $9.99 in cents
      interval: 'month',
      description: 'Unlimited exports, LISA Hash, cloud sync, priority support'
    },
    premium_annual: {
      priceId: 'price_YOUR_ANNUAL_PRICE_ID',
      name: 'LISA Core Premium - Annual',
      amount: 99900, // $99.90 in cents (save 17%)
      interval: 'year',
      description: 'Annual subscription with 17% discount'
    }
  },

  // API endpoints (use your backend)
  apiBaseUrl: 'https://lisa-web-backend-production.up.railway.app/api',
  
  endpoints: {
    createPaymentIntent: '/stripe/create-payment-intent',
    createSubscription: '/stripe/create-subscription',
    getSubscription: '/stripe/get-subscription',
    cancelSubscription: '/stripe/cancel-subscription',
    verifySubscription: '/stripe/verify-subscription',
    webhookSecret: '/stripe/webhook-secret' // Optional: for local webhook verification
  },

  // Stripe Elements styles
  stripeElementsStyle: {
    base: {
      fontSize: '16px',
      color: '#424770',
      fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      '::placeholder': {
        color: '#aab7c4'
      }
    },
    invalid: {
      color: '#fa755a',
      iconColor: '#fa755a'
    }
  },

  // Default currency
  currency: 'usd',

  // Locale for Stripe Elements
  locale: 'en'
};

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = STRIPE_CONFIG;
}

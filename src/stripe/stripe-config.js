/**
 * LISA Core - Stripe Configuration
 * Manages Stripe API keys and configuration
 */

const STRIPE_CONFIG = {
  // Use live publishable key provided for the extension (do NOT include secret keys here)
  publishableKey: 'pk_live_51SqXDpRCWqG97BQip7QBLUxs8UgWMjRqVgi3Xj0KS5jH48RvaxxVtnKcTr82KBb3AOZ9SvX3J5Kc6I5JSbaPvwVG00IeDxOIXq',
  
  // Stripe products configuration (use your Price IDs)
  products: {
    premium_monthly: {
      priceId: 'price_1T2dkFRCWqG97BQicrv4DIOX',
      name: 'LISA Core Extension Pro - Monthly',
      amount: 1900, // $19.00 in cents
      interval: 'month',
      description: 'LISA Pro: 50 compressions/day, cloud sync, 1M character limit, priority support'
    },
    premium_annual: {
      priceId: 'price_1T2dqQRCWqG97BQi80BwKgtR',
      name: 'LISA Core Extension Pro - Annual',
      amount: 7900, // $79.00 in cents
      interval: 'year',
      description: 'Annual LISA Pro: 50 compressions/day, cloud sync, 1M character limit, priority support'
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

/**
 * LISA Core - Stripe Configuration
 * Manages Stripe API keys and configuration
 */

const STRIPE_CONFIG = {
  // Use live publishable key provided for the extension (do NOT include secret keys here)
  publishableKey: 'pk_live_51SqXDpRCWqG97BQitVvsFEYO4FWV2ugB7NO0Do8xs8OAPnoyMnHwrlsMCSzTAULwqs39HdEx1UNbmdyVhWtEpkUx002eCSHGWo',
  
  // Stripe products configuration (use your Price IDs)
  products: {
    premium_monthly: {
      priceId: 'price_1TWadARCWqG97BQiHqr7MOMs',
      name: 'LISA Core Extension Pro - Monthly',
      amount: 999, // $9.99 in cents
      interval: 'month',
      description: 'LISA Pro: 50 compressions/day, cloud sync, 1M character limit, priority support'
    },
    premium_annual: {
      priceId: 'price_1TWairRCWqG97BQi5HLUnYE0',
      name: 'LISA Core Extension Pro - Annual',
      amount: 8999, // $89.99 in cents
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
    createPortalSession: '/create-portal-session', // Customer portal for manage/cancel
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

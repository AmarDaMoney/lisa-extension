/**
 * LISA Core - Stripe Client
 * Handles all Stripe payment operations and subscription management
 * Updated: Uses Stripe Checkout Sessions for Chrome Extension compatibility
 */

class StripeClient {
  constructor(publishableKey, apiBaseUrl) {
    this.publishableKey = publishableKey;
    this.apiBaseUrl = apiBaseUrl;
    this.stripe = null;
    this.elements = null;
    this.cardElement = null;
    this.paymentElement = null;
    this.clientSecret = null;
    this.subscriptionId = null;
  }

  /**
   * Initialize Stripe - simplified for Checkout Sessions
   */
  async init() {
    try {
      console.log('[LISA Stripe] Client initialized (Checkout Session mode)');
      return true;
    } catch (error) {
      console.error('[LISA Stripe] Failed to initialize:', error);
      throw new Error('Failed to initialize payment system');
    }
  }

  /**
   * Create Stripe Checkout Session and redirect to payment page
   * This is the recommended approach for Chrome Extensions (no external scripts needed)
   */
  async createCheckoutSession(priceId, billingCycle = 'month') {
    try {
      const userID = await this.getUserID();
      
      // Get the success/cancel URLs for the extension
      const successUrl = chrome.runtime.getURL('src/popup/success.html') + '?session_id={CHECKOUT_SESSION_ID}';
      const cancelUrl = chrome.runtime.getURL('src/popup/popup.html') + '?payment_cancelled=true';
      
      console.log('[LISA Stripe] Creating checkout session...', { priceId, billingCycle });
      
      // Use the website checkout endpoint (not /stripe/ prefix)
      const response = await fetch(`${this.apiBaseUrl}/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId: priceId,
          successUrl: successUrl,
          cancelUrl: cancelUrl
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[LISA Stripe] Server error:', response.status, errorText);
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      console.log('[LISA Stripe] Checkout session created:', data);
      
      if (data.url) {
        // Redirect to Stripe Checkout
        return data;
      } else {
        throw new Error('No checkout URL returned from server');
      }
    } catch (error) {
      console.error('[LISA Stripe] Failed to create checkout session:', error);
      throw error;
    }
  }

  /**
   * Open Stripe Checkout in a new tab (works with Chrome Extensions)
   */
  async openCheckout(priceId, billingCycle = 'month') {
    try {
      const sessionData = await this.createCheckoutSession(priceId, billingCycle);
      
      if (sessionData.url) {
        // Open Stripe Checkout in a new tab
        chrome.tabs.create({ url: sessionData.url });
        return { success: true, redirected: true };
      } else {
        throw new Error('No checkout URL available');
      }
    } catch (error) {
      console.error('[LISA Stripe] Failed to open checkout:', error);
      throw error;
    }
  }

  /**
   * Verify checkout session after payment
   */
  async verifyCheckoutSession(sessionId) {
    try {
      const userID = await this.getUserID();
      
      const response = await fetch(`${this.apiBaseUrl}/stripe/verify-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
          user_id: userID
        })
      });

      if (!response.ok) {
        throw new Error(`Verification failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('[LISA Stripe] Session verified:', data);
      
      if (data.status === 'complete' || data.payment_status === 'paid') {
        // Activate premium
        await chrome.storage.sync.set({
          userTier: 'premium',
          subscriptionId: data.subscription_id || data.subscription,
          subscriptionStatus: 'active',
          subscriptionUpdatedAt: new Date().toISOString()
        });
        return { success: true, data };
      }
      
      return { success: false, data };
    } catch (error) {
      console.error('[LISA Stripe] Session verification failed:', error);
      throw error;
    }
  }

  // Legacy methods kept for compatibility but deprecated
  
  /**
   * @deprecated Use createCheckoutSession instead
   */
  async createSubscription(priceId, billingCycle = 'month') {
    console.warn('[LISA Stripe] createSubscription is deprecated, use createCheckoutSession');
    return this.createCheckoutSession(priceId, billingCycle);
  }

  /**
   * @deprecated Payment Element not supported in Chrome Extensions
   */
  async createPaymentElement(containerId, clientSecret) {
    console.warn('[LISA Stripe] Payment Element not supported in Chrome Extensions. Use Checkout Sessions.');
    throw new Error('Payment Element not supported. Please use the Subscribe button to open Stripe Checkout.');
  }

  /**
   * @deprecated Use openCheckout instead
   */
  async confirmPayment() {
    console.warn('[LISA Stripe] confirmPayment is deprecated, use openCheckout');
    throw new Error('Direct payment confirmation not supported. Please use Stripe Checkout.');
  }

  /**
   * Get subscription status
   */
  async getSubscription() {
    try {
      const userID = await this.getUserID();
      
      const response = await fetch(`${this.apiBaseUrl}/stripe/get-subscription`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': userID
        }
      });

      if (!response.ok) {
        return { active: false };
      }

      const data = await response.json();
      console.log('[LISA Stripe] Subscription status:', data);
      return data;
    } catch (error) {
      console.error('[LISA Stripe] Failed to get subscription:', error);
      return { active: false };
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription() {
    try {
      const userID = await this.getUserID();
      
      const response = await fetch(`${this.apiBaseUrl}/stripe/cancel-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': userID
        }
      });

      if (!response.ok) {
        throw new Error('Failed to cancel subscription');
      }

      const data = await response.json();
      console.log('[LISA Stripe] Subscription cancelled:', data);
      
      // Clear subscription from storage
      await chrome.storage.sync.set({
        userTier: 'free',
        subscriptionId: null,
        subscriptionStatus: 'cancelled'
      });

      return data;
    } catch (error) {
      console.error('[LISA Stripe] Failed to cancel subscription:', error);
      throw error;
    }
  }

  /**
   * Verify subscription and activate premium
   */
  async verifyAndActivatePremium() {
    try {
      const subscription = await this.getSubscription();
      
      if (subscription.active || subscription.status === 'active') {
        // Store premium status
        await chrome.storage.sync.set({
          userTier: 'premium',
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          subscriptionExpiresAt: subscription.current_period_end,
          subscriptionUpdatedAt: new Date().toISOString()
        });

        return true;
      }

      return false;
    } catch (error) {
      console.error('[LISA Stripe] Failed to verify subscription:', error);
      return false;
    }
  }

  /**
   * Get or create user ID for this device
   */
  async getUserID() {
    try {
      let result = await chrome.storage.sync.get(['userID']);
      
      if (!result.userID) {
        // Generate new user ID
        const userID = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await chrome.storage.sync.set({ userID });
        return userID;
      }
      
      return result.userID;
    } catch (error) {
      console.error('[LISA Stripe] Failed to get user ID:', error);
      throw error;
    }
  }

  /**
   * Handle payment success
   */
  async handlePaymentSuccess() {
    try {
      // Wait a bit for server to process webhook
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify subscription is active
      const activated = await this.verifyAndActivatePremium();
      
      if (activated) {
        console.log('[LISA Stripe] Premium activated successfully');
        return { success: true, message: 'Premium activated!' };
      } else {
        console.warn('[LISA Stripe] Premium activation pending');
        return { success: true, message: 'Payment received! Premium will be activated shortly.' };
      }
    } catch (error) {
      console.error('[LISA Stripe] Error handling payment success:', error);
      throw error;
    }
  }

  /**
   * Format currency amount
   */
  formatPrice(amount, currency = 'usd') {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    });
    return formatter.format(amount / 100);
  }

  /**
   * Cleanup Stripe elements
   */
  cleanup() {
    if (this.paymentElement) {
      this.paymentElement.unmount();
      this.paymentElement = null;
    }
    
    if (this.cardElement) {
      this.cardElement.unmount();
      this.cardElement = null;
    }
    
    if (this.elements) {
      this.elements = null;
    }
  }
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StripeClient;
}

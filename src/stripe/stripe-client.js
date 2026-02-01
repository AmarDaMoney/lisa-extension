/**
 * LISA Core - Stripe Client
 * Handles all Stripe payment operations and subscription management
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
   * Initialize Stripe
   */
  async init() {
    try {
      // Load Stripe library
      if (!window.Stripe) {
        await this.loadStripeLibrary();
      }
      
      this.stripe = Stripe(this.publishableKey);
      console.log('[LISA Stripe] Stripe initialized');
      return true;
    } catch (error) {
      console.error('[LISA Stripe] Failed to initialize Stripe:', error);
      throw new Error('Failed to initialize payment system');
    }
  }

  /**
   * Load Stripe library from CDN
   */
  loadStripeLibrary() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Stripe library'));
      document.head.appendChild(script);
    });
  }

  /**
   * Create Payment Element for subscription
   */
  async createPaymentElement(containerId) {
    try {
      if (!this.stripe) {
        await this.init();
      }

      this.elements = this.stripe.elements();
      this.paymentElement = this.elements.create('payment');
      this.paymentElement.mount(`#${containerId}`);

      console.log('[LISA Stripe] Payment element created');
      return this.paymentElement;
    } catch (error) {
      console.error('[LISA Stripe] Failed to create payment element:', error);
      throw error;
    }
  }

  /**
   * Create subscription via backend
   */
  async createSubscription(priceId, billingCycle = 'month') {
    try {
      // Get current user/device ID from storage
      const userID = await this.getUserID();
      
      const response = await fetch(`${this.apiBaseUrl}/stripe/create-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userID,
          price_id: priceId,
          billing_cycle: billingCycle,
          return_url: chrome.runtime.getURL('src/popup/popup.html')
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.client_secret) {
        this.clientSecret = data.client_secret;
      }
      
      if (data.subscription_id) {
        this.subscriptionId = data.subscription_id;
      }

      console.log('[LISA Stripe] Subscription created:', data);
      return data;
    } catch (error) {
      console.error('[LISA Stripe] Failed to create subscription:', error);
      throw error;
    }
  }

  /**
   * Confirm payment with card details
   */
  async confirmPayment() {
    try {
      if (!this.stripe || !this.elements) {
        throw new Error('Stripe not initialized');
      }

      if (!this.clientSecret) {
        throw new Error('No client secret available');
      }

      const { error, paymentIntent } = await this.stripe.confirmPayment({
        elements: this.elements,
        clientSecret: this.clientSecret,
        confirmParams: {
          return_url: chrome.runtime.getURL('src/popup/popup.html?payment_success=true')
        },
        redirect: 'if_required'
      });

      if (error) {
        console.error('[LISA Stripe] Payment confirmation error:', error);
        throw new Error(error.message || 'Payment failed');
      }

      console.log('[LISA Stripe] Payment confirmed:', paymentIntent);
      return paymentIntent;
    } catch (error) {
      console.error('[LISA Stripe] Payment confirmation failed:', error);
      throw error;
    }
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

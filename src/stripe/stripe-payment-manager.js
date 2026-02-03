/**
 * LISA Core - Stripe Payment Integration Manager
 * Handles all Stripe payment flows and subscription management
 * Updated: Uses Stripe Checkout Sessions for Chrome Extension compatibility
 */

class StripePaymentManager {
  constructor(stripeClient, config) {
    this.stripe = stripeClient;
    this.config = config;
    this.currentPlan = 'month'; // 'month' or 'year'
    this.isProcessing = false;
  }

  /**
   * Initialize Stripe integration and attach event listeners
   */
  async init() {
    try {
      // Initialize Stripe client
      await this.stripe.init();
      
      // Inject modal HTML and CSS into popup
      this.injectModalUI();
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Check for payment success/cancel parameters
      this.checkUrlParameters();
      
      console.log('[LISA] Stripe Payment Manager initialized (Checkout Session mode)');
      return true;
    } catch (error) {
      console.error('[LISA] Failed to initialize Stripe:', error);
      throw error;
    }
  }

  /**
   * Inject modal HTML and CSS into the popup
   */
  injectModalUI() {
    try {
      // Check if modal content exists in window (from stripe-subscription-modal.js)
      if (typeof STRIPE_SUBSCRIPTION_MODAL_HTML === 'undefined' || 
          typeof STRIPE_SUBSCRIPTION_MODAL_CSS === 'undefined') {
        console.warn('[LISA] Stripe modal templates not found');
        return;
      }

      // Add modal HTML to body
      const container = document.createElement('div');
      container.innerHTML = STRIPE_SUBSCRIPTION_MODAL_HTML;
      document.body.appendChild(container);

      // Add modal CSS
      const style = document.createElement('style');
      style.textContent = STRIPE_SUBSCRIPTION_MODAL_CSS;
      document.head.appendChild(style);

      console.log('[LISA] Stripe UI injected');
    } catch (error) {
      console.error('[LISA] Failed to inject Stripe UI:', error);
    }
  }

  /**
   * Setup event listeners for all stripe modals
   */
  setupEventListeners() {
    // Subscription modal events
    const closeBtn = document.getElementById('closeStripeModalBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeSubscriptionModal());
    }

    // Billing toggle
    const billingToggles = document.querySelectorAll('.billing-toggle');
    billingToggles.forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        this.handleBillingToggle(e.target.closest('.billing-toggle'));
      });
    });

    // Payment form submission - now redirects to Stripe Checkout
    const form = document.getElementById('stripePaymentForm');
    if (form) {
      form.addEventListener('submit', (e) => this.handlePaymentSubmit(e));
    }

    // Modal close events
    this.setupModalCloseListeners();

    // Success modal events
    const goBackBtn = document.getElementById('goBackBtn');
    if (goBackBtn) {
      goBackBtn.addEventListener('click', () => {
        const modal = document.getElementById('stripeSuccessModal');
        if (modal) modal.style.display = 'none';
        // Reload popup to reflect premium status
        window.location.reload();
      });
    }

    const closeSuccessBtn = document.getElementById('closeSuccessModalBtn');
    if (closeSuccessBtn) {
      closeSuccessBtn.addEventListener('click', () => {
        const modal = document.getElementById('stripeSuccessModal');
        if (modal) modal.style.display = 'none';
        window.location.reload();
      });
    }
  }

  /**
   * Setup listeners for closing modals on overlay click
   */
  setupModalCloseListeners() {
    ['stripeSubscriptionModal', 'stripeSuccessModal', 'manageSubscriptionModal', 'cancelConfirmModal'].forEach(modalId => {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            modal.style.display = 'none';
          }
        });
      }
    });
  }

  /**
   * Open subscription modal - simplified for Checkout Sessions
   */
  async openSubscriptionModal() {
    const modal = document.getElementById('stripeSubscriptionModal');
    if (modal) {
      // Hide the payment element container since we're using Checkout
      const paymentElementContainer = document.getElementById('payment-element');
      if (paymentElementContainer) {
        paymentElementContainer.innerHTML = `
          <div style="text-align: center; padding: 20px; color: #666;">
            <p>Click "Subscribe" to proceed to secure checkout</p>
            <p style="font-size: 12px; margin-top: 10px;">
              🔒 You'll be redirected to Stripe's secure payment page
            </p>
          </div>
        `;
      }
      
      // Update button text
      this.updateSubmitButtonText();
      
      modal.style.display = 'flex';
    }
  }

  /**
   * Close subscription modal
   */
  closeSubscriptionModal() {
    const modal = document.getElementById('stripeSubscriptionModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Update submit button text based on plan
   */
  updateSubmitButtonText() {
    const price = this.currentPlan === 'month' ? '$9.00/month' : '$79.00/year';
    const buttonText = document.getElementById('submit-button-text');
    if (buttonText) {
      buttonText.textContent = `Subscribe - ${price}`;
    }
  }

  /**
   * Handle billing cycle toggle
   */
  handleBillingToggle(button) {
    if (!button) return;

    // Update active state
    document.querySelectorAll('.billing-toggle').forEach(btn => {
      btn.classList.remove('active');
    });
    button.classList.add('active');

    // Update plan
    this.currentPlan = button.dataset.period;
    
    // Update button text
    this.updateSubmitButtonText();

    console.log('[LISA] Billing plan changed to:', this.currentPlan);
  }

  /**
   * Handle payment form submission - opens Stripe Checkout
   */
  async handlePaymentSubmit(e) {
    e.preventDefault();

    if (this.isProcessing) return;
    this.isProcessing = true;

    const submitBtn = document.getElementById('submit-stripe-form');
    const spinnerEl = document.getElementById('submit-button-spinner');
    const textEl = document.getElementById('submit-button-text');

    try {
      // Show loading state
      if (submitBtn) submitBtn.disabled = true;
      if (spinnerEl) spinnerEl.style.display = 'inline-block';
      if (textEl) textEl.style.display = 'none';

      this.showPaymentMessage('Redirecting to checkout...', 'info');

      // Get the correct price ID based on selected plan
      const priceId = this.currentPlan === 'month'
        ? this.config.products.premium_monthly.priceId
        : this.config.products.premium_annual.priceId;

      // Open Stripe Checkout in a new tab
      const result = await this.stripe.openCheckout(priceId, this.currentPlan);
      
      if (result.redirected) {
        // Close the modal since user is redirected to Stripe
        this.closeSubscriptionModal();
        console.log('[LISA] User redirected to Stripe Checkout');
      }

    } catch (error) {
      console.error('[LISA] Failed to open checkout:', error);
      this.showPaymentMessage('Failed to open checkout: ' + error.message, 'error');
    } finally {
      // Reset loading state
      this.isProcessing = false;
      if (submitBtn) submitBtn.disabled = false;
      if (spinnerEl) spinnerEl.style.display = 'none';
      if (textEl) textEl.style.display = 'inline';
    }
  }

  /**
   * Show payment message
   */
  showPaymentMessage(message, type) {
    const messageEl = document.getElementById('payment-message');
    if (messageEl) {
      messageEl.textContent = message;
      messageEl.className = `message ${type}`;
      messageEl.style.display = 'block';
    }
  }

  /**
   * Check URL parameters for payment success/cancel
   */
  checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    
    if (urlParams.has('payment_cancelled')) {
      console.log('[LISA] Payment was cancelled');
      // Clear URL parameter
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    if (urlParams.has('session_id')) {
      // This shouldn't happen in popup.html, but handle it just in case
      const sessionId = urlParams.get('session_id');
      this.handleCheckoutSuccess(sessionId);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  /**
   * Handle checkout success (called from success.html)
   */
  async handleCheckoutSuccess(sessionId) {
    try {
      console.log('[LISA] Verifying checkout session:', sessionId);
      
      const result = await this.stripe.verifyCheckoutSession(sessionId);
      
      if (result.success) {
        console.log('[LISA] Payment verified successfully!');
        this.showSuccessModal();
      } else {
        console.warn('[LISA] Payment verification pending');
      }
      
    } catch (error) {
      console.error('[LISA] Error verifying checkout:', error);
    }
  }

  /**
   * Show success modal
   */
  async showSuccessModal() {
    try {
      // Get subscription details
      const subscription = await this.stripe.getSubscription();

      // Update modal with subscription details
      const nextBillingEl = document.getElementById('nextBillingDate');
      if (nextBillingEl && subscription.current_period_end) {
        const date = new Date(subscription.current_period_end * 1000);
        nextBillingEl.textContent = date.toLocaleDateString();
      }

      // Show modal
      const modal = document.getElementById('stripeSuccessModal');
      if (modal) {
        modal.style.display = 'flex';
      }

    } catch (error) {
      console.error('[LISA] Failed to show success modal:', error);
    }
  }

  /**
   * Open manage subscription modal
   */
  async openManageSubscriptionModal() {
    try {
      const subscription = await this.stripe.getSubscription();

      if (!subscription.active && subscription.status !== 'active') {
        console.warn('[LISA] No active subscription');
        return;
      }

      // Update modal with subscription details
      const statusEl = document.getElementById('subStatus');
      if (statusEl) {
        statusEl.textContent = subscription.status || 'Active';
      }

      const planEl = document.getElementById('subPlan');
      if (planEl) {
        planEl.textContent = subscription.plan_name || 'LISA Premium';
      }

      const amountEl = document.getElementById('subAmount');
      if (amountEl && subscription.amount) {
        const amount = this.stripe.formatPrice(subscription.amount);
        amountEl.textContent = amount + `/${subscription.interval || 'month'}`;
      }

      const renewDateEl = document.getElementById('subRenewDate');
      if (renewDateEl && subscription.current_period_end) {
        const date = new Date(subscription.current_period_end * 1000);
        renewDateEl.textContent = date.toLocaleDateString();
      }

      // Setup action buttons
      const updatePaymentBtn = document.getElementById('updatePaymentBtn');
      if (updatePaymentBtn) {
        updatePaymentBtn.onclick = () => {
          alert('Payment method update coming soon!');
        };
      }

      const cancelSubBtn = document.getElementById('cancelSubBtn');
      if (cancelSubBtn) {
        cancelSubBtn.onclick = () => {
          this.showCancelConfirmation();
        };
      }

      // Show modal
      const modal = document.getElementById('manageSubscriptionModal');
      if (modal) {
        modal.style.display = 'flex';
      }

    } catch (error) {
      console.error('[LISA] Failed to open manage subscription modal:', error);
    }
  }

  /**
   * Show cancellation confirmation
   */
  showCancelConfirmation() {
    const modal = document.getElementById('cancelConfirmModal');
    if (modal) {
      modal.style.display = 'flex';
    }

    const confirmBtn = document.getElementById('confirmCancelBtn');
    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        await this.handleCancelSubscription();
      };
    }

    const keepBtn = document.getElementById('keepSubBtn');
    if (keepBtn) {
      keepBtn.onclick = () => {
        modal.style.display = 'none';
      };
    }
  }

  /**
   * Handle subscription cancellation
   */
  async handleCancelSubscription() {
    try {
      const result = await this.stripe.cancelSubscription();
      
      const modal = document.getElementById('cancelConfirmModal');
      if (modal) {
        modal.style.display = 'none';
      }

      const manageModal = document.getElementById('manageSubscriptionModal');
      if (manageModal) {
        manageModal.style.display = 'none';
      }

      alert('Subscription cancelled successfully');
      console.log('[LISA] Subscription cancelled:', result);
      
      // Reload to update UI
      window.location.reload();

    } catch (error) {
      console.error('[LISA] Failed to cancel subscription:', error);
      alert('Failed to cancel subscription: ' + error.message);
    }
  }

  /**
   * Get subscription status for UI
   */
  async getSubscriptionStatus() {
    try {
      return await this.stripe.getSubscription();
    } catch (error) {
      console.error('[LISA] Failed to get subscription status:', error);
      return { active: false };
    }
  }
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StripePaymentManager;
}

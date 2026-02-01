/**
 * LISA Core - Stripe Payment Integration Manager
 * Handles all Stripe payment flows and subscription management
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
      // Initialize Stripe
      await this.stripe.init();
      
      // Inject modal HTML and CSS into popup
      this.injectModalUI();
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Check for payment success parameters
      this.checkPaymentSuccess();
      
      console.log('[LISA] Stripe Payment Manager initialized');
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
      // Import modal content (loaded from stripe-subscription-modal.js)
      const { STRIPE_SUBSCRIPTION_MODAL_HTML, STRIPE_SUBSCRIPTION_MODAL_CSS } = 
        typeof STRIPE_SUBSCRIPTION_MODAL !== 'undefined' 
          ? window 
          : require('./stripe-subscription-modal.js');

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

    // Payment form submission
    const form = document.getElementById('stripePaymentForm');
    if (form) {
      form.addEventListener('submit', (e) => this.handlePaymentSubmit(e));
    }

    // Modal close events
    this.setupModalCloseListeners();
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
   * Open subscription modal
   */
  openSubscriptionModal() {
    const modal = document.getElementById('stripeSubscriptionModal');
    if (modal) {
      modal.style.display = 'flex';
      // Mount payment element
      this.mountPaymentElement();
    }
  }

  /**
   * Close subscription modal
   */
  closeSubscriptionModal() {
    const modal = document.getElementById('stripeSubscriptionModal');
    if (modal) {
      modal.style.display = 'none';
      this.stripe.cleanup();
    }
  }

  /**
   * Mount Stripe Payment Element
   */
  async mountPaymentElement() {
    try {
      // Create payment element
      await this.stripe.createPaymentElement('payment-element');
      console.log('[LISA] Payment element mounted');
    } catch (error) {
      console.error('[LISA] Failed to mount payment element:', error);
      this.showPaymentMessage(error.message, 'error');
    }
  }

  /**
   * Handle billing cycle toggle
   */
  handleBillingToggle(button) {
    // Update active state
    document.querySelectorAll('.billing-toggle').forEach(btn => {
      btn.classList.remove('active');
    });
    button.classList.add('active');

    // Update plan
    this.currentPlan = button.dataset.period;

    // Update button text
    const submitBtn = document.getElementById('submit-stripe-form');
    const price = this.currentPlan === 'month' 
      ? '$9.99/month' 
      : '$99.90/year';
    const buttonText = document.getElementById('submit-button-text');
    if (buttonText) {
      buttonText.textContent = `Subscribe - ${price}`;
    }

    console.log('[LISA] Billing plan changed to:', this.currentPlan);
  }

  /**
   * Handle payment form submission
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
      submitBtn.disabled = true;
      spinnerEl.style.display = 'inline-block';
      textEl.style.display = 'none';

      this.showPaymentMessage('Creating subscription...', 'info');

      // Get the correct price ID based on selected plan
      const priceId = this.currentPlan === 'month'
        ? this.config.products.premium_monthly.priceId
        : this.config.products.premium_annual.priceId;

      // Create subscription on server
      const subData = await this.stripe.createSubscription(priceId, this.currentPlan);
      console.log('[LISA] Subscription created:', subData);

      // Confirm payment
      const paymentResult = await this.stripe.confirmPayment();
      console.log('[LISA] Payment confirmed:', paymentResult);

      // Show success message
      this.showPaymentMessage('Payment successful!', 'success');

      // Close subscription modal
      this.closeSubscriptionModal();

      // Show success modal
      await this.showSuccessModal();

      // Track event
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({
          action: 'trackEvent',
          event: 'subscription_completed',
          data: { plan: this.currentPlan }
        }).catch(() => {});
      }

    } catch (error) {
      console.error('[LISA] Payment failed:', error);
      this.showPaymentMessage(error.message || 'Payment failed. Please try again.', 'error');
    } finally {
      // Reset loading state
      this.isProcessing = false;
      submitBtn.disabled = false;
      spinnerEl.style.display = 'none';
      textEl.style.display = 'inline';
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

      // Handle go back button
      const goBackBtn = document.getElementById('goBackBtn');
      if (goBackBtn) {
        goBackBtn.onclick = () => {
          modal.style.display = 'none';
        };
      }

      // Verify and activate premium
      await this.stripe.verifyAndActivatePremium();

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

      if (!subscription.active) {
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
      if (amountEl) {
        const amount = this.stripe.formatPrice(subscription.amount);
        amountEl.textContent = amount + `/${subscription.interval}`;
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
          // TODO: Implement payment method update
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

    } catch (error) {
      console.error('[LISA] Failed to cancel subscription:', error);
      alert('Failed to cancel subscription: ' + error.message);
    }
  }

  /**
   * Check for payment success parameters in URL
   */
  checkPaymentSuccess() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('payment_success')) {
      this.handlePaymentSuccess();
      // Clear URL parameter
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  /**
   * Handle payment success from redirect
   */
  async handlePaymentSuccess() {
    try {
      const result = await this.stripe.handlePaymentSuccess();
      console.log('[LISA] Payment success handled:', result);
      
      // Show success notification
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({
          action: 'trackEvent',
          event: 'payment_success_confirmed'
        }).catch(() => {});
      }

    } catch (error) {
      console.error('[LISA] Error handling payment success:', error);
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

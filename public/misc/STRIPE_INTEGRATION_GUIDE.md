/**
 * LISA Core - Stripe Integration Patch for popup.js
 * 
 * Add these changes to src/popup/popup.js to enable full Stripe integration
 * 
 * INSTALLATION INSTRUCTIONS:
 * 1. Add the imports at the top of popup.js (after existing imports)
 * 2. Add this.stripePaymentManager initialization in the constructor
 * 3. Replace the initiateSubscription() method with the new Stripe version
 * 4. Add the new methods to the LISAPopup class
 */

// ============================================
// STEP 1: Add imports at the top of popup.js
// ============================================
// Add these lines after existing script imports in popup.html:
/*
<script src="stripe/stripe-config.js"></script>
<script src="stripe/stripe-client.js"></script>
<script src="stripe/stripe-subscription-modal.js"></script>
<script src="stripe/stripe-payment-manager.js"></script>
*/

// ============================================
// STEP 2: Add to LISAPopup constructor
// ============================================
// Add this to the constructor after other property initializations:
/*
    this.stripePaymentManager = null;
    this.stripeClient = null;
*/

// ============================================
// STEP 3: Add to init() method
// ============================================
// Add this after setupChatSwitchToggle():
/*
    await this.initializeStripe();
*/

// ============================================
// STEP 4: Replace initiateSubscription() method
// ============================================
// Replace the existing initiateSubscription() with:
/*
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
*/

// ============================================
// STEP 5: Add new methods to LISAPopup class
// ============================================
// Add these methods:

/*
  // Initialize Stripe integration
  async initializeStripe() {
    try {
      // Check if Stripe config is available
      if (typeof STRIPE_CONFIG === 'undefined') {
        console.warn('[LISA] Stripe config not loaded');
        return;
      }

      // Initialize Stripe client
      this.stripeClient = new StripeClient(
        STRIPE_CONFIG.publishableKey,
        STRIPE_CONFIG.apiBaseUrl
      );

      // Initialize payment manager
      this.stripePaymentManager = new StripePaymentManager(
        this.stripeClient,
        STRIPE_CONFIG
      );

      // Initialize Stripe UI and listeners
      await this.stripePaymentManager.init();

      console.log('[LISA] Stripe integration initialized');

      // Check for existing subscription
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
        // Activate premium if subscription is active but tier isn't set
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

  // Open subscription management modal (if premium user)
  async openSubscriptionManagement() {
    try {
      if (!this.stripePaymentManager) {
        console.warn('[LISA] Stripe not initialized');
        return;
      }

      if (this.userTier !== 'premium') {
        this.showError('Only premium users can manage subscriptions');
        return;
      }

      await this.stripePaymentManager.openManageSubscriptionModal();
    } catch (error) {
      console.error('[LISA] Error opening subscription management:', error);
      this.showError('Failed to open subscription management');
    }
  }

  // Update tier badge UI
  updateTierBadge() {
    const tierBadge = document.getElementById('userTier');
    if (tierBadge) {
      tierBadge.textContent = this.userTier === 'premium' ? '⭐ Premium' : 'Free';
    }

    // Hide/show upgrade button
    const upgradeBtn = document.getElementById('upgradeBtn');
    if (upgradeBtn) {
      upgradeBtn.style.display = this.userTier === 'premium' ? 'none' : 'inline-block';
    }

    // Show premium sections
    const premiumSections = document.querySelectorAll('.premium-section');
    premiumSections.forEach(section => {
      section.style.display = this.userTier === 'premium' ? 'block' : 'none';
    });
  }

  // Handle upgrade button click
  handleUpgradeClick() {
    if (this.userTier === 'premium') {
      // Open subscription management for premium users
      this.openSubscriptionManagement();
    } else {
      // Open subscription for free users
      this.initiateSubscription();
    }
    this.trackEvent('upgrade_clicked');
  }
*/

// ============================================
// STEP 6: Update event listeners in setupEventListeners()
// ============================================
// Find the existing upgradeBtn listener and update it:
/*
  // OLD:
  document.getElementById('upgradeBtn').addEventListener('click', () => {
    this.openUpgradeModal();
  });

  // NEW:
  document.getElementById('upgradeBtn').addEventListener('click', () => {
    this.handleUpgradeClick();
  });
*/

// ============================================
// STEP 7: Update HTML imports in popup.html
// ============================================
// Add these script imports before the closing </body> tag in popup.html:
/*
<script src="stripe/stripe-config.js"></script>
<script src="stripe/stripe-client.js"></script>
<script src="stripe/stripe-subscription-modal.js"></script>
<script src="stripe/stripe-payment-manager.js"></script>
*/

// ============================================
// CONFIGURATION REQUIREMENTS
// ============================================
// Before deploying, update these in src/stripe/stripe-config.js:
/*
1. STRIPE_CONFIG.publishableKey
   - Replace 'pk_test_YOUR_STRIPE_PUBLISHABLE_KEY_HERE' with actual test key
   - In production: Use pk_live_xxx key

2. STRIPE_CONFIG.products.premium_monthly.priceId
   - Replace 'price_YOUR_MONTHLY_PRICE_ID' with actual Stripe price ID

3. STRIPE_CONFIG.products.premium_annual.priceId
   - Replace 'price_YOUR_ANNUAL_PRICE_ID' with actual Stripe price ID

4. STRIPE_CONFIG.apiBaseUrl
   - Verify it points to your backend API (currently production Railway app)
*/

// ============================================
// BACKEND REQUIREMENTS
// ============================================
// Your backend must implement these endpoints:
// - POST /api/stripe/create-subscription
// - GET /api/stripe/get-subscription
// - POST /api/stripe/verify-subscription
// - POST /api/stripe/cancel-subscription
// - POST /api/stripe/update-payment-method (for future use)
//
// See STRIPE_BACKEND_API.md for full API documentation

// ============================================
// TESTING CHECKLIST
// ============================================
// 1. Load extension in developer mode
// 2. Check browser console for Stripe initialization messages
// 3. Click upgrade button - should open Stripe payment modal
// 4. Enter test card: 4242 4242 4242 4242
// 5. Complete payment flow
// 6. Verify user tier changes to premium
// 7. Check subscription in browser storage
// 8. Test cancellation flow

export {};

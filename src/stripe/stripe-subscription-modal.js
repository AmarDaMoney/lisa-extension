/**
 * LISA Core - Stripe Subscription Modal
 * HTML for Stripe payment form and subscription management
 */

const STRIPE_SUBSCRIPTION_MODAL_HTML = `
<!-- Stripe Subscription Modal Overlay -->
<div id="stripeSubscriptionModal" class="modal-overlay" style="display: none;">
  <div class="modal-content stripe-subscription-modal">
    <div class="modal-header stripe-header">
      <h2>💳 Subscribe to LISA Premium</h2>
      <button id="closeStripeModalBtn" class="btn-close">✕</button>
    </div>
    
    <div class="modal-body">
      <!-- Pricing Toggle -->
      <div class="billing-toggle-section">
        <span class="toggle-label">Billing Period:</span>
        <div class="toggle-group">
          <button class="billing-toggle active" data-period="month">
            Monthly<br><small>$9.99/mo</small>
          </button>
          <button class="billing-toggle" data-period="year">
            Annual<br><small>$99.90/yr</small><span class="save-badge">Save 17%</span>
          </button>
        </div>
      </div>

      <!-- Features Highlight -->
      <div class="stripe-features-highlight">
        <h3>What You Get:</h3>
        <ul class="stripe-features-list">
          <li><span class="icon">🔐</span> LISA Hash - Cryptographic integrity verification</li>
          <li><span class="icon">∞</span> Unlimited Exports & Imports</li>
          <li><span class="icon">☁️</span> Cloud Sync (Coming Soon)</li>
          <li><span class="icon">⚡</span> Priority Support</li>
        </ul>
      </div>

      <!-- Stripe Payment Form -->
      <div class="stripe-form-container">
        <form id="stripePaymentForm">
          <!-- Stripe Payment Element will mount here -->
          <div id="payment-element"></div>
          
          <!-- Error message display -->
          <div id="payment-message" class="message" style="display: none;"></div>
          
          <!-- Submit button -->
          <button id="submit-stripe-form" type="submit" class="btn btn-subscribe-full">
            <span id="submit-button-text">Subscribe - $9.99/month</span>
            <span id="submit-button-spinner" class="spinner-small" style="display: none;"></span>
          </button>
        </form>
      </div>

      <!-- Secure & Terms -->
      <div class="stripe-footer">
        <p class="security-note">
          <span class="icon-secure">🔒</span> Payments secured by Stripe
        </p>
        <p class="terms-note">
          By subscribing, you agree to recurring charges. 
          <a href="#" id="termsLink" target="_blank">View terms</a> • 
          Cancel anytime
        </p>
      </div>
    </div>
  </div>
</div>

<!-- Payment Success Modal -->
<div id="stripeSuccessModal" class="modal-overlay" style="display: none;">
  <div class="modal-content success-modal">
    <div class="modal-header success-header">
      <button id="closeSuccessModalBtn" class="btn-close">✕</button>
    </div>
    
    <div class="modal-body success-body">
      <div class="success-icon">✅</div>
      <h2>Payment Successful!</h2>
      <p>Welcome to LISA Premium!</p>
      
      <div class="success-details">
        <div class="detail-item">
          <span class="label">Subscription:</span>
          <span class="value">Active</span>
        </div>
        <div class="detail-item">
          <span class="label">Next Billing:</span>
          <span class="value" id="nextBillingDate">-</span>
        </div>
      </div>
      
      <div class="success-features">
        <h4>Your Premium Features are Now Active:</h4>
        <ul>
          <li>✅ Unlimited exports and imports</li>
          <li>✅ LISA Hash generation</li>
          <li>✅ Priority support</li>
        </ul>
      </div>
      
      <button id="goBackBtn" class="btn btn-primary">
        Got It!
      </button>
    </div>
  </div>
</div>

<!-- Manage Subscription Modal -->
<div id="manageSubscriptionModal" class="modal-overlay" style="display: none;">
  <div class="modal-content manage-subscription-modal">
    <div class="modal-header">
      <h2>Manage Subscription</h2>
      <button id="closeManageSubBtn" class="btn-close">✕</button>
    </div>
    
    <div class="modal-body">
      <section class="subscription-info">
        <h3>Current Subscription</h3>
        
        <div class="subscription-details">
          <div class="detail-row">
            <span class="label">Status:</span>
            <span class="value" id="subStatus">Active</span>
          </div>
          <div class="detail-row">
            <span class="label">Plan:</span>
            <span class="value" id="subPlan">LISA Premium - Monthly</span>
          </div>
          <div class="detail-row">
            <span class="label">Amount:</span>
            <span class="value" id="subAmount">$9.99/month</span>
          </div>
          <div class="detail-row">
            <span class="label">Renews:</span>
            <span class="value" id="subRenewDate">-</span>
          </div>
        </div>
      </section>
      
      <div class="subscription-actions">
        <button id="updatePaymentBtn" class="btn btn-secondary">
          Update Payment Method
        </button>
        <button id="cancelSubBtn" class="btn btn-danger">
          Cancel Subscription
        </button>
      </div>
      
      <p class="subscription-note">
        Cancellations are effective immediately. You'll lose premium access but can resubscribe anytime.
      </p>
    </div>
  </div>
</div>

<!-- Cancel Confirmation Modal -->
<div id="cancelConfirmModal" class="modal-overlay" style="display: none;">
  <div class="modal-content cancel-confirm-modal">
    <div class="modal-header warning">
      <h2>Cancel Subscription?</h2>
      <button id="closeCancelConfirmBtn" class="btn-close">✕</button>
    </div>
    
    <div class="modal-body">
      <p class="warning-text">
        You're about to cancel your LISA Premium subscription. You'll lose access to:
      </p>
      
      <ul class="loss-list">
        <li>🔐 LISA Hash generation</li>
        <li>∞ Unlimited exports & imports</li>
        <li>⚡ Priority support</li>
      </ul>
      
      <p class="resubscribe-note">
        You can resubscribe anytime and won't lose your conversation history.
      </p>
      
      <div class="confirmation-actions">
        <button id="keepSubBtn" class="btn btn-secondary">
          Keep Subscription
        </button>
        <button id="confirmCancelBtn" class="btn btn-danger">
          Yes, Cancel Subscription
        </button>
      </div>
    </div>
  </div>
</div>
`;

// CSS for Stripe modals and forms
const STRIPE_SUBSCRIPTION_MODAL_CSS = `
/* Stripe Modal Styles */
.stripe-subscription-modal {
  max-width: 500px;
  width: 90%;
}

.stripe-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.stripe-header h2 {
  color: white;
}

/* Billing Toggle */
.billing-toggle-section {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 25px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
}

.toggle-label {
  font-weight: 600;
  min-width: 100px;
}

.toggle-group {
  display: flex;
  gap: 10px;
  flex: 1;
}

.billing-toggle {
  flex: 1;
  padding: 10px;
  border: 2px solid #e0e0e0;
  background: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.3s ease;
  position: relative;
}

.billing-toggle:hover {
  border-color: #667eea;
}

.billing-toggle.active {
  border-color: #667eea;
  background: #f0f4ff;
  color: #667eea;
}

.save-badge {
  position: absolute;
  top: -8px;
  right: 5px;
  background: #10b981;
  color: white;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: bold;
}

/* Features Highlight */
.stripe-features-highlight {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.stripe-features-highlight h3 {
  margin-top: 0;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}

.stripe-features-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.stripe-features-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
}

.stripe-features-list .icon {
  font-size: 16px;
  flex-shrink: 0;
}

/* Stripe Form Container */
.stripe-form-container {
  margin: 25px 0;
  padding: 20px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

#stripePaymentForm {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

#payment-element {
  /* Stripe Payment Element will style itself */
}

#submit-stripe-form {
  width: 100%;
  padding: 12px;
  font-size: 16px;
  font-weight: 600;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

#submit-stripe-form:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(102, 126, 234, 0.4);
}

#submit-stripe-form:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top: 2px solid white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Payment Message */
#payment-message.message {
  padding: 12px;
  border-radius: 6px;
  font-weight: 500;
  font-size: 13px;
}

#payment-message.success {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #6ee7b7;
}

#payment-message.error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}

/* Stripe Footer */
.stripe-footer {
  text-align: center;
  font-size: 12px;
  color: #6b7280;
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid #e5e7eb;
}

.security-note {
  margin: 0 0 8px 0;
}

.icon-secure {
  margin-right: 4px;
}

.terms-note {
  margin: 0;
  line-height: 1.5;
}

.terms-note a {
  color: #667eea;
  text-decoration: none;
}

.terms-note a:hover {
  text-decoration: underline;
}

/* Success Modal */
.success-modal {
  max-width: 450px;
  text-align: center;
}

.success-header {
  background: #d1fae5;
  border-bottom: 2px solid #10b981;
}

.success-body {
  padding: 40px 20px;
}

.success-icon {
  font-size: 64px;
  margin-bottom: 20px;
  animation: bounce 0.5s ease-out;
}

@keyframes bounce {
  0% { transform: scale(0); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.success-modal h2 {
  color: #10b981;
  margin: 0 0 8px 0;
}

.success-modal > p {
  color: #6b7280;
  margin: 0 0 25px 0;
}

.success-details {
  background: #f9fafb;
  padding: 15px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 13px;
}

.detail-item .label {
  color: #6b7280;
  font-weight: 500;
}

.detail-item .value {
  font-weight: 600;
  color: #1f2937;
}

.success-features {
  text-align: left;
  margin: 25px 0;
  padding: 15px;
  background: #f0fdf4;
  border-left: 4px solid #10b981;
  border-radius: 4px;
}

.success-features h4 {
  margin: 0 0 10px 0;
  font-size: 13px;
  color: #065f46;
}

.success-features ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.success-features li {
  font-size: 12px;
  color: #047857;
  padding: 4px 0;
}

/* Manage Subscription Modal */
.manage-subscription-modal {
  max-width: 450px;
}

.subscription-info {
  background: #f9fafb;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 25px;
}

.subscription-info h3 {
  margin: 0 0 15px 0;
  font-size: 14px;
}

.subscription-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #e5e7eb;
  font-size: 13px;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-row .label {
  color: #6b7280;
  font-weight: 500;
}

.detail-row .value {
  font-weight: 600;
  color: #1f2937;
}

.subscription-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.subscription-actions .btn {
  width: 100%;
}

.subscription-note {
  font-size: 12px;
  color: #6b7280;
  text-align: center;
  margin: 0;
  padding: 15px;
  background: #fef3c7;
  border-left: 4px solid #f59e0b;
  border-radius: 4px;
}

/* Cancel Confirmation Modal */
.cancel-confirm-modal {
  max-width: 450px;
}

.warning {
  background: #fef3c7;
  border-bottom: 2px solid #f59e0b;
}

.warning h2 {
  color: #92400e;
}

.warning-text {
  font-size: 14px;
  color: #b45309;
  margin: 0 0 15px 0;
}

.loss-list {
  background: #fff7ed;
  padding: 15px;
  border-radius: 6px;
  margin: 15px 0;
  font-size: 13px;
  list-style-position: inside;
}

.loss-list li {
  padding: 6px 0;
  color: #92400e;
}

.resubscribe-note {
  font-size: 12px;
  color: #6b7280;
  padding: 12px;
  background: #f3f4f6;
  border-radius: 4px;
  margin: 15px 0;
}

.confirmation-actions {
  display: flex;
  gap: 10px;
  margin-top: 25px;
}

.confirmation-actions .btn {
  flex: 1;
}

/* Button Styles */
.btn-subscribe-full {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 12px 20px;
  font-weight: 600;
  width: 100%;
}

.btn-danger {
  background: #ef4444;
  color: white;
  padding: 10px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.3s ease;
}

.btn-danger:hover {
  background: #dc2626;
  transform: translateY(-2px);
}

/* Responsive */
@media (max-width: 480px) {
  .stripe-subscription-modal,
  .success-modal,
  .manage-subscription-modal,
  .cancel-confirm-modal {
    width: 95%;
  }
  
  .toggle-group {
    flex-direction: column;
  }
  
  .confirmation-actions {
    flex-direction: column;
  }
  
  .confirmation-actions .btn {
    width: 100%;
  }
}
`;

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STRIPE_SUBSCRIPTION_MODAL_HTML,
    STRIPE_SUBSCRIPTION_MODAL_CSS
  };
}

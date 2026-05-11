/**
 * views/checkout.js — Stripe / BACS payment checkout
 *
 * URL params: #/checkout?booking_id=...&amount=...&description=...
 * 1. GET /stripe/config?tenant_id=   — check is_stripe_enabled + BACS details
 * 2a. If Stripe enabled: POST /stripe/session → redirect to Stripe Checkout
 * 2b. If BACS only: show bank details + confirm via n8n pay-balance webhook
 */
import { api, n8nPost } from '../api.js';
import { auth } from '../auth.js';
import { toast } from '../components/toast.js';
import { renderSidebar, initSidebar } from '../components/sidebar.js';

function getParams() {
  const hash   = window.location.hash;
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return {};
  return Object.fromEntries(new URLSearchParams(hash.slice(qIndex + 1)));
}

const view = {
  async mount(container) {
    const { booking_id, amount, description, status } = getParams();

    container.innerHTML = `
      ${renderSidebar('/checkout')}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-credit-card" style="color:var(--primary);"></i> Payment</h1>
        </div>

        ${status === 'success' ? `
          <div class="card" style="text-align:center;padding:3rem;">
            <i class="fa-solid fa-circle-check" style="font-size:3rem;color:var(--success);margin-bottom:1rem;"></i>
            <h2>Payment Successful</h2>
            <p style="color:var(--text-muted);margin-top:8px;">Your booking has been confirmed.</p>
            <a href="#/dashboard" class="btn btn-primary" style="margin-top:1.5rem;display:inline-flex;">Return to Dashboard</a>
          </div>
        ` : status === 'cancelled' ? `
          <div class="card" style="text-align:center;padding:3rem;">
            <i class="fa-solid fa-circle-xmark" style="font-size:3rem;color:var(--danger);margin-bottom:1rem;"></i>
            <h2>Payment Cancelled</h2>
            <p style="color:var(--text-muted);margin-top:8px;">No payment was taken.</p>
            <a href="#/dashboard" class="btn btn-ghost" style="margin-top:1.5rem;display:inline-flex;">Return to Dashboard</a>
          </div>
        ` : `
          <div class="card" style="max-width:520px;margin:0 auto;" id="checkoutCard">
            <div class="card-title"><i class="fa-solid fa-receipt"></i> Order Summary</div>
            <div style="margin-bottom:1.5rem;">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="color:var(--text-muted);">Description</span>
                <span style="font-weight:600;">${description || 'Venue Booking'}</span>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--text-muted);">Amount Due</span>
                <span style="font-weight:800;font-size:1.2rem;color:var(--primary);">£${parseFloat(amount||0).toFixed(2)}</span>
              </div>
            </div>
            <div id="paymentOptions"><div class="spinner"></div></div>
          </div>
        `}
      </main>
    `;

    initSidebar();

    if (!status && booking_id) {
      this._loadPaymentOptions(booking_id, amount, description);
    }
  },

  async _loadPaymentOptions(bookingId, amount, description) {
    const container = document.getElementById('paymentOptions');
    try {
      const tid = auth.getTenantId();
      const configRes = await fetch(
        `https://api.venuedesk.co.uk/stripe/config?tenant_id=${tid}`,
        { headers: { 'Content-Type': 'application/json' } }
      );
      const config = await configRes.json();

      let html = '';

      if (config.is_stripe_enabled) {
        html += `
          <button class="btn btn-primary" id="stripePayBtn" style="width:100%;justify-content:center;padding:14px;font-size:1rem;margin-bottom:12px;">
            <i class="fa-brands fa-stripe-s"></i> Pay £${parseFloat(amount||0).toFixed(2)} by Card
          </button>
        `;
      }

      if (config.bacs_account_name) {
        html += `
          <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:10px;padding:1rem;margin-bottom:12px;">
            <p style="font-size:0.82rem;font-weight:700;color:#93c5fd;margin-bottom:8px;"><i class="fa-solid fa-building-columns"></i> Pay by Bank Transfer (BACS)</p>
            <div style="font-size:0.85rem;line-height:1.8;color:var(--text-muted);">
              Account: <strong style="color:var(--text-main);">${config.bacs_account_name}</strong><br/>
              Sort Code: <strong style="color:var(--text-main);">${config.bacs_sort_code||'—'}</strong><br/>
              Account No: <strong style="color:var(--text-main);">${config.bacs_account_number||'—'}</strong><br/>
              Reference: <strong style="color:var(--text-main);">${bookingId?.slice(0,8)?.toUpperCase()||'See email'}</strong>
            </div>
            <button class="btn btn-ghost" id="bacsConfirmBtn" style="margin-top:12px;width:100%;justify-content:center;">
              <i class="fa-solid fa-check"></i> I've made the bank transfer
            </button>
          </div>
        `;
      }

      if (!html) {
        html = `<p style="color:var(--text-muted);text-align:center;">No payment methods configured. Please contact your venue.</p>`;
      }

      container.innerHTML = html;

      document.getElementById('stripePayBtn')?.addEventListener('click', async () => {
        try {
          const btn = document.getElementById('stripePayBtn');
          btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Redirecting…';
          const { checkout_url } = await api.post('/stripe/session', {
            booking_id: bookingId,
            amount:     parseFloat(amount),
            description,
          });
          window.location.href = checkout_url;
        } catch(e) {
          toast.error('Stripe checkout failed: ' + e.message);
          document.getElementById('stripePayBtn').disabled = false;
          document.getElementById('stripePayBtn').innerHTML = '<i class="fa-brands fa-stripe-s"></i> Pay by Card';
        }
      });

      document.getElementById('bacsConfirmBtn')?.addEventListener('click', async () => {
        try {
          await n8nPost('/pay-balance', {
            booking_id: bookingId, amount, payment_method: 'bacs',
            bacs_account_name:   config.bacs_account_name,
            bacs_sort_code:      config.bacs_sort_code,
            bacs_account_number: config.bacs_account_number,
          });
          window.location.hash = '#/checkout?status=success';
        } catch(e) {
          toast.error('Failed to confirm payment: ' + e.message);
        }
      });
    } catch(e) {
      container.innerHTML = `<p style="color:var(--danger);">Failed to load payment options: ${e.message}</p>`;
    }
  },
};
export default view;

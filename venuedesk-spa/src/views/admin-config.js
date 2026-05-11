/**
 * views/admin-config.js — Config Manager
 * Tabs: Rooms, Payments (Stripe + BACS), Settings
 * Mirrors admin-config.html but as a SPA view.
 */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { toast } from '../components/toast.js';
import { renderSidebar, initSidebar } from '../components/sidebar.js';

const TABS = [
  { id:'rooms',    icon:'fa-door-open',       label:'Rooms'    },
  { id:'payments', icon:'fa-credit-card',     label:'Payments' },
  { id:'settings', icon:'fa-gear',            label:'Settings' },
];

const view = {
  _activeTab: 'rooms',

  async mount(container) {
    if (!auth.isAdmin()) {
      container.innerHTML = `
        ${renderSidebar('/admin-config')}
        <main class="content">
          <div class="loading-state"><i class="fa-solid fa-lock" style="font-size:2rem;color:var(--danger);"></i><p>Admin access required.</p></div>
        </main>
      `;
      initSidebar();
      return;
    }

    container.innerHTML = `
      ${renderSidebar('/admin-config')}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-gear" style="color:var(--primary);"></i> Config Manager</h1>
        </div>

        <!-- Tab bar -->
        <div style="display:flex;gap:6px;margin-bottom:1.5rem;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:6px;width:fit-content;">
          ${TABS.map(t=>`
            <button class="tab-btn${t.id===this._activeTab?' active':''}" data-tab="${t.id}"
              style="padding:8px 20px;border:none;border-radius:8px;background:${t.id===this._activeTab?'var(--primary)':'transparent'};
                     color:${t.id===this._activeTab?'white':'var(--text-muted)'};font-weight:600;font-size:0.88rem;cursor:pointer;transition:all 0.2s;">
              <i class="fa-solid ${t.icon}"></i> ${t.label}
            </button>
          `).join('')}
        </div>

        <div id="tabContent"></div>
      </main>
    `;
    initSidebar();

    // Tab switching
    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._activeTab = btn.dataset.tab;
        container.querySelectorAll('.tab-btn').forEach(b => {
          b.style.background = 'transparent'; b.style.color = 'var(--text-muted)';
        });
        btn.style.background = 'var(--primary)'; btn.style.color = 'white';
        this._renderTab();
      });
    });

    this._renderTab();
  },

  _renderTab() {
    const el = document.getElementById('tabContent');
    if (this._activeTab === 'rooms')    this._renderRooms(el);
    if (this._activeTab === 'payments') this._renderPayments(el);
    if (this._activeTab === 'settings') this._renderSettings(el);
  },

  // ── Rooms tab ─────────────────────────────────────────────────────────────
  _renderRooms(el) {
    el.innerHTML = `<div class="card"><div class="card-title"><i class="fa-solid fa-door-open"></i> Rooms</div><div id="roomsContent"><div class="spinner"></div></div></div>`;
    api.get('/config/rooms').then(({ data }) => {
      const rows = data || [];
      document.getElementById('roomsContent').innerHTML = rows.length
        ? `<table class="data-table"><thead><tr><th>Name</th><th>Capacity</th><th>Hourly Rate</th><th>Active</th></tr></thead>
           <tbody>${rows.map(r=>`<tr><td style="font-weight:600;">${r.name}</td><td>${r.capacity||'—'}</td><td>£${parseFloat(r.hourly_rate||0).toFixed(2)}</td>
           <td><span class="badge badge-${r.active?'success':'muted'}">${r.active?'Active':'Inactive'}</span></td></tr>`).join('')}</tbody></table>`
        : `<div class="empty-state"><i class="fa-solid fa-door-open"></i><p>No rooms configured</p></div>`;
    }).catch(() => {
      document.getElementById('roomsContent').innerHTML = `<p style="color:var(--danger);">Failed to load rooms.</p>`;
    });
  },

  // ── Payments tab ──────────────────────────────────────────────────────────
  _renderPayments(el) {
    el.innerHTML = `
      <div class="grid-2">
        <!-- Stripe card -->
        <div class="card">
          <div class="card-title"><i class="fa-brands fa-stripe" style="color:#635bff;"></i> Stripe Payments</div>
          <div id="stripeForm"><div class="spinner"></div></div>
        </div>
        <!-- BACS card -->
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-building-columns"></i> BACS Bank Transfer</div>
          <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1.25rem;">
            Shown to customers choosing bank transfer.
          </p>
          <div class="input-group"><label>Account Name</label><input type="text" id="bacsName" class="form-input" /></div>
          <div class="input-group"><label>Sort Code</label><input type="text" id="bacsSort" class="form-input" placeholder="00-00-00" maxlength="8" /></div>
          <div class="input-group"><label>Account Number</label><input type="text" id="bacsNumber" class="form-input" placeholder="12345678" maxlength="8" /></div>
          <button class="btn btn-primary" id="saveBacsBtn"><i class="fa-solid fa-floppy-disk"></i> Save BACS</button>
          <span id="bacsStatus" style="margin-left:10px;font-size:0.82rem;color:var(--text-muted);"></span>
        </div>
      </div>
    `;
    this._loadPaymentSettings();
  },

  async _loadPaymentSettings() {
    try {
      const { data } = await api.post('/admin/payment-settings/load', {});
      const d = data || {};

      // Render Stripe form
      document.getElementById('stripeForm').innerHTML = `
        <div class="input-group" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <label style="margin:0;">Enable Stripe Card Payments</label>
          <input type="checkbox" id="stripeEnabled" ${d.is_stripe_enabled?'checked':''} style="width:18px;height:18px;cursor:pointer;">
        </div>
        <div class="input-group"><label>Publishable Key</label><input type="text" id="stripePubKey" class="form-input" value="${d.stripe_publishable_key||''}" placeholder="pk_live_..." /></div>
        <div class="input-group">
          <label>Secret Key <span style="color:var(--text-muted);font-weight:400;">(leave blank to keep)</span></label>
          <input type="password" id="stripeSecretKey" class="form-input" placeholder="sk_live_..." />
        </div>
        <div style="background:rgba(99,91,255,0.08);border:1px solid rgba(99,91,255,0.2);border-radius:8px;padding:12px;margin:1rem 0;font-size:0.8rem;">
          <p style="color:#a5b4fc;font-weight:700;margin-bottom:6px;"><i class="fa-solid fa-circle-info"></i> Webhook Setup</p>
          <p style="color:var(--text-muted);line-height:1.7;">
            In <a href="https://dashboard.stripe.com/webhooks" target="_blank" style="color:#818cf8;">Stripe Dashboard → Webhooks</a>, 
            add endpoint: <code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;">https://api.venuedesk.co.uk/stripe/webhook</code>
            and select event <strong style="color:var(--text-main);">checkout.session.completed</strong>
          </p>
        </div>
        <div class="input-group">
          <label>Webhook Secret <span style="color:var(--text-muted);font-weight:400;">(leave blank to keep)</span></label>
          <input type="password" id="stripeWebhook" class="form-input" placeholder="whsec_..." />
        </div>
        <div style="display:flex;gap:8px;margin-bottom:1rem;">
          <span id="skBadge" class="badge badge-${d.has_secret_key?'success':'muted'}">
            <i class="fa-solid fa-key"></i> Secret key: ${d.has_secret_key?'saved ✓':'not set'}
          </span>
          <span id="whBadge" class="badge badge-${d.has_webhook_secret?'success':'muted'}">
            <i class="fa-solid fa-shield"></i> Webhook: ${d.has_webhook_secret?'saved ✓':'not set'}
          </span>
        </div>
        <button class="btn btn-primary" id="saveStripeBtn"><i class="fa-solid fa-floppy-disk"></i> Save Stripe Settings</button>
        <span id="stripeStatus" style="margin-left:10px;font-size:0.82rem;"></span>
      `;

      // Populate BACS
      if (document.getElementById('bacsName'))   document.getElementById('bacsName').value   = d.bacs_account_name   || '';
      if (document.getElementById('bacsSort'))   document.getElementById('bacsSort').value   = d.bacs_sort_code      || '';
      if (document.getElementById('bacsNumber')) document.getElementById('bacsNumber').value = d.bacs_account_number || '';

      this._wirePaymentSave();
    } catch(e) {
      document.getElementById('stripeForm').innerHTML = `<p style="color:var(--danger);">Failed to load payment settings.</p>`;
    }
  },

  _wirePaymentSave() {
    const setStatus = (id, msg, ok) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.color = ok ? 'var(--success)' : 'var(--danger)';
      el.textContent = msg;
      setTimeout(() => { el.textContent=''; el.style.color=''; }, 4000);
    };

    document.getElementById('saveStripeBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('saveStripeBtn');
      btn.disabled = true;
      try {
        await api.post('/admin/payment-settings/save', {
          is_stripe_enabled:      document.getElementById('stripeEnabled').checked,
          stripe_publishable_key: document.getElementById('stripePubKey').value.trim(),
          stripe_secret_key:      document.getElementById('stripeSecretKey').value.trim(),
          stripe_webhook_secret:  document.getElementById('stripeWebhook').value.trim(),
        });
        document.getElementById('stripeSecretKey').value = '';
        document.getElementById('stripeWebhook').value   = '';
        setStatus('stripeStatus', '✓ Saved', true);
        toast.success('Stripe settings saved');
        await this._loadPaymentSettings();
      } catch(e) {
        setStatus('stripeStatus', '✗ ' + e.message, false);
      } finally { btn.disabled = false; }
    });

    document.getElementById('saveBacsBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('saveBacsBtn');
      btn.disabled = true;
      try {
        await api.post('/admin/payment-settings/save', {
          bacs_account_name:   document.getElementById('bacsName').value.trim(),
          bacs_sort_code:      document.getElementById('bacsSort').value.trim(),
          bacs_account_number: document.getElementById('bacsNumber').value.trim(),
        });
        setStatus('bacsStatus', '✓ Saved', true);
        toast.success('BACS details saved');
      } catch(e) {
        setStatus('bacsStatus', '✗ ' + e.message, false);
      } finally { btn.disabled = false; }
    });
  },

  // ── Settings tab ─────────────────────────────────────────────────────────
  _renderSettings(el) {
    el.innerHTML = `<div class="card"><div class="card-title"><i class="fa-solid fa-gear"></i> General Settings</div><p style="color:var(--text-muted);">Turnaround times, cancellation policy, and other venue-wide settings managed here.</p><div id="settingsContent"><div class="spinner"></div></div></div>`;
    // Delegate to n8n settings endpoint for now (same pattern as existing page)
    fetch('https://n8n.srv1090894.hstgr.cloud/webhook/get-settings', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ jwt: auth.isAuthenticated() ? localStorage.getItem('vp_token') || sessionStorage.getItem('vp_token') : '' }),
    }).then(r=>r.json()).then(data => {
      const settings = Array.isArray(data) ? data : (data.data || []);
      const el2 = document.getElementById('settingsContent');
      if (!settings.length) { el2.innerHTML = `<p style="color:var(--text-muted);">No settings found.</p>`; return; }
      el2.innerHTML = settings.map(s=>`
        <div class="input-group">
          <label>${s.key||s.setting_key}</label>
          <input type="text" class="form-input" value="${s.value||''}" data-key="${s.key||s.setting_key}" />
        </div>
      `).join('') + `<button class="btn btn-primary" id="saveSettingsBtn"><i class="fa-solid fa-floppy-disk"></i> Save Settings</button>`;
    }).catch(() => {
      document.getElementById('settingsContent').innerHTML = `<p style="color:var(--text-muted);">Settings unavailable.</p>`;
    });
  },
};
export default view;

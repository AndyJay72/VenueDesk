/**
 * views/dashboard.js — Main dashboard view
 *
 * Pulls data from:
 *   GET  /dashboard/summary        — KPI stats
 *   POST /bookings/list            — upcoming bookings
 *   GET  /recurring/next-due       — outstanding recurring payments
 *   n8n  /staff-dashboard          — legacy pending requests count
 */

import { api, n8nPost } from '../api.js';
import { auth } from '../auth.js';
import { toast } from '../components/toast.js';
import { renderSidebar, initSidebar } from '../components/sidebar.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(val, prefix = '£') {
  const n = parseFloat(val) || 0;
  return prefix + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusBadge(status) {
  const map = {
    confirmed:  'success',
    pending:    'warning',
    cancelled:  'danger',
    completed:  'info',
    fully_paid: 'success',
  };
  return `<span class="badge badge-${map[status] || 'muted'}">${status || '—'}</span>`;
}

// ── View ──────────────────────────────────────────────────────────────────────
const view = {
  async mount(container) {
    container.innerHTML = `
      ${renderSidebar('/dashboard')}
      <main class="content" id="mainContent">
        <div class="page-header">
          <h1><i class="fa-solid fa-gauge-high" style="color:var(--primary);"></i> Dashboard</h1>
          <p>Welcome back, ${auth.getUserName()}</p>
        </div>

        <!-- KPI row -->
        <div class="metrics-grid" id="kpiRow">
          ${[
            { cls:'card-pre',    id:'pending',     icon:'fa-clock' },
            { cls:'card-booked', id:'revenue',     icon:'fa-sterling-sign' },
            { cls:'card-post',   id:'contacted',   icon:'fa-comment-dots' },
            { cls:'card-danger', id:'outstanding', icon:'fa-circle-exclamation' },
          ].map(k => `
            <div class="metric-card ${k.cls}" id="kpi-${k.id}" style="--pct:0%">
              <div class="dial-ring"><i class="fa-solid ${k.icon}" style="font-size:1.2rem;"></i></div>
              <div class="metric-info">
                <h3>&nbsp;</h3>
                <div class="metric-val">—</div>
                <div class="metric-sub"><div class="spinner" style="width:12px;height:12px;border-width:2px;margin:0;display:inline-block;"></div></div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Two-column: upcoming bookings + outstanding payments -->
        <div class="grid-2" style="margin-top:1.5rem;">
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-calendar-check"></i> Upcoming Bookings</div>
            <div id="upcomingBookings"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-clock"></i> Outstanding Payments</div>
            <div id="outstandingPayments"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Pending requests -->
        <div class="card" style="margin-top:1.5rem;">
          <div class="card-title">
            <i class="fa-solid fa-inbox"></i> Pending Requests
            <span id="pendingBadge" class="badge badge-warning" style="margin-left:auto;display:none;"></span>
          </div>
          <div id="pendingRequests"><div class="spinner"></div></div>
        </div>
      </main>
    `;

    initSidebar();
    this._loadAll();
  },

  async _loadAll() {
    await Promise.allSettled([
      this._loadKpis(),
      this._loadUpcoming(),
      this._loadOutstanding(),
      this._loadPending(),
    ]);
  },

  async _loadKpis() {
    try {
      const data = await api.get('/dashboard/metrics');

      const pending    = data.pending_requests   ?? 0;
      const contacted  = data.contacted_today    ?? 0;
      const revenue    = parseFloat(data.total_revenue_month) || 0;
      const outstanding = parseFloat(data.outstanding)        || 0;

      // pct helpers — counts relative to a soft max; money shows fixed decorative arc
      const pct = (val, max) => `${Math.min(Math.round((val / max) * 100), 100)}%`;

      const kpis = [
        {
          id:    'pending',
          label: 'Pending Requests',
          dial:  pending,
          val:   String(pending),
          sub:   'Awaiting response',
          pct:   pct(pending, 20),
        },
        {
          id:    'revenue',
          label: 'Revenue (Month)',
          dial:  '<i class="fa-solid fa-sterling-sign" style="font-size:1.1rem;"></i>',
          val:   fmt(revenue),
          sub:   'This calendar month',
          pct:   revenue > 0 ? '65%' : '0%',
        },
        {
          id:    'contacted',
          label: 'Contacted Today',
          dial:  contacted,
          val:   String(contacted),
          sub:   'Follow-ups done today',
          pct:   pct(contacted, 10),
        },
        {
          id:    'outstanding',
          label: 'Outstanding Balance',
          dial:  '<i class="fa-solid fa-circle-exclamation" style="font-size:1.1rem;"></i>',
          val:   fmt(outstanding),
          sub:   'Across all bookings',
          pct:   outstanding > 0 ? '70%' : '0%',
        },
      ];

      kpis.forEach(k => {
        const el = document.getElementById(`kpi-${k.id}`);
        if (!el) return;
        el.style.setProperty('--pct', k.pct);
        el.innerHTML = `
          <div class="dial-ring">${k.dial}</div>
          <div class="metric-info">
            <h3>${k.label}</h3>
            <div class="metric-val">${k.val}</div>
            <div class="metric-sub">${k.sub}</div>
          </div>
        `;
      });
    } catch (err) {
      console.error('[dashboard] KPI load failed', err);
      ['pending','revenue','contacted','outstanding'].forEach(id => {
        const el = document.getElementById(`kpi-${id}`);
        if (el) el.innerHTML = `<div class="dial-ring">—</div><div class="metric-info"><h3>Error</h3><div class="metric-val" style="color:var(--text-muted);">—</div></div>`;
      });
    }
  },

  async _loadUpcoming() {
    const container = document.getElementById('upcomingBookings');
    try {
      const { data } = await api.get('/bookings/list');
      const upcoming = (data || [])
        .filter(b => b.status !== 'cancelled')
        .sort((a, b) => new Date(a.date_from || a.booking_date) - new Date(b.date_from || b.booking_date))
        .slice(0, 8);

      if (!upcoming.length) {
        container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No upcoming bookings</p></div>`;
        return;
      }

      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Date</th>
              <th>Room</th>
              <th>Status</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            ${upcoming.map(b => `
              <tr>
                <td style="font-weight:600;">${b.customer_name || '—'}</td>
                <td>${fmtDate(b.date_from || b.booking_date)}</td>
                <td>${b.room_name || '—'}</td>
                <td>${statusBadge(b.status)}</td>
                <td style="color:${parseFloat(b.balance_due) > 0 ? 'var(--warning)' : 'var(--success)'};">
                  ${fmt(b.balance_due)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      container.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;">Failed to load bookings.</p>`;
    }
  },

  async _loadOutstanding() {
    const container = document.getElementById('outstandingPayments');
    try {
      const { data } = await api.get('/recurring/next-due');
      const items = (data || []).filter(r => parseFloat(r.next_amount_due) > 0).slice(0, 8);

      if (!items.length) {
        container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>No outstanding recurring payments</p></div>`;
        return;
      }

      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th>Customer</th><th>Due Date</th><th>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${items.map(r => `
              <tr>
                <td style="font-weight:600;">${r.full_name || r.customer_name || '—'}</td>
                <td>${fmtDate(r.next_due_date)}</td>
                <td style="color:var(--warning);">${fmt(r.next_amount_due)}</td>
                <td>${statusBadge(r.payment_status || 'pending')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      container.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;">Failed to load outstanding payments.</p>`;
    }
  },

  async _loadPending() {
    const container    = document.getElementById('pendingRequests');
    const badge        = document.getElementById('pendingBadge');
    try {
      const { data } = await api.get('/bookings/pending');
      const pending = data || [];

      if (badge) {
        badge.textContent   = pending.length;
        badge.style.display = pending.length ? 'inline-flex' : 'none';
      }

      if (!pending.length) {
        container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No pending requests</p></div>`;
        return;
      }

      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th>Customer</th><th>Event Type</th><th>Requested Date</th><th>Guests</th><th>Submitted</th></tr>
          </thead>
          <tbody>
            ${pending.map(r => `
              <tr>
                <td style="font-weight:600;">${r.full_name || r.customer_name || '—'}</td>
                <td>${r.event_type || '—'}</td>
                <td>${fmtDate(r.date_from)}</td>
                <td>${r.guest_count ?? r.guests_count ?? '—'}</td>
                <td style="color:var(--text-muted);">${fmtDate(r.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      container.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;">Failed to load pending requests.</p>`;
    }
  },
};

export default view;

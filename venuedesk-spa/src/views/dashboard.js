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
        <div class="grid-4" id="kpiRow">
          ${['bookings','revenue','pending','outstanding'].map(k => `
            <div class="kpi-card" id="kpi-${k}">
              <div class="kpi-label"><div class="spinner" style="width:16px;height:16px;border-width:2px;margin:0;"></div></div>
              <div class="kpi-value">—</div>
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
      const kpis = [
        { id: 'bookings',    label: 'Pending Requests',    value: data.pending_requests   ?? 0,   sub: 'Awaiting response',    icon: 'fa-clock',              color: 'var(--warning)' },
        { id: 'revenue',     label: 'Revenue (Month)',     value: fmt(data.total_revenue_month),  sub: 'This calendar month',  icon: 'fa-sterling-sign',      color: 'var(--success)' },
        { id: 'pending',     label: 'Contacted Today',     value: data.contacted_today    ?? 0,   sub: 'Follow-ups done today', icon: 'fa-comment-dots',       color: 'var(--info)' },
        { id: 'outstanding', label: 'Outstanding Balance', value: fmt(data.outstanding),          sub: 'Across all bookings',  icon: 'fa-circle-exclamation', color: 'var(--danger)' },
      ];
      kpis.forEach(k => {
        const el = document.getElementById(`kpi-${k.id}`);
        if (!el) return;
        el.innerHTML = `
          <div class="kpi-label"><i class="fa-solid ${k.icon}" style="color:${k.color};margin-right:6px;"></i>${k.label}</div>
          <div class="kpi-value" style="color:${k.color};">${k.value}</div>
          <div class="kpi-sub">${k.sub}</div>
        `;
      });
    } catch (err) {
      console.error('[dashboard] KPI load failed', err);
      ['bookings','revenue','pending','outstanding'].forEach(id => {
        const el = document.getElementById(`kpi-${id}`);
        if (el) el.innerHTML = `<div class="kpi-label">—</div><div class="kpi-value" style="color:var(--text-muted);">Error</div>`;
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

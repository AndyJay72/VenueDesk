/**
 * views/recurring-bookings.js — Recurring series management
 * GET /recurring/series, GET /recurring/outstanding-payments
 * POST /recurring/record-series-payment
 */
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { renderSidebar, initSidebar } from '../components/sidebar.js';

function fmt(v) { return '£'+(parseFloat(v)||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'; }

const view = {
  async mount(container) {
    container.innerHTML = `
      ${renderSidebar('/recurring-bookings')}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-rotate" style="color:var(--primary);"></i> Recurring Bookings</h1>
          <p>Active series and payment schedules</p>
        </div>
        <div class="grid-2">
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-rotate"></i> Active Series</div>
            <div id="seriesList"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-clock" style="color:var(--warning);"></i> Outstanding Payments</div>
            <div id="outstandingList"><div class="spinner"></div></div>
          </div>
        </div>
      </main>
    `;
    initSidebar();
    this._load();
  },

  async _load() {
    const [seriesRes, outRes] = await Promise.allSettled([
      api.get('/recurring/series'),
      api.get('/recurring/outstanding-payments'),
    ]);

    const series  = seriesRes.status==='fulfilled'  ? (seriesRes.value?.data||[])  : [];
    const outstanding = outRes.status==='fulfilled' ? (outRes.value?.data||[]) : [];

    const sEl = document.getElementById('seriesList');
    if (!series.length) {
      sEl.innerHTML = `<div class="empty-state"><i class="fa-solid fa-rotate"></i><p>No active recurring series</p></div>`;
    } else {
      sEl.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Customer</th><th>Room</th><th>Day</th><th>Balance Due</th><th>Status</th></tr></thead>
          <tbody>
            ${series.slice(0,20).map(s=>`
              <tr>
                <td style="font-weight:600;">${s.customer_name||s.full_name||'—'}</td>
                <td>${s.room_name||'—'}</td>
                <td>${s.day_of_week||'—'}</td>
                <td style="color:${parseFloat(s.balance_due)>0?'var(--warning)':'var(--success)'};">${fmt(s.balance_due)}</td>
                <td><span class="badge badge-${s.active?'success':'muted'}">${s.active?'Active':'Inactive'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    const oEl = document.getElementById('outstandingList');
    if (!outstanding.length) {
      oEl.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>All recurring payments up to date</p></div>`;
    } else {
      oEl.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Customer</th><th>Due</th><th>Amount</th></tr></thead>
          <tbody>
            ${outstanding.slice(0,20).map(r=>`
              <tr>
                <td style="font-weight:600;">${r.full_name||r.customer_name||'—'}</td>
                <td>${fmtDate(r.due_date||r.next_due_date)}</td>
                <td style="color:var(--warning);">${fmt(r.amount_due||r.next_amount_due)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  },
};
export default view;

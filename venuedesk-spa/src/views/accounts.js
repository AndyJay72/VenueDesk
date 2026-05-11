/**
 * views/accounts.js — Financial summary
 * POST /payments/list, GET /recurring/outstanding-payments
 */
import { api } from '../api.js';
import { renderSidebar, initSidebar } from '../components/sidebar.js';
import { toast } from '../components/toast.js';

function fmt(v) { return '£' + (parseFloat(v)||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'; }

const view = {
  async mount(container) {
    container.innerHTML = `
      ${renderSidebar('/accounts')}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-sterling-sign" style="color:var(--primary);"></i> Accounts</h1>
          <p>Payment history and outstanding balances</p>
        </div>

        <div class="grid-4" id="kpiRow">
          ${['total','month','outstanding','recurring'].map(k=>`
            <div class="kpi-card" id="acc-kpi-${k}">
              <div class="kpi-label"><div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div></div>
              <div class="kpi-value">—</div>
            </div>
          `).join('')}
        </div>

        <div class="grid-2" style="margin-top:1.5rem;">
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-receipt"></i> Recent Payments</div>
            <div id="recentPayments"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-circle-exclamation" style="color:var(--warning);"></i> Outstanding Balances</div>
            <div id="outstandingList"><div class="spinner"></div></div>
          </div>
        </div>
      </main>
    `;
    initSidebar();
    this._load();
  },

  async _load() {
    try {
      const [paymentsRes, outstandingRes] = await Promise.allSettled([
        api.post('/payments/list', {}),
        api.get('/recurring/outstanding-payments'),
      ]);

      const payments    = paymentsRes.status === 'fulfilled'    ? (paymentsRes.value?.data || [])    : [];
      const outstanding = outstandingRes.status === 'fulfilled' ? (outstandingRes.value?.data || []) : [];

      // KPIs
      const totalRevenue  = payments.reduce((s,p) => s + parseFloat(p.amount||0), 0);
      const now           = new Date();
      const monthRevenue  = payments
        .filter(p => { const d = new Date(p.payment_date||p.created_at); return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear(); })
        .reduce((s,p) => s + parseFloat(p.amount||0), 0);
      const outstandingTotal = outstanding.reduce((s,r) => s + parseFloat(r.amount_due||r.next_amount_due||0), 0);

      const kpis = [
        { id:'total',       label:'Total Revenue',     value:fmt(totalRevenue),    sub:'All time',           color:'var(--success)' },
        { id:'month',       label:'This Month',        value:fmt(monthRevenue),    sub:now.toLocaleString('en-GB',{month:'long'}), color:'var(--primary)' },
        { id:'outstanding', label:'Outstanding',       value:fmt(outstandingTotal),sub:'Across all accounts',color:'var(--warning)' },
        { id:'recurring',   label:'Recurring Contracts',value:outstanding.length,  sub:'Active series',      color:'var(--info)' },
      ];
      kpis.forEach(k => {
        const el = document.getElementById(`acc-kpi-${k.id}`);
        if (!el) return;
        el.innerHTML = `<div class="kpi-label">${k.label}</div><div class="kpi-value" style="color:${k.color};">${k.value}</div><div class="kpi-sub">${k.sub}</div>`;
      });

      // Recent payments table
      const pEl = document.getElementById('recentPayments');
      if (!payments.length) {
        pEl.innerHTML = `<div class="empty-state"><i class="fa-solid fa-receipt"></i><p>No payments recorded</p></div>`;
      } else {
        pEl.innerHTML = `
          <table class="data-table">
            <thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Method</th><th>Ref</th></tr></thead>
            <tbody>
              ${payments.slice(0,20).map(p=>`
                <tr>
                  <td style="color:var(--text-muted);font-size:0.8rem;">${fmtDate(p.payment_date||p.created_at)}</td>
                  <td style="font-weight:600;">${p.customer_name||p.customer_id||'—'}</td>
                  <td style="color:var(--success);font-weight:600;">${fmt(p.amount)}</td>
                  <td><span class="badge badge-info">${p.payment_method||'—'}</span></td>
                  <td style="font-family:monospace;font-size:0.75rem;color:var(--text-muted);">${p.reference_number||'—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }

      // Outstanding list
      const oEl = document.getElementById('outstandingList');
      if (!outstanding.length) {
        oEl.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>No outstanding balances</p></div>`;
      } else {
        oEl.innerHTML = `
          <table class="data-table">
            <thead><tr><th>Customer</th><th>Due Date</th><th>Amount</th></tr></thead>
            <tbody>
              ${outstanding.slice(0,20).map(r=>`
                <tr>
                  <td style="font-weight:600;">${r.full_name||r.customer_name||'—'}</td>
                  <td>${fmtDate(r.due_date||r.next_due_date)}</td>
                  <td style="color:var(--warning);font-weight:600;">${fmt(r.amount_due||r.next_amount_due)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    } catch (err) {
      toast.error('Failed to load accounts: ' + err.message);
    }
  },
};
export default view;

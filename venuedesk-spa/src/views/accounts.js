/**
 * views/accounts.js — Financial summary
 * GET /accounts/transactions, GET /recurring/outstanding-payments
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

        <!-- Finance metric dials — mirrors accounts.html fin-metrics-grid exactly -->
        <div class="fin-metrics-grid" id="kpiRow">
          ${[
            { id:'total',       cls:'card-fin-revenue',     fin:'--fin-color:#10b981' },
            { id:'month',       cls:'card-fin-deposits',    fin:'--fin-color:#6366f1' },
            { id:'outstanding', cls:'card-fin-outstanding', fin:'--fin-color:#f59e0b' },
            { id:'recurring',   cls:'card-fin-recurring',   fin:'--fin-color:#0ea5e9' },
          ].map(k=>`
            <div class="fin-metric-card ${k.cls}" id="acc-kpi-${k.id}" style="--pct:0%">
              <div class="fin-dial-ring" style="--pct:0%">
                <span class="fin-dial-short">—</span>
              </div>
              <div class="fin-metric-info">
                <div class="fin-metric-label">&nbsp;</div>
                <div class="fin-metric-val">—</div>
                <div class="fin-metric-sub">
                  <span class="spinner" style="width:12px;height:12px;border-width:2px;margin:0;display:inline-block;vertical-align:middle;"></span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="table-wrap">
          <div class="table-title"><i class="fa-solid fa-receipt"></i> Recent Payments</div>
          <div id="recentPayments" class="table-inner"><div class="spinner" style="margin:2rem auto;"></div></div>
        </div>

        <div class="table-wrap">
          <div class="table-title"><i class="fa-solid fa-circle-exclamation" style="color:var(--warning);"></i> Outstanding Balances</div>
          <div id="outstandingList" class="table-inner"><div class="spinner" style="margin:2rem auto;"></div></div>
        </div>
      </main>
    `;
    initSidebar();
    this._load();
  },

  async _load() {
    try {
      const [paymentsRes, outstandingRes] = await Promise.allSettled([
        api.get('/accounts/transactions'),
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

      // pct helper — cap at 100, 0-guard
      const pct = (v, max) => `${Math.min(Math.round(((parseFloat(v)||0) / max) * 100), 100)}%`;

      const kpis = [
        { id:'total',       label:'Total Revenue',       val:fmt(totalRevenue),     short:fmt(totalRevenue),     pct: totalRevenue > 0  ? '75%' : '0%' },
        { id:'month',       label:now.toLocaleString('en-GB',{month:'long'}),       val:fmt(monthRevenue),       short:fmt(monthRevenue),     pct: monthRevenue > 0 ? '60%' : '0%' },
        { id:'outstanding', label:'Outstanding',         val:fmt(outstandingTotal), short:fmt(outstandingTotal), pct: outstandingTotal > 0 ? '70%' : '0%' },
        { id:'recurring',   label:'Recurring Contracts', val:String(outstanding.length), short:String(outstanding.length), pct: pct(outstanding.length, 10) },
      ];
      kpis.forEach(k => {
        const el = document.getElementById(`acc-kpi-${k.id}`);
        if (!el) return;
        el.style.setProperty('--pct', k.pct);
        el.innerHTML = `
          <div class="fin-dial-ring" style="--pct:${k.pct}">
            <span class="fin-dial-short">${k.short}</span>
          </div>
          <div class="fin-metric-info">
            <div class="fin-metric-label">${k.label}</div>
            <div class="fin-metric-val">${k.val}</div>
          </div>
        `;
      });

      // Recent payments table
      const pEl = document.getElementById('recentPayments');
      if (!payments.length) {
        pEl.innerHTML = `<div class="empty-state" style="padding:3rem;"><i class="fa-solid fa-receipt"></i><p>No payments recorded</p></div>`;
      } else {
        pEl.innerHTML = `
          <table>
            <thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Method</th><th>Type</th><th>Ref</th></tr></thead>
            <tbody>
              ${payments.slice(0,20).map(p=>`
                <tr>
                  <td style="color:var(--text-muted);font-size:0.8rem;white-space:nowrap;">${fmtDate(p.payment_date||p.created_at)}</td>
                  <td style="font-weight:600;">${p.customer_name||p.customer_id||'—'}</td>
                  <td style="color:var(--success);font-weight:600;">${fmt(p.amount)}</td>
                  <td><span class="badge badge-info">${p.payment_method||'—'}</span></td>
                  <td><span class="type-pill type-${(p.payment_type||'payment').toLowerCase()}">${p.payment_type||'payment'}</span></td>
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
        oEl.innerHTML = `<div class="empty-state" style="padding:3rem;"><i class="fa-solid fa-circle-check"></i><p>No outstanding balances</p></div>`;
      } else {
        oEl.innerHTML = `
          <table>
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

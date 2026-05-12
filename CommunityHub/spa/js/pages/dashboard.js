import { Auth, API_BASE } from '../auth.js';
import { UI } from '../ui.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(n)||0);
const tidParam = url => url + (url.includes('?') ? '&' : '?') + 'tenant_id=' + encodeURIComponent(Auth.getTenantId());
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Module state ─────────────────────────────────────────────────────────────
let _interval = null;
let allRequests = [];
let allUpcomingEvents = [];
let allOutstandingPayments = [];
let allBookings = [];
let allInteractions = [];
let allCustomers = [];
let allRooms = [];
let currentFilter = 'requests';

// KPI month navigation
const now = new Date();
let kpiMonth = now.getMonth(); // 0-indexed
let kpiYear  = now.getFullYear();
let kpiBookMonth = now.getMonth();
let kpiBookYear  = now.getFullYear();

// Pagination state
let cardPage = 1; const CARD_PAGE_SIZE = 6;
let outPage  = 1; const OUT_PAGE_SIZE  = 6;
let custPage = 1; const CUST_PAGE_SIZE = 15;

// Search state
let cardSearch = '';
let outSearch  = '';
let intSearch  = '';
let custSearch = '';

// Selected items for modals
let selectedRequest  = null;
let selectedBooking  = null;
let selectedPayBook  = null;
let selectedInteract = null;
let selectedLogCust  = null;
let confirmRooms     = [];

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
/* ── KPI Cards ── */
.dash-kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem}
@media(max-width:900px){.dash-kpi-grid{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.dash-kpi-grid{grid-template-columns:1fr}}
.kpi-card{background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:1.2rem 1.4rem;display:flex;flex-direction:column;gap:.4rem}
.kpi-label{font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.kpi-value{font-size:2rem;font-weight:700;color:var(--text-main);line-height:1.1}
.kpi-sub{font-size:.8rem;color:var(--text-muted)}
.kpi-nav{display:flex;align-items:center;gap:.5rem;margin-top:.2rem}
.kpi-nav button{background:var(--bg-input,#1e1e2e);border:1px solid var(--border);border-radius:6px;color:var(--text-muted);cursor:pointer;padding:2px 8px;font-size:.85rem;transition:background .15s}
.kpi-nav button:hover{background:var(--primary);color:#fff}
.kpi-nav span{font-size:.8rem;color:var(--text-muted);min-width:60px;text-align:center}

/* ── Filter tabs ── */
.dash-filter-tabs{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1.2rem}
.filter-tab{padding:.45rem 1.1rem;border-radius:20px;border:none;font-size:.82rem;font-weight:600;cursor:pointer;transition:all .15s;background:var(--card-bg);color:var(--text-muted);border:1px solid var(--border)}
.filter-tab.requests.active,.filter-tab.requests:hover{background:#ef4444;color:#fff;border-color:#ef4444}
.filter-tab.upcoming.active,.filter-tab.upcoming:hover{background:#22c55e;color:#fff;border-color:#22c55e}
.filter-tab.interactions.active,.filter-tab.interactions:hover{background:#a855f7;color:#fff;border-color:#a855f7}
.filter-tab.customers.active,.filter-tab.customers:hover{background:#06b6d4;color:#fff;border-color:#06b6d4}

/* ── 2-col grid ── */
.dash-main-grid{display:grid;grid-template-columns:1fr 380px;gap:1.2rem;align-items:start}
@media(max-width:1100px){.dash-main-grid{grid-template-columns:1fr}}

/* ── Section panels ── */
.dash-panel{background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:1.2rem}
.dash-panel-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.9rem;gap:.6rem;flex-wrap:wrap}
.dash-panel-title{font-size:.95rem;font-weight:700;color:var(--text-main);margin:0}
.dash-search{padding:.4rem .75rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-input,#1e1e2e);color:var(--text-main);font-size:.82rem;outline:none;min-width:160px}
.dash-search:focus{border-color:var(--primary)}

/* ── Booking card ── */
.booking-card{display:flex;align-items:center;gap:.9rem;padding:.75rem .9rem;border-radius:10px;border:1px solid var(--border);background:var(--bg-card2,#1a1a2e);cursor:pointer;transition:border-color .15s,transform .1s;margin-bottom:.55rem}
.booking-card:hover{border-color:var(--primary);transform:translateY(-1px)}
.booking-card:last-child{margin-bottom:0}
.bc-date{min-width:44px;text-align:center;background:var(--primary-dim,rgba(99,102,241,.18));border-radius:8px;padding:.45rem .3rem;line-height:1.1}
.bc-date .day{font-size:1.3rem;font-weight:700;color:var(--primary);display:block}
.bc-date .mon{font-size:.65rem;font-weight:600;text-transform:uppercase;color:var(--text-muted)}
.bc-info{flex:1;min-width:0}
.bc-name{font-size:.88rem;font-weight:600;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bc-sub{font-size:.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bc-right{display:flex;flex-direction:column;align-items:flex-end;gap:.35rem;min-width:80px}
.status-pill{font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:capitalize;white-space:nowrap}
.status-pending{background:rgba(245,158,11,.18);color:#f59e0b}
.status-contacted{background:rgba(99,102,241,.18);color:#818cf8}
.status-confirmed{background:rgba(34,197,94,.18);color:#22c55e}
.status-cancelled{background:rgba(239,68,68,.18);color:#ef4444}
.status-paid{background:rgba(34,197,94,.18);color:#22c55e}
.status-deposit{background:rgba(245,158,11,.18);color:#f59e0b}
.bc-btn{font-size:.73rem;padding:3px 11px;border-radius:7px;border:none;cursor:pointer;font-weight:600;transition:background .15s}
.bc-btn-pay{background:#22c55e;color:#fff}
.bc-btn-pay:hover{background:#16a34a}
.bc-btn-view{background:var(--primary,#6366f1);color:#fff}
.bc-btn-view:hover{background:#4f46e5}

/* ── Pagination ── */
.dash-pagination{display:flex;align-items:center;justify-content:center;gap:.5rem;margin-top:.8rem}
.dash-pagination button{background:var(--bg-input,#1e1e2e);border:1px solid var(--border);border-radius:6px;color:var(--text-muted);cursor:pointer;padding:4px 12px;font-size:.8rem}
.dash-pagination button:disabled{opacity:.4;cursor:default}
.dash-pagination button.active{background:var(--primary);color:#fff;border-color:var(--primary)}
.dash-pagination span{font-size:.78rem;color:var(--text-muted)}

/* ── Full-width table sections ── */
.dash-full{background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:1.2rem}
.dash-table-wrap{overflow-x:auto;margin-top:.8rem}
.dash-table{width:100%;border-collapse:collapse;font-size:.83rem}
.dash-table th{text-align:left;padding:.6rem .75rem;color:var(--text-muted);font-weight:600;font-size:.74rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
.dash-table td{padding:.65rem .75rem;border-bottom:1px solid var(--border);color:var(--text-main);vertical-align:top}
.dash-table tr:last-child td{border-bottom:none}
.dash-table tr:hover td{background:rgba(99,102,241,.06);cursor:pointer}
.dash-table .notes-cell{max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dash-toolbar{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}
.dash-export-btn{padding:.4rem .9rem;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:.8rem;font-weight:600;cursor:pointer;transition:background .15s}
.dash-export-btn:hover{background:#4f46e5}

/* ── Modals ── */
.db-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(3px)}
.db-modal-overlay.hidden{display:none}
.db-modal{background:var(--card-bg);border:1px solid var(--border);border-radius:16px;width:100%;max-width:680px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.db-modal.wide{max-width:820px}
.db-modal-header{display:flex;align-items:center;justify-content:space-between;padding:1.2rem 1.4rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card-bg);z-index:1;border-radius:16px 16px 0 0}
.db-modal-title{font-size:1.05rem;font-weight:700;color:var(--text-main);margin:0}
.db-modal-close{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.2rem;padding:4px 8px;border-radius:6px;transition:color .15s}
.db-modal-close:hover{color:var(--danger,#ef4444)}
.db-modal-body{padding:1.4rem}
.db-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:.7rem 1.2rem}
@media(max-width:560px){.db-field-grid{grid-template-columns:1fr}}
.db-field{display:flex;flex-direction:column;gap:.25rem}
.db-field label{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)}
.db-field span,.db-field p{font-size:.88rem;color:var(--text-main);margin:0;word-break:break-word}
.db-section-title{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin:1.2rem 0 .6rem;border-bottom:1px solid var(--border);padding-bottom:.4rem}
.db-modal-footer{padding:1rem 1.4rem;border-top:1px solid var(--border);display:flex;gap:.7rem;flex-wrap:wrap;justify-content:flex-end;background:var(--card-bg);border-radius:0 0 16px 16px}
.db-btn{padding:.55rem 1.3rem;border-radius:9px;border:none;font-size:.85rem;font-weight:600;cursor:pointer;transition:background .15s}
.db-btn-primary{background:var(--primary);color:#fff}
.db-btn-primary:hover{background:#4f46e5}
.db-btn-success{background:#22c55e;color:#fff}
.db-btn-success:hover{background:#16a34a}
.db-btn-danger{background:#ef4444;color:#fff}
.db-btn-danger:hover{background:#dc2626}
.db-btn-secondary{background:var(--bg-input,#1e1e2e);border:1px solid var(--border);color:var(--text-muted)}
.db-btn-secondary:hover{color:var(--text-main);border-color:var(--primary)}

/* Confirm inline form */
.confirm-section{background:var(--bg-input,#1e1e2e);border:1px solid var(--border);border-radius:10px;padding:1rem;margin-top:.8rem}
.confirm-section .db-section-title{margin-top:0}
.services-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.4rem;margin-bottom:.7rem}
.service-check,.room-check{display:flex;align-items:center;gap:.4rem;font-size:.82rem;color:var(--text-main);cursor:pointer;padding:.3rem .5rem;border-radius:6px;transition:background .1s}
.service-check:hover,.room-check:hover{background:rgba(99,102,241,.12)}
.service-check input,.room-check input{accent-color:var(--primary)}
.db-input{padding:.45rem .75rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-input,#1e1e2e);color:var(--text-main);font-size:.85rem;outline:none;width:100%}
.db-input:focus{border-color:var(--primary)}
.db-select{padding:.45rem .75rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-input,#1e1e2e);color:var(--text-main);font-size:.85rem;outline:none;width:100%;cursor:pointer}
.db-select:focus{border-color:var(--primary)}
.db-textarea{padding:.45rem .75rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-input,#1e1e2e);color:var(--text-main);font-size:.85rem;outline:none;width:100%;min-height:80px;resize:vertical}
.db-textarea:focus{border-color:var(--primary)}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:.6rem}
@media(max-width:480px){.field-row{grid-template-columns:1fr}}

/* Payment modal slider */
.pay-slider-wrap{margin:1rem 0}
.pay-slider{width:100%;accent-color:var(--primary)}
.pay-amount-display{text-align:center;font-size:1.8rem;font-weight:700;color:var(--primary);margin:.5rem 0}
.pay-balance-info{font-size:.82rem;color:var(--text-muted);text-align:center;margin-bottom:.8rem}

/* Receipt */
.receipt-icon{font-size:3rem;text-align:center;margin-bottom:.8rem}
.receipt-amount{font-size:2.2rem;font-weight:700;color:#22c55e;text-align:center;margin:.4rem 0}
.receipt-ref{font-size:.85rem;color:var(--text-muted);text-align:center}
.receipt-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem .9rem;margin:1rem 0}

/* Expiry warning badge */
.expiry-warning{display:inline-flex;align-items:center;gap:.3rem;font-size:.7rem;font-weight:700;color:#f59e0b;background:rgba(245,158,11,.12);padding:2px 7px;border-radius:8px;margin-left:.4rem}

/* Empty state */
.dash-empty{text-align:center;padding:2.5rem 1rem;color:var(--text-muted);font-size:.88rem}
.dash-empty i{font-size:2rem;display:block;margin-bottom:.5rem;opacity:.5}

/* Booking history mini-table */
.mini-table{width:100%;border-collapse:collapse;font-size:.8rem}
.mini-table th{text-align:left;padding:.4rem .5rem;color:var(--text-muted);font-weight:600;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
.mini-table td{padding:.45rem .5rem;border-bottom:1px solid var(--border);color:var(--text-main)}
.mini-table tr:last-child td{border-bottom:none}
`;

// ── Render ────────────────────────────────────────────────────────────────────
function renderPage() {
    return `
<div id="dash-root">
  <!-- KPI cards -->
  <div class="dash-kpi-grid" id="dash-kpi">
    <div class="kpi-card">
      <div class="kpi-label">Monthly Revenue</div>
      <div class="kpi-value" id="kpi-revenue">${UI.spinner()}</div>
      <div class="kpi-nav">
        <button id="rev-prev"><i class="fa-solid fa-chevron-left"></i></button>
        <span id="rev-label">${MONTHS[kpiMonth]} ${kpiYear}</span>
        <button id="rev-next"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Pending Requests</div>
      <div class="kpi-value" id="kpi-pending">—</div>
      <div class="kpi-sub">Awaiting action</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Monthly Bookings</div>
      <div class="kpi-value" id="kpi-bookings">—</div>
      <div class="kpi-nav">
        <button id="book-prev"><i class="fa-solid fa-chevron-left"></i></button>
        <span id="book-label">${MONTHS[kpiBookMonth]} ${kpiBookYear}</span>
        <button id="book-next"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
    </div>
  </div>

  <!-- Filter tabs -->
  <div class="dash-filter-tabs">
    <button class="filter-tab requests active" data-filter="requests"><i class="fa-solid fa-clock-rotate-left"></i> Pending Requests</button>
    <button class="filter-tab upcoming" data-filter="upcoming"><i class="fa-solid fa-calendar-check"></i> Upcoming Events</button>
    <button class="filter-tab interactions" data-filter="interactions"><i class="fa-solid fa-comments"></i> Customer Interactions</button>
    <button class="filter-tab customers" data-filter="customers"><i class="fa-solid fa-users"></i> Customers</button>
  </div>

  <!-- Main 2-col grid (hidden on interactions/customers) -->
  <div class="dash-main-grid" id="dash-grid">
    <!-- Left: cards section -->
    <div class="dash-panel">
      <div class="dash-panel-header">
        <h3 class="dash-panel-title" id="cards-title">Pending Requests</h3>
        <input class="dash-search" id="card-search" placeholder="Search…" value="">
      </div>
      <div id="cards-list"></div>
      <div class="dash-pagination" id="cards-pager"></div>
    </div>

    <!-- Right: Outstanding payments -->
    <div class="dash-panel">
      <div class="dash-panel-header">
        <h3 class="dash-panel-title">Outstanding Payments</h3>
        <input class="dash-search" id="out-search" placeholder="Search…" value="">
      </div>
      <div id="out-list"></div>
      <div class="dash-pagination" id="out-pager"></div>
    </div>
  </div>

  <!-- Interactions full-width (hidden by default) -->
  <div class="dash-full hidden" id="dash-interactions">
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">Customer Interactions</h3>
      <div class="dash-toolbar">
        <input class="dash-search" id="int-search" placeholder="Search…">
        <button class="dash-export-btn" id="int-export"><i class="fa-solid fa-download"></i> Export CSV</button>
      </div>
    </div>
    <div class="dash-table-wrap">
      <table class="dash-table" id="int-table">
        <thead><tr>
          <th>Customer</th><th>Email</th><th>Subject</th><th>Type</th><th>Date &amp; Time</th><th>Staff</th><th>Notes</th>
        </tr></thead>
        <tbody id="int-tbody"></tbody>
      </table>
    </div>
    <div class="dash-pagination" id="int-pager"></div>
  </div>

  <!-- Customers full-width (hidden by default) -->
  <div class="dash-full hidden" id="dash-customers">
    <div class="dash-panel-header">
      <h3 class="dash-panel-title">Customers</h3>
      <div class="dash-toolbar">
        <input class="dash-search" id="cust-search" placeholder="Search…">
      </div>
    </div>
    <div class="dash-table-wrap">
      <table class="dash-table" id="cust-table">
        <thead><tr>
          <th>Name</th><th>Email / Phone</th><th>Event Type</th><th>Date</th><th>Status</th>
        </tr></thead>
        <tbody id="cust-tbody"></tbody>
      </table>
    </div>
    <div class="dash-pagination" id="cust-pager"></div>
  </div>
</div>

<!-- ── Modals ── -->

<!-- Customer/Request modal -->
<div class="db-modal-overlay hidden" id="custModal">
  <div class="db-modal wide">
    <div class="db-modal-header">
      <h2 class="db-modal-title" id="custModal-title">Customer Details</h2>
      <button class="db-modal-close" data-close="custModal"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="db-modal-body" id="custModal-body"></div>
  </div>
</div>

<!-- Booking detail modal -->
<div class="db-modal-overlay hidden" id="bookMod">
  <div class="db-modal">
    <div class="db-modal-header">
      <h2 class="db-modal-title">Booking Details</h2>
      <button class="db-modal-close" data-close="bookMod"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="db-modal-body" id="bookMod-body"></div>
    <div class="db-modal-footer" id="bookMod-footer"></div>
  </div>
</div>

<!-- Payment modal -->
<div class="db-modal-overlay hidden" id="payMod">
  <div class="db-modal">
    <div class="db-modal-header">
      <h2 class="db-modal-title">Pay Balance</h2>
      <button class="db-modal-close" data-close="payMod"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="db-modal-body" id="payMod-body"></div>
  </div>
</div>

<!-- Receipt modal -->
<div class="db-modal-overlay hidden" id="receiptMod">
  <div class="db-modal">
    <div class="db-modal-header">
      <h2 class="db-modal-title">Payment Receipt</h2>
      <button class="db-modal-close" data-close="receiptMod"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="db-modal-body" id="receiptMod-body"></div>
    <div class="db-modal-footer">
      <button class="db-btn db-btn-primary" data-close="receiptMod">Done</button>
    </div>
  </div>
</div>

<!-- Interaction detail modal -->
<div class="db-modal-overlay hidden" id="interactionModal">
  <div class="db-modal">
    <div class="db-modal-header">
      <h2 class="db-modal-title">Interaction Details</h2>
      <button class="db-modal-close" data-close="interactionModal"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="db-modal-body" id="interactionModal-body"></div>
    <div class="db-modal-footer">
      <button class="db-btn db-btn-secondary" data-close="interactionModal">Close</button>
    </div>
  </div>
</div>

<!-- Log Interaction modal -->
<div class="db-modal-overlay hidden" id="logIntModal">
  <div class="db-modal">
    <div class="db-modal-header">
      <h2 class="db-modal-title">Log Interaction</h2>
      <button class="db-modal-close" data-close="logIntModal"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="db-modal-body">
      <div class="db-field" style="margin-bottom:.7rem">
        <label>Subject</label>
        <input class="db-input" id="logInt-subject" placeholder="Subject…">
      </div>
      <div class="db-field" style="margin-bottom:.7rem">
        <label>Type</label>
        <select class="db-select" id="logInt-type">
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
          <option value="note">Note</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="db-field" style="margin-bottom:.7rem">
        <label>Notes</label>
        <textarea class="db-textarea" id="logInt-notes" placeholder="Notes…"></textarea>
      </div>
    </div>
    <div class="db-modal-footer">
      <button class="db-btn db-btn-secondary" data-close="logIntModal">Cancel</button>
      <button class="db-btn db-btn-primary" id="logInt-submit">Save Interaction</button>
    </div>
  </div>
</div>
`;
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadDashboard() {
    try {
        const res = await fetch(tidParam(`${API_BASE}/staff-dashboard`), { headers: Auth.headers() });
        const json = await res.json();
        const metrics = json?.data?.metrics || {};
        const el = document.getElementById('kpi-pending');
        if (el) el.textContent = metrics.pending_requests ?? '—';
    } catch(e) {
        console.warn('loadDashboard error', e);
    }
}

async function loadMonthlyRevenue() {
    const el = document.getElementById('kpi-revenue');
    if (!el) return;
    el.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="font-size:1rem"></i>';
    try {
        const url = `${API_BASE}/get-monthly-revenue?month=${kpiMonth+1}&year=${kpiYear}&tenant_id=${encodeURIComponent(Auth.getTenantId())}`;
        const res = await fetch(url, { headers: Auth.headers() });
        const json = await res.json();
        el.textContent = fmt(json?.total_revenue ?? 0);
    } catch(e) {
        el.textContent = '—';
    }
}

async function loadAllBookings() {
    try {
        const res = await fetch(tidParam(`${API_BASE}/all-bookings`), { headers: Auth.headers() });
        const json = await res.json();
        allBookings = Array.isArray(json?.data) ? json.data : [];
        processBookings();
        renderCardsSection();
        renderOutstandingPanel();
        updateKpiBookings();
    } catch(e) {
        console.warn('loadAllBookings error', e);
    }
}

async function loadAllInteractions() {
    try {
        const res = await fetch(tidParam(`${API_BASE}/customer-interactions?email=all`), { headers: Auth.headers() });
        const json = await res.json();
        allInteractions = Array.isArray(json?.data) ? json.data : [];
        renderInteractionsTable();
    } catch(e) {
        console.warn('loadAllInteractions error', e);
    }
}

async function loadAllCustomers() {
    try {
        const res = await fetch(tidParam(`${API_BASE}/all-customers`), { headers: Auth.headers() });
        const json = await res.json();
        allCustomers = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
        renderCustomersTable();
    } catch(e) {
        console.warn('loadAllCustomers error', e);
    }
}

async function loadRooms() {
    try {
        const res = await fetch(tidParam(`${API_BASE}/get-rooms`), { headers: Auth.headers() });
        const json = await res.json();
        allRooms = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
    } catch(e) {
        console.warn('loadRooms error', e);
    }
}

function processBookings() {
    const today = new Date(); today.setHours(0,0,0,0);
    allRequests = allBookings.filter(b => {
        const s = (b.status || '').toLowerCase();
        return s === 'pending' || s === 'contacted';
    });
    allUpcomingEvents = allBookings.filter(b => {
        const s = (b.status || '').toLowerCase();
        if (s === 'cancelled' || s === 'pending' || s === 'contacted') return false;
        const d = new Date(b.event_date || b.date || b.created_at);
        return d >= today;
    });
    allOutstandingPayments = allBookings.filter(b => {
        const bal = parseFloat(b.balance_due || 0);
        if (bal <= 0) return false;
        const d = new Date(b.event_date || b.date || b.created_at);
        return d >= today;
    });
    checkExpiryWarnings();
}

// ── Expiry warnings ───────────────────────────────────────────────────────────
async function checkExpiryWarnings() {
    const todayStr = new Date().toISOString().slice(0,10);
    for (const req of allRequests) {
        const created = new Date(req.created_at);
        const daysLeft = Math.ceil((created.getTime() + 3*24*3600000 - Date.now()) / 86400000);
        if (daysLeft >= 1 && daysLeft <= 3) {
            const key = `vp_warn_${req.id}_${todayStr}`;
            if (!localStorage.getItem(key)) {
                localStorage.setItem(key, '1');
                try {
                    await fetch(`${API_BASE}/send-expiry-warning`, {
                        method: 'POST',
                        headers: Auth.headers(),
                        body: JSON.stringify({
                            customer_id: req.customer_id || req.id,
                            customer_name: req.customer_name || req.name,
                            customer_email: req.customer_email || req.email,
                            days_left: daysLeft,
                            event_type: req.event_type,
                            event_date: req.event_date || req.date,
                            tenant_id: Auth.getTenantId()
                        })
                    });
                } catch(e) { /* silent */ }
            }
        }
    }
}

// ── KPI helpers ───────────────────────────────────────────────────────────────
function updateKpiBookings() {
    const el = document.getElementById('kpi-bookings');
    if (!el) return;
    const count = allBookings.filter(b => {
        const d = new Date(b.event_date || b.date || b.created_at);
        return d.getMonth() === kpiBookMonth && d.getFullYear() === kpiBookYear;
    }).length;
    el.textContent = count;
}

// ── Rendering helpers ─────────────────────────────────────────────────────────
function statusPill(status) {
    const s = (status || 'pending').toLowerCase();
    return `<span class="status-pill status-${s}">${esc(status || 'pending')}</span>`;
}

function dateBadge(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return `<div class="bc-date"><span class="day">—</span><span class="mon">—</span></div>`;
    return `<div class="bc-date"><span class="day">${d.getDate()}</span><span class="mon">${MONTHS[d.getMonth()]}</span></div>`;
}

function daysLeftBadge(createdAt) {
    const daysLeft = Math.ceil((new Date(createdAt).getTime() + 3*24*3600000 - Date.now()) / 86400000);
    if (daysLeft >= 1 && daysLeft <= 3) {
        return `<span class="expiry-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${daysLeft}d left</span>`;
    }
    return '';
}

function bookingCard(b, btnType) {
    const name = esc(b.customer_name || b.name || 'Unknown');
    const sub  = esc([b.event_type, b.room_name || b.room].filter(Boolean).join(' · ') || '—');
    const date = b.event_date || b.date || b.created_at;
    const expiry = (btnType === 'view' && (b.status||'').toLowerCase() === 'pending') ? daysLeftBadge(b.created_at) : '';
    const btn = btnType === 'pay'
        ? `<button class="bc-btn bc-btn-pay" data-action="pay" data-id="${esc(b.id)}"><i class="fa-solid fa-sterling-sign"></i> Pay</button>`
        : `<button class="bc-btn bc-btn-view" data-action="view" data-id="${esc(b.id)}"><i class="fa-solid fa-eye"></i> View</button>`;
    return `
<div class="booking-card" data-id="${esc(b.id)}" data-type="${btnType}">
  ${dateBadge(date)}
  <div class="bc-info">
    <div class="bc-name">${name}${expiry}</div>
    <div class="bc-sub">${sub}</div>
  </div>
  <div class="bc-right">
    ${statusPill(b.status)}
    ${btn}
  </div>
</div>`;
}

// ── Cards section ─────────────────────────────────────────────────────────────
function getFilteredCards() {
    let list = currentFilter === 'upcoming' ? allUpcomingEvents : allRequests;
    if (cardSearch) {
        const q = cardSearch.toLowerCase();
        list = list.filter(b =>
            (b.customer_name||b.name||'').toLowerCase().includes(q) ||
            (b.event_type||'').toLowerCase().includes(q) ||
            (b.room_name||b.room||'').toLowerCase().includes(q)
        );
    }
    return list;
}

function renderCardsSection() {
    const list = getFilteredCards();
    const totalPages = Math.max(1, Math.ceil(list.length / CARD_PAGE_SIZE));
    if (cardPage > totalPages) cardPage = 1;
    const slice = list.slice((cardPage-1)*CARD_PAGE_SIZE, cardPage*CARD_PAGE_SIZE);

    const titleEl = document.getElementById('cards-title');
    if (titleEl) titleEl.textContent = currentFilter === 'upcoming' ? 'Upcoming Events' : 'Pending Requests';

    const container = document.getElementById('cards-list');
    if (!container) return;
    if (slice.length === 0) {
        container.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-calendar-xmark"></i>${currentFilter === 'upcoming' ? 'No upcoming events' : 'No pending requests'}</div>`;
    } else {
        container.innerHTML = slice.map(b => bookingCard(b, 'view')).join('');
    }
    renderPager('cards-pager', cardPage, totalPages, p => { cardPage = p; renderCardsSection(); });
}

// ── Outstanding panel ─────────────────────────────────────────────────────────
function getFilteredOut() {
    let list = allOutstandingPayments;
    if (outSearch) {
        const q = outSearch.toLowerCase();
        list = list.filter(b =>
            (b.customer_name||b.name||'').toLowerCase().includes(q) ||
            (b.event_type||'').toLowerCase().includes(q)
        );
    }
    return list;
}

function renderOutstandingPanel() {
    const list = getFilteredOut();
    const totalPages = Math.max(1, Math.ceil(list.length / OUT_PAGE_SIZE));
    if (outPage > totalPages) outPage = 1;
    const slice = list.slice((outPage-1)*OUT_PAGE_SIZE, outPage*OUT_PAGE_SIZE);

    const container = document.getElementById('out-list');
    if (!container) return;
    if (slice.length === 0) {
        container.innerHTML = `<div class="dash-empty"><i class="fa-solid fa-check-circle"></i>No outstanding payments</div>`;
    } else {
        container.innerHTML = slice.map(b => bookingCard(b, 'pay')).join('');
    }
    renderPager('out-pager', outPage, totalPages, p => { outPage = p; renderOutstandingPanel(); });
}

// ── Pagination renderer ───────────────────────────────────────────────────────
function renderPager(id, current, total, cb) {
    const el = document.getElementById(id);
    if (!el) return;
    if (total <= 1) { el.innerHTML = ''; return; }
    let html = `<button ${current===1?'disabled':''} data-p="${current-1}"><i class="fa-solid fa-chevron-left"></i></button>`;
    for (let i=1; i<=total; i++) {
        html += `<button class="${i===current?'active':''}" data-p="${i}">${i}</button>`;
    }
    html += `<button ${current===total?'disabled':''} data-p="${current+1}"><i class="fa-solid fa-chevron-right"></i></button>`;
    el.innerHTML = html;
    el.querySelectorAll('button[data-p]').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = parseInt(btn.dataset.p);
            if (!isNaN(p) && p >= 1 && p <= total) cb(p);
        });
    });
}

// ── Interactions table ────────────────────────────────────────────────────────
let intPage = 1; const INT_PAGE_SIZE = 20;

function getFilteredInteractions() {
    let list = allInteractions;
    if (intSearch) {
        const q = intSearch.toLowerCase();
        list = list.filter(i =>
            (i.customer_name||i.name||'').toLowerCase().includes(q) ||
            (i.customer_email||i.email||'').toLowerCase().includes(q) ||
            (i.subject||'').toLowerCase().includes(q) ||
            (i.type||'').toLowerCase().includes(q) ||
            (i.staff||i.staff_name||'').toLowerCase().includes(q) ||
            (i.notes||'').toLowerCase().includes(q)
        );
    }
    return list;
}

function renderInteractionsTable() {
    const list = getFilteredInteractions();
    const totalPages = Math.max(1, Math.ceil(list.length / INT_PAGE_SIZE));
    if (intPage > totalPages) intPage = 1;
    const slice = list.slice((intPage-1)*INT_PAGE_SIZE, intPage*INT_PAGE_SIZE);

    const tbody = document.getElementById('int-tbody');
    if (!tbody) return;
    if (slice.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)">No interactions found</td></tr>`;
    } else {
        tbody.innerHTML = slice.map(i => `
<tr data-int-id="${esc(i.id||'')}">
  <td>${esc(i.customer_name||i.name||'—')}</td>
  <td>${esc(i.customer_email||i.email||'—')}</td>
  <td>${esc(i.subject||'—')}</td>
  <td>${esc(i.type||'—')}</td>
  <td>${esc(UI.date(i.created_at||i.date))} ${esc(UI.time(i.created_at||i.date))}</td>
  <td>${esc(i.staff||i.staff_name||'—')}</td>
  <td class="notes-cell">${esc(i.notes||'—')}</td>
</tr>`).join('');
    }
    renderPager('int-pager', intPage, totalPages, p => { intPage = p; renderInteractionsTable(); });
}

// ── Customers table ───────────────────────────────────────────────────────────
function getFilteredCustomers() {
    let list = allCustomers;
    if (custSearch) {
        const q = custSearch.toLowerCase();
        list = list.filter(c =>
            (c.customer_name||c.name||'').toLowerCase().includes(q) ||
            (c.customer_email||c.email||'').toLowerCase().includes(q) ||
            (c.phone||'').toLowerCase().includes(q) ||
            (c.event_type||'').toLowerCase().includes(q)
        );
    }
    return list;
}

function renderCustomersTable() {
    const list = getFilteredCustomers();
    const totalPages = Math.max(1, Math.ceil(list.length / CUST_PAGE_SIZE));
    if (custPage > totalPages) custPage = 1;
    const slice = list.slice((custPage-1)*CUST_PAGE_SIZE, custPage*CUST_PAGE_SIZE);

    const tbody = document.getElementById('cust-tbody');
    if (!tbody) return;
    if (slice.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted)">No customers found</td></tr>`;
    } else {
        tbody.innerHTML = slice.map(c => `
<tr data-cust-id="${esc(c.id||c.customer_id||'')}">
  <td>${esc(c.customer_name||c.name||'—')}</td>
  <td>
    <div>${esc(c.customer_email||c.email||'—')}</div>
    <div style="font-size:.75rem;color:var(--text-muted)">${esc(c.phone||'')}</div>
  </td>
  <td>${esc(c.event_type||'—')}</td>
  <td>${esc(UI.date(c.event_date||c.date))}</td>
  <td>${statusPill(c.status)}</td>
</tr>`).join('');
    }
    renderPager('cust-pager', custPage, totalPages, p => { custPage = p; renderCustomersTable(); });
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

// ── Customer/Request modal ────────────────────────────────────────────────────
async function openCustModal(item) {
    selectedRequest = item;
    const status = (item.status||'pending').toLowerCase();
    const isPending = status === 'pending' || status === 'contacted';

    // Load booking history and interactions
    const custEmail = item.customer_email || item.email || '';
    const bookingHistory = allBookings.filter(b =>
        (b.customer_email||b.email||'') === custEmail && b.id !== item.id
    );
    const custInteractions = allInteractions.filter(i =>
        (i.customer_email||i.email||'') === custEmail
    );

    // Build confirm section if pending
    let confirmHtml = '';
    if (isPending) {
        const services = ['DJ/Music','Catering','Decorations','Photography','Videography','Bar Service','Lighting','Security','Cleaning'];
        const servicesHtml = services.map(s => `
<label class="service-check">
  <input type="checkbox" class="svc-check" value="${esc(s)}"> ${esc(s)}
</label>`).join('');

        const roomsHtml = allRooms.length
            ? allRooms.map(r => `
<label class="room-check">
  <input type="checkbox" class="room-chk" value="${esc(r.id||r.room_id||r.name)}" data-name="${esc(r.name||r.room_name||r.id)}"> ${esc(r.name||r.room_name||r.id)}
</label>`).join('')
            : '<p style="color:var(--text-muted);font-size:.82rem">No rooms loaded</p>';

        confirmHtml = `
<div class="confirm-section" id="confirm-section">
  <div class="db-section-title">Confirm Booking</div>
  <div class="db-section-title" style="margin-top:.5rem">Services</div>
  <div class="services-grid">${servicesHtml}</div>
  <div class="db-section-title">Rooms</div>
  <div class="services-grid">${roomsHtml}</div>
  <div class="field-row" style="margin-top:.7rem">
    <div class="db-field">
      <label>Total Price (£)</label>
      <input class="db-input" id="conf-total" type="number" min="0" step="0.01" placeholder="0.00" value="${esc(item.total_amount||'')}">
    </div>
    <div class="db-field">
      <label>Deposit (£)</label>
      <input class="db-input" id="conf-deposit" type="number" min="0" step="0.01" placeholder="0.00" value="${esc(item.deposit_amount||'')}">
    </div>
  </div>
  <div class="db-field" style="margin-top:.5rem">
    <label>Payment Method</label>
    <select class="db-select" id="conf-payment-method">
      <option value="cash">Cash</option>
      <option value="card">Card</option>
      <option value="bank_transfer">Bank Transfer</option>
      <option value="cheque">Cheque</option>
    </select>
  </div>
  <div style="display:flex;gap:.6rem;margin-top:.9rem;justify-content:flex-end">
    <button class="db-btn db-btn-danger" id="conf-cancel-btn">Cancel Request</button>
    <button class="db-btn db-btn-success" id="conf-confirm-btn">Confirm Booking</button>
  </div>
</div>`;
    }

    // Booking history rows
    const histHtml = bookingHistory.length
        ? bookingHistory.map(b => `
<tr>
  <td>${esc(UI.date(b.event_date||b.date))}</td>
  <td>${esc(b.event_type||'—')}</td>
  <td>${esc(b.room_name||b.room||'—')}</td>
  <td>${statusPill(b.status)}</td>
  <td>${esc(fmt(b.total_amount||0))}</td>
</tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No previous bookings</td></tr>';

    // Interactions rows
    const intHtml = custInteractions.length
        ? custInteractions.map(i => `
<tr>
  <td>${esc(UI.date(i.created_at||i.date))}</td>
  <td>${esc(i.subject||'—')}</td>
  <td>${esc(i.type||'—')}</td>
  <td>${esc(i.notes||'—')}</td>
</tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No interactions</td></tr>';

    const titleEl = document.getElementById('custModal-title');
    if (titleEl) titleEl.textContent = esc(item.customer_name||item.name||'Customer');

    const body = document.getElementById('custModal-body');
    if (!body) return;
    body.innerHTML = `
<div class="db-field-grid">
  <div class="db-field"><label>Customer ID</label><span>${esc(item.id||item.customer_id||'—')}</span></div>
  <div class="db-field"><label>Status</label><span>${statusPill(item.status)}</span></div>
  <div class="db-field"><label>Name</label><span>${esc(item.customer_name||item.name||'—')}</span></div>
  <div class="db-field"><label>Email</label><span>${esc(item.customer_email||item.email||'—')}</span></div>
  <div class="db-field"><label>Phone</label><span>${esc(item.phone||item.customer_phone||'—')}</span></div>
  <div class="db-field"><label>Event Type</label><span>${esc(item.event_type||'—')}</span></div>
  <div class="db-field"><label>Room</label><span>${esc(item.room_name||item.room||'—')}</span></div>
  <div class="db-field"><label>Date</label><span>${esc(UI.date(item.event_date||item.date))}</span></div>
  <div class="db-field"><label>Guests</label><span>${esc(item.guests||item.guest_count||'—')}</span></div>
  <div class="db-field"><label>Notes</label><span>${esc(item.notes||item.special_requests||'—')}</span></div>
</div>
${confirmHtml}
<div class="db-section-title">Booking History</div>
<div style="overflow-x:auto">
  <table class="mini-table">
    <thead><tr><th>Date</th><th>Event</th><th>Room</th><th>Status</th><th>Total</th></tr></thead>
    <tbody>${histHtml}</tbody>
  </table>
</div>
<div class="db-section-title">Customer Interactions</div>
<div style="display:flex;justify-content:flex-end;margin-bottom:.5rem">
  <button class="db-btn db-btn-primary" id="log-int-from-cust" style="font-size:.8rem;padding:.35rem .9rem"><i class="fa-solid fa-plus"></i> Log Interaction</button>
</div>
<div style="overflow-x:auto">
  <table class="mini-table">
    <thead><tr><th>Date</th><th>Subject</th><th>Type</th><th>Notes</th></tr></thead>
    <tbody>${intHtml}</tbody>
  </table>
</div>`;

    // Bind confirm/cancel buttons
    if (isPending) {
        document.getElementById('conf-confirm-btn')?.addEventListener('click', () => confirmRequest(item));
        document.getElementById('conf-cancel-btn')?.addEventListener('click', () => cancelRequest(item));
    }
    document.getElementById('log-int-from-cust')?.addEventListener('click', () => {
        selectedLogCust = item;
        openModal('logIntModal');
        document.getElementById('logInt-subject').value = '';
        document.getElementById('logInt-notes').value = '';
    });

    // Mark as contacted if pending
    if (status === 'pending') {
        const user = Auth.getUser();
        try {
            await fetch(`${API_BASE}/update-status`, {
                method: 'POST',
                headers: Auth.headers(),
                body: JSON.stringify({ id: item.id, staff_name: user.name || user.email || 'Staff' })
            });
        } catch(e) { /* silent */ }
    }

    openModal('custModal');
}

async function confirmRequest(item) {
    const total    = parseFloat(document.getElementById('conf-total')?.value || 0);
    const deposit  = parseFloat(document.getElementById('conf-deposit')?.value || 0);
    const method   = document.getElementById('conf-payment-method')?.value || 'cash';
    const services = Array.from(document.querySelectorAll('.svc-check:checked')).map(c => c.value);
    const rooms    = Array.from(document.querySelectorAll('.room-chk:checked')).map(c => ({ id: c.value, name: c.dataset.name }));

    if (!total) { UI.toast('Please enter a total price', 'warning'); return; }
    if (!deposit) { UI.toast('Please enter a deposit amount', 'warning'); return; }

    const btn = document.getElementById('conf-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Confirming…'; }

    try {
        const res = await fetch(`${API_BASE}/confirm-booking`, {
            method: 'POST',
            headers: Auth.headers(),
            body: JSON.stringify({
                request_id: item.id,
                customer_id: item.customer_id || item.id,
                total_amount: total,
                balance_due: total - deposit,
                deposit_amount: deposit,
                payment_method: method,
                services: services,
                rooms: rooms,
                tenant_id: Auth.getTenantId()
            })
        });
        if (!res.ok) throw new Error('API error');
        UI.toast('Booking confirmed!', 'success');
        closeModal('custModal');
        await refreshAll();
    } catch(e) {
        UI.toast('Failed to confirm booking', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm Booking'; }
    }
}

async function cancelRequest(item) {
    if (!confirm(`Cancel request for ${item.customer_name||item.name}?`)) return;
    try {
        await fetch(`${API_BASE}/cancel-pending`, {
            method: 'POST',
            headers: Auth.headers(),
            body: JSON.stringify({ customer_id: item.customer_id||item.id, tenant_id: Auth.getTenantId() })
        });
        UI.toast('Request cancelled', 'info');
        closeModal('custModal');
        await refreshAll();
    } catch(e) {
        UI.toast('Failed to cancel request', 'error');
    }
}

// ── Booking detail modal ──────────────────────────────────────────────────────
function openBookingModal(booking) {
    selectedBooking = booking;
    const bal = parseFloat(booking.balance_due || 0);
    const isPaid = bal <= 0;

    const body = document.getElementById('bookMod-body');
    const footer = document.getElementById('bookMod-footer');
    if (!body || !footer) return;

    body.innerHTML = `
<div class="db-field-grid">
  <div class="db-field"><label>Name</label><span>${esc(booking.customer_name||booking.name||'—')}</span></div>
  <div class="db-field"><label>Email</label><span>${esc(booking.customer_email||booking.email||'—')}</span></div>
  <div class="db-field"><label>Phone</label><span>${esc(booking.phone||booking.customer_phone||'—')}</span></div>
  <div class="db-field"><label>Room</label><span>${esc(booking.room_name||booking.room||'—')}</span></div>
  <div class="db-field"><label>Date</label><span>${esc(UI.date(booking.event_date||booking.date))}</span></div>
  <div class="db-field"><label>Time</label><span>${esc(UI.time(booking.event_date||booking.date))}</span></div>
  <div class="db-field"><label>Guests</label><span>${esc(booking.guests||booking.guest_count||'—')}</span></div>
  <div class="db-field"><label>Event Type</label><span>${esc(booking.event_type||'—')}</span></div>
  <div class="db-field"><label>Status</label><span>${statusPill(isPaid ? 'paid' : 'deposit')}</span></div>
  <div class="db-field"><label>Payment Method</label><span>${esc(booking.payment_method||'—')}</span></div>
  <div class="db-field"><label>Total</label><span style="font-weight:600">${fmt(booking.total_amount||0)}</span></div>
  <div class="db-field"><label>Deposit Paid</label><span style="color:#22c55e">${fmt(booking.deposit_amount||0)}</span></div>
  <div class="db-field"><label>Balance Due</label><span style="color:${bal>0?'#f59e0b':'#22c55e'}">${fmt(bal)}</span></div>
</div>`;

    footer.innerHTML = `
<button class="db-btn db-btn-secondary" data-close="bookMod">Close</button>
${bal > 0 ? `<button class="db-btn db-btn-success" id="bookMod-pay-btn"><i class="fa-solid fa-sterling-sign"></i> Pay Balance</button>` : ''}`;

    document.getElementById('bookMod-pay-btn')?.addEventListener('click', () => {
        closeModal('bookMod');
        openPayModal(booking);
    });
    // rebind close buttons in footer
    footer.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });

    openModal('bookMod');
}

// ── Payment modal ─────────────────────────────────────────────────────────────
function openPayModal(booking) {
    selectedPayBook = booking;
    const bal = parseFloat(booking.balance_due || 0);

    const body = document.getElementById('payMod-body');
    if (!body) return;

    body.innerHTML = `
<div class="db-field-grid" style="margin-bottom:1rem">
  <div class="db-field"><label>Customer</label><span>${esc(booking.customer_name||booking.name||'—')}</span></div>
  <div class="db-field"><label>Event</label><span>${esc(booking.event_type||'—')}</span></div>
  <div class="db-field"><label>Date</label><span>${esc(UI.date(booking.event_date||booking.date))}</span></div>
  <div class="db-field"><label>Balance Due</label><span style="color:#f59e0b;font-weight:600">${fmt(bal)}</span></div>
</div>
<div class="pay-balance-info">Drag slider or type amount below</div>
<div class="pay-slider-wrap">
  <input class="pay-slider" id="pay-slider" type="range" min="0" max="${bal.toFixed(2)}" step="0.01" value="${bal.toFixed(2)}">
</div>
<div class="pay-amount-display" id="pay-amount-display">${fmt(bal)}</div>
<div class="db-field" style="margin-bottom:.7rem">
  <label>Amount (£)</label>
  <input class="db-input" id="pay-amount-input" type="number" min="0" max="${bal.toFixed(2)}" step="0.01" value="${bal.toFixed(2)}">
</div>
<div class="db-field" style="margin-bottom:.7rem">
  <label>Payment Method</label>
  <select class="db-select" id="pay-method">
    <option value="cash">Cash</option>
    <option value="card">Card</option>
    <option value="bank_transfer">Bank Transfer</option>
    <option value="cheque">Cheque</option>
  </select>
</div>
<div class="db-field" style="margin-bottom:1rem">
  <label>Reference (optional)</label>
  <input class="db-input" id="pay-ref" placeholder="Reference number…">
</div>
<div style="display:flex;justify-content:flex-end;gap:.6rem">
  <button class="db-btn db-btn-secondary" data-close="payMod">Cancel</button>
  <button class="db-btn db-btn-success" id="pay-confirm-btn"><i class="fa-solid fa-check"></i> Confirm Payment</button>
</div>`;

    // Wire slider <-> input
    const slider = document.getElementById('pay-slider');
    const input  = document.getElementById('pay-amount-input');
    const display = document.getElementById('pay-amount-display');
    slider?.addEventListener('input', () => {
        input.value = slider.value;
        display.textContent = fmt(parseFloat(slider.value)||0);
    });
    input?.addEventListener('input', () => {
        const v = Math.min(parseFloat(input.value)||0, bal);
        slider.value = v;
        display.textContent = fmt(v);
    });

    body.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    document.getElementById('pay-confirm-btn')?.addEventListener('click', () => submitPayment());

    openModal('payMod');
}

async function submitPayment() {
    const amount = parseFloat(document.getElementById('pay-amount-input')?.value || 0);
    const method = document.getElementById('pay-method')?.value || 'cash';
    const ref    = document.getElementById('pay-ref')?.value || '';

    if (!amount || amount <= 0) { UI.toast('Please enter a valid amount', 'warning'); return; }

    const btn = document.getElementById('pay-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

    try {
        const res = await fetch(`${API_BASE}/pay-balance`, {
            method: 'POST',
            headers: Auth.headers(),
            body: JSON.stringify({
                booking_id: selectedPayBook.id,
                customer_id: selectedPayBook.customer_id || selectedPayBook.id,
                amount,
                payment_method: method,
                deposit_reference: ref
            })
        });
        if (!res.ok) throw new Error('API error');
        closeModal('payMod');
        showReceipt(amount, method, ref);
        await refreshAll();
    } catch(e) {
        UI.toast('Payment failed. Please try again.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm Payment'; }
    }
}

function showReceipt(amount, method, ref) {
    const refNum = ref || ('VP-' + Date.now().toString(36).toUpperCase());
    const body = document.getElementById('receiptMod-body');
    if (!body) return;
    body.innerHTML = `
<div class="receipt-icon">🧾</div>
<div class="receipt-amount">${fmt(amount)}</div>
<div class="receipt-ref">Reference: ${esc(refNum)}</div>
<div class="receipt-grid">
  <div class="db-field"><label>Payment Type</label><span>${esc(method)}</span></div>
  <div class="db-field"><label>Date</label><span>${UI.date(new Date())}</span></div>
  <div class="db-field"><label>Customer</label><span>${esc(selectedPayBook?.customer_name||selectedPayBook?.name||'—')}</span></div>
  <div class="db-field"><label>Event</label><span>${esc(selectedPayBook?.event_type||'—')}</span></div>
</div>`;
    openModal('receiptMod');
}

// ── Interaction detail modal ──────────────────────────────────────────────────
function openInteractionModal(interaction) {
    selectedInteract = interaction;
    const body = document.getElementById('interactionModal-body');
    if (!body) return;
    body.innerHTML = `
<div class="db-field-grid">
  <div class="db-field"><label>Customer</label><span>${esc(interaction.customer_name||interaction.name||'—')}</span></div>
  <div class="db-field"><label>Email</label><span>${esc(interaction.customer_email||interaction.email||'—')}</span></div>
  <div class="db-field"><label>Subject</label><span>${esc(interaction.subject||'—')}</span></div>
  <div class="db-field"><label>Type</label><span>${esc(interaction.type||'—')}</span></div>
  <div class="db-field"><label>Date</label><span>${esc(UI.date(interaction.created_at||interaction.date))}</span></div>
  <div class="db-field"><label>Staff</label><span>${esc(interaction.staff||interaction.staff_name||'—')}</span></div>
</div>
<div class="db-section-title">Notes</div>
<p style="font-size:.88rem;color:var(--text-main);line-height:1.6">${esc(interaction.notes||'No notes recorded.')}</p>`;
    openModal('interactionModal');
}

// ── Log Interaction submit ────────────────────────────────────────────────────
async function submitLogInteraction() {
    const subject = document.getElementById('logInt-subject')?.value?.trim();
    const type    = document.getElementById('logInt-type')?.value;
    const notes   = document.getElementById('logInt-notes')?.value?.trim();

    if (!subject) { UI.toast('Please enter a subject', 'warning'); return; }

    const btn = document.getElementById('logInt-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    const user = Auth.getUser();
    const cust = selectedLogCust || selectedRequest;
    try {
        const res = await fetch(`${API_BASE}/customer-interactions`, {
            method: 'POST',
            headers: Auth.headers(),
            body: JSON.stringify({
                customer_id: cust?.customer_id || cust?.id,
                customer_name: cust?.customer_name || cust?.name,
                customer_email: cust?.customer_email || cust?.email,
                subject,
                type,
                notes,
                staff_name: user.name || user.email || 'Staff',
                tenant_id: Auth.getTenantId()
            })
        });
        if (!res.ok) throw new Error('API error');
        UI.toast('Interaction logged', 'success');
        closeModal('logIntModal');
        await loadAllInteractions();
        if (document.getElementById('custModal')?.classList.contains('hidden') === false && cust) {
            openCustModal(cust);
        }
    } catch(e) {
        UI.toast('Failed to log interaction', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Save Interaction'; }
    }
}

// ── Filter tab switching ──────────────────────────────────────────────────────
function switchFilter(filter) {
    currentFilter = filter;
    cardPage = 1;
    custPage = 1;
    intPage  = 1;
    cardSearch = '';
    custSearch = '';
    intSearch  = '';

    // Update tab active state
    document.querySelectorAll('.filter-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.filter === filter);
    });

    const grid   = document.getElementById('dash-grid');
    const intSec = document.getElementById('dash-interactions');
    const custSec = document.getElementById('dash-customers');

    if (filter === 'interactions') {
        grid?.classList.add('hidden');
        intSec?.classList.remove('hidden');
        custSec?.classList.add('hidden');
        renderInteractionsTable();
    } else if (filter === 'customers') {
        grid?.classList.add('hidden');
        intSec?.classList.add('hidden');
        custSec?.classList.remove('hidden');
        if (allCustomers.length === 0) loadAllCustomers();
        else renderCustomersTable();
    } else {
        grid?.classList.remove('hidden');
        intSec?.classList.add('hidden');
        custSec?.classList.add('hidden');
        renderCardsSection();
    }

    // Reset search inputs
    const cs = document.getElementById('card-search');
    if (cs) cs.value = '';
    const is = document.getElementById('int-search');
    if (is) is.value = '';
    const css2 = document.getElementById('cust-search');
    if (css2) css2.value = '';
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportInteractionsCSV() {
    const list = getFilteredInteractions();
    const rows = [['Customer','Email','Subject','Type','Date','Staff','Notes']];
    list.forEach(i => rows.push([
        i.customer_name||i.name||'',
        i.customer_email||i.email||'',
        i.subject||'',
        i.type||'',
        i.created_at||i.date||'',
        i.staff||i.staff_name||'',
        (i.notes||'').replace(/"/g,'""')
    ]));
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `interactions_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ── Full refresh ──────────────────────────────────────────────────────────────
async function refreshAll() {
    await Promise.all([
        loadDashboard(),
        loadAllBookings(),
        loadAllInteractions(),
        loadMonthlyRevenue()
    ]);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    // Initial render of sections
    renderCardsSection();
    renderOutstandingPanel();
    renderInteractionsTable();

    // ── Delegate modal close (overlay click + close buttons) ──
    document.querySelectorAll('#dash-root ~ .db-modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });
    // Also catch any close buttons added to modals
    document.addEventListener('click', e => {
        const closeBtn = e.target.closest('[data-close]');
        if (closeBtn) closeModal(closeBtn.dataset.close);
    });

    // ── Filter tabs ──
    document.querySelectorAll('.filter-tab').forEach(btn => {
        btn.addEventListener('click', () => switchFilter(btn.dataset.filter));
    });

    // ── Card list clicks ──
    document.getElementById('cards-list')?.addEventListener('click', e => {
        const card = e.target.closest('.booking-card');
        if (!card) return;
        const id = card.dataset.id;
        const item = allRequests.concat(allUpcomingEvents).find(b => String(b.id) === String(id));
        if (!item) return;
        const status = (item.status||'').toLowerCase();
        if (status === 'pending' || status === 'contacted') {
            openCustModal(item);
        } else {
            openBookingModal(item);
        }
    });

    // ── Outstanding list clicks ──
    document.getElementById('out-list')?.addEventListener('click', e => {
        const actionBtn = e.target.closest('[data-action="pay"]');
        if (actionBtn) {
            e.stopPropagation();
            const id = actionBtn.dataset.id;
            const booking = allOutstandingPayments.find(b => String(b.id) === String(id));
            if (booking) openPayModal(booking);
            return;
        }
        const card = e.target.closest('.booking-card');
        if (card) {
            const id = card.dataset.id;
            const booking = allOutstandingPayments.find(b => String(b.id) === String(id));
            if (booking) openBookingModal(booking);
        }
    });

    // ── Interactions table clicks ──
    document.getElementById('int-tbody')?.addEventListener('click', e => {
        const row = e.target.closest('tr');
        if (!row) return;
        const id = row.dataset.intId;
        const interaction = allInteractions.find(i => String(i.id) === String(id));
        if (interaction) openInteractionModal(interaction);
    });

    // ── Customers table clicks ──
    document.getElementById('cust-tbody')?.addEventListener('click', e => {
        const row = e.target.closest('tr');
        if (!row) return;
        const id = row.dataset.custId;
        const cust = allCustomers.find(c => String(c.id||c.customer_id) === String(id));
        if (cust) openCustModal(cust);
    });

    // ── Search inputs ──
    document.getElementById('card-search')?.addEventListener('input', e => {
        cardSearch = e.target.value;
        cardPage = 1;
        renderCardsSection();
    });
    document.getElementById('out-search')?.addEventListener('input', e => {
        outSearch = e.target.value;
        outPage = 1;
        renderOutstandingPanel();
    });
    document.getElementById('int-search')?.addEventListener('input', e => {
        intSearch = e.target.value;
        intPage = 1;
        renderInteractionsTable();
    });
    document.getElementById('cust-search')?.addEventListener('input', e => {
        custSearch = e.target.value;
        custPage = 1;
        renderCustomersTable();
    });

    // ── Export CSV ──
    document.getElementById('int-export')?.addEventListener('click', exportInteractionsCSV);

    // ── Log interaction submit ──
    document.getElementById('logInt-submit')?.addEventListener('click', submitLogInteraction);

    // ── KPI month navigation ──
    document.getElementById('rev-prev')?.addEventListener('click', () => {
        kpiMonth--; if (kpiMonth < 0) { kpiMonth = 11; kpiYear--; }
        document.getElementById('rev-label').textContent = `${MONTHS[kpiMonth]} ${kpiYear}`;
        loadMonthlyRevenue();
    });
    document.getElementById('rev-next')?.addEventListener('click', () => {
        kpiMonth++; if (kpiMonth > 11) { kpiMonth = 0; kpiYear++; }
        document.getElementById('rev-label').textContent = `${MONTHS[kpiMonth]} ${kpiYear}`;
        loadMonthlyRevenue();
    });
    document.getElementById('book-prev')?.addEventListener('click', () => {
        kpiBookMonth--; if (kpiBookMonth < 0) { kpiBookMonth = 11; kpiBookYear--; }
        document.getElementById('book-label').textContent = `${MONTHS[kpiBookMonth]} ${kpiBookYear}`;
        updateKpiBookings();
    });
    document.getElementById('book-next')?.addEventListener('click', () => {
        kpiBookMonth++; if (kpiBookMonth > 11) { kpiBookMonth = 0; kpiBookYear++; }
        document.getElementById('book-label').textContent = `${MONTHS[kpiBookMonth]} ${kpiBookYear}`;
        updateKpiBookings();
    });

    // ── pageshow refresh ──
    window.addEventListener('pageshow', refreshAll);

    // ── Load data ──
    await loadRooms();
    await refreshAll();

    // ── Auto-refresh every 60s ──
    _interval = setInterval(refreshAll, 60000);
}

// ── Destroy ───────────────────────────────────────────────────────────────────
function destroy() {
    if (_interval) { clearInterval(_interval); _interval = null; }
    window.removeEventListener('pageshow', refreshAll);
}

// ── Export ────────────────────────────────────────────────────────────────────
export default {
    title: 'Dashboard',
    css: CSS,
    render() { return renderPage(); },
    init,
    destroy
};

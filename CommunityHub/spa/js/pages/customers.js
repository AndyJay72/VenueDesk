import { Auth, API_BASE } from '../auth.js';
import { UI } from '../ui.js';

// ── Helpers ─────────────────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(parseFloat(n) || 0);
const tidParam = (sep = '?') => { const t = Auth.getTenantId(); return t ? `${sep}tenant_id=${encodeURIComponent(t)}` : ''; };
const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d || '—'; } };
const fmtDateShort = d => { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); } catch { return d || '—'; } };

function dateRange(obj, short = false) {
    const fn = short ? fmtDateShort : fmtDate;
    if (obj.date_from && obj.date_to && obj.date_to.slice(0, 10) !== obj.date_from.slice(0, 10)) {
        return `${fn(obj.date_from)} – ${fn(obj.date_to)}`;
    }
    const d = obj.date_from || obj.event_date || obj.requested_date || obj.booking_date;
    return d ? fn(d) : 'N/A';
}

function statusBadge(status) {
    const map = {
        pending: 'cu-badge-pending',
        contacted: 'cu-badge-contacted',
        booked: 'cu-badge-booked',
        deposit_paid: 'cu-badge-booked',
        fully_paid: 'cu-badge-booked',
        cancelled: 'cu-badge-cancelled',
    };
    const cls = map[status] || 'cu-badge-pending';
    const label = status ? status.replace(/_/g, ' ') : 'unknown';
    return `<span class="cu-status-badge ${cls}">${esc(label)}</span>`;
}

function interactionTypeBadge(type) {
    const colors = {
        'Phone Call': '#6366f1', 'Email': '#06b6d4', 'In Person': '#10b981',
        'SMS': '#f59e0b', 'WhatsApp': '#22c55e', 'Other': '#94a3b8',
    };
    const c = colors[type] || '#94a3b8';
    return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:0.7rem;font-weight:700;background:${c}22;color:${c};border:1px solid ${c}44;">${esc(type)}</span>`;
}

// ── Module state ─────────────────────────────────────────────────────────────
let _allCustomers = [];
let _filtered = [];
let _currentPage = 1;
let _searchQ = '';
let _statusFilter = 'all';
let _currentCustomer = null;
let _currentBookingCtx = null;
let _listeners = [];

const PAGE_SIZE = 10;

function addListener(el, evt, fn) {
    if (!el) return;
    el.addEventListener(evt, fn);
    _listeners.push({ el, evt, fn });
}

function removeAllListeners() {
    _listeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
    _listeners = [];
}

// ── Render ───────────────────────────────────────────────────────────────────
export default {
    title: 'Customers',

    css: `
/* ── Customers page ──────────────────────────────────────────────────── */
#customers-page { animation: cu-fadeUp 0.3s ease both; }
@keyframes cu-fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }

/* Header */
.cu-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.75rem; flex-wrap:wrap; gap:1rem; }
.cu-header-left { display:flex; align-items:center; gap:1rem; }
.cu-title { font-size:1.75rem; font-weight:800; letter-spacing:-0.03em; color:var(--text-main); }
.cu-count-badge { background:rgba(99,102,241,0.15); color:var(--primary); border:1px solid rgba(99,102,241,0.3); border-radius:20px; font-size:0.78rem; font-weight:700; padding:3px 12px; }
.cu-header-right { display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap; }
.cu-search { background:rgba(0,0,0,0.22); border:1px solid var(--border); border-radius:10px; color:var(--text-main); padding:9px 14px 9px 36px; font-size:0.88rem; outline:none; width:220px; font-family:inherit; transition:border-color 0.2s; }
.cu-search:focus { border-color:var(--primary); }
.cu-search::placeholder { color:var(--text-muted); }
.cu-search-wrap { position:relative; }
.cu-search-wrap i { position:absolute; left:11px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:0.82rem; pointer-events:none; }
.cu-filter-select { background:rgba(0,0,0,0.22); border:1px solid var(--border); border-radius:10px; color:var(--text-main); padding:9px 14px; font-size:0.88rem; outline:none; cursor:pointer; font-family:inherit; }
.cu-filter-select option { background:#1e293b; }

/* Table */
.cu-table-container { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.18); }
.cu-table-wrapper { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.cu-table { width:100%; border-collapse:collapse; min-width:760px; }
.cu-table th { text-align:left; padding:1rem 1.25rem; color:var(--text-muted); font-size:0.78rem; text-transform:uppercase; font-weight:700; background:rgba(0,0,0,0.18); border-bottom:1px solid var(--border); letter-spacing:0.04em; }
.cu-table td { padding:1rem 1.25rem; border-bottom:1px solid var(--border); color:var(--text-main); font-size:0.92rem; vertical-align:middle; }
.cu-table tbody tr:last-child td { border-bottom:none; }
.cu-table tbody tr { cursor:pointer; transition:background 0.15s; }
.cu-table tbody tr:hover { background:rgba(255,255,255,0.04) !important; }
.cu-name { font-weight:700; color:var(--text-main); }
.cu-sub { font-size:0.8rem; color:var(--text-muted); margin-top:2px; }
.cu-empty { text-align:center; padding:3rem; color:var(--text-muted); }
.cu-empty i { display:block; font-size:2rem; margin-bottom:0.75rem; opacity:0.4; }

/* Status badges */
.cu-status-badge { padding:4px 11px; border-radius:20px; font-size:0.72rem; font-weight:700; text-transform:capitalize; display:inline-block; white-space:nowrap; }
.cu-badge-pending { background:rgba(245,158,11,0.15); color:var(--warning); border:1px solid rgba(245,158,11,0.3); }
.cu-badge-contacted { background:rgba(99,102,241,0.15); color:var(--primary); border:1px solid rgba(99,102,241,0.3); }
.cu-badge-booked { background:rgba(16,185,129,0.15); color:var(--success); border:1px solid rgba(16,185,129,0.3); }
.cu-badge-cancelled { background:rgba(239,68,68,0.1); color:#f87171; border:1px solid rgba(239,68,68,0.3); text-decoration:line-through; }

/* Pagination */
.cu-pagination { display:flex; align-items:center; justify-content:space-between; padding:1rem 1.25rem; border-top:1px solid var(--border); flex-wrap:wrap; gap:0.5rem; }
.cu-page-info { font-size:0.82rem; color:var(--text-muted); }
.cu-page-btns { display:flex; gap:5px; }
.cu-page-btn { background:var(--bg-card); border:1px solid var(--border); color:var(--text-muted); padding:5px 12px; border-radius:7px; cursor:pointer; font-size:0.82rem; font-weight:600; font-family:inherit; transition:0.2s; min-height:unset; }
.cu-page-btn:hover:not(:disabled) { border-color:var(--primary); color:var(--primary); }
.cu-page-btn:disabled { opacity:0.35; cursor:not-allowed; }
.cu-page-btn.cu-page-active { background:rgba(99,102,241,0.2); border-color:var(--primary); color:var(--primary); }

/* Customer detail modal */
.cu-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.72); backdrop-filter:blur(6px); z-index:2000; display:none; align-items:center; justify-content:center; opacity:0; transition:opacity 0.25s; }
.cu-modal-overlay.cu-open { display:flex; opacity:1; }
.cu-modal-card { background:#1e293b; border:1px solid var(--border); width:92%; max-width:900px; max-height:90vh; overflow-y:auto; border-radius:20px; padding:2rem; box-shadow:0 25px 60px rgba(0,0,0,0.5); transform:translateY(18px); transition:transform 0.28s; position:relative; }
.cu-modal-overlay.cu-open .cu-modal-card { transform:translateY(0); }
.cu-modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; border-bottom:1px solid var(--border); padding-bottom:1rem; }
.cu-modal-title { font-size:1.35rem; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:10px; }
.cu-modal-close { background:none; border:none; color:var(--text-muted); font-size:1.4rem; cursor:pointer; line-height:1; padding:4px; min-height:unset; transition:color 0.2s; }
.cu-modal-close:hover { color:var(--text-main); }
.cu-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.25rem; }
.cu-detail-span2 { grid-column:span 2; }
.cu-detail-group label { display:block; color:var(--text-muted); font-size:0.72rem; text-transform:uppercase; font-weight:700; margin-bottom:5px; letter-spacing:0.05em; }
.cu-detail-value { color:var(--text-main); font-size:0.95rem; background:rgba(0,0,0,0.2); padding:10px 12px; border-radius:8px; border:1px solid var(--border); min-height:38px; display:flex; align-items:center; }
.cu-detail-value.cu-mono { font-family:monospace; color:var(--warning); }
.cu-modal-actions { margin-top:1.75rem; display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border); padding-top:1rem; flex-wrap:wrap; }
.cu-btn { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-weight:700; font-size:0.88rem; transition:0.2s; text-decoration:none; display:inline-flex; align-items:center; gap:7px; font-family:inherit; }
.cu-btn-close { background:var(--bg-card); color:var(--text-muted); border:1px solid var(--border); }
.cu-btn-close:hover { color:var(--text-main); border-color:rgba(148,163,184,0.4); }
.cu-btn-book { background:var(--success); color:#0f172a; }
.cu-btn-book:hover { opacity:0.88; transform:translateY(-1px); }
.cu-btn-pay { background:var(--warning); color:#0f172a; }
.cu-btn-pay:hover { opacity:0.88; transform:translateY(-1px); }
.cu-btn-confirm { background:var(--primary); color:white; }
.cu-btn-confirm:hover { opacity:0.88; }
.cu-btn-cancel-booking { background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); }
.cu-btn-cancel-booking:hover { background:rgba(239,68,68,0.25); }
.cu-btn-log { background:rgba(99,102,241,0.15); color:var(--primary); border:1px solid rgba(99,102,241,0.3); padding:4px 11px; border-radius:6px; font-size:0.75rem; font-weight:700; cursor:pointer; font-family:inherit; transition:0.2s; min-height:unset; }
.cu-btn-log:hover { background:rgba(99,102,241,0.28); }

/* Booking history section */
.cu-bh-section { margin-top:1.75rem; border-top:1px solid var(--border); padding-top:1.25rem; }
.cu-bh-title { font-size:1rem; font-weight:700; color:var(--text-main); margin-bottom:1rem; display:flex; align-items:center; gap:8px; }
.cu-bh-stats { display:flex; gap:10px; margin-bottom:1rem; flex-wrap:wrap; }
.cu-bh-stat { flex:1; min-width:90px; background:rgba(0,0,0,0.22); border:1px solid var(--border); border-radius:9px; padding:10px 12px; text-align:center; }
.cu-bh-stat-val { font-size:1.05rem; font-weight:700; color:var(--text-main); }
.cu-bh-stat-lbl { font-size:0.7rem; color:var(--text-muted); margin-top:2px; }
.cu-bh-table { width:100%; border-collapse:collapse; font-size:0.82rem; }
.cu-bh-table th { color:var(--text-muted); font-size:0.7rem; text-transform:uppercase; padding:6px 8px; border-bottom:1px solid var(--border); text-align:left; font-weight:700; }
.cu-bh-table td { padding:8px 8px; border-bottom:1px solid rgba(148,163,184,0.06); color:var(--text-main); vertical-align:middle; }
.cu-bh-table tbody tr:last-child td { border-bottom:none; }
.cu-bh-table tbody tr { cursor:pointer; transition:background 0.15s; }
.cu-bh-table tbody tr:hover { background:rgba(99,102,241,0.08) !important; }
.cu-bh-empty { text-align:center; padding:1.25rem; color:var(--text-muted); font-size:0.85rem; }

/* Interactions section */
.cu-int-section { margin-top:1.75rem; border-top:1px solid var(--border); padding-top:1.25rem; }
.cu-int-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem; }
.cu-int-title { font-size:1rem; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px; }
.cu-int-header-actions { display:flex; gap:8px; }
.cu-btn-export { background:rgba(16,185,129,0.12); color:var(--success); border:1px solid rgba(16,185,129,0.28); padding:6px 14px; border-radius:8px; font-size:0.78rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; transition:0.2s; font-family:inherit; min-height:unset; }
.cu-btn-export:hover { background:rgba(16,185,129,0.22); }
.cu-btn-log-new { background:rgba(99,102,241,0.12); color:var(--primary); border:1px solid rgba(99,102,241,0.28); padding:6px 14px; border-radius:8px; font-size:0.78rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; transition:0.2s; font-family:inherit; min-height:unset; }
.cu-btn-log-new:hover { background:rgba(99,102,241,0.22); }
.cu-int-item { background:rgba(0,0,0,0.14); border:1px solid var(--border); border-radius:10px; padding:1rem; margin-bottom:0.65rem; transition:background 0.15s; }
.cu-int-item:hover { background:rgba(0,0,0,0.22); }
.cu-int-item-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:5px; gap:0.5rem; }
.cu-int-subject { font-weight:700; color:var(--text-main); font-size:0.92rem; }
.cu-int-date { font-size:0.72rem; color:var(--text-muted); white-space:nowrap; }
.cu-int-meta { display:flex; gap:1rem; font-size:0.72rem; color:var(--text-muted); margin-bottom:6px; flex-wrap:wrap; }
.cu-int-notes { font-size:0.85rem; color:var(--text-main); line-height:1.55; white-space:pre-wrap; }
.cu-no-int { text-align:center; padding:1.5rem; color:var(--text-muted); font-size:0.85rem; }

/* Inline confirm section */
.cu-confirm-section { margin-top:1.25rem; background:rgba(99,102,241,0.06); border:1px solid rgba(99,102,241,0.2); border-radius:12px; padding:1.25rem; }
.cu-confirm-title { font-size:0.9rem; font-weight:700; color:var(--primary); margin-bottom:1rem; display:flex; align-items:center; gap:7px; }
.cu-confirm-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem; }
.cu-confirm-group { display:flex; flex-direction:column; gap:5px; }
.cu-confirm-group label { font-size:0.72rem; text-transform:uppercase; color:var(--text-muted); font-weight:700; }
.cu-confirm-group input, .cu-confirm-group select { background:rgba(0,0,0,0.22); border:1px solid var(--border); color:var(--text-main); padding:9px 12px; border-radius:8px; font-size:0.88rem; font-family:inherit; outline:none; transition:border-color 0.2s; }
.cu-confirm-group input:focus, .cu-confirm-group select:focus { border-color:var(--primary); }
.cu-confirm-group select option { background:#1e293b; }
.cu-confirm-checks { display:flex; flex-direction:column; gap:6px; margin-bottom:1rem; }
.cu-confirm-checks-label { font-size:0.72rem; text-transform:uppercase; color:var(--text-muted); font-weight:700; margin-bottom:4px; }
.cu-check-grid { display:flex; flex-wrap:wrap; gap:6px; }
.cu-check-item { display:flex; align-items:center; gap:6px; background:rgba(0,0,0,0.14); border:1px solid var(--border); border-radius:7px; padding:5px 10px; font-size:0.82rem; cursor:pointer; }
.cu-check-item input[type=checkbox] { cursor:pointer; min-height:unset; }
.cu-confirm-actions { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
.cu-btn-confirm-dep { background:var(--success); color:#0f172a; }
.cu-btn-confirm-dep:hover { opacity:0.88; }
.cu-btn-confirm-nodep { background:rgba(16,185,129,0.12); color:var(--success); border:1px solid rgba(16,185,129,0.28); }
.cu-btn-confirm-nodep:hover { background:rgba(16,185,129,0.22); }

/* Log Interaction modal */
.cu-log-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.82); backdrop-filter:blur(6px); z-index:3000; display:none; align-items:center; justify-content:center; opacity:0; transition:opacity 0.25s; }
.cu-log-overlay.cu-open { display:flex; opacity:1; }
.cu-log-card { background:#1e293b; border:1px solid var(--border); width:92%; max-width:680px; max-height:88vh; overflow-y:auto; border-radius:20px; padding:2rem; box-shadow:0 25px 60px rgba(0,0,0,0.5); transform:translateY(18px); transition:transform 0.28s; }
.cu-log-overlay.cu-open .cu-log-card { transform:translateY(0); }
.cu-log-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; border-bottom:1px solid var(--border); padding-bottom:1rem; }
.cu-log-title { font-size:1.2rem; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:9px; }
.cu-log-ctx { display:grid; grid-template-columns:repeat(2,1fr); gap:0.75rem; background:rgba(0,0,0,0.14); border-radius:9px; padding:1rem; margin-bottom:1.25rem; }
.cu-log-ctx-item { display:flex; flex-direction:column; gap:3px; }
.cu-log-ctx-label { font-size:0.68rem; text-transform:uppercase; color:var(--text-muted); font-weight:700; }
.cu-log-ctx-value { font-size:0.88rem; color:var(--text-main); }
.cu-log-form { display:flex; flex-direction:column; gap:1.1rem; }
.cu-log-group { display:flex; flex-direction:column; gap:5px; }
.cu-log-group label { font-size:0.72rem; text-transform:uppercase; color:var(--text-muted); font-weight:700; }
.cu-log-input, .cu-log-textarea, .cu-log-select { background:rgba(0,0,0,0.22); border:1px solid var(--border); color:var(--text-main); padding:10px 12px; border-radius:8px; font-size:0.92rem; font-family:inherit; outline:none; transition:border-color 0.2s; width:100%; }
.cu-log-input:focus, .cu-log-textarea:focus, .cu-log-select:focus { border-color:var(--primary); }
.cu-log-select option { background:#1e293b; }
.cu-log-textarea { min-height:110px; resize:vertical; }
.cu-log-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:0.75rem; padding-top:1rem; border-top:1px solid var(--border); flex-wrap:wrap; }
.cu-btn-save { background:var(--primary); color:white; }
.cu-btn-save:hover { opacity:0.88; transform:translateY(-1px); }
.cu-btn-cancel-log { background:var(--bg-card); color:var(--text-muted); border:1px solid var(--border); }
.cu-btn-cancel-log:hover { color:var(--text-main); border-color:rgba(148,163,184,0.4); }

/* Light mode overrides */
body.light-mode .cu-title { color:#0f172a; }
body.light-mode .cu-table-container { background:rgba(255,255,255,0.92); border-color:rgba(0,0,0,0.1); }
body.light-mode .cu-table th { background:rgba(240,244,248,0.9); color:#475569; border-color:rgba(0,0,0,0.07); }
body.light-mode .cu-table td { color:#0f172a; border-color:rgba(0,0,0,0.06); }
body.light-mode .cu-table tbody tr:hover { background:rgba(0,0,0,0.03) !important; }
body.light-mode .cu-name { color:#0f172a; }
body.light-mode .cu-search { background:rgba(255,255,255,0.8); border-color:rgba(0,0,0,0.15); color:#0f172a; }
body.light-mode .cu-filter-select { background:rgba(255,255,255,0.8); border-color:rgba(0,0,0,0.15); color:#0f172a; }
body.light-mode .cu-filter-select option { background:#fff; color:#0f172a; }
body.light-mode .cu-modal-card { background:#ffffff; border-color:rgba(0,0,0,0.1); color:#0f172a; }
body.light-mode .cu-modal-title { color:#0f172a; }
body.light-mode .cu-detail-value { background:rgba(0,0,0,0.04); border-color:rgba(0,0,0,0.1); color:#0f172a; }
body.light-mode .cu-bh-stat { background:rgba(0,0,0,0.04); }
body.light-mode .cu-bh-stat-val { color:#0f172a; }
body.light-mode .cu-bh-table td { color:#0f172a; }
body.light-mode .cu-bh-table tbody tr:hover { background:rgba(0,0,0,0.03) !important; }
body.light-mode .cu-int-item { background:rgba(0,0,0,0.04); border-color:rgba(0,0,0,0.1); }
body.light-mode .cu-int-item:hover { background:rgba(0,0,0,0.08); }
body.light-mode .cu-int-subject { color:#0f172a; }
body.light-mode .cu-int-notes { color:#0f172a; }
body.light-mode .cu-log-card { background:#ffffff; border-color:rgba(0,0,0,0.1); }
body.light-mode .cu-log-title { color:#0f172a; }
body.light-mode .cu-log-ctx { background:rgba(0,0,0,0.04); }
body.light-mode .cu-log-ctx-value { color:#0f172a; }
body.light-mode .cu-log-input, body.light-mode .cu-log-textarea, body.light-mode .cu-log-select { background:rgba(0,0,0,0.04); border-color:rgba(0,0,0,0.15); color:#0f172a; }
body.light-mode .cu-log-select option { background:#fff; color:#0f172a; }
body.light-mode .cu-confirm-section { background:rgba(99,102,241,0.05); border-color:rgba(99,102,241,0.18); }
body.light-mode .cu-confirm-group input, body.light-mode .cu-confirm-group select { background:rgba(255,255,255,0.9); border-color:rgba(0,0,0,0.15); color:#0f172a; }
body.light-mode .cu-confirm-group select option { background:#fff; color:#0f172a; }
body.light-mode .cu-check-item { background:rgba(0,0,0,0.04); border-color:rgba(0,0,0,0.1); color:#0f172a; }
body.light-mode .cu-page-btn { background:rgba(255,255,255,0.8); border-color:rgba(0,0,0,0.12); color:#475569; }
body.light-mode .cu-page-btn.cu-page-active { background:rgba(99,102,241,0.15); border-color:var(--primary); color:var(--primary); }

/* Responsive */
@media (max-width: 768px) {
    .cu-header { flex-direction:column; align-items:flex-start; }
    .cu-header-right { width:100%; }
    .cu-search { width:100%; }
    .cu-detail-grid { grid-template-columns:1fr; }
    .cu-detail-span2 { grid-column:span 1; }
    .cu-confirm-grid { grid-template-columns:1fr; }
    .cu-log-ctx { grid-template-columns:1fr; }
    .cu-bh-table th:nth-child(3), .cu-bh-table td:nth-child(3) { display:none; }
}
@media (max-width: 480px) {
    .cu-modal-card { padding:1.25rem; }
    .cu-log-card { padding:1.25rem; }
    .cu-bh-stats { gap:6px; }
    .cu-bh-stat { min-width:70px; }
}
`,

    render() {
        return `
<div id="customers-page">
    <!-- Page header -->
    <div class="cu-header">
        <div class="cu-header-left">
            <h1 class="cu-title">Customers</h1>
            <span class="cu-count-badge" id="cu-count-badge">0</span>
        </div>
        <div class="cu-header-right">
            <div class="cu-search-wrap">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input class="cu-search" id="cu-search" type="text" placeholder="Search name, email, phone...">
            </div>
            <select class="cu-filter-select" id="cu-status-filter">
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="contacted">Contacted</option>
                <option value="booked">Booked</option>
                <option value="deposit_paid">Deposit Paid</option>
                <option value="fully_paid">Fully Paid</option>
                <option value="cancelled">Cancelled</option>
            </select>
        </div>
    </div>

    <!-- Table -->
    <div class="cu-table-container">
        <div class="cu-table-wrapper">
            <table class="cu-table" id="cu-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email / Phone</th>
                        <th>Event Type</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="cu-tbody">
                    <tr><td colspan="6" class="cu-empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading customers...</td></tr>
                </tbody>
            </table>
        </div>
        <div class="cu-pagination" id="cu-pagination" style="display:none;"></div>
    </div>
</div>

<!-- Customer Detail Modal -->
<div class="cu-modal-overlay" id="custModal">
    <div class="cu-modal-card" id="cu-modal-card">
        <div class="cu-modal-header">
            <div class="cu-modal-title"><i class="fa-solid fa-id-card" style="color:var(--primary)"></i> Customer Details</div>
            <button class="cu-modal-close" id="cu-modal-close-btn" aria-label="Close">&times;</button>
        </div>
        <div class="cu-detail-grid">
            <div class="cu-detail-group cu-detail-span2"><label>Customer ID</label><div class="cu-detail-value cu-mono" id="m-id">—</div></div>
            <div class="cu-detail-group"><label>Full Name</label><div class="cu-detail-value" id="m-name">—</div></div>
            <div class="cu-detail-group"><label>Status</label><div class="cu-detail-value" id="m-status">—</div></div>
            <div class="cu-detail-group"><label>Email</label><div class="cu-detail-value" id="m-email">—</div></div>
            <div class="cu-detail-group"><label>Phone</label><div class="cu-detail-value" id="m-phone">—</div></div>
            <div class="cu-detail-group"><label>Event Type</label><div class="cu-detail-value" id="m-event">—</div></div>
            <div class="cu-detail-group"><label>Room</label><div class="cu-detail-value" id="m-room">—</div></div>
            <div class="cu-detail-group"><label>Date</label><div class="cu-detail-value" id="m-date">—</div></div>
            <div class="cu-detail-group"><label>Guests</label><div class="cu-detail-value" id="m-guests">—</div></div>
            <div class="cu-detail-group cu-detail-span2"><label>Notes</label><div class="cu-detail-value" id="m-notes" style="white-space:pre-wrap;">—</div></div>
        </div>

        <!-- Booking History -->
        <div class="cu-bh-section">
            <div class="cu-bh-title"><i class="fa-solid fa-clock-rotate-left" style="color:var(--primary)"></i> Booking History</div>
            <div id="cu-bh-loading" class="cu-bh-empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>
            <div id="cu-bh-stats" class="cu-bh-stats" style="display:none;">
                <div class="cu-bh-stat"><div class="cu-bh-stat-val" id="cu-bh-count">0</div><div class="cu-bh-stat-lbl">Total Bookings</div></div>
                <div class="cu-bh-stat"><div class="cu-bh-stat-val" id="cu-bh-spend">£0</div><div class="cu-bh-stat-lbl">Total Spend</div></div>
                <div class="cu-bh-stat"><div class="cu-bh-stat-val" id="cu-bh-outstanding">£0</div><div class="cu-bh-stat-lbl">Outstanding</div></div>
            </div>
            <div id="cu-bh-table-wrap" style="display:none; overflow-x:auto;">
                <table class="cu-bh-table">
                    <thead><tr><th>Date</th><th>Room</th><th>Total</th><th>Balance</th><th>Status</th><th></th></tr></thead>
                    <tbody id="cu-bh-tbody"></tbody>
                </table>
            </div>
            <div id="cu-bh-empty" class="cu-bh-empty" style="display:none;">No bookings found</div>
        </div>

        <!-- Customer Interactions -->
        <div class="cu-int-section">
            <div class="cu-int-header">
                <div class="cu-int-title"><i class="fa-solid fa-comments" style="color:var(--primary)"></i> Interactions</div>
                <div class="cu-int-header-actions">
                    <button class="cu-btn-export" id="cu-export-btn"><i class="fa-solid fa-download"></i> Export CSV</button>
                    <button class="cu-btn-log-new" id="cu-log-new-btn"><i class="fa-solid fa-plus"></i> Log Interaction</button>
                </div>
            </div>
            <div id="cu-int-loading" class="cu-no-int" style="display:none;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>
            <div id="cu-int-list"></div>
            <div id="cu-no-int" class="cu-no-int" style="display:none;">No interactions recorded yet.</div>
        </div>

        <!-- Inline Confirm Section (shown for pending/contacted) -->
        <div class="cu-confirm-section" id="cu-confirm-section" style="display:none;">
            <div class="cu-confirm-title"><i class="fa-solid fa-check-circle"></i> Confirm Booking</div>
            <div class="cu-confirm-checks">
                <div class="cu-confirm-checks-label">Services</div>
                <div class="cu-check-grid" id="cu-services-checks"></div>
            </div>
            <div class="cu-confirm-checks">
                <div class="cu-confirm-checks-label">Room</div>
                <div class="cu-check-grid" id="cu-rooms-checks"></div>
            </div>
            <div class="cu-confirm-grid">
                <div class="cu-confirm-group">
                    <label>Total Price (£)</label>
                    <input type="number" id="cu-total-price" placeholder="0.00" min="0" step="0.01">
                </div>
                <div class="cu-confirm-group">
                    <label>Deposit (£)</label>
                    <input type="number" id="cu-deposit" placeholder="0.00" min="0" step="0.01">
                </div>
                <div class="cu-confirm-group">
                    <label>Payment Method</label>
                    <select id="cu-payment-method">
                        <option value="">Select method...</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="cheque">Cheque</option>
                        <option value="other">Other</option>
                    </select>
                </div>
            </div>
            <div class="cu-confirm-actions">
                <button class="cu-btn cu-btn-confirm-nodep" id="cu-confirm-nodep-btn"><i class="fa-solid fa-calendar-check"></i> Confirm Without Deposit</button>
                <button class="cu-btn cu-btn-confirm-dep" id="cu-confirm-dep-btn"><i class="fa-solid fa-credit-card"></i> Confirm &amp; Record Deposit</button>
            </div>
        </div>

        <!-- Modal Actions -->
        <div class="cu-modal-actions" id="cu-modal-actions">
            <button class="cu-btn cu-btn-close" id="cu-close-btn">Close</button>
        </div>
    </div>
</div>

<!-- Log Interaction Modal -->
<div class="cu-log-overlay" id="logIntModal">
    <div class="cu-log-card">
        <div class="cu-log-header">
            <div class="cu-log-title"><i class="fa-solid fa-message" style="color:var(--primary)"></i> Log Interaction</div>
            <button class="cu-modal-close" id="cu-log-close-btn" aria-label="Close">&times;</button>
        </div>
        <div class="cu-log-ctx" id="cu-log-ctx"></div>
        <form class="cu-log-form" id="cu-log-form" novalidate>
            <div class="cu-log-group">
                <label for="cu-log-subject">Subject *</label>
                <input class="cu-log-input" type="text" id="cu-log-subject" placeholder="e.g. Payment follow-up, Menu selection..." required>
            </div>
            <div class="cu-log-group">
                <label for="cu-log-type">Interaction Type *</label>
                <select class="cu-log-select" id="cu-log-type" required>
                    <option value="">Select type...</option>
                    <option value="Phone Call">Phone Call</option>
                    <option value="Email">Email</option>
                    <option value="In Person">In Person</option>
                    <option value="SMS">SMS</option>
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Other">Other</option>
                </select>
            </div>
            <div class="cu-log-group">
                <label for="cu-log-notes">Notes *</label>
                <textarea class="cu-log-textarea" id="cu-log-notes" placeholder="Enter detailed notes about this interaction..." required></textarea>
            </div>
            <div class="cu-log-actions">
                <button type="button" class="cu-btn cu-btn-cancel-log" id="cu-log-cancel-btn">Cancel</button>
                <button type="submit" class="cu-btn cu-btn-save" id="cu-log-save-btn"><i class="fa-solid fa-save"></i> Save Interaction</button>
            </div>
        </form>
    </div>
</div>
`;
    },

    init() {
        _allCustomers = [];
        _filtered = [];
        _currentPage = 1;
        _searchQ = '';
        _statusFilter = 'all';
        _currentCustomer = null;
        _currentBookingCtx = null;
        _listeners = [];

        this._loadCustomers();
        this._bindEvents();
    },

    destroy() {
        removeAllListeners();
        _allCustomers = [];
        _filtered = [];
        _currentCustomer = null;
        _currentBookingCtx = null;
    },

    // ── Data loading ──────────────────────────────────────────────────────────

    async _loadCustomers() {
        const tbody = document.getElementById('cu-tbody');
        if (!tbody) return;
        try {
            const res = await fetch(`${API_BASE}/all-customers${tidParam()}`, { headers: Auth.headers() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            _allCustomers = json.data || (Array.isArray(json) ? json : []);
            this._applyFilter();
        } catch (err) {
            console.error('[Customers] load error', err);
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="cu-empty" style="color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Failed to load customers</td></tr>`;
            UI.toast('Failed to load customers', 'error');
        }
    },

    async _loadBookingHistory(customer) {
        const loading = document.getElementById('cu-bh-loading');
        const statsEl = document.getElementById('cu-bh-stats');
        const tableWrap = document.getElementById('cu-bh-table-wrap');
        const empty = document.getElementById('cu-bh-empty');
        const tbody = document.getElementById('cu-bh-tbody');
        if (!loading) return;

        loading.style.display = 'block';
        statsEl.style.display = 'none';
        tableWrap.style.display = 'none';
        empty.style.display = 'none';

        try {
            const res = await fetch(`${API_BASE}/all-bookings`, { headers: Auth.headers() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const all = json.data || (Array.isArray(json) ? json : []);

            const email = (customer.email || '').toLowerCase();
            const cid = String(customer.id || '');
            const mine = all.filter(b => {
                const bEmail = (b.customer_email || b.email || '').toLowerCase();
                const bCid = String(b.customer_id || '');
                return bEmail === email || (cid && bCid === cid);
            });

            loading.style.display = 'none';

            if (mine.length === 0) {
                empty.style.display = 'block';
                return;
            }

            const totalSpend = mine.reduce((s, b) => s + (parseFloat(b.total_amount) || 0), 0);
            const outstanding = mine.reduce((s, b) => s + (parseFloat(b.balance_due) || 0), 0);

            document.getElementById('cu-bh-count').textContent = mine.length;
            document.getElementById('cu-bh-spend').textContent = fmt(totalSpend);
            const outEl = document.getElementById('cu-bh-outstanding');
            outEl.textContent = fmt(outstanding);
            outEl.style.color = outstanding > 0 ? 'var(--warning)' : 'var(--success)';
            statsEl.style.display = 'flex';

            mine.sort((a, b) => new Date(b.booking_date || b.date_from || 0) - new Date(a.booking_date || a.date_from || 0));

            tbody.innerHTML = mine.map((b, idx) => {
                const bal = parseFloat(b.balance_due) || 0;
                const st = b.status || 'unknown';
                let pill;
                if (st === 'cancelled') {
                    pill = `<span style="padding:3px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;text-transform:uppercase;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);">Cancelled</span>`;
                } else if (bal <= 0) {
                    pill = `<span style="padding:3px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;text-transform:uppercase;background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);">Paid</span>`;
                } else {
                    pill = `<span style="padding:3px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;text-transform:uppercase;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);">Balance Due</span>`;
                }
                return `<tr data-bh-idx="${idx}">
                    <td>${esc(dateRange(b, true))}</td>
                    <td>${esc(b.room_name || '—')}</td>
                    <td>${fmt(b.total_amount)}</td>
                    <td style="color:${bal > 0 ? '#f59e0b' : '#10b981'}">${fmt(bal)}</td>
                    <td>${pill}</td>
                    <td><button class="cu-btn-log" data-bh-idx="${idx}"><i class="fa-solid fa-pen"></i> Log</button></td>
                </tr>`;
            }).join('');

            // Store mine on module scope for event delegation
            this._bhBookings = mine;

            tableWrap.style.display = 'block';

            // Bind booking row / log button clicks via delegation
            const self = this;
            const bhTbody = document.getElementById('cu-bh-tbody');
            if (bhTbody) {
                const bhHandler = e => {
                    const logBtn = e.target.closest('[data-bh-idx]');
                    if (logBtn) {
                        e.stopPropagation();
                        const i = parseInt(logBtn.dataset.bhIdx, 10);
                        if (!isNaN(i) && self._bhBookings[i]) self._openLogModal(self._bhBookings[i]);
                    }
                };
                addListener(bhTbody, 'click', bhHandler);
            }

        } catch (err) {
            console.error('[Customers] booking history error', err);
            if (loading) loading.style.display = 'none';
            if (empty) { empty.textContent = 'Failed to load booking history'; empty.style.display = 'block'; }
        }
    },

    async _loadInteractions(customer) {
        const loading = document.getElementById('cu-int-loading');
        const list = document.getElementById('cu-int-list');
        const noInt = document.getElementById('cu-no-int');
        if (!loading) return;

        loading.style.display = 'block';
        list.innerHTML = '';
        noInt.style.display = 'none';

        try {
            const tid = Auth.getTenantId();
            const cid = customer.id;
            const email = customer.email;

            let url = `${API_BASE}/customer-interactions?`;
            if (cid) url += `customer_id=${encodeURIComponent(cid)}&`;
            else if (email) url += `email=${encodeURIComponent(email)}&`;
            if (tid) url += `tenant_id=${encodeURIComponent(tid)}`;

            const res = await fetch(url, { headers: Auth.headers() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const interactions = json.data || (Array.isArray(json) ? json : []);

            loading.style.display = 'none';

            if (interactions.length === 0) {
                noInt.style.display = 'block';
                return;
            }

            interactions.sort((a, b) => new Date(b.timestamp || b.created_at || 0) - new Date(a.timestamp || a.created_at || 0));
            this._interactions = interactions;

            list.innerHTML = interactions.map(it => {
                const ts = new Date(it.timestamp || it.created_at);
                const dateStr = ts.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                const timeStr = ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const bookingDateStr = it.booking_date ? new Date(it.booking_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
                return `<div class="cu-int-item">
                    <div class="cu-int-item-header">
                        <div class="cu-int-subject">${esc(it.subject)}</div>
                        <div class="cu-int-date">${dateStr} ${timeStr}</div>
                    </div>
                    <div class="cu-int-meta">
                        <span>${interactionTypeBadge(it.interaction_type || 'Other')}</span>
                        ${it.staff_member ? `<span><i class="fa-solid fa-user" style="margin-right:3px;"></i>${esc(it.staff_member)}</span>` : ''}
                        ${bookingDateStr ? `<span><i class="fa-solid fa-calendar" style="margin-right:3px;"></i>${bookingDateStr}</span>` : ''}
                    </div>
                    <div class="cu-int-notes">${esc(it.notes)}</div>
                </div>`;
            }).join('');

        } catch (err) {
            console.error('[Customers] interactions error', err);
            if (loading) loading.style.display = 'none';
            if (list) list.innerHTML = `<div class="cu-no-int" style="color:var(--danger);">Failed to load interactions</div>`;
        }
    },

    // ── Filtering & rendering ─────────────────────────────────────────────────

    _applyFilter() {
        const q = _searchQ.toLowerCase();
        _filtered = _allCustomers.filter(c => {
            if (_statusFilter !== 'all' && c.status !== _statusFilter) return false;
            if (!q) return true;
            return (
                (c.full_name || '').toLowerCase().includes(q) ||
                (c.email || '').toLowerCase().includes(q) ||
                (c.phone || '').toLowerCase().includes(q) ||
                (c.event_type || '').toLowerCase().includes(q)
            );
        });
        _currentPage = 1;
        this._renderTable();
        this._renderPagination();
        this._updateBadge();
    },

    _updateBadge() {
        const el = document.getElementById('cu-count-badge');
        if (el) el.textContent = _filtered.length;
    },

    _renderTable() {
        const tbody = document.getElementById('cu-tbody');
        if (!tbody) return;

        const start = (_currentPage - 1) * PAGE_SIZE;
        const page = _filtered.slice(start, start + PAGE_SIZE);

        if (_filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="cu-empty"><i class="fa-solid fa-users-slash"></i> No customers match your filter</td></tr>`;
            return;
        }

        tbody.innerHTML = page.map((c, pageIdx) => {
            const globalIdx = start + pageIdx;
            const hasBooking = c.has_booking || ['booked', 'deposit_paid', 'fully_paid'].includes(c.status);
            return `<tr data-cu-idx="${globalIdx}">
                <td><div class="cu-name">${esc(c.full_name || '—')}</div></td>
                <td>
                    <div>${esc(c.email || '—')}</div>
                    ${c.phone ? `<div class="cu-sub">${esc(c.phone)}</div>` : ''}
                </td>
                <td>${esc(c.event_type || 'General')}</td>
                <td>${esc(dateRange(c, true))}</td>
                <td>${statusBadge(c.status)}</td>
                <td>
                    <button class="cu-btn-log" data-cu-idx="${globalIdx}" style="pointer-events:auto;">
                        <i class="fa-solid fa-eye"></i> View
                    </button>
                </td>
            </tr>`;
        }).join('');
    },

    _renderPagination() {
        const pag = document.getElementById('cu-pagination');
        if (!pag) return;
        const totalPages = Math.ceil(_filtered.length / PAGE_SIZE);
        if (totalPages <= 1) { pag.style.display = 'none'; return; }

        pag.style.display = 'flex';
        const start = (_currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(_currentPage * PAGE_SIZE, _filtered.length);

        let pageButtons = '';
        const maxVisible = 5;
        let pStart = Math.max(1, _currentPage - Math.floor(maxVisible / 2));
        let pEnd = Math.min(totalPages, pStart + maxVisible - 1);
        if (pEnd - pStart < maxVisible - 1) pStart = Math.max(1, pEnd - maxVisible + 1);

        for (let p = pStart; p <= pEnd; p++) {
            pageButtons += `<button class="cu-page-btn${p === _currentPage ? ' cu-page-active' : ''}" data-page="${p}">${p}</button>`;
        }

        pag.innerHTML = `
            <span class="cu-page-info">Showing ${start}–${end} of ${_filtered.length}</span>
            <div class="cu-page-btns">
                <button class="cu-page-btn" data-page="${_currentPage - 1}" ${_currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
                ${pageButtons}
                <button class="cu-page-btn" data-page="${_currentPage + 1}" ${_currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
            </div>`;
    },

    // ── Modal ─────────────────────────────────────────────────────────────────

    _openModal(customer) {
        _currentCustomer = customer;
        this._bhBookings = [];
        this._interactions = [];

        document.getElementById('m-id').textContent = customer.id || 'N/A';
        document.getElementById('m-name').textContent = customer.full_name || 'N/A';
        document.getElementById('m-email').textContent = customer.email || 'N/A';
        document.getElementById('m-phone').textContent = customer.phone || 'N/A';
        document.getElementById('m-event').textContent = customer.event_type || 'N/A';
        document.getElementById('m-room').textContent = customer.room_name || 'N/A';
        document.getElementById('m-date').textContent = dateRange(customer);
        document.getElementById('m-guests').textContent = customer.guest_count || customer.guests_count || customer.num_people || '0';
        document.getElementById('m-notes').textContent = customer.notes || '—';
        document.getElementById('m-status').innerHTML = statusBadge(customer.status);

        // Action buttons
        const actionsEl = document.getElementById('cu-modal-actions');
        const confirmSection = document.getElementById('cu-confirm-section');
        const status = customer.status;

        let actionsHTML = '';
        if (status === 'deposit_paid') {
            actionsHTML += `<a href="#/final-payment" class="cu-btn cu-btn-pay"><i class="fa-solid fa-credit-card"></i> Pay Balance</a>`;
        } else if (!customer.has_booking && (status === 'pending' || status === 'contacted')) {
            actionsHTML += `<a href="#/venuepro-booking?cid=${encodeURIComponent(customer.id || '')}" class="cu-btn cu-btn-book"><i class="fa-solid fa-calendar-plus"></i> Book Now</a>`;
            actionsHTML += `<button class="cu-btn cu-btn-confirm" id="cu-toggle-confirm-btn"><i class="fa-solid fa-check"></i> Confirm</button>`;
            actionsHTML += `<button class="cu-btn cu-btn-cancel-booking"><i class="fa-solid fa-ban"></i> Cancel</button>`;
        }
        actionsHTML += `<button class="cu-btn cu-btn-close" id="cu-close-btn"><i class="fa-solid fa-xmark"></i> Close</button>`;
        actionsEl.innerHTML = actionsHTML;

        // Show/hide confirm section
        confirmSection.style.display = 'none';
        if (!customer.has_booking && (status === 'pending' || status === 'contacted')) {
            this._loadConfirmSection(customer);
            const toggleBtn = document.getElementById('cu-toggle-confirm-btn');
            if (toggleBtn) {
                addListener(toggleBtn, 'click', () => {
                    const visible = confirmSection.style.display !== 'none';
                    confirmSection.style.display = visible ? 'none' : 'block';
                });
            }
        }

        // Re-bind close button (HTML replaced)
        const closeBtn = document.getElementById('cu-close-btn');
        if (closeBtn) addListener(closeBtn, 'click', () => this._closeModal());

        // Confirm actions
        const depBtn = document.getElementById('cu-confirm-dep-btn');
        const nodepBtn = document.getElementById('cu-confirm-nodep-btn');
        if (depBtn) addListener(depBtn, 'click', () => this._confirmBooking(true));
        if (nodepBtn) addListener(nodepBtn, 'click', () => this._confirmBooking(false));

        // Total price → auto-calc deposit
        const totalInput = document.getElementById('cu-total-price');
        const depositInput = document.getElementById('cu-deposit');
        if (totalInput && depositInput) {
            addListener(totalInput, 'input', () => {
                const total = parseFloat(totalInput.value) || 0;
                if (total > 0) depositInput.value = (total * 0.3).toFixed(2);
            });
        }

        // Open modal
        const overlay = document.getElementById('custModal');
        overlay.classList.add('cu-open');
        overlay.scrollTop = 0;

        // Load async sections
        this._loadBookingHistory(customer);
        this._loadInteractions(customer);
    },

    _closeModal() {
        const overlay = document.getElementById('custModal');
        if (overlay) overlay.classList.remove('cu-open');
        _currentCustomer = null;
        _currentBookingCtx = null;
    },

    // ── Confirm booking ───────────────────────────────────────────────────────

    async _loadConfirmSection(customer) {
        const tid = Auth.getTenantId();

        // Services from localStorage
        const servicesRaw = localStorage.getItem(`vp_services_${tid}`);
        let services = [];
        try { services = JSON.parse(servicesRaw) || []; } catch { services = []; }
        const servicesEl = document.getElementById('cu-services-checks');
        if (servicesEl) {
            servicesEl.innerHTML = services.length
                ? services.map((s, i) => `<label class="cu-check-item"><input type="checkbox" name="service" value="${esc(s.name || s)}"> ${esc(s.name || s)}</label>`).join('')
                : '<span style="color:var(--text-muted);font-size:0.82rem;">No services configured</span>';
        }

        // Rooms from API
        const roomsEl = document.getElementById('cu-rooms-checks');
        try {
            const res = await fetch(`${API_BASE}/get-rooms${tidParam()}`, { headers: Auth.headers() });
            if (res.ok) {
                const json = await res.json();
                const rooms = json.data || (Array.isArray(json) ? json : []);
                if (roomsEl) {
                    roomsEl.innerHTML = rooms.length
                        ? rooms.map(r => `<label class="cu-check-item"><input type="checkbox" name="room" value="${esc(r.id || r.name)}"> ${esc(r.name || r)}</label>`).join('')
                        : '<span style="color:var(--text-muted);font-size:0.82rem;">No rooms configured</span>';
                }
            }
        } catch {
            if (roomsEl) roomsEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem;">Could not load rooms</span>';
        }
    },

    async _confirmBooking(withDeposit) {
        if (!_currentCustomer) return;
        const totalInput = document.getElementById('cu-total-price');
        const depositInput = document.getElementById('cu-deposit');
        const paymentMethod = document.getElementById('cu-payment-method');

        const total = parseFloat(totalInput?.value) || 0;
        const deposit = parseFloat(depositInput?.value) || 0;
        const method = paymentMethod?.value || '';

        const selectedServices = [...document.querySelectorAll('input[name="service"]:checked')].map(el => el.value);
        const selectedRooms = [...document.querySelectorAll('input[name="room"]:checked')].map(el => el.value);

        const payload = {
            customer_id: _currentCustomer.id,
            customer_email: _currentCustomer.email,
            customer_name: _currentCustomer.full_name,
            total_amount: total,
            deposit_amount: withDeposit ? deposit : 0,
            payment_method: method,
            services: selectedServices,
            rooms: selectedRooms,
            with_deposit: withDeposit,
            tenant_id: Auth.getTenantId(),
        };

        const btn = withDeposit
            ? document.getElementById('cu-confirm-dep-btn')
            : document.getElementById('cu-confirm-nodep-btn');
        const origHTML = btn?.innerHTML;
        if (btn) { btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...'; btn.disabled = true; }

        try {
            const res = await fetch(`${API_BASE}/confirm-booking`, {
                method: 'POST',
                headers: Auth.headers(),
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            UI.toast('Booking confirmed successfully!', 'success');
            this._closeModal();
            this._loadCustomers();
        } catch (err) {
            console.error('[Customers] confirm booking error', err);
            UI.toast('Failed to confirm booking. Please try again.', 'error');
            if (btn) { btn.innerHTML = origHTML; btn.disabled = false; }
        }
    },

    // ── Log Interaction modal ─────────────────────────────────────────────────

    _openLogModal(booking) {
        _currentBookingCtx = booking;
        const customer = _currentCustomer || {};

        const dateStr = dateRange(booking);
        const isRange = booking.date_from && booking.date_to && booking.date_to.slice(0, 10) !== booking.date_from.slice(0, 10);

        const ctxEl = document.getElementById('cu-log-ctx');
        if (ctxEl) {
            ctxEl.innerHTML = `
                <div class="cu-log-ctx-item"><div class="cu-log-ctx-label">Customer</div><div class="cu-log-ctx-value">${esc(customer.full_name || '—')}</div></div>
                <div class="cu-log-ctx-item"><div class="cu-log-ctx-label">Email</div><div class="cu-log-ctx-value">${esc(customer.email || '—')}</div></div>
                <div class="cu-log-ctx-item"><div class="cu-log-ctx-label">${isRange ? 'Booking Dates' : 'Booking Date'}</div><div class="cu-log-ctx-value">${esc(dateStr)}</div></div>
                <div class="cu-log-ctx-item"><div class="cu-log-ctx-label">Room / Venue</div><div class="cu-log-ctx-value">${esc(booking.room_name || '—')}</div></div>
                <div class="cu-log-ctx-item"><div class="cu-log-ctx-label">Booking ID</div><div class="cu-log-ctx-value" style="font-family:monospace;">${esc(String(booking.id || '—'))}</div></div>
                <div class="cu-log-ctx-item"><div class="cu-log-ctx-label">Status</div><div class="cu-log-ctx-value" style="text-transform:capitalize;">${esc(booking.status || '—')}</div></div>
            `;
        }

        const form = document.getElementById('cu-log-form');
        if (form) form.reset();

        const overlay = document.getElementById('logIntModal');
        if (overlay) overlay.classList.add('cu-open');
    },

    _closeLogModal() {
        const overlay = document.getElementById('logIntModal');
        if (overlay) overlay.classList.remove('cu-open');
        _currentBookingCtx = null;
    },

    async _saveInteraction(e) {
        e.preventDefault();
        if (!_currentCustomer) return;

        const subject = document.getElementById('cu-log-subject')?.value?.trim();
        const type = document.getElementById('cu-log-type')?.value;
        const notes = document.getElementById('cu-log-notes')?.value?.trim();

        if (!subject || !type || !notes) {
            UI.toast('Please fill in all required fields', 'warning');
            return;
        }

        const booking = _currentBookingCtx || {};
        const userStr = localStorage.getItem('vp_user');
        let staffName = 'Staff Member';
        try { staffName = JSON.parse(userStr)?.name || JSON.parse(userStr)?.full_name || staffName; } catch {}

        const payload = {
            customer_id: _currentCustomer.id,
            customer_name: _currentCustomer.full_name,
            customer_email: _currentCustomer.email,
            customer_phone: _currentCustomer.phone,
            booking_id: booking.id,
            booking_date: booking.booking_date || booking.date_from,
            room_name: booking.room_name,
            subject,
            interaction_type: type,
            notes,
            timestamp: new Date().toISOString(),
            staff_member: staffName,
            tenant_id: Auth.getTenantId(),
        };

        const saveBtn = document.getElementById('cu-log-save-btn');
        const origHTML = saveBtn?.innerHTML;
        if (saveBtn) { saveBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...'; saveBtn.disabled = true; }

        try {
            const res = await fetch(`${API_BASE}/customer-interactions`, {
                method: 'POST',
                headers: Auth.headers(),
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (saveBtn) { saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!'; }
            UI.toast('Interaction saved', 'success');
            setTimeout(() => {
                this._closeLogModal();
                if (_currentCustomer) this._loadInteractions(_currentCustomer);
                if (saveBtn) { saveBtn.innerHTML = origHTML; saveBtn.disabled = false; }
            }, 800);
        } catch (err) {
            console.error('[Customers] save interaction error', err);
            UI.toast('Failed to save interaction', 'error');
            if (saveBtn) { saveBtn.innerHTML = origHTML; saveBtn.disabled = false; }
        }
    },

    // ── Export interactions as CSV ────────────────────────────────────────────

    async _exportInteractions() {
        if (!_currentCustomer) return;
        const customer = _currentCustomer;

        try {
            const tid = Auth.getTenantId();
            const cid = customer.id;
            const email = customer.email;
            let url = `${API_BASE}/customer-interactions?`;
            if (cid) url += `customer_id=${encodeURIComponent(cid)}&`;
            else if (email) url += `email=${encodeURIComponent(email)}&`;
            if (tid) url += `tenant_id=${encodeURIComponent(tid)}`;

            const res = await fetch(url, { headers: Auth.headers() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const interactions = json.data || (Array.isArray(json) ? json : []);

            if (interactions.length === 0) {
                UI.toast('No interactions to export', 'warning');
                return;
            }

            const headers = ['Timestamp', 'Customer Name', 'Customer Email', 'Booking Date', 'Room/Venue', 'Subject', 'Type', 'Notes', 'Staff Member'];
            const rows = interactions.map(i => [
                new Date(i.timestamp || i.created_at).toLocaleString('en-GB'),
                i.customer_name || customer.full_name || '',
                i.customer_email || customer.email || '',
                i.booking_date ? new Date(i.booking_date).toLocaleDateString('en-GB') : '',
                i.room_name || '',
                i.subject || '',
                i.interaction_type || '',
                (i.notes || '').replace(/"/g, '""'),
                i.staff_member || '',
            ]);

            const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url2 = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url2;
            a.download = `interactions_${(customer.full_name || 'customer').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url2);
            UI.toast('Interactions exported', 'success');
        } catch (err) {
            console.error('[Customers] export error', err);
            UI.toast('Failed to export interactions', 'error');
        }
    },

    // ── Event binding ─────────────────────────────────────────────────────────

    _bindEvents() {
        const self = this;

        // Search input
        const searchEl = document.getElementById('cu-search');
        if (searchEl) {
            addListener(searchEl, 'input', e => {
                _searchQ = e.target.value;
                self._applyFilter();
            });
        }

        // Status filter
        const filterEl = document.getElementById('cu-status-filter');
        if (filterEl) {
            addListener(filterEl, 'change', e => {
                _statusFilter = e.target.value;
                self._applyFilter();
            });
        }

        // Table body — click delegation
        const tbody = document.getElementById('cu-tbody');
        if (tbody) {
            addListener(tbody, 'click', e => {
                const row = e.target.closest('tr[data-cu-idx]');
                if (!row) return;
                const idx = parseInt(row.dataset.cuIdx, 10);
                if (!isNaN(idx) && _filtered[idx]) self._openModal(_filtered[idx]);
            });
        }

        // Pagination
        const pag = document.getElementById('cu-pagination');
        if (pag) {
            addListener(pag, 'click', e => {
                const btn = e.target.closest('[data-page]');
                if (!btn || btn.disabled) return;
                const p = parseInt(btn.dataset.page, 10);
                const totalPages = Math.ceil(_filtered.length / PAGE_SIZE);
                if (p >= 1 && p <= totalPages) {
                    _currentPage = p;
                    self._renderTable();
                    self._renderPagination();
                    document.getElementById('customers-page')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        }

        // Customer modal — close on overlay click
        const custModalOverlay = document.getElementById('custModal');
        if (custModalOverlay) {
            addListener(custModalOverlay, 'click', e => {
                if (e.target === custModalOverlay) self._closeModal();
            });
        }

        // Customer modal — close button (X)
        const custCloseX = document.getElementById('cu-modal-close-btn');
        if (custCloseX) addListener(custCloseX, 'click', () => self._closeModal());

        // Export button
        const exportBtn = document.getElementById('cu-export-btn');
        if (exportBtn) addListener(exportBtn, 'click', () => self._exportInteractions());

        // Log new interaction button (no booking context)
        const logNewBtn = document.getElementById('cu-log-new-btn');
        if (logNewBtn) {
            addListener(logNewBtn, 'click', () => {
                if (_currentCustomer) self._openLogModal({});
            });
        }

        // Log Interaction modal — close on overlay click
        const logOverlay = document.getElementById('logIntModal');
        if (logOverlay) {
            addListener(logOverlay, 'click', e => {
                if (e.target === logOverlay) self._closeLogModal();
            });
        }

        // Log modal — close X
        const logCloseX = document.getElementById('cu-log-close-btn');
        if (logCloseX) addListener(logCloseX, 'click', () => self._closeLogModal());

        // Log modal — cancel button
        const logCancelBtn = document.getElementById('cu-log-cancel-btn');
        if (logCancelBtn) addListener(logCancelBtn, 'click', () => self._closeLogModal());

        // Log modal — form submit
        const logForm = document.getElementById('cu-log-form');
        if (logForm) addListener(logForm, 'submit', e => self._saveInteraction(e));

        // Keyboard: Escape closes modals
        const escHandler = e => {
            if (e.key === 'Escape') {
                const logOpen = document.getElementById('logIntModal')?.classList.contains('cu-open');
                if (logOpen) { self._closeLogModal(); return; }
                const custOpen = document.getElementById('custModal')?.classList.contains('cu-open');
                if (custOpen) { self._closeModal(); }
            }
        };
        document.addEventListener('keydown', escHandler);
        _listeners.push({ el: document, evt: 'keydown', fn: escHandler });
    },
};

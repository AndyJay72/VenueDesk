import { Auth, API_BASE } from '../auth.js';
import { UI } from '../ui.js';

// ── helpers ────────────────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n) || 0);

// ── module state ───────────────────────────────────────────────────────────
let allBookings     = [];
let _currentFilter  = 'all';
let _payBooking     = null;
let _clockInterval  = null;

// pagination
const PAGE_SIZE = 20;
let _currentPage = 1;

// ── page module ────────────────────────────────────────────────────────────
export default {
    title: 'Booking Stats',

    css: `
/* ── Booking Stats page styles ───────────────────────────────────────── */
#bookings-page { animation: bk-fadeUp 0.35s ease both; }
@keyframes bk-fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }

/* Page header */
.bk-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:2rem; flex-wrap:wrap; gap:1rem; }
.bk-header-left { display:flex; align-items:center; gap:1rem; }
.bk-header-title { font-size:1.75rem; font-weight:800; letter-spacing:-0.03em; background:linear-gradient(135deg,#eef2ff 0%,#a5b4fc 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
body.light-mode .bk-header-title { background:linear-gradient(135deg,#0f172a 0%,#4338ca 100%); -webkit-background-clip:text; background-clip:text; }
.bk-header-actions { display:flex; align-items:center; gap:0.6rem; }
.bk-btn-refresh { background:var(--bg-card); border:1px solid var(--border); color:var(--text-muted); height:38px; padding:0 14px; border-radius:9px; font-size:0.85rem; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; transition:0.2s; font-family:inherit; }
.bk-btn-refresh:hover { color:white; border-color:rgba(148,163,184,0.4); }
.bk-btn-new { background:var(--primary); color:white; border:none; height:38px; padding:0 16px; border-radius:9px; font-size:0.85rem; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; text-decoration:none; transition:opacity 0.2s; font-family:inherit; }
.bk-btn-new:hover { opacity:0.88; }
body.light-mode .bk-btn-refresh { background:rgba(255,255,255,0.8); border-color:rgba(0,0,0,0.12); color:#475569; }
body.light-mode .bk-btn-refresh:hover { color:#0f172a; }

/* Metrics strip */
.bk-metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:1.25rem; margin-bottom:2rem; }
.bk-metric-card { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:1.25rem 1.5rem; display:flex; align-items:center; gap:1.25rem; position:relative; overflow:hidden; transition:transform 0.2s, border-color 0.2s; }
.bk-metric-card:hover { transform:translateY(-2px); }
.bk-dial { width:64px; height:64px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.4rem; font-weight:800; position:relative; background:rgba(15,23,42,0.5); flex-shrink:0; }
.bk-dial::before { content:''; position:absolute; inset:-3px; border-radius:50%; z-index:-1; background:conic-gradient(var(--dial-color) var(--dial-pct, 0%), rgba(255,255,255,0.08) 0); }
.bk-metric-pre  { --dial-color: var(--warning); border-left:3px solid var(--warning); }
.bk-metric-booked { --dial-color: var(--primary); border-left:3px solid var(--primary); }
.bk-metric-post { --dial-color: var(--success); border-left:3px solid var(--success); }
.bk-metric-info h4 { font-size:0.78rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px; }
.bk-metric-info p { font-size:0.82rem; color:var(--text-muted); margin:0; }
body.light-mode .bk-metric-card { background:rgba(255,255,255,0.92); border-color:rgba(0,0,0,0.1); }
body.light-mode .bk-dial { background:rgba(0,0,0,0.06); }

/* Filter tabs */
.bk-filter-bar { display:flex; gap:8px; margin-bottom:1.25rem; overflow-x:auto; padding-bottom:4px; flex-wrap:wrap; }
.bk-filter-btn { background:var(--bg-card); border:1px solid var(--border); color:var(--text-muted); padding:7px 16px; border-radius:50px; cursor:pointer; font-size:0.82rem; font-weight:600; white-space:nowrap; transition:all 0.2s; font-family:inherit; }
.bk-filter-btn.fb-all   { color:var(--primary); border-color:rgba(99,102,241,0.35); }
.bk-filter-btn.fb-all.active, .bk-filter-btn.fb-all:hover   { background:rgba(99,102,241,0.15); color:var(--primary); border-color:var(--primary); }
.bk-filter-btn.fb-pre   { color:var(--warning); border-color:rgba(245,158,11,0.35); }
.bk-filter-btn.fb-pre.active, .bk-filter-btn.fb-pre:hover   { background:rgba(245,158,11,0.15); color:var(--warning); border-color:var(--warning); }
.bk-filter-btn.fb-booked { color:var(--success); border-color:rgba(16,185,129,0.35); }
.bk-filter-btn.fb-booked.active, .bk-filter-btn.fb-booked:hover { background:rgba(16,185,129,0.15); color:var(--success); border-color:var(--success); }
.bk-filter-btn.fb-post  { color:#06b6d4; border-color:rgba(6,182,212,0.35); }
.bk-filter-btn.fb-post.active, .bk-filter-btn.fb-post:hover  { background:rgba(6,182,212,0.15); color:#06b6d4; border-color:#06b6d4; }
.bk-filter-btn.fb-cancelled { color:var(--danger); border-color:rgba(239,68,68,0.35); }
.bk-filter-btn.fb-cancelled.active, .bk-filter-btn.fb-cancelled:hover { background:rgba(239,68,68,0.15); color:var(--danger); border-color:var(--danger); }
body.light-mode .bk-filter-btn { background:rgba(255,255,255,0.8); border-color:rgba(0,0,0,0.12); color:#475569; }

/* Search/filter bar */
.bk-search-bar { display:flex; gap:8px; margin-bottom:1.25rem; flex-wrap:wrap; align-items:center; }
.bk-sf-input { background:rgba(0,0,0,0.25); border:1px solid var(--border); border-radius:10px; color:var(--text-main); padding:9px 14px; font-size:0.88rem; outline:none; flex:1; min-width:160px; font-family:inherit; transition:border-color 0.2s; }
.bk-sf-input:focus { border-color:var(--primary); }
.bk-sf-input::placeholder { color:var(--text-muted); }
.bk-sf-select { background:rgba(0,0,0,0.25); border:1px solid var(--border); border-radius:10px; color:var(--text-main); padding:9px 14px; font-size:0.88rem; outline:none; cursor:pointer; min-width:140px; font-family:inherit; }
.bk-sf-select option { background:#1e293b; }
.bk-sf-clear { background:rgba(148,163,184,0.1); border:1px solid var(--border); color:var(--text-muted); padding:9px 14px; border-radius:10px; cursor:pointer; font-size:0.85rem; font-weight:600; font-family:inherit; transition:0.2s; white-space:nowrap; }
.bk-sf-clear:hover { color:white; border-color:rgba(148,163,184,0.4); }
body.light-mode .bk-sf-input,
body.light-mode .bk-sf-select { background:rgba(255,255,255,0.8); border-color:rgba(0,0,0,0.12); color:#0f172a; }
body.light-mode .bk-sf-select option { background:#fff; color:#0f172a; }
body.light-mode .bk-sf-clear { background:rgba(0,0,0,0.04); border-color:rgba(0,0,0,0.12); color:#475569; }
body.light-mode .bk-sf-clear:hover { color:#0f172a; }

/* Booking list */
#bk-list { min-height:120px; }
.bk-card { background:var(--bg-card); border:1px solid var(--border); border-radius:13px; padding:1.1rem 1.25rem; margin-bottom:0.85rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; transition:transform 0.18s, box-shadow 0.18s; cursor:default; }
.bk-card:hover { transform:translateY(-2px); box-shadow:0 8px 28px rgba(0,0,0,0.35); }
.bk-card-left { display:flex; align-items:center; gap:1.25rem; flex:1; min-width:0; }
.bk-date-badge { background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:10px; padding:7px 12px; text-align:center; min-width:58px; flex-shrink:0; }
.bk-db-day { font-size:1.2rem; font-weight:800; color:var(--text-main); line-height:1; }
.bk-db-mon { font-size:0.7rem; text-transform:uppercase; color:var(--text-muted); margin-top:2px; }
.bk-details { flex:1; min-width:0; }
.bk-details h4 { font-size:1rem; font-weight:700; color:var(--text-main); margin:0 0 3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bk-meta { font-size:0.82rem; color:var(--text-muted); display:flex; gap:12px; flex-wrap:wrap; margin-top:4px; }
.bk-meta span { display:inline-flex; align-items:center; gap:4px; }
.bk-timeline { display:flex; align-items:center; gap:3px; margin-top:8px; }
.bk-tl-step { display:flex; flex-direction:column; align-items:center; gap:2px; }
.bk-tl-dot { width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.58rem; font-weight:700; flex-shrink:0; }
.bk-tl-dot.done   { background:var(--success); color:#0f172a; }
.bk-tl-dot.active { background:var(--warning); color:#0f172a; }
.bk-tl-dot.pending { background:rgba(148,163,184,0.12); color:var(--text-muted); border:1.5px solid rgba(148,163,184,0.2); }
.bk-tl-lbl { font-size:0.58rem; color:var(--text-muted); white-space:nowrap; }
.bk-tl-line { flex:1; height:2px; margin-bottom:14px; min-width:20px; }
.bk-tl-line.done    { background:var(--success); }
.bk-tl-line.pending { background:rgba(148,163,184,0.12); }
.bk-card-right { display:flex; align-items:center; gap:8px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end; }
.bk-status-pill { padding:5px 12px; border-radius:20px; font-size:0.73rem; font-weight:700; text-transform:uppercase; white-space:nowrap; }
.bk-pill-pre       { background:rgba(245,158,11,0.12); color:var(--warning); border:1px solid rgba(245,158,11,0.5); }
.bk-pill-booked    { background:rgba(99,102,241,0.12); color:var(--primary); border:1px solid rgba(99,102,241,0.5); }
.bk-pill-completed { background:rgba(16,185,129,0.12); color:var(--success); border:1px solid rgba(16,185,129,0.4); }
.bk-pill-cancelled { background:rgba(239,68,68,0.12); color:var(--danger); border:1px solid rgba(239,68,68,0.4); }
.bk-pay-btn    { background:var(--success); color:#0f172a; border:none; padding:6px 12px; border-radius:7px; font-weight:700; cursor:pointer; font-size:0.78rem; display:inline-flex; align-items:center; gap:5px; font-family:inherit; transition:opacity 0.18s; }
.bk-pay-btn:hover { opacity:0.85; }
.bk-cancel-btn { background:var(--danger); color:white; border:none; padding:6px 12px; border-radius:7px; font-weight:700; cursor:pointer; font-size:0.78rem; display:inline-flex; align-items:center; gap:5px; font-family:inherit; transition:opacity 0.18s; }
.bk-cancel-btn:hover { opacity:0.85; }
body.light-mode .bk-card { background:rgba(255,255,255,0.92); border-color:rgba(0,0,0,0.1); }
body.light-mode .bk-date-badge { background:rgba(0,0,0,0.04); border-color:rgba(0,0,0,0.08); }
body.light-mode .bk-details h4 { color:#0f172a; }

/* Pagination */
.bk-pagination { display:flex; align-items:center; justify-content:space-between; margin-top:1.25rem; gap:1rem; flex-wrap:wrap; }
.bk-page-info { font-size:0.82rem; color:var(--text-muted); }
.bk-page-btns { display:flex; gap:6px; }
.bk-page-btn { background:var(--bg-card); border:1px solid var(--border); color:var(--text-muted); padding:6px 13px; border-radius:8px; font-size:0.82rem; font-weight:600; cursor:pointer; font-family:inherit; transition:0.2s; }
.bk-page-btn:hover:not(:disabled) { color:white; border-color:rgba(148,163,184,0.4); }
.bk-page-btn.active { background:var(--primary); color:white; border-color:var(--primary); }
.bk-page-btn:disabled { opacity:0.35; cursor:not-allowed; }
body.light-mode .bk-page-btn { background:rgba(255,255,255,0.8); border-color:rgba(0,0,0,0.12); color:#475569; }

/* Empty / loading states */
.bk-empty { text-align:center; padding:3.5rem 1rem; color:var(--text-muted); }
.bk-empty i { font-size:2.5rem; opacity:0.35; margin-bottom:0.75rem; }
.bk-empty p { font-size:0.95rem; margin:0; }

/* ── Payment modal ────────────────────────────────────────────────────── */
.bk-pay-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.78); backdrop-filter:blur(6px); z-index:3000; display:flex; align-items:center; justify-content:center; opacity:0; pointer-events:none; transition:opacity 0.25s; }
.bk-pay-overlay.open { opacity:1; pointer-events:all; }
.bk-pay-card { background:#1e293b; border:1px solid rgba(148,163,184,0.15); border-radius:20px; padding:2rem; width:92%; max-width:480px; position:relative; transform:translateY(14px); transition:transform 0.25s; }
.bk-pay-overlay.open .bk-pay-card { transform:translateY(0); }
.bk-pay-mh { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.25rem; }
.bk-pay-mt { font-size:1.2rem; font-weight:700; color:white; display:flex; align-items:center; gap:8px; }
.bk-pay-close { background:none; border:none; color:var(--text-muted); font-size:1.5rem; cursor:pointer; line-height:1; transition:color 0.2s; padding:0; }
.bk-pay-close:hover { color:white; }
.bk-pay-info { background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:10px; padding:0.85rem 1rem; margin-bottom:1.25rem; font-size:0.86rem; }
.bk-pay-info .ir { display:flex; gap:6px; margin-bottom:4px; color:var(--text-muted); }
.bk-pay-info .ir:last-child { margin-bottom:0; }
.bk-pay-info .ir strong { color:var(--text-main); }
.bk-amt-lbl { font-size:0.78rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.5rem; }
.bk-amt-row { display:flex; align-items:center; gap:0.6rem; margin-bottom:0.6rem; }
.bk-amt-sym { font-size:1.4rem; font-weight:700; color:var(--text-muted); }
.bk-amt-input { background:rgba(0,0,0,0.4); border:2px solid var(--border); border-radius:10px; color:white; font-size:1.9rem; font-weight:800; padding:7px 12px; width:100%; outline:none; -moz-appearance:textfield; transition:border-color 0.2s; font-family:inherit; }
.bk-amt-input::-webkit-outer-spin-button,
.bk-amt-input::-webkit-inner-spin-button { -webkit-appearance:none; }
.bk-amt-input:focus { border-color:var(--primary); }
.bk-slider { -webkit-appearance:none; width:100%; height:6px; border-radius:3px; outline:none; cursor:pointer; margin:0.4rem 0 0.3rem; background:rgba(148,163,184,0.2); }
.bk-slider::-webkit-slider-thumb { -webkit-appearance:none; width:20px; height:20px; border-radius:50%; background:var(--primary); cursor:pointer; box-shadow:0 0 0 4px rgba(99,102,241,0.25); transition:box-shadow 0.2s; }
.bk-slider::-webkit-slider-thumb:hover { box-shadow:0 0 0 6px rgba(99,102,241,0.35); }
.bk-slider-lbls { display:flex; justify-content:space-between; font-size:0.72rem; color:var(--text-muted); }
.bk-pay-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border-radius:20px; font-size:0.76rem; font-weight:700; text-transform:uppercase; margin:0.5rem 0 1rem; letter-spacing:0.04em; }
.bk-pay-badge.partial { background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.4); color:var(--warning); }
.bk-pay-badge.full    { background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); color:var(--success); }
.bk-meth-row { display:flex; align-items:center; gap:10px; margin-bottom:1.5rem; }
.bk-meth-lbl { font-size:0.8rem; color:var(--text-muted); white-space:nowrap; }
.bk-meth-sel { background:rgba(0,0,0,0.4); border:1px solid var(--border); border-radius:8px; color:white; padding:8px 12px; font-size:0.86rem; outline:none; cursor:pointer; flex:1; font-family:inherit; }
.bk-meth-sel option { background:#1e293b; }
.bk-pay-actions { display:flex; gap:10px; }
.bk-pay-ok { flex:1; background:var(--success); color:#0f172a; border:none; padding:12px; border-radius:10px; font-size:0.97rem; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; transition:opacity 0.2s, transform 0.2s; font-family:inherit; }
.bk-pay-ok:hover:not(:disabled) { opacity:0.88; transform:translateY(-1px); }
.bk-pay-ok:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
.bk-pay-cancel { background:rgba(30,41,59,0.9); border:1px solid var(--border); color:var(--text-muted); padding:12px 18px; border-radius:10px; font-size:0.9rem; font-weight:600; cursor:pointer; transition:0.2s; font-family:inherit; }
.bk-pay-cancel:hover { color:white; border-color:rgba(148,163,184,0.4); }
body.light-mode .bk-pay-card { background:#ffffff; border-color:rgba(0,0,0,0.12); color:#0f172a; }
body.light-mode .bk-pay-info { background:rgba(0,0,0,0.04); border-color:rgba(0,0,0,0.08); }
body.light-mode .bk-amt-input { background:rgba(0,0,0,0.05); border-color:rgba(0,0,0,0.15); color:#0f172a; }
body.light-mode .bk-meth-sel { background:rgba(255,255,255,0.9); border-color:rgba(0,0,0,0.12); color:#0f172a; }
body.light-mode .bk-pay-cancel { background:rgba(0,0,0,0.04); color:#475569; }

/* ── Receipt modal ────────────────────────────────────────────────────── */
.bk-receipt-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.82); backdrop-filter:blur(8px); z-index:4000; display:flex; align-items:center; justify-content:center; opacity:0; pointer-events:none; transition:opacity 0.25s; }
.bk-receipt-overlay.open { opacity:1; pointer-events:all; }
.bk-receipt-card { background:#1e293b; border:1px solid rgba(148,163,184,0.15); border-radius:20px; padding:2rem; width:92%; max-width:400px; text-align:center; }
.bk-rc-icon { font-size:2.8rem; color:var(--success); margin-bottom:0.6rem; }
.bk-rc-title { font-size:1.05rem; font-weight:700; color:white; margin-bottom:4px; }
.bk-rc-amount { font-size:2.4rem; font-weight:800; color:var(--success); margin:0.4rem 0; }
.bk-rc-sub { color:var(--text-muted); font-size:0.88rem; margin-bottom:1rem; }
.bk-rc-ref { font-family:monospace; background:rgba(0,0,0,0.4); border:1px solid var(--border); border-radius:8px; padding:5px 14px; font-size:0.82rem; color:var(--warning); display:inline-block; margin-bottom:1.5rem; }
.bk-rc-done { background:var(--primary); color:white; border:none; padding:11px 40px; border-radius:10px; font-size:0.97rem; font-weight:700; cursor:pointer; transition:opacity 0.2s; font-family:inherit; }
.bk-rc-done:hover { opacity:0.85; }
body.light-mode .bk-receipt-card { background:#ffffff; border-color:rgba(0,0,0,0.12); }
body.light-mode .bk-rc-title { color:#0f172a; }
body.light-mode .bk-rc-ref { background:rgba(0,0,0,0.05); border-color:rgba(0,0,0,0.1); }

/* ── Detail modal ─────────────────────────────────────────────────────── */
.bk-detail-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.78); backdrop-filter:blur(6px); z-index:3000; display:flex; align-items:center; justify-content:center; opacity:0; pointer-events:none; transition:opacity 0.25s; }
.bk-detail-overlay.open { opacity:1; pointer-events:all; }
.bk-detail-card { background:#1e293b; border:1px solid rgba(148,163,184,0.15); border-radius:20px; padding:2rem; width:92%; max-width:560px; max-height:88vh; overflow-y:auto; position:relative; transform:translateY(14px); transition:transform 0.25s; }
.bk-detail-overlay.open .bk-detail-card { transform:translateY(0); }
.bk-detail-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.5rem; }
.bk-detail-title { font-size:1.15rem; font-weight:700; color:white; }
.bk-detail-close { background:none; border:none; color:var(--text-muted); font-size:1.5rem; cursor:pointer; line-height:1; transition:color 0.2s; padding:0; }
.bk-detail-close:hover { color:white; }
.bk-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; }
.bk-detail-field { display:flex; flex-direction:column; gap:3px; }
.bk-detail-field.full { grid-column:1/-1; }
.bk-detail-lbl { font-size:0.73rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; }
.bk-detail-val { background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:8px; padding:7px 11px; font-size:0.88rem; color:var(--text-main); word-break:break-word; }
.bk-detail-actions { display:flex; gap:8px; margin-top:1.25rem; flex-wrap:wrap; }
body.light-mode .bk-detail-card { background:#ffffff; border-color:rgba(0,0,0,0.12); color:#0f172a; }
body.light-mode .bk-detail-title { color:#0f172a; }
body.light-mode .bk-detail-val { background:rgba(0,0,0,0.04); border-color:rgba(0,0,0,0.1); color:#0f172a; }

/* Responsive */
@media (max-width: 900px) {
    .bk-metrics { grid-template-columns:repeat(2,1fr); }
}
@media (max-width: 600px) {
    .bk-metrics { grid-template-columns:1fr; }
    .bk-card { flex-direction:column; align-items:flex-start; }
    .bk-card-right { width:100%; justify-content:flex-start; }
    .bk-header { flex-direction:column; align-items:flex-start; }
    .bk-detail-grid { grid-template-columns:1fr; }
    .bk-detail-field.full { grid-column:1; }
}
`,

    render() {
        return `
<div id="bookings-page">

    <!-- Page header -->
    <div class="bk-header">
        <div class="bk-header-left">
            <h1 class="bk-header-title">Booking Stats</h1>
        </div>
        <div class="bk-header-actions">
            <button class="bk-btn-refresh" id="bk-refresh-btn">
                <i class="fa-solid fa-rotate-right"></i> Refresh
            </button>
            <a class="bk-btn-new" href="#/manual-booking" onclick="window.navigate && window.navigate('#/manual-booking'); return false;">
                <i class="fa-solid fa-plus"></i> New Booking
            </a>
        </div>
    </div>

    <!-- Metrics strip -->
    <div class="bk-metrics">
        <div class="bk-metric-card bk-metric-pre">
            <div class="bk-dial" id="bk-dial-pre" style="--dial-pct:0%;">0</div>
            <div class="bk-metric-info">
                <h4>Payment Due</h4>
                <p>Deposit paid, balance outstanding</p>
            </div>
        </div>
        <div class="bk-metric-card bk-metric-booked">
            <div class="bk-dial" id="bk-dial-booked" style="--dial-pct:0%;">0</div>
            <div class="bk-metric-info">
                <h4>Paid</h4>
                <p>Fully paid &amp; confirmed</p>
            </div>
        </div>
        <div class="bk-metric-card bk-metric-post">
            <div class="bk-dial" id="bk-dial-post" style="--dial-pct:0%;">0</div>
            <div class="bk-metric-info">
                <h4>Completed</h4>
                <p>Past events</p>
            </div>
        </div>
    </div>

    <!-- Search/filter bar -->
    <div class="bk-search-bar">
        <input type="text"  id="bk-search"   class="bk-sf-input"   placeholder="Search name, email, room…" />
        <select             id="bk-room"      class="bk-sf-select">
            <option value="">All Rooms</option>
        </select>
        <input type="date"  id="bk-from"      class="bk-sf-input"   style="min-width:140px;max-width:160px;" title="Date from" />
        <input type="date"  id="bk-to"        class="bk-sf-input"   style="min-width:140px;max-width:160px;" title="Date to" />
        <button             id="bk-clear-btn" class="bk-sf-clear">
            <i class="fa-solid fa-xmark"></i> Clear
        </button>
    </div>

    <!-- Filter tabs -->
    <div class="bk-filter-bar">
        <button class="bk-filter-btn fb-all active"       data-filter="all">All Bookings</button>
        <button class="bk-filter-btn fb-pre"              data-filter="pre">Payment Due</button>
        <button class="bk-filter-btn fb-booked"           data-filter="booked">Paid</button>
        <button class="bk-filter-btn fb-post"             data-filter="post">Completed</button>
        <button class="bk-filter-btn fb-cancelled"        data-filter="cancelled">Cancelled</button>
    </div>

    <!-- Booking list -->
    <div id="bk-list">${UI.spinner()}</div>

    <!-- Pagination -->
    <div id="bk-pagination" class="bk-pagination" style="display:none;"></div>

</div>

<!-- ── Payment modal ──────────────────────────────────────────────────── -->
<div id="bk-pay-overlay" class="bk-pay-overlay">
    <div class="bk-pay-card" id="bk-pay-card">
        <div class="bk-pay-mh">
            <div class="bk-pay-mt"><i class="fa-solid fa-credit-card" style="color:var(--success)"></i> Take Payment</div>
            <button class="bk-pay-close" id="bk-pay-close-btn">&times;</button>
        </div>
        <div class="bk-pay-info">
            <div class="ir"><span>Customer:</span><strong id="bk-pm-customer">—</strong></div>
            <div class="ir"><span>Room:</span><strong id="bk-pm-room">—</strong></div>
            <div class="ir"><span>Date:</span><strong id="bk-pm-date">—</strong></div>
            <div class="ir"><span>Balance Due:</span><strong id="bk-pm-balance" style="color:var(--warning)">—</strong></div>
            <div class="ir"><span>Recorded Method:</span><strong id="bk-pm-method-rec" style="color:var(--text-muted)">—</strong></div>
        </div>
        <div>
            <div class="bk-amt-lbl">Payment Amount</div>
            <div class="bk-amt-row">
                <span class="bk-amt-sym">£</span>
                <input id="bk-pm-amount" type="number" class="bk-amt-input" min="0.01" step="0.01" />
            </div>
            <input id="bk-pm-slider" type="range" class="bk-slider" min="1" step="1" />
            <div class="bk-slider-lbls"><span>£1</span><span id="bk-pm-slider-max">—</span></div>
            <div id="bk-pm-badge" class="bk-pay-badge partial"><i class="fa-solid fa-coins"></i> Part Payment</div>
        </div>
        <div class="bk-meth-row">
            <span class="bk-meth-lbl">Payment Method:</span>
            <select id="bk-pm-method" class="bk-meth-sel">
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="other">Other</option>
            </select>
        </div>
        <div class="bk-pay-actions">
            <button class="bk-pay-cancel" id="bk-pay-cancel-btn">Cancel</button>
            <button class="bk-pay-ok" id="bk-pay-confirm-btn">
                <i class="fa-solid fa-circle-check"></i> Confirm Payment
            </button>
        </div>
    </div>
</div>

<!-- ── Receipt modal ──────────────────────────────────────────────────── -->
<div id="bk-receipt-overlay" class="bk-receipt-overlay">
    <div class="bk-receipt-card">
        <div class="bk-rc-icon"><i class="fa-solid fa-circle-check"></i></div>
        <div class="bk-rc-title">Payment Recorded</div>
        <div class="bk-rc-amount" id="bk-rc-amount">—</div>
        <div class="bk-rc-sub"   id="bk-rc-sub">—</div>
        <div class="bk-rc-ref"   id="bk-rc-ref">—</div>
        <button class="bk-rc-done" id="bk-rc-done-btn">Done</button>
    </div>
</div>

<!-- ── Booking detail modal ───────────────────────────────────────────── -->
<div id="bk-detail-overlay" class="bk-detail-overlay">
    <div class="bk-detail-card" id="bk-detail-card">
        <div class="bk-detail-header">
            <div class="bk-detail-title">Booking Details</div>
            <button class="bk-detail-close" id="bk-detail-close-btn">&times;</button>
        </div>
        <div id="bk-detail-body"></div>
    </div>
</div>
`;
    },

    // ── init: wire events, load data ───────────────────────────────────────
    async init() {
        // Reset module state for re-entry
        allBookings    = [];
        _currentFilter = 'all';
        _payBooking    = null;
        _currentPage   = 1;

        // Filter tab clicks
        document.querySelectorAll('.bk-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.bk-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _currentFilter = btn.dataset.filter;
                _currentPage   = 1;
                renderList();
            });
        });

        // Search / filter inputs
        const onFilter = () => { _currentPage = 1; renderList(); };
        document.getElementById('bk-search')?.addEventListener('input',  onFilter);
        document.getElementById('bk-room')?.addEventListener('change',   onFilter);
        document.getElementById('bk-from')?.addEventListener('change',   onFilter);
        document.getElementById('bk-to')?.addEventListener('change',     onFilter);

        // Clear button
        document.getElementById('bk-clear-btn')?.addEventListener('click', () => {
            document.getElementById('bk-search').value = '';
            document.getElementById('bk-room').value   = '';
            document.getElementById('bk-from').value   = '';
            document.getElementById('bk-to').value     = '';
            _currentPage = 1;
            renderList();
        });

        // Refresh button
        document.getElementById('bk-refresh-btn')?.addEventListener('click', () => fetchBookings());

        // Payment modal: amount input + slider
        document.getElementById('bk-pm-amount')?.addEventListener('input', onPayAmountInput);
        document.getElementById('bk-pm-slider')?.addEventListener('input', onPaySliderInput);

        // Payment modal: close buttons
        document.getElementById('bk-pay-close-btn')?.addEventListener('click',  closePayModal);
        document.getElementById('bk-pay-cancel-btn')?.addEventListener('click', closePayModal);
        document.getElementById('bk-pay-overlay')?.addEventListener('click', e => {
            if (e.target === document.getElementById('bk-pay-overlay')) closePayModal();
        });

        // Payment confirm
        document.getElementById('bk-pay-confirm-btn')?.addEventListener('click', submitPayment);

        // Receipt done
        document.getElementById('bk-rc-done-btn')?.addEventListener('click', closeReceipt);

        // Detail modal close
        document.getElementById('bk-detail-close-btn')?.addEventListener('click', closeDetailModal);
        document.getElementById('bk-detail-overlay')?.addEventListener('click', e => {
            if (e.target === document.getElementById('bk-detail-overlay')) closeDetailModal();
        });

        // Keyboard: Esc closes any open modal
        this._onKeyDown = e => {
            if (e.key === 'Escape') {
                closePayModal();
                closeReceipt();
                closeDetailModal();
            }
        };
        document.addEventListener('keydown', this._onKeyDown);

        // Initial data fetch
        await fetchBookings();
    },

    destroy() {
        if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown);
        allBookings    = [];
        _payBooking    = null;
        _currentFilter = 'all';
        _currentPage   = 1;
    }
};

// ── Data fetch ────────────────────────────────────────────────────────────
async function fetchBookings() {
    const listEl = document.getElementById('bk-list');
    if (listEl) listEl.innerHTML = UI.spinner();

    try {
        const res  = await fetch(`${API_BASE}/all-bookings`, { headers: Auth.headers() });
        const json = await res.json();
        const raw  = json.data || (Array.isArray(json) ? json : []);

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        allBookings = raw.map(b => {
            // normalise date fields
            const startStr = (b.date_from || b.booking_date || '').split('T')[0];
            const endStr   = (b.date_to   || b.date_from || b.booking_date || '').split('T')[0];
            const dateObj  = startStr ? new Date(startStr + 'T00:00:00') : new Date();
            const dateEnd  = endStr   ? new Date(endStr   + 'T00:00:00') : dateObj;
            const balance  = parseFloat(b.balance_due ?? 0);

            let category;
            if (b.status === 'cancelled') {
                category = 'cancelled';
            } else if (dateEnd < now) {
                category = 'post';
            } else if (balance <= 0) {
                category = 'booked';
            } else {
                category = 'pre';
            }

            // normalise guest count
            const guests = b.guest_count ?? b.guests_count ?? b.num_people ?? null;

            return { ...b, category, dateObj, dateEnd, balanceNum: balance, guests };
        });

        updateMetrics();
        populateRoomFilter();
        renderList();

    } catch (err) {
        console.error('[bookings] fetch error', err);
        const listEl = document.getElementById('bk-list');
        if (listEl) listEl.innerHTML = `<div class="bk-empty"><i class="fa-solid fa-circle-exclamation" style="color:var(--danger)"></i><p>Failed to load bookings. Please try refreshing.</p></div>`;
        UI.toast('Failed to load bookings', 'error');
    }
}

// ── Metrics ────────────────────────────────────────────────────────────────
function updateMetrics() {
    const counts = { pre: 0, booked: 0, post: 0 };
    allBookings.forEach(b => { if (counts[b.category] !== undefined) counts[b.category]++; });
    const total = allBookings.length || 1;

    ['pre', 'booked', 'post'].forEach(k => {
        const el = document.getElementById(`bk-dial-${k}`);
        if (!el) return;
        el.textContent = counts[k];
        el.style.setProperty('--dial-pct', `${Math.round((counts[k] / total) * 100)}%`);
    });
}

// ── Room filter population ─────────────────────────────────────────────────
function populateRoomFilter() {
    const sel = document.getElementById('bk-room');
    if (!sel) return;
    const rooms = [...new Set(allBookings.map(b => b.room_name).filter(Boolean))].sort();
    const current = sel.value;
    sel.innerHTML = '<option value="">All Rooms</option>' +
        rooms.map(r => `<option value="${esc(r)}"${r === current ? ' selected' : ''}>${esc(r)}</option>`).join('');
}

// ── List render (filter + search + paginate) ───────────────────────────────
function renderList() {
    const listEl   = document.getElementById('bk-list');
    const pageEl   = document.getElementById('bk-pagination');
    if (!listEl) return;

    const search   = (document.getElementById('bk-search')?.value || '').toLowerCase().trim();
    const roomVal  = document.getElementById('bk-room')?.value || '';
    const fromDate = document.getElementById('bk-from')?.value || '';
    const toDate   = document.getElementById('bk-to')?.value   || '';

    let filtered = _currentFilter === 'all'
        ? allBookings
        : allBookings.filter(b => b.category === _currentFilter);

    if (search) {
        filtered = filtered.filter(b =>
            (b.customer_name  || '').toLowerCase().includes(search) ||
            (b.customer_email || b.email || '').toLowerCase().includes(search) ||
            (b.room_name      || '').toLowerCase().includes(search) ||
            (b.booking_id     || b.id || '').toString().toLowerCase().includes(search)
        );
    }
    if (roomVal)  filtered = filtered.filter(b => b.room_name === roomVal);
    if (fromDate) filtered = filtered.filter(b => {
        const d = (b.date_from || b.booking_date || '').slice(0, 10);
        return d && d >= fromDate;
    });
    if (toDate)   filtered = filtered.filter(b => {
        const d = (b.date_to || b.date_from || b.booking_date || '').slice(0, 10);
        return d && d <= toDate;
    });

    // Sort: post category shows newest first; others show soonest first
    filtered.sort((a, b_) =>
        _currentFilter === 'post'
            ? b_.dateObj - a.dateObj
            : a.dateObj - b_.dateObj
    );

    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="bk-empty"><i class="fa-solid fa-calendar-xmark"></i><p>No bookings found.</p></div>`;
        if (pageEl) pageEl.style.display = 'none';
        return;
    }

    // Pagination
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    if (_currentPage > totalPages) _currentPage = totalPages;
    const start  = (_currentPage - 1) * PAGE_SIZE;
    const paged  = filtered.slice(start, start + PAGE_SIZE);

    listEl.innerHTML = paged.map(b => renderCard(b)).join('');

    // Render pagination
    if (pageEl) {
        if (totalPages > 1) {
            pageEl.style.display = 'flex';
            pageEl.innerHTML = buildPagination(filtered.length, totalPages);
            pageEl.querySelectorAll('.bk-page-btn[data-page]').forEach(btn => {
                btn.addEventListener('click', () => {
                    _currentPage = parseInt(btn.dataset.page, 10);
                    renderList();
                    document.getElementById('bk-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            });
        } else {
            pageEl.style.display = 'none';
        }
    }
}

// ── Build a single booking card HTML ─────────────────────────────────────
function renderCard(b) {
    const day  = b.dateObj.getDate();
    const mon  = b.dateObj.toLocaleString('en-GB', { month: 'short' });

    // Status pill
    let pillCls, pillText;
    switch (b.category) {
        case 'pre':
            pillCls  = 'bk-pill-pre';
            pillText = `Balance Due: ${fmt(b.balanceNum)}`;
            break;
        case 'booked':
            pillCls  = 'bk-pill-booked';
            pillText = 'Fully Paid';
            break;
        case 'post':
            pillCls  = b.status === 'cancelled' ? 'bk-pill-cancelled' : 'bk-pill-completed';
            pillText = b.status === 'cancelled' ? 'Cancelled' : 'Completed';
            break;
        case 'cancelled':
            pillCls  = 'bk-pill-cancelled';
            pillText = 'Cancelled';
            break;
        default:
            pillCls  = 'bk-pill-completed';
            pillText = esc(b.status || 'Unknown');
    }

    // Border colour
    const borderColor = {
        pre:       'var(--warning)',
        booked:    'var(--primary)',
        post:      'var(--success)',
        cancelled: 'var(--danger)'
    }[b.category] || 'var(--border)';

    // Time string
    const startT = (b.start_time || '').slice(0, 5);
    const endT   = (b.end_time   || '').slice(0, 5);
    const timeStr = startT ? (endT ? `${startT} – ${endT}` : startT) : '';

    // Multi-day indicator
    const multiDay = b.date_from && b.date_to &&
        b.date_from.slice(0, 10) !== b.date_to.slice(0, 10);
    const multiDayStr = multiDay
        ? `<span><i class="fa-solid fa-calendar-days"></i> ${
            new Date(b.date_from.split('T')[0] + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' })
          } – ${
            new Date(b.date_to.split('T')[0]   + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' })
          }</span>`
        : '';

    const guestStr = b.guests != null
        ? `<span><i class="fa-solid fa-users"></i> ${esc(b.guests)}</span>`
        : '';

    // Payment timeline (skip for cancelled)
    let timeline = '';
    if (b.category !== 'cancelled') {
        const allPaid  = b.balanceNum <= 0;
        const d1 = 'done';
        const d2 = allPaid ? 'done'    : (b.category === 'pre' ? 'active' : 'pending');
        const d3 = allPaid ? 'done'    : 'pending';
        const l1 = 'done';
        const l2 = allPaid ? 'done'    : 'pending';
        const i1 = '<i class="fa-solid fa-check"></i>';
        const i2 = allPaid ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-coins"></i>';
        const i3 = allPaid ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-circle"></i>';
        timeline = `
        <div class="bk-timeline">
            <div class="bk-tl-step"><div class="bk-tl-dot ${d1}">${i1}</div><div class="bk-tl-lbl">Deposit</div></div>
            <div class="bk-tl-line ${l1}"></div>
            <div class="bk-tl-step"><div class="bk-tl-dot ${d2}">${i2}</div><div class="bk-tl-lbl">Balance</div></div>
            <div class="bk-tl-line ${l2}"></div>
            <div class="bk-tl-step"><div class="bk-tl-dot ${d3}">${i3}</div><div class="bk-tl-lbl">Settled</div></div>
        </div>`;
    }

    // Action buttons
    let actions = '';
    const bid      = esc(b.booking_id || b.id || '');
    const bNameEnc = encodeURIComponent(b.customer_name || '');

    if (b.category === 'pre') {
        // pay button: serialise booking data safely
        const safeEnc = encodeURIComponent(JSON.stringify(b));
        actions += `<button class="bk-pay-btn" data-pay="${safeEnc}"><i class="fa-solid fa-credit-card"></i> Pay</button>`;
    }
    if (b.category === 'pre' || b.category === 'booked') {
        actions += `<button class="bk-cancel-btn" data-cancel-id="${bid}" data-cancel-name="${esc(decodeURIComponent(bNameEnc))}"><i class="fa-solid fa-trash"></i> Cancel</button>`;
    }

    // Card is clickable for detail view
    const dataEnc = encodeURIComponent(JSON.stringify(b));

    return `
<div class="bk-card" style="border-left:4px solid ${borderColor};" data-detail="${dataEnc}">
    <div class="bk-card-left">
        <div class="bk-date-badge">
            <div class="bk-db-day">${day}</div>
            <div class="bk-db-mon">${mon}</div>
        </div>
        <div class="bk-details">
            <h4>${esc(b.customer_name) || 'Guest'}</h4>
            <div class="bk-meta">
                ${b.room_name ? `<span><i class="fa-solid fa-layer-group"></i> ${esc(b.room_name)}</span>` : ''}
                ${b.customer_email ? `<span><i class="fa-solid fa-envelope"></i> ${esc(b.customer_email)}</span>` : ''}
                ${timeStr   ? `<span><i class="fa-solid fa-clock"></i> ${esc(timeStr)}</span>` : ''}
                ${multiDayStr}
                ${guestStr}
                <span><i class="fa-solid fa-sterling-sign"></i> Total: ${fmt(b.total_amount)}</span>
                ${b.category === 'pre' ? `<span style="color:var(--warning);font-weight:600;"><i class="fa-solid fa-coins"></i> Balance: ${fmt(b.balanceNum)}</span>` : ''}
            </div>
            ${timeline}
        </div>
    </div>
    <div class="bk-card-right">
        <div class="bk-status-pill ${pillCls}">${pillText}</div>
        ${actions}
    </div>
</div>`;
}

// ── Pagination HTML ────────────────────────────────────────────────────────
function buildPagination(total, totalPages) {
    const start = (_currentPage - 1) * PAGE_SIZE + 1;
    const end   = Math.min(_currentPage * PAGE_SIZE, total);

    let btns = '';
    // prev
    btns += `<button class="bk-page-btn" data-page="${_currentPage - 1}" ${_currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;

    // page number buttons (show up to 5 around current)
    const delta = 2;
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || (p >= _currentPage - delta && p <= _currentPage + delta)) {
            btns += `<button class="bk-page-btn${p === _currentPage ? ' active' : ''}" data-page="${p}">${p}</button>`;
        } else if (p === _currentPage - delta - 1 || p === _currentPage + delta + 1) {
            btns += `<button class="bk-page-btn" disabled>…</button>`;
        }
    }

    // next
    btns += `<button class="bk-page-btn" data-page="${_currentPage + 1}" ${_currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;

    return `
<span class="bk-page-info">Showing ${start}–${end} of ${total}</span>
<div class="bk-page-btns">${btns}</div>`;
}

// ── Event delegation for card buttons ─────────────────────────────────────
// Attached in init() via the list container
document.addEventListener('click', handleListClick);

function handleListClick(e) {
    const listEl = document.getElementById('bk-list');
    if (!listEl) return;

    // Pay button
    const payBtn = e.target.closest('.bk-pay-btn');
    if (payBtn && listEl.contains(payBtn)) {
        e.stopPropagation();
        try {
            const b = JSON.parse(decodeURIComponent(payBtn.dataset.pay));
            openPayModal(b);
        } catch { /* ignore */ }
        return;
    }

    // Cancel button
    const cancelBtn = e.target.closest('.bk-cancel-btn');
    if (cancelBtn && listEl.contains(cancelBtn)) {
        e.stopPropagation();
        const id   = cancelBtn.dataset.cancelId;
        const name = cancelBtn.dataset.cancelName || 'this booking';
        cancelBooking(id, name);
        return;
    }

    // Card click → detail modal
    const card = e.target.closest('.bk-card');
    if (card && listEl.contains(card)) {
        try {
            const b = JSON.parse(decodeURIComponent(card.dataset.detail));
            openDetailModal(b);
        } catch { /* ignore */ }
    }
}

// ── Cancel booking ────────────────────────────────────────────────────────
async function cancelBooking(id, name) {
    if (!confirm(`Cancel the booking for ${name}?\n\nThis will remove it from the calendar and flag it as cancelled.`)) return;

    try {
        const res    = await fetch(`${API_BASE}/cancel-booking`, {
            method:  'POST',
            headers: Auth.headers(),
            body:    JSON.stringify({ booking_id: id, tenant_id: Auth.getTenantId() })
        });
        const result = await res.json();
        if (result.status === 'success') {
            UI.toast('Booking cancelled', 'success');
            await fetchBookings();
        } else {
            UI.toast(result.message || 'Failed to cancel booking', 'error');
        }
    } catch (err) {
        console.error('[bookings] cancel error', err);
        UI.toast('Connection error — please try again', 'error');
    }
}

// ── Payment modal ──────────────────────────────────────────────────────────
function openPayModal(b) {
    _payBooking = b;
    const balance = parseFloat(b.balance_due ?? b.balanceNum ?? 0);

    // Booking info panel
    document.getElementById('bk-pm-customer').textContent    = b.customer_name || '—';
    document.getElementById('bk-pm-room').textContent        = b.room_name     || '—';
    document.getElementById('bk-pm-balance').textContent     = fmt(balance);

    const methodLabel = b.payment_method
        ? b.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : '—';
    document.getElementById('bk-pm-method-rec').textContent = methodLabel;

    // Date display
    const dateEl = document.getElementById('bk-pm-date');
    if (b.date_from && b.date_to && b.date_to.slice(0, 10) !== b.date_from.slice(0, 10)) {
        const df = new Date(b.date_from.split('T')[0] + 'T00:00:00');
        const dt = new Date(b.date_to.split('T')[0]   + 'T00:00:00');
        dateEl.textContent = `${df.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} – ${dt.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}`;
    } else {
        const ds = b.date_from || b.booking_date;
        dateEl.textContent = ds
            ? new Date(ds.split('T')[0] + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
            : '—';
    }

    // Amount + slider
    const slider = document.getElementById('bk-pm-slider');
    const amtIn  = document.getElementById('bk-pm-amount');
    slider.min   = 1;
    slider.max   = Math.round(balance * 100);
    slider.value = slider.max;
    amtIn.value  = balance.toFixed(2);
    amtIn.max    = balance.toFixed(2);
    document.getElementById('bk-pm-slider-max').textContent = fmt(balance);
    updateSliderUI(balance, balance);

    // Default method
    document.getElementById('bk-pm-method').value = 'cash';

    document.getElementById('bk-pay-overlay').classList.add('open');
}

function closePayModal() {
    document.getElementById('bk-pay-overlay')?.classList.remove('open');
}

function onPayAmountInput() {
    const balance = parseFloat(_payBooking?.balance_due ?? _payBooking?.balanceNum ?? 0);
    let val = parseFloat(document.getElementById('bk-pm-amount').value) || 0;
    if (val > balance) {
        val = balance;
        document.getElementById('bk-pm-amount').value = balance.toFixed(2);
    }
    document.getElementById('bk-pm-slider').value = Math.round(val * 100);
    updateSliderUI(val, balance);
}

function onPaySliderInput() {
    const balance = parseFloat(_payBooking?.balance_due ?? _payBooking?.balanceNum ?? 0);
    const val     = parseInt(document.getElementById('bk-pm-slider').value, 10) / 100;
    document.getElementById('bk-pm-amount').value = val.toFixed(2);
    updateSliderUI(val, balance);
}

function updateSliderUI(val, balance) {
    const pct    = balance > 0 ? Math.min(100, (val / balance) * 100) : 100;
    const slider = document.getElementById('bk-pm-slider');
    if (slider) slider.style.background = `linear-gradient(to right, var(--primary) ${pct}%, rgba(148,163,184,0.2) ${pct}%)`;

    const badge     = document.getElementById('bk-pm-badge');
    const isPartial = val < balance - 0.005;
    if (badge) {
        badge.className = `bk-pay-badge ${isPartial ? 'partial' : 'full'}`;
        badge.innerHTML = isPartial
            ? '<i class="fa-solid fa-coins"></i> Part Payment'
            : '<i class="fa-solid fa-circle-check"></i> Full Settlement';
    }

    const confirmBtn = document.getElementById('bk-pay-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = (val <= 0 || val > balance + 0.005);
}

async function submitPayment() {
    if (!_payBooking) return;
    const balance = parseFloat(_payBooking.balance_due ?? _payBooking.balanceNum ?? 0);
    const amount  = parseFloat(document.getElementById('bk-pm-amount').value);
    if (isNaN(amount) || amount <= 0)      return;
    if (amount > balance + 0.005)          return;

    const method  = document.getElementById('bk-pm-method').value;
    const btn     = document.getElementById('bk-pay-confirm-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing…'; }

    try {
        const res    = await fetch(`${API_BASE}/pay-balance`, {
            method:  'POST',
            headers: Auth.headers(),
            body:    JSON.stringify({
                booking_id:       _payBooking.booking_id || _payBooking.id,
                customer_id:      _payBooking.customer_id,
                amount,
                payment_method:   method,
                deposit_reference: _payBooking.deposit_reference || _payBooking.reference || ''
            })
        });
        const result = await res.json();
        closePayModal();

        if (result.status === 'success') {
            document.getElementById('bk-rc-amount').textContent = fmt(amount);
            document.getElementById('bk-rc-sub').textContent    = result.payment_type === 'partial'
                ? 'Part payment recorded'
                : 'Balance fully settled';
            const ref = result.reference_number || result.reference || '—';
            document.getElementById('bk-rc-ref').textContent = `Ref: ${ref}`;
            document.getElementById('bk-receipt-overlay').classList.add('open');
            await fetchBookings();
        } else {
            UI.toast(result.message || 'Payment failed — please try again', 'error');
        }
    } catch (err) {
        console.error('[bookings] payment error', err);
        UI.toast('Connection error — please try again', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Confirm Payment'; }
    }
}

function closeReceipt() {
    document.getElementById('bk-receipt-overlay')?.classList.remove('open');
}

// ── Detail modal ───────────────────────────────────────────────────────────
function openDetailModal(b) {
    const body = document.getElementById('bk-detail-body');
    if (!body) return;

    const fmtDate = ds => {
        if (!ds) return '—';
        try { return new Date(ds.split('T')[0] + 'T00:00:00').toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); }
        catch { return ds; }
    };

    const row = (lbl, val, full = false) => `
    <div class="bk-detail-field${full ? ' full' : ''}">
        <div class="bk-detail-lbl">${lbl}</div>
        <div class="bk-detail-val">${val || '—'}</div>
    </div>`;

    const statusMap = { pre: 'Payment Due', booked: 'Fully Paid', post: 'Completed', cancelled: 'Cancelled' };
    const statusDisp = statusMap[b.category] || esc(b.status || '');

    const timeStr = (() => {
        const s = (b.start_time || '').slice(0, 5);
        const e = (b.end_time   || '').slice(0, 5);
        return s ? (e ? `${s} – ${e}` : s) : '—';
    })();

    const dateRange = b.date_from && b.date_to && b.date_from.slice(0,10) !== b.date_to.slice(0,10)
        ? `${fmtDate(b.date_from)} – ${fmtDate(b.date_to)}`
        : fmtDate(b.date_from || b.booking_date);

    const methodDisp = b.payment_method
        ? b.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : '—';

    body.innerHTML = `
    <div class="bk-detail-grid">
        ${row('Booking ID',       esc(b.booking_id || b.id || ''))}
        ${row('Status',           statusDisp)}
        ${row('Customer',         esc(b.customer_name || ''))}
        ${row('Email',            esc(b.customer_email || b.email || ''))}
        ${row('Phone',            esc(b.customer_phone || b.phone || ''))}
        ${row('Room',             esc(b.room_name || ''))}
        ${row('Date',             dateRange)}
        ${row('Time',             timeStr)}
        ${row('Guests',           esc(b.guests ?? ''))}
        ${row('Total',            fmt(b.total_amount))}
        ${row('Balance Due',      fmt(b.balanceNum))}
        ${row('Payment Method',   methodDisp)}
        ${row('Booking Date',     fmtDate(b.booking_date))}
    </div>
    <div class="bk-detail-actions">
        ${b.category === 'pre'
            ? `<button class="bk-pay-btn" id="bk-detail-pay-btn"><i class="fa-solid fa-credit-card"></i> Pay Balance</button>`
            : ''}
        ${(b.category === 'pre' || b.category === 'booked')
            ? `<button class="bk-cancel-btn" id="bk-detail-cancel-btn"><i class="fa-solid fa-trash"></i> Cancel Booking</button>`
            : ''}
        <button class="bk-page-btn" id="bk-detail-dismiss-btn" style="min-height:unset;">Close</button>
    </div>`;

    // Wire action buttons inside modal
    document.getElementById('bk-detail-pay-btn')?.addEventListener('click', () => {
        closeDetailModal();
        openPayModal(b);
    });
    document.getElementById('bk-detail-cancel-btn')?.addEventListener('click', () => {
        closeDetailModal();
        cancelBooking(b.booking_id || b.id, b.customer_name || 'this booking');
    });
    document.getElementById('bk-detail-dismiss-btn')?.addEventListener('click', closeDetailModal);

    document.getElementById('bk-detail-overlay').classList.add('open');
}

function closeDetailModal() {
    document.getElementById('bk-detail-overlay')?.classList.remove('open');
}

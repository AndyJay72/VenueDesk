import { Auth, API_BASE } from '../auth.js';
import { UI } from '../ui.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tidParam = (sep = '?') => { const t = Auth.getTenantId(); return t ? `${sep}tenant_id=${encodeURIComponent(t)}` : ''; };

// ── FullCalendar loader ───────────────────────────────────────────────────────
async function loadFC() {
    if (window.FullCalendar) return;
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

// ── Status colour mapping ─────────────────────────────────────────────────────
function bookingColour(b) {
    const status = (b.status || b.booking_status || '').toLowerCase();
    const total   = parseFloat(b.total_amount  || b.total   || 0);
    const paid    = parseFloat(b.amount_paid   || b.deposit || 0);
    const balance = parseFloat(b.balance_due   || b.balance || (total - paid));

    if (status === 'cancelled' || status === 'canceled') return '#64748b';
    if (status === 'paid' || (total > 0 && balance <= 0))  return '#10b981';
    if (balance > 0 && paid > 0)                           return '#ef4444';
    return '#f59e0b'; // pending / contacted / default
}

function bookingTextDecoration(b) {
    const status = (b.status || b.booking_status || '').toLowerCase();
    return (status === 'cancelled' || status === 'canceled') ? 'line-through' : '';
}

// ── Convert API booking → FullCalendar event object ──────────────────────────
function toFCEvent(b) {
    const colour = bookingColour(b);
    const decoration = bookingTextDecoration(b);
    const roomName = b.room_name || b.room || '';
    const title = `${esc(b.customer_name || 'Guest')}${roomName ? ' — ' + esc(roomName) : ''}`;
    return {
        id: String(b.booking_id || b.id || Math.random()),
        title,
        start: b.date_from || b.booking_date || b.start_date || b.date,
        end:   b.date_to   || b.booking_date || b.end_date   || b.date,
        backgroundColor: colour,
        borderColor:     colour,
        textColor:       '#ffffff',
        classNames:      decoration ? ['fc-event-cancelled'] : [],
        extendedProps:   { booking: b, decoration }
    };
}

// ── Convert blocked-date rule → FullCalendar background event ─────────────────
function toBlockedEvent(rule, idx) {
    const base = {
        id: `blocked-${idx}`,
        display: 'background',
        backgroundColor: 'rgba(239,68,68,0.15)',
        extendedProps: { isBlocked: true, rule }
    };

    if (rule.type === 'oneoff' || rule.date) {
        return { ...base, start: rule.date, end: rule.date, title: rule.label || 'Blocked' };
    }
    if (rule.type === 'range' || (rule.start_date && rule.end_date)) {
        // end is exclusive in FC
        const end = rule.end_date ? addDays(rule.end_date, 1) : rule.end_date;
        return { ...base, start: rule.start_date || rule.start, end, title: rule.label || 'Blocked' };
    }
    if (rule.type === 'weekly' && rule.day_of_week !== undefined) {
        return {
            ...base,
            daysOfWeek: [Number(rule.day_of_week)],
            title: rule.label || 'Blocked',
            startRecur: rule.start_recur || undefined,
            endRecur:   rule.end_recur   || undefined,
        };
    }
    return null;
}

function addDays(dateStr, n) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d) {
    if (!d) return '—';
    return d.length <= 10 ? '—' : new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtCurrency(n) {
    return '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Page module ───────────────────────────────────────────────────────────────
export default {
    title: 'Calendar',

    css: `
        /* ── Calendar page layout ── */
        .cal-page-header {
            margin-bottom: 1.25rem;
        }
        .cal-page-header h1 {
            font-size: 1.6rem;
            font-weight: 700;
            color: var(--text-main);
            margin: 0 0 .15rem;
        }
        .cal-page-header p {
            color: var(--text-muted);
            font-size: .9rem;
            margin: 0;
        }

        /* ── Top toolbar ── */
        .cal-toolbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: .75rem;
            margin-bottom: 1rem;
        }
        .cal-toolbar select {
            padding: .45rem .85rem;
            border-radius: 8px;
            border: 1px solid var(--border);
            background: var(--card-bg);
            color: var(--text-main);
            font-size: .875rem;
            cursor: pointer;
            min-width: 160px;
        }
        .cal-toolbar select:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(var(--primary-rgb, 99,102,241), .15);
        }

        /* ── Legend ── */
        .cal-legend {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: .5rem .9rem;
            flex: 1;
        }
        .cal-legend-item {
            display: flex;
            align-items: center;
            gap: .35rem;
            font-size: .8rem;
            color: var(--text-muted);
        }
        .cal-legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        /* ── Toolbar buttons ── */
        .cal-toolbar-btn {
            display: inline-flex;
            align-items: center;
            gap: .4rem;
            padding: .45rem 1rem;
            border-radius: 8px;
            font-size: .875rem;
            font-weight: 500;
            border: none;
            cursor: pointer;
            text-decoration: none;
            transition: opacity .15s, background .15s;
            white-space: nowrap;
        }
        .cal-toolbar-btn.secondary {
            background: var(--card-bg);
            color: var(--text-main);
            border: 1px solid var(--border);
        }
        .cal-toolbar-btn.secondary:hover { background: var(--hover-bg, rgba(0,0,0,.05)); }
        .cal-toolbar-btn.primary {
            background: var(--primary);
            color: #fff;
        }
        .cal-toolbar-btn.primary:hover { opacity: .88; }

        /* ── Calendar container ── */
        #cal-container {
            background: var(--card-bg);
            border-radius: 12px;
            border: 1px solid var(--border);
            padding: 1rem 1.25rem 1.25rem;
            min-height: 480px;
        }
        #cal-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 400px;
            flex-direction: column;
            gap: .75rem;
            color: var(--text-muted);
        }

        /* ── FullCalendar overrides ── */
        .fc .fc-button-primary {
            background: var(--primary) !important;
            border-color: var(--primary) !important;
        }
        .fc .fc-button-primary:hover {
            opacity: .88 !important;
        }
        .fc .fc-button-primary:disabled {
            opacity: .5 !important;
        }
        .fc .fc-today-button {
            text-transform: capitalize;
        }
        .fc .fc-day-today {
            background: rgba(var(--primary-rgb, 99,102,241), .07) !important;
        }
        .fc .fc-col-header-cell {
            font-weight: 600;
            font-size: .82rem;
            color: var(--text-muted);
        }
        .fc .fc-daygrid-day-number {
            color: var(--text-main);
            font-size: .82rem;
        }
        .fc-event-cancelled .fc-event-title {
            text-decoration: line-through;
        }
        .fc .fc-event {
            border-radius: 5px;
            font-size: .75rem;
            padding: 1px 4px;
            cursor: pointer;
        }
        .fc .fc-list-event:hover td {
            background: var(--hover-bg, rgba(0,0,0,.04));
        }
        .fc-theme-standard td, .fc-theme-standard th {
            border-color: var(--border) !important;
        }
        .fc-theme-standard .fc-scrollgrid {
            border-color: var(--border) !important;
        }
        .fc .fc-toolbar-title {
            font-size: 1.1rem;
            font-weight: 700;
            color: var(--text-main);
        }

        /* ── Modals ── */
        .cal-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,.55);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            animation: calFadeIn .15s ease;
        }
        @keyframes calFadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
        }
        .cal-modal {
            background: var(--card-bg);
            border-radius: 14px;
            border: 1px solid var(--border);
            width: 100%;
            max-width: 600px;
            max-height: 92vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,.3);
            animation: calSlideUp .18s ease;
        }
        .cal-modal.wide { max-width: 720px; }
        @keyframes calSlideUp {
            from { transform: translateY(18px); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
        }
        .cal-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1.1rem 1.4rem .9rem;
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            background: var(--card-bg);
            z-index: 1;
            border-radius: 14px 14px 0 0;
        }
        .cal-modal-header h2 {
            font-size: 1.05rem;
            font-weight: 700;
            color: var(--text-main);
            margin: 0;
        }
        .cal-modal-close {
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 1.2rem;
            cursor: pointer;
            padding: .2rem .4rem;
            border-radius: 6px;
            transition: background .12s;
        }
        .cal-modal-close:hover { background: var(--hover-bg, rgba(0,0,0,.06)); color: var(--text-main); }
        .cal-modal-body {
            padding: 1.25rem 1.4rem;
        }
        .cal-modal-footer {
            padding: .9rem 1.4rem 1.1rem;
            border-top: 1px solid var(--border);
            display: flex;
            gap: .6rem;
            justify-content: flex-end;
            flex-wrap: wrap;
        }

        /* ── Form grid ── */
        .form-grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: .85rem 1rem;
        }
        .form-grid-2 .span-2 { grid-column: 1 / -1; }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: .3rem;
        }
        .form-group label {
            font-size: .8rem;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: .03em;
        }
        .form-group input,
        .form-group select,
        .form-group textarea {
            padding: .5rem .8rem;
            border-radius: 8px;
            border: 1px solid var(--border);
            background: var(--input-bg, var(--card-bg));
            color: var(--text-main);
            font-size: .9rem;
            width: 100%;
            box-sizing: border-box;
            transition: border-color .12s, box-shadow .12s;
        }
        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(var(--primary-rgb, 99,102,241), .15);
        }
        .form-group textarea { resize: vertical; min-height: 70px; }

        /* ── Detail modal ── */
        .detail-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: .6rem 1.5rem;
        }
        .detail-item { display: flex; flex-direction: column; gap: .15rem; }
        .detail-item .lbl {
            font-size: .75rem;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: .04em;
        }
        .detail-item .val {
            font-size: .92rem;
            color: var(--text-main);
            font-weight: 500;
        }
        .detail-sep {
            grid-column: 1 / -1;
            border: none;
            border-top: 1px solid var(--border);
            margin: .35rem 0;
        }
        .status-badge {
            display: inline-block;
            padding: .2rem .65rem;
            border-radius: 20px;
            font-size: .78rem;
            font-weight: 600;
        }
        .badge-paid     { background: rgba(16,185,129,.15); color: #10b981; }
        .badge-pending  { background: rgba(245,158,11,.15);  color: #f59e0b; }
        .badge-balance  { background: rgba(239,68,68,.15);   color: #ef4444; }
        .badge-cancelled{ background: rgba(100,116,139,.15); color: #64748b; }

        /* ── Blocked dates modal ── */
        .blocked-list { list-style: none; padding: 0; margin: 0 0 1.25rem; display: flex; flex-direction: column; gap: .5rem; }
        .blocked-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: .55rem .85rem;
            border-radius: 8px;
            border: 1px solid var(--border);
            background: var(--bg, var(--card-bg));
            font-size: .875rem;
            color: var(--text-main);
            gap: .5rem;
        }
        .blocked-item .blocked-meta { color: var(--text-muted); font-size: .8rem; }
        .btn-icon-danger {
            background: none;
            border: none;
            color: #ef4444;
            cursor: pointer;
            font-size: .95rem;
            padding: .2rem .4rem;
            border-radius: 6px;
            transition: background .12s;
            flex-shrink: 0;
        }
        .btn-icon-danger:hover { background: rgba(239,68,68,.1); }
        .blocked-add-title {
            font-size: .9rem;
            font-weight: 700;
            color: var(--text-main);
            margin: 0 0 .75rem;
        }

        /* ── Responsive ── */
        @media (max-width: 600px) {
            .form-grid-2 { grid-template-columns: 1fr; }
            .form-grid-2 .span-2 { grid-column: 1; }
            .detail-grid { grid-template-columns: 1fr; }
            .cal-toolbar { flex-direction: column; align-items: stretch; }
            .cal-legend { justify-content: center; }
        }
    `,

    render() {
        const venueName = Auth.getUser().venue_name || Auth.getVenueName() || 'Your Venue';
        return `
            <div class="cal-page-header">
                <h1><i class="fa-solid fa-calendar-days" style="color:var(--primary);margin-right:.45rem;"></i>Calendar</h1>
                <p>${esc(venueName)}</p>
            </div>

            <div class="cal-toolbar">
                <select id="cal-room-filter" aria-label="Filter by room">
                    <option value="">All Rooms</option>
                </select>

                <div class="cal-legend">
                    <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#f59e0b;"></span>Pending</span>
                    <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#10b981;"></span>Paid</span>
                    <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#ef4444;"></span>Balance Due</span>
                    <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#64748b;"></span>Cancelled</span>
                    <span class="cal-legend-item"><span class="cal-legend-dot" style="background:rgba(239,68,68,.35);border-radius:2px;width:14px;height:10px;"></span>Blocked</span>
                </div>

                <button class="cal-toolbar-btn secondary" id="btn-manage-blocked">
                    <i class="fa-solid fa-ban"></i> Manage Blocked Dates
                </button>
                <a href="calendar.html" target="_blank" class="cal-toolbar-btn secondary">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Full Calendar
                </a>
                <button class="cal-toolbar-btn primary" id="btn-quick-book">
                    <i class="fa-solid fa-plus"></i> Quick Book
                </button>
            </div>

            <div id="cal-container">
                <div id="cal-loading">
                    <i class="fa-solid fa-circle-notch fa-spin" style="font-size:1.8rem;color:var(--primary);"></i>
                    <p>Loading calendar…</p>
                </div>
            </div>

            <!-- Quick Book Modal -->
            <div id="qbModal" class="cal-modal-overlay" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="qbModalTitle">
                <div class="cal-modal wide">
                    <div class="cal-modal-header">
                        <h2 id="qbModalTitle"><i class="fa-solid fa-calendar-plus" style="color:var(--primary);margin-right:.45rem;"></i>Quick Book</h2>
                        <button class="cal-modal-close" id="qbClose" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <form id="qbForm" novalidate>
                        <div class="cal-modal-body">
                            <div class="form-grid-2">
                                <div class="form-group span-2">
                                    <label for="qb-name">Customer Name <span style="color:#ef4444;">*</span></label>
                                    <input type="text" id="qb-name" name="customer_name" placeholder="Full name" required autocomplete="name">
                                </div>
                                <div class="form-group">
                                    <label for="qb-email">Email</label>
                                    <input type="email" id="qb-email" name="email" placeholder="email@example.com" autocomplete="email">
                                </div>
                                <div class="form-group">
                                    <label for="qb-phone">Phone</label>
                                    <input type="tel" id="qb-phone" name="phone" placeholder="+44…" autocomplete="tel">
                                </div>
                                <div class="form-group">
                                    <label for="qb-event-type">Event Type</label>
                                    <select id="qb-event-type" name="event_type">
                                        <option value="">Loading…</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="qb-room">Room</label>
                                    <select id="qb-room" name="room_id">
                                        <option value="">Loading…</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="qb-date">Date <span style="color:#ef4444;">*</span></label>
                                    <input type="date" id="qb-date" name="booking_date" required>
                                </div>
                                <div class="form-group">
                                    <label for="qb-guests">Number of Guests</label>
                                    <input type="number" id="qb-guests" name="guests" min="1" placeholder="e.g. 50">
                                </div>
                                <div class="form-group">
                                    <label for="qb-start-time">Start Time</label>
                                    <input type="time" id="qb-start-time" name="start_time">
                                </div>
                                <div class="form-group">
                                    <label for="qb-end-time">End Time</label>
                                    <input type="time" id="qb-end-time" name="end_time">
                                </div>
                                <div class="form-group">
                                    <label for="qb-total">Total Amount (£)</label>
                                    <input type="number" id="qb-total" name="total_amount" min="0" step="0.01" placeholder="0.00">
                                </div>
                                <div class="form-group">
                                    <label for="qb-deposit">Deposit (£)</label>
                                    <input type="number" id="qb-deposit" name="deposit" min="0" step="0.01" placeholder="0.00">
                                </div>
                                <div class="form-group">
                                    <label for="qb-payment-method">Payment Method</label>
                                    <select id="qb-payment-method" name="payment_method">
                                        <option value="">Select…</option>
                                        <option value="Cash">Cash</option>
                                        <option value="Card">Card</option>
                                        <option value="Bank Transfer">Bank Transfer</option>
                                        <option value="BACS">BACS</option>
                                    </select>
                                </div>
                                <div class="form-group span-2">
                                    <label for="qb-notes">Notes</label>
                                    <textarea id="qb-notes" name="notes" placeholder="Any additional notes…"></textarea>
                                </div>
                            </div>
                        </div>
                        <div class="cal-modal-footer">
                            <button type="button" class="cal-toolbar-btn secondary" id="qbCancelBtn">Cancel</button>
                            <button type="submit" class="cal-toolbar-btn primary" id="qbSubmitBtn">
                                <i class="fa-solid fa-floppy-disk"></i> Save Booking
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Booking Detail Modal -->
            <div id="detailModal" class="cal-modal-overlay" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="detailModalTitle">
                <div class="cal-modal">
                    <div class="cal-modal-header">
                        <h2 id="detailModalTitle"><i class="fa-solid fa-circle-info" style="color:var(--primary);margin-right:.45rem;"></i>Booking Details</h2>
                        <button class="cal-modal-close" id="detailClose" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="cal-modal-body" id="detailBody">
                        <!-- populated dynamically -->
                    </div>
                    <div class="cal-modal-footer" id="detailFooter">
                        <button type="button" class="cal-toolbar-btn secondary" id="detailCloseBtn">Close</button>
                    </div>
                </div>
            </div>

            <!-- Blocked Dates Modal -->
            <div id="blockModal" class="cal-modal-overlay" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="blockModalTitle">
                <div class="cal-modal wide">
                    <div class="cal-modal-header">
                        <h2 id="blockModalTitle"><i class="fa-solid fa-ban" style="color:#ef4444;margin-right:.45rem;"></i>Manage Blocked Dates</h2>
                        <button class="cal-modal-close" id="blockClose" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="cal-modal-body">
                        <div id="blockedListWrap">
                            <div class="loading">${UI.spinner()}</div>
                        </div>
                        <hr style="border:none;border-top:1px solid var(--border);margin:1.25rem 0;">
                        <p class="blocked-add-title">Add New Blocked Rule</p>
                        <form id="blockForm" novalidate>
                            <div class="form-grid-2">
                                <div class="form-group">
                                    <label for="blk-type">Rule Type <span style="color:#ef4444;">*</span></label>
                                    <select id="blk-type" name="type" required>
                                        <option value="oneoff">One-off Date</option>
                                        <option value="range">Date Range</option>
                                        <option value="weekly">Weekly (day of week)</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="blk-label">Label / Reason</label>
                                    <input type="text" id="blk-label" name="label" placeholder="e.g. Maintenance">
                                </div>
                                <!-- one-off -->
                                <div class="form-group" id="blk-row-date">
                                    <label for="blk-date">Date <span style="color:#ef4444;">*</span></label>
                                    <input type="date" id="blk-date" name="date">
                                </div>
                                <!-- range -->
                                <div class="form-group" id="blk-row-start" style="display:none;">
                                    <label for="blk-start">Start Date <span style="color:#ef4444;">*</span></label>
                                    <input type="date" id="blk-start" name="start_date">
                                </div>
                                <div class="form-group" id="blk-row-end" style="display:none;">
                                    <label for="blk-end">End Date <span style="color:#ef4444;">*</span></label>
                                    <input type="date" id="blk-end" name="end_date">
                                </div>
                                <!-- weekly -->
                                <div class="form-group" id="blk-row-dow" style="display:none;">
                                    <label for="blk-dow">Day of Week <span style="color:#ef4444;">*</span></label>
                                    <select id="blk-dow" name="day_of_week">
                                        <option value="0">Sunday</option>
                                        <option value="1">Monday</option>
                                        <option value="2">Tuesday</option>
                                        <option value="3">Wednesday</option>
                                        <option value="4">Thursday</option>
                                        <option value="5">Friday</option>
                                        <option value="6">Saturday</option>
                                    </select>
                                </div>
                            </div>
                            <div style="margin-top:1rem;display:flex;justify-content:flex-end;">
                                <button type="submit" class="cal-toolbar-btn primary">
                                    <i class="fa-solid fa-plus"></i> Add Rule
                                </button>
                            </div>
                        </form>
                    </div>
                    <div class="cal-modal-footer">
                        <button type="button" class="cal-toolbar-btn secondary" id="blockCloseBtn">Done</button>
                    </div>
                </div>
            </div>
        `;
    },

    // ── Internal state ─────────────────────────────────────────────────────────
    _calendar: null,
    _allBookings: [],
    _blockedRules: [],
    _rooms: [],
    _eventTypes: [],
    _selectedRoom: '',

    async init() {
        // ── Load FullCalendar ──
        try {
            await loadFC();
        } catch (e) {
            document.getElementById('cal-loading').innerHTML = `
                <i class="fa-solid fa-circle-exclamation" style="font-size:1.8rem;color:#ef4444;"></i>
                <p style="color:#ef4444;">Failed to load FullCalendar. Check your internet connection.</p>`;
            return;
        }

        // ── Fetch all data in parallel ──
        const [bookings, blocked, rooms, eventTypes] = await Promise.all([
            this._fetchBookings(),
            this._fetchBlocked(),
            this._fetchRooms(),
            this._fetchEventTypes(),
        ]);

        this._allBookings  = bookings;
        this._blockedRules = blocked;
        this._rooms        = rooms;
        this._eventTypes   = eventTypes;

        // ── Populate room filter ──
        this._populateRoomFilter(rooms);

        // ── Populate Quick Book selects ──
        this._populateQBRooms(rooms);
        this._populateQBEventTypes(eventTypes);

        // ── Initialise FullCalendar ──
        this._initCalendar();

        // ── Wire up controls ──
        this._bindEvents();
    },

    destroy() {
        if (this._calendar) {
            this._calendar.destroy();
            this._calendar = null;
        }
        this._allBookings  = [];
        this._blockedRules = [];
        this._rooms        = [];
        this._eventTypes   = [];
        this._selectedRoom = '';
    },

    // ── Data fetchers ──────────────────────────────────────────────────────────
    async _fetchBookings() {
        try {
            const res = await fetch(`${API_BASE}/all-bookings${tidParam()}`, { headers: Auth.headers() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            return Array.isArray(json) ? json : (json.data || []);
        } catch (e) {
            console.error('[Calendar] fetchBookings:', e);
            return [];
        }
    },

    async _fetchBlocked() {
        try {
            const res = await fetch(`${API_BASE}/blocked-dates${tidParam()}`, { headers: Auth.headers() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            return Array.isArray(json) ? json : (json.data || json.rules || []);
        } catch (e) {
            console.error('[Calendar] fetchBlocked:', e);
            return [];
        }
    },

    async _fetchRooms() {
        try {
            const res = await fetch(`${API_BASE}/get-rooms${tidParam()}`, { headers: Auth.headers() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            return Array.isArray(json) ? json : (json.data || []);
        } catch (e) {
            console.error('[Calendar] fetchRooms:', e);
            return [];
        }
    },

    async _fetchEventTypes() {
        try {
            const res = await fetch(`${API_BASE}/get-event-types${tidParam()}`, { headers: Auth.headers() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            return Array.isArray(json) ? json : (json.data || []);
        } catch (e) {
            console.error('[Calendar] fetchEventTypes:', e);
            return [];
        }
    },

    // ── Room filter population ─────────────────────────────────────────────────
    _populateRoomFilter(rooms) {
        const sel = document.getElementById('cal-room-filter');
        if (!sel) return;
        rooms.forEach(r => {
            const opt = document.createElement('option');
            opt.value = String(r.room_id || r.id || r.name || '');
            opt.textContent = r.room_name || r.name || `Room ${r.id}`;
            sel.appendChild(opt);
        });
    },

    // ── Quick Book form population ─────────────────────────────────────────────
    _populateQBRooms(rooms) {
        const sel = document.getElementById('qb-room');
        if (!sel) return;
        sel.innerHTML = '<option value="">Select room…</option>';
        rooms.forEach(r => {
            const opt = document.createElement('option');
            opt.value = String(r.room_id || r.id || '');
            opt.dataset.price = r.price_per_hour || r.hourly_rate || r.base_price || 0;
            opt.dataset.name  = r.room_name || r.name || '';
            opt.textContent   = r.room_name || r.name || `Room ${r.id}`;
            sel.appendChild(opt);
        });
    },

    _populateQBEventTypes(types) {
        const sel = document.getElementById('qb-event-type');
        if (!sel) return;
        sel.innerHTML = '<option value="">Select type…</option>';
        types.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.event_type_id || t.id || t.name || t.type || '';
            opt.textContent = t.event_type_name || t.name || t.type || String(opt.value);
            sel.appendChild(opt);
        });
    },

    // ── Build event lists for FC ───────────────────────────────────────────────
    _buildFCEvents(roomFilter) {
        let bookings = this._allBookings;
        if (roomFilter) {
            bookings = bookings.filter(b => {
                const rid = String(b.room_id || b.room || '');
                return rid === roomFilter;
            });
        }
        const events = bookings.map(toFCEvent);

        // Blocked date background events
        this._blockedRules.forEach((rule, i) => {
            const ev = toBlockedEvent(rule, i);
            if (ev) events.push(ev);
        });

        return events;
    },

    // ── Init FullCalendar ──────────────────────────────────────────────────────
    _initCalendar() {
        const container = document.getElementById('cal-container');
        if (!container) return;
        container.innerHTML = ''; // remove loading indicator

        const self = this;
        this._calendar = new window.FullCalendar.Calendar(container, {
            initialView: 'dayGridMonth',
            height: 'auto',
            headerToolbar: {
                left:   'prev,next today',
                center: 'title',
                right:  'dayGridMonth,listWeek',
            },
            buttonText: {
                today:    'Today',
                month:    'Month',
                listWeek: 'List',
            },
            firstDay: 1, // Monday
            editable:  false,
            selectable: false,
            events: this._buildFCEvents(this._selectedRoom),

            dateClick(info) {
                self._openQBModal(info.dateStr);
            },

            eventClick(info) {
                if (info.event.extendedProps.isBlocked) return;
                self._openDetailModal(info.event.extendedProps.booking);
            },

            eventDidMount(info) {
                // Apply strikethrough for cancelled
                if (info.event.extendedProps.decoration === 'line-through') {
                    const titleEl = info.el.querySelector('.fc-event-title');
                    if (titleEl) titleEl.style.textDecoration = 'line-through';
                }
                // Tooltip
                const b = info.event.extendedProps.booking;
                if (b) {
                    info.el.title = [
                        b.customer_name || 'Guest',
                        b.room_name || b.room || '',
                        fmtDate(b.date_from || b.booking_date),
                        b.status || b.booking_status || '',
                    ].filter(Boolean).join(' | ');
                }
            },
        });

        this._calendar.render();
    },

    // ── Reload calendar events ─────────────────────────────────────────────────
    async _reloadCalendarEvents() {
        this._allBookings  = await this._fetchBookings();
        this._blockedRules = await this._fetchBlocked();
        if (!this._calendar) return;
        this._calendar.removeAllEvents();
        this._buildFCEvents(this._selectedRoom).forEach(ev => this._calendar.addEvent(ev));
    },

    // ── Bind UI events ─────────────────────────────────────────────────────────
    _bindEvents() {
        // Room filter
        const roomSel = document.getElementById('cal-room-filter');
        if (roomSel) {
            roomSel.addEventListener('change', () => {
                this._selectedRoom = roomSel.value;
                if (!this._calendar) return;
                this._calendar.removeAllEvents();
                this._buildFCEvents(this._selectedRoom).forEach(ev => this._calendar.addEvent(ev));
            });
        }

        // Quick Book button
        const btnQB = document.getElementById('btn-quick-book');
        if (btnQB) btnQB.addEventListener('click', () => this._openQBModal());

        // Manage Blocked Dates button
        const btnBlock = document.getElementById('btn-manage-blocked');
        if (btnBlock) btnBlock.addEventListener('click', () => this._openBlockModal());

        // ── Quick Book modal ──
        const qbModal    = document.getElementById('qbModal');
        const qbClose    = document.getElementById('qbClose');
        const qbCancel   = document.getElementById('qbCancelBtn');
        const qbForm     = document.getElementById('qbForm');
        const qbTotal    = document.getElementById('qb-total');
        const qbDeposit  = document.getElementById('qb-deposit');
        const qbRoom     = document.getElementById('qb-room');

        if (qbClose)  qbClose.addEventListener('click',  () => this._closeModal('qbModal'));
        if (qbCancel) qbCancel.addEventListener('click', () => this._closeModal('qbModal'));
        if (qbModal)  qbModal.addEventListener('click',  e => { if (e.target === qbModal) this._closeModal('qbModal'); });

        // Auto-calculate 30% deposit when total changes
        if (qbTotal) {
            qbTotal.addEventListener('input', () => {
                if (qbDeposit) {
                    const total = parseFloat(qbTotal.value) || 0;
                    qbDeposit.value = total > 0 ? (total * 0.3).toFixed(2) : '';
                }
            });
        }

        // Auto-fetch pricing when room changes
        if (qbRoom) {
            qbRoom.addEventListener('change', () => this._onQBRoomChange());
        }

        // Quick Book form submit
        if (qbForm) {
            qbForm.addEventListener('submit', e => {
                e.preventDefault();
                this._submitQuickBook();
            });
        }

        // ── Detail modal ──
        const detailClose    = document.getElementById('detailClose');
        const detailCloseBtn = document.getElementById('detailCloseBtn');
        const detailModal    = document.getElementById('detailModal');
        if (detailClose)    detailClose.addEventListener('click',    () => this._closeModal('detailModal'));
        if (detailCloseBtn) detailCloseBtn.addEventListener('click', () => this._closeModal('detailModal'));
        if (detailModal)    detailModal.addEventListener('click',    e => { if (e.target === detailModal) this._closeModal('detailModal'); });

        // ── Block modal ──
        const blockClose    = document.getElementById('blockClose');
        const blockCloseBtn = document.getElementById('blockCloseBtn');
        const blockModal    = document.getElementById('blockModal');
        const blockForm     = document.getElementById('blockForm');
        const blkType       = document.getElementById('blk-type');

        if (blockClose)    blockClose.addEventListener('click',    () => this._closeModal('blockModal'));
        if (blockCloseBtn) blockCloseBtn.addEventListener('click', () => this._closeModal('blockModal'));
        if (blockModal)    blockModal.addEventListener('click',    e => { if (e.target === blockModal) this._closeModal('blockModal'); });

        if (blkType) {
            blkType.addEventListener('change', () => this._updateBlockFormFields());
        }

        if (blockForm) {
            blockForm.addEventListener('submit', e => {
                e.preventDefault();
                this._submitBlockedRule();
            });
        }

        // ── Keyboard ESC ──
        this._keyHandler = e => {
            if (e.key === 'Escape') {
                ['qbModal', 'detailModal', 'blockModal'].forEach(id => this._closeModal(id));
            }
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    // ── Modal helpers ──────────────────────────────────────────────────────────
    _openModal(id) {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    },

    _closeModal(id) {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'none'; }
        // Restore scroll only if no other modals open
        const open = ['qbModal', 'detailModal', 'blockModal'].some(mid => {
            const m = document.getElementById(mid);
            return m && m.style.display !== 'none';
        });
        if (!open) document.body.style.overflow = '';
    },

    // ── Quick Book modal ───────────────────────────────────────────────────────
    _openQBModal(dateStr) {
        const form = document.getElementById('qbForm');
        if (form) form.reset();

        if (dateStr) {
            const dateInput = document.getElementById('qb-date');
            if (dateInput) dateInput.value = dateStr;
        }

        // Reset deposit
        const depInput = document.getElementById('qb-deposit');
        if (depInput) depInput.value = '';

        this._openModal('qbModal');
        setTimeout(() => document.getElementById('qb-name')?.focus(), 80);
    },

    async _onQBRoomChange() {
        const roomSel = document.getElementById('qb-room');
        const totalEl = document.getElementById('qb-total');
        const depEl   = document.getElementById('qb-deposit');
        if (!roomSel || !totalEl) return;

        const selected = roomSel.options[roomSel.selectedIndex];
        const basePrice = parseFloat(selected?.dataset?.price || 0);
        if (basePrice > 0) {
            totalEl.value = basePrice.toFixed(2);
            if (depEl) depEl.value = (basePrice * 0.3).toFixed(2);
            return;
        }

        // Try fetching from API
        const roomId = roomSel.value;
        if (!roomId) return;
        try {
            const res = await fetch(
                `${API_BASE}/get-pricing${tidParam()}&room_id=${encodeURIComponent(roomId)}`,
                { headers: Auth.headers() }
            );
            if (res.ok) {
                const json = await res.json();
                const price = parseFloat(
                    json.price || json.total || json.base_price || json.data?.price || 0
                );
                if (price > 0) {
                    totalEl.value = price.toFixed(2);
                    if (depEl) depEl.value = (price * 0.3).toFixed(2);
                }
            }
        } catch (_) { /* non-fatal */ }
    },

    async _submitQuickBook() {
        const form = document.getElementById('qbForm');
        if (!form) return;

        const nameEl = document.getElementById('qb-name');
        const dateEl = document.getElementById('qb-date');
        if (!nameEl?.value.trim()) {
            UI.toast('Customer name is required.', 'warning');
            nameEl?.focus();
            return;
        }
        if (!dateEl?.value) {
            UI.toast('Booking date is required.', 'warning');
            dateEl?.focus();
            return;
        }

        const submitBtn = document.getElementById('qbSubmitBtn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving…'; }

        // Build payload from form
        const fd = new FormData(form);
        const roomSel = document.getElementById('qb-room');
        const roomName = roomSel?.options[roomSel.selectedIndex]?.dataset?.name || '';

        const payload = {
            tenant_id:      Auth.getTenantId(),
            customer_name:  fd.get('customer_name') || '',
            email:          fd.get('email') || '',
            phone:          fd.get('phone') || '',
            event_type:     fd.get('event_type') || '',
            room_id:        fd.get('room_id') || '',
            room_name:      roomName,
            booking_date:   fd.get('booking_date') || '',
            start_time:     fd.get('start_time') || '',
            end_time:       fd.get('end_time') || '',
            guests:         parseInt(fd.get('guests') || '0', 10) || 0,
            total_amount:   parseFloat(fd.get('total_amount') || '0') || 0,
            deposit:        parseFloat(fd.get('deposit') || '0') || 0,
            payment_method: fd.get('payment_method') || '',
            notes:          fd.get('notes') || '',
        };

        try {
            const res = await fetch(`${API_BASE}/walk-in-booking`, {
                method:  'POST',
                headers: Auth.headers(),
                body:    JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || err.error || `HTTP ${res.status}`);
            }
            UI.toast('Booking created successfully!', 'success');
            this._closeModal('qbModal');
            await this._reloadCalendarEvents();
        } catch (e) {
            console.error('[Calendar] submitQuickBook:', e);
            UI.toast(`Failed to create booking: ${e.message}`, 'error');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Booking'; }
        }
    },

    // ── Booking Detail modal ───────────────────────────────────────────────────
    _openDetailModal(booking) {
        if (!booking) return;
        const b = booking;

        const status = (b.status || b.booking_status || 'Unknown');
        const total   = parseFloat(b.total_amount || b.total || 0);
        const paid    = parseFloat(b.amount_paid  || b.deposit || 0);
        const balance = parseFloat(b.balance_due  || b.balance || (total - paid));

        // Determine badge class
        const statusLow = status.toLowerCase();
        let badgeClass = 'badge-pending';
        if (statusLow === 'paid' || balance <= 0)   badgeClass = 'badge-paid';
        else if (balance > 0 && paid > 0)            badgeClass = 'badge-balance';
        else if (statusLow.includes('cancel'))       badgeClass = 'badge-cancelled';

        const body = document.getElementById('detailBody');
        if (body) {
            body.innerHTML = `
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="lbl">Customer</span>
                        <span class="val">${esc(b.customer_name || '—')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="lbl">Status</span>
                        <span class="val"><span class="status-badge ${badgeClass}">${esc(status)}</span></span>
                    </div>
                    <div class="detail-item">
                        <span class="lbl">Email</span>
                        <span class="val">${b.email ? `<a href="mailto:${esc(b.email)}" style="color:var(--primary);">${esc(b.email)}</a>` : '—'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="lbl">Phone</span>
                        <span class="val">${b.phone ? `<a href="tel:${esc(b.phone)}" style="color:var(--primary);">${esc(b.phone)}</a>` : '—'}</span>
                    </div>
                    <hr class="detail-sep">
                    <div class="detail-item">
                        <span class="lbl">Room</span>
                        <span class="val">${esc(b.room_name || b.room || '—')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="lbl">Event Type</span>
                        <span class="val">${esc(b.event_type || b.event_type_name || '—')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="lbl">Date</span>
                        <span class="val">${fmtDate(b.date_from || b.booking_date || b.date)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="lbl">Time</span>
                        <span class="val">
                            ${b.start_time ? esc(b.start_time) : fmtTime(b.date_from)}
                            ${(b.end_time || b.date_to) ? ' – ' + (b.end_time ? esc(b.end_time) : fmtTime(b.date_to)) : ''}
                        </span>
                    </div>
                    <div class="detail-item">
                        <span class="lbl">Guests</span>
                        <span class="val">${esc(String(b.guests || b.num_guests || '—'))}</span>
                    </div>
                    <div class="detail-item">
                        <span class="lbl">Payment Method</span>
                        <span class="val">${esc(b.payment_method || '—')}</span>
                    </div>
                    <hr class="detail-sep">
                    <div class="detail-item">
                        <span class="lbl">Total Amount</span>
                        <span class="val" style="font-size:1.05rem;">${fmtCurrency(total)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="lbl">Amount Paid</span>
                        <span class="val" style="color:#10b981;">${fmtCurrency(paid)}</span>
                    </div>
                    <div class="detail-item span-2">
                        <span class="lbl">Balance Due</span>
                        <span class="val" style="color:${balance > 0 ? '#ef4444' : '#10b981'};font-weight:700;font-size:1.05rem;">${fmtCurrency(balance)}</span>
                    </div>
                    ${b.notes ? `<hr class="detail-sep"><div class="detail-item" style="grid-column:1/-1;"><span class="lbl">Notes</span><span class="val" style="white-space:pre-wrap;">${esc(b.notes)}</span></div>` : ''}
                </div>
            `;
        }

        // Footer: pay balance button if applicable
        const footer = document.getElementById('detailFooter');
        if (footer) {
            footer.innerHTML = '';
            if (balance > 0) {
                const payBtn = document.createElement('button');
                payBtn.type = 'button';
                payBtn.className = 'cal-toolbar-btn primary';
                payBtn.innerHTML = `<i class="fa-solid fa-sterling-sign"></i> Pay Balance`;
                payBtn.addEventListener('click', () => {
                    UI.toast('Use the Bookings page to take payment.', 'info');
                });
                footer.appendChild(payBtn);
            }
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'cal-toolbar-btn secondary';
            closeBtn.textContent = 'Close';
            closeBtn.addEventListener('click', () => this._closeModal('detailModal'));
            footer.appendChild(closeBtn);
        }

        this._openModal('detailModal');
    },

    // ── Blocked Dates modal ────────────────────────────────────────────────────
    async _openBlockModal() {
        this._openModal('blockModal');
        this._renderBlockedList(this._blockedRules);
        // Refresh from server
        const fresh = await this._fetchBlocked();
        this._blockedRules = fresh;
        this._renderBlockedList(fresh);
    },

    _renderBlockedList(rules) {
        const wrap = document.getElementById('blockedListWrap');
        if (!wrap) return;
        if (!rules.length) {
            wrap.innerHTML = '<p style="color:var(--text-muted);font-size:.875rem;">No blocked date rules yet.</p>';
            return;
        }
        const items = rules.map((r, i) => {
            const typeLabel = r.type === 'weekly' ? `Weekly — ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][r.day_of_week] || r.day_of_week}` :
                              r.type === 'range'  ? `Range: ${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` :
                              `One-off: ${fmtDate(r.date)}`;
            return `
                <li class="blocked-item">
                    <span>
                        <span style="font-weight:600;">${esc(r.label || 'Blocked')}</span>
                        <span class="blocked-meta"> · ${esc(typeLabel)}</span>
                    </span>
                    <button class="btn-icon-danger" data-idx="${i}" title="Delete rule" aria-label="Delete">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </li>`;
        }).join('');
        wrap.innerHTML = `<ul class="blocked-list">${items}</ul>`;

        wrap.querySelectorAll('.btn-icon-danger').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx, 10);
                this._deleteBlockedRule(idx);
            });
        });
    },

    _updateBlockFormFields() {
        const type = document.getElementById('blk-type')?.value;
        const rowDate  = document.getElementById('blk-row-date');
        const rowStart = document.getElementById('blk-row-start');
        const rowEnd   = document.getElementById('blk-row-end');
        const rowDow   = document.getElementById('blk-row-dow');

        if (rowDate)  rowDate.style.display  = type === 'oneoff' ? '' : 'none';
        if (rowStart) rowStart.style.display = type === 'range'  ? '' : 'none';
        if (rowEnd)   rowEnd.style.display   = type === 'range'  ? '' : 'none';
        if (rowDow)   rowDow.style.display   = type === 'weekly' ? '' : 'none';
    },

    async _submitBlockedRule() {
        const form = document.getElementById('blockForm');
        if (!form) return;

        const fd    = new FormData(form);
        const type  = fd.get('type') || 'oneoff';
        const label = fd.get('label') || '';

        const rule = { type, label, tenant_id: Auth.getTenantId() };

        if (type === 'oneoff') {
            const date = fd.get('date');
            if (!date) { UI.toast('Please select a date.', 'warning'); return; }
            rule.date = date;
        } else if (type === 'range') {
            const start = fd.get('start_date'), end = fd.get('end_date');
            if (!start || !end) { UI.toast('Please select start and end dates.', 'warning'); return; }
            rule.start_date = start;
            rule.end_date   = end;
        } else if (type === 'weekly') {
            rule.day_of_week = parseInt(fd.get('day_of_week') || '0', 10);
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving…'; }

        try {
            const res = await fetch(`${API_BASE}/blocked-dates`, {
                method:  'POST',
                headers: Auth.headers(),
                body:    JSON.stringify(rule),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || err.error || `HTTP ${res.status}`);
            }
            UI.toast('Blocked rule added.', 'success');
            form.reset();
            this._updateBlockFormFields();
            // Refresh
            this._blockedRules = await this._fetchBlocked();
            this._renderBlockedList(this._blockedRules);
            // Refresh calendar
            if (this._calendar) {
                this._calendar.removeAllEvents();
                this._buildFCEvents(this._selectedRoom).forEach(ev => this._calendar.addEvent(ev));
            }
        } catch (e) {
            console.error('[Calendar] submitBlockedRule:', e);
            UI.toast(`Failed to add rule: ${e.message}`, 'error');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Rule'; }
        }
    },

    async _deleteBlockedRule(idx) {
        const rule = this._blockedRules[idx];
        if (!rule) return;
        if (!confirm(`Delete blocked rule "${rule.label || 'this rule'}"?`)) return;

        const ruleId = rule.id || rule.rule_id;
        const payload = { tenant_id: Auth.getTenantId(), rule_id: ruleId, ...rule };

        try {
            // Try DELETE first, fall back to POST with _method
            let res = await fetch(`${API_BASE}/blocked-dates`, {
                method:  'DELETE',
                headers: Auth.headers(),
                body:    JSON.stringify(payload),
            });
            // Some n8n webhooks only accept POST; retry if needed
            if (!res.ok && res.status === 405) {
                res = await fetch(`${API_BASE}/blocked-dates`, {
                    method:  'POST',
                    headers: Auth.headers(),
                    body:    JSON.stringify({ ...payload, _action: 'delete' }),
                });
            }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || err.error || `HTTP ${res.status}`);
            }
            UI.toast('Blocked rule removed.', 'success');
            this._blockedRules = await this._fetchBlocked();
            this._renderBlockedList(this._blockedRules);
            // Refresh calendar
            if (this._calendar) {
                this._calendar.removeAllEvents();
                this._buildFCEvents(this._selectedRoom).forEach(ev => this._calendar.addEvent(ev));
            }
        } catch (e) {
            console.error('[Calendar] deleteBlockedRule:', e);
            UI.toast(`Failed to delete rule: ${e.message}`, 'error');
        }
    },
};

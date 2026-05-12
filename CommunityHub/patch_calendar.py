#!/usr/bin/env python3
"""Apply all qbModal + list-view + multiday-select patches to calendar.html"""

import re, sys

src = open('calendar.html', encoding='utf-8').read()
original = src  # keep for diff check

# ─────────────────────────────────────────────────────────────
# 1. LIST VIEW CSS – fix white text on white background
# ─────────────────────────────────────────────────────────────
OLD_LIST = (
    '        .fc-list{background:transparent !important}\n'
    '        .fc-list-table td{background:transparent !important;border-color:var(--border) !important;color:var(--text-main) !important}\n'
    '        .fc-list-event:hover td{background:rgba(99,102,241,0.07) !important}\n'
    '        .fc-list-day-cushion{background:#182235 !important}\n'
    '        .fc-list-day-text,.fc-list-day-side-text{color:var(--text-muted) !important}\n'
    '        .fc-list-event-title a{color:var(--text-main) !important;text-decoration:none}\n'
    '        .fc-list-event-time{color:var(--text-muted) !important}\n'
    '        .fc-list-empty{background:var(--bg-card) !important;color:var(--text-muted) !important}\n'
)
NEW_LIST = (
    '        .fc-list{background:#ffffff !important}\n'
    '        .fc-list-table td{background:transparent !important;border-color:rgba(0,0,0,0.08) !important;color:#1e293b !important}\n'
    '        .fc-list-event:hover td{background:rgba(99,102,241,0.06) !important}\n'
    '        .fc-list-day-cushion{background:#f1f5f9 !important}\n'
    '        .fc-list-day-text,.fc-list-day-side-text{color:#475569 !important}\n'
    '        .fc-list-event-title a{color:#1e293b !important;text-decoration:none}\n'
    '        .fc-list-event-time{color:#475569 !important}\n'
    '        .fc-list-empty{background:#ffffff !important;color:#475569 !important}\n'
)
assert src.count(OLD_LIST) == 1, f"list CSS: found {src.count(OLD_LIST)}"
src = src.replace(OLD_LIST, NEW_LIST)
print('✓ 1 list view CSS')

# ─────────────────────────────────────────────────────────────
# 2. QB MODAL CSS – replace simple styles with full set
# ─────────────────────────────────────────────────────────────
OLD_QB_CSS = (
    '        /* ── Quick Booking Modal ── */\n'
    '        .qb-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);z-index:4000;display:none;justify-content:center;align-items:flex-start;padding-top:2.5rem;overflow-y:auto}\n'
    '        .qb-overlay.open{display:flex}\n'
    '        .qb-card{background:#1e293b;border:1px solid var(--border);width:92%;max-width:560px;border-radius:20px;padding:2rem;box-shadow:0 30px 60px rgba(0,0,0,0.5);animation:slideUp 0.25s ease;margin-bottom:2rem}\n'
    '        .qb-title{font-size:1.1rem;font-weight:700;display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;padding-bottom:1rem;border-bottom:1px solid var(--border)}\n'
    '        .qb-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem}\n'
    '        .qb-full{grid-column:1/-1}\n'
    '        .qb-label{font-size:0.75rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px}\n'
    '        .qb-input,.qb-select{background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:8px;color:var(--text-main);padding:9px 12px;font-size:0.88rem;font-family:inherit;width:100%;outline:none;min-height:unset}\n'
    '        .qb-input:focus,.qb-select:focus{border-color:var(--primary)}\n'
    '        .qb-select option{background:#1e293b}\n'
    '        .qb-btn-row{display:flex;gap:10px;margin-top:1.25rem}\n'
    '        .qb-btn-submit{flex:1;background:var(--primary);border:none;color:white;padding:11px;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:0.9rem}\n'
    '        .qb-btn-submit:hover{background:#4f46e5}\n'
    '        .qb-btn-cancel{background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--text-muted);padding:11px 18px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:0.9rem;font-weight:600}\n'
    '        body.light-mode .qb-card{background:#fff;border-color:rgba(0,0,0,0.12);color:#0f172a}\n'
    '        body.light-mode .qb-input,body.light-mode .qb-select{background:rgba(0,0,0,0.04);border-color:rgba(0,0,0,0.15);color:#0f172a}\n'
)
NEW_QB_CSS = (
    '        /* ── Quick Booking Modal ── */\n'
    '        .qb-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);z-index:4000;display:none;justify-content:center;align-items:flex-start;padding-top:2.5rem;overflow-y:auto}\n'
    '        .qb-overlay.open{display:flex}\n'
    '        .qb-card{background:#1e293b;border:1px solid var(--border);width:92%;max-width:640px;border-radius:20px;padding:2rem;box-shadow:0 30px 60px rgba(0,0,0,0.5);animation:slideUp 0.25s ease;margin-bottom:2rem}\n'
    '        .qb-title{font-size:1.1rem;font-weight:700;display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border)}\n'
    '        .qb-section-label{font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin:1rem 0 0.5rem;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06)}\n'
    '        .qb-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem}\n'
    '        .qb-full{grid-column:1/-1}\n'
    '        .qb-label{font-size:0.75rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px}\n'
    '        .qb-input,.qb-select{background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:8px;color:var(--text-main);padding:9px 12px;font-size:0.88rem;font-family:inherit;width:100%;outline:none;min-height:unset}\n'
    '        .qb-input:focus,.qb-select:focus{border-color:var(--primary)}\n'
    '        .qb-select option{background:#1e293b}\n'
    '        .qb-avail-box{border-radius:8px;padding:9px 13px;font-size:0.83rem;margin-top:0.75rem}\n'
    '        .qb-avail-idle{background:rgba(255,255,255,0.04);color:var(--text-muted)}\n'
    '        .qb-avail-checking{background:rgba(99,102,241,0.12);color:#818cf8}\n'
    '        .qb-avail-available{background:rgba(16,185,129,0.12);color:#34d399}\n'
    '        .qb-avail-unavailable{background:rgba(239,68,68,0.12);color:#f87171}\n'
    '        .qb-cap-warning{background:rgba(245,158,11,0.12);color:#fbbf24;border-radius:8px;padding:7px 12px;font-size:0.82rem;margin-top:0.5rem}\n'
    '        .qb-payment-box{background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:1rem;margin-top:1rem}\n'
    '        .qb-total-display{display:flex;justify-content:space-between;align-items:center;font-size:1rem;margin-bottom:0.25rem}\n'
    '        .qb-total-display strong{font-size:1.3rem;color:#34d399}\n'
    '        .qb-breakdown{font-size:0.78rem;color:var(--text-muted);min-height:1.1em}\n'
    '        .qb-btn-row{display:flex;gap:10px;margin-top:0.75rem;flex-wrap:wrap}\n'
    '        .qb-btn-cancel{background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--text-muted);padding:11px 18px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:0.85rem;font-weight:600}\n'
    '        .qb-btn-deposit{flex:1;background:#6366f1;border:none;color:white;padding:11px 8px;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:0.82rem;white-space:nowrap}\n'
    '        .qb-btn-deposit:disabled,.qb-btn-full:disabled{opacity:0.4;cursor:not-allowed}\n'
    '        .qb-btn-full{flex:1;background:#10b981;border:none;color:white;padding:11px 8px;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:0.82rem}\n'
    '        .qb-btn-pending{flex:1;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--text-muted);padding:10px;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:0.85rem}\n'
    '        .qb-btn-pending:hover{border-color:var(--primary);color:var(--primary)}\n'
    '        body.light-mode .qb-card{background:#fff;border-color:rgba(0,0,0,0.12);color:#0f172a}\n'
    '        body.light-mode .qb-input,body.light-mode .qb-select{background:rgba(0,0,0,0.04);border-color:rgba(0,0,0,0.15);color:#0f172a}\n'
    '        body.light-mode .qb-section-label{color:#64748b;border-bottom-color:rgba(0,0,0,0.08)}\n'
    '        body.light-mode .qb-payment-box{background:rgba(0,0,0,0.03);border-color:rgba(0,0,0,0.08)}\n'
    '        body.light-mode .qb-avail-idle{background:rgba(0,0,0,0.04);color:#64748b}\n'
    '        body.light-mode .qb-total-display strong{color:#059669}\n'
)
assert src.count(OLD_QB_CSS) == 1, f"QB CSS: found {src.count(OLD_QB_CSS)}"
src = src.replace(OLD_QB_CSS, NEW_QB_CSS)
print('✓ 2 QB modal CSS')

# ─────────────────────────────────────────────────────────────
# 3. QB MODAL HTML – replace simple form with full form
# ─────────────────────────────────────────────────────────────
OLD_QB_HTML = (
    '    <!-- QUICK BOOKING REQUEST MODAL -->\n'
    '    <div id="qbModal" class="qb-overlay" onclick="if(event.target.id===\'qbModal\')closeQbModal()">\n'
    '        <div class="qb-card">\n'
    '            <div class="qb-title">\n'
    '                <span><i class="fa-solid fa-calendar-plus" style="color:var(--primary);margin-right:8px"></i> New Booking Request</span>\n'
    '                <button onclick="closeQbModal()" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer;min-height:unset">&times;</button>\n'
    '            </div>\n'
    '            <div class="qb-grid">\n'
    '                <div class="qb-full">\n'
    '                    <label class="qb-label">Customer Name *</label>\n'
    '                    <input type="text" id="qb-name" class="qb-input" placeholder="Full name">\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Email *</label>\n'
    '                    <input type="email" id="qb-email" class="qb-input" placeholder="email@example.com">\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Phone</label>\n'
    '                    <input type="tel" id="qb-phone" class="qb-input" placeholder="+44...">\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Room *</label>\n'
    '                    <select id="qb-room" class="qb-select">\n'
    '                        <option value="">Select room...</option>\n'
    '                    </select>\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Date *</label>\n'
    '                    <input type="date" id="qb-date" class="qb-input">\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Start Time</label>\n'
    '                    <input type="time" id="qb-start" class="qb-input" value="09:00">\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">End Time</label>\n'
    '                    <input type="time" id="qb-end" class="qb-input" value="17:00">\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Guests</label>\n'
    '                    <input type="number" id="qb-guests" class="qb-input" min="1" placeholder="e.g. 50">\n'
    '                </div>\n'
    '                <div class="qb-full">\n'
    '                    <label class="qb-label">Notes</label>\n'
    '                    <input type="text" id="qb-notes" class="qb-input" placeholder="Optional notes or requirements">\n'
    '                </div>\n'
    '            </div>\n'
    '            <div class="qb-btn-row">\n'
    '                <button class="qb-btn-cancel" onclick="closeQbModal()">Cancel</button>\n'
    '                <button class="qb-btn-submit" id="qb-submit-btn" onclick="submitBookingRequest()"><i class="fa-solid fa-paper-plane"></i> Submit Request</button>\n'
    '            </div>\n'
    '        </div>\n'
    '    </div>\n'
)
NEW_QB_HTML = (
    '    <!-- QUICK BOOKING REQUEST MODAL -->\n'
    '    <div id="qbModal" class="qb-overlay" onclick="if(event.target.id===\'qbModal\')closeQbModal()">\n'
    '        <div class="qb-card">\n'
    '            <div class="qb-title">\n'
    '                <span><i class="fa-solid fa-calendar-plus" style="color:var(--primary);margin-right:8px"></i> New Booking</span>\n'
    '                <button onclick="closeQbModal()" style="background:none;border:none;color:var(--text-muted);font-size:1.4rem;cursor:pointer;min-height:unset">&times;</button>\n'
    '            </div>\n'
    '            <div class="qb-section-label">Customer Details</div>\n'
    '            <div class="qb-grid">\n'
    '                <div class="qb-full">\n'
    '                    <label class="qb-label">Customer Name *</label>\n'
    '                    <input type="text" id="qb-customerName" class="qb-input" placeholder="Full name">\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Phone *</label>\n'
    '                    <input type="tel" id="qb-customerPhone" class="qb-input" placeholder="+44...">\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Email</label>\n'
    '                    <input type="email" id="qb-customerEmail" class="qb-input" placeholder="email@example.com">\n'
    '                </div>\n'
    '            </div>\n'
    '            <div class="qb-section-label">Event Details</div>\n'
    '            <div class="qb-grid">\n'
    '                <div>\n'
    '                    <label class="qb-label">Room *</label>\n'
    '                    <select id="qb-roomSelect" class="qb-select" onchange="qbOnRoomChange()">\n'
    '                        <option value="">Select room...</option>\n'
    '                    </select>\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Event Type</label>\n'
    '                    <select id="qb-eventType" class="qb-select" onchange="qbCalculateCost()">\n'
    '                        <option value="">Select type...</option>\n'
    '                    </select>\n'
    '                </div>\n'
    '                <div class="qb-full">\n'
    '                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.83rem;color:var(--text-muted);margin-bottom:8px">\n'
    '                        <input type="checkbox" id="qb-multiDayToggle" onchange="qbToggleMultiDay()" style="width:auto;margin:0">\n'
    '                        Multi-day booking\n'
    '                    </label>\n'
    '                    <div id="qb-single-date-row">\n'
    '                        <label class="qb-label">Date *</label>\n'
    '                        <input type="date" id="qb-eventDate" class="qb-input" onchange="qbOnDateChange()">\n'
    '                    </div>\n'
    '                    <div id="qb-multi-date-row" style="display:none;grid-template-columns:1fr 1fr;gap:0.75rem">\n'
    '                        <div>\n'
    '                            <label class="qb-label">From *</label>\n'
    '                            <input type="date" id="qb-dateFrom" class="qb-input" onchange="qbOnDateChange()">\n'
    '                        </div>\n'
    '                        <div>\n'
    '                            <label class="qb-label">To *</label>\n'
    '                            <input type="date" id="qb-dateTo" class="qb-input" onchange="qbOnDateChange()">\n'
    '                        </div>\n'
    '                    </div>\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Start Time *</label>\n'
    '                    <select id="qb-startTime" class="qb-select" onchange="qbOnDateChange()"></select>\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">End Time *</label>\n'
    '                    <select id="qb-endTime" class="qb-select" onchange="qbOnDateChange()"></select>\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Guests</label>\n'
    '                    <input type="number" id="qb-guestCount" class="qb-input" min="1" placeholder="e.g. 50" oninput="qbOnRoomChange()">\n'
    '                </div>\n'
    '                <div>\n'
    '                    <label class="qb-label">Notes</label>\n'
    '                    <input type="text" id="qb-notes" class="qb-input" placeholder="Optional notes or requirements">\n'
    '                </div>\n'
    '            </div>\n'
    '            <div id="qb-availStatus" class="qb-avail-box qb-avail-idle"><span id="qb-availText">Fill in room, date &amp; times to check availability.</span></div>\n'
    '            <div id="qb-guestCapWarning" class="qb-cap-warning" style="display:none"><i class="fa-solid fa-triangle-exclamation"></i> <span id="qb-guestCapMsg"></span></div>\n'
    '            <div class="qb-payment-box">\n'
    '                <div class="qb-section-label" style="margin-top:0">Payment</div>\n'
    '                <div class="qb-total-display">\n'
    '                    <span>Estimated Total</span>\n'
    '                    <strong id="qb-totalDisplay">\xa30.00</strong>\n'
    '                </div>\n'
    '                <div id="qb-costBreakdown" class="qb-breakdown"></div>\n'
    '                <div class="qb-grid" style="margin-top:0.75rem">\n'
    '                    <div>\n'
    '                        <label class="qb-label">Payment Method</label>\n'
    '                        <select id="qb-payMethodSelect" class="qb-select">\n'
    '                            <option value="Cash">Cash</option>\n'
    '                            <option value="Card">Card</option>\n'
    '                            <option value="Bank Transfer">Bank Transfer</option>\n'
    '                            <option value="Other">Other</option>\n'
    '                        </select>\n'
    '                    </div>\n'
    '                    <div>\n'
    '                        <label class="qb-label">Amount Paid (\xa3)</label>\n'
    '                        <input type="number" id="qb-payAmount" class="qb-input" min="0" step="0.01" placeholder="0.00">\n'
    '                    </div>\n'
    '                </div>\n'
    '                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.82rem;color:var(--text-muted);margin-top:0.6rem">\n'
    '                    <input type="checkbox" id="qb-overrideToggle" onchange="qbTogglePriceOverride()" style="width:auto;margin:0">\n'
    '                    Override price manually\n'
    '                </label>\n'
    '                <div id="qb-overrideRow" style="display:none;margin-top:6px">\n'
    '                    <label class="qb-label">Override Total (\xa3)</label>\n'
    '                    <input type="number" id="qb-overrideAmount" class="qb-input" min="0" step="0.01" placeholder="Enter custom total..." oninput="qbApplyOverride()">\n'
    '                </div>\n'
    '            </div>\n'
    '            <div class="qb-btn-row" style="margin-top:1rem">\n'
    '                <button class="qb-btn-cancel" onclick="closeQbModal()">Cancel</button>\n'
    '                <button class="qb-btn-deposit" id="qb-btn-deposit" onclick="qbSubmitBooking(\'deposit\')" disabled><i class="fa-solid fa-circle-half-stroke"></i> Deposit (<span id="qb-depositLabel">30%</span>)</button>\n'
    '                <button class="qb-btn-full" id="qb-btn-full" onclick="qbSubmitBooking(\'full\')" disabled><i class="fa-solid fa-check-circle"></i> Pay Full</button>\n'
    '            </div>\n'
    '            <div class="qb-btn-row">\n'
    '                <button class="qb-btn-pending" id="qb-btn-pending" onclick="qbSubmitBooking(\'pending\')" style="flex:1"><i class="fa-solid fa-paper-plane"></i> Submit as Pending Request</button>\n'
    '            </div>\n'
    '        </div>\n'
    '    </div>\n'
    '    <!-- qb Conflict Modal -->\n'
    '    <div id="qb-conflictModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:5000;justify-content:center;align-items:center">\n'
    '        <div style="background:#1e293b;border:1px solid #ef4444;border-radius:16px;padding:2rem;max-width:420px;width:92%;text-align:center">\n'
    '            <div style="font-size:2rem;margin-bottom:0.75rem">\u26a0\ufe0f</div>\n'
    '            <h3 style="color:#ef4444;margin:0 0 0.75rem">Date Conflict</h3>\n'
    '            <p style="color:var(--text-muted);margin:0 0 1.25rem">This date/time is already booked for the selected room.</p>\n'
    '            <button onclick="qbCloseConflictModal()" style="background:var(--primary);border:none;color:white;padding:10px 24px;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit">OK</button>\n'
    '        </div>\n'
    '    </div>\n'
)
assert src.count(OLD_QB_HTML) == 1, f"QB HTML: found {src.count(OLD_QB_HTML)}"
src = src.replace(OLD_QB_HTML, NEW_QB_HTML)
print('✓ 3 QB modal HTML')

# ─────────────────────────────────────────────────────────────
# 4. ADD API constants (CHECK, PRICING, TYPES, DEPOSIT_PCT)
# ─────────────────────────────────────────────────────────────
OLD_CONSTS = (
    "        const BOOKING_API='https://n8n.srv1090894.hstgr.cloud/webhook/walk-in-booking';\n"
    "        const DAY_NAMES=["
)
NEW_CONSTS = (
    "        const BOOKING_API='https://n8n.srv1090894.hstgr.cloud/webhook/walk-in-booking';\n"
    "        const CHECK_API='https://n8n.srv1090894.hstgr.cloud/webhook/check-availability';\n"
    "        const PRICING_API='https://n8n.srv1090894.hstgr.cloud/webhook/get-pricing';\n"
    "        const TYPES_API='https://n8n.srv1090894.hstgr.cloud/webhook/get-event-types';\n"
    "        const QBR_DEPOSIT_PCT=30;\n"
    "        const DAY_NAMES=["
)
assert src.count(OLD_CONSTS) == 1, f"consts: found {src.count(OLD_CONSTS)}"
src = src.replace(OLD_CONSTS, NEW_CONSTS)
print('✓ 4 API constants')

# ─────────────────────────────────────────────────────────────
# 5. REMOVE old qb-room populate block → replace with qbInit()
# ─────────────────────────────────────────────────────────────
OLD_ROOM_POP = (
    '                // Populate qb-room select from /get-rooms API\n'
    '                try{\n'
    '                    const rRes=await fetch(ROOMS_API,{headers:getAuthHeaders()});\n'
    '                    const rJson=await rRes.json();\n'
    '                    const rData=rJson.data||(Array.isArray(rJson)?rJson:[]);\n'
    "                    const qbRoomSel=document.getElementById('qb-room');\n"
    '                    rData.filter(r=>r.is_active||r.is_active===undefined).forEach(r=>{\n'
    "                        const o=document.createElement('option');o.value=r.name||r.room_name||r.id;o.textContent=r.name||r.room_name||r.id;qbRoomSel.appendChild(o);\n"
    '                    });\n'
    '                }catch(e){\n'
    '                    // Fallback: use room names already known from bookings\n'
    "                    const qbRoomSel=document.getElementById('qb-room');\n"
    "                    rooms.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;qbRoomSel.appendChild(o);});\n"
    '                }\n'
)
NEW_ROOM_POP = '                qbInit();\n'
assert src.count(OLD_ROOM_POP) == 1, f"room pop: found {src.count(OLD_ROOM_POP)}"
src = src.replace(OLD_ROOM_POP, NEW_ROOM_POP)
print('✓ 5 removed old room populate, added qbInit()')

# ─────────────────────────────────────────────────────────────
# 6. REPLACE openQbModal + closeQbModal + submitBookingRequest
# ─────────────────────────────────────────────────────────────
OLD_JS_FUNCS = (
    '        function openQbModal(dateStr){\n'
    "            document.getElementById('qb-date').value=dateStr||'';\n"
    "            ['qb-name','qb-email','qb-phone','qb-notes'].forEach(id=>{document.getElementById(id).value='';});\n"
    "            document.getElementById('qb-guests').value='';\n"
    "            document.getElementById('qb-start').value='09:00';\n"
    "            document.getElementById('qb-end').value='17:00';\n"
    "            const activeTab=document.querySelector('.room-tab.active');\n"
    "            if(activeTab&&activeTab.dataset.room)document.getElementById('qb-room').value=activeTab.dataset.room;\n"
    "            else document.getElementById('qb-room').value='';\n"
    "            document.getElementById('qbModal').classList.add('open');\n"
    '        }\n'
    "        function closeQbModal(){document.getElementById('qbModal').classList.remove('open');}\n"
    '\n'
    '        async function submitBookingRequest(){\n'
    "            const name=document.getElementById('qb-name').value.trim();\n"
    "            const email=document.getElementById('qb-email').value.trim();\n"
    "            const room=document.getElementById('qb-room').value;\n"
    "            const date=document.getElementById('qb-date').value;\n"
    "            if(!name||!email||!room||!date){showToast('Please fill in Name, Email, Room and Date','error');return;}\n"
    "            const btn=document.getElementById('qb-submit-btn');\n"
    '            btn.disabled=true;btn.innerHTML=\'<i class="fa-solid fa-spinner fa-spin"></i> Submitting...\';\n'
    '            const payload={\n'
    '                customer_name:name,customer_email:email,\n'
    "                customer_phone:document.getElementById('qb-phone').value.trim(),\n"
    '                room_name:room,booking_date:date,\n'
    "                start_time:document.getElementById('qb-start').value,\n"
    "                end_time:document.getElementById('qb-end').value,\n"
    "                guest_count:parseInt(document.getElementById('qb-guests').value)||null,\n"
    "                notes:document.getElementById('qb-notes').value.trim(),\n"
    "                status:'pending',created_by:'calendar'\n"
    '            };\n'
    '            try{\n'
    "                const res=await fetch(BOOKING_API,{method:'POST',headers:{...getAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify(payload)});\n"
    "                if(!res.ok)throw new Error('HTTP '+res.status);\n"
    '                closeQbModal();\n'
    "                showToast('Booking request submitted!','success');\n"
    '                setTimeout(()=>location.reload(),1500);\n'
    '            }catch(err){\n'
    "                showToast('Failed to submit: '+err.message,'error');\n"
    '            }finally{\n'
    '                btn.disabled=false;btn.innerHTML=\'<i class="fa-solid fa-paper-plane"></i> Submit Request\';\n'
    '            }\n'
    '        }\n'
)
NEW_JS_FUNCS = (
    '        let qbRoomsData=[],qbPricingData=[],_qbAvailTimeout=null,qbInitDone=false,qbTotalAmount=0,qbDepositAmount=0;\n'
    '        async function qbInit(){\n'
    '            if(qbInitDone)return;qbInitDone=true;\n'
    "            try{const r=await fetch(ROOMS_API,{headers:getAuthHeaders()});const rj=await r.json();qbRoomsData=(rj.data||(Array.isArray(rj)?rj:[])).filter(x=>x.is_active||x.is_active===undefined);const s=document.getElementById('qb-roomSelect');s.innerHTML='<option value=\"\">Select room...</option>';qbRoomsData.forEach(r=>{const o=document.createElement('option');o.value=r.name||r.room_name||r.id;o.textContent=r.name||r.room_name||r.id;s.appendChild(o);});}catch(e){}\n"
    "            try{const p=await fetch(PRICING_API,{headers:getAuthHeaders()});const pj=await p.json();qbPricingData=pj.data||(Array.isArray(pj)?pj:[]);}catch(e){}\n"
    "            try{const t=await fetch(TYPES_API,{headers:getAuthHeaders()});const tj=await t.json();const types=tj.data||(Array.isArray(tj)?tj:[]);const es=document.getElementById('qb-eventType');es.innerHTML='<option value=\"\">Select type...</option>';types.forEach(t=>{const o=document.createElement('option');o.value=t.name||t.type_name||t;o.textContent=t.name||t.type_name||t;es.appendChild(o);});}catch(e){}\n"
    "            const times=[];for(let h=8;h<24;h++)for(let m=0;m<60;m+=30)times.push(`${String(h).padStart(2,'0')}:${m===0?'00':'30'}`);\n"
    "            ['qb-startTime','qb-endTime'].forEach(id=>{const s=document.getElementById(id);s.innerHTML='';times.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;s.appendChild(o);});s.value=id.includes('start')?'09:00':'17:00';});\n"
    '        }\n'
    '        function openQbModal(startStr,endStr){\n'
    '            const isMulti=!!(endStr&&endStr!==startStr);\n'
    "            document.getElementById('qb-multiDayToggle').checked=isMulti;\n"
    '            qbToggleMultiDay();\n'
    "            if(isMulti){document.getElementById('qb-dateFrom').value=startStr||'';document.getElementById('qb-dateTo').value=endStr||'';}\n"
    "            else{document.getElementById('qb-eventDate').value=startStr||'';}\n"
    "            ['qb-customerName','qb-customerPhone','qb-customerEmail','qb-notes'].forEach(id=>{document.getElementById(id).value='';});\n"
    "            document.getElementById('qb-guestCount').value='';\n"
    "            document.getElementById('qb-overrideToggle').checked=false;\n"
    "            document.getElementById('qb-overrideRow').style.display='none';\n"
    "            document.getElementById('qb-overrideAmount').value='';\n"
    "            document.getElementById('qb-payAmount').value='';\n"
    "            document.getElementById('qb-totalDisplay').textContent='\xa30.00';\n"
    "            document.getElementById('qb-costBreakdown').textContent='';\n"
    "            const av=document.getElementById('qb-availStatus');av.className='qb-avail-box qb-avail-idle';\n"
    "            document.getElementById('qb-availText').textContent='Fill in room, date & times to check availability.';\n"
    "            document.getElementById('qb-guestCapWarning').style.display='none';\n"
    '            qbSetButtons(false);\n'
    "            const activeTab=document.querySelector('.room-tab.active');\n"
    "            qbInit().then(()=>{if(activeTab&&activeTab.dataset.room){document.getElementById('qb-roomSelect').value=activeTab.dataset.room;qbOnRoomChange();}});\n"
    "            document.getElementById('qbModal').classList.add('open');\n"
    '            if(startStr)setTimeout(qbCheckAvailability,350);\n'
    '        }\n'
    "        function closeQbModal(){document.getElementById('qbModal').classList.remove('open');}\n"
    "        function qbToggleMultiDay(){const m=document.getElementById('qb-multiDayToggle').checked;document.getElementById('qb-single-date-row').style.display=m?'none':'block';document.getElementById('qb-multi-date-row').style.display=m?'grid':'none';qbOnDateChange();}\n"
    '        function qbOnDateChange(){qbCalculateCost();qbCheckAvailability();}\n'
    "        function qbGetDates(){const m=document.getElementById('qb-multiDayToggle').checked;if(m)return{from:document.getElementById('qb-dateFrom').value,to:document.getElementById('qb-dateTo').value};const d=document.getElementById('qb-eventDate').value;return{from:d,to:d};}\n"
    '        function qbDayCount(from,to){if(!from||!to)return 1;const d=Math.round((new Date(to+\'T00:00:00\')-new Date(from+\'T00:00:00\'))/86400000)+1;return d>0?d:1;}\n'
    '        function qbOnRoomChange(){\n'
    "            const roomName=document.getElementById('qb-roomSelect').value;\n"
    "            const room=qbRoomsData.find(r=>(r.name||r.room_name||r.id)===roomName);\n"
    "            const guests=parseInt(document.getElementById('qb-guestCount').value)||0;\n"
    "            const warn=document.getElementById('qb-guestCapWarning');\n"
    "            if(room&&room.capacity&&guests>parseInt(room.capacity)){document.getElementById('qb-guestCapMsg').textContent=`Guest count (${guests}) exceeds room capacity (${room.capacity}).`;warn.style.display='block';}\n"
    "            else{warn.style.display='none';}\n"
    '            qbCalculateCost();qbCheckAvailability();\n'
    '        }\n'
    '        function qbCalculateCost(){\n'
    "            const roomName=document.getElementById('qb-roomSelect').value;\n"
    "            const eventType=document.getElementById('qb-eventType').value;\n"
    '            const{from,to}=qbGetDates();\n'
    "            if(!roomName||!from){document.getElementById('qb-totalDisplay').textContent='\xa30.00';document.getElementById('qb-costBreakdown').textContent='';qbTotalAmount=0;qbDepositAmount=0;return;}\n"
    "            const pricing=qbPricingData.find(p=>(p.room_name||p.name)===roomName);\n"
    "            if(!pricing){document.getElementById('qb-costBreakdown').textContent='No pricing found for this room.';return;}\n"
    '            const days=qbDayCount(from,to);\n'
    '            const fullRate=parseFloat(pricing.full_day_rate||0);\n'
    '            const halfRate=parseFloat(pricing.half_day_rate||0);\n'
    "            const startT=document.getElementById('qb-startTime').value||'09:00';\n"
    "            const endT=document.getElementById('qb-endTime').value||'17:00';\n"
    '            const[sh,sm]=startT.split(\':\').map(Number);const[eh,em]=endT.split(\':\').map(Number);\n'
    '            const hrs=(eh*60+em-sh*60-sm)/60;\n'
    '            const baseRate=hrs<=5?halfRate:fullRate;\n'
    '            let breakdown=hrs<=5?`Half-day: ${fmt(halfRate)}`:`Full-day: ${fmt(fullRate)}`;\n'
    '            if(days>1)breakdown+=` \xd7 ${days} days`;\n'
    '            let total=baseRate*days;\n'
    "            const typeRow=qbPricingData.find(p=>p.event_type===eventType);\n"
    '            if(typeRow&&typeRow.surcharge){const s=parseFloat(typeRow.surcharge)*days;if(s){total+=s;breakdown+=` + ${fmt(s)} surcharge`;}}\n'
    '            qbTotalAmount=total;qbDepositAmount=Math.round(total*QBR_DEPOSIT_PCT)/100;\n'
    "            document.getElementById('qb-totalDisplay').textContent=fmt(total);\n"
    "            document.getElementById('qb-costBreakdown').textContent=breakdown;\n"
    "            document.getElementById('qb-depositLabel').textContent=`${QBR_DEPOSIT_PCT}% = ${fmt(qbDepositAmount)}`;\n"
    "            if(!document.getElementById('qb-overrideToggle').checked)document.getElementById('qb-payAmount').value=qbDepositAmount.toFixed(2);\n"
    '        }\n'
    "        function qbTogglePriceOverride(){const on=document.getElementById('qb-overrideToggle').checked;document.getElementById('qb-overrideRow').style.display=on?'block':'none';if(!on)qbCalculateCost();}\n"
    "        function qbApplyOverride(){const v=parseFloat(document.getElementById('qb-overrideAmount').value)||0;qbTotalAmount=v;qbDepositAmount=Math.round(v*QBR_DEPOSIT_PCT)/100;document.getElementById('qb-totalDisplay').textContent=fmt(v);document.getElementById('qb-depositLabel').textContent=`${QBR_DEPOSIT_PCT}% = ${fmt(qbDepositAmount)}`;document.getElementById('qb-payAmount').value=qbDepositAmount.toFixed(2);}\n"
    "        function qbIsDateBlocked(dateStr){const d=new Date(dateStr+'T00:00:00');return allBlockedRules.some(r=>{if(r.block_type==='oneoff'&&r.block_date===dateStr)return true;if(r.block_type==='recurring'&&r.day_of_week!==undefined&&d.getDay()===parseInt(r.day_of_week))return true;if(r.block_type==='range'&&r.date_from&&r.date_to)return dateStr>=r.date_from.split('T')[0]&&dateStr<=r.date_to.split('T')[0];return false;});}\n"
    "        function qbSetButtons(enabled){['qb-btn-deposit','qb-btn-full'].forEach(id=>document.getElementById(id).disabled=!enabled);}\n"
    '        function qbCheckAvailability(){\n'
    '            clearTimeout(_qbAvailTimeout);\n'
    "            const roomName=document.getElementById('qb-roomSelect').value;\n"
    '            const{from}=qbGetDates();\n'
    "            const startT=document.getElementById('qb-startTime').value;\n"
    "            const endT=document.getElementById('qb-endTime').value;\n"
    "            const av=document.getElementById('qb-availStatus');\n"
    "            if(!roomName||!from||!startT||!endT){av.className='qb-avail-box qb-avail-idle';document.getElementById('qb-availText').textContent='Fill in room, date & times to check availability.';qbSetButtons(false);return;}\n"
    "            if(qbIsDateBlocked(from)){av.className='qb-avail-box qb-avail-unavailable';document.getElementById('qb-availText').textContent='This date is blocked.';qbSetButtons(false);return;}\n"
    "            av.className='qb-avail-box qb-avail-checking';document.getElementById('qb-availText').textContent='Checking availability\u2026';qbSetButtons(false);\n"
    '            _qbAvailTimeout=setTimeout(async()=>{\n'
    '                try{\n'
    "                    const res=await fetch(CHECK_API,{method:'POST',headers:{...getAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({roomName,eventDate:from,timeFrom:startT,timeTo:endT})});\n"
    '                    const json=await res.json();\n'
    "                    const ok=json.available===true||json.available==='true'||json.status==='available';\n"
    "                    const av2=document.getElementById('qb-availStatus');\n"
    "                    if(ok){av2.className='qb-avail-box qb-avail-available';document.getElementById('qb-availText').textContent='Available!';qbSetButtons(true);}\n"
    "                    else{av2.className='qb-avail-box qb-avail-unavailable';document.getElementById('qb-availText').textContent=json.message||'Not available for selected date/time.';qbSetButtons(false);}\n"
    "                }catch(e){const av2=document.getElementById('qb-availStatus');av2.className='qb-avail-box qb-avail-idle';document.getElementById('qb-availText').textContent='Could not check \u2014 please verify manually.';}\n"
    '            },500);\n'
    '        }\n'
    "        function qbShowConflictModal(){document.getElementById('qb-conflictModal').style.display='flex';}\n"
    "        function qbCloseConflictModal(){document.getElementById('qb-conflictModal').style.display='none';}\n"
    '        async function qbSubmitBooking(type){\n'
    "            const name=document.getElementById('qb-customerName').value.trim();\n"
    "            const phone=document.getElementById('qb-customerPhone').value.trim();\n"
    "            const email=document.getElementById('qb-customerEmail').value.trim();\n"
    "            const roomName=document.getElementById('qb-roomSelect').value;\n"
    '            const{from,to}=qbGetDates();\n'
    "            const startT=document.getElementById('qb-startTime').value;\n"
    "            const endT=document.getElementById('qb-endTime').value;\n"
    "            const guests=document.getElementById('qb-guestCount').value;\n"
    "            const eventType=document.getElementById('qb-eventType').value;\n"
    "            const notes=document.getElementById('qb-notes').value.trim();\n"
    "            const payMethod=document.getElementById('qb-payMethodSelect').value;\n"
    "            const payAmt=parseFloat(document.getElementById('qb-payAmount').value)||0;\n"
    "            if(!name||!phone){showToast('Customer name and phone are required','error');return;}\n"
    "            if(!roomName){showToast('Please select a room','error');return;}\n"
    "            if(!from){showToast('Please select a date','error');return;}\n"
    "            if(type!=='pending'&&qbIsDateBlocked(from)){showToast('This date is blocked','error');return;}\n"
    "            const room=qbRoomsData.find(r=>(r.name||r.room_name||r.id)===roomName);\n"
    "            const roomId=room?room.id:'';\n"
    '            const balance=Math.max(0,qbTotalAmount-payAmt);\n'
    "            const paymentType=type==='full'?'full':type==='deposit'?'deposit':'none';\n"
    "            const status=type==='pending'?'pending':'booked';\n"
    "            if(type!=='pending'){\n"
    "                try{const cr=await fetch(CHECK_API,{method:'POST',headers:{...getAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({roomName,eventDate:from,timeFrom:startT,timeTo:endT})});const cj=await cr.json();const avail=cj.available===true||cj.available==='true'||cj.status==='available';if(!avail){qbShowConflictModal();return;}}catch(e){}\n"
    '            }\n'
    "            const payload={customer_name:name,customer_email:email||null,customer_phone:phone,room_id:roomId||null,room_name:roomName,booking_date:from,date_from:from,date_to:to,start_time:startT,end_time:endT,guest_count:parseInt(guests)||null,event_type:eventType||null,notes:notes||null,total_amount:qbTotalAmount,payment_amount:payAmt,balance_due:balance,payment_type:paymentType,payment_method:payMethod,booking_source:'walk_in',status};\n"
    "            ['qb-btn-deposit','qb-btn-full','qb-btn-pending'].forEach(id=>document.getElementById(id).disabled=true);\n"
    '            try{\n'
    "                const res=await fetch(BOOKING_API,{method:'POST',headers:{...getAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify(payload)});\n"
    "                if(!res.ok)throw new Error('HTTP '+res.status);\n"
    "                closeQbModal();showToast('Booking created!','success');setTimeout(()=>location.reload(),1500);\n"
    "            }catch(err){showToast('Failed to submit: '+err.message,'error');}\n"
    "            finally{['qb-btn-deposit','qb-btn-full','qb-btn-pending'].forEach(id=>document.getElementById(id).disabled=false);qbSetButtons(true);}\n"
    '        }\n'
)
assert src.count(OLD_JS_FUNCS) == 1, f"JS funcs: found {src.count(OLD_JS_FUNCS)}"
src = src.replace(OLD_JS_FUNCS, NEW_JS_FUNCS)
print('✓ 6 replaced JS functions')

# ─────────────────────────────────────────────────────────────
# 7. ADD selectable + select callback to FullCalendar init
# ─────────────────────────────────────────────────────────────
OLD_EVENT_CLICK = '                    eventClick:function(info){openEventModal(info.event);}\n'
NEW_EVENT_CLICK = (
    '                    eventClick:function(info){openEventModal(info.event);},\n'
    '                    selectable:true,\n'
    '                    selectMirror:true,\n'
    "                    selectAllow:function(sel){const today=new Date();today.setHours(0,0,0,0);return new Date(sel.startStr+'T00:00:00')>=today;},\n"
    '                    select:function(info){\n'
    '                        const today=new Date();today.setHours(0,0,0,0);\n'
    "                        if(new Date(info.startStr+'T00:00:00')<today)return;\n"
    "                        const isBlocked=blockedBgEvents.some(b=>b.start===info.startStr);\n"
    "                        if(isBlocked){showToast('This date is blocked \u2014 manage via Blocked Dates','info');return;}\n"
    "                        const endD=new Date(new Date(info.endStr+'T00:00:00').getTime()-86400000);\n"
    "                        const endStr=`${endD.getFullYear()}-${String(endD.getMonth()+1).padStart(2,'0')}-${String(endD.getDate()).padStart(2,'0')}`;\n"
    '                        openQbModal(info.startStr,endStr);\n'
    '                    }\n'
)
assert src.count(OLD_EVENT_CLICK) == 1, f"eventClick: found {src.count(OLD_EVENT_CLICK)}"
src = src.replace(OLD_EVENT_CLICK, NEW_EVENT_CLICK)
print('✓ 7 selectable + select callback')

# ─────────────────────────────────────────────────────────────
# 8. UPDATE dateClick to pass two args
# ─────────────────────────────────────────────────────────────
OLD_DATE_CLICK = '                        openQbModal(info.dateStr);\n'
NEW_DATE_CLICK = '                        openQbModal(info.dateStr,info.dateStr);\n'
assert src.count(OLD_DATE_CLICK) == 1, f"dateClick call: found {src.count(OLD_DATE_CLICK)}"
src = src.replace(OLD_DATE_CLICK, NEW_DATE_CLICK)
print('✓ 8 dateClick updated')

# ─────────────────────────────────────────────────────────────
# WRITE OUTPUT
# ─────────────────────────────────────────────────────────────
open('calendar.html', 'w', encoding='utf-8').write(src)
print(f'\nDone. File size: {len(src)} bytes ({src.count(chr(10))} lines)')

import { Auth, API_BASE } from '../auth.js';
import { UI } from '../ui.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = n => n != null ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(parseFloat(n) || 0) : '—';
const tidParam = () => { const t = Auth.getTenantId(); return t ? `?tenant_id=${encodeURIComponent(t)}` : ''; };

// ── Module state ─────────────────────────────────────────────────────────────
let _rooms = [];
let _eventTypes = [];
let _pricing = [];
let _settings = [];
let _etPage = 1;
let _modalMode = null;
let _listeners = [];

const ET_PAGE_SIZE = 7;

const API = {
    getRooms:        () => `${API_BASE}/get-rooms${tidParam()}`,
    createRoom:      `${API_BASE}/create-room`,
    updateRoom:      `${API_BASE}/update-room`,
    deleteRoom:      `${API_BASE}/delete-room`,
    getEventTypes:   () => `${API_BASE}/get-event-types${tidParam()}`,
    createEventType: `${API_BASE}/create-event-type`,
    updateEventType: `${API_BASE}/update-event-type`,
    deleteEventType: `${API_BASE}/delete-event-type`,
    getPricing:      `${API_BASE}/get-pricing`,
    setPricing:      `${API_BASE}/set-pricing`,
    deletePricing:   `${API_BASE}/delete-pricing`,
    getSettings:     `${API_BASE}/get-settings`,
    updateSetting:   `${API_BASE}/update-setting`,
};

function withRole(obj) {
    const u = Auth.getUser();
    const tenantId = parseInt(Auth.getTenantId() || '0', 10) || undefined;
    return { ...obj, userRole: u.role || 'admin', tenant_id: tenantId, venue_id: tenantId };
}

function on(el, evt, fn) {
    if (!el) return;
    el.addEventListener(evt, fn);
    _listeners.push({ el, evt, fn });
}

// Room hours helpers (localStorage per tenant)
function roomHoursKey()   { return 'vp_room_hours_' + (Auth.getTenantId() || '0'); }
function loadRoomHours()  { try { return JSON.parse(localStorage.getItem(roomHoursKey()) || '{}'); } catch { return {}; } }
function saveRoomHours(d) { localStorage.setItem(roomHoursKey(), JSON.stringify(d)); }

// Services helpers (localStorage per tenant)
function servicesKey()         { return 'vp_services_' + (Auth.getTenantId() || '0'); }
function loadServicesData()    { try { return JSON.parse(localStorage.getItem(servicesKey()) || '[]'); } catch { return []; } }
function saveServicesData(d)   { localStorage.setItem(servicesKey(), JSON.stringify(d)); }

function generateTimeOptions() {
    const opts = ['<option value="">— Not set —</option>'];
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 30) {
            const t = `${String(h).padStart(2, '0')}:${m === 0 ? '00' : '30'}`;
            opts.push(`<option value="${t}">${t}</option>`);
        }
    }
    return opts.join('');
}

// ── Export ───────────────────────────────────────────────────────────────────
export default {
    title: 'Config Manager',

    css: `
/* ── Admin Config page ──────────────────────────────────────────────── */
#cfg-page { animation: cfg-fadeUp 0.3s ease both; }
@keyframes cfg-fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }

/* Header */
.cfg-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.75rem; padding-bottom:1.5rem; border-bottom:1px solid var(--border); flex-wrap:wrap; gap:1rem; }
.cfg-title { font-size:1.75rem; font-weight:800; letter-spacing:-0.03em; background:linear-gradient(135deg,var(--text-main) 0%,#a5b4fc 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }

/* Tab bar */
.cfg-tab-bar { display:flex; gap:8px; margin-bottom:2rem; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:6px; width:fit-content; flex-wrap:wrap; }
.cfg-tab-btn { padding:10px 24px; border:none; border-radius:8px; background:transparent; color:var(--text-muted); font-weight:600; cursor:pointer; transition:all 0.2s; font-size:0.9rem; white-space:nowrap; min-height:unset; }
.cfg-tab-btn.active { background:var(--primary); color:#fff; }
.cfg-tab-panel { display:none; }
.cfg-tab-panel.active { display:block; }

/* Cards */
.cfg-card { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:2rem; box-shadow:0 10px 30px rgba(0,0,0,0.3); transition:transform 0.22s ease,border-color 0.22s ease,box-shadow 0.22s ease; }
.cfg-card:hover { transform:translateY(-2px); border-color:rgba(99,120,186,0.34); box-shadow:0 16px 44px rgba(0,0,0,0.5); }
.cfg-card-title { font-size:1.1rem; font-weight:700; border-bottom:1px solid var(--border); padding-bottom:1rem; margin-bottom:1.5rem; display:flex; align-items:center; gap:10px; color:var(--text-main); }
.cfg-grid-split { display:grid; grid-template-columns:1fr 1.6fr; gap:2rem; }

/* Forms */
.cfg-input-group { margin-bottom:1rem; }
.cfg-input-group label { display:block; color:var(--text-muted); font-size:0.8rem; font-weight:600; text-transform:uppercase; margin-bottom:0.5rem; }
.cfg-input-group input[type=text],
.cfg-input-group input[type=number],
.cfg-input-group input[type=password],
.cfg-input-group textarea,
.cfg-input-group select { width:100%; padding:11px 14px; background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:10px; color:var(--text-main); outline:none; font-size:0.95rem; transition:border 0.3s; font-family:inherit; min-height:44px; }
.cfg-input-group input:focus,
.cfg-input-group textarea:focus,
.cfg-input-group select:focus { border-color:var(--primary); }
.cfg-input-group textarea { resize:vertical; min-height:70px; }
.cfg-input-group select option { background:#1e293b; }
.cfg-row2 { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
.cfg-btn { width:100%; padding:13px; border:none; border-radius:10px; font-weight:700; cursor:pointer; transition:0.2s; font-size:0.95rem; margin-top:0.5rem; min-height:44px; }
.cfg-btn-primary { background:var(--primary); color:#fff; }
.cfg-btn-primary:hover { background:#4f46e5; }
.cfg-btn-primary:disabled { opacity:0.6; cursor:not-allowed; }
.cfg-btn-warning { background:rgba(245,158,11,0.2); color:var(--warning); border:1px solid rgba(245,158,11,0.3); }
.cfg-btn-warning:hover { background:var(--warning); color:#0f172a; }

/* Tables */
.cfg-table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.cfg-table-wrap table { width:100%; border-collapse:collapse; min-width:420px; }
.cfg-table-wrap th { text-align:left; padding:0.85rem 1rem; color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; border-bottom:1px solid var(--border); white-space:nowrap; }
.cfg-table-wrap td { padding:0.85rem 1rem; border-bottom:1px solid var(--border); font-size:0.9rem; vertical-align:middle; }
.cfg-table-wrap tr:last-child td { border-bottom:none; }
.cfg-inactive-row { opacity:0.45; }
.cfg-status-badge { padding:3px 9px; border-radius:20px; font-size:0.72rem; font-weight:700; text-transform:uppercase; }
.cfg-status-active   { background:rgba(16,185,129,0.15); color:var(--success); }
.cfg-status-inactive { background:rgba(239,68,68,0.15); color:var(--danger); }
.cfg-action-btns { display:flex; gap:6px; justify-content:flex-end; }
.cfg-btn-sm { padding:5px 11px; border:none; border-radius:6px; cursor:pointer; font-size:0.78rem; font-weight:700; transition:0.2s; min-height:unset; }
.cfg-btn-edit    { background:rgba(99,102,241,0.2); color:var(--primary); }
.cfg-btn-edit:hover    { background:var(--primary); color:#fff; }
.cfg-btn-delete  { background:rgba(239,68,68,0.2); color:var(--danger); }
.cfg-btn-delete:hover  { background:var(--danger); color:#fff; }
.cfg-btn-restore { background:rgba(16,185,129,0.2); color:var(--success); }
.cfg-btn-restore:hover { background:var(--success); color:#fff; }
.cfg-btn-page { background:none; border:1px solid var(--border); color:var(--text-muted); padding:6px 16px; border-radius:6px; cursor:pointer; font-size:0.85rem; font-weight:600; transition:0.2s; min-height:unset; }
.cfg-btn-page:hover:not(:disabled) { color:var(--text-main); border-color:var(--text-main); }
.cfg-btn-page:disabled { opacity:0.3; cursor:not-allowed; }

/* Pricing grid */
.cfg-pricing-table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.cfg-pricing-grid { border-collapse:collapse; min-width:600px; }
.cfg-pricing-grid th,
.cfg-pricing-grid td { padding:10px 14px; border:1px solid var(--border); text-align:center; }
.cfg-pricing-grid th:first-child { text-align:left; min-width:140px; }
.cfg-pricing-grid thead th { color:var(--text-muted); font-size:0.75rem; text-transform:uppercase; background:rgba(0,0,0,0.2); }
.cfg-pricing-cell { position:relative; }
.cfg-price-input { width:90px; padding:5px 8px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; color:var(--text-main); font-size:0.85rem; text-align:center; outline:none; min-height:unset; }
.cfg-price-input:focus { border-color:var(--primary); }
.cfg-price-input.unsaved { border-color:var(--warning); }
.cfg-del-price-btn { position:absolute; top:3px; right:3px; background:rgba(239,68,68,0.15); color:var(--danger); border:none; border-radius:4px; width:18px; height:18px; font-size:0.65rem; cursor:pointer; display:none; align-items:center; justify-content:center; line-height:1; transition:background 0.15s; padding:0; min-height:unset; }
.cfg-del-price-btn:hover { background:var(--danger); color:#fff; }
.cfg-pricing-cell:hover .cfg-del-price-btn { display:flex; }
.cfg-room-label { font-weight:600; text-align:left !important; color:var(--text-main); }
.cfg-rate-default { font-size:0.7rem; color:var(--text-muted); display:block; margin-top:2px; }

/* Modal */
.cfg-modal-overlay { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.65); z-index:200; backdrop-filter:blur(3px); align-items:center; justify-content:center; }
.cfg-modal-overlay.open { display:flex; }
.cfg-modal { background:#1e293b; border:1px solid var(--border); border-radius:16px; padding:2rem; width:100%; max-width:480px; max-height:90vh; overflow-y:auto; }
.cfg-modal-title { font-size:1.1rem; font-weight:700; margin-bottom:1.5rem; display:flex; justify-content:space-between; align-items:center; color:var(--text-main); }
.cfg-modal-close { background:none; border:none; color:var(--text-muted); font-size:1.2rem; cursor:pointer; min-height:unset; }
.cfg-modal-close:hover { color:var(--text-main); }
.cfg-toggle-row { display:flex; align-items:center; justify-content:space-between; padding:10px 0; }
.cfg-toggle-label { font-size:0.9rem; color:var(--text-muted); }
.cfg-toggle { width:44px; height:24px; background:rgba(148,163,184,0.2); border-radius:12px; border:none; cursor:pointer; position:relative; transition:0.3s; min-height:unset; }
.cfg-toggle::after { content:''; position:absolute; width:18px; height:18px; background:#fff; border-radius:50%; top:3px; left:3px; transition:0.3s; }
.cfg-toggle.on { background:var(--success); }
.cfg-toggle.on::after { left:23px; }

/* Settings */
.cfg-buffer-info { font-size:0.82rem; color:var(--text-muted); margin-bottom:1rem; padding:8px 12px; background:rgba(0,0,0,0.2); border-radius:8px; }

/* Light mode overrides */
body.light-mode .cfg-card { background:rgba(255,255,255,0.9); border-color:rgba(0,0,0,0.08); }
body.light-mode .cfg-tab-bar { background:rgba(255,255,255,0.9); border-color:rgba(0,0,0,0.08); }
body.light-mode .cfg-modal { background:#fff; }
body.light-mode .cfg-input-group input,
body.light-mode .cfg-input-group textarea,
body.light-mode .cfg-input-group select { background:rgba(0,0,0,0.04); color:#1e293b; border-color:rgba(0,0,0,0.15); }
body.light-mode .cfg-input-group select option { background:#fff; color:#1e293b; }
body.light-mode .cfg-table-wrap td,
body.light-mode .cfg-table-wrap th { color:#1e293b; }
body.light-mode .cfg-price-input { background:rgba(0,0,0,0.05); color:#1e293b; }
body.light-mode .cfg-buffer-info { background:rgba(0,0,0,0.05); }
body.light-mode .cfg-pricing-grid thead th { background:rgba(0,0,0,0.05); }

/* Responsive */
@media (max-width:900px) { .cfg-grid-split { grid-template-columns:1fr; } }
@media (max-width:768px) {
    .cfg-tab-bar { width:100%; }
    .cfg-tab-btn { padding:8px 14px; font-size:0.82rem; }
    .cfg-modal { width:95vw; max-width:95vw; }
    .cfg-row2 { grid-template-columns:1fr; }
}
@media (max-width:480px) {
    .cfg-card { padding:1rem; }
    .cfg-tab-btn { font-size:0.78rem; padding:7px 10px; }
}
`,

    render() {
        return `
<div id="cfg-page">
    <!-- Header -->
    <div class="cfg-header">
        <h1 class="cfg-title"><i class="fa-solid fa-sliders" style="color:var(--primary);margin-right:10px;-webkit-text-fill-color:unset;"></i>Config Manager</h1>
    </div>

    <!-- Tab Bar -->
    <div class="cfg-tab-bar">
        <button class="cfg-tab-btn active" data-tab="rooms"><i class="fa-solid fa-door-open"></i> Rooms</button>
        <button class="cfg-tab-btn" data-tab="events"><i class="fa-solid fa-calendar-star"></i> Event Types</button>
        <button class="cfg-tab-btn" data-tab="pricing"><i class="fa-solid fa-sterling-sign"></i> Pricing Grid</button>
        <button class="cfg-tab-btn" data-tab="services"><i class="fa-solid fa-concierge-bell"></i> Services</button>
        <button class="cfg-tab-btn" data-tab="settings"><i class="fa-solid fa-gear"></i> Settings</button>
    </div>

    <!-- ROOMS TAB -->
    <div class="cfg-tab-panel active" id="cfg-tab-rooms">
        <div class="cfg-grid-split">
            <div class="cfg-card">
                <div class="cfg-card-title"><i class="fa-solid fa-plus"></i> Add Room</div>
                <div class="cfg-input-group"><label>Room Name</label><input type="text" id="cfg-rName" placeholder="e.g. Garden Suite"></div>
                <div class="cfg-row2">
                    <div class="cfg-input-group"><label>Capacity</label><input type="number" id="cfg-rCapacity" placeholder="e.g. 80" min="1"></div>
                    <div class="cfg-input-group"><label>Hourly Rate (£)</label><input type="number" id="cfg-rDayRate" placeholder="e.g. 45" min="0" step="0.01"></div>
                </div>
                <div class="cfg-row2">
                    <div class="cfg-input-group"><label>Open Time <span style="font-size:0.75rem;opacity:0.6">optional</span></label><select id="cfg-rOpenTime"></select></div>
                    <div class="cfg-input-group"><label>Close Time <span style="font-size:0.75rem;opacity:0.6">optional</span></label><select id="cfg-rCloseTime"></select></div>
                </div>
                <div class="cfg-input-group"><label>Description</label><textarea id="cfg-rDesc" placeholder="Short description of facilities..."></textarea></div>
                <button class="cfg-btn cfg-btn-primary" id="cfg-addRoomBtn"><i class="fa-solid fa-plus"></i> Add Room</button>
            </div>
            <div class="cfg-card">
                <div class="cfg-card-title"><i class="fa-solid fa-door-open"></i> Rooms</div>
                <div class="cfg-table-wrap">
                    <table>
                        <thead><tr>
                            <th>Name</th><th>Cap.</th><th>Hourly Rate</th><th>Hours</th><th>Status</th><th style="text-align:right">Actions</th>
                        </tr></thead>
                        <tbody id="cfg-roomsTable"><tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">Loading...</td></tr></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <!-- EVENT TYPES TAB -->
    <div class="cfg-tab-panel" id="cfg-tab-events">
        <div class="cfg-grid-split">
            <div class="cfg-card">
                <div class="cfg-card-title"><i class="fa-solid fa-plus"></i> Add Event Type</div>
                <div class="cfg-input-group"><label>Event Type Name</label><input type="text" id="cfg-etName" placeholder="e.g. Corporate"></div>
                <div class="cfg-input-group"><label>Description <span style="font-size:0.75rem;opacity:0.6">optional</span></label><textarea id="cfg-etDesc" placeholder="e.g. Business meetings and conferences"></textarea></div>
                <button class="cfg-btn cfg-btn-primary" id="cfg-addEventTypeBtn"><i class="fa-solid fa-plus"></i> Add Event Type</button>
            </div>
            <div class="cfg-card">
                <div class="cfg-card-title"><i class="fa-solid fa-calendar-star"></i> Event Types</div>
                <div class="cfg-table-wrap">
                    <table>
                        <thead><tr>
                            <th>Name</th><th>Description</th><th>Status</th><th style="text-align:right">Actions</th>
                        </tr></thead>
                        <tbody id="cfg-eventTypesTable"><tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted)">Loading...</td></tr></tbody>
                    </table>
                </div>
                <div id="cfg-et-pagination" style="display:none;align-items:center;justify-content:space-between;padding:10px 4px 0">
                    <button class="cfg-btn-page" id="cfg-et-prev">&#8249; Prev</button>
                    <span id="cfg-et-page-info" style="font-size:0.85rem;color:var(--text-muted)"></span>
                    <button class="cfg-btn-page" id="cfg-et-next">Next &#8250;</button>
                </div>
            </div>
        </div>
    </div>

    <!-- PRICING GRID TAB -->
    <div class="cfg-tab-panel" id="cfg-tab-pricing">
        <div class="cfg-card">
            <div class="cfg-card-title">
                <i class="fa-solid fa-sterling-sign"></i> Price Override Grid
                <span style="font-size:0.78rem;font-weight:400;color:var(--text-muted);margin-left:auto">Set custom hourly rates per room + event type. Blank = uses room default hourly rate.</span>
            </div>
            <div class="cfg-pricing-table-wrap" id="cfg-pricingGridWrap">
                <p style="color:var(--text-muted);text-align:center;padding:2rem">Loading...</p>
            </div>
        </div>
    </div>

    <!-- SERVICES TAB -->
    <div class="cfg-tab-panel" id="cfg-tab-services">
        <div class="cfg-grid-split">
            <div class="cfg-card">
                <div class="cfg-card-title"><i class="fa-solid fa-plus"></i> Add Service</div>
                <div class="cfg-input-group"><label>Service Name</label><input type="text" id="cfg-svcName" placeholder="e.g. OHP / Projector, DJ, Catering"></div>
                <div class="cfg-row2">
                    <div class="cfg-input-group"><label>Pricing Type</label>
                        <select id="cfg-svcType"><option value="flat">Flat Rate</option><option value="hourly">Per Hour</option></select>
                    </div>
                    <div class="cfg-input-group"><label>Price (£)</label><input type="number" id="cfg-svcPrice" placeholder="e.g. 50" min="0" step="0.01"></div>
                </div>
                <button class="cfg-btn cfg-btn-primary" id="cfg-addSvcBtn"><i class="fa-solid fa-plus"></i> Add Service</button>
            </div>
            <div class="cfg-card">
                <div class="cfg-card-title"><i class="fa-solid fa-concierge-bell"></i> Services</div>
                <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:1rem;line-height:1.6">Services appear as optional add-ons when confirming bookings in the Calendar and Dashboard.</p>
                <div class="cfg-table-wrap">
                    <table>
                        <thead><tr>
                            <th>Service</th><th>Type</th><th>Price</th><th>Status</th><th style="text-align:right">Actions</th>
                        </tr></thead>
                        <tbody id="cfg-servicesTable"><tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted)">No services defined yet.</td></tr></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <!-- SETTINGS TAB -->
    <div class="cfg-tab-panel" id="cfg-tab-settings">
        <div class="cfg-card" style="max-width:580px">
            <div class="cfg-card-title"><i class="fa-solid fa-clock-rotate-left"></i> Booking Turnaround Buffer</div>
            <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:1.5rem;line-height:1.6">
                The minimum gap required between back-to-back bookings in the same room.
                A new booking cannot start within this buffer period after an existing booking ends,
                and cannot end within this buffer period before an existing booking starts.
            </p>
            <div class="cfg-input-group">
                <label>Buffer Time</label>
                <select id="cfg-bufferSelect">
                    <option value="0">No buffer (bookings can be back-to-back)</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes (recommended)</option>
                    <option value="90">90 minutes</option>
                    <option value="120">2 hours</option>
                    <option value="custom">Custom...</option>
                </select>
            </div>
            <div class="cfg-input-group" id="cfg-customBufferGroup" style="display:none">
                <label>Custom Buffer (minutes)</label>
                <input type="number" id="cfg-customBufferInput" min="0" max="480" step="5" placeholder="e.g. 75">
            </div>
            <div class="cfg-buffer-info" id="cfg-bufferCurrentInfo">
                <i class="fa-solid fa-circle-info"></i> <span id="cfg-bufferCurrentText">Loading current setting...</span>
            </div>
            <button class="cfg-btn cfg-btn-primary" id="cfg-saveBufferBtn"><i class="fa-solid fa-floppy-disk"></i> Save Buffer Setting</button>
        </div>
    </div>

    <!-- EDIT MODAL -->
    <div class="cfg-modal-overlay" id="cfg-editModal">
        <div class="cfg-modal">
            <div class="cfg-modal-title">
                <span id="cfg-modalTitle">Edit</span>
                <button class="cfg-modal-close" id="cfg-modalCloseBtn"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="cfg-modalBody"></div>
            <button class="cfg-btn cfg-btn-primary" id="cfg-modalSaveBtn" style="margin-top:1.5rem;">
                <i class="fa-solid fa-floppy-disk"></i> Save Changes
            </button>
        </div>
    </div>
</div>
`;
    },

    async init() {
        const self = this;

        // Populate time selects
        const timeOpts = generateTimeOptions();
        const rOpenTime = document.getElementById('cfg-rOpenTime');
        const rCloseTime = document.getElementById('cfg-rCloseTime');
        if (rOpenTime) rOpenTime.innerHTML = timeOpts;
        if (rCloseTime) rCloseTime.innerHTML = timeOpts;

        // Tab switching
        const tabBar = document.querySelector('.cfg-tab-bar');
        if (tabBar) {
            on(tabBar, 'click', e => {
                const btn = e.target.closest('.cfg-tab-btn');
                if (!btn) return;
                const tab = btn.dataset.tab;
                document.querySelectorAll('.cfg-tab-panel').forEach(p => p.classList.remove('active'));
                document.querySelectorAll('.cfg-tab-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('cfg-tab-' + tab).classList.add('active');
                btn.classList.add('active');
                if (tab === 'pricing') self._renderPricingGrid();
                if (tab === 'services') self._renderServicesTable();
                if (tab === 'settings') self._loadSettings();
            });
        }

        // Add Room button
        on(document.getElementById('cfg-addRoomBtn'), 'click', () => self._addRoom());

        // Add Event Type button
        on(document.getElementById('cfg-addEventTypeBtn'), 'click', () => self._addEventType());

        // Add Service button
        on(document.getElementById('cfg-addSvcBtn'), 'click', () => self._addService());

        // Buffer select change
        on(document.getElementById('cfg-bufferSelect'), 'change', () => self._handleBufferSelectChange());

        // Save buffer button
        on(document.getElementById('cfg-saveBufferBtn'), 'click', () => self._saveBufferSetting());

        // Modal close button
        on(document.getElementById('cfg-modalCloseBtn'), 'click', () => self._closeModal());

        // Modal overlay click to close
        on(document.getElementById('cfg-editModal'), 'click', e => { if (e.target === document.getElementById('cfg-editModal')) self._closeModal(); });

        // Modal save button
        on(document.getElementById('cfg-modalSaveBtn'), 'click', () => self._saveModal());

        // Rooms table delegation
        on(document.getElementById('cfg-roomsTable'), 'click', e => {
            const editBtn    = e.target.closest('[data-action="edit-room"]');
            const deleteBtn  = e.target.closest('[data-action="delete-room"]');
            const restoreBtn = e.target.closest('[data-action="restore-room"]');
            if (editBtn)    self._editRoom(editBtn.dataset.id);
            if (deleteBtn)  self._softDeleteRoom(deleteBtn.dataset.id, deleteBtn.dataset.name);
            if (restoreBtn) self._restoreRoom(restoreBtn.dataset.id, restoreBtn.dataset.name);
        });

        // Event types table delegation
        on(document.getElementById('cfg-eventTypesTable'), 'click', e => {
            const editBtn    = e.target.closest('[data-action="edit-et"]');
            const deleteBtn  = e.target.closest('[data-action="delete-et"]');
            const restoreBtn = e.target.closest('[data-action="restore-et"]');
            if (editBtn)    self._editEventType(editBtn.dataset.id);
            if (deleteBtn)  self._softDeleteEventType(deleteBtn.dataset.id, deleteBtn.dataset.name);
            if (restoreBtn) self._restoreEventType(restoreBtn.dataset.id, restoreBtn.dataset.name);
        });

        // ET pagination
        on(document.getElementById('cfg-et-prev'), 'click', () => { _etPage = Math.max(1, _etPage - 1); self._renderEventTypesTable(); });
        on(document.getElementById('cfg-et-next'), 'click', () => { _etPage = _etPage + 1; self._renderEventTypesTable(); });

        // Services table delegation
        on(document.getElementById('cfg-servicesTable'), 'click', e => {
            const editBtn      = e.target.closest('[data-action="edit-svc"]');
            const toggleOffBtn = e.target.closest('[data-action="toggle-svc-off"]');
            const toggleOnBtn  = e.target.closest('[data-action="toggle-svc-on"]');
            const deleteBtn    = e.target.closest('[data-action="delete-svc"]');
            if (editBtn)      self._editServiceItem(editBtn.dataset.id);
            if (toggleOffBtn) self._toggleService(toggleOffBtn.dataset.id, false);
            if (toggleOnBtn)  self._toggleService(toggleOnBtn.dataset.id, true);
            if (deleteBtn)    self._deleteSvc(deleteBtn.dataset.id);
        });

        // Escape key closes modal
        on(document, 'keydown', e => { if (e.key === 'Escape') self._closeModal(); });

        // Load data
        await Promise.all([this._loadRooms(), this._loadEventTypes(), this._loadPricing(), this._loadSettings()]);
    },

    destroy() {
        _listeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
        _listeners = [];
        _rooms = [];
        _eventTypes = [];
        _pricing = [];
        _settings = [];
        _etPage = 1;
        _modalMode = null;
    },

    // ── Rooms ─────────────────────────────────────────────────────────────────

    async _loadRooms() {
        try {
            const res = await fetch(API.getRooms(), { headers: Auth.headers() });
            const text = await res.text();
            const json = text.trim() ? JSON.parse(text) : {};
            _rooms = json.data || (Array.isArray(json) ? json : []);
            this._renderRoomsTable();
        } catch (e) {
            const tb = document.getElementById('cfg-roomsTable');
            if (tb) tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger)">Failed to load rooms</td></tr>';
        }
    },

    _renderRoomsTable() {
        const tbody = document.getElementById('cfg-roomsTable');
        if (!tbody) return;
        if (!_rooms.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No rooms found.</td></tr>';
            return;
        }
        const rHours = loadRoomHours();
        tbody.innerHTML = _rooms.map(r => {
            const rh = rHours[r.id] || {};
            const hoursStr = (rh.open && rh.close) ? `${rh.open}–${rh.close}` : '—';
            return `
            <tr class="${!r.is_active ? 'cfg-inactive-row' : ''}">
                <td style="font-weight:600;color:var(--text-main)">${esc(r.name)}</td>
                <td style="color:var(--text-muted)">${r.capacity || '—'}</td>
                <td>${fmt(r.day_rate)}<span style="font-size:0.72rem;color:var(--text-muted)">/hr</span></td>
                <td style="color:var(--text-muted);font-size:0.85rem">${hoursStr}</td>
                <td><span class="cfg-status-badge ${r.is_active ? 'cfg-status-active' : 'cfg-status-inactive'}">${r.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <div class="cfg-action-btns">
                        <button class="cfg-btn-sm cfg-btn-edit" data-action="edit-room" data-id="${r.id}"><i class="fa-solid fa-pen"></i></button>
                        ${r.is_active
                            ? `<button class="cfg-btn-sm cfg-btn-delete" data-action="delete-room" data-id="${r.id}" data-name="${esc(r.name)}"><i class="fa-solid fa-eye-slash"></i></button>`
                            : `<button class="cfg-btn-sm cfg-btn-restore" data-action="restore-room" data-id="${r.id}" data-name="${esc(r.name)}"><i class="fa-solid fa-eye"></i></button>`
                        }
                    </div>
                </td>
            </tr>`;
        }).join('');
    },

    async _addRoom() {
        const btn       = document.getElementById('cfg-addRoomBtn');
        const name      = document.getElementById('cfg-rName').value.trim();
        const cap       = document.getElementById('cfg-rCapacity').value;
        const dr        = document.getElementById('cfg-rDayRate').value;
        const desc      = document.getElementById('cfg-rDesc').value.trim();
        const openTime  = document.getElementById('cfg-rOpenTime').value;
        const closeTime = document.getElementById('cfg-rCloseTime').value;

        if (!name) { UI.toast('Room name is required', 'error'); return; }
        if (!dr || isNaN(parseFloat(dr))) { UI.toast('Hourly rate is required', 'error'); return; }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';
        try {
            const res = await fetch(API.createRoom, {
                method: 'POST', headers: Auth.headers(),
                body: JSON.stringify(withRole({ name, capacity: cap || null, day_rate: dr, description: desc || null }))
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed'); }
            UI.toast('Room added!', 'success');
            ['cfg-rName', 'cfg-rCapacity', 'cfg-rDayRate', 'cfg-rDesc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            await this._loadRooms();
            if (openTime || closeTime) {
                const newRoom = _rooms.find(r => r.name === name);
                if (newRoom) {
                    const rh = loadRoomHours();
                    rh[newRoom.id] = { open: openTime, close: closeTime };
                    saveRoomHours(rh);
                    this._renderRoomsTable();
                }
            }
        } catch (e) {
            UI.toast(e.message || 'Error adding room', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Room';
        }
    },

    _editRoom(id) {
        const r = _rooms.find(x => x.id == id);
        if (!r) return;
        _modalMode = { type: 'room', id, data: r };
        document.getElementById('cfg-modalTitle').textContent = 'Edit Room — ' + r.name;
        const rh2 = loadRoomHours()[r.id] || {};
        const timeOpts = generateTimeOptions();
        document.getElementById('cfg-modalBody').innerHTML = `
            <div class="cfg-input-group"><label>Room Name</label><input type="text" id="cfg-me_name" value="${esc(r.name)}"></div>
            <div class="cfg-row2">
                <div class="cfg-input-group"><label>Capacity</label><input type="number" id="cfg-me_cap" value="${r.capacity || ''}" min="1"></div>
                <div class="cfg-input-group"><label>Hourly Rate (£)</label><input type="number" id="cfg-me_dr" value="${r.day_rate}" min="0" step="0.01"></div>
            </div>
            <div class="cfg-row2">
                <div class="cfg-input-group"><label>Open Time</label><select id="cfg-me_open">${timeOpts}</select></div>
                <div class="cfg-input-group"><label>Close Time</label><select id="cfg-me_close">${timeOpts}</select></div>
            </div>
            <div class="cfg-input-group"><label>Description</label><textarea id="cfg-me_desc">${esc(r.description || '')}</textarea></div>
            <div class="cfg-toggle-row">
                <span class="cfg-toggle-label">Room Active</span>
                <button class="cfg-toggle ${r.is_active ? 'on' : ''}" id="cfg-me_active" onclick="this.classList.toggle('on')"></button>
            </div>`;
        const meOpen = document.getElementById('cfg-me_open');
        const meClose = document.getElementById('cfg-me_close');
        if (rh2.open && meOpen) meOpen.value = rh2.open;
        if (rh2.close && meClose) meClose.value = rh2.close;
        document.getElementById('cfg-editModal').classList.add('open');
    },

    async _softDeleteRoom(id, name) {
        if (!confirm(`Deactivate "${name}"? It won't appear in booking forms but historical data is kept.`)) return;
        try {
            await fetch(API.deleteRoom, { method: 'POST', headers: Auth.headers(), body: JSON.stringify(withRole({ room_id: id })) });
            UI.toast('Room deactivated', 'success');
            await this._loadRooms();
        } catch (e) { UI.toast('Error', 'error'); }
    },

    async _restoreRoom(id, name) {
        if (!confirm(`Re-activate "${name}"?`)) return;
        const r = _rooms.find(x => x.id == id);
        if (!r) return;
        try {
            await fetch(API.updateRoom, {
                method: 'POST', headers: Auth.headers(),
                body: JSON.stringify(withRole({ ...r, id, is_active: true }))
            });
            UI.toast('Room re-activated', 'success');
            await this._loadRooms();
        } catch (e) { UI.toast('Error', 'error'); }
    },

    // ── Event Types ──────────────────────────────────────────────────────────

    async _loadEventTypes() {
        try {
            const res = await fetch(API.getEventTypes(), { headers: Auth.headers() });
            const text = await res.text();
            const json = text.trim() ? JSON.parse(text) : {};
            _eventTypes = json.data || (Array.isArray(json) ? json : []);
            this._renderEventTypesTable();
        } catch (e) {
            const tb = document.getElementById('cfg-eventTypesTable');
            if (tb) tb.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--danger)">Failed to load event types</td></tr>';
        }
    },

    _renderEventTypesTable() {
        const tbody = document.getElementById('cfg-eventTypesTable');
        if (!tbody) return;
        if (!_eventTypes.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No event types found.</td></tr>';
            const pg = document.getElementById('cfg-et-pagination');
            if (pg) pg.style.display = 'none';
            return;
        }
        const totalPages = Math.ceil(_eventTypes.length / ET_PAGE_SIZE);
        _etPage = Math.max(1, Math.min(_etPage, totalPages));
        const slice = _eventTypes.slice((_etPage - 1) * ET_PAGE_SIZE, _etPage * ET_PAGE_SIZE);
        tbody.innerHTML = slice.map(et => `
            <tr class="${!et.is_active ? 'cfg-inactive-row' : ''}">
                <td style="font-weight:600;color:var(--text-main)">${esc(et.name)}</td>
                <td style="color:var(--text-muted);font-size:0.85rem">${esc(et.description || '—')}</td>
                <td><span class="cfg-status-badge ${et.is_active ? 'cfg-status-active' : 'cfg-status-inactive'}">${et.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <div class="cfg-action-btns">
                        <button class="cfg-btn-sm cfg-btn-edit" data-action="edit-et" data-id="${et.id}"><i class="fa-solid fa-pen"></i></button>
                        ${et.is_active
                            ? `<button class="cfg-btn-sm cfg-btn-delete" data-action="delete-et" data-id="${et.id}" data-name="${esc(et.name)}"><i class="fa-solid fa-eye-slash"></i></button>`
                            : `<button class="cfg-btn-sm cfg-btn-restore" data-action="restore-et" data-id="${et.id}" data-name="${esc(et.name)}"><i class="fa-solid fa-eye"></i></button>`
                        }
                    </div>
                </td>
            </tr>`).join('');
        const pgEl   = document.getElementById('cfg-et-pagination');
        const prevBtn = document.getElementById('cfg-et-prev');
        const nextBtn = document.getElementById('cfg-et-next');
        const pgInfo  = document.getElementById('cfg-et-page-info');
        if (_eventTypes.length > ET_PAGE_SIZE) {
            if (pgEl) pgEl.style.display = 'flex';
            if (pgInfo) pgInfo.textContent = `Page ${_etPage} of ${totalPages} (${_eventTypes.length} types)`;
            if (prevBtn) prevBtn.disabled = _etPage === 1;
            if (nextBtn) nextBtn.disabled = _etPage === totalPages;
        } else {
            if (pgEl) pgEl.style.display = 'none';
        }
    },

    async _addEventType() {
        const btn  = document.getElementById('cfg-addEventTypeBtn');
        const name = document.getElementById('cfg-etName').value.trim();
        const desc = document.getElementById('cfg-etDesc').value.trim();
        if (!name) { UI.toast('Name is required', 'error'); return; }
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';
        try {
            const res = await fetch(API.createEventType, {
                method: 'POST', headers: Auth.headers(),
                body: JSON.stringify(withRole({ name, description: desc || null }))
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed'); }
            UI.toast('Event type added!', 'success');
            const etNameEl = document.getElementById('cfg-etName');
            const etDescEl = document.getElementById('cfg-etDesc');
            if (etNameEl) etNameEl.value = '';
            if (etDescEl) etDescEl.value = '';
            await this._loadEventTypes();
        } catch (e) {
            UI.toast(e.message || 'Error adding event type', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Event Type';
        }
    },

    _editEventType(id) {
        const et = _eventTypes.find(x => x.id == id);
        if (!et) return;
        _modalMode = { type: 'event', id, data: et };
        document.getElementById('cfg-modalTitle').textContent = 'Edit Event Type — ' + et.name;
        document.getElementById('cfg-modalBody').innerHTML = `
            <div class="cfg-input-group"><label>Name</label><input type="text" id="cfg-me_name" value="${esc(et.name)}"></div>
            <div class="cfg-input-group"><label>Description</label><textarea id="cfg-me_desc">${esc(et.description || '')}</textarea></div>
            <div class="cfg-toggle-row">
                <span class="cfg-toggle-label">Active</span>
                <button class="cfg-toggle ${et.is_active ? 'on' : ''}" id="cfg-me_active" onclick="this.classList.toggle('on')"></button>
            </div>`;
        document.getElementById('cfg-editModal').classList.add('open');
    },

    async _softDeleteEventType(id, name) {
        if (!confirm(`Deactivate "${name}"?`)) return;
        try {
            await fetch(API.deleteEventType, { method: 'POST', headers: Auth.headers(), body: JSON.stringify(withRole({ event_type_id: id })) });
            UI.toast('Event type deactivated', 'success');
            await this._loadEventTypes();
        } catch (e) { UI.toast('Error', 'error'); }
    },

    async _restoreEventType(id, name) {
        if (!confirm(`Re-activate "${name}"?`)) return;
        const et = _eventTypes.find(x => x.id == id);
        if (!et) return;
        try {
            await fetch(API.updateEventType, {
                method: 'POST', headers: Auth.headers(),
                body: JSON.stringify(withRole({ ...et, id, is_active: true }))
            });
            UI.toast('Event type re-activated', 'success');
            await this._loadEventTypes();
        } catch (e) { UI.toast('Error', 'error'); }
    },

    // ── Pricing Grid ─────────────────────────────────────────────────────────

    async _loadPricing() {
        try {
            const res = await fetch(API.getPricing, { headers: Auth.headers() });
            const json = await res.json();
            _pricing = json.data || (Array.isArray(json) ? json : []);
        } catch (e) { _pricing = []; }
    },

    _renderPricingGrid() {
        const self = this;
        const wrap = document.getElementById('cfg-pricingGridWrap');
        if (!wrap) return;
        const activeRooms = _rooms.filter(r => r.is_active);
        const activeTypes = _eventTypes.filter(et => et.is_active);

        if (!activeRooms.length || !activeTypes.length) {
            wrap.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">Add rooms and event types first to configure pricing.</p>';
            return;
        }

        const priceMap = {};
        _pricing.forEach(p => { priceMap[`${p.room_id}-${p.event_type_id}`] = p.day_rate; });

        let html = `<table class="cfg-pricing-grid">
            <thead><tr>
                <th>Room</th>
                ${activeTypes.map(et => `<th>${esc(et.name)}</th>`).join('')}
            </tr></thead>
            <tbody>`;

        activeRooms.forEach(r => {
            html += `<tr><td class="cfg-room-label">${esc(r.name)}<span class="cfg-rate-default">Default: ${fmt(r.day_rate)}</span></td>`;
            activeTypes.forEach(et => {
                const key = `${r.id}-${et.id}`;
                const val = priceMap[key] != null ? parseFloat(priceMap[key]) : '';
                const hasOverride = val !== '';
                html += `<td class="cfg-pricing-cell">
                    <input class="cfg-price-input" type="number" min="0" step="0.01"
                        placeholder="${parseFloat(r.day_rate).toFixed(0)}"
                        value="${val}"
                        data-room="${r.id}" data-type="${et.id}">
                    ${hasOverride ? `<button class="cfg-del-price-btn" data-room="${r.id}" data-type="${et.id}" title="Remove rate override"><i class="fa-solid fa-xmark"></i></button>` : ''}
                </td>`;
            });
            html += `</tr>`;
        });

        html += `</tbody></table>
        <p style="margin-top:1rem;font-size:0.8rem;color:var(--text-muted)">
            <i class="fa-solid fa-circle-info"></i> Changes save automatically when you leave a cell. Blank = use room default rate.
        </p>`;
        wrap.innerHTML = html;

        // Attach pricing events via delegated listeners
        wrap.querySelectorAll('.cfg-price-input').forEach(input => {
            on(input, 'input', () => input.classList.add('unsaved'));
            on(input, 'blur', () => self._savePricingCell(input));
        });
        wrap.querySelectorAll('.cfg-del-price-btn').forEach(btn => {
            on(btn, 'click', () => self._deletePricingCell(btn.dataset.room, btn.dataset.type, btn));
        });
    },

    async _savePricingCell(input) {
        if (!input.classList.contains('unsaved')) return;
        const room_id = input.dataset.room;
        const event_type_id = input.dataset.type;
        const val = input.value.trim();
        if (val === '') {
            input.classList.remove('unsaved');
            await this._deletePricingCell(room_id, event_type_id, null, input);
            return;
        }
        const day_rate = parseFloat(val);
        if (isNaN(day_rate) || day_rate < 0) { UI.toast('Invalid price', 'error'); return; }
        try {
            const res = await fetch(API.setPricing, {
                method: 'POST', headers: Auth.headers(),
                body: JSON.stringify(withRole({ room_id, event_type_id, day_rate }))
            });
            if (!res.ok) throw new Error('Failed');
            input.classList.remove('unsaved');
            await this._loadPricing();
        } catch (e) { UI.toast('Failed to save price', 'error'); }
    },

    async _deletePricingCell(room_id, event_type_id, btn, inputEl) {
        const cell = btn ? btn.closest('td') : (inputEl ? inputEl.closest('td') : null);
        try {
            const res = await fetch(API.deletePricing, {
                method: 'POST', headers: Auth.headers(),
                body: JSON.stringify(withRole({ room_id, event_type_id }))
            });
            if (!res.ok) throw new Error('Failed');
            if (cell) {
                const inp = cell.querySelector('.cfg-price-input');
                if (inp) { inp.value = ''; inp.classList.remove('unsaved'); }
                const delBtn = cell.querySelector('.cfg-del-price-btn');
                if (delBtn) delBtn.remove();
            }
            await this._loadPricing();
            UI.toast('Rate override removed', 'success');
        } catch (e) { UI.toast('Failed to remove rate', 'error'); }
    },

    // ── Settings ─────────────────────────────────────────────────────────────

    async _loadSettings() {
        const infoEl = document.getElementById('cfg-bufferCurrentText');
        if (infoEl) infoEl.textContent = 'Loading...';
        try {
            const res = await fetch(API.getSettings, { headers: Auth.headers() });
            const json = await res.json();
            _settings = json.data || (Array.isArray(json) ? json : []);
            const bufferSetting = _settings.find(s => s.key === 'booking_buffer_minutes');
            const currentVal = bufferSetting ? parseInt(bufferSetting.value) : 60;
            if (infoEl) {
                infoEl.textContent = `Current: ${currentVal === 0 ? 'No buffer' : currentVal + ' minutes'} — last updated ${bufferSetting ? new Date(bufferSetting.updated_at).toLocaleString('en-GB') : 'never'}`;
            }
            const sel = document.getElementById('cfg-bufferSelect');
            if (sel) {
                const knownValues = ['0', '30', '45', '60', '90', '120'];
                const customGroup = document.getElementById('cfg-customBufferGroup');
                if (knownValues.includes(String(currentVal))) {
                    sel.value = String(currentVal);
                    if (customGroup) customGroup.style.display = 'none';
                } else {
                    sel.value = 'custom';
                    const customInput = document.getElementById('cfg-customBufferInput');
                    if (customInput) customInput.value = currentVal;
                    if (customGroup) customGroup.style.display = 'block';
                }
            }
        } catch (e) {
            if (infoEl) infoEl.textContent = 'Failed to load settings.';
        }
    },

    _handleBufferSelectChange() {
        const sel = document.getElementById('cfg-bufferSelect');
        const customGroup = document.getElementById('cfg-customBufferGroup');
        if (sel && customGroup) customGroup.style.display = sel.value === 'custom' ? 'block' : 'none';
    },

    async _saveBufferSetting() {
        const sel = document.getElementById('cfg-bufferSelect');
        let minutes;
        if (sel.value === 'custom') {
            minutes = parseInt(document.getElementById('cfg-customBufferInput').value);
            if (isNaN(minutes) || minutes < 0) { UI.toast('Invalid minutes value', 'error'); return; }
        } else {
            minutes = parseInt(sel.value);
        }
        const btn = document.getElementById('cfg-saveBufferBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        try {
            const res = await fetch(API.updateSetting, {
                method: 'POST', headers: Auth.headers(),
                body: JSON.stringify({ key: 'booking_buffer_minutes', value: minutes })
            });
            if (!res.ok) throw new Error('Save failed');
            UI.toast(`Buffer set to ${minutes === 0 ? 'no buffer' : minutes + ' minutes'}`, 'success');
            await this._loadSettings();
        } catch (e) {
            UI.toast('Failed to save setting', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Buffer Setting';
        }
    },

    // ── Services ─────────────────────────────────────────────────────────────

    _renderServicesTable() {
        const svcs = loadServicesData();
        const tbody = document.getElementById('cfg-servicesTable');
        if (!tbody) return;
        if (!svcs.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted)">No services defined yet.</td></tr>';
            return;
        }
        tbody.innerHTML = svcs.map(s => `
            <tr class="${s.active === false ? 'cfg-inactive-row' : ''}">
                <td style="font-weight:600;color:var(--text-main)">${esc(s.name)}</td>
                <td style="color:var(--text-muted)">${s.type === 'hourly' ? 'Per Hour' : 'Flat Rate'}</td>
                <td>${fmt(s.price)}${s.type === 'hourly' ? '<span style="font-size:0.72rem;color:var(--text-muted)">/hr</span>' : ''}</td>
                <td><span class="cfg-status-badge ${s.active !== false ? 'cfg-status-active' : 'cfg-status-inactive'}">${s.active !== false ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <div class="cfg-action-btns">
                        <button class="cfg-btn-sm cfg-btn-edit" data-action="edit-svc" data-id="${s.id}"><i class="fa-solid fa-pen"></i></button>
                        ${s.active !== false
                            ? `<button class="cfg-btn-sm cfg-btn-delete" data-action="toggle-svc-off" data-id="${s.id}"><i class="fa-solid fa-eye-slash"></i></button>`
                            : `<button class="cfg-btn-sm cfg-btn-restore" data-action="toggle-svc-on" data-id="${s.id}"><i class="fa-solid fa-eye"></i></button>`
                        }
                        <button class="cfg-btn-sm cfg-btn-delete" data-action="delete-svc" data-id="${s.id}" title="Delete permanently"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>`).join('');
    },

    _addService() {
        const name  = document.getElementById('cfg-svcName').value.trim();
        const type  = document.getElementById('cfg-svcType').value;
        const price = parseFloat(document.getElementById('cfg-svcPrice').value);
        if (!name) { UI.toast('Service name is required', 'error'); return; }
        if (isNaN(price) || price < 0) { UI.toast('Valid price is required', 'error'); return; }
        const svcs = loadServicesData();
        svcs.push({ id: 'svc_' + Date.now(), name, type, price, active: true });
        saveServicesData(svcs);
        UI.toast('Service added!', 'success');
        const svcNameEl = document.getElementById('cfg-svcName');
        const svcPriceEl = document.getElementById('cfg-svcPrice');
        if (svcNameEl) svcNameEl.value = '';
        if (svcPriceEl) svcPriceEl.value = '';
        this._renderServicesTable();
    },

    _editServiceItem(id) {
        const svcs = loadServicesData();
        const s = svcs.find(x => x.id === id);
        if (!s) return;
        _modalMode = { type: 'service', id };
        document.getElementById('cfg-modalTitle').textContent = 'Edit Service — ' + s.name;
        document.getElementById('cfg-modalBody').innerHTML = `
            <div class="cfg-input-group"><label>Service Name</label><input type="text" id="cfg-me_svc_name" value="${esc(s.name)}"></div>
            <div class="cfg-row2">
                <div class="cfg-input-group">
                    <label>Pricing Type</label>
                    <select id="cfg-me_svc_type">
                        <option value="flat"   ${s.type === 'flat'   ? 'selected' : ''}>Flat Rate</option>
                        <option value="hourly" ${s.type === 'hourly' ? 'selected' : ''}>Per Hour</option>
                    </select>
                </div>
                <div class="cfg-input-group"><label>Price (£)</label><input type="number" id="cfg-me_svc_price" value="${s.price}" min="0" step="0.01"></div>
            </div>
            <div class="cfg-toggle-row">
                <span class="cfg-toggle-label">Active</span>
                <button class="cfg-toggle ${s.active !== false ? 'on' : ''}" id="cfg-me_svc_active" onclick="this.classList.toggle('on')"></button>
            </div>`;
        document.getElementById('cfg-editModal').classList.add('open');
    },

    _toggleService(id, active) {
        const svcs = loadServicesData();
        const s = svcs.find(x => x.id === id);
        if (s) s.active = active;
        saveServicesData(svcs);
        UI.toast(active ? 'Service activated' : 'Service deactivated', 'success');
        this._renderServicesTable();
    },

    _deleteSvc(id) {
        if (!confirm('Permanently delete this service?')) return;
        saveServicesData(loadServicesData().filter(x => x.id !== id));
        UI.toast('Service deleted', 'success');
        this._renderServicesTable();
    },

    // ── Modal ─────────────────────────────────────────────────────────────────

    async _saveModal() {
        if (!_modalMode) return;
        const btn = document.getElementById('cfg-modalSaveBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        try {
            if (_modalMode.type === 'room') {
                const payload = {
                    id:          _modalMode.id,
                    name:        document.getElementById('cfg-me_name').value.trim(),
                    capacity:    document.getElementById('cfg-me_cap').value || null,
                    day_rate:    document.getElementById('cfg-me_dr').value,
                    description: document.getElementById('cfg-me_desc').value.trim() || null,
                    is_active:   document.getElementById('cfg-me_active').classList.contains('on'),
                };
                if (!payload.name) throw new Error('Room name is required');
                const res = await fetch(API.updateRoom, { method: 'POST', headers: Auth.headers(), body: JSON.stringify(withRole(payload)) });
                if (!res.ok) throw new Error('Update failed');
                const openTime  = (document.getElementById('cfg-me_open')  || {}).value || '';
                const closeTime = (document.getElementById('cfg-me_close') || {}).value || '';
                const rh = loadRoomHours();
                rh[_modalMode.id] = { open: openTime, close: closeTime };
                saveRoomHours(rh);
                UI.toast('Room updated!', 'success');
                await this._loadRooms();
            } else if (_modalMode.type === 'event') {
                const payload = {
                    id:          _modalMode.id,
                    name:        document.getElementById('cfg-me_name').value.trim(),
                    description: document.getElementById('cfg-me_desc').value.trim() || null,
                    is_active:   document.getElementById('cfg-me_active').classList.contains('on'),
                };
                if (!payload.name) throw new Error('Name is required');
                const res = await fetch(API.updateEventType, { method: 'POST', headers: Auth.headers(), body: JSON.stringify(withRole(payload)) });
                if (!res.ok) throw new Error('Update failed');
                UI.toast('Event type updated!', 'success');
                await this._loadEventTypes();
            } else if (_modalMode.type === 'service') {
                const svcs = loadServicesData();
                const s = svcs.find(x => x.id === _modalMode.id);
                if (!s) throw new Error('Service not found');
                s.name   = document.getElementById('cfg-me_svc_name').value.trim();
                s.type   = document.getElementById('cfg-me_svc_type').value;
                s.price  = parseFloat(document.getElementById('cfg-me_svc_price').value) || 0;
                s.active = document.getElementById('cfg-me_svc_active').classList.contains('on');
                if (!s.name) throw new Error('Service name is required');
                saveServicesData(svcs);
                UI.toast('Service updated!', 'success');
                this._renderServicesTable();
            }
            this._closeModal();
        } catch (e) {
            UI.toast(e.message || 'Error saving', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
        }
    },

    _closeModal() {
        const modal = document.getElementById('cfg-editModal');
        if (modal) modal.classList.remove('open');
        _modalMode = null;
    },
};

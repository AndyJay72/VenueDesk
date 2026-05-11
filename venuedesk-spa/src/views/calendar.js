/**
 * views/calendar.js — Booking calendar + availability checker
 * Wraps FullCalendar (loaded from CDN) with the existing booking data.
 * POST /bookings/list, POST /bookings/check-availability
 */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { toast } from '../components/toast.js';
import { renderSidebar, initSidebar } from '../components/sidebar.js';
import { store } from '../store.js';

const FC_CSS = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.css';
const FC_JS  = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js';

function loadScript(src) {
  return new Promise((res,rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel='stylesheet'; l.href=href;
  document.head.appendChild(l);
}

const STATUS_COLOR = {
  confirmed: '#10b981',
  pending:   '#f59e0b',
  cancelled: '#6b7280',
  completed: '#6366f1',
  fully_paid:'#10b981',
};

const view = {
  calendar: null,

  async mount(container) {
    container.innerHTML = `
      ${renderSidebar('/calendar')}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-calendar-days" style="color:var(--primary);"></i> Calendar</h1>
          <p>Booking availability and schedule</p>
        </div>
        <div class="card" style="padding:1rem;">
          <div id="calendarEl" style="min-height:600px;"></div>
        </div>
      </main>
    `;
    initSidebar();

    loadCss(FC_CSS);
    await loadScript(FC_JS);
    this._initCalendar();
  },

  async _initCalendar() {
    const el = document.getElementById('calendarEl');
    if (!el || !window.FullCalendar) return;

    // Load bookings for events
    let events = [];
    try {
      const { data } = await api.post('/bookings/list', {});
      events = (data || []).map(b => ({
        id:    b.id,
        title: `${b.customer_name||'Booking'} — ${b.room_name||''}`,
        start: b.date_from || b.booking_date,
        end:   b.date_to || b.date_from || b.booking_date,
        color: STATUS_COLOR[b.status] || '#6366f1',
        extendedProps: b,
      }));
    } catch(e) {
      toast.error('Failed to load calendar bookings');
    }

    this.calendar = new FullCalendar.Calendar(el, {
      initialView:      'dayGridMonth',
      headerToolbar: {
        left:   'prev,next today',
        center: 'title',
        right:  'dayGridMonth,timeGridWeek,listWeek',
      },
      events,
      themeSystem:    'standard',
      height:         'auto',
      eventClick: (info) => {
        const b = info.event.extendedProps;
        toast.info(`${b.customer_name || 'Booking'} · ${b.status || ''} · £${parseFloat(b.balance_due||0).toFixed(2)} outstanding`);
      },
    });

    // Inject dark theme overrides
    const style = document.createElement('style');
    style.textContent = `
      .fc { font-family: inherit; color: var(--text-main); }
      .fc-scrollgrid, .fc-scrollgrid td, .fc-scrollgrid th { border-color: var(--border) !important; }
      .fc-col-header-cell, .fc-daygrid-day { background: transparent !important; }
      .fc-col-header-cell-cushion, .fc-daygrid-day-number { color: var(--text-muted) !important; text-decoration: none; }
      .fc-button-primary { background: var(--primary) !important; border-color: var(--primary) !important; }
      .fc-button-primary:hover { background: var(--primary-hover) !important; }
      .fc-today-button { opacity: 0.8; }
      .fc-daygrid-day.fc-day-today { background: rgba(99,102,241,0.06) !important; }
      .fc-toolbar-title { font-size: 1.1rem !important; font-weight: 700 !important; }
      .fc-list-event-title { color: var(--text-main) !important; }
    `;
    document.head.appendChild(style);
    this.calendar.render();
  },
};
export default view;

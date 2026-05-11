import{a as i,r as d,i as l}from"./sidebar-C8xt7GmK.js";import{toast as o}from"./toast-CQ5lsFjN.js";import"./index-CBNA1kT4.js";const c="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.css",s="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js";function m(t){return new Promise((a,n)=>{if(document.querySelector(`script[src="${t}"]`)){a();return}const r=document.createElement("script");r.src=t,r.onload=a,r.onerror=n,document.head.appendChild(r)})}function p(t){if(document.querySelector(`link[href="${t}"]`))return;const a=document.createElement("link");a.rel="stylesheet",a.href=t,document.head.appendChild(a)}const u={confirmed:"#10b981",pending:"#f59e0b",cancelled:"#6b7280",completed:"#6366f1",fully_paid:"#10b981"},g={calendar:null,async mount(t){t.innerHTML=`
      ${d("/calendar")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-calendar-days" style="color:var(--primary);"></i> Calendar</h1>
          <p>Booking availability and schedule</p>
        </div>
        <div class="card" style="padding:1rem;">
          <div id="calendarEl" style="min-height:600px;"></div>
        </div>
      </main>
    `,l(),p(c),await m(s),this._initCalendar()},async _initCalendar(){const t=document.getElementById("calendarEl");if(!t||!window.FullCalendar)return;let a=[];try{const{data:r}=await i.get("/bookings/list");a=(r||[]).map(e=>({id:e.id,title:`${e.customer_name||"Booking"} — ${e.room_name||""}`,start:e.date_from||e.booking_date,end:e.date_to||e.date_from||e.booking_date,color:u[e.status]||"#6366f1",extendedProps:e}))}catch{o.error("Failed to load calendar bookings")}this.calendar=new FullCalendar.Calendar(t,{initialView:"dayGridMonth",headerToolbar:{left:"prev,next today",center:"title",right:"dayGridMonth,timeGridWeek,listWeek"},events:a,themeSystem:"standard",height:"auto",eventClick:r=>{const e=r.event.extendedProps;o.info(`${e.customer_name||"Booking"} · ${e.status||""} · £${parseFloat(e.balance_due||0).toFixed(2)} outstanding`)}});const n=document.createElement("style");n.textContent=`
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
    `,document.head.appendChild(n),this.calendar.render()}};export{g as default};

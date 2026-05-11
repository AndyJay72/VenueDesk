import{a as s,r,i as c}from"./sidebar-C8xt7GmK.js";import{a as u}from"./index-CBNA1kT4.js";function d(t,n="£"){const a=parseFloat(t)||0;return n+a.toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}function o(t){return t?new Date(t).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"}function l(t){return`<span class="badge badge-${{confirmed:"success",pending:"warning",cancelled:"danger",completed:"info",fully_paid:"success"}[t]||"muted"}">${t||"—"}</span>`}const p={async mount(t){t.innerHTML=`
      ${r("/dashboard")}
      <main class="content" id="mainContent">
        <div class="page-header">
          <h1><i class="fa-solid fa-gauge-high" style="color:var(--primary);"></i> Dashboard</h1>
          <p>Welcome back, ${u.getUserName()}</p>
        </div>

        <!-- KPI row -->
        <div class="grid-4" id="kpiRow">
          ${["bookings","revenue","pending","outstanding"].map(n=>`
            <div class="kpi-card" id="kpi-${n}">
              <div class="kpi-label"><div class="spinner" style="width:16px;height:16px;border-width:2px;margin:0;"></div></div>
              <div class="kpi-value">—</div>
            </div>
          `).join("")}
        </div>

        <!-- Two-column: upcoming bookings + outstanding payments -->
        <div class="grid-2" style="margin-top:1.5rem;">
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-calendar-check"></i> Upcoming Bookings</div>
            <div id="upcomingBookings"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-clock"></i> Outstanding Payments</div>
            <div id="outstandingPayments"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Pending requests -->
        <div class="card" style="margin-top:1.5rem;">
          <div class="card-title">
            <i class="fa-solid fa-inbox"></i> Pending Requests
            <span id="pendingBadge" class="badge badge-warning" style="margin-left:auto;display:none;"></span>
          </div>
          <div id="pendingRequests"><div class="spinner"></div></div>
        </div>
      </main>
    `,c(),this._loadAll()},async _loadAll(){await Promise.allSettled([this._loadKpis(),this._loadUpcoming(),this._loadOutstanding(),this._loadPending()])},async _loadKpis(){try{const t=await s.get("/dashboard/metrics");[{id:"bookings",label:"Pending Requests",value:t.pending_requests??0,sub:"Awaiting response",icon:"fa-clock",color:"var(--warning)"},{id:"revenue",label:"Revenue (Month)",value:d(t.total_revenue_month),sub:"This calendar month",icon:"fa-sterling-sign",color:"var(--success)"},{id:"pending",label:"Contacted Today",value:t.contacted_today??0,sub:"Follow-ups done today",icon:"fa-comment-dots",color:"var(--info)"},{id:"outstanding",label:"Outstanding Balance",value:d(t.outstanding),sub:"Across all bookings",icon:"fa-circle-exclamation",color:"var(--danger)"}].forEach(a=>{const e=document.getElementById(`kpi-${a.id}`);e&&(e.innerHTML=`
          <div class="kpi-label"><i class="fa-solid ${a.icon}" style="color:${a.color};margin-right:6px;"></i>${a.label}</div>
          <div class="kpi-value" style="color:${a.color};">${a.value}</div>
          <div class="kpi-sub">${a.sub}</div>
        `)})}catch(t){console.error("[dashboard] KPI load failed",t),["bookings","revenue","pending","outstanding"].forEach(n=>{const a=document.getElementById(`kpi-${n}`);a&&(a.innerHTML='<div class="kpi-label">—</div><div class="kpi-value" style="color:var(--text-muted);">Error</div>')})}},async _loadUpcoming(){const t=document.getElementById("upcomingBookings");try{const{data:n}=await s.get("/bookings/list"),a=(n||[]).filter(e=>e.status!=="cancelled").sort((e,i)=>new Date(e.date_from||e.booking_date)-new Date(i.date_from||i.booking_date)).slice(0,8);if(!a.length){t.innerHTML='<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No upcoming bookings</p></div>';return}t.innerHTML=`
        <table class="data-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Date</th>
              <th>Room</th>
              <th>Status</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            ${a.map(e=>`
              <tr>
                <td style="font-weight:600;">${e.customer_name||"—"}</td>
                <td>${o(e.date_from||e.booking_date)}</td>
                <td>${e.room_name||"—"}</td>
                <td>${l(e.status)}</td>
                <td style="color:${parseFloat(e.balance_due)>0?"var(--warning)":"var(--success)"};">
                  ${d(e.balance_due)}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}catch{t.innerHTML='<p style="color:var(--text-muted);font-size:0.85rem;">Failed to load bookings.</p>'}},async _loadOutstanding(){const t=document.getElementById("outstandingPayments");try{const{data:n}=await s.get("/recurring/next-due"),a=(n||[]).filter(e=>parseFloat(e.next_amount_due)>0).slice(0,8);if(!a.length){t.innerHTML='<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>No outstanding recurring payments</p></div>';return}t.innerHTML=`
        <table class="data-table">
          <thead>
            <tr><th>Customer</th><th>Due Date</th><th>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${a.map(e=>`
              <tr>
                <td style="font-weight:600;">${e.full_name||e.customer_name||"—"}</td>
                <td>${o(e.next_due_date)}</td>
                <td style="color:var(--warning);">${d(e.next_amount_due)}</td>
                <td>${l(e.payment_status||"pending")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}catch{t.innerHTML='<p style="color:var(--text-muted);font-size:0.85rem;">Failed to load outstanding payments.</p>'}},async _loadPending(){const t=document.getElementById("pendingRequests"),n=document.getElementById("pendingBadge");try{const{data:a}=await s.get("/bookings/pending"),e=a||[];if(n&&(n.textContent=e.length,n.style.display=e.length?"inline-flex":"none"),!e.length){t.innerHTML='<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No pending requests</p></div>';return}t.innerHTML=`
        <table class="data-table">
          <thead>
            <tr><th>Customer</th><th>Event Type</th><th>Requested Date</th><th>Guests</th><th>Submitted</th></tr>
          </thead>
          <tbody>
            ${e.map(i=>`
              <tr>
                <td style="font-weight:600;">${i.full_name||i.customer_name||"—"}</td>
                <td>${i.event_type||"—"}</td>
                <td>${o(i.date_from)}</td>
                <td>${i.guest_count??i.guests_count??"—"}</td>
                <td style="color:var(--text-muted);">${o(i.created_at)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}catch{t.innerHTML='<p style="color:var(--text-muted);font-size:0.85rem;">Failed to load pending requests.</p>'}}};export{p as default};

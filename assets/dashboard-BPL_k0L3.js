import{a as o,r as g,i as p}from"./sidebar-Dqc3A8_t.js";import{a as u}from"./index-B757bbVY.js";function l(t,a="£"){const i=parseFloat(t)||0;return a+i.toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}function c(t){return t?new Date(t).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"}function m(t){return`<span class="badge badge-${{confirmed:"success",pending:"warning",cancelled:"danger",completed:"info",fully_paid:"success"}[t]||"muted"}">${t||"—"}</span>`}const f={async mount(t){t.innerHTML=`
      ${g("/dashboard")}
      <main class="content" id="mainContent">
        <div class="page-header">
          <h1><i class="fa-solid fa-gauge-high" style="color:var(--primary);"></i> Dashboard</h1>
          <p>Welcome back, ${u.getUserName()}</p>
        </div>

        <!-- KPI row — structure mirrors bookings.html metric cards exactly -->
        <div class="metrics-grid" id="kpiRow">
          ${[{cls:"card-pre",id:"pending"},{cls:"card-booked",id:"revenue"},{cls:"card-post",id:"contacted"},{cls:"card-danger",id:"outstanding"}].map(a=>`
            <div class="metric-card ${a.cls}" id="kpi-${a.id}" style="--pct:0%">
              <div class="dial-ring" style="--pct:0%">
                <span class="dial-val">—</span>
              </div>
              <div class="metric-info">
                <h3>&nbsp;</h3>
                <div class="metric-val">—</div>
                <div class="metric-sub">
                  <span class="spinner" style="width:12px;height:12px;border-width:2px;margin:0;display:inline-block;vertical-align:middle;"></span>
                </div>
              </div>
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
    `,p(),this._loadAll()},async _loadAll(){await Promise.allSettled([this._loadKpis(),this._loadUpcoming(),this._loadOutstanding(),this._loadPending()])},async _loadKpis(){try{const t=await o.get("/dashboard/metrics"),a=t.pending_requests??0,i=t.contacted_today??0,e=parseFloat(t.total_revenue_month)||0,n=parseFloat(t.outstanding)||0,r=(s,d)=>`${Math.min(Math.round(s/d*100),100)}%`;[{id:"pending",label:"Pending Requests",dial:a,val:String(a),sub:"Awaiting response",pct:r(a,20)},{id:"revenue",label:"Revenue (Month)",dial:'<i class="fa-solid fa-sterling-sign" style="font-size:1.1rem;"></i>',val:l(e),sub:"This calendar month",pct:e>0?"65%":"0%"},{id:"contacted",label:"Contacted Today",dial:i,val:String(i),sub:"Follow-ups done today",pct:r(i,10)},{id:"outstanding",label:"Outstanding Balance",dial:'<i class="fa-solid fa-circle-exclamation" style="font-size:1.1rem;"></i>',val:l(n),sub:"Across all bookings",pct:n>0?"70%":"0%"}].forEach(s=>{const d=document.getElementById(`kpi-${s.id}`);d&&(d.style.setProperty("--pct",s.pct),d.innerHTML=`
          <div class="dial-ring" style="--pct:${s.pct}">
            <span class="dial-val">${s.dial}</span>
          </div>
          <div class="metric-info">
            <h3>${s.label}</h3>
            <div class="metric-val">${s.val}</div>
            <div class="metric-sub">${s.sub}</div>
          </div>
        `)})}catch(t){console.error("[dashboard] KPI load failed",t),["pending","revenue","contacted","outstanding"].forEach(a=>{const i=document.getElementById(`kpi-${a}`);i&&(i.innerHTML='<div class="dial-ring">—</div><div class="metric-info"><h3>Error</h3><div class="metric-val" style="color:var(--text-muted);">—</div></div>')})}},async _loadUpcoming(){const t=document.getElementById("upcomingBookings");try{const{data:a}=await o.get("/bookings/list"),i=(a||[]).filter(e=>e.status!=="cancelled").sort((e,n)=>new Date(e.date_from||e.booking_date)-new Date(n.date_from||n.booking_date)).slice(0,8);if(!i.length){t.innerHTML='<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No upcoming bookings</p></div>';return}t.innerHTML=`
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
            ${i.map(e=>`
              <tr>
                <td style="font-weight:600;">${e.customer_name||"—"}</td>
                <td>${c(e.date_from||e.booking_date)}</td>
                <td>${e.room_name||"—"}</td>
                <td>${m(e.status)}</td>
                <td style="color:${parseFloat(e.balance_due)>0?"var(--warning)":"var(--success)"};">
                  ${l(e.balance_due)}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}catch{t.innerHTML='<p style="color:var(--text-muted);font-size:0.85rem;">Failed to load bookings.</p>'}},async _loadOutstanding(){const t=document.getElementById("outstandingPayments");try{const{data:a}=await o.get("/recurring/next-due"),i=(a||[]).filter(e=>parseFloat(e.next_amount_due)>0).slice(0,8);if(!i.length){t.innerHTML='<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>No outstanding recurring payments</p></div>';return}t.innerHTML=`
        <table class="data-table">
          <thead>
            <tr><th>Customer</th><th>Due Date</th><th>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${i.map(e=>`
              <tr>
                <td style="font-weight:600;">${e.full_name||e.customer_name||"—"}</td>
                <td>${c(e.next_due_date)}</td>
                <td style="color:var(--warning);">${l(e.next_amount_due)}</td>
                <td>${m(e.payment_status||"pending")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}catch{t.innerHTML='<p style="color:var(--text-muted);font-size:0.85rem;">Failed to load outstanding payments.</p>'}},async _loadPending(){const t=document.getElementById("pendingRequests"),a=document.getElementById("pendingBadge");try{const{data:i}=await o.get("/bookings/pending"),e=i||[];if(a&&(a.textContent=e.length,a.style.display=e.length?"inline-flex":"none"),!e.length){t.innerHTML='<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No pending requests</p></div>';return}t.innerHTML=`
        <table class="data-table">
          <thead>
            <tr><th>Customer</th><th>Event Type</th><th>Requested Date</th><th>Guests</th><th>Submitted</th></tr>
          </thead>
          <tbody>
            ${e.map(n=>`
              <tr>
                <td style="font-weight:600;">${n.full_name||n.customer_name||"—"}</td>
                <td>${n.event_type||"—"}</td>
                <td>${c(n.date_from)}</td>
                <td>${n.guest_count??n.guests_count??"—"}</td>
                <td style="color:var(--text-muted);">${c(n.created_at)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}catch{t.innerHTML='<p style="color:var(--text-muted);font-size:0.85rem;">Failed to load pending requests.</p>'}}};export{f as default};

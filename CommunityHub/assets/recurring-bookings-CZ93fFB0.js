import{a as o,r as u,i as m}from"./sidebar-C8xt7GmK.js";import"./index-CBNA1kT4.js";function c(e){return"£"+(parseFloat(e)||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}function v(e){return e?new Date(e).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"}const f={async mount(e){e.innerHTML=`
      ${u("/recurring-bookings")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-rotate" style="color:var(--primary);"></i> Recurring Bookings</h1>
          <p>Active series and payment schedules</p>
        </div>
        <div class="grid-2">
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-rotate"></i> Active Series</div>
            <div id="seriesList"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-clock" style="color:var(--warning);"></i> Outstanding Payments</div>
            <div id="outstandingList"><div class="spinner"></div></div>
          </div>
        </div>
      </main>
    `,m(),this._load()},async _load(){var r,l;const[e,a]=await Promise.allSettled([o.get("/recurring/series"),o.get("/recurring/outstanding-payments")]),i=e.status==="fulfilled"?((r=e.value)==null?void 0:r.data)||[]:[],s=a.status==="fulfilled"?((l=a.value)==null?void 0:l.data)||[]:[],n=document.getElementById("seriesList");i.length?n.innerHTML=`
        <table class="data-table">
          <thead><tr><th>Customer</th><th>Room</th><th>Day</th><th>Balance Due</th><th>Status</th></tr></thead>
          <tbody>
            ${i.slice(0,20).map(t=>`
              <tr>
                <td style="font-weight:600;">${t.customer_name||t.full_name||"—"}</td>
                <td>${t.room_name||"—"}</td>
                <td>${t.day_of_week||"—"}</td>
                <td style="color:${parseFloat(t.balance_due)>0?"var(--warning)":"var(--success)"};">${c(t.balance_due)}</td>
                <td><span class="badge badge-${t.active?"success":"muted"}">${t.active?"Active":"Inactive"}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `:n.innerHTML='<div class="empty-state"><i class="fa-solid fa-rotate"></i><p>No active recurring series</p></div>';const d=document.getElementById("outstandingList");s.length?d.innerHTML=`
        <table class="data-table">
          <thead><tr><th>Customer</th><th>Due</th><th>Amount</th></tr></thead>
          <tbody>
            ${s.slice(0,20).map(t=>`
              <tr>
                <td style="font-weight:600;">${t.full_name||t.customer_name||"—"}</td>
                <td>${v(t.due_date||t.next_due_date)}</td>
                <td style="color:var(--warning);">${c(t.amount_due||t.next_amount_due)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `:d.innerHTML='<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>All recurring payments up to date</p></div>'}};export{f as default};

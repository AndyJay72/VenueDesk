import{a as m,r as y,i as f}from"./sidebar-C8xt7GmK.js";import{toast as b}from"./toast-CQ5lsFjN.js";import"./index-CBNA1kT4.js";function i(a){return"£"+(parseFloat(a)||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}function v(a){return a?new Date(a).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"}const L={async mount(a){a.innerHTML=`
      ${y("/accounts")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-sterling-sign" style="color:var(--primary);"></i> Accounts</h1>
          <p>Payment history and outstanding balances</p>
        </div>

        <div class="grid-4" id="kpiRow">
          ${["total","month","outstanding","recurring"].map(n=>`
            <div class="kpi-card" id="acc-kpi-${n}">
              <div class="kpi-label"><div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div></div>
              <div class="kpi-value">—</div>
            </div>
          `).join("")}
        </div>

        <div class="grid-2" style="margin-top:1.5rem;">
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-receipt"></i> Recent Payments</div>
            <div id="recentPayments"><div class="spinner"></div></div>
          </div>
          <div class="card">
            <div class="card-title"><i class="fa-solid fa-circle-exclamation" style="color:var(--warning);"></i> Outstanding Balances</div>
            <div id="outstandingList"><div class="spinner"></div></div>
          </div>
        </div>
      </main>
    `,f(),this._load()},async _load(){var a,n;try{const[s,r]=await Promise.allSettled([m.get("/accounts/transactions"),m.get("/recurring/outstanding-payments")]),o=s.status==="fulfilled"?((a=s.value)==null?void 0:a.data)||[]:[],d=r.status==="fulfilled"?((n=r.value)==null?void 0:n.data)||[]:[],g=o.reduce((t,e)=>t+parseFloat(e.amount||0),0),l=new Date,h=o.filter(t=>{const e=new Date(t.payment_date||t.created_at);return e.getMonth()===l.getMonth()&&e.getFullYear()===l.getFullYear()}).reduce((t,e)=>t+parseFloat(e.amount||0),0),p=d.reduce((t,e)=>t+parseFloat(e.amount_due||e.next_amount_due||0),0);[{id:"total",label:"Total Revenue",value:i(g),sub:"All time",color:"var(--success)"},{id:"month",label:"This Month",value:i(h),sub:l.toLocaleString("en-GB",{month:"long"}),color:"var(--primary)"},{id:"outstanding",label:"Outstanding",value:i(p),sub:"Across all accounts",color:"var(--warning)"},{id:"recurring",label:"Recurring Contracts",value:d.length,sub:"Active series",color:"var(--info)"}].forEach(t=>{const e=document.getElementById(`acc-kpi-${t.id}`);e&&(e.innerHTML=`<div class="kpi-label">${t.label}</div><div class="kpi-value" style="color:${t.color};">${t.value}</div><div class="kpi-sub">${t.sub}</div>`)});const c=document.getElementById("recentPayments");o.length?c.innerHTML=`
          <table class="data-table">
            <thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Method</th><th>Ref</th></tr></thead>
            <tbody>
              ${o.slice(0,20).map(t=>`
                <tr>
                  <td style="color:var(--text-muted);font-size:0.8rem;">${v(t.payment_date||t.created_at)}</td>
                  <td style="font-weight:600;">${t.customer_name||t.customer_id||"—"}</td>
                  <td style="color:var(--success);font-weight:600;">${i(t.amount)}</td>
                  <td><span class="badge badge-info">${t.payment_method||"—"}</span></td>
                  <td style="font-family:monospace;font-size:0.75rem;color:var(--text-muted);">${t.reference_number||"—"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `:c.innerHTML='<div class="empty-state"><i class="fa-solid fa-receipt"></i><p>No payments recorded</p></div>';const u=document.getElementById("outstandingList");d.length?u.innerHTML=`
          <table class="data-table">
            <thead><tr><th>Customer</th><th>Due Date</th><th>Amount</th></tr></thead>
            <tbody>
              ${d.slice(0,20).map(t=>`
                <tr>
                  <td style="font-weight:600;">${t.full_name||t.customer_name||"—"}</td>
                  <td>${v(t.due_date||t.next_due_date)}</td>
                  <td style="color:var(--warning);font-weight:600;">${i(t.amount_due||t.next_amount_due)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `:u.innerHTML='<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>No outstanding balances</p></div>'}catch(s){b.error("Failed to load accounts: "+s.message)}}};export{L as default};

import{a as v,r as y,i as b}from"./sidebar-C6JJCDNJ.js";import{toast as _}from"./toast-CQ5lsFjN.js";import"./index-BLFn9FJy.js";function i(a){return"£"+(parseFloat(a)||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}function g(a){return a?new Date(a).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"}const F={async mount(a){a.innerHTML=`
      ${y("/accounts")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-sterling-sign" style="color:var(--primary);"></i> Accounts</h1>
          <p>Payment history and outstanding balances</p>
        </div>

        <!-- Finance metric dials — mirrors accounts.html fin-metrics-grid exactly -->
        <div class="fin-metrics-grid" id="kpiRow">
          ${[{id:"total",cls:"card-fin-revenue",fin:"--fin-color:#10b981"},{id:"month",cls:"card-fin-deposits",fin:"--fin-color:#6366f1"},{id:"outstanding",cls:"card-fin-outstanding",fin:"--fin-color:#f59e0b"},{id:"recurring",cls:"card-fin-recurring",fin:"--fin-color:#0ea5e9"}].map(s=>`
            <div class="fin-metric-card ${s.cls}" id="acc-kpi-${s.id}" style="--pct:0%">
              <div class="fin-dial-ring" style="--pct:0%">
                <span class="fin-dial-short">—</span>
              </div>
              <div class="fin-metric-info">
                <div class="fin-metric-label">&nbsp;</div>
                <div class="fin-metric-val">—</div>
                <div class="fin-metric-sub">
                  <span class="spinner" style="width:12px;height:12px;border-width:2px;margin:0;display:inline-block;vertical-align:middle;"></span>
                </div>
              </div>
            </div>
          `).join("")}
        </div>

        <div class="table-wrap">
          <div class="table-title"><i class="fa-solid fa-receipt"></i> Recent Payments</div>
          <div id="recentPayments" class="table-inner"><div class="spinner" style="margin:2rem auto;"></div></div>
        </div>

        <div class="table-wrap">
          <div class="table-title"><i class="fa-solid fa-circle-exclamation" style="color:var(--warning);"></i> Outstanding Balances</div>
          <div id="outstandingList" class="table-inner"><div class="spinner" style="margin:2rem auto;"></div></div>
        </div>
      </main>
    `,b(),this._load()},async _load(){var a,s;try{const[l,u]=await Promise.allSettled([v.get("/accounts/transactions"),v.get("/recurring/outstanding-payments")]),d=l.status==="fulfilled"?((a=l.value)==null?void 0:a.data)||[]:[],n=u.status==="fulfilled"?((s=u.value)==null?void 0:s.data)||[]:[],r=d.reduce((t,e)=>t+parseFloat(e.amount||0),0),o=new Date,c=d.filter(t=>{const e=new Date(t.payment_date||t.created_at);return e.getMonth()===o.getMonth()&&e.getFullYear()===o.getFullYear()}).reduce((t,e)=>t+parseFloat(e.amount||0),0),m=n.reduce((t,e)=>t+parseFloat(e.amount_due||e.next_amount_due||0),0),h=(t,e)=>`${Math.min(Math.round((parseFloat(t)||0)/e*100),100)}%`;[{id:"total",label:"Total Revenue",val:i(r),short:i(r),pct:r>0?"75%":"0%"},{id:"month",label:o.toLocaleString("en-GB",{month:"long"}),val:i(c),short:i(c),pct:c>0?"60%":"0%"},{id:"outstanding",label:"Outstanding",val:i(m),short:i(m),pct:m>0?"70%":"0%"},{id:"recurring",label:"Recurring Contracts",val:String(n.length),short:String(n.length),pct:h(n.length,10)}].forEach(t=>{const e=document.getElementById(`acc-kpi-${t.id}`);e&&(e.style.setProperty("--pct",t.pct),e.innerHTML=`
          <div class="fin-dial-ring" style="--pct:${t.pct}">
            <span class="fin-dial-short">${t.short}</span>
          </div>
          <div class="fin-metric-info">
            <div class="fin-metric-label">${t.label}</div>
            <div class="fin-metric-val">${t.val}</div>
          </div>
        `)});const p=document.getElementById("recentPayments");d.length?p.innerHTML=`
          <table>
            <thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Method</th><th>Type</th><th>Ref</th></tr></thead>
            <tbody>
              ${d.slice(0,20).map(t=>`
                <tr>
                  <td style="color:var(--text-muted);font-size:0.8rem;white-space:nowrap;">${g(t.payment_date||t.created_at)}</td>
                  <td style="font-weight:600;">${t.customer_name||t.customer_id||"—"}</td>
                  <td style="color:var(--success);font-weight:600;">${i(t.amount)}</td>
                  <td><span class="badge badge-info">${t.payment_method||"—"}</span></td>
                  <td><span class="type-pill type-${(t.payment_type||"payment").toLowerCase()}">${t.payment_type||"payment"}</span></td>
                  <td style="font-family:monospace;font-size:0.75rem;color:var(--text-muted);">${t.reference_number||"—"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `:p.innerHTML='<div class="empty-state" style="padding:3rem;"><i class="fa-solid fa-receipt"></i><p>No payments recorded</p></div>';const f=document.getElementById("outstandingList");n.length?f.innerHTML=`
          <table>
            <thead><tr><th>Customer</th><th>Due Date</th><th>Amount</th></tr></thead>
            <tbody>
              ${n.slice(0,20).map(t=>`
                <tr>
                  <td style="font-weight:600;">${t.full_name||t.customer_name||"—"}</td>
                  <td>${g(t.due_date||t.next_due_date)}</td>
                  <td style="color:var(--warning);font-weight:600;">${i(t.amount_due||t.next_amount_due)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `:f.innerHTML='<div class="empty-state" style="padding:3rem;"><i class="fa-solid fa-circle-check"></i><p>No outstanding balances</p></div>'}catch(l){_.error("Failed to load accounts: "+l.message)}}};export{F as default};

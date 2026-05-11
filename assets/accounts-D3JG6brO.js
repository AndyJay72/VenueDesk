import{a as u,r as h,i as f}from"./sidebar-CLg1KTqr.js";import{toast as b}from"./toast-CQ5lsFjN.js";import"./index-DBnBgkrA.js";function n(a){return"£"+(parseFloat(a)||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}function v(a){return a?new Date(a).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"}const x={async mount(a){a.innerHTML=`
      ${h("/accounts")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-sterling-sign" style="color:var(--primary);"></i> Accounts</h1>
          <p>Payment history and outstanding balances</p>
        </div>

        <div class="summary-strip" id="kpiRow">
          ${["total","month","outstanding","recurring"].map(s=>`
            <div class="sum-card" id="acc-kpi-${s}">
              <div class="sum-val">—</div>
              <div class="sum-lbl"><div class="spinner" style="width:12px;height:12px;border-width:2px;margin:0;display:inline-block;"></div></div>
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
    `,f(),this._load()},async _load(){var a,s;try{const[i,r]=await Promise.allSettled([u.get("/accounts/transactions"),u.get("/recurring/outstanding-payments")]),o=i.status==="fulfilled"?((a=i.value)==null?void 0:a.data)||[]:[],l=r.status==="fulfilled"?((s=r.value)==null?void 0:s.data)||[]:[],p=o.reduce((t,e)=>t+parseFloat(e.amount||0),0),d=new Date,g=o.filter(t=>{const e=new Date(t.payment_date||t.created_at);return e.getMonth()===d.getMonth()&&e.getFullYear()===d.getFullYear()}).reduce((t,e)=>t+parseFloat(e.amount||0),0),y=l.reduce((t,e)=>t+parseFloat(e.amount_due||e.next_amount_due||0),0);[{id:"total",label:"Total Revenue",value:n(p),color:"var(--success)"},{id:"month",label:`${d.toLocaleString("en-GB",{month:"long"})}`,value:n(g),color:"var(--primary)"},{id:"outstanding",label:"Outstanding",value:n(y),color:"var(--warning)"},{id:"recurring",label:"Recurring Contracts",value:l.length,color:"var(--info)"}].forEach(t=>{const e=document.getElementById(`acc-kpi-${t.id}`);e&&(e.innerHTML=`<div class="sum-val" style="color:${t.color};">${t.value}</div><div class="sum-lbl">${t.label}</div>`)});const c=document.getElementById("recentPayments");o.length?c.innerHTML=`
          <table>
            <thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Method</th><th>Type</th><th>Ref</th></tr></thead>
            <tbody>
              ${o.slice(0,20).map(t=>`
                <tr>
                  <td style="color:var(--text-muted);font-size:0.8rem;white-space:nowrap;">${v(t.payment_date||t.created_at)}</td>
                  <td style="font-weight:600;">${t.customer_name||t.customer_id||"—"}</td>
                  <td style="color:var(--success);font-weight:600;">${n(t.amount)}</td>
                  <td><span class="badge badge-info">${t.payment_method||"—"}</span></td>
                  <td><span class="type-pill type-${(t.payment_type||"payment").toLowerCase()}">${t.payment_type||"payment"}</span></td>
                  <td style="font-family:monospace;font-size:0.75rem;color:var(--text-muted);">${t.reference_number||"—"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `:c.innerHTML='<div class="empty-state" style="padding:3rem;"><i class="fa-solid fa-receipt"></i><p>No payments recorded</p></div>';const m=document.getElementById("outstandingList");l.length?m.innerHTML=`
          <table>
            <thead><tr><th>Customer</th><th>Due Date</th><th>Amount</th></tr></thead>
            <tbody>
              ${l.slice(0,20).map(t=>`
                <tr>
                  <td style="font-weight:600;">${t.full_name||t.customer_name||"—"}</td>
                  <td>${v(t.due_date||t.next_due_date)}</td>
                  <td style="color:var(--warning);font-weight:600;">${n(t.amount_due||t.next_amount_due)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `:m.innerHTML='<div class="empty-state" style="padding:3rem;"><i class="fa-solid fa-circle-check"></i><p>No outstanding balances</p></div>'}catch(i){b.error("Failed to load accounts: "+i.message)}}};export{x as default};

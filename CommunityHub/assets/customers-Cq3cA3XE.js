import{r as m,i as c,a as u}from"./sidebar-C8xt7GmK.js";import"./index-CBNA1kT4.js";function h(s){return s?new Date(s).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—"}const y={async mount(s){s.innerHTML=`
      ${m("/customers")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-users" style="color:var(--primary);"></i> Customers</h1>
          <p>All venue customers and their booking history</p>
        </div>
        <div class="card">
          <div style="display:flex;gap:1rem;margin-bottom:1.25rem;align-items:center;">
            <input id="search" class="form-input" placeholder="Search by name or email…" style="max-width:280px;" />
            <button class="btn btn-primary" id="refreshBtn"><i class="fa-solid fa-rotate-right"></i></button>
            <span id="countBadge" class="badge badge-muted" style="margin-left:auto;"></span>
          </div>
          <div id="customerTable"><div class="spinner"></div></div>
        </div>
      </main>
    `,c();let n=[];const r=(e="")=>{const a=e?n.filter(t=>(t.full_name+t.email).toLowerCase().includes(e.toLowerCase())):n,i=document.getElementById("customerTable"),l=document.getElementById("countBadge");if(l&&(l.textContent=`${a.length} customers`),!a.length){i.innerHTML='<div class="empty-state"><i class="fa-solid fa-users"></i><p>No customers found</p></div>';return}i.innerHTML=`
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Last Booking</th></tr></thead>
          <tbody>
            ${a.map(t=>`
              <tr>
                <td style="font-weight:600;">${t.full_name||"—"}</td>
                <td style="color:var(--text-muted);">${t.email||"—"}</td>
                <td style="color:var(--text-muted);">${t.phone||"—"}</td>
                <td><span class="badge badge-${t.status==="booked"?"success":t.status==="pending"?"warning":"muted"}">${t.status||"—"}</span></td>
                <td style="color:var(--text-muted);">${h(t.date_from)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `},d=async()=>{var e;try{const{data:a}=await u.get("/customers/list");n=a||[],r(((e=document.getElementById("search"))==null?void 0:e.value)||"")}catch{document.getElementById("customerTable").innerHTML='<p style="color:var(--danger);">Failed to load customers.</p>'}};document.getElementById("refreshBtn").addEventListener("click",d);let o;document.getElementById("search").addEventListener("input",e=>{clearTimeout(o),o=setTimeout(()=>r(e.target.value),300)}),d()}};export{y as default};

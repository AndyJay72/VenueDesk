import{a as m,r as p,i as u}from"./sidebar-C8xt7GmK.js";import{toast as f}from"./toast-CQ5lsFjN.js";import"./index-CBNA1kT4.js";function v(e){return e?new Date(e).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—"}const g={info:"info",warn:"warning",error:"danger"},b={async mount(e){e.innerHTML=`
      ${p("/audit-log")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-list-check" style="color:var(--primary);"></i> Audit Log</h1>
          <p>System actions and events</p>
        </div>

        <div class="card">
          <div style="display:flex;gap:1rem;margin-bottom:1.25rem;flex-wrap:wrap;align-items:center;">
            <select id="filterLevel" class="form-select" style="width:140px;">
              <option value="">All Levels</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>
            <input id="filterSource" type="text" class="form-input" placeholder="Filter by source…" style="width:200px;" />
            <select id="filterLimit" class="form-select" style="width:120px;">
              <option value="100">100 rows</option>
              <option value="250">250 rows</option>
              <option value="500">500 rows</option>
            </select>
            <button class="btn btn-primary" id="refreshBtn"><i class="fa-solid fa-rotate-right"></i> Refresh</button>
          </div>
          <div id="logTable"><div class="spinner"></div></div>
        </div>
      </main>
    `,u();const t=()=>this._load();document.getElementById("refreshBtn").addEventListener("click",t),document.getElementById("filterLevel").addEventListener("change",t),document.getElementById("filterLimit").addEventListener("change",t);let o;document.getElementById("filterSource").addEventListener("input",()=>{clearTimeout(o),o=setTimeout(t,400)}),this._load()},async _load(){var n,l,r;const e=document.getElementById("logTable"),t=(n=document.getElementById("filterLevel"))==null?void 0:n.value,o=(l=document.getElementById("filterSource"))==null?void 0:l.value.trim(),d=parseInt(((r=document.getElementById("filterLimit"))==null?void 0:r.value)||"100");try{const a={limit:d};t&&(a.level=t),o&&(a.source=o);const{data:c}=await m.get("/admin/logs",a),s=c||[];if(!s.length){e.innerHTML='<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>No log entries found</p></div>';return}e.innerHTML=`
        <table class="data-table">
          <thead>
            <tr><th>Time</th><th>Level</th><th>Source</th><th>Message</th><th>Tenant</th></tr>
          </thead>
          <tbody>
            ${s.map(i=>`
              <tr>
                <td style="white-space:nowrap;color:var(--text-muted);font-size:0.8rem;">${v(i.created_at)}</td>
                <td><span class="badge badge-${g[i.level]||"muted"}">${i.level}</span></td>
                <td style="font-family:monospace;font-size:0.8rem;color:var(--text-muted);">${i.source||"—"}</td>
                <td style="max-width:400px;">${i.message||"—"}</td>
                <td style="color:var(--text-muted);">${i.tenant_id??"—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}catch(a){e.innerHTML=`<p style="color:var(--danger);">Failed to load logs: ${a.message}</p>`,f.error("Failed to load audit log")}}};export{b as default};

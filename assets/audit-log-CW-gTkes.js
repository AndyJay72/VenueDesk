import{a as m,r as u,i as p}from"./sidebar-CLg1KTqr.js";import{toast as f}from"./toast-CQ5lsFjN.js";import"./index-DBnBgkrA.js";function v(e){return e?new Date(e).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—"}const g={info:"info",warn:"warning",error:"danger"},w={async mount(e){e.innerHTML=`
      ${u("/audit-log")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-list-check" style="color:var(--primary);"></i> Audit Log</h1>
          <p>System actions and events</p>
        </div>

        <div class="filter-row">
          <select id="filterLevel" class="f-select" style="width:140px;">
            <option value="">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
          <input id="filterSource" type="text" class="f-input" placeholder="Filter by source…" style="max-width:220px;" />
          <select id="filterLimit" class="f-select" style="width:120px;">
            <option value="100">100 rows</option>
            <option value="250">250 rows</option>
            <option value="500">500 rows</option>
          </select>
          <button class="f-btn" id="refreshBtn"><i class="fa-solid fa-rotate-right"></i> Refresh</button>
        </div>

        <div class="table-wrap">
          <div id="logTable" class="table-inner"><div class="spinner" style="margin:2rem auto;"></div></div>
        </div>
      </main>
    `,p();const t=()=>this._load();document.getElementById("refreshBtn").addEventListener("click",t),document.getElementById("filterLevel").addEventListener("change",t),document.getElementById("filterLimit").addEventListener("change",t);let o;document.getElementById("filterSource").addEventListener("input",()=>{clearTimeout(o),o=setTimeout(t,400)}),this._load()},async _load(){var a,l,s;const e=document.getElementById("logTable"),t=(a=document.getElementById("filterLevel"))==null?void 0:a.value,o=(l=document.getElementById("filterSource"))==null?void 0:l.value.trim(),d=parseInt(((s=document.getElementById("filterLimit"))==null?void 0:s.value)||"100");try{const n={limit:d};t&&(n.level=t),o&&(n.source=o);const{data:c}=await m.get("/admin/logs",n),r=c||[];if(!r.length){e.innerHTML='<div class="empty-state" style="padding:3rem;"><i class="fa-solid fa-list-check"></i><p>No log entries found</p></div>';return}e.innerHTML=`
        <table>
          <thead>
            <tr><th>Time</th><th>Level</th><th>Source</th><th>Message</th><th>Tenant</th></tr>
          </thead>
          <tbody>
            ${r.map(i=>`
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
      `}catch(n){e.innerHTML=`<p style="color:var(--danger);">Failed to load logs: ${n.message}</p>`,f.error("Failed to load audit log")}}};export{w as default};

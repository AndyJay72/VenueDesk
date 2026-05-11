import{a as o,s as u}from"./index-C4GfeYAM.js";const g="https://api.venuedesk.co.uk",h="https://n8n.srv1090894.hstgr.cloud/webhook";async function p(t){if(t.status===401){const a=o.expiresIn();if(a<=0)throw console.warn(`[api] 401 — token expired. Current: ${new Date().toISOString()}, expiresIn: ${a}s. URL: ${t.url}`),o.clearSession(),window.location.hash="#/login",new r(401,"Session expired. Please log in again.");let s={};try{s=await t.json()}catch{}throw console.warn(`[api] 401 — API rejected request but token has ${a}s remaining. URL: ${t.url}. Server message: ${JSON.stringify(s)}. NOT logging out.`),new r(401,(s==null?void 0:s.message)||(s==null?void 0:s.error)||"Unauthorised",s==null?void 0:s.code)}let e;try{e=await t.json()}catch{e={}}if(!t.ok){const a=(e==null?void 0:e.message)||(e==null?void 0:e.error)||`HTTP ${t.status}`;throw new r(t.status,a,e==null?void 0:e.code)}return e}class r extends Error{constructor(e,a,s){super(a),this.status=e,this.code=s}}async function d(t,{method:e="GET",body:a,params:s,noAuth:i=!1}={}){const l=new URL(g+t);if(e==="GET"){if(!i){const c=o.getTenantId(),n=o.getToken();c&&l.searchParams.set("tenant_id",String(c)),n&&l.searchParams.set("jwt",n)}return s&&Object.entries(s).forEach(([c,n])=>{n!=null&&l.searchParams.set(c,String(n))}),p(await fetch(l.toString(),{method:"GET",headers:{"Content-Type":"application/json"}}))}const f=i?a||{}:{jwt:o.getToken(),...a||{}};return s&&Object.entries(s).forEach(([c,n])=>{n!=null&&l.searchParams.set(c,String(n))}),p(await fetch(l.toString(),{method:e,headers:{"Content-Type":"application/json"},body:JSON.stringify(f)}))}const w={get:(t,e)=>d(t,{method:"GET",params:e}),post:(t,e)=>d(t,{method:"POST",body:e}),put:(t,e)=>d(t,{method:"PUT",body:e}),patch:(t,e)=>d(t,{method:"PATCH",body:e}),delete:(t,e)=>d(t,{method:"DELETE",body:e}),postPublic:(t,e)=>d(t,{method:"POST",body:e,noAuth:!0})};async function v(t,e={}){const a=await fetch(h+t,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jwt:o.getToken(),...e})});if(!a.ok){const s=await a.json().catch(()=>({}));throw new r(a.status,(s==null?void 0:s.message)||`N8n error ${a.status}`)}return a.json()}const b=[{path:"/dashboard",icon:"fa-solid fa-gauge-high",label:"Dashboard"},{path:"/calendar",icon:"fa-solid fa-calendar-days",label:"Calendar"},{path:"/accounts",icon:"fa-solid fa-sterling-sign",label:"Accounts"},{path:"/customers",icon:"fa-solid fa-users",label:"Customers"},{path:"/recurring-bookings",icon:"fa-solid fa-rotate",label:"Recurring"},{path:"/audit-log",icon:"fa-solid fa-list-check",label:"Audit Log"},{path:"/admin-config",icon:"fa-solid fa-gear",label:"Config"}];function y(t){return`
    <button class="menu-toggle" id="menuToggle" aria-label="Open menu">
      <i class="fa-solid fa-bars"></i>
    </button>
    <div class="overlay" id="overlay"></div>

    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <i class="fa-solid fa-layer-group"></i>
        <span class="brand-text">VenueDesk</span>
      </div>

      <nav>${b.map(a=>`
      <a href="#${a.path}"
         class="nav-link${t===a.path?" active":""}"
         data-label="${a.label}">
        <i class="${a.icon}"></i>
        <span class="nav-label">${a.label}</span>
      </a>
    `).join("")}</nav>

      <div class="sidebar-footer">
        <div style="padding: 6px 12px; margin-bottom: 4px;">
          <div style="font-size:0.78rem; color:var(--text-muted);">Signed in as</div>
          <div style="font-size:0.85rem; font-weight:600; color:var(--text-main); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${o.getUserName()}
          </div>
        </div>
        <button class="collapse-btn" id="collapseBtn">
          <i class="fa-solid fa-chevron-left"></i>
          <span class="collapse-label">Collapse</span>
        </button>
        <button class="nav-link" id="logoutBtn" style="width:100%; background:none; border:none; text-align:left; margin-top:4px;">
          <i class="fa-solid fa-right-from-bracket"></i>
          <span class="nav-label">Log out</span>
        </button>
      </div>
    </aside>
  `}function k(){const t=document.getElementById("sidebar"),e=document.getElementById("overlay"),a=document.getElementById("collapseBtn"),s=document.getElementById("menuToggle"),i=document.getElementById("logoutBtn");u.sidebarCollapsed&&document.body.classList.add("sidebar-collapsed"),a==null||a.addEventListener("click",()=>{document.body.classList.toggle("sidebar-collapsed"),u.sidebarCollapsed=document.body.classList.contains("sidebar-collapsed")}),s==null||s.addEventListener("click",()=>{t==null||t.classList.add("open"),e==null||e.classList.add("active")}),e==null||e.addEventListener("click",()=>{t==null||t.classList.remove("open"),e==null||e.classList.remove("active")}),i==null||i.addEventListener("click",()=>{confirm("Log out of VenueDesk?")&&o.logout()})}export{w as a,k as i,v as n,y as r};

import{a as o,s as u}from"./index-CBNA1kT4.js";const g="https://api.venuedesk.co.uk",h="https://n8n.srv1090894.hstgr.cloud/webhook";async function f(e){if(e.status===401)throw o.clearSession(),window.location.hash="#/login",new r(401,"Session expired. Please log in again.");let t;try{t=await e.json()}catch{t={}}if(!e.ok){const a=(t==null?void 0:t.message)||(t==null?void 0:t.error)||`HTTP ${e.status}`;throw new r(e.status,a,t==null?void 0:t.code)}return t}class r extends Error{constructor(t,a,s){super(a),this.status=t,this.code=s}}async function d(e,{method:t="GET",body:a,params:s,noAuth:i=!1}={}){const l=new URL(g+e);if(t==="GET"){if(!i){const c=o.getTenantId(),n=o.getToken();c&&l.searchParams.set("tenant_id",String(c)),n&&l.searchParams.set("jwt",n)}return s&&Object.entries(s).forEach(([c,n])=>{n!=null&&l.searchParams.set(c,String(n))}),f(await fetch(l.toString(),{method:"GET",headers:{"Content-Type":"application/json"}}))}const p=i?a||{}:{jwt:o.getToken(),...a||{}};return s&&Object.entries(s).forEach(([c,n])=>{n!=null&&l.searchParams.set(c,String(n))}),f(await fetch(l.toString(),{method:t,headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}))}const v={get:(e,t)=>d(e,{method:"GET",params:t}),post:(e,t)=>d(e,{method:"POST",body:t}),put:(e,t)=>d(e,{method:"PUT",body:t}),patch:(e,t)=>d(e,{method:"PATCH",body:t}),delete:(e,t)=>d(e,{method:"DELETE",body:t}),postPublic:(e,t)=>d(e,{method:"POST",body:t,noAuth:!0})};async function w(e,t={}){const a=await fetch(h+e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jwt:o.getToken(),...t})});if(!a.ok){const s=await a.json().catch(()=>({}));throw new r(a.status,(s==null?void 0:s.message)||`N8n error ${a.status}`)}return a.json()}const b=[{path:"/dashboard",icon:"fa-solid fa-gauge-high",label:"Dashboard"},{path:"/calendar",icon:"fa-solid fa-calendar-days",label:"Calendar"},{path:"/accounts",icon:"fa-solid fa-sterling-sign",label:"Accounts"},{path:"/customers",icon:"fa-solid fa-users",label:"Customers"},{path:"/recurring-bookings",icon:"fa-solid fa-rotate",label:"Recurring"},{path:"/audit-log",icon:"fa-solid fa-list-check",label:"Audit Log"},{path:"/admin-config",icon:"fa-solid fa-gear",label:"Config"}];function y(e){return`
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
         class="nav-link${e===a.path?" active":""}"
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
  `}function E(){const e=document.getElementById("sidebar"),t=document.getElementById("overlay"),a=document.getElementById("collapseBtn"),s=document.getElementById("menuToggle"),i=document.getElementById("logoutBtn");u.sidebarCollapsed&&document.body.classList.add("sidebar-collapsed"),a==null||a.addEventListener("click",()=>{document.body.classList.toggle("sidebar-collapsed"),u.sidebarCollapsed=document.body.classList.contains("sidebar-collapsed")}),s==null||s.addEventListener("click",()=>{e==null||e.classList.add("open"),t==null||t.classList.add("active")}),t==null||t.addEventListener("click",()=>{e==null||e.classList.remove("open"),t==null||t.classList.remove("active")}),i==null||i.addEventListener("click",()=>{confirm("Log out of VenueDesk?")&&o.logout()})}export{v as a,E as i,w as n,y as r};

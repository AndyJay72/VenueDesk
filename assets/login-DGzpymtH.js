import{a as c,s as u}from"./index-CBNA1kT4.js";import{toast as b}from"./toast-CQ5lsFjN.js";const w="https://n8n.srv1090894.hstgr.cloud/webhook/login",I={async mount(m){var i;m.innerHTML=`
      <div class="login-wrap">
        <div class="card login-card">
          <div class="login-brand">
            <i class="fa-solid fa-layer-group"></i>
            <h1>VenueDesk</h1>
            <p>Booking &amp; Venue Management</p>
          </div>

          <form id="loginForm" autocomplete="on">
            <div class="input-group">
              <label for="username">Username</label>
              <input
                id="username"
                type="text"
                class="form-input"
                placeholder="Enter your username"
                autocomplete="username"
                required
              />
            </div>
            <div class="input-group">
              <label for="password">Password</label>
              <div style="position:relative;">
                <input
                  id="password"
                  type="password"
                  class="form-input"
                  placeholder="Enter your password"
                  autocomplete="current-password"
                  required
                  style="padding-right: 2.5rem;"
                />
                <button
                  type="button"
                  id="togglePwd"
                  style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);"
                  aria-label="Show/hide password"
                >
                  <i class="fa-solid fa-eye" id="eyeIcon"></i>
                </button>
              </div>
            </div>

            <button type="submit" class="btn btn-primary" id="loginBtn" style="width:100%; justify-content:center; padding: 12px;">
              <i class="fa-solid fa-right-to-bracket"></i>
              <span id="loginBtnText">Sign In</span>
            </button>

            <p id="loginError"
               style="color:var(--danger); font-size:0.82rem; text-align:center; margin-top:1rem; display:none;">
            </p>
          </form>
        </div>
      </div>
    `;const p=document.getElementById("loginForm"),s=document.getElementById("loginBtn"),a=document.getElementById("loginBtnText"),o=document.getElementById("loginError"),g=document.getElementById("togglePwd"),r=document.getElementById("password"),y=document.getElementById("eyeIcon");g.addEventListener("click",()=>{const n=r.type==="password";r.type=n?"text":"password",y.className=`fa-solid fa-eye${n?"-slash":""}`}),p.addEventListener("submit",async n=>{var l;n.preventDefault(),o.style.display="none",s.disabled=!0,a.textContent="Signing in…";const d=document.getElementById("username").value.trim(),f=document.getElementById("password").value;try{const t=await fetch(w,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:d,password:f})}),e=await t.json();if(!t.ok||!e.token)throw new Error(e.message||(t.status===401?"Invalid credentials":"Login failed"));c.setSession(e),u.user=e.user,u.tenantId=((l=e.user)==null?void 0:l.tenant_id)??null,b.success(`Welcome back, ${c.getUserName()||d}`),window.location.hash="#/dashboard"}catch(t){const e=t.message||"Login failed. Please try again.";o.textContent=e,o.style.display="block",s.disabled=!1,a.textContent="Sign In"}}),(i=document.getElementById("username"))==null||i.focus()}};export{I as default};

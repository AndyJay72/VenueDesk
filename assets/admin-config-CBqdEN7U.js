import{a as o,r,i as d}from"./sidebar-C8xt7GmK.js";import{a as l}from"./index-CBNA1kT4.js";import{toast as c}from"./toast-CQ5lsFjN.js";const m=[{id:"rooms",icon:"fa-door-open",label:"Rooms"},{id:"payments",icon:"fa-credit-card",label:"Payments"},{id:"settings",icon:"fa-gear",label:"Settings"}],g={_activeTab:"rooms",async mount(t){if(!l.isAdmin()){t.innerHTML=`
        ${r("/admin-config")}
        <main class="content">
          <div class="loading-state"><i class="fa-solid fa-lock" style="font-size:2rem;color:var(--danger);"></i><p>Admin access required.</p></div>
        </main>
      `,d();return}t.innerHTML=`
      ${r("/admin-config")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-gear" style="color:var(--primary);"></i> Config Manager</h1>
        </div>

        <!-- Tab bar -->
        <div style="display:flex;gap:6px;margin-bottom:1.5rem;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:6px;width:fit-content;">
          ${m.map(e=>`
            <button class="tab-btn${e.id===this._activeTab?" active":""}" data-tab="${e.id}"
              style="padding:8px 20px;border:none;border-radius:8px;background:${e.id===this._activeTab?"var(--primary)":"transparent"};
                     color:${e.id===this._activeTab?"white":"var(--text-muted)"};font-weight:600;font-size:0.88rem;cursor:pointer;transition:all 0.2s;">
              <i class="fa-solid ${e.icon}"></i> ${e.label}
            </button>
          `).join("")}
        </div>

        <div id="tabContent"></div>
      </main>
    `,d(),t.querySelectorAll(".tab-btn").forEach(e=>{e.addEventListener("click",()=>{this._activeTab=e.dataset.tab,t.querySelectorAll(".tab-btn").forEach(s=>{s.style.background="transparent",s.style.color="var(--text-muted)"}),e.style.background="var(--primary)",e.style.color="white",this._renderTab()})}),this._renderTab()},_renderTab(){const t=document.getElementById("tabContent");this._activeTab==="rooms"&&this._renderRooms(t),this._activeTab==="payments"&&this._renderPayments(t),this._activeTab==="settings"&&this._renderSettings(t)},_renderRooms(t){t.innerHTML='<div class="card"><div class="card-title"><i class="fa-solid fa-door-open"></i> Rooms</div><div id="roomsContent"><div class="spinner"></div></div></div>',o.get("/config/rooms").then(({data:e})=>{const s=e||[];document.getElementById("roomsContent").innerHTML=s.length?`<table class="data-table"><thead><tr><th>Name</th><th>Capacity</th><th>Hourly Rate</th><th>Active</th></tr></thead>
           <tbody>${s.map(a=>`<tr><td style="font-weight:600;">${a.name}</td><td>${a.capacity||"—"}</td><td>£${parseFloat(a.hourly_rate||0).toFixed(2)}</td>
           <td><span class="badge badge-${a.active?"success":"muted"}">${a.active?"Active":"Inactive"}</span></td></tr>`).join("")}</tbody></table>`:'<div class="empty-state"><i class="fa-solid fa-door-open"></i><p>No rooms configured</p></div>'}).catch(()=>{document.getElementById("roomsContent").innerHTML='<p style="color:var(--danger);">Failed to load rooms.</p>'})},_renderPayments(t){t.innerHTML=`
      <div class="grid-2">
        <!-- Stripe card -->
        <div class="card">
          <div class="card-title"><i class="fa-brands fa-stripe" style="color:#635bff;"></i> Stripe Payments</div>
          <div id="stripeForm"><div class="spinner"></div></div>
        </div>
        <!-- BACS card -->
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-building-columns"></i> BACS Bank Transfer</div>
          <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1.25rem;">
            Shown to customers choosing bank transfer.
          </p>
          <div class="input-group"><label>Account Name</label><input type="text" id="bacsName" class="form-input" /></div>
          <div class="input-group"><label>Sort Code</label><input type="text" id="bacsSort" class="form-input" placeholder="00-00-00" maxlength="8" /></div>
          <div class="input-group"><label>Account Number</label><input type="text" id="bacsNumber" class="form-input" placeholder="12345678" maxlength="8" /></div>
          <button class="btn btn-primary" id="saveBacsBtn"><i class="fa-solid fa-floppy-disk"></i> Save BACS</button>
          <span id="bacsStatus" style="margin-left:10px;font-size:0.82rem;color:var(--text-muted);"></span>
        </div>
      </div>
    `,this._loadPaymentSettings()},async _loadPaymentSettings(){try{const{data:t}=await o.post("/admin/payment-settings/load",{}),e=t||{};document.getElementById("stripeForm").innerHTML=`
        <div class="input-group" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <label style="margin:0;">Enable Stripe Card Payments</label>
          <input type="checkbox" id="stripeEnabled" ${e.is_stripe_enabled?"checked":""} style="width:18px;height:18px;cursor:pointer;">
        </div>
        <div class="input-group"><label>Publishable Key</label><input type="text" id="stripePubKey" class="form-input" value="${e.stripe_publishable_key||""}" placeholder="pk_live_..." /></div>
        <div class="input-group">
          <label>Secret Key <span style="color:var(--text-muted);font-weight:400;">(leave blank to keep)</span></label>
          <input type="password" id="stripeSecretKey" class="form-input" placeholder="sk_live_..." />
        </div>
        <div style="background:rgba(99,91,255,0.08);border:1px solid rgba(99,91,255,0.2);border-radius:8px;padding:12px;margin:1rem 0;font-size:0.8rem;">
          <p style="color:#a5b4fc;font-weight:700;margin-bottom:6px;"><i class="fa-solid fa-circle-info"></i> Webhook Setup</p>
          <p style="color:var(--text-muted);line-height:1.7;">
            In <a href="https://dashboard.stripe.com/webhooks" target="_blank" style="color:#818cf8;">Stripe Dashboard → Webhooks</a>, 
            add endpoint: <code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;">https://api.venuedesk.co.uk/stripe/webhook</code>
            and select event <strong style="color:var(--text-main);">checkout.session.completed</strong>
          </p>
        </div>
        <div class="input-group">
          <label>Webhook Secret <span style="color:var(--text-muted);font-weight:400;">(leave blank to keep)</span></label>
          <input type="password" id="stripeWebhook" class="form-input" placeholder="whsec_..." />
        </div>
        <div style="display:flex;gap:8px;margin-bottom:1rem;">
          <span id="skBadge" class="badge badge-${e.has_secret_key?"success":"muted"}">
            <i class="fa-solid fa-key"></i> Secret key: ${e.has_secret_key?"saved ✓":"not set"}
          </span>
          <span id="whBadge" class="badge badge-${e.has_webhook_secret?"success":"muted"}">
            <i class="fa-solid fa-shield"></i> Webhook: ${e.has_webhook_secret?"saved ✓":"not set"}
          </span>
        </div>
        <button class="btn btn-primary" id="saveStripeBtn"><i class="fa-solid fa-floppy-disk"></i> Save Stripe Settings</button>
        <span id="stripeStatus" style="margin-left:10px;font-size:0.82rem;"></span>
      `,document.getElementById("bacsName")&&(document.getElementById("bacsName").value=e.bacs_account_name||""),document.getElementById("bacsSort")&&(document.getElementById("bacsSort").value=e.bacs_sort_code||""),document.getElementById("bacsNumber")&&(document.getElementById("bacsNumber").value=e.bacs_account_number||""),this._wirePaymentSave()}catch{document.getElementById("stripeForm").innerHTML='<p style="color:var(--danger);">Failed to load payment settings.</p>'}},_wirePaymentSave(){var e,s;const t=(a,i,p)=>{const n=document.getElementById(a);n&&(n.style.color=p?"var(--success)":"var(--danger)",n.textContent=i,setTimeout(()=>{n.textContent="",n.style.color=""},4e3))};(e=document.getElementById("saveStripeBtn"))==null||e.addEventListener("click",async()=>{const a=document.getElementById("saveStripeBtn");a.disabled=!0;try{await o.post("/admin/payment-settings/save",{is_stripe_enabled:document.getElementById("stripeEnabled").checked,stripe_publishable_key:document.getElementById("stripePubKey").value.trim(),stripe_secret_key:document.getElementById("stripeSecretKey").value.trim(),stripe_webhook_secret:document.getElementById("stripeWebhook").value.trim()}),document.getElementById("stripeSecretKey").value="",document.getElementById("stripeWebhook").value="",t("stripeStatus","✓ Saved",!0),c.success("Stripe settings saved"),await this._loadPaymentSettings()}catch(i){t("stripeStatus","✗ "+i.message,!1)}finally{a.disabled=!1}}),(s=document.getElementById("saveBacsBtn"))==null||s.addEventListener("click",async()=>{const a=document.getElementById("saveBacsBtn");a.disabled=!0;try{await o.post("/admin/payment-settings/save",{bacs_account_name:document.getElementById("bacsName").value.trim(),bacs_sort_code:document.getElementById("bacsSort").value.trim(),bacs_account_number:document.getElementById("bacsNumber").value.trim()}),t("bacsStatus","✓ Saved",!0),c.success("BACS details saved")}catch(i){t("bacsStatus","✗ "+i.message,!1)}finally{a.disabled=!1}})},_renderSettings(t){t.innerHTML='<div class="card"><div class="card-title"><i class="fa-solid fa-gear"></i> General Settings</div><p style="color:var(--text-muted);">Turnaround times, cancellation policy, and other venue-wide settings managed here.</p><div id="settingsContent"><div class="spinner"></div></div></div>',fetch("https://n8n.srv1090894.hstgr.cloud/webhook/get-settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jwt:l.isAuthenticated()?localStorage.getItem("vp_token")||sessionStorage.getItem("vp_token"):""})}).then(e=>e.json()).then(e=>{const s=Array.isArray(e)?e:e.data||[],a=document.getElementById("settingsContent");if(!s.length){a.innerHTML='<p style="color:var(--text-muted);">No settings found.</p>';return}a.innerHTML=s.map(i=>`
        <div class="input-group">
          <label>${i.key||i.setting_key}</label>
          <input type="text" class="form-input" value="${i.value||""}" data-key="${i.key||i.setting_key}" />
        </div>
      `).join("")+'<button class="btn btn-primary" id="saveSettingsBtn"><i class="fa-solid fa-floppy-disk"></i> Save Settings</button>'}).catch(()=>{document.getElementById("settingsContent").innerHTML='<p style="color:var(--text-muted);">Settings unavailable.</p>'})}};export{g as default};

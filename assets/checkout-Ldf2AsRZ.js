import{a as y,n as u,r as f,i as b}from"./sidebar-C8xt7GmK.js";import{a as g}from"./index-CBNA1kT4.js";import{toast as m}from"./toast-CQ5lsFjN.js";function h(){const t=window.location.hash,e=t.indexOf("?");return e===-1?{}:Object.fromEntries(new URLSearchParams(t.slice(e+1)))}const P={async mount(t){const{booking_id:e,amount:r,description:i,status:n}=h();t.innerHTML=`
      ${f("/checkout")}
      <main class="content">
        <div class="page-header">
          <h1><i class="fa-solid fa-credit-card" style="color:var(--primary);"></i> Payment</h1>
        </div>

        ${n==="success"?`
          <div class="card" style="text-align:center;padding:3rem;">
            <i class="fa-solid fa-circle-check" style="font-size:3rem;color:var(--success);margin-bottom:1rem;"></i>
            <h2>Payment Successful</h2>
            <p style="color:var(--text-muted);margin-top:8px;">Your booking has been confirmed.</p>
            <a href="#/dashboard" class="btn btn-primary" style="margin-top:1.5rem;display:inline-flex;">Return to Dashboard</a>
          </div>
        `:n==="cancelled"?`
          <div class="card" style="text-align:center;padding:3rem;">
            <i class="fa-solid fa-circle-xmark" style="font-size:3rem;color:var(--danger);margin-bottom:1rem;"></i>
            <h2>Payment Cancelled</h2>
            <p style="color:var(--text-muted);margin-top:8px;">No payment was taken.</p>
            <a href="#/dashboard" class="btn btn-ghost" style="margin-top:1.5rem;display:inline-flex;">Return to Dashboard</a>
          </div>
        `:`
          <div class="card" style="max-width:520px;margin:0 auto;" id="checkoutCard">
            <div class="card-title"><i class="fa-solid fa-receipt"></i> Order Summary</div>
            <div style="margin-bottom:1.5rem;">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="color:var(--text-muted);">Description</span>
                <span style="font-weight:600;">${i||"Venue Booking"}</span>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--text-muted);">Amount Due</span>
                <span style="font-weight:800;font-size:1.2rem;color:var(--primary);">£${parseFloat(r||0).toFixed(2)}</span>
              </div>
            </div>
            <div id="paymentOptions"><div class="spinner"></div></div>
          </div>
        `}
      </main>
    `,b(),!n&&e&&this._loadPaymentOptions(e,r,i)},async _loadPaymentOptions(t,e,r){var n,d,l;const i=document.getElementById("paymentOptions");try{const c=g.getTenantId(),a=await(await fetch(`https://api.venuedesk.co.uk/stripe/config?tenant_id=${c}`,{headers:{"Content-Type":"application/json"}})).json();let o="";a.is_stripe_enabled&&(o+=`
          <button class="btn btn-primary" id="stripePayBtn" style="width:100%;justify-content:center;padding:14px;font-size:1rem;margin-bottom:12px;">
            <i class="fa-brands fa-stripe-s"></i> Pay £${parseFloat(e||0).toFixed(2)} by Card
          </button>
        `),a.bacs_account_name&&(o+=`
          <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:10px;padding:1rem;margin-bottom:12px;">
            <p style="font-size:0.82rem;font-weight:700;color:#93c5fd;margin-bottom:8px;"><i class="fa-solid fa-building-columns"></i> Pay by Bank Transfer (BACS)</p>
            <div style="font-size:0.85rem;line-height:1.8;color:var(--text-muted);">
              Account: <strong style="color:var(--text-main);">${a.bacs_account_name}</strong><br/>
              Sort Code: <strong style="color:var(--text-main);">${a.bacs_sort_code||"—"}</strong><br/>
              Account No: <strong style="color:var(--text-main);">${a.bacs_account_number||"—"}</strong><br/>
              Reference: <strong style="color:var(--text-main);">${((n=t==null?void 0:t.slice(0,8))==null?void 0:n.toUpperCase())||"See email"}</strong>
            </div>
            <button class="btn btn-ghost" id="bacsConfirmBtn" style="margin-top:12px;width:100%;justify-content:center;">
              <i class="fa-solid fa-check"></i> I've made the bank transfer
            </button>
          </div>
        `),o||(o='<p style="color:var(--text-muted);text-align:center;">No payment methods configured. Please contact your venue.</p>'),i.innerHTML=o,(d=document.getElementById("stripePayBtn"))==null||d.addEventListener("click",async()=>{try{const s=document.getElementById("stripePayBtn");s.disabled=!0,s.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Redirecting…';const{checkout_url:p}=await y.post("/stripe/session",{booking_id:t,amount:parseFloat(e),description:r});window.location.href=p}catch(s){m.error("Stripe checkout failed: "+s.message),document.getElementById("stripePayBtn").disabled=!1,document.getElementById("stripePayBtn").innerHTML='<i class="fa-brands fa-stripe-s"></i> Pay by Card'}}),(l=document.getElementById("bacsConfirmBtn"))==null||l.addEventListener("click",async()=>{try{await u("/pay-balance",{booking_id:t,amount:e,payment_method:"bacs",bacs_account_name:a.bacs_account_name,bacs_sort_code:a.bacs_sort_code,bacs_account_number:a.bacs_account_number}),window.location.hash="#/checkout?status=success"}catch(s){m.error("Failed to confirm payment: "+s.message)}})}catch(c){i.innerHTML=`<p style="color:var(--danger);">Failed to load payment options: ${c.message}</p>`}}};export{P as default};

/**
 * views/customers.js — CRM customer list
 * GET /customers/list
 */
import { api } from '../api.js';
import { renderSidebar, initSidebar } from '../components/sidebar.js';

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'; }

const view = {
  async mount(container) {
    container.innerHTML = `
      ${renderSidebar('/customers')}
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
    `;
    initSidebar();

    let all = [];
    const render = (q='') => {
      const filtered = q ? all.filter(c => (c.full_name+c.email).toLowerCase().includes(q.toLowerCase())) : all;
      const el = document.getElementById('customerTable');
      const cnt = document.getElementById('countBadge');
      if (cnt) cnt.textContent = `${filtered.length} customers`;
      if (!filtered.length) { el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-users"></i><p>No customers found</p></div>`; return; }
      el.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Last Booking</th></tr></thead>
          <tbody>
            ${filtered.map(c=>`
              <tr>
                <td style="font-weight:600;">${c.full_name||'—'}</td>
                <td style="color:var(--text-muted);">${c.email||'—'}</td>
                <td style="color:var(--text-muted);">${c.phone||'—'}</td>
                <td><span class="badge badge-${c.status==='booked'?'success':c.status==='pending'?'warning':'muted'}">${c.status||'—'}</span></td>
                <td style="color:var(--text-muted);">${fmtDate(c.date_from)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    };

    const load = async () => {
      try {
        const { data } = await api.get('/customers/list');
        all = data || [];
        render(document.getElementById('search')?.value || '');
      } catch(e) {
        document.getElementById('customerTable').innerHTML = `<p style="color:var(--danger);">Failed to load customers.</p>`;
      }
    };

    document.getElementById('refreshBtn').addEventListener('click', load);
    let d;
    document.getElementById('search').addEventListener('input', e => { clearTimeout(d); d = setTimeout(()=>render(e.target.value),300); });
    load();
  },
};
export default view;

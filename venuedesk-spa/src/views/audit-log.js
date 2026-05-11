/**
 * views/audit-log.js
 * GET /admin/logs — real-time audit log stream with level/source filters
 */
import { api } from '../api.js';
import { renderSidebar, initSidebar } from '../components/sidebar.js';
import { toast } from '../components/toast.js';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

const LEVEL_BADGE = { info:'info', warn:'warning', error:'danger' };

const view = {
  async mount(container) {
    container.innerHTML = `
      ${renderSidebar('/audit-log')}
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
    `;
    initSidebar();

    const refresh = () => this._load();
    document.getElementById('refreshBtn').addEventListener('click', refresh);
    document.getElementById('filterLevel').addEventListener('change', refresh);
    document.getElementById('filterLimit').addEventListener('change', refresh);
    let debounce;
    document.getElementById('filterSource').addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, 400);
    });

    this._load();
  },

  async _load() {
    const container = document.getElementById('logTable');
    const level  = document.getElementById('filterLevel')?.value;
    const source = document.getElementById('filterSource')?.value.trim();
    const limit  = parseInt(document.getElementById('filterLimit')?.value || '100');

    try {
      const params = { limit };
      if (level)  params.level  = level;
      if (source) params.source = source;
      const { data } = await api.get('/admin/logs', params);
      const rows = data || [];

      if (!rows.length) {
        container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>No log entries found</p></div>`;
        return;
      }

      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th>Time</th><th>Level</th><th>Source</th><th>Message</th><th>Tenant</th></tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="white-space:nowrap;color:var(--text-muted);font-size:0.8rem;">${fmtDate(r.created_at)}</td>
                <td><span class="badge badge-${LEVEL_BADGE[r.level] || 'muted'}">${r.level}</span></td>
                <td style="font-family:monospace;font-size:0.8rem;color:var(--text-muted);">${r.source || '—'}</td>
                <td style="max-width:400px;">${r.message || '—'}</td>
                <td style="color:var(--text-muted);">${r.tenant_id ?? '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      container.innerHTML = `<p style="color:var(--danger);">Failed to load logs: ${err.message}</p>`;
      toast.error('Failed to load audit log');
    }
  },
};
export default view;

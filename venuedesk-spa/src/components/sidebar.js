/**
 * sidebar.js — shared navigation sidebar
 *
 * Renders the sidebar HTML and wires up collapse toggle + mobile menu.
 * Active nav item is derived from the current hash route.
 */

import { auth } from '../auth.js';
import { store } from '../store.js';

const NAV_ITEMS = [
  { path: '/dashboard',        icon: 'fa-solid fa-gauge-high',        label: 'Dashboard'       },
  { path: '/calendar',         icon: 'fa-solid fa-calendar-days',     label: 'Calendar'        },
  { path: '/accounts',         icon: 'fa-solid fa-sterling-sign',     label: 'Accounts'        },
  { path: '/customers',        icon: 'fa-solid fa-users',             label: 'Customers'       },
  { path: '/recurring-bookings',icon:'fa-solid fa-rotate',            label: 'Recurring'       },
  { path: '/audit-log',        icon: 'fa-solid fa-list-check',        label: 'Audit Log'       },
  { path: '/admin-config',     icon: 'fa-solid fa-gear',              label: 'Config'          },
];

export function renderSidebar(activeRoute) {
  const items = NAV_ITEMS
    .map(item => `
      <a href="#${item.path}"
         class="nav-link${activeRoute === item.path ? ' active' : ''}"
         data-label="${item.label}">
        <i class="${item.icon}"></i>
        <span class="nav-label">${item.label}</span>
      </a>
    `).join('');

  return `
    <button class="menu-toggle" id="menuToggle" aria-label="Open menu">
      <i class="fa-solid fa-bars"></i>
    </button>
    <div class="overlay" id="overlay"></div>

    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <i class="fa-solid fa-layer-group"></i>
        <span class="brand-text">VenueDesk</span>
      </div>

      <nav>${items}</nav>

      <div class="sidebar-footer">
        <div style="padding: 6px 12px; margin-bottom: 4px;">
          <div style="font-size:0.78rem; color:var(--text-muted);">Signed in as</div>
          <div style="font-size:0.85rem; font-weight:600; color:var(--text-main); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${auth.getUserName()}
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
  `;
}

/** Wire up collapse, mobile toggle, and logout after renderSidebar injects HTML */
export function initSidebar() {
  const sidebar    = document.getElementById('sidebar');
  const overlay    = document.getElementById('overlay');
  const collapseBtn= document.getElementById('collapseBtn');
  const menuToggle = document.getElementById('menuToggle');
  const logoutBtn  = document.getElementById('logoutBtn');

  // Restore collapsed state
  if (store.sidebarCollapsed) document.body.classList.add('sidebar-collapsed');

  collapseBtn?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    store.sidebarCollapsed = document.body.classList.contains('sidebar-collapsed');
  });

  menuToggle?.addEventListener('click', () => {
    sidebar?.classList.add('open');
    overlay?.classList.add('active');
  });

  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('active');
  });

  logoutBtn?.addEventListener('click', () => {
    if (confirm('Log out of VenueDesk?')) auth.logout();
  });
}

// ── UI MODULE ──
export const UI = {
    // ── Sidebar ──
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        sidebar?.classList.toggle('active');
        overlay?.classList.toggle('active');
    },
    closeSidebar() {
        document.getElementById('sidebar')?.classList.remove('active');
        document.getElementById('sidebar-overlay')?.classList.remove('active');
    },
    toggleSidebarCollapse() {
        const collapsed = document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem('vp_sidebar_col', collapsed ? '1' : '0');
    },
    initSidebar() {
        if (localStorage.getItem('vp_sidebar_col') === '1') {
            document.body.classList.add('sidebar-collapsed');
        }
    },

    // ── Theme ──
    toggleTheme() {
        const light = document.body.classList.toggle('light-mode');
        localStorage.setItem('vp_theme', light ? 'light' : 'dark');
        const btn = document.getElementById('theme-btn');
        if (btn) btn.querySelector('i').className = light ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    },
    initTheme() {
        const theme = localStorage.getItem('vp_theme');
        if (theme === 'light') {
            document.body.classList.add('light-mode');
            const btn = document.getElementById('theme-btn');
            if (btn) btn.querySelector('i').className = 'fa-solid fa-sun';
        }
    },

    // ── Clock ──
    startClock() {
        const tick = () => {
            const el = document.getElementById('clock-time');
            if (el) el.textContent = new Date().toLocaleTimeString('en-GB');
        };
        tick();
        return setInterval(tick, 1000);
    },

    // ── Active nav ──
    setActiveNav(route) {
        document.querySelectorAll('#sidebar-nav .nav-link').forEach(a => {
            a.classList.toggle('active', a.dataset.route === route);
        });
    },

    // ── Toast ──
    toast(message, type = 'info', duration = 3500) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const icons = { success:'fa-circle-check', error:'fa-circle-xmark', warning:'fa-triangle-exclamation', info:'fa-circle-info' };
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
        container.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, duration);
    },

    // ── Format helpers ──
    currency(n) { return '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    date(d)     { return d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—'; },
    dateShort(d){ return d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : '—'; },
    time(d)     { return d ? new Date(d).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : '—'; },

    // ── Spinner ──
    spinner() { return `<div class="loading"><i class="fa-solid fa-circle-notch fa-spin"></i><p>Loading...</p></div>`; },
};

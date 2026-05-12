# VenueDesk CSS Tokens & Component Patterns

## Root variables

```css
:root {
  --bg: #0f172a;            /* page background — deep navy */
  --sidebar-bg: #1e293b;    /* sidebar */
  --card-bg: #1e293b;       /* cards, panels, calendar wrap */
  --border: rgba(148,163,184,0.12);
  --text-main: #e2e8f0;
  --text-muted: #94a3b8;
  --primary: #6366f1;       /* indigo — buttons, links, accents */
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --sidebar-width: 240px;
}
```

## Card / panel base

```css
.panel, .cal-wrap, .mini-cals-section {
  background: var(--card-bg);
  border: 1px solid rgba(148,163,184,0.15);
  border-radius: 16px;
  padding: 1.4rem;
  box-shadow: 0 4px 24px rgba(0,0,0,.25);
}
```

## Form elements

```css
.form-label {
  font-size: .71rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .06em;
  display: block;
  margin-bottom: 5px;
}

.form-input {
  width: 100%;
  padding: 9px 12px;
  background: rgba(255,255,255,.06);   /* white-lift, NOT black-darken */
  border: 1px solid rgba(148,163,184,.2);
  border-radius: 9px;
  color: var(--text-main);
  font-size: .87rem;
  outline: none;
  font-family: inherit;
  transition: border-color .15s;
}
.form-input:focus {
  border-color: rgba(99,102,241,.6);
  background: rgba(255,255,255,.09);
}
```

## Pill buttons (frequency selector pattern)

```css
.freq-btn {
  padding: 5px 13px;
  border-radius: 20px;
  font-size: .77rem;
  font-weight: 600;
  border: 1px solid rgba(148,163,184,.2);
  background: rgba(255,255,255,.05);
  color: var(--text-muted);
  cursor: pointer;
  transition: all .15s;
}
.freq-btn:hover { border-color: rgba(99,102,241,.4); color: var(--text-main); }
.freq-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }
```

## Submit button

```css
.btn-submit {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: .9rem;
  font-weight: 700;
  cursor: pointer;
  transition: all .15s;
  box-shadow: 0 4px 12px rgba(99,102,241,.35);
}
.btn-submit:hover { opacity: .9; box-shadow: 0 6px 18px rgba(99,102,241,.45); }
.btn-submit:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }
```

## Tab switcher (mode tabs)

```css
.mode-tabs {
  display: flex;
  border: 1px solid rgba(148,163,184,.18);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255,255,255,.04);
}
.mode-tab {
  flex: 1;
  padding: 8px;
  font-size: .79rem;
  font-weight: 600;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: all .15s;
}
.mode-tab.active {
  background: var(--primary);
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.15);
}
```

## Preview / info box

```css
.preview-box {
  background: rgba(99,102,241,.1);
  border: 1px solid rgba(99,102,241,.25);
  border-radius: 10px;
  padding: 11px 13px;
  font-size: .81rem;
  color: #c7d2fe;
  min-height: 40px;
  line-height: 1.65;
}
```

## Nav link (sidebar)

```css
.nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: var(--text-muted);
  text-decoration: none;
  border-radius: 8px;
  margin-bottom: 5px;
  font-weight: 500;
  transition: all .2s;
}
.nav-link:hover, .nav-link.active {
  background: rgba(99,102,241,.1);
  color: var(--primary);
}
```

## Light mode overrides pattern

For any element that uses a dark-theme color, add a matching light-mode rule:

```css
body.light-mode .panel,
body.light-mode .cal-wrap,
body.light-mode .mini-cals-section { background: #fff !important; border-color: #e2e8f0 !important; }

body.light-mode .form-input { background: #fff !important; color: #1e293b !important; border-color: #cbd5e1 !important; }
body.light-mode .form-input:focus { border-color: #6366f1 !important; }

body.light-mode .mc-month { background: #f8fafc; border-color: #e2e8f0; }
body.light-mode .mc-day  { background: #fff; color: #1e293b; border-color: #e8ecf0; }
body.light-mode .mc-day:hover:not(.past):not(.empty) { background: rgba(99,102,241,.12); }
```

## Toast notification

```css
.toast { padding: 12px 18px; border-radius: 10px; font-size: .87rem; font-weight: 600; color: #fff; }
.toast.success { background: #16a34a; }
.toast.error   { background: #dc2626; }
.toast.info    { background: #2563eb; }
```

```javascript
function showToast(msg, type) {
  var c = document.getElementById('toast-container');
  var t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function() { t.remove(); }, 4500);
}
```

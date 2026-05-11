/**
 * toast.js — non-blocking notification system
 *
 * Usage:
 *   import { toast } from './components/toast.js';
 *   toast.success('Booking saved');
 *   toast.error('Save failed: ' + err.message);
 *   toast.info('Loading…');
 *   toast.warning('Session expires in 5 minutes');
 */

function getContainer() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

const ICONS = {
  success: 'fa-circle-check',
  error:   'fa-circle-xmark',
  info:    'fa-circle-info',
  warning: 'fa-triangle-exclamation',
};

function show(message, type = 'info', duration = 3500) {
  const container = getContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fa-solid ${ICONS[type]}"></i><span>${message}</span>`;
  container.appendChild(el);

  const remove = () => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

export const toast = {
  success: (msg, ms)  => show(msg, 'success', ms),
  error:   (msg, ms)  => show(msg, 'error',   ms ?? 5000),
  info:    (msg, ms)  => show(msg, 'info',    ms),
  warning: (msg, ms)  => show(msg, 'warning', ms),
};

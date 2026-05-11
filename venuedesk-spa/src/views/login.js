/**
 * views/login.js — Login view
 *
 * POST /auth/login with { username, password }
 * On success: stores session (Pattern 6) and navigates to #/dashboard
 */

import { auth } from '../auth.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { toast } from '../components/toast.js';

const view = {
  async mount(container) {
    container.innerHTML = `
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
    `;

    // Wire up
    const form      = document.getElementById('loginForm');
    const btn       = document.getElementById('loginBtn');
    const btnText   = document.getElementById('loginBtnText');
    const errorEl   = document.getElementById('loginError');
    const togglePwd = document.getElementById('togglePwd');
    const pwdInput  = document.getElementById('password');
    const eyeIcon   = document.getElementById('eyeIcon');

    togglePwd.addEventListener('click', () => {
      const hidden = pwdInput.type === 'password';
      pwdInput.type = hidden ? 'text' : 'password';
      eyeIcon.className = `fa-solid fa-eye${hidden ? '-slash' : ''}`;
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      btn.disabled = true;
      btnText.textContent = 'Signing in…';

      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      try {
        // POST /auth/login — no JWT needed, noAuth = true in api layer
        const data = await api.postPublic('/auth/login', { username, password });

        if (!data.token) throw new Error('No token in response');

        auth.setSession(data);
        store.user     = data.user;
        store.tenantId = data.user?.tenant_id ?? null;

        toast.success(`Welcome back, ${auth.getUserName() || username}`);
        window.location.hash = '#/dashboard';
      } catch (err) {
        const msg = err.status === 401
          ? 'Invalid username or password'
          : (err.message || 'Login failed. Please try again.');

        errorEl.textContent    = msg;
        errorEl.style.display  = 'block';
        btn.disabled           = false;
        btnText.textContent    = 'Sign In';
      }
    });

    // Focus username on mount
    document.getElementById('username')?.focus();
  },
};

export default view;

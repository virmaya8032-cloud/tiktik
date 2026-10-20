import { api, store } from '../api.js';
import { html, el, $, modal, toast } from '../ui.js';
import { icons } from '../icons.js';

/**
 * Login / sign-up form. onDone(user) is called after a successful auth.
 * step: 'choose' shows the method list first (modal); 'form' opens the username/password form directly (inline pages).
 */
export function authForm({ mode = 'login', step = 'form', onDone } = {}) {
  const root = el(html`<div class="auth">
    <h2 class="auth-title"></h2>
    <div class="auth-choose">
      <button type="button" class="auth-opt">${icons.user}<span></span></button>
    </div>
    <form class="form auth-form" novalidate>
      <button type="button" class="link-btn auth-back">← Other ways</button>
      <label class="field reg-only"><span>Display name</span><input name="displayName" maxlength="40" autocomplete="name" placeholder="How people see you"></label>
      <label class="field"><span>Username</span><input name="username" required minlength="3" maxlength="24" autocomplete="username" placeholder="e.g. sunny.days" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="current-password" placeholder="At least 8 characters"></label>
      <label class="field reg-only invite-field" hidden><span>Invite code</span><input name="inviteCode" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ask the group owner for the code"></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit"></button>
      <p class="muted small reg-only">Usernames use letters, numbers, "_" or "." (3-24 characters).</p>
      <p class="muted small login-only demo-hint">New here? Try the demo account <strong>demo</strong> / <strong>demo12345</strong> after seeding.</p>
    </form>
    <p class="auth-legal">By continuing, you agree to TikTik's <a href="/info/terms">Terms of Service</a> and confirm that you have read TikTik's <a href="/info/privacy">Privacy Policy</a>.</p>
    <div class="auth-switch">
      <span class="login-only">Don't have an account? <button type="button" class="link-btn" data-mode="register">Sign up</button></span>
      <span class="reg-only">Already have an account? <button type="button" class="link-btn" data-mode="login">Log in</button></span>
    </div>
  </div>`);

  const form = $('form', root);
  const err = $('.form-error', root);
  const submit = $('button[type=submit]', root);
  const setStep = (st) => {
    step = st;
    root.dataset.step = st;
    if (st === 'form') form.username.focus({ preventScroll: true });
  };
  const setMode = (m) => {
    mode = m;
    root.dataset.mode = m;
    $('.auth-title', root).textContent = m === 'login' ? 'Log in to TikTik' : 'Sign up for TikTik';
    $('.auth-opt span', root).textContent = m === 'login' ? 'Use username and password' : 'Sign up with username and password';
    submit.textContent = m === 'login' ? 'Log in' : 'Create account';
    form.password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    err.hidden = true;
  };
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('.auth-opt', root).addEventListener('click', () => setStep('form'));
  $('.auth-back', root).addEventListener('click', () => setStep('choose'));
  setMode(mode);
  root.dataset.step = step;
  // Private-group mode: show the invite-code field and hide the demo hint.
  authConfig().then((c) => {
    $('.invite-field', root).hidden = !c.inviteRequired;
    form.inviteCode.required = c.inviteRequired;
    if (c.inviteRequired) $('.demo-hint', root).remove();
  });
  if (step === 'form') $('.auth-back', root).remove(); // inline pages only have one way in

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const body = Object.fromEntries(new FormData(form));
    if (mode === 'login') { delete body.displayName; delete body.inviteCode; }
    submit.disabled = true;
    try {
      const { user } = await api.post(mode === 'login' ? '/api/auth/login' : '/api/auth/register', body);
      await store.refresh();
      toast(mode === 'login' ? `Welcome back, ${user.displayName}!` : `Welcome to TikTik, ${user.displayName}!`, 'success');
      onDone?.(user);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  return root;
}

let configPromise = null;
const authConfig = () => (configPromise ??= api.get('/api/auth/config').catch(() => ({ inviteRequired: false })));

let pending = null;
/** Show the auth modal (used whenever a logged-out user tries to interact). */
export function openAuthModal(mode = 'login') {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    let user = null;
    const m = modal(authForm({ mode, step: 'choose', onDone: (u) => { user = u; m.close(); } }), {
      title: 'Log in to TikTik', cls: 'modal-auth', onClose: () => { pending = null; resolve(user); },
    });
  });
  return pending;
}

/** Ensure the user is logged in; prompts if needed. Resolves to the user or null. */
export async function ensureLogin() {
  if (store.me) return store.me;
  return openAuthModal('login');
}

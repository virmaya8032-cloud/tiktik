import { api, store } from '../api.js';
import { html, el, $, toast } from '../ui.js';
import { navigate } from '../router.js';

/** /reset-password?token=... : choose a new password with a one-time link. */
export async function resetView({ query }) {
  const root = el('<div class="page narrow reset-page"></div>');
  let info = null;
  try {
    if (query.token) info = await api.get(`/api/auth/reset/${encodeURIComponent(query.token)}`);
  } catch { /* invalid or expired: shown below */ }
  if (!info) {
    root.append(el(html`<div class="empty-state">
      <h2>This reset link doesn't work</h2>
      <p class="muted">Reset links work once and expire after 30 minutes. Ask for a new one from the log-in screen, or from a moderator of your group.</p>
      <a class="btn btn-primary" href="/login">Go to log in</a>
    </div>`));
    return { el: root };
  }
  const form = el(html`<form class="form auth">
    <h1>Choose a new password</h1>
    <p class="muted">For <strong>@${info.username}</strong>. You'll be logged out on every device.</p>
    <label class="field"><span>New password</span><input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
    <label class="field"><span>Repeat new password</span><input name="repeat" type="password" required minlength="8" autocomplete="new-password"></label>
    <p class="form-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-block">Save new password</button>
  </form>`);
  root.append(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    err.hidden = true;
    if (form.password.value !== form.repeat.value) { err.textContent = "The passwords don't match."; err.hidden = false; return; }
    try {
      await api.post('/api/auth/reset', { token: query.token, password: form.password.value });
      await store.refresh();
      toast('Password changed - log in with your new password', 'success');
      navigate('/login', { replace: true });
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
    }
  });
  return { el: root };
}

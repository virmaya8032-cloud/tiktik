import { api } from '../api.js';
import { html, el, $, modal, toast } from '../ui.js';
import { ensureLogin } from './auth.js';

const REASONS = {
  spam: 'Spam or scam',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  violence: 'Violence or dangerous acts',
  sexual: 'Nudity or sexual content',
  minor_safety: 'Child safety',
  self_harm: 'Suicide or self-harm',
  misinformation: 'False information',
  intellectual_property: 'Intellectual property',
  other: 'Something else',
};

/** Report a video, comment or user. target = { type: 'video'|'comment'|'user', id, label }. */
export async function openReportDialog(target) {
  if (!(await ensureLogin())) return;
  const form = el(html`<form class="form report-form">
    <p class="muted small">Why are you reporting this ${target.label}? Reports are private; the person you report is not told who sent it.</p>
    <fieldset class="report-reasons">
      <legend class="sr-only">Reason</legend>
      ${Object.entries(REASONS).map(([k, label]) => html`<label class="report-reason"><input type="radio" name="reason" value="${k}" required> ${label}</label>`)}
    </fieldset>
    <label class="field"><span>Details <small class="muted">optional</small></span><textarea name="details" maxlength="500" rows="3"></textarea></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="btn-row end"><button type="button" class="btn r-cancel">Cancel</button><button class="btn btn-primary">Submit report</button></div>
  </form>`);
  const m = modal(form, { title: `Report ${target.label}`, cls: 'modal-report' });
  $('.r-cancel', form).addEventListener('click', () => m.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { duplicate } = await api.post('/api/reports', {
        targetType: target.type, targetId: target.id, reason: form.reason.value, details: form.details.value,
      });
      m.close();
      toast(duplicate ? 'You already reported this. We are reviewing it.' : 'Thanks - your report was sent for review.', 'success');
    } catch (ex) {
      const err = $('.form-error', form);
      err.textContent = ex.message; err.hidden = false;
    }
  });
}

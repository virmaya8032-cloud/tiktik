import { api } from '../api.js';
import { html, el, $, modal, toast, copyText } from '../ui.js';
import { icons } from '../icons.js';
import { openReportDialog } from './report.js';

/** Share sheet: copy link, device share sheet, email, report. Every share is recorded. */
export function openShareSheet(video, onUpdated) {
  const url = `${location.origin}/@${video.author.username}/video/${video.id}`;
  const record = async (channel) => {
    try {
      const { video: v } = await api.post(`/api/videos/${video.id}/share`, { channel });
      onUpdated?.(v);
    } catch { /* share counting is best-effort */ }
  };
  const body = el(html`<div class="share-sheet">
    <div class="share-grid">
      <button class="share-opt" data-ch="copy_link"><span class="share-ic">${icons.link}</span>Copy link</button>
      ${navigator.share ? html`<button class="share-opt" data-ch="native"><span class="share-ic">${icons.device}</span>More options</button>` : ''}
      <button class="share-opt" data-ch="email"><span class="share-ic">${icons.mail}</span>Email</button>
      ${video.viewer.isAuthor ? '' : html`<button class="share-opt" data-ch="report"><span class="share-ic">${icons.flag}</span>Report</button>`}
    </div>
    <label class="field"><span>Link</span><input readonly value="${url}" class="share-url"></label>
    <p class="muted small share-email" hidden>Paste the link into an email to <em>anyone</em>, subject: "Check out this TikTik video".</p>
  </div>`);
  const m = modal(body, { title: 'Share to', cls: 'modal-share' });
  $('.share-url', body).addEventListener('focus', (e) => e.target.select());
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    const ch = b.dataset.ch;
    if (ch === 'report') {
      m.close();
      openReportDialog({ type: 'video', id: video.id, label: 'video' });
    } else if (ch === 'copy_link') {
      if (await copyText(url)) { toast('Link copied', 'success'); await record('copy_link'); m.close(); }
      else toast('Copy failed - select the link and copy it manually', 'error');
    } else if (ch === 'native') {
      try {
        await navigator.share({ title: `${video.author.displayName} on TikTik`, text: video.caption, url });
        await record('native');
        m.close();
      } catch { /* user cancelled */ }
    } else if (ch === 'email') {
      await copyText(url);
      $('.share-email', body).hidden = false;
      toast('Link copied for your email', 'success');
      await record('email');
    }
  });
}

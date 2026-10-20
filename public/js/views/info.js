import { html, el } from '../ui.js';

// Footer pages. Product pages describe how TikTik actually works today.
// Legal pages are DRAFTS: the TikTik owner must replace them with reviewed, official text before launch.
const DRAFT = 'Draft - this page is a placeholder. The official text must be written and reviewed by the TikTik owner before launch.';

export const INFO_PAGES = {
  company: {
    title: 'Company',
    body: [
      'TikTik is an independent short-video app for watching, creating and sharing vertical videos.',
      'It is not affiliated with, endorsed by or connected to TikTok or ByteDance.',
    ],
  },
  program: {
    title: 'Program',
    body: [
      'Every account can upload videos, build a following and track results in Creator Studio (views, average watch time, completion rate, likes, comments and shares).',
      'Use hashtags and a category on each upload so people can find your videos in Explore and search.',
    ],
  },
  help: {
    title: 'Help',
    body: [
      'Watching: scroll or use the arrow keys to move between videos. Space plays or pauses, M mutes, L likes, C opens comments.',
      'Uploading: choose Upload, pick an MP4, WebM or MOV file up to 200 MB and 10 minutes, choose a cover frame, add a caption with #hashtags and @mentions, then pick who can watch.',
      'Your account: edit your name, bio and photo from your profile. Your Liked and Saved tabs are only visible to you.',
    ],
  },
  safety: {
    title: 'Safety',
    body: [
      'Each video can be visible to Everyone, Followers only, or Only me. You can change this at any time in Creator Studio.',
      'You can turn comments off for any video, and you can delete any comment on your own videos.',
      'Login attempts are rate-limited and passwords are stored hashed, never in plain text.',
    ],
  },
  terms: { title: 'Terms of Service', draft: true, body: [] },
  privacy: {
    title: 'Privacy Policy',
    draft: true,
    body: [
      'Data the app currently stores: your account details (username, display name, bio, photo), the videos you upload, your likes, saves, follows, comments and shares, notifications, and how long videos are watched (used for recommendations and Creator Studio).',
    ],
  },
  accessibility: {
    title: 'Accessibility',
    body: [
      'TikTik supports full keyboard navigation, visible focus outlines, screen-reader labels on buttons and controls, light and dark themes, and reduced motion when your device asks for it.',
    ],
  },
  'privacy-center': {
    title: 'Privacy Center',
    body: [
      'Control who sees each video (Everyone, Followers, Only me) in Creator Studio or when you upload.',
      'Your Liked and Saved lists are private to you.',
      'You can edit your profile details at any time from your profile page.',
    ],
  },
  'creator-academy': {
    title: 'Creator Academy',
    body: [
      'Hook viewers in the first second - the For You feed rewards videos people watch to the end.',
      'Keep it vertical (9:16) and use a clear cover frame.',
      'Add 2-4 relevant hashtags and pick the right category so Explore can surface your video.',
      'Check Creator Studio for average watch time and completion rate, and post again in the style that works.',
    ],
  },
  'community-guidelines': {
    title: 'Community Guidelines',
    body: [
      'Be respectful: no harassment, hate or threats.',
      'Only post content you own or have permission to use.',
      'No nudity, graphic violence, scams or dangerous challenges.',
      'Keep personal information - yours and other people\'s - private.',
    ],
  },
  copyright: { title: 'Copyright', draft: true, body: [] },
  'law-enforcement': { title: 'Law Enforcement Guidelines', draft: true, body: [] },
};

export const TERMS_LINKS = [
  ['help', 'Help'], ['safety', 'Safety'], ['terms', 'Terms'], ['privacy', 'Privacy Policy'],
  ['accessibility', 'Accessibility'], ['privacy-center', 'Privacy Center'], ['creator-academy', 'Creator Academy'],
  ['community-guidelines', 'Community Guidelines'], ['copyright', 'Copyright'], ['law-enforcement', 'Law Enforcement Guidelines'],
];

export function infoView({ params }) {
  const page = INFO_PAGES[params.slug];
  if (!page) {
    const err = new Error('The link may be broken or the page may have been removed.');
    err.status = 404;
    throw err;
  }
  return {
    el: el(html`<div class="page info-page">
      <h1>${page.title}</h1>
      ${page.draft ? html`<p class="info-draft">${DRAFT}</p>` : ''}
      ${page.body.map((p) => html`<p>${p}</p>`)}
    </div>`),
  };
}

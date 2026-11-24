import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { sections } from './demo.mjs';

export const escape = (value = '') => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const e = escape;
const href = (slug) => '/articles/' + encodeURIComponent(slug);
const date = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '';
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
const iconPaths = {
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  moon: '<path d="M20 15a8 8 0 0 1-11-11 8 8 0 1 0 11 11Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  home: '<path d="m3 11 9-8 9 8M5 10v10h14V10M10 20v-6h4v6"/>',
  news: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
  teaching: '<path d="M12 6C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 2Zm0 0v15"/>',
  'find-out': '<circle cx="12" cy="12" r="9"/><path d="m15 9-2 4-4 2 2-4Z"/>',
  link: '<path d="M9 15 15 9m-7 8-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 8a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" transform="translate(1 0) scale(.9 1)"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">${iconPaths[name]}</svg>`;
}
const brand = '<a class="brand" href="/"><img class="brand-mark" src="/mark.svg" width="40" height="40" alt=""><span>OpenBlog</span></a>';

function navigation(active) {
  return [['blogs', 'Blogs'], ['news', 'News']].map(([key, label]) =>
    `<a href="/${key}" ${active === key ? 'aria-current="page"' : ''}>${label}</a>`).join('');
}

export function layout(ctx, { title, description, content, path, image, schema, privatePage = false, active = '', full = false }) {
  const absolute = new URL(path, ctx.origin).href;
  const label = title === 'OpenBlog' ? title : title + ' | OpenBlog';
  const displayImage = image ? new URL(image, ctx.origin).href : new URL('/media/connected.webp', ctx.origin).href;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${e(label)}</title><meta name="description" content="${e(description)}">
<meta name="robots" content="${privatePage || ctx.demo ? 'noindex, nofollow' : 'index,follow,max-image-preview:large'}">
<link rel="canonical" href="${e(absolute)}"><link rel="alternate" type="application/rss+xml" title="OpenBlog" href="/feed.xml">
<meta property="og:site_name" content="OpenBlog"><meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(absolute)}">
<meta property="og:type" content="${schema?.['@type'] === 'Article' || schema?.['@type'] === 'NewsArticle' ? 'article' : 'website'}">
<meta property="og:image" content="${e(displayImage)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/mark.svg" type="image/svg+xml"><script src="/theme.js"></script>
<link rel="stylesheet" href="/styles.css"><script defer src="/interactions.js"></script>
${schema ? `<script type="application/ld+json">${json(schema)}</script>` : ''}
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <div class="topbar-inner">${brand}
    <nav class="top-links" aria-label="Main sections">${navigation(active)}</nav>
    <div class="top-actions">
      <button class="search-trigger" type="button" data-search-open aria-haspopup="dialog" aria-label="Search articles">${icon('search')}<span>Search articles</span><kbd aria-hidden="true">/</kbd></button>
      <button class="icon-button theme-toggle" type="button" data-theme-toggle aria-label="Switch color theme">${icon('moon')}</button>
      <a class="button account-button" href="/account">${ctx.user ? 'Account' : 'Sign in'}</a>
      <button class="icon-button menu-toggle" type="button" data-menu-toggle aria-controls="explore-menu" aria-expanded="false" aria-label="Open navigation">${icon('menu')}</button>
    </div>
  </div>
</header>
<div class="frame ${full ? 'frame-full' : ''}">
  ${sidebar(active, ctx.topics ?? [])}
  <main id="main" class="main" tabindex="-1">${content}
    <footer class="footer"><span>OpenBlog</span><div><a href="/about">About</a><a href="/policy">Editorial policy</a><a href="/privacy">Privacy</a><a href="/disclaimer">Disclaimer</a><a href="/contact">Contact</a><a href="/feed.xml">RSS</a></div></footer>
  </main>
</div>
<dialog class="search-dialog" aria-labelledby="search-title">
<form action="/search" class="search-dialog-body"><label id="search-title" for="global-search">Search OpenBlog</label>
<div class="search-dialog-row">${icon('search')}<input id="global-search" type="search" name="q" placeholder="Search articles or topics…" maxlength="100" required>
<button class="button primary" type="submit">Search</button></div></form>
<form method="dialog"><button class="search-dismiss" aria-label="Close search">Esc</button></form>
</dialog>
</body></html>`;
}

function sidebar(active, topics) {
  const links = [
    ['home', 'Explore', '/', 'home'], ['news', 'News', '/news', 'news'],
    ['blogs', 'Blog', '/blogs', 'teaching'], ['api', 'Connective AI agent', '/api', 'link'],
  ];
  return `<aside class="sidebar" id="explore-menu"><nav aria-label="Explore OpenBlog">
  <div class="side-heading">LIBRARY</div>
  ${links.map(([key, title, url, symbol]) => `<a class="side-link" href="${url}" ${key === active ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${e(title)}</span></a>`).join('')}
  ${topics.length ? `<div class="side-heading topic-heading">TOPICS</div><div class="side-topics">${topics.map((topic) => `<a href="/search?topic=${encodeURIComponent(topic)}"><span aria-hidden="true">#</span>${e(topic)}</a>`).join('')}</div>` : ''}
  </nav></aside>`;
}

function cover(article, className = '', eager = false) {
  const media = article.cover_url
    ? `<img src="${e(article.cover_url)}" alt="${e(article.cover_alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
    : '<div class="cover-placeholder" aria-hidden="true">✳</div>';
  return `<div class="cover ${className}">${media}</div>`;
}
const sectionLabel = (article) => `<span class="section-label ${e(article.section)}">${e(sections[article.section]?.title)}</span>`;

function card(article) {
  return `<article class="story-card reveal"><a href="${href(article.slug)}" class="story-card-link">${cover(article)}
  <div class="story-card-content"><div class="story-meta">${sectionLabel(article)}${article.topic ? `<span>${e(article.topic)}</span>` : ''}</div>
  <h3>${e(article.title)}</h3><p>${e(article.summary)}</p></div></a></article>`;
}

function pager(base, params, pagination) {
  if (!pagination || (pagination.page <= 1 && !pagination.more)) return '';
  const link = (page, title) => {
    const query = new URLSearchParams(params);
    if (page > 1) query.set('page', page);
    return `<a class="button" href="${base}${query.size ? '?' + e(query) : ''}">${title}</a>`;
  };
  return `<nav class="pagination" aria-label="Article pages">${pagination.page > 1 ? link(pagination.page - 1, 'Previous page') : ''}
    ${pagination.more ? link(pagination.page + 1, 'Next page') : ''}</nav>`;
}

const time = (value) => `<time datetime="${new Date(value).toISOString()}">${date(value)}</time>`;
const articleLinkList = (items) => `<ul class="article-link-list">${items.map((article) => `<li><a href="${href(article.slug)}">${e(article.title)}</a><span>${e(article.topic)}</span></li>`).join('')}</ul>`;
const emptyArticles = '<div class="empty"><h2>Articles are on the way</h2><p>Published stories will appear here.</p></div>';

export function home(blogs, news) {
  const [featured, ...otherBlogs] = blogs;
  return `<header class="explore-title entrance"><h1>Welcome to OpenBlog</h1>
    <p>Explore a connected library of articles, guides, and news.</p></header>
    <div class="explore-grid">
      <section class="explore-feature entrance"><div class="section-head"><h2>Featured article</h2><a href="/blogs">Browse blogs</a></div>
        ${featured ? `<article class="explore-story"><a href="${href(featured.slug)}">
          ${cover(featured, 'hero-cover', true)}
          <div><h3>${e(featured.title)}</h3><p>${e(featured.summary)}</p><span class="read-label">Read article</span></div>
        </a></article>${articleLinkList(otherBlogs)}` : emptyArticles}
      </section>
      <section class="explore-news entrance"><div class="section-head"><h2>In the news</h2><a href="/news">All news</a></div>
        ${news.length ? articleLinkList(news) : '<p class="empty">News stories will appear here.</p>'}
      </section>
    </div>`;
}

export function blogIndex(articles, pagination) {
  return `<header class="blog-intro entrance"><h1>Blogs</h1><p>In-depth articles, practical guides, and ideas worth exploring.</p></header>
    ${articles.length ? `<section class="blog-archive" aria-label="Blog posts">
      ${articles.map((article) => `<article class="blog-entry reveal"><a href="${href(article.slug)}" class="blog-entry-link">
        <div class="blog-entry-text"><div class="entry-meta">${time(article.published_at)}${article.topic ? `<span>${e(article.topic)}</span>` : ''}</div>
          <h2>${e(article.title)}</h2><p>${e(article.summary)}</p><span class="read-label">Read article</span></div>
        ${article.cover_url ? cover(article, 'blog-entry-cover') : ''}
      </a></article>`).join('')}
    </section>` : emptyArticles}${pager('/blogs', {}, pagination)}`;
}

export function newsIndex(articles, pagination) {
  const [lead, ...headlines] = articles;
  return `<header class="news-intro entrance"><h1>News</h1><p>Reporting and context on what’s changing.</p></header>
    ${lead ? `<div class="news-front entrance"><article class="news-feature"><a href="${href(lead.slug)}">
      ${cover(lead, 'news-cover', true)}
      <div class="news-feature-text"><div class="entry-meta">${time(lead.published_at)}${lead.topic ? `<span>${e(lead.topic)}</span>` : ''}</div>
      <h2>${e(lead.title)}</h2><p>${e(lead.summary)}</p></div>
    </a></article>
    ${headlines.length ? `<section class="news-headlines" aria-label="More news">
      ${headlines.map((article) => `<article class="news-brief reveal"><a href="${href(article.slug)}"><h3>${e(article.title)}</h3>
        <p>${e(article.summary)}</p><div class="entry-meta">${time(article.published_at)}${article.topic ? `<span>${e(article.topic)}</span>` : ''}</div>
      </a></article>`).join('')}
    </section>` : ''}</div>` : emptyArticles}${pager('/news', {}, pagination)}`;
}

export function listing(title, subtitle, articles, { search, topic, pagination, path } = {}) {
  return `<section class="page-heading entrance"><h1>${e(title)}</h1><p>${e(subtitle)}</p></section>
  ${search !== undefined ? `<form action="/search" class="results-search"><label class="visually-hidden" for="results-query">Search articles</label>
    <input type="search" id="results-query" name="q" value="${e(search)}" placeholder="Search articles…" maxlength="100">
    ${topic ? `<input type="hidden" name="topic" value="${e(topic)}">` : ''}<button class="button primary">Search</button>
    ${topic ? '<a href="/search">Clear topic</a>' : ''}</form>` : ''}
  ${articles.length ? `<div class="story-grid">${articles.map(card).join('')}</div>` : '<div class="empty"><h2>No articles found</h2><p>Try another search or browse a different section.</p></div>'}
  ${pager(path, { ...(search ? { q: search } : {}), ...(topic ? { topic } : {}) }, pagination)}`;
}

export function markdown(body) {
  const headings = [];
  const used = new Map();
  const html = sanitizeHtml(marked.parse(body, { async: false }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'figure', 'figcaption'],
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title', 'loading'], h2: ['id'], h3: ['id'], h4: ['id'], code: ['class'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: { img: (name, attribs) => ({ tagName: name, attribs: { ...attribs, loading: 'lazy' } }) },
  });
  const bodyHtml = html.replace(/<(h[234])(?: id="[^"]*")?>([\s\S]*?)<\/\1>/g, (_, tag, inner) => {
    const label = inner.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
    const base = slugify(label);
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    const id = 'heading-' + base + (count > 1 ? '-' + count : '');
    headings.push({ id, label, level: Number(tag[1]) });
    return `<${tag} id="${id}">${inner}</${tag}>`;
  }).replace(/<h1>/g, '<h2>').replace(/<\/h1>/g, '</h2>');
  return { bodyHtml, headings };
}

export function articleView(article, related) {
  const { bodyHtml, headings } = markdown(article.body);
  const toc = headings.length ? `<nav class="article-nav" aria-label="Article outline"><h2>On this page</h2>
    ${headings.map(({ id, label, level }) => `<a class="depth-${level}" href="#${id}">${e(label)}</a>`).join('')}</nav>` : '';
  const links = related.length ? `<nav class="article-nav" aria-label="Related articles"><h2>Related reading</h2>
    ${related.map((item) => `<a href="${href(item.slug)}">${e(item.title)}</a>`).join('')}</nav>` : '';

  const isNews = article.section === 'news';
  return `<div class="article-layout ${isNews ? 'news-reading' : 'blog-reading'}">
  <article class="article entrance">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Explore</a><span>/</span><a href="/${isNews ? 'news' : 'blogs'}">${isNews ? 'News' : 'Blogs'}</a></nav>
    <header class="article-header"><div class="entry-meta">${time(article.published_at)}${article.topic ? `<span>${e(article.topic)}</span>` : ''}</div>
      <h1>${e(article.title)}</h1><p>${e(article.summary)}</p>
      <div class="byline"><span>By ${e(article.author_name)}</span></div></header>
    ${article.cover_url ? cover(article, 'article-cover', true) : ''}
    ${toc ? `<details class="mobile-toc"><summary>On this page</summary>${toc}</details>` : ''}
    <div class="prose">${bodyHtml}</div>
    ${article.video_url ? `<section class="article-media"><h2>Watch the explanation</h2>
      <video controls playsinline preload="metadata" src="${e(article.video_url)}" ${article.video_captions?.startsWith('https://') ? 'crossorigin="anonymous"' : ''} ${article.cover_url ? `poster="${e(article.cover_url)}"` : ''}>
      ${article.video_captions ? `<track kind="captions" label="English" srclang="en" src="${e(article.video_captions)}" default>` : ''}
      </video>${article.transcript ? `<details><summary>Read the transcript</summary><p>${e(article.transcript)}</p></details>` : ''}</section>` : ''}
    ${article.sources?.length ? `<section class="sources"><h2>Sources</h2><ul>${article.sources.map((source) =>
      `<li><a href="${e(source.url)}" rel="noopener noreferrer">${e(source.title)}</a></li>`).join('')}</ul></section>` : ''}
    <div class="article-tools"><a href="${href(article.slug)}/markdown">Markdown version</a> <button type="button" class="button" data-copy-link>${icon('link')} Copy link</button></div>
    <div class="mobile-related">${links}</div>
  </article><aside class="article-aside">${toc}${links}</aside>
  </div>`;
}

export function plainPage(title, intro, body) {
  return `<section class="page-heading entrance"><h1>${e(title)}</h1><p>${e(intro)}</p></section><div class="prose information">${body}</div>`;
}

const flash = (message) => message ? `<p class="notice" role="status">${e(message)}</p>` : '';
export function accountPage({ demo, user, member, dashboard, message, key }) {
  if (demo) return plainPage('Your account', 'Sign in to write drafts and manage your agents.', '<p>Account actions are available when this instance is connected to Supabase.</p>');
  if (!user) return `<div class="form-panel entrance"><h1>Sign in to OpenBlog</h1><p>Use your email to access your drafts and agent keys.</p>
    ${flash(message)}<form method="post" action="/account/login" class="fields">
    <label>Email<input autocomplete="email" type="email" name="email" required maxlength="254"></label>
    <label>Password<input autocomplete="current-password" type="password" name="password" required maxlength="128"></label>
    <div class="form-actions"><button class="button primary">Sign in</button><a href="/account/register">Create an account</a></div></form></div>`;
  if (!member) return `<div class="form-panel entrance"><h1>Join OpenBlog</h1>
    <p>Create your contributor profile to start drafting articles.</p>${flash(message)}
    <form method="post" action="/account/join" class="fields"><label>Public byline<input type="text" name="name" autocomplete="name" required maxlength="80"></label>
    <button class="button primary">Join as a contributor</button></form>
    <form method="post" action="/account/logout"><button class="text-button">Sign out</button></form></div>`;
  return `<section class="page-heading entrance"><h1>Your workspace</h1><p>Signed in as ${e(member.name)} · ${e(member.role)}</p></section>
  ${flash(message)}
  ${key ? `<div class="notice new-key"><p>Your agent key is shown once. Copy it before you leave.</p><code id="new-agent-key">${e(key)}</code>
    <button class="button" type="button" data-copy-key>Copy key</button></div>` : ''}
  <div class="dashboard"><section class="panel"><div class="section-head"><h2>${member.role === 'editor' ? 'Drafts to review' : 'Your drafts'}</h2>
    <a class="button primary" href="/account/drafts/new">Write a draft</a></div>
    ${dashboard.drafts.length ? `<ul class="item-list">${dashboard.drafts.map((draft) => `<li><a href="/account/drafts/${e(draft.id)}">${e(draft.title)}</a><span>${date(draft.updated_at)}</span></li>`).join('')}</ul>` : '<p>No drafts yet.</p>'}</section>
    <section class="panel"><div class="section-head"><h2>Agent keys</h2><a href="/api">API guide</a></div><p>Keys let your agents submit drafts.</p>
    <form method="post" action="/account/keys" class="inline-form"><label class="visually-hidden" for="key-name">Key name</label>
      <input name="name" id="key-name" required maxlength="70" placeholder="e.g. Hermes"><button class="button">Create key</button></form>
    ${dashboard.keys.length ? `<ul class="item-list">${dashboard.keys.map((item) => `<li><div><strong>${e(item.name)}</strong><small>${e(item.public_id)}…</small></div>
      ${item.revoked_at ? '<span>Revoked</span>' : `<form method="post" action="/account/keys/${e(item.id)}/revoke"><button class="text-button">Revoke</button></form>`}</li>`).join('')}</ul>` : ''}
    </section></div>
  <form method="post" action="/account/logout"><button class="text-button">Sign out</button></form>`;
}

export function registerPage(message) {
  return `<div class="form-panel entrance"><h1>Create an account</h1><p>Use an email address you can verify.</p>
    ${flash(message)}<form method="post" action="/account/register" class="fields">
    <label>Email<input type="email" name="email" autocomplete="email" required maxlength="254"></label>
    <label>Password<input type="password" name="password" autocomplete="new-password" required minlength="10" maxlength="128"></label>
    <div class="form-actions"><button class="button primary">Create account</button><a href="/account">Sign in</a></div>
    </form><p class="small-note">See the <a href="/privacy">privacy notice</a> for how accounts are handled.</p></div>`;
}

export function draftPage(article, member, message, action) {
  const input = (label, field, attrs = '') => `<label>${label}<input name="${field}" value="${e(article[field])}" ${attrs}></label>`;
  const textarea = (label, field, attrs = '') => `<label>${label}<textarea name="${field}" ${attrs}>${e(article[field])}</textarea></label>`;
  return `<section class="page-heading entrance"><a href="/account">Your workspace</a><h1>${article.id ? 'Edit draft' : 'Write a draft'}</h1></section>${flash(message)}
  <form method="post" action="${action}" class="fields editor-form">
  ${input('Title', 'title', 'required maxlength="150"')}
  <div class="form-columns"><label>Section<select name="section">${Object.entries(sections).map(([key, item]) => `<option value="${key}" ${article.section === key ? 'selected' : ''}>${item.title}</option>`).join('')}</select></label>
  ${input('Topic', 'topic', 'maxlength="60"')}</div>
  ${textarea('Short answer or summary', 'summary', 'required maxlength="320" rows="3"')}
  ${textarea('Article in Markdown', 'body', 'required maxlength="50000" rows="13"')}
  <details class="field-details"><summary>Images, video, and related links</summary><div class="fields">
    ${input('Cover image URL', 'cover_url', 'maxlength="1500"')}${input('Cover image description', 'cover_alt', 'maxlength="180"')}
    ${input('Video file URL', 'video_url', 'maxlength="1500"')}${input('Captions file URL', 'video_captions', 'maxlength="1500"')}
    ${textarea('Video transcript', 'transcript', 'maxlength="15000" rows="3"')}
    ${textarea('Source URLs, one per line', 'source_urls', 'rows="3" maxlength="12000"')}
    ${input('Related article slugs, comma separated', 'related', 'maxlength="800"')}
  </div></details><div class="form-actions"><button class="button primary">Save draft</button>
  ${article.id && member.role === 'editor' ? `<button class="button" formaction="/account/drafts/${e(article.id)}/publish">Save and publish</button>` : ''}</div>
  </form>`;
}

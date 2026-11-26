import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { sections } from './demo.mjs';
import { structureArticle } from './connections.mjs';

export const escape = (value = '') => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const e = escape;
const href = (slug) => '/articles/' + encodeURIComponent(slug);
const date = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '';
const articleDateTime = (value) => value ? new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
}).format(new Date(value)) : '';
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const iconPaths = {
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  moon: '<path d="M20 15a8 8 0 0 1-11-11 8 8 0 1 0 11 11Z"/>',
  link: '<path d="M9 15 15 9m-7 8-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 8a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" transform="translate(1 0) scale(.9 1)"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">${iconPaths[name]}</svg>`;
}
const brand = '<a class="brand" href="/"><img class="brand-mark" src="/mark.svg" width="40" height="40" alt=""><span>OpenBlog</span></a>';

function navigation(active) {
  return [['blogs', 'Blogs'], ['news', 'News'], ['api', 'Connective AI agent']].map(([key, label]) =>
    `<a href="/${key}" ${active === key ? 'aria-current="page"' : ''}>${label}</a>`).join('');
}

export function layout(ctx, { title, description, content, path, image, schema, privatePage = false, active = '' }) {
  const absolute = new URL(path, ctx.origin).href;
  const label = title === 'OpenBlog' ? title : title + ' | OpenBlog';
  const displayImage = image ? new URL(image, ctx.origin).href : new URL('/media/connected.webp', ctx.origin).href;
  const isArticle = schema?.['@type'] === 'Article' || schema?.['@type'] === 'NewsArticle';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${e(label)}</title><meta name="description" content="${e(description)}">
<meta name="robots" content="${privatePage || ctx.demo ? 'noindex, nofollow' : 'index,follow,max-image-preview:large'}">
<link rel="canonical" href="${e(absolute)}"><link rel="alternate" type="application/rss+xml" title="OpenBlog" href="/feed.xml">
<meta property="og:site_name" content="OpenBlog"><meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(absolute)}">
<meta property="og:type" content="${isArticle ? 'article' : 'website'}">
<meta property="og:image" content="${e(displayImage)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/mark.svg" type="image/svg+xml"><script src="/theme.js"></script>
<link rel="stylesheet" href="/styles.css?v=newsroom-20261127"><script defer src="/interactions.js?v=cover-credits-20261126"></script>
${schema ? `<script type="application/ld+json">${json(schema)}</script>` : ''}
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <div class="topbar-inner">${brand}
    <div class="header-controls">
      <nav class="top-links" aria-label="Main sections">${navigation(active)}</nav>
      <div class="top-actions">
        <button class="search-trigger" type="button" data-search-open aria-haspopup="dialog" aria-label="Search articles">${icon('search')}<span>Search articles</span><kbd aria-hidden="true">/</kbd></button>
        <button class="icon-button theme-toggle" type="button" data-theme-toggle aria-label="Switch color theme">${icon('moon')}</button>
        <a class="button account-button" href="/account">${ctx.user ? 'Account' : 'Sign in'}</a>
      </div>
    </div>
  </div>
  ${isArticle ? '<div class="reading-progress" data-reading-progress aria-hidden="true"></div>' : ''}
</header>
<div class="shell">
  <main id="main" class="main" tabindex="-1">${content}</main>
  <footer class="footer"><span>OpenBlog</span><div><a href="/about">About</a><a href="/policy">Editorial policy</a><a href="/privacy">Privacy</a><a href="/disclaimer">Disclaimer</a><a href="/contact">Contact</a><a href="/feed.xml">RSS</a></div></footer>
</div>
<dialog class="search-dialog" closedby="any" aria-labelledby="search-title">
<form action="/search" class="search-dialog-body"><label id="search-title" for="global-search">Search OpenBlog</label>
<div class="search-dialog-row">${icon('search')}<input id="global-search" type="search" name="q" placeholder="Search articles or topics…" maxlength="100" required>
<button class="button primary" type="submit">Search</button></div></form>
<form method="dialog"><button class="search-dismiss" aria-label="Close search">Esc</button></form>
</dialog>
</body></html>`;
}

function cover(article, className = '', eager = false) {
  const media = article.cover_url
    ? `<img src="${e(article.cover_url)}" alt="${e(article.cover_alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
    : '<div class="cover-placeholder"><span>Photo unavailable</span></div>';
  return `<div class="cover ${className}">${media}</div>`;
}
function imageCredit(credit) {
  if (!credit || credit.provider !== 'Wikimedia Commons' || typeof credit.creator !== 'string' ||
      typeof credit.license !== 'string' || typeof credit.source_url !== 'string' || typeof credit.license_url !== 'string') return '';
  let source;
  let license;
  try {
    source = new URL(credit.source_url);
    license = new URL(credit.license_url);
  } catch { return ''; }
  if (source.protocol !== 'https:' || source.hostname !== 'commons.wikimedia.org' ||
      license.protocol !== 'https:' || license.hostname !== 'creativecommons.org') return '';
  return `<p class="image-credit">Photo by <a href="${e(source.href)}" rel="noopener noreferrer">${e(credit.creator)}</a> · <a href="${e(license.href)}" rel="noopener noreferrer">${e(credit.license)}</a></p>`;
}
function newsTopic(article) {
  const topic = String(article.topic ?? '').trim();
  if (topic && !/^(news|news analysis|general news)$/i.test(topic)) return topic;
  const text = `${article.title ?? ''} ${article.summary ?? ''}`.toLocaleLowerCase('en');
  if (/\b(cyber|security|malware|malvertising|cve[- ]|breach|vulnerabilit|firewall|pan-os|critical infrastructure|data leak|data exposure|attacks?)\b/.test(text)) return 'Technology & security';
  if (/\b(acquisition|acquisitions|merger|mergers|earnings|revenue|stock market|market shares?)\b/.test(text)) return 'Business';
  if (/\b(election|parliament|president|prime minister|diplomacy|ceasefire|sanctions|government)\b/.test(text)) return 'World';
  return 'Latest';
}
function newsTopicId(topic) {
  const slug = topic.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return 'news-topic-' + (slug || 'latest');
}
function newsMeta(article) {
  return `<div class="entry-meta"><span class="section-label news">News</span><span>${e(newsTopic(article))}</span>${time(article.published_at)}</div>`;
}
function newsBrief(article) {
  return `<article class="news-brief reveal"><a class="news-brief-link" href="${href(article.slug)}">
    ${cover(article, 'news-brief-cover')}
    <div class="news-brief-copy">${newsMeta(article)}<h3>${e(article.title)}</h3><p>${e(article.summary)}</p></div>
  </a>${imageCredit(article.cover_credit)}</article>`;
}
function newsCard(article) {
  return `<article class="news-card reveal"><a class="news-card-link" href="${href(article.slug)}">
    ${cover(article, 'news-card-cover')}
    <div class="news-card-copy">${newsMeta(article)}<h3>${e(article.title)}</h3><p>${e(article.summary)}</p><span class="read-label">Read story</span></div>
  </a>${imageCredit(article.cover_credit)}</article>`;
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

const time = (value, prefix = '') => `<time datetime="${new Date(value).toISOString()}">${prefix ? e(prefix) + ' ' : ''}${e(articleDateTime(value))} IST</time>`;
const articleLinkList = (items) => `<ul class="article-link-list">${items.map((article) => `<li><a href="${href(article.slug)}">${e(article.title)}</a><span>${e(article.topic)}</span></li>`).join('')}</ul>`;
const emptyArticles = '<div class="empty"><h2>Articles are on the way</h2><p>Published stories will appear here.</p></div>';

export function home(blogs, news) {
  const [featured, ...otherBlogs] = blogs;
  return `<header class="explore-title">
    <div class="explore-title-copy entrance"><h1>Welcome to OpenBlog</h1>
      <p>Explore a connected library of articles, guides, and news.</p></div>
    <div class="explore-title-art"><img src="/media/rings.webp" width="640" height="400" alt="" fetchpriority="high" decoding="async"></div>
  </header>
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
        <div class="blog-entry-text"><div class="entry-meta">${time(article.published_at, 'Published')}${article.topic ? `<span>${e(article.topic)}</span>` : ''}</div>
          <h2>${e(article.title)}</h2><p>${e(article.summary)}</p><span class="read-label">Read article</span></div>
        ${article.cover_url ? cover(article, 'blog-entry-cover') : ''}
      </a></article>`).join('')}
    </section>` : emptyArticles}${pager('/blogs', {}, pagination)}`;
}

export function newsIndex(articles, pagination) {
  const seen = new Set();
  const unique = articles.filter((article) => {
    const key = `${article.title ?? ''}\n${article.summary ?? ''}`.toLocaleLowerCase('en')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const [lead, ...rest] = unique;
  const headlines = rest.slice(0, 2);
  const groups = new Map();
  for (const article of rest.slice(2)) {
    const topic = newsTopic(article);
    if (topic === 'Latest') continue;
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(article);
  }
  const topics = [...groups.keys()];
  const topicNav = topics.length ? `<nav class="news-topic-nav" aria-label="News topics"><a href="#latest-stories">Latest</a>
    ${topics.map((topic) => `<a href="#${e(newsTopicId(topic))}">${e(topic)}</a>`).join('')}</nav>`
    : '<nav class="news-topic-nav" aria-label="News topics"><a href="#latest-stories">Latest</a></nav>';
  const shelves = topics.map((topic) => `<section class="news-topic-shelf" id="${e(newsTopicId(topic))}" aria-labelledby="${e(newsTopicId(topic))}-title">
    <div class="section-head"><h2 id="${e(newsTopicId(topic))}-title">${e(topic)}</h2><span>${groups.get(topic).length} ${groups.get(topic).length === 1 ? 'story' : 'stories'}</span></div>
    <div class="news-card-grid">${groups.get(topic).map(newsCard).join('')}</div>
  </section>`).join('');
  return `<header class="news-intro entrance"><div><p class="news-kicker">OpenBlog newsroom</p><h1>News</h1>
      <p>Reporting and context on what’s changing, with sources you can follow.</p></div>
      ${lead ? `<p class="news-updated"><span>Latest story</span>${time(lead.published_at)}</p>` : ''}
    </header>
    ${unique.length ? `${topicNav}<section class="news-front entrance" id="latest-stories" aria-label="Latest stories">
      <article class="news-feature"><a class="news-feature-link" href="${href(lead.slug)}">
        ${cover(lead, 'news-cover', true)}
        <div class="news-feature-text">${newsMeta(lead)}<h2>${e(lead.title)}</h2><p>${e(lead.summary)}</p><span class="read-label">Read story</span></div>
      </a>${imageCredit(lead.cover_credit)}</article>
      ${headlines.length ? `<section class="news-headlines" aria-labelledby="news-headlines-title"><h2 id="news-headlines-title">More latest news</h2>
        ${headlines.map(newsBrief).join('')}
      </section>` : ''}
    </section>${shelves}` : emptyArticles}${pager('/news', {}, pagination)}`;
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

export function markdown(body, candidates = [], slug) {
  const html = sanitizeHtml(marked.parse(body, { async: false }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'figure', 'figcaption'],
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title', 'loading'], code: ['class'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: { img: (name, attribs) => ({ tagName: name, attribs: { ...attribs, loading: 'lazy' } }) },
  });
  return structureArticle(html, candidates, slug);
}

function outlineList(headings) {
  return `<ul>${headings.map(({ id, label, summary, children }) => `<li><a href="#${id}"${summary ?
    ` data-section-preview="${e(summary)}"` : ''}>${e(label)}</a>${children.length ? outlineList(children) : ''}</li>`).join('')}</ul>`;
}

function knowledgeMap(article, related) {
  if (!related.length) return '';
  return `<section class="knowledge-map" aria-labelledby="connection-title">
    <div class="section-head"><div><p class="eyebrow">Follow the ideas</p><h2 id="connection-title">Connected reading</h2></div></div>
    <p class="knowledge-map-intro">These articles connect through shared subjects, explicit links, or terms in their titles and summaries.</p>
    <div class="knowledge-map-flow"><div class="knowledge-map-current"><span>Current article</span><strong>${e(article.title)}</strong></div>
      <ul>${related.map((item) => `<li><span class="connection-line" aria-hidden="true"></span><a href="${href(item.slug)}"><strong>${e(item.title)}</strong><span>${e(item.connection_reason || (item.topic === article.topic ? 'Same topic' : 'Related reading'))}</span></a></li>`).join('')}</ul>
    </div>
  </section>`;
}

export function feedbackForm(articleSlug = '', submitted = false, enabled = true) {
  if (!enabled) return `<section class="feedback-panel" id="reader-feedback"><h2 id="feedback-title">Report an issue</h2><p>Reader reports become available when OpenBlog is connected to its database.</p></section>`;
  const categories = [['correction', 'Correction'], ['accuracy', 'Accuracy question'], ['broken-link', 'Broken link'], ['accessibility', 'Accessibility'], ['other', 'Other']];
  return `<section class="feedback-panel" id="reader-feedback" aria-labelledby="feedback-title">
    <h2 id="feedback-title">Report an issue</h2>
    <p>Help us review a correction, unclear passage, broken link, or accessibility problem.</p>
    ${submitted ? flash('Thanks. Your report was sent to the OpenBlog editors.') : ''}
    <form method="post" action="/feedback" class="feedback-form" aria-labelledby="feedback-title">
      <input type="hidden" name="article_slug" value="${e(articleSlug)}">
      <div class="form-trap" aria-hidden="true"><label for="feedback-website">Leave this field empty</label><input id="feedback-website" name="website" tabindex="-1" autocomplete="off"></div>
      <label for="feedback-category">Report type <span aria-hidden="true">*</span><select id="feedback-category" name="category" required>
        <option value="">Choose a report type</option>${categories.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
      </select></label>
      <label for="feedback-message">What should we review? <span aria-hidden="true">*</span><textarea id="feedback-message" name="message" required minlength="20" maxlength="4000" rows="5" aria-describedby="feedback-help"></textarea></label>
      <p id="feedback-help" class="small-note">Please include the relevant claim and a source when possible. Do not include private or sensitive information. Reports are stored for editor review; this form does not collect your name or email.</p>
      <button class="button primary" type="submit">Send report</button>
    </form>
  </section>`;
}

export function articleView(article, related, canEdit = false, candidates = [], { feedbackSubmitted = false, feedbackEnabled = true } = {}) {
  const { bodyHtml, headings } = markdown(article.body, candidates, article.slug);
  const toc = headings.length ? `<nav class="article-nav" data-reading-outline aria-label="Article outline"><h2>On this page</h2>
    ${outlineList(headings)}</nav>` : '';

  const isNews = article.section === 'news';
  return `<div class="article-layout ${isNews ? 'news-reading' : 'blog-reading'}">
  <article class="article entrance">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Explore</a><span>/</span><a href="/${isNews ? 'news' : 'blogs'}">${isNews ? 'News' : 'Blogs'}</a></nav>
    <header class="article-header"><div class="entry-meta">${time(article.published_at, 'Published')}${article.topic ? `<span>${e(article.topic)}</span>` : ''}</div>
      <h1>${e(article.title)}</h1><p>${e(article.summary)}</p>
      <div class="byline"><span>By ${e(article.author_name)}</span>${Date.parse(article.updated_at) - Date.parse(article.published_at) > 60_000 ? `<span>${time(article.updated_at, 'Updated')}</span>` : ''}</div></header>
    ${article.cover_url ? `<div class="article-cover-block">${cover(article, 'article-cover', true)}${imageCredit(article.cover_credit)}</div>` : ''}
    ${toc ? `<div class="mobile-toc">${toc}</div>` : ''}
    <div class="prose">${bodyHtml}</div>
    ${article.video_url ? `<section class="article-media"><h2>Watch the explanation</h2>
      <video controls playsinline preload="metadata" src="${e(article.video_url)}" ${article.video_captions?.startsWith('https://') ? 'crossorigin="anonymous"' : ''} ${article.cover_url ? `poster="${e(article.cover_url)}"` : ''}>
      ${article.video_captions ? `<track kind="captions" label="English" srclang="en" src="${e(article.video_captions)}" default>` : ''}
      </video>${article.transcript ? `<details><summary>Read the transcript</summary><p>${e(article.transcript)}</p></details>` : ''}</section>` : ''}
    ${article.sources?.length ? `<section class="sources"><h2>Sources</h2><ul>${article.sources.map((source) =>
      `<li><a href="${e(source.url)}" rel="noopener noreferrer">${e(source.title)}</a></li>`).join('')}</ul></section>` : ''}
    <div class="article-tools"><a href="${href(article.slug)}/markdown">Markdown version</a> <button type="button" class="button" data-copy-link>${icon('link')} Copy link</button>${canEdit ? ` <a class="button" href="/account${href(article.slug)}">Edit article</a>` : ''}</div>
    ${knowledgeMap(article, related)}${feedbackForm(article.slug, feedbackSubmitted, feedbackEnabled)}
  </article><aside class="article-aside">${toc}</aside>
  <div id="reading-preview" class="reading-preview" role="tooltip" hidden><strong></strong><p></p></div>
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

export function draftPage(article, member, message, action, published = false) {
  const input = (label, field, attrs = '') => `<label>${label}<input name="${field}" value="${e(article[field])}" ${attrs}></label>`;
  const textarea = (label, field, attrs = '') => `<label>${label}<textarea name="${field}" ${attrs}>${e(article[field])}</textarea></label>`;
  return `<section class="page-heading entrance"><a href="/account">Your workspace</a><h1>${published ? 'Edit published article' : article.id ? 'Edit draft' : 'Write a draft'}</h1></section>${flash(message)}
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
  </div></details><div class="form-actions"><button class="button primary">${published ? 'Save changes' : 'Save draft'}</button>
  ${!published && article.id && member.role === 'editor' ? `<button class="button" formaction="/account/drafts/${e(article.id)}/publish">Save and publish</button>` : ''}</div>
  </form>`;
}

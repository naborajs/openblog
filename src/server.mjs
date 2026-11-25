import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { isIP } from 'node:net';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAuth } from './auth.mjs';
import { articleInput, isId, isSlug, RequestError, text } from './content.mjs';
import { sections } from './demo.mjs';
import { createStore } from './store.mjs';
import { accountPage, articleView, blogIndex, draftPage, escape, feedbackForm, home, layout, listing, newsIndex, plainPage, registerPage } from './views.mjs';

const publication = 'OpenBlog';
const description = 'A connected library for news, teaching, and curious questions.';
const basePages = ['', 'blogs', ...Object.keys(sections), 'about', 'policy', 'privacy', 'disclaimer', 'contact', 'api'];
const staticTypes = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.vtt': 'text/vtt; charset=utf-8', '.mp4': 'video/mp4',
};
const rangePattern = /^bytes=(\d*)-(\d*)$/;
const postRoute = /^\/articles\/([^/]+)(\/markdown)?$/;
const draftRoute = /^\/account\/drafts\/(new|[^/]+)(\/publish)?$/;
const editArticleRoute = /^\/account\/articles\/([^/]+)$/;
const agentKey = /^Bearer (ob_[a-zA-Z0-9_-]{43})$/;
const pageSize = 12;
const xml = escape;

const send = (res, status, type, body) => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
const json = (res, status, data) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
const redirect = (res, location) => { res.writeHead(303, { Location: location }); res.end(); };

function clientAddress(request) {
  const peer = request.socket.remoteAddress || 'local';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return peer;
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string' || forwarded.length > 512) return peer;
  const trustedProxyAddress = forwarded.split(',').map((value) => value.trim()).at(-1);
  return trustedProxyAddress && isIP(trustedProxyAddress) ? trustedProxyAddress : peer;
}

async function readBody(request, expected) {
  const type = request.headers['content-type']?.split(';')[0];
  if (type !== expected) throw new RequestError(415, 'Use the expected request content type.');
  const pieces = [];
  let bytes = 0;
  for await (const part of request) {
    bytes += part.length;
    if (bytes > 320_000) {
      request.resume();
      throw new RequestError(413, 'This submission is too large.');
    }
    pieces.push(part);
  }
  const data = Buffer.concat(pieces).toString('utf8');
  if (expected === 'application/json') {
    try { return JSON.parse(data); } catch { throw new RequestError(400, 'The body must be valid JSON.'); }
  }
  return Object.fromEntries(new URLSearchParams(data));
}

async function serveAsset(request, response, path) {
  if (!/^\/(?:(?:media\/)?[a-z0-9][a-z0-9_.-]*)$/i.test(path) || path.includes('..')) return false;
  const type = staticTypes[extname(path)];
  if (!type) return false;
  const file = new URL('../public' + path, import.meta.url);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;

  const headers = { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'public, max-age=3600' };
  let options;
  if (path.endsWith('.mp4')) {
    headers['Accept-Ranges'] = 'bytes';
    const requestedRange = request.headers.range;
    if (requestedRange) {
      const range = rangePattern.exec(requestedRange);
      const start = range?.[1] ? Number(range[1]) : Math.max(0, info.size - Number(range?.[2]));
      const end = range?.[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (!range || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= info.size) {
        response.writeHead(416, { 'Content-Range': 'bytes */' + info.size });
        response.end();
        return true;
      }
      options = { start, end };
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      headers['Content-Length'] = end - start + 1;
    }
  }
  response.writeHead(options ? 206 : 200, headers);
  if (request.method === 'HEAD') response.end();
  else createReadStream(file, options).on('error', () => response.destroy()).pipe(response);
  return true;
}

function dateIso(value) { return new Date(value).toISOString(); }
function urlOf(origin, path) { return new URL(path, origin).href; }

function articleSchema(origin, article) {
  const url = urlOf(origin, '/articles/' + article.slug);
  return {
    '@context': 'https://schema.org',
    '@type': article.section === 'news' ? 'NewsArticle' : 'Article',
    headline: article.title, description: article.summary, url, mainEntityOfPage: url, inLanguage: 'en',
    datePublished: dateIso(article.published_at), dateModified: dateIso(article.updated_at),
    author: { '@type': 'Person', name: article.author_name },
    publisher: { '@type': 'Organization', name: publication, url: origin },
    articleSection: sections[article.section].title,
    ...(article.cover_url ? { image: [urlOf(origin, article.cover_url)] } : {}),
    ...(article.sources.length ? { citation: article.sources.map(({ url }) => url) } : {}),
    ...(article.video_url && article.cover_url ? { video: {
      '@type': 'VideoObject', name: article.title, description: article.summary,
      thumbnailUrl: urlOf(origin, article.cover_url), contentUrl: urlOf(origin, article.video_url),
      uploadDate: dateIso(article.published_at),
    } } : {}),
  };
}

function contactParagraph(email) {
  return email ? `<p>Contact the operator at <a href="mailto:${escape(email)}">${escape(email)}</a>.</p>` : '';
}

function information(path, contactEmail, feedbackSubmitted = false, feedbackEnabled = true) {
  const contact = contactParagraph(contactEmail);
  const pages = {
    '/about': ['About OpenBlog', 'OpenBlog connects news, practical learning, and the questions that lead readers deeper.',
      `<h2>What we publish</h2><p>Blogs are our original guides, essays, and explainers. News covers developments and gives readers the context to understand them.</p>
      <h2>How we work</h2><p>Contributors and agents can prepare drafts. Editors review sourcing, clarity, and accuracy before publishing.</p>
      <h2>Open-source software</h2><p>The <a href="https://github.com/naborajs/openblog">website code is public</a> under the MIT License. Editorial rights and crawler permissions are described in the <a href="/policy">editorial policy</a>.</p>${contact}`],
    '/policy': ['Editorial policy', 'How OpenBlog researches, reviews, and licenses its work.',
      `<h2>Standards and corrections</h2><p>We aim to identify original sources, label examples and uncertainty, and give news articles dates and context. Corrections should identify the updated claim. Contact the operator with a link and the information that needs review.</p>
      <h2>Agent contributions</h2><p>Agents can submit drafts. An editor checks claims, sourcing, and rights before publishing. We label material AI assistance and publish original explanations or reporting. Source links point readers to supporting information.</p>
      <h2>Editorial independence</h2><p>We label paid placements and sponsored material if we publish them. Revenue arrangements do not determine our reporting or corrections.</p>
      <h2>Public crawling and citation</h2><p>Public articles may be indexed, linked, and cited with a brief excerpt and attribution. Use the article’s canonical link and byline. Automated clients may crawl public pages, should use the public API when practical, and must respect robots.txt and rate limits. Do not republish full articles without permission.</p>
      <h2>Content rights</h2><p>The MIT License applies to website software. Articles, prose, and editorial media retain their stated rights. Redistribution, republication, and model training require permission except where the law or the materials’ own terms allow them.</p>${contact}`],
    '/privacy': ['Privacy notice', 'How OpenBlog handles reader activity and contributor accounts.',
      `<h2>Reading</h2><p>You can read public articles without an account. The website remembers your color theme on your device. Server access logs may record details such as IP addresses and request paths to operate and protect the service.</p>
      <h2>Reader reports</h2><p>If you submit a correction or issue report, we store its category, message, and related article slug (if supplied) in OpenBlog’s editorial database so an editor can investigate. The form does not ask for your name or email, does not publish reports, and does not store your IP address in the report record. Avoid including private or sensitive information. Reports are kept for editorial review and removed when no longer needed.</p>
      <h2>Accounts and drafts</h2><p>Supabase Auth handles your sign-in email and credentials. OpenBlog stores a user ID, your public byline, your role, and the drafts and posts you create. Session cookies keep you signed in. Agent key secrets are shown once and stored as hashes.</p>
      <h2>Images and video</h2><p>Some articles can load images or video from an external host. The host receives the ordinary network request for the file.</p>
      <h2>Advertising</h2><p>OpenBlog currently serves no ads. If we add advertising, this notice will identify the providers and explain how their cookies and consent choices work.</p>
      <h2>Your account</h2><p>You can revoke agent keys from your workspace. Visit <a href="/contact">Contact</a> to request access, correction, or deletion of account data.</p>${contact}`],
    '/disclaimer': ['Disclaimer', 'How to use information published on OpenBlog.',
      `<h2>Educational information</h2><p>OpenBlog articles offer general information and discussion. For medical, legal, or financial decisions, consult a qualified adviser. Check dated claims and instructions against the linked primary sources before acting.</p>
      <h2>Independence and links</h2><p>OpenBlog is an independent publication. Product names identify their respective owners. External links are provided as references. Their publishers control those sites and their privacy practices.</p>
      <h2>Corrections</h2><p>Send the article URL, the claim in question, and any supporting sources through <a href="/contact">Contact</a>.</p>`],
    '/contact': ['Contact', 'Get in touch with OpenBlog.',
      `${contact || '<p>For public website feedback, use the <a href="https://github.com/naborajs/openblog/issues">project issue tracker</a>.</p>'}
      <h2>Corrections and rights requests</h2><p>Include the article URL, what you’d like reviewed, and a source or description that helps us investigate. Keep personal details and account information out of public issues.</p>${feedbackForm('', feedbackSubmitted, feedbackEnabled)}`],
    '/api': ['Connective AI agent', 'Discover published articles and submit drafts on behalf of an OpenBlog contributor.',
      `<h2>Read public articles</h2><ul><li><code>GET /api/v1/articles</code> lists articles. Optional parameters are <code>section</code>, <code>topic</code>, <code>q</code>, <code>page</code>, and <code>limit</code>.</li>
      <li><code>GET /api/v1/articles/{slug}</code> returns the article, source links, and canonical URL.</li>
      <li><code>GET /articles/{slug}/markdown</code> serves the public article in Markdown. <a href="/feed.xml">RSS</a> lists recent publications.</li></ul>
      <h2>Submit a draft</h2><p>Sign in and create an agent key in <a href="/account">your workspace</a>. Keep the key in your agent's secret storage.</p>
      <pre><code>POST /api/v1/drafts
Authorization: Bearer YOUR_AGENT_KEY
Content-Type: application/json
Idempotency-Key: a-stable-job-id

{
  "title": "Example article",
  "section": "teaching",
  "summary": "A short answer for the reader.",
  "body": "## The explanation\\n\\nWrite the draft in Markdown.",
  "sources": [{"title": "Reference", "url": "https://example.org/"}]
}</code></pre><p>Sections are <code>news</code>, <code>teaching</code>, and <code>find-out</code>. Optional fields include <code>topic</code>, <code>cover_url</code>, <code>cover_alt</code>, <code>video_url</code>, <code>video_captions</code>, <code>transcript</code>, and <code>related_slugs</code>. Reuse the idempotency key for retries of the same draft. The first request returns <code>201</code> and retries return <code>200</code> with the same draft ID. An editor publishes it from the website.</p>`],
  };
  const data = pages[path];
  return data ? { title: data[0], description: data[1], content: plainPage(...data) } : null;
}

export function createApp({ store, auth, origin, contactEmail = '' }) {
  const limits = new Map();
  function rateLimit(req, group, limit) {
    const now = Date.now();
    if (limits.size > 1000) for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    const id = group + ':' + clientAddress(req);
    let bucket = limits.get(id);
    if (!bucket || bucket.until < now) { bucket = { count: 0, until: now + 60000 }; limits.set(id, bucket); }
    if (++bucket.count > limit) throw new RequestError(429, 'Too many requests. Try again in a minute.');
  }

  async function showAccount(request, res, ctx, { message, key } = {}) {
    const user = ctx.user;
    const member = user ? await store.membership(user) : null;
    const dashboard = member ? await store.dashboard(user) : null;
    return send(res, 200, 'text/html; charset=utf-8', layout(ctx, {
      title: 'Your account', description: 'Manage drafts and agent keys.', path: '/account', privatePage: true,
      content: accountPage({ demo: store.demo, user, member, dashboard, message, key }),
    }));
  }

  async function handleAccount(request, res, url, ctx) {
    const path = url.pathname;
    res.setHeader('Cache-Control', 'private, no-store');
    const render = (title, content, status = 200) => send(res, status, 'text/html; charset=utf-8',
      layout(ctx, { title, description: title + ' on OpenBlog.', content, path, privatePage: true }));

    if (request.method === 'GET') {
      if (path === '/account') return showAccount(request, res, ctx);
      if (!auth) throw new RequestError(503, 'Connect Supabase to use accounts.');
      if (path === '/account/register') return render('Create an account', registerPage());
      if (path === '/account/confirm') {
        return render('Confirm your email', plainPage('Confirm your email', 'Finish setting up your OpenBlog account.',
          `<form method="post" class="fields" data-auth-confirm>
            <input type="hidden" name="token_hash" value="${escape((url.searchParams.get('token_hash') ?? '').slice(0, 300))}">
            <input type="hidden" name="access_token"><input type="hidden" name="refresh_token">
            <button class="button primary">Confirm email</button><p data-auth-message role="status"></p></form>`));
      }
      const edit = editArticleRoute.exec(path);
      if (edit && isSlug(edit[1])) {
        if (!ctx.user) return redirect(res, '/account');
        const post = await store.publishedForEditor(ctx.user, edit[1]);
        if (!post) throw new RequestError(404, 'Article not found.');
        post.source_urls = post.sources.map(({ url }) => url).join('\n');
        post.related = post.related_slugs.join(', ');
        return render('Edit published article', draftPage(post, null, null, path, true));
      }
      const draft = draftRoute.exec(path);
      if (draft && !draft[2] && (draft[1] === 'new' || isId(draft[1]))) {
        if (!ctx.user) return redirect(res, '/account');
        const member = await store.membership(ctx.user);
        if (!member) return redirect(res, '/account');
        const post = draft[1] === 'new' ? { section: 'teaching' } : await store.draft(ctx.user, draft[1]);
        if (!post) throw new RequestError(404, 'Draft not found.');
        post.source_urls = post.sources?.map(({ url }) => url).join('\n');
        post.related = post.related_slugs?.join(', ');
        return render('Article draft', draftPage(post, member, null, path));
      }
      throw new RequestError(404, 'Account page not found.');
    }

    if (!auth) throw new RequestError(503, 'Connect Supabase to use accounts.');
    if (request.headers.origin !== origin) throw new RequestError(403, 'Save the form from OpenBlog.');
    rateLimit(request, 'account', 45);
    const fields = await readBody(request, 'application/x-www-form-urlencoded');
    if (path === '/account/login' || path === '/account/register') {
      rateLimit(request, 'credentials', 12);
      const email = text(fields.email, 254, 'an email address', true);
      const password = typeof fields.password === 'string' ? fields.password : '';
      if (!password || password.length > 128) throw new RequestError(400, 'Enter a valid password.');
      if (path === '/account/login') {
        const error = await auth.login(res, email, password);
        if (error) return showAccount(request, res, ctx, { message: error });
      } else {
        if (password.length < 10) return render('Create an account', registerPage('Use at least 10 characters.'), 400);
        const result = await auth.register(res, email, password);
        if (result.error) return render('Create an account', registerPage(result.error), 400);
        if (result.confirmation) return render('Check your email', plainPage('Check your email',
          'Follow the confirmation link to activate your OpenBlog account.', '<p><a href="/account">Return to sign in</a></p>'));
      }
      return redirect(res, '/account');
    }
    if (path === '/account/confirm') {
      const token = text(fields.token_hash, 300, 'the confirmation token');
      const accessToken = text(fields.access_token, 5000, 'the access token');
      const refreshToken = text(fields.refresh_token, 1500, 'the refresh token');
      const success = token ? await auth.confirm(res, token) : Boolean(accessToken && refreshToken && await auth.completeSession(res, accessToken, refreshToken));
      if (!success) throw new RequestError(400, 'This confirmation link is invalid or expired.');
      return redirect(res, '/account');
    }
    if (path === '/account/logout') { await auth.logout(request, res); return redirect(res, '/'); }
    if (!ctx.user) throw new RequestError(401, 'Sign in to continue.');
    if (path === '/account/join') {
      await store.join(ctx.user, text(fields.name, 80, 'a public byline', true));
      return redirect(res, '/account');
    }
    const member = await store.membership(ctx.user);
    if (!member) throw new RequestError(403, 'Join OpenBlog as a contributor first.');
    if (path === '/account/keys') {
      const key = await store.createKey(ctx.user, text(fields.name, 70, 'a key name', true));
      return showAccount(request, res, ctx, { key });
    }
    const keyRoute = /^\/account\/keys\/([^/]+)\/revoke$/.exec(path);
    if (keyRoute && isId(keyRoute[1])) {
      await store.revokeKey(ctx.user, keyRoute[1]);
      return redirect(res, '/account');
    }
    const edit = editArticleRoute.exec(path);
    if (edit && isSlug(edit[1])) {
      if (member.role !== 'editor') throw new RequestError(403, 'An editor is required to update a published article.');
      let input;
      try { input = articleInput(fields); } catch (error) {
        if (!(error instanceof RequestError)) throw error;
        return render('Edit published article', draftPage(fields, null, error.message, path, true), 400);
      }
      const post = await store.updatePublished(ctx.user, edit[1], input);
      if (!post) throw new RequestError(404, 'Article not found.');
      return redirect(res, '/articles/' + post.slug);
    }
    const draft = draftRoute.exec(path);
    if (draft && (draft[1] === 'new' || isId(draft[1]))) {
      const id = draft[1] === 'new' ? null : draft[1];
      const publish = Boolean(draft[2]);
      if (publish && (!id || member.role !== 'editor')) throw new RequestError(403, 'An editor is required to publish.');
      let input;
      try { input = articleInput(fields); } catch (error) {
        if (!(error instanceof RequestError)) throw error;
        const formAction = '/account/drafts/' + (id || 'new');
        return render('Article draft', draftPage({ ...fields, id }, member, error.message, formAction), 400);
      }
      const result = await store.saveDraft(ctx.user, member, input, id, publish);
      if (!result) throw new RequestError(404, 'Draft not found.');
      if (!publish) return redirect(res, '/account/drafts/' + result.id);
      return redirect(res, '/articles/' + result.slug);
    }
    throw new RequestError(404, 'Account action not found.');
  }

  return createServer(async (request, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https:; media-src 'self' https:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const ctx = { origin, demo: store.demo };
    let url;
    try {
      url = new URL(request.url, origin);
      const path = url.pathname;
      const method = request.method;
      if (!['GET', 'POST', 'HEAD'].includes(method)) {
        res.setHeader('Allow', 'GET, HEAD, POST');
        throw new RequestError(405, 'Method not allowed.');
      }
      if (method !== 'POST' && await serveAsset(request, res, path)) return;

      if (path.startsWith('/api/v1/')) {
        res.setHeader('Cache-Control', 'private, no-store');
        rateLimit(request, method === 'POST' ? 'agent-write' : 'agent-read', method === 'POST' ? 40 : 300);
        if (method !== 'POST' && path === '/api/v1/articles') {
          const filters = readFilters(url);
          const limit = numberParam(url, 'limit', 24, 1, 100);
          const page = numberParam(url, 'page', 1, 1, 10000);
          const rows = await store.articles({ ...filters, limit: limit + 1, offset: (page - 1) * limit });
          return json(res, 200, { page, limit, has_more: rows.length > limit, articles: rows.slice(0, limit).map((item) => publicArticle(origin, item)) });
        }
        if (method !== 'POST' && path.startsWith('/api/v1/articles/')) {
          const slug = path.slice('/api/v1/articles/'.length);
          const article = isSlug(slug) && await store.article(slug);
          if (!article) throw new RequestError(404, 'Published article not found.');
          return json(res, 200, publicArticle(origin, article));
        }
        if (method === 'POST' && path === '/api/v1/drafts') {
          if (store.demo) throw new RequestError(503, 'Draft submission requires a Supabase connection.');
          const key = agentKey.exec(request.headers.authorization || '')?.[1];
          if (!key) throw new RequestError(401, 'Provide an active agent key.');
          const idempotency = text(request.headers['idempotency-key'], 120, 'an idempotency key') || null;
          const article = articleInput(await readBody(request, 'application/json'));
          const result = await store.submitFromAgent(key, article, idempotency);
          if (!result) throw new RequestError(401, 'Provide an active agent key.');
          const { created, ...draft } = result;
          return json(res, created ? 201 : 200, { draft });
        }
        throw new RequestError(404, 'API route not found.');
      }

      if (path === '/feedback') {
        if (method !== 'POST') {
          res.setHeader('Allow', 'POST');
          throw new RequestError(405, 'Use the report form to send feedback.');
        }
        rateLimit(request, 'reader-feedback', 8);
        const fetchSite = request.headers['sec-fetch-site'];
        if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
          throw new RequestError(403, 'Feedback must be sent from OpenBlog.');
        }
        const requestOrigin = request.headers.origin;
        if (requestOrigin) {
          try {
            if (new URL(requestOrigin).origin !== origin) throw new RequestError(403, 'Feedback must be sent from OpenBlog.');
          } catch (error) {
            if (error instanceof RequestError) throw error;
            throw new RequestError(403, 'Feedback must be sent from OpenBlog.');
          }
        }
        if (store.demo) throw new RequestError(503, 'Feedback is unavailable in the demo.');
        const fields = await readBody(request, 'application/x-www-form-urlencoded');
        const targetSlug = text(fields.article_slug, 120, 'the article slug');
        if (targetSlug && !isSlug(targetSlug)) throw new RequestError(400, 'Choose a published article.');
        if (targetSlug && !(await store.article(targetSlug))) throw new RequestError(404, 'Published article not found.');
        if (fields.website) return redirect(res, targetSlug
          ? `/articles/${targetSlug}?feedback=sent#reader-feedback`
          : '/contact?feedback=sent#reader-feedback');
        const category = text(fields.category, 24, 'a report type', true);
        if (!['correction', 'accuracy', 'broken-link', 'accessibility', 'other'].includes(category)) {
          throw new RequestError(400, 'Choose one of the report types.');
        }
        const message = text(fields.message, 4000, 'report details', true);
        if (message.length < 20) throw new RequestError(400, 'Add at least 20 characters so editors can investigate.');
        const saved = await store.submitFeedback(targetSlug || null, category, message);
        if (!saved) throw new RequestError(503, 'Feedback is unavailable right now.');
        return redirect(res, targetSlug
          ? `/articles/${targetSlug}?feedback=sent#reader-feedback`
          : '/contact?feedback=sent#reader-feedback');
      }

      if (path === '/account' || path.startsWith('/account/')) {
        if (auth && path !== '/account/confirm') ctx.user = await auth.user(request, res);
        return await handleAccount(request, res, url, ctx);
      }
      if (method === 'POST') throw new RequestError(405, 'Method not allowed.');
      if (path === '/robots.txt') {
        const rules = 'Allow: /\nDisallow: /account\nDisallow: /api/v1/drafts\n';
        const robots = store.demo ? 'User-agent: *\nDisallow: /\n' :
          `User-agent: *\n${rules}\nUser-agent: OAI-SearchBot\n${rules}\nUser-agent: GPTBot\n${rules}\nUser-agent: Google-Extended\n${rules}\n\nSitemap: ${urlOf(origin, '/sitemap.xml')}\n`;
        return send(res, 200, 'text/plain; charset=utf-8', robots);
      }
      if (path === '/sitemap.xml') {
        const pages = store.demo ? [] : [...basePages.map((section) => ({ path: '/' + section })),
          ...(await store.sitemap()).map(({ slug, updated_at }) => ({ path: '/articles/' + slug, updated_at }))];
        const entries = pages.map((item) => `<url><loc>${xml(urlOf(origin, item.path))}</loc>${item.updated_at ? `<lastmod>${dateIso(item.updated_at)}</lastmod>` : ''}</url>`).join('');
        return send(res, 200, 'application/xml; charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`);
      }
      if (path === '/feed.xml') {
        const entries = (await store.articles({ limit: 25 })).map((item) => {
          const link = xml(urlOf(origin, '/articles/' + item.slug));
          return `<item><title>${xml(item.title)}</title><link>${link}</link><guid>${link}</guid><description>${xml(item.summary)}</description><pubDate>${new Date(item.published_at).toUTCString()}</pubDate></item>`;
        }).join('');
        return send(res, 200, 'application/rss+xml; charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>OpenBlog</title><link>${xml(origin)}</link><description>${xml(description)}</description>${entries}</channel></rss>`);
      }

      const html = (options) => send(res, 200, 'text/html; charset=utf-8', layout(ctx, { path: url.pathname + url.search, ...options }));
      if (path === '/') {
        const [blogs, news] = await Promise.all([
          store.articles({ blogOnly: true, limit: 4 }), store.articles({ section: 'news', limit: 5 }),
        ]);
        return html({
          title: publication, description, active: 'home', content: home(blogs, news),
          schema: { '@context': 'https://schema.org', '@type': 'WebSite', name: publication, url: origin, description },
        });
      }
      if (path === '/blog') return redirect(res, '/blogs');
      if (path === '/blogs' || path === '/news') {
        const isNews = path === '/news';
        const page = numberParam(url, 'page', 1, 1, 10000);
        const filters = isNews ? { section: 'news' } : { blogOnly: true };
        const rows = await store.articles({ ...filters, limit: pageSize + 1, offset: (page - 1) * pageSize });
        const pagination = { page, more: rows.length > pageSize };
        const renderEdition = isNews ? newsIndex : blogIndex;
        return html({ title: isNews ? 'News' : 'Blogs',
          description: isNews ? 'Reporting and context on what is changing.' : 'In-depth articles, practical guides, and ideas worth exploring.',
          active: isNews ? 'news' : 'blogs', path: path + (page > 1 ? '?page=' + page : ''),
          content: renderEdition(rows.slice(0, pageSize), pagination) });
      }
      if (path === '/search' || Object.hasOwn(sections, path.slice(1))) {
        const key = path.slice(1);
        const isSearch = key === 'search';
        const filters = isSearch ? readFilters(url) : { section: key };
        const page = numberParam(url, 'page', 1, 1, 10000);
        const rows = await store.articles({ ...filters, limit: pageSize + 1, offset: (page - 1) * pageSize });
        const title = isSearch ? (filters.topic || 'Search articles') : sections[key].title;
        const subtitle = isSearch ? 'Find articles by title, topic, or keyword.' : sections[key].description;
        const query = page > 1 ? '?page=' + page : '';
        return html({ title, description: subtitle, active: isSearch ? '' : 'blogs', privatePage: isSearch,
          path: path + (isSearch ? '' : query), content: listing(title, subtitle, rows.slice(0, pageSize),
            { ...(isSearch ? { search: filters.search, topic: filters.topic } : {}), path, pagination: { page, more: rows.length > pageSize } }) });
      }
      const post = postRoute.exec(path);
      if (post && isSlug(post[1])) {
        const article = await store.article(post[1]);
        if (!article) throw new RequestError(404, 'Published article not found.');
        if (post[2]) {
          res.setHeader('Link', '<' + urlOf(origin, '/articles/' + article.slug) + '>; rel="canonical"');
          const referenceList = article.sources.map(({ title, url }) => '- ' + title + ' — ' + url).join('\n');
          return send(res, 200, 'text/markdown; charset=utf-8',
            ['# ' + article.title, article.summary, 'By ' + article.author_name + ' · ' + dateIso(article.published_at), article.body,
              referenceList ? '## Sources\n\n' + referenceList : '', article.transcript ? '## Video transcript\n\n' + article.transcript : '',
              'Canonical URL: ' + urlOf(origin, '/articles/' + article.slug)].filter(Boolean).join('\n\n'));
        }
        if (auth) ctx.user = await auth.user(request, res);
        const canEdit = ctx.user && (await store.membership(ctx.user))?.role === 'editor';
        if (ctx.user) res.setHeader('Cache-Control', 'private, no-store');
        const [related, candidates] = await Promise.all([store.related(article), store.connectionCandidates(article)]);
        return html({
          title: article.title, description: article.summary, path: '/articles/' + article.slug, active: article.section === 'news' ? 'news' : 'blogs',
          image: article.cover_url, schema: articleSchema(origin, article), content: articleView(article, related, canEdit, candidates,
            { feedbackSubmitted: url.searchParams.get('feedback') === 'sent', feedbackEnabled: !store.demo }),
        });
      }
      const info = information(path, contactEmail, url.searchParams.get('feedback') === 'sent', !store.demo);
      if (info) return html({ ...info, active: path === '/api' ? 'api' : '' });
      throw new RequestError(404, 'This page could not be found.');
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error instanceof RequestError ? error.status : 500;
      if (status === 500) console.error('Request failed:', error.code ?? error.name);
      const message = status === 500 ? 'OpenBlog could not load this page. Try again shortly.' : error.message;
      if (url?.pathname?.startsWith('/api/v1/')) return json(res, status, { error: message });
      return send(res, status, 'text/html; charset=utf-8', layout(ctx, {
        title: status === 404 ? 'Page not found' : 'Request could not be completed',
        description: message, path: url?.pathname ?? '/', privatePage: true,
        content: plainPage(status === 404 ? 'Page not found' : 'Something went wrong', message, '<p><a href="/">Return to OpenBlog</a></p>'),
      }));
    }
  });
}

function readFilters(url) {
  const section = url.searchParams.get('section') || '';
  if (section && !Object.hasOwn(sections, section)) throw new RequestError(400, 'Choose News, Teaching, or Find out.');
  return { section, topic: text(url.searchParams.get('topic'), 60, 'a topic'), search: text(url.searchParams.get('q'), 100, 'search text') };
}
function numberParam(url, name, fallback, min, max) {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new RequestError(400, `Use ${name} between ${min} and ${max}.`);
  return value;
}
function publicArticle(origin, article) {
  const url = urlOf(origin, '/articles/' + article.slug);
  const media = Object.fromEntries(['cover_url', 'video_url', 'video_captions'].filter((key) => article[key]).map((key) => [key, urlOf(origin, article[key])]));
  return { ...article, ...media, url, markdown_url: url + '/markdown' };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { DATABASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, CONTACT_EMAIL, NODE_ENV } = process.env;
  const port = Number(process.env.PORT || 3100);
  const host = process.env.HOST || '127.0.0.1';
  const origin = new URL(process.env.PUBLIC_ORIGIN || `http://localhost:${port}`).origin;
  const hasAll = Boolean(DATABASE_URL && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
  if ((!hasAll && (DATABASE_URL || SUPABASE_URL || SUPABASE_PUBLISHABLE_KEY)) ||
      (NODE_ENV === 'production' && (!hasAll || !origin.startsWith('https://') || !CONTACT_EMAIL))) {
    throw new Error('Configure database URL, Supabase URL, publishable key, and a public HTTPS origin and contact before running production.');
  }

  const store = createStore(DATABASE_URL);
  const auth = createAuth(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, origin);
  const app = createApp({ store, auth, origin, contactEmail: CONTACT_EMAIL });
  app.listen(port, host, () => console.log(`OpenBlog available at http://${host}:${port}${store.demo ? ' (demo)' : ''}`));
  const close = () => app.close(() => store.close().finally(() => process.exit()));
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}

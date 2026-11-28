import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createAuth } from '../src/auth.mjs';
import { definitionTopic, topicMatches } from '../src/connections.mjs';
import { agentCoverInput, articleInput } from '../src/content.mjs';
import { createApp } from '../src/server.mjs';
import { createStore } from '../src/store.mjs';
import { markdown, newsIndex } from '../src/views.mjs';

const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'alice@example.test' };
const ed = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', email: 'editor@example.test' };
const extra = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'extra@example.test' };
const actors = [alice, ed, extra];
const sample = {
  section: 'teaching', title: 'How publishing works', topic: 'Supabase', summary: 'An answer with references.',
  body: '## The answer\n\nPublished text belongs here.',
  sources: [{ title: 'Example', url: 'https://example.org/' }],
};
const strictSample = {
  section: 'teaching', title: 'A checked example article', summary: 'A sourced article used to exercise the automatic publishing gate.',
  topic: 'Publishing',
  body: '## Direct answer\n\n' + Array(700).fill('evidence').join(' ') +
    '\n\n## What the sources establish\n\nThe sources are deliberately distinct for this test.\n\n### Limits\n\nThis fixture does not claim real-world facts.',
  cover_url: 'https://blog.naborajs.me/media/covers/commons-' + 'a'.repeat(64) + '-cover.jpg',
  cover_alt: 'A simple illustration for a test article about publishing.',
  sources: [
    { title: 'Primary source one', url: 'https://publisher-one.example.org/report' },
    { title: 'Primary source two', url: 'https://publisher-two.example.net/documentation' },
    { title: 'Independent reference', url: 'https://publisher-three.example.com/analysis' },
  ],
};
const coverCredit = (hash) => ({
  provider: 'Wikimedia Commons', creator: 'Example photographer', license: 'CC BY 4.0',
  source_url: 'https://commons.wikimedia.org/wiki/File:Example_photo.jpg',
  license_url: 'https://creativecommons.org/licenses/by/4.0/', sha256: hash,
  media_type: 'photograph', visual_review: 'A real exterior photograph with no generated overlays.',
  relevance: 'The visible network equipment matches the article topic and is not a generic illustration.',
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
function close(server) {
  server.closeIdleConnections();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
const sessionCookie = (email) => 'ob_access=' + actors.find((user) => user.email === email).id;

test('article validation and HTML rendering reject unsafe input', () => {
  for (const source of ['javascript:alert(1)', '//untrusted.example/article', 'https://user:pass@example.org/']) {
    assert.throws(() => articleInput({ ...sample, sources: [{ url: source }] }), /HTTPS/);
  }
  assert.throws(() => articleInput({ ...sample, cover_url: '/media/image.webp' }), /image description/);
  assert.throws(() => articleInput({ ...sample, video_url: '/media/lesson.mp4' }), /transcript/);
  const digest = 'a'.repeat(64);
  const verifiedCover = agentCoverInput({
    cover_url: `https://blog.naborajs.me/media/covers/commons-${digest}-cover.jpg`,
    cover_alt: 'A technician tests a network switch in a lab.', cover_credit: coverCredit(digest),
  }, 'https://blog.naborajs.me');
  assert.equal(verifiedCover.cover_credit.sha256, digest);
  const verifiedCcBy25Cover = agentCoverInput({
    cover_url: `https://blog.naborajs.me/media/covers/commons-${digest}-cover.jpg`,
    cover_alt: 'A technician tests a network switch in a lab.',
    cover_credit: { ...coverCredit(digest), license: 'CC BY 2.5', license_url: 'https://creativecommons.org/licenses/by/2.5' },
  }, 'https://blog.naborajs.me');
  assert.equal(verifiedCcBy25Cover.cover_credit.license, 'CC BY 2.5');
  assert.throws(() => agentCoverInput({
    cover_url: `https://blog.naborajs.me/media/covers/commons-${digest}-cover.jpg`,
    cover_alt: 'A technician tests a network switch in a lab.',
    cover_credit: { ...coverCredit(digest), license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  }, 'https://blog.naborajs.me'), /CC BY, CC0, or public-domain/);
  const cc0CoverCredit = {
    ...coverCredit(digest),
    license: 'CC0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en',
  };
  const verifiedCc0Cover = agentCoverInput({
    cover_url: `https://blog.naborajs.me/media/covers/commons-${digest}-cover.jpg`,
    cover_alt: 'A technician tests a network switch in a lab.', cover_credit: cc0CoverCredit,
  }, 'https://blog.naborajs.me');
  assert.equal(verifiedCc0Cover.cover_credit.license, 'CC0');
  assert.throws(() => agentCoverInput({
    cover_url: `https://blog.naborajs.me/media/covers/commons-${digest}-cover.jpg`,
    cover_alt: 'A technician tests a network switch in a lab.',
    cover_credit: { ...cc0CoverCredit, license_url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en/other' },
  }, 'https://blog.naborajs.me'), /matching Wikimedia Commons file page and supported license link/);
  assert.throws(() => agentCoverInput({
    cover_url: 'https://other.example/media/covers/commons-' + digest + '-cover.jpg',
    cover_alt: 'A photo.', cover_credit: coverCredit(digest),
  }, 'https://blog.naborajs.me'), /first-party cover path/);
  assert.throws(() => agentCoverInput({
    cover_url: `https://blog.naborajs.me/media/covers/commons-${digest}-cover.jpg`,
    cover_alt: 'A diagram.', cover_credit: { ...coverCredit(digest), media_type: 'diagram' },
  }, 'https://blog.naborajs.me'), /photo-rights record/);
  assert.throws(() => agentCoverInput({
    cover_url: `https://blog.naborajs.me/media/covers/commons-${digest}-cover.jpg`,
    cover_alt: 'A photo.', cover_credit: coverCredit(digest), title: 'Try to edit the article',
  }, 'https://blog.naborajs.me'), /only the verified cover/);
  const linked = articleInput({ ...sample, body: '[Related lesson](/articles/related-lesson#heading-start)' });
  assert.deepEqual(linked.related_slugs, ['related-lesson']);
  const html = markdown('## First answer\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n## First answer');
  assert.deepEqual(html.headings.map(({ id }) => id), ['heading-first-answer', 'heading-first-answer-2']);
  assert.doesNotMatch(html.bodyHtml, /script|javascript|alert/);
  const connected = markdown('## Parent\n\nSupabase and SupabaseX.\n\n### Child\n\nSupabase again. `TLS` and [TLS](https://example.com).\n\n#### Grandchild\n\nEscaped <em>summary</em>.', [
    { slug: 'supabase', title: 'What is Supabase?' },
    { slug: 'tls-one', title: 'TLS' },
    { slug: 'tls-two', title: 'What is TLS?' },
    { slug: 'self', title: 'Grandchild' },
  ], 'self');
  assert.equal(connected.headings[0].children[0].children[0].summary, 'Escaped summary.');
  assert.equal((connected.bodyHtml.match(/href="\/articles\/supabase"/g) ?? []).length, 1);
  assert.doesNotMatch(connected.bodyHtml, /\/articles\/(?:tls-|self)/);
  assert.doesNotMatch(connected.bodyHtml, /<details|<summary/);
  assert.match(connected.bodyHtml, /<section class="reading-section"><h2 id="heading-parent">/);
  assert.equal(definitionTopic('What is TLS?'), 'TLS');
  assert.equal(definitionTopic('What does an API actually do?'), 'API');
  assert.equal(definitionTopic("Why I Don't Use WordPress for My Personal Site"), 'WordPress');
  assert.equal(topicMatches('C++ helps here, but C+++ is a different token.', 'C++'), true);
  assert.equal(topicMatches('SupabaseX is not the same token.', 'Supabase'), false);
});

test('news front page groups topical stories, credits photos, and suppresses exact duplicates', () => {
  const photo = (slug, title, summary, topic = 'News Analysis') => ({
    slug, title, summary, section: 'news', topic, published_at: '2026-11-27T00:00:00.000Z',
    cover_url: 'https://blog.naborajs.me/media/covers/commons-' + 'a'.repeat(64) + '-cover.jpg',
    cover_alt: 'A real photograph of a network security appliance in a laboratory.',
    cover_credit: coverCredit('a'.repeat(64)),
  });
  const lead = photo('security-advisory', 'Security advisory confirms an exploited vulnerability',
    'A security vendor confirms an actively exploited vulnerability in a network appliance.');
  const html = newsIndex([
    lead,
    { ...lead, slug: 'duplicate-security-advisory' },
    photo('business-update', 'A company announces an acquisition', 'The company confirmed an acquisition agreement with a closing date.'),
    photo('world-update', 'Parliament announces a new vote', 'Lawmakers announced a vote for next week.'),
    photo('security-follow-up', 'Researchers publish security findings about Meta Business accounts',
      'A malvertising campaign targeted Meta Business accounts and exposed a separate vulnerability.'),
  ], { page: 1, more: false });

  assert.equal((html.match(/Security advisory confirms an exploited vulnerability/g) ?? []).length, 1);
  assert.match(html, /aria-label="News topics"/);
  assert.match(html, /href="#news-topic-technology-security"/);
  assert.match(html, /id="news-topic-technology-security"/);
  assert.match(html, /news-card-copy.*?<span>Technology &amp; security<\/span>/s);
  assert.match(html, /Business/);
  assert.match(html, /class="image-credit"/);
  assert.match(html, /Photo by/);

  const healthLead = photo('health-update', 'Public health agency reports an outbreak update',
    'Officials describe the latest response to the outbreak.', 'Health');
  const healthHtml = newsIndex([healthLead, lead,
    photo('business-update', 'A company announces an acquisition', 'The company confirmed an acquisition agreement with a closing date.'),
    photo('world-update', 'Parliament announces a new vote', 'Lawmakers announced a vote for next week.'),
    photo('security-follow-up', 'Researchers publish security findings about Meta Business accounts',
      'A malvertising campaign targeted Meta Business accounts and exposed a separate vulnerability.'),
  ], { page: 1, more: false });
  assert.match(healthHtml, /href="#news-topic-health"/);
  assert.match(healthHtml, /id="news-topic-health"/);
  assert.match(healthHtml, /id="news-topic-health-title">Health<\/h2>/);
});

test('demo serves pages, media, and the public API without writing data', async () => {
  const server = createApp({ store: createStore(), auth: null, origin: 'http://localhost:3100' });
  const base = await listen(server);
  try {
    for (const path of ['/', '/blogs', '/news', '/teaching', '/find-out', '/about', '/privacy', '/policy', '/disclaimer', '/contact', '/api', '/account', '/feed.xml', '/sitemap.xml']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
    }
    const blogResponse = await fetch(base + '/blogs');
    assert.equal(blogResponse.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.equal(blogResponse.headers.get('strict-transport-security'), 'max-age=31536000');
    const blogs = await blogResponse.text();
    const explore = await (await fetch(base + '/')).text();
    const news = await (await fetch(base + '/news')).text();
    const agentGuide = await (await fetch(base + '/api')).text();
    assert.match(explore, /News to follow\. Ideas to understand\./);
    assert.match(explore, /class="home-hero"/);
    assert.match(explore, /openblog-earth-hero\.webp/);
    assert.match(explore, /fetchpriority="high"/);
    assert.match(explore, /Latest from the newsroom/);
    assert.match(explore, /From the blog library/);
    assert.match(explore, /Connect your AI agent/);
    assert.doesNotMatch(explore, /24\/7|real[- ]time news/i);
    assert.match(explore, /aria-label="Explore article sections and agent access"/);
    for (const path of ['/news', '/teaching', '/find-out', '/api']) assert.match(explore, new RegExp(`href="${path}"`));
    assert.match(blogs, /class="blog-archive"/);
    assert.match(blogs, /<details class="browse-dropdown">/);
    assert.match(blogs, /href="\/teaching"/);
    assert.match(blogs, /href="\/find-out"/);
    assert.doesNotMatch(blogs, /How to read a technology release/);
    assert.match(news, /class="news-headlines"/);
    assert.doesNotMatch(news, /What happens when you open a website/);
    assert.match(agentGuide, /class="agent-guide"/);
    assert.match(agentGuide, /Discover connected reading/);
    assert.match(agentGuide, /Publishing stays separately controlled/);
    assert.match((await fetch(base + '/mark.svg')).headers.get('content-type'), /image\/svg/);
    const article = await (await fetch(base + '/articles/what-happens-when-you-open-a-website')).text();
    assert.match(article, /VideoObject/);
    assert.match(article, /Related reading/);
    assert.match(article, /class="mobile-toc"/);
    assert.match(article, /class="connection-card"/);
    assert.doesNotMatch(article, /<details class="mobile-toc"/);
    assert.match(article, /Published [^<]+ IST/);
    assert.match(article, /datetime="2026-11-24T10:00:00\.000Z"/);
    assert.match(article, /web-request.vtt/);
    const version = await fetch(base + '/articles/what-happens-when-you-open-a-website/markdown');
    assert.match(version.headers.get('content-type'), /markdown/);
    assert.match(await version.text(), /Canonical URL/);
    const range = await fetch(base + '/media/web-request.mp4', { headers: { Range: 'bytes=0-99' } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
    const list = await (await fetch(base + '/api/v1/articles?section=teaching&limit=1')).json();
    assert.equal(list.articles.length, 1);
    assert.equal(list.has_more, true);
    const connections = await (await fetch(base + '/api/v1/articles/what-happens-when-you-open-a-website/connections')).json();
    assert.equal(connections.article.slug, 'what-happens-when-you-open-a-website');
    assert.ok(Array.isArray(connections.connections));
    assert.match(connections.generated_at, /^\d{4}-\d\d-/);
    assert.ok(connections.connections.length > 0);
    assert(connections.connections.some((connection) => connection.cover_url?.startsWith('http://localhost:')));
    for (const connection of connections.connections) {
      assert.equal((await fetch(base + new URL(connection.url).pathname)).status, 200, connection.url);
      assert.match(connection.url, /^http:\/\/localhost:\d+\/articles\//);
    }
    const query = await (await fetch(base + '/search?q=technology+release')).text();
    assert.match(query, /How to read a technology release/);
    assert.doesNotMatch(query, /What makes a source useful/);
    assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \//);
    assert.equal((await fetch(base + '/articles/unknown')).status, 404);
  } finally { await close(server); }
});

test('Supabase schema isolates drafts and agent keys through the HTTP publishing flow', async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);');
  await db.exec(await readFile(new URL('../supabase/migrations/202611240001_openblog.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611250001_reader_feedback.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611260001_agent_publish_gate.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611260002_require_verified_commons_covers.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611260003_verified_agent_cover_updates.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611260004_accept_cc0_deed_urls.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611270001_accept_cc_by_25.sql', import.meta.url), 'utf8'));
  for (const actor of actors) await db.query('insert into auth.users values ($1)', [actor.id]);
  const pool = {
    query: (...args) => db.query(...args),
    connect: async () => ({ query: async (...args) => {
      const result = await db.query(...args);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    }, release() {} }),
  };
  const provider = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    const token = req.headers.authorization?.slice(7);
    if (req.url === '/auth/v1/user') {
      const user = actors.find(({ id }) => id === token);
      res.statusCode = user ? 200 : 401;
      return res.end(JSON.stringify(user ?? {}));
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const info = JSON.parse(raw || '{}');
    const user = actors.find(({ email, id }) => email === info.email || id === info.refresh_token) || alice;
    if (req.url?.startsWith('/auth/v1/token') || req.url === '/auth/v1/verify') {
      return res.end(JSON.stringify({ user, access_token: user.id, refresh_token: user.id, expires_in: 600 }));
    }
    if (req.url?.startsWith('/auth/v1/signup')) return res.end('{}');
    res.statusCode = 404;
    res.end('{}');
  });
  const providerUrl = await listen(provider);
  const origin = 'http://localhost:3100';
  const app = createApp({ store: createStore(null, pool), auth: createAuth(providerUrl, 'fixture-publishable-key', origin), origin, coverOrigin: 'https://blog.naborajs.me' });
  const base = await listen(app);
  const form = (path, fields, actor, requestOrigin = origin) => fetch(base + path, {
    method: 'POST', redirect: 'manual',
    body: new URLSearchParams(fields),
    headers: { Origin: requestOrigin, ...(actor ? { Cookie: sessionCookie(actor.email) } : {}) },
  });

  try {
    await db.exec('set role openblog_runtime;');
    const login = await form('/account/login', { email: alice.email, password: 'long-password' });
    assert.equal(login.status, 303);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    const register = await form('/account/register', { email: alice.email, password: 'long-password' });
    assert.match(await register.text(), /Check your email/);
    const confirm = await form('/account/confirm', { token_hash: 'fixture-signup-token' });
    assert.equal(confirm.status, 303);
    assert.match(confirm.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await form('/account/join', { name: 'Alice' }, alice, 'https://elsewhere.example')).status, 403);
    for (const [actor, name] of [[alice, 'Alice'], [ed, 'Editor'], [extra, 'Extra']]) {
      assert.equal((await form('/account/join', { name }, actor)).status, 303);
    }
    await db.exec('reset role;');
    await db.query("update blog.memberships set role = 'editor' where user_id = $1", [ed.id]);
    await db.exec('set role openblog_runtime;');
    await assert.rejects(db.query('select secret_hash from blog.api_keys'), /permission denied/);
    const createKey = await form('/account/keys', { name: 'Hermes' }, alice);
    const key = /ob_[a-zA-Z0-9_-]{43}/.exec(await createKey.text())?.[0];
    assert.ok(key);
    const approvedKeyResponse = await form('/account/keys', { name: 'Hermes approved' }, alice);
    const approvedKey = /ob_[a-zA-Z0-9_-]{43}/.exec(await approvedKeyResponse.text())?.[0];
    assert.ok(approvedKey);
    await db.exec('reset role;');
    await db.query("update blog.api_keys set auto_publish = true where name = 'Hermes approved'");
    await db.exec('set role openblog_runtime;');
    await assert.rejects(db.query('select auto_publish from blog.api_keys'), /permission denied/);
    await assert.rejects(db.query("update blog.posts set cover_credit = '{}'::jsonb"), /permission denied/);
    const sendDraft = () => fetch(base + '/api/v1/drafts', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': 'day-one' },
      body: JSON.stringify(sample),
    });
    const first = await sendDraft();
    assert.equal(first.status, 201);
    const { draft } = await first.json();
    const repeat = await sendDraft();
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).draft.id, draft.id);
    assert.equal((await fetch(base + '/articles/' + draft.slug)).status, 404);
    assert.equal((await fetch(base + '/account/drafts/' + draft.id, { headers: { Cookie: sessionCookie(extra.email) } })).status, 404);
    const deniedPublish = await fetch(base + '/api/v1/drafts/' + draft.id + '/publish', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(deniedPublish.status, 403);
    const invalidAutoDraft = await fetch(base + '/api/v1/drafts', {
      method: 'POST', headers: { Authorization: 'Bearer ' + approvedKey, 'Content-Type': 'application/json', 'Idempotency-Key': 'invalid-content' },
      body: JSON.stringify(sample),
    });
    assert.equal(invalidAutoDraft.status, 201);
    const invalidAuto = (await invalidAutoDraft.json()).draft;
    const rejectedContent = await fetch(base + '/api/v1/drafts/' + invalidAuto.id + '/publish', {
      method: 'POST', headers: { Authorization: 'Bearer ' + approvedKey, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(rejectedContent.status, 403);
    const validAutoDraft = await fetch(base + '/api/v1/drafts', {
      method: 'POST', headers: { Authorization: 'Bearer ' + approvedKey, 'Content-Type': 'application/json', 'Idempotency-Key': 'valid-article' },
      body: JSON.stringify(strictSample),
    });
    assert.equal(validAutoDraft.status, 201);
    const validAuto = (await validAutoDraft.json()).draft;
    const autoPublishRequest = () => fetch(base + '/api/v1/drafts/' + validAuto.id + '/publish', {
      method: 'POST', headers: { Authorization: 'Bearer ' + approvedKey, 'Content-Type': 'application/json' }, body: '{}',
    });
    const autoPublished = await autoPublishRequest();
    assert.equal(autoPublished.status, 200);
    const publication = await autoPublished.json();
    assert.equal(publication.status, 'published');
    assert.equal(publication.slug, validAuto.slug);
    assert.equal((await (await fetch(base + '/api/v1/articles/' + validAuto.slug)).json()).title, strictSample.title);
    const newDigest = 'b'.repeat(64);
    const coverUpdate = {
      cover_url: 'https://blog.naborajs.me/media/covers/commons-' + newDigest + '-cover.jpg',
      cover_alt: 'A technician tests a network switch in a lab.', cover_credit: coverCredit(newDigest),
    };
    const coverPath = '/api/v1/articles/' + validAuto.slug + '/cover';
    const sendCoverUpdate = (token, payload = coverUpdate) => fetch(base + coverPath, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.equal((await sendCoverUpdate(key)).status, 403, 'ordinary agent keys cannot replace published covers');
    assert.equal((await sendCoverUpdate(approvedKey, { ...coverUpdate, title: 'Forbidden text edit' })).status, 400);
    const coverSaved = await sendCoverUpdate(approvedKey);
    assert.equal(coverSaved.status, 200);
    const coverResult = await coverSaved.json();
    assert.equal(coverResult.status, 'updated');
    assert.equal(coverResult.updated_slug, validAuto.slug);
    assert.equal(coverResult.updated_cover_credit.sha256, newDigest);
    const coverReadback = await (await fetch(base + '/api/v1/articles/' + validAuto.slug)).json();
    assert.equal(coverReadback.cover_url, coverUpdate.cover_url);
    assert.equal(coverReadback.cover_credit.creator, 'Example photographer');
    assert.equal(coverReadback.title, strictSample.title, 'the cover route does not edit article text');
    assert.equal(coverReadback.body, strictSample.body, 'the cover route preserves the published article body');
    assert.equal(coverReadback.published_at, publication.published_at, 'the original publication time is preserved');
    const attributedArticle = await (await fetch(base + '/articles/' + validAuto.slug)).text();
    assert.match(attributedArticle, /Photo by <a[^>]+>Example photographer<\/a>/);
    assert.match(attributedArticle, /href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/);
    const cc0Digest = 'c'.repeat(64);
    const cc0CoverUpdate = {
      cover_url: 'https://blog.naborajs.me/media/covers/commons-' + cc0Digest + '-cover.jpg',
      cover_alt: 'A technician tests a network switch in a lab.',
      cover_credit: {
        ...coverCredit(cc0Digest),
        license: 'CC0',
        license_url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en',
      },
    };
    const cc0CoverSaved = await sendCoverUpdate(approvedKey, cc0CoverUpdate);
    assert.equal(cc0CoverSaved.status, 200, 'the approved route accepts the canonical Commons CC0 deed URL');
    const cc0Readback = await (await fetch(base + '/api/v1/articles/' + validAuto.slug)).json();
    assert.equal(cc0Readback.cover_credit.license, 'CC0');
    assert.equal(cc0Readback.cover_credit.sha256, cc0Digest);
    assert.equal(cc0Readback.body, strictSample.body, 'CC0 cover metadata cannot edit article text');
    const cc0Article = await (await fetch(base + '/articles/' + validAuto.slug)).text();
    assert.match(cc0Article, /href="https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/deed\.en"/);
    const ccBy25Digest = 'd'.repeat(64);
    const ccBy25CoverUpdate = {
      cover_url: 'https://blog.naborajs.me/media/covers/commons-' + ccBy25Digest + '-cover.jpg',
      cover_alt: 'A technician tests a network switch in a lab.',
      cover_credit: {
        ...coverCredit(ccBy25Digest), license: 'CC BY 2.5',
        license_url: 'https://creativecommons.org/licenses/by/2.5',
      },
    };
    const ccBy25CoverSaved = await sendCoverUpdate(approvedKey, ccBy25CoverUpdate);
    assert.equal(ccBy25CoverSaved.status, 200, 'the approved route accepts CC BY 2.5 with attribution');
    const ccBy25Readback = await (await fetch(base + '/api/v1/articles/' + validAuto.slug)).json();
    assert.equal(ccBy25Readback.cover_credit.license, 'CC BY 2.5');
    assert.equal(ccBy25Readback.cover_credit.sha256, ccBy25Digest);
    const ccBy25Article = await (await fetch(base + '/articles/' + validAuto.slug)).text();
    assert.match(ccBy25Article, /href="https:\/\/creativecommons\.org\/licenses\/by\/2\.5"/);
    const retryPublish = await (await autoPublishRequest()).json();
    assert.equal(retryPublish.published_at, publication.published_at);
    assert.equal((await form('/account/drafts/' + draft.id + '/publish', sample, alice)).status, 403);
    const sourceArticle = { ...sample, body: sample.body + '\n\nSupabase handles data storage.' };
    const published = await form('/account/drafts/' + draft.id + '/publish', sourceArticle, ed);
    assert.equal(published.status, 303);
    assert.equal(published.headers.get('location'), '/articles/' + draft.slug);
    const feedback = await form('/feedback', {
      article_slug: draft.slug, category: 'correction', message: 'Please verify the linked source for this explanation.'
    });
    assert.equal(feedback.status, 303);
    assert.equal(feedback.headers.get('location'), `/articles/${draft.slug}?feedback=sent#reader-feedback`);
    assert.equal((await form('/feedback', {
      article_slug: draft.slug, category: 'correction', message: 'Please verify the linked source for this explanation.'
    }, null, 'https://elsewhere.example')).status, 403);
    assert.equal((await form('/feedback', {
      article_slug: draft.slug, category: 'unknown', message: 'Please verify the linked source for this explanation.'
    })).status, 400);
    await assert.rejects(db.query('select * from blog.reader_feedback'), /permission denied/);
    await assert.rejects(db.query("update blog.reader_feedback set message = 'changed report text with enough characters'"), /permission denied/);
    await assert.rejects(db.query("insert into blog.reader_feedback (article_slug, category, message) values ('not-published', 'correction', 'This article is not published yet.')"), /row-level security/);
    await db.exec('reset role;');
    assert.equal((await db.query('select count(*)::int as reports from blog.reader_feedback')).rows[0].reports, 1);
    await db.exec('set role anon;');
    await assert.rejects(db.query("insert into blog.reader_feedback (category, message) values ('other', 'This anonymous direct insert is blocked.')"), /permission denied/);
    await assert.rejects(db.query('select * from blog.reader_feedback'), /permission denied/);
    await db.exec('set role openblog_runtime;');
    const detail = await (await fetch(base + '/api/v1/articles/' + draft.slug)).json();
    assert.equal(detail.title, sample.title);
    assert.equal(detail.author_name, 'Alice');
    assert.equal(detail.author_id, undefined);
    assert.match(await (await fetch(base + '/blogs')).text(), /How publishing works/);
    assert.doesNotMatch(await (await fetch(base + '/news')).text(), /How publishing works/);
    assert.match(await (await fetch(base + '/robots.txt')).text(), /User-agent: OAI-SearchBot\nAllow: \//);
    assert.match(await (await fetch(base + '/sitemap.xml')).text(), new RegExp(draft.slug));
    const publicPath = '/articles/' + draft.slug;
    const topic = { ...sample, title: 'What is Supabase?', topic: 'Database' };
    const targetDraft = await form('/account/drafts/new', topic, alice);
    const targetPath = targetDraft.headers.get('location');
    assert.match(targetPath, /^\/account\/drafts\//);
    const beforePublishConnections = await (await fetch(base + '/api/v1/articles/' + draft.slug + '/connections')).json();
    assert.equal(beforePublishConnections.connections.some((item) => item.title === 'What is Supabase?'), false);
    assert.doesNotMatch(await (await fetch(base + publicPath)).text(), /class="topic-link"/);
    const targetPublished = await form(targetPath + '/publish', topic, ed);
    const targetArticle = targetPublished.headers.get('location');
    assert.match(targetArticle, /^\/articles\//);
    const afterPublishConnections = await (await fetch(base + '/api/v1/articles/' + draft.slug + '/connections')).json();
    assert.equal(afterPublishConnections.connections.some((item) => item.title === 'What is Supabase?'), true);
    for (const connection of afterPublishConnections.connections) {
      assert.equal((await fetch(base + new URL(connection.url).pathname)).status, 200, connection.url);
    }
    const linkedOlderArticle = await (await fetch(base + publicPath)).text();
    assert.ok(linkedOlderArticle.includes(`href="${targetArticle}" class="topic-link">Supabase</a>`));
    assert.equal((await (await fetch(base + '/api/v1' + publicPath)).json()).body, sourceArticle.body);
    const editPath = '/account' + publicPath;
    const editorHeaders = { Cookie: sessionCookie(ed.email) };
    assert.doesNotMatch(await (await fetch(base + publicPath)).text(), /Edit article/);
    assert.match(await (await fetch(base + publicPath, { headers: editorHeaders })).text(), /Edit article/);
    assert.match(await (await fetch(base + editPath, { headers: editorHeaders })).text(), /Edit published article/);
    assert.equal((await fetch(base + editPath, { headers: { Cookie: sessionCookie(alice.email) } })).status, 404);
    const revised = { ...sample, title: 'Updated published article' };
    assert.equal((await form(editPath, revised, alice)).status, 403);
    const saved = await form(editPath, revised, ed);
    assert.equal(saved.status, 303);
    assert.equal(saved.headers.get('location'), publicPath);
    const updated = await (await fetch(base + '/api/v1' + publicPath)).json();
    assert.equal(updated.title, revised.title);
    assert.equal(updated.published_at, detail.published_at);
    const account = await (await fetch(base + '/account', { headers: { Cookie: sessionCookie(alice.email) } })).text();
    assert.doesNotMatch(account, new RegExp(key));
    const revoke = /<strong>Hermes<\/strong><small>[^<]*<\/small><\/div>\s*<form method="post" action="([^"]+\/revoke)"/.exec(account)?.[1];
    assert.ok(revoke);
    assert.equal((await form(revoke, {}, alice)).status, 303);
    assert.equal((await sendDraft()).status, 401);
  } finally {
    await close(app);
    await close(provider);
    await db.close();
  }
});

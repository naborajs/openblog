import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createAuth } from '../src/auth.mjs';
import { definitionTopic, topicMatches } from '../src/connections.mjs';
import { articleInput } from '../src/content.mjs';
import { createApp } from '../src/server.mjs';
import { createStore } from '../src/store.mjs';
import { markdown } from '../src/views.mjs';

const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'alice@example.test' };
const ed = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', email: 'editor@example.test' };
const extra = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'extra@example.test' };
const actors = [alice, ed, extra];
const sample = {
  section: 'teaching', title: 'How publishing works', summary: 'An answer with references.',
  body: '## The answer\n\nPublished text belongs here.',
  sources: [{ title: 'Example', url: 'https://example.org/' }],
};

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

test('demo serves pages, media, and the public API without writing data', async () => {
  const server = createApp({ store: createStore(), auth: null, origin: 'http://localhost:3100' });
  const base = await listen(server);
  try {
    for (const path of ['/', '/blogs', '/news', '/teaching', '/find-out', '/about', '/privacy', '/policy', '/disclaimer', '/contact', '/api', '/account', '/feed.xml', '/sitemap.xml']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
    }
    const blogs = await (await fetch(base + '/blogs')).text();
    const news = await (await fetch(base + '/news')).text();
    assert.match(blogs, /class="blog-archive"/);
    assert.doesNotMatch(blogs, /How to read a technology release/);
    assert.match(news, /class="news-headlines"/);
    assert.doesNotMatch(news, /What happens when you open a website/);
    assert.match((await fetch(base + '/mark.svg')).headers.get('content-type'), /image\/svg/);
    const article = await (await fetch(base + '/articles/what-happens-when-you-open-a-website')).text();
    assert.match(article, /VideoObject/);
    assert.match(article, /Related reading/);
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
  const app = createApp({ store: createStore(null, pool), auth: createAuth(providerUrl, 'fixture-publishable-key', origin), origin });
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
    const topic = { ...sample, title: 'What is Supabase?' };
    const targetDraft = await form('/account/drafts/new', topic, alice);
    const targetPath = targetDraft.headers.get('location');
    assert.match(targetPath, /^\/account\/drafts\//);
    assert.doesNotMatch(await (await fetch(base + publicPath)).text(), /class="topic-link"/);
    const targetPublished = await form(targetPath + '/publish', topic, ed);
    const targetArticle = targetPublished.headers.get('location');
    assert.match(targetArticle, /^\/articles\//);
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
    const revoke = /action="(\/account\/keys\/[^/]+\/revoke)"/.exec(account)?.[1];
    assert.ok(revoke);
    assert.equal((await form(revoke, {}, alice)).status, 303);
    assert.equal((await sendDraft()).status, 401);
  } finally {
    await close(app);
    await close(provider);
    await db.close();
  }
});

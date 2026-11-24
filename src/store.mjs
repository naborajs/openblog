import { randomBytes, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { demoArticles } from './demo.mjs';

const articleFields = [
  'section', 'title', 'topic', 'summary', 'body', 'cover_url', 'cover_alt',
  'video_url', 'video_captions', 'transcript', 'sources', 'related_slugs',
];
const hashKey = (key) => createHash('sha256').update(key).digest('hex');

export function createStore(databaseUrl, existingPool) {
  const pool = existingPool ?? (databaseUrl && new Pool({ connectionString: databaseUrl, max: 5 }));

  async function withIdentity(user, run) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('openblog.user_id', $1, true)", [user?.id ?? '']);
      const result = await run(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function createDraft(client, actor, article, idempotencyKey = null) {
    const values = articleFields.map((field) => field === 'sources' ? JSON.stringify(article[field]) : article[field]);
    const stem = article.title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 85).replace(/-$/, '') || 'article';
    const slug = stem + '-' + randomBytes(5).toString('hex');
    const result = await client.query(
      `insert into blog.posts (author_id, author_name, slug, agent_key_id, idempotency_key, ${articleFields.join(', ')})
       values (${Array.from({ length: 5 + values.length }, (_, index) => '$' + (index + 1)).join(', ')})
       on conflict (agent_key_id, idempotency_key) do nothing returning id, slug, status`,
      [actor.id, actor.name, slug, actor.keyId ?? null, idempotencyKey, ...values],
    );
    if (result.rows[0]) return { ...result.rows[0], created: true };
    const prior = await client.query('select id, slug, status from blog.posts where agent_key_id = $1 and idempotency_key = $2',
      [actor.keyId, idempotencyKey]);
    return { ...prior.rows[0], created: false };
  }

  return {
    demo: !pool,
    async close() { await pool?.end(); },
    async articles({ section = '', topic = '', search = '', limit = 24, offset = 0 } = {}) {
      if (!pool) {
        const query = search.toLowerCase();
        return demoArticles.filter((article) =>
          (!section || article.section === section) && (!topic || article.topic === topic)
          && (!query || [article.title, article.summary, article.topic].some((value) => value.toLowerCase().includes(query))))
          .slice(offset, offset + limit);
      }
      const result = await pool.query(
        `select slug, title, summary, section, topic, cover_url, cover_alt, author_name, published_at, updated_at
         from blog.posts where status = 'published'
           and ($1 = '' or section = $1) and ($2 = '' or topic = $2)
           and ($3 = '' or strpos(lower(concat_ws(' ', title, summary, topic)), lower($3)) > 0)
         order by published_at desc, slug limit $4 offset $5`, [section, topic, search, limit, offset]);
      return result.rows;
    },
    async article(slug) {
      if (!pool) return demoArticles.find((article) => article.slug === slug);
      const result = await pool.query(
        `select slug, title, summary, section, topic, body, cover_url, cover_alt, video_url, video_captions,
          transcript, sources, related_slugs, author_name, published_at, updated_at
         from blog.posts where status = 'published' and slug = $1`, [slug]);
      return result.rows[0];
    },
    async related(article) {
      if (!pool) return demoArticles.filter((item) => item.slug !== article.slug &&
        (item.topic === article.topic || article.related_slugs?.includes(item.slug) || item.related_slugs?.includes(article.slug))).slice(0, 5);
      const result = await pool.query(
        `select slug, title, section from blog.posts where status = 'published' and slug <> $1
         and (slug = any($2::text[]) or $1 = any(related_slugs) or (topic <> '' and topic = $3))
         order by (slug = any($2::text[])) desc, published_at desc limit 5`, [article.slug, article.related_slugs ?? [], article.topic]);
      return result.rows;
    },
    async topics() {
      if (!pool) return ['The open web', 'Technology', 'Research'];
      return (await pool.query(`select topic from blog.posts where status = 'published' and topic <> ''
        group by topic order by count(*) desc, topic limit 12`)).rows.map(({ topic }) => topic);
    },
    async sitemap() {
      if (!pool) return demoArticles;
      return (await pool.query("select slug, updated_at from blog.posts where status = 'published' order by slug limit 49990")).rows;
    },
    async membership(user) {
      return withIdentity(user, async (client) => (await client.query(
        'select name, role from blog.memberships where user_id = $1', [user.id])).rows[0]);
    },
    async join(user, name) {
      return withIdentity(user, (client) => client.query(
        'insert into blog.memberships (user_id, name) values ($1, $2) on conflict (user_id) do nothing', [user.id, name]));
    },
    async dashboard(user) {
      return withIdentity(user, async (client) => ({
        drafts: (await client.query("select id, title, section, updated_at from blog.posts where status = 'draft' order by updated_at desc limit 100")).rows,
        keys: (await client.query('select id, name, public_id, created_at, revoked_at from blog.api_keys where user_id = $1 order by created_at desc',
          [user.id])).rows,
      }));
    },
    async draft(user, id) {
      return withIdentity(user, async (client) => (await client.query(
        "select * from blog.posts where id = $1 and status = 'draft'", [id])).rows[0]);
    },
    async saveDraft(user, member, article, id, publish = false) {
      return withIdentity(user, async (client) => {
        if (!id) return createDraft(client, { id: user.id, name: member.name }, article);
        const fields = articleFields.map((field, index) => field + ' = $' + (index + 2));
        const values = articleFields.map((field) => field === 'sources' ? JSON.stringify(article[field]) : article[field]);
        if (publish) fields.push("status = 'published'", 'published_at = now()');
        const result = await client.query(`update blog.posts set ${fields.join(', ')}, updated_at = now()
          where id = $1 and status = 'draft' returning id, slug`, [id, ...values]);
        return result.rows[0];
      });
    },
    async createKey(user, name) {
      const secret = 'ob_' + randomBytes(32).toString('base64url');
      await withIdentity(user, (client) => client.query(
        'insert into blog.api_keys (user_id, name, secret_hash, public_id) values ($1, $2, $3, $4)',
        [user.id, name, hashKey(secret), secret.slice(0, 12)]));
      return secret;
    },
    async revokeKey(user, id) {
      return withIdentity(user, async (client) => (await client.query(
        'update blog.api_keys set revoked_at = now() where id = $1 returning id', [id])).rowCount > 0);
    },
    async submitFromAgent(secret, article, idempotencyKey) {
      return withIdentity(null, async (client) => {
        const identity = (await client.query('select * from blog.owner_for_agent_key($1)', [hashKey(secret)])).rows[0];
        if (!identity) return null;
        await client.query("select set_config('openblog.user_id', $1, true)", [identity.user_id]);
        return createDraft(client, { id: identity.user_id, name: identity.author_name, keyId: identity.key_id }, article, idempotencyKey);
      });
    },
  };
}

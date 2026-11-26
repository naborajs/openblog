import { randomBytes, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { demoArticles } from './demo.mjs';
import { definitionTopic, topicMatches } from './connections.mjs';

const articleFields = [
  'section', 'title', 'topic', 'summary', 'body', 'cover_url', 'cover_alt',
  'video_url', 'video_captions', 'transcript', 'sources', 'related_slugs',
];
const hashKey = (key) => createHash('sha256').update(key).digest('hex');
const connectionStopwords = new Set([
  'about', 'after', 'also', 'and', 'are', 'because', 'been', 'being', 'can', 'does', 'each', 'for',
  'from', 'have', 'how', 'into', 'its', 'may', 'more', 'most', 'not', 'of', 'or', 'our', 'should',
  'some', 'than', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'those', 'through',
  'under', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'would', 'you', 'your',
  'article', 'guide', 'news', 'tutorial', 'update',
]);
const connectionSearchText = (article) => [...new Set(
  [article.topic, article.title, article.summary].join(' ').match(/[a-z0-9+#.-]+/gi) ?? [],
)].map((term) => term.toLowerCase())
  .filter((term) => term.length >= 3 && !/^\d+$/.test(term) && !connectionStopwords.has(term))
  .slice(0, 32)
  .join(' OR ');

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
    async articles({ section = '', topic = '', search = '', limit = 24, offset = 0, blogOnly = false } = {}) {
      if (!pool) {
        const query = search.toLowerCase();
        return demoArticles.filter((article) =>
          (!section || article.section === section) && (!topic || article.topic === topic) && (!blogOnly || article.section !== 'news')
          && (!query || [article.title, article.summary, article.topic].some((value) => value.toLowerCase().includes(query))))
          .slice(offset, offset + limit);
      }
      const result = await pool.query(
        `select slug, title, summary, section, topic, cover_url, cover_alt, cover_credit, author_name, published_at, updated_at
         from blog.posts where status = 'published'
           and ($1 = '' or section = $1) and ($2 = '' or topic = $2)
           and ($3 = '' or strpos(lower(concat_ws(' ', title, summary, topic)), lower($3)) > 0)
           and (not $6::boolean or section <> 'news')
         order by published_at desc, slug limit $4 offset $5`, [section, topic, search, limit, offset, blogOnly]);
      return result.rows;
    },
    async article(slug) {
      if (!pool) return demoArticles.find((article) => article.slug === slug);
      const result = await pool.query(
        `select slug, title, summary, section, topic, body, cover_url, cover_alt, cover_credit, video_url, video_captions,
          transcript, sources, related_slugs, author_name, published_at, updated_at
         from blog.posts where status = 'published' and slug = $1`, [slug]);
      return result.rows[0];
    },
    async related(article) {
      if (!pool) return demoArticles.filter((item) => item.slug !== article.slug &&
        (item.topic === article.topic || article.related_slugs?.includes(item.slug) || item.related_slugs?.includes(article.slug))).slice(0, 5);
      const result = await pool.query(
        `with matches as (
           select slug, title, section, topic, summary,
             slug = any($2::text[]) as links_from_here,
             $1 = any(related_slugs) as links_here,
             topic <> '' and topic = $3 as same_topic,
             ts_rank_cd(
               to_tsvector('english', concat_ws(' ', title, topic, summary)),
               websearch_to_tsquery('english', $4::text)
             ) as relevance
           from blog.posts
           where status = 'published' and slug <> $1
         )
         select slug, title, section, topic, summary,
           case when links_from_here then 'Linked from this article'
                when links_here then 'Links to this article'
                when same_topic then 'Same topic'
                else 'Shared article terms' end as connection_reason
         from matches
         where links_from_here or links_here or same_topic or relevance > 0
         order by links_from_here desc, links_here desc, same_topic desc, relevance desc, title, slug
         limit 6`, [article.slug, article.related_slugs ?? [], article.topic, connectionSearchText(article)]);
      return result.rows;
    },
    async connectionCandidates(article) {
      const source = !pool ? demoArticles : (await pool.query(
        `select slug, title from blog.posts where status = 'published' and slug <> $1 order by slug limit 5000`,
        [article.slug])).rows;
      const seen = new Map();
      for (const candidate of source) {
        if (candidate.slug === article.slug) continue;
        const term = definitionTopic(candidate.title).toLowerCase();
        if (!term) continue;
        seen.set(term, seen.has(term) ? null : candidate.slug);
      }
      const body = article.body ?? '';
      return [...seen].filter(([term, slug]) => slug && topicMatches(body, term))
        .map(([term, slug]) => ({ slug, title: source.find((item) => item.slug === slug)?.title }))
        .filter((candidate) => candidate.title)
        .sort((a, b) => definitionTopic(b.title).length - definitionTopic(a.title).length)
        .slice(0, 200);
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
    async publishedForEditor(user, slug) {
      return withIdentity(user, async (client) => (await client.query(
        "select * from blog.posts where slug = $1 and status = 'published' and blog.is_editor()", [slug])).rows[0]);
    },
    async updatePublished(user, slug, article) {
      const fields = articleFields.map((field, index) => field + ' = $' + (index + 2));
      const values = articleFields.map((field) => field === 'sources' ? JSON.stringify(article[field]) : article[field]);
      return withIdentity(user, async (client) => (await client.query(
        `update blog.posts set ${fields.join(', ')}, updated_at = now()
          where slug = $1 and status = 'published' and blog.is_editor() returning slug`,
        [slug, ...values])).rows[0]);
    },
    async submitFeedback(articleSlug, category, message) {
      if (!pool) return false;
      const result = await pool.query(
        'insert into blog.reader_feedback (article_slug, category, message) values ($1, $2, $3)',
        [articleSlug, category, message]);
      return result.rowCount === 1;
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
    async publishFromAgent(secret, draftId) {
      if (!pool) return null;
      return withIdentity(null, async (client) => (await client.query(
        'select * from blog.publish_agent_draft($1, $2)', [hashKey(secret), draftId])).rows[0] ?? null);
    },
    async updateAgentCover(secret, slug, cover) {
      if (!pool) return null;
      return withIdentity(null, async (client) => (await client.query(
        'select * from blog.update_agent_cover($1, $2, $3, $4, $5::jsonb)',
        [hashKey(secret), slug, cover.cover_url, cover.cover_alt, JSON.stringify(cover.cover_credit)])).rows[0] ?? null);
    },
  };
}

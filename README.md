# OpenBlog

OpenBlog is an open-source publishing app for people and AI agents. **Explore** brings together **Blogs** and **News** in a connected library of articles, images, and videos. **Connective AI agent** explains how to read published work and submit drafts through the API.

Readers can browse without an account. Contributors can write Markdown drafts and issue agent keys. New keys are draft-only; an administrator can separately approve a trusted automation key for publication. Article pages have a reading progress bar, nested headings, a section outline with hover summaries, automatic topic links, connected reading, source links, and a Markdown version. Readers can report corrections and other issues; reports stay private to the editorial database.

## Run the demo

Requires Node.js 22 or later.

~~~sh
npm ci
npm run dev
npm test
~~~

Open http://localhost:3100. The demo shows illustrative articles and uses no account or database credentials. It is marked for crawlers to skip.

To test the rendered demo, install Chromium with `npx playwright install chromium` or set `CHROME_BIN` to an installed Chrome executable. Run `npm run test:browser` while the demo is serving. Set `SCREENSHOT_DIR` to save screenshots.

## Host on a VPS

1. Apply the checked-in SQL in `supabase/migrations/` to your self-hosted Supabase database as a migration administrator. If multiple apps share the database, add each migration to the team's ordered production migration history. The reader report table is write-only to the limited OpenBlog runtime login; public users cannot read or manage reports.
2. Give `openblog_runtime` a strong password through an administrative Postgres client. Run OpenBlog with this limited login and use a connection route that accepts custom Postgres roles. Keep the `blog` schema private to the backend.
3. Copy `.env.example` to `.env`. Set the database connection, the internal Supabase API URL, the Supabase **publishable** or legacy **anon** key, the public HTTPS origin, and an operator contact. Configure the account confirmation URL and SMTP with your Supabase Auth deployment. Existing applications may share the Auth directory, while OpenBlog requires its own membership to contribute.
4. Install with `npm ci --omit=dev` and run `NODE_ENV=production npm start` behind an HTTPS reverse proxy. Bind the app to loopback and let the proxy serve traffic for your domain.
5. A contributor first creates an account and joins OpenBlog. The database administrator promotes an initial editor explicitly:

~~~sql
update blog.memberships
set role = 'editor'
where user_id = 'REPLACE_WITH_CONFIRMED_SUPABASE_USER_UUID';
~~~

Fresh installations start with an empty publication. Preserve and back up an existing editorial archive before applying changes. Store editorial articles in the `blog` schema and keep a backup of the database and its media. Demo assets in `work/` are private deployment assets and are intentionally excluded from Git; serve them from a restricted HTTPS media route or a correctly scoped Supabase Storage bucket. If captions are hosted on another origin, configure that host and the video host to allow cross-origin requests from your site.

### Accounts and agents

The first version uses Supabase email sign-in. NSGO is the planned identity integration. Account validation lives in `src/auth.mjs` so a future integration can map verified NSGO identities to Supabase users and preserve their OpenBlog memberships and drafts.

From the account workspace, create and copy a key for Hermes. Its daily job can call `POST /api/v1/drafts` with linked evidence and a stable `Idempotency-Key`. Public endpoints include:

- `GET /api/v1/articles` and `GET /api/v1/articles/{slug}`
- `GET /articles/{slug}/markdown`
- `/feed.xml`, `/sitemap.xml`, and `/robots.txt`

The robots policy permits access to public articles for search and AI discovery while excluding account pages and draft submission. Agents should use public GET endpoints and honor the site's rate limits. `GET /api/v1/articles/{slug}/connections` returns published work connected by explicit links, shared topics, or relevant terms. The list is generated from the current publication, so a new article can connect to older work without editing it.

Draft submission does not publish. There is no arbitrary media-upload endpoint; the trusted local helper fetches the exact photographed asset from Wikimedia Commons, checks the file-page creator and license, verifies the asset SHA-256, and self-hosts it in the restricted media directory. Generated, drawn, and code-rendered cover art is rejected. The helper adds a visible linked photo credit, then checks alt text, image dimensions, article length, headings, source links, and common placeholders before it submits the draft and calls `POST /api/v1/drafts/{id}/publish`. For an existing published article, an individually approved editorial key can call `POST /api/v1/articles/{slug}/cover`; the database function changes only the cover URL, alt text, structured photo credit, and update timestamp. It cannot change article text, sources, authorship, or publication time. The same helper verifies the source file, license, photo-review note, downloaded bytes, public image response, and visible attribution. New keys cannot publish or update published covers, and the runtime database role cannot read or change the `auto_publish` flag. The database gate cannot establish factual accuracy or prove image rights; the helper and research process perform those checks, and editors remain responsible for corrections.

### Automated discovery sources

The news workflow uses the free, keyless GDELT DOC 2.0 API for discovery and falls back to publisher or public-agency RSS feeds when it is unavailable or rate-limited. GDELT results are leads, not fact-checking evidence. An optional [Currents API](https://currentsapi.services/en/docs/) integration can provide up to 250 headline requests per day; its free plan requires an API key and attributes commercial use with links to original articles. To enable it, create a key in your own Currents account and save it on the VPS at `~/.hermes/profiles/research/secrets/currents_api_key` with mode `0600`. The helper sends the key in an HTTPS authorization header, never prints it, and uses Currents only as a private discovery lead. The agent must verify the original publisher and primary sources and must not reuse API previews or images. If no key file exists, the optional provider stays disabled and GDELT/RSS continue. NewsAPI.org's free Developer plan is restricted to development and testing, so it is not used in production. Photo discovery uses the Wikimedia Commons API without a stored credential; each file's reuse terms are checked individually before it is self-hosted.

The running site's `/api` page documents public reading, connected articles, draft submission, and the restricted publish endpoint. Only a database administrator can approve a specific existing key for automatic publication; there is no API to grant that permission. Search crawlers can access published content, including OpenAI's search crawler. Structured data, canonicals, titles, summaries, and source links help discovery. Indexing and citations depend on each search product.

### Advertising

Publish original articles on the live domain before applying for [AdSense review](https://support.google.com/adsense/answer/7299563). When adding ads, update the privacy notice with the providers and cookie uses, and configure a [Google-certified consent platform](https://support.google.com/adsense/answer/13554116) for traffic in the EEA, the UK, and Switzerland. OpenBlog currently serves no ads.

## License

Website software is released under the [MIT License](LICENSE). Production article text, photography, and video retain their own rights. Demo copy and demo media ship solely as examples and are excluded from the software license. The website's editorial policy explains public crawling and citation.

The demo hero and four editorial images were generated for OpenBlog and converted to grayscale to match the black-and-white interface. The sample teaching video and captions were also created for this demo. Production articles and their separately licensed media do not ship in this repository.

## Repository workflow

On the OpenBlog repository, stage and commit each changed file separately using the maintainer's Git identity, then push each commit individually.

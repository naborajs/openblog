# OpenBlog

OpenBlog is an open-source publishing app for people and AI agents. **Explore** brings together **Blogs** and **News** in a connected library of articles, images, and videos. **Connective AI agent** explains how to read published work and submit drafts through the API.

Readers can browse without an account. Contributors can write Markdown drafts and issue draft-only keys for their agents. Editors review and publish drafts. Article pages have a reading progress bar, nested headings, a section outline with hover summaries, automatic topic links, connected reading, source links, and a Markdown version. Readers can report corrections and other issues; reports stay private to the editorial database.

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

Fresh installations start with an empty publication. Preserve and back up an existing editorial archive before applying changes. Store editorial articles in the `blog` schema and keep a backup of the database and its media. Generated covers in `work/` are private deployment assets and are intentionally excluded from Git; serve them from a restricted HTTPS media route or a correctly scoped Supabase Storage bucket. If captions are hosted on another origin, configure that host and the video host to allow cross-origin requests from your site.

### Accounts and agents

The first version uses Supabase email sign-in. NSGO is the planned identity integration. Account validation lives in `src/auth.mjs` so a future integration can map verified NSGO identities to Supabase users and preserve their OpenBlog memberships and drafts.

From the account workspace, create and copy a key for Hermes. Its daily job can call `POST /api/v1/drafts` with linked evidence and a stable `Idempotency-Key`. Public endpoints include:

- `GET /api/v1/articles` and `GET /api/v1/articles/{slug}`
- `GET /articles/{slug}/markdown`
- `/feed.xml`, `/sitemap.xml`, and `/robots.txt`

The robots policy permits access to public articles for search and AI discovery while excluding account pages and draft submission. Agents should use public GET endpoints and honor the site's rate limits. Draft submission never publishes content. There is no public media-upload endpoint; a trusted local editorial helper can copy a validated cover into the restricted static media directory and attach its HTTPS URL to a draft.

The running site's `/api` page includes a request example. Search crawlers can access published content, including OpenAI's search crawler. Structured data, canonicals, titles, summaries, and source links help discovery. Indexing and citations depend on each search product.

### Advertising

Publish original articles on the live domain before applying for [AdSense review](https://support.google.com/adsense/answer/7299563). When adding ads, update the privacy notice with the providers and cookie uses, and configure a [Google-certified consent platform](https://support.google.com/adsense/answer/13554116) for traffic in the EEA, the UK, and Switzerland. OpenBlog currently serves no ads.

## License

Website software is released under the [MIT License](LICENSE). Production article text, photography, and video retain their own rights. Demo copy and demo media ship solely as examples and are excluded from the software license. The website's editorial policy explains public crawling and citation.

The demo hero and four editorial images were generated for OpenBlog and converted to grayscale to match the black-and-white interface. The sample teaching video and captions were also created for this demo. Production articles and their separately licensed media do not ship in this repository.

## Repository workflow

On the OpenBlog repository, stage and commit each changed file separately using the maintainer's Git identity, then push each commit individually.

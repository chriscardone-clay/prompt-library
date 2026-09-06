# Clay prompt library

Good prompts, shared once. Used everywhere.

An internal library where anyone at Clay can find a prompt, fill in the blanks, copy it into Town, Claude, ChatGPT or Claygent, fork it when they make it better, and leave feedback that the owner can resolve.

Built from the Claude Design handoff (`Clay Prompt Management Platform → Prompt Library`) on the Terra brand design system.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router, React 19, TypeScript), CSS Modules, Phosphor icons, Roobert fonts |
| Backend | Supabase: Postgres + Row Level Security, Google OAuth (clay.com only), version-snapshot triggers |
| Hosting | Vercel (frontend + server actions), Supabase cloud (database + auth) |

There is no separate API server. Server Components read through the Supabase client with the user's session, Server Actions write through it, and Postgres RLS is the authorisation layer.

## Features

- **Discover / My library** with a toolbar: search, an All / Prompts / Skills toggle, sort (top / newest / recently updated), and a Filters panel with multi-select apps (Town, Claude, ChatGPT, Claygent, Monty, Granola out of the box), per-app surfaces, and multi-select teams. Active filters show as removable chips. Everything lives in the URL (`kind`, `apps`, `surfaces`, `teams`, `q`, `sort`, `filters`) so views are shareable.
- **Delete** from the detail page (owner only) with an inline "Delete for everyone?" confirm. Forks of a deleted item move up to its parent and get the note "Original was deleted"; its stored binary files are removed.
- **How to use** notes on any prompt: when to use it, tips, connectors it needs. Shown under the prompt, never copied with it. Lines starting with `- ` render as bullets; a short line ending in `:` renders as a label.
- **Skills** live alongside prompts. Discover has a Prompts / Skills toggle (`/?kind=skills`, or `/skills`); My library shows both. A skill is a bundle of text files (SKILL.md plus references) and/or links to where it lives in its home app. The detail page shows file tabs with copy, download, and "Download `<name>.skill`" (a zip of the folder), "Open it where it lives" link cards, and per-app install instructions. The editor supports adding files by hand or uploading a `.skill`/`.zip` (unpacked in the browser; title and description fill in from SKILL.md frontmatter). Text files stay inline and editable; binary files (fonts, images, PDFs…) are uploaded from the browser into the private `skill-files` Storage bucket under `<prompt id>/<path>` and referenced from the file list, so the `.skill` download is lossless. Storage access follows the prompt's visibility. Limits: 5 MB per skill, 1.5 MB of inline text, 60 files. Skills fork, upvote, take feedback and keep version history like prompts; versions snapshot files and links too.
- **Search** in the app uses the same ranking as the Slack assistant's fallback, ported to run instantly in the browser on the items already loaded (`src/lib/search.ts`): each content word scores by the best field it appears in (title 1.0, description 0.5, "how to use" notes plus app and team names 0.3, the prompt text 0.1; for skills the text is SKILL.md, or the first file, not every bundled file), averaged, with an all-words bonus, synonym coverage, fuzzy title similarity, and boosts for a stated kind or app. Literal substrings of the title or description always match, so results narrow as you type. Weak or trailing hits are dropped, and results are ordered by relevance while a search is active (the sort control applies otherwise).
- **Favorites.** The heart on any card or detail page saves an item to your own Favorites list (`/favorites`, in the nav). Favorites are private: the table's RLS only ever returns your own rows. The old "My library" is now **Created**.
- **Cards** show the Skill badge plus at most two app badges (app names only; hover for surfaces), then a "+N" badge listing the rest. Forks show a fork icon, private items a lock.
- **Join Slack banner.** Signed-in people who aren't in `#auto-clayprompts` see a banner under the header inviting them to join (channel `C0BV3T33NSH`). Membership is checked through Slack (`conversations.members`, scope `channels:read`), cached on the profile for a day; dismissing hides the banner for the browser session. Not shown when Slack can't confirm membership, in the Notion embed, or on editor pages. `SLACK_NUDGE_FORCE=1` shows it in development without a token.
- **Feedback notifications.** When someone leaves feedback, the owner gets a Slack DM with the quote and a link; when the owner replies, the person who left the feedback gets a DM. Nobody is DM'd about their own actions. Uses the same Slack app (`im:write`, `chat:write`).
- **Fill in the blanks**: `{{placeholders}}` in a prompt body become inputs; the preview updates live and one click copies the filled prompt. Fills persist per prompt in the browser.
- **Fork**: any prompt can be forked. Forks stay linked; the detail page shows the whole variant tree and the fork note ("what did you change?").
- **Upvotes** and **feedback** with reply + resolve for owners and editors.
- **Editors** invited by @clay.com email, even before they have signed in. Editors can edit and resolve feedback; only the owner can remove editors or delete.
- **Public / private** visibility. Private prompts are visible only to the owner and editors, enforced in the database.
- **Version history**: every content change snapshots the previous version automatically (Postgres trigger). Owners and editors can restore any version.
- **Google sign-in restricted to clay.com**, enforced three times: the OAuth `hd` hint, the auth callback, and a database trigger that refuses non-clay accounts. The PKCE code-verifier cookie is a plain first-party `SameSite=Lax` cookie for the normal flow (the Notion embed flow uses `None` + `Partitioned`). If a browser still comes back from Google without it, the callback restarts the flow once automatically before showing an error; failures are logged as `[auth] code exchange failed` with the cookie names and user agent.
- **Dark mode.** The avatar menu has an Appearance picker: Light, Dark, or System (follows the OS). The choice is saved in the browser (`localStorage.theme`) and applied before first paint by an inline script that sets `<html data-theme>`, so there's no flash. All colours are tokens in `globals.css`; the dark block flips the oat scale and swaps each accent pair for a deep tint + light ink, and every text/background pair is at least 4.5:1 (WCAG AA). App tag colours come from the catalog as a light tint + dark ink; in dark mode the pair is derived from the ink with `color-mix` (see the `.tone` rules), so admins only ever pick light-mode colours. The wordmark switches to a white variant (`public/brand/Clay_Logo_3D_Wht.png`).
- **Weekly Slack digest.** Every Monday at 9:00 ET (Vercel Cron → `GET /api/digest`, authenticated with `CRON_SECRET`) the app posts one Block Kit message to the configured Slack channel: the two most-engaged public items of the previous Monday–Sunday week (score = 3 × upvotes + 2 × forks + feedback, +1 if new), everything new that week, and up to five "Worth knowing" bullets (catalog additions, items updated twice or more, feedback resolved / still open, an optional editors' note). Only public items are counted or named. The SQL rollup is `weekly_digest(from, to)`; the cron reads with `SUPABASE_SERVICE_ROLE_KEY` (used nowhere else). `digest_runs` makes it idempotent per week and keeps history; `digest_settings` holds the on/off switch, channel ID and editors' note. Admins operate it from `/admin`: preview (last full week or last 7 days), **Send test to me** (DMs the admin, needs the `im:write` scope), **Post to channel now**, and run history with Slack links. `GET /api/digest?dry=1` returns the payload without posting.
- **Slack assistant.** People can @mention the bot in a channel or DM it ("is there a prompt for recapping a customer call?"). The Events API endpoint `POST /api/slack/events` verifies Slack's signature (`SLACK_SIGNING_SECRET`), acknowledges within Slack's 3-second limit, dedupes retries via `slack_events`, then in the background loads the public library (whole when ≤ 150 items, otherwise a full-text shortlist plus the newest items), asks Claude through Vercel's AI Gateway (`anthropic/claude-sonnet-5` by default, `SLACK_AGENT_MODEL` to override; auth via the project's OIDC identity or `AI_GATEWAY_API_KEY`) to pick up to three genuinely relevant items, and replies in the thread with a short message, item cards with Open buttons, and links to search or add a prompt/skill. If the model is unavailable it falls back to a ranked lexical search and says so. That search (`search_library()` in Postgres, `src/lib/agent/lexical.ts` for query parsing) scores each content word by the best field it appears in (title 1.0, description 0.5, notes/apps/teams 0.3, body 0.1), averages over the words, adds a bonus when every word appears outside the body, a synonym layer (recap ↔ summary, call ↔ meeting, formula ↔ javascript, …), fuzzy title similarity via `pg_trgm` against both the cleaned words and the question as typed, and small boosts for the kind ("skill" vs "prompt") and app names the person mentioned. Results below a confidence floor, or far behind the best hit, are dropped, and each card says which words matched. When nothing clears the bar it suggests a title for what's missing. **Threads:** when the mention is a reply inside a thread, the bot reads the thread (needs `channels:history` / `groups:history`); a short mention like "what do you have?" is answered from the thread's first message when the thread is small, and the model gets the whole thread as context. If the thread is long or mixed and the mention doesn't say what's wanted, it asks the person to restate the request in one line. Every question is logged to `agent_requests`. Admins can test it without Slack from the "Slack assistant" panel on `/admin`, including a simulated thread. Slack app setup: bot scopes `app_mentions:read`, `im:history`, `channels:history`, `groups:history`, `chat:write`; Event Subscriptions → Request URL `https://www.clayprompts.com/api/slack/events`, bot events `app_mention` and `message.im`; App Home → enable the Messages tab.
- **Slack photos as avatars.** With `SLACK_BOT_TOKEN` set (a Slack app bot token with `users:read` + `users:read.email`), the app looks each person up in Slack by email when they sign in and again weekly, and stores their Slack photo on their profile. People without a custom Slack photo (and everyone, when the token is missing) get initials on a brand tint. Setup: create an app at https://api.slack.com/apps → *OAuth & Permissions* → add the two bot scopes → *Install to Workspace* → copy the `xoxb-…` token → `npx vercel env add SLACK_BOT_TOKEN production` and redeploy.
- **Admin** (`/admin`, linked from the footer only for admins; everyone else gets the not-found page). Apps, their surfaces, and teams are rows in the database, not code, so they can be added, renamed, recoloured, reordered, archived, and deleted without a deploy. Renames cascade into every item that uses the old name (Postgres triggers). Anything still in use can be archived (hidden from pickers and filters, still shown on existing items) but not deleted. Admins are managed on the same page; the seed admin is chris.cardone@clay.com and you can't remove yourself. The footer credit "Made by @cc" links to Chris's Slack.

## Project layout

```
supabase/
  migrations/0001_init.sql   schema, triggers, RLS policies, restore RPC
  seed.sql                   local-only demo users + sample prompts
  config.toml                local Supabase CLI config
src/
  proxy.ts                   session refresh + auth gate on every request
  app/
    page.tsx                 Discover
    mine/page.tsx            My prompts
    prompts/[id]/page.tsx    Prompt detail (fill, copy, variants, history, feedback)
    prompts/new              Create
    prompts/[id]/edit        Edit
    prompts/[id]/fork        Fork
    login/page.tsx           Google sign-in
    auth/callback/route.ts   OAuth return leg
    actions.ts               all Server Actions (writes)
    admin/                   catalog + admins management (admins only)
  lib/
    data.ts                  all reads (server only)
    catalog.ts               apps / surfaces / teams types + helpers (data comes from the DB)
    supabase/                server / browser / proxy clients
    constants.ts             visibilities, kinds, size caps, footer credit
    placeholders.ts          {{placeholder}} parsing + filling
  components/                UI
public/
  fonts/ avatars/ icons/ brand/   Terra assets from the design system
```

## Local development

Prerequisites: Node 20+, Docker (for local Supabase), a Google OAuth client.

```bash
npm install
cp .env.example .env.local
```

Start the local Supabase stack (Postgres, Auth, Studio):

```bash
npx supabase start
```

Put the values it prints into `.env.local` (`API URL` → `NEXT_PUBLIC_SUPABASE_URL`, `anon key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Apply the schema and seed data:

```bash
npx supabase db reset
```

The seed creates four demo Clay accounts (`chris@`, `priya@`, `marcus@`, `dana@clay.com`, password `password`) and the sample prompts from the design. To sign in locally without Google, create `supabase/.env` with your Google client id/secret (see `supabase/config.toml`), or temporarily use the email accounts through Supabase Studio at http://localhost:54323.

Run the app:

```bash
npm run dev
```

## Where it runs

| | |
| --- | --- |
| App | https://www.clayprompts.com (Vercel team `clay-run`, project `prompt-library`, auto-deploys from `main`; the apex and the old prompts.artificialchill.com redirect here) |
| Database | Supabase project `prompt-library` (ref `rtaubwokdmmpokhjbyyp`) in the Clay org, us-east-1 |
| Repo | https://github.com/chriscardone-clay/prompt-library |

Schema is applied with `npx supabase db push` from this repo (already linked). Env vars live in Vercel. The only piece not automated is the Google provider, which needs the Google Cloud console:

1. Google Cloud Console → APIs & Services → Credentials → Create credentials → **OAuth client ID** → Web application.
   - Authorised JavaScript origins: `https://prompt-library-clay-run-df4af71e.vercel.app`
   - Authorised redirect URI: `https://rtaubwokdmmpokhjbyyp.supabase.co/auth/v1/callback`
   - On the OAuth consent screen choose **Internal** (Clay Workspace only).
2. Supabase Dashboard → project `prompt-library` → **Authentication → Sign In / Providers → Google**: turn it on, paste the client ID and client secret, save.
3. Authentication → **URL Configuration** already has the site URL and the `/auth/callback` redirect URLs (set by the Management API). Add any custom domain there later.

Then open the app and click "Continue with Google". Non-clay.com accounts are rejected by the database trigger even if Google lets them through.

## Embedding in Notion

Any page can be embedded: in Notion type `/embed`, paste the URL, and pick a tall block. Best results:

- Whole library: `https://www.clayprompts.com/`
- One prompt: `https://www.clayprompts.com/prompts/<id>` (copy the address from the prompt page)

How it works, and what to expect:

- The app sends `Content-Security-Policy: frame-ancestors` allowing Notion (`*.notion.so`, `*.notion.site`, `*.notion.com`) and itself. To allow another host, set `EMBED_FRAME_ANCESTORS` in Vercel to a space-separated list (or `*`) and redeploy.
- Inside an iframe the header goes compact and gains an "open in a new tab" control.
- The embed keeps its own session. Google will not run OAuth inside an iframe, so "Continue with Google" in the embed opens a small popup; when Google finishes, the popup lands on `/auth/embed-done`, hands the one-time code back to the embed, and the embed exchanges it via `/auth/embed-callback`. Nothing depends on cookies leaking from the top-level site.
- Session cookies are `SameSite=None; Secure; Partitioned` (CHIPS), so they live per top-level site. At the top level that is just the app itself; inside Notion they sit in the (notion.so, app) partition, which Chrome, Edge, Brave, Arc and Firefox allow even when third-party cookies are blocked. Safari blocks cookies in cross-site frames entirely and does not support CHIPS, so the embed will keep showing the sign-in screen there; Safari users should open the library in a tab.
- If a browser blocks the popup, the embed shows an "Open Google sign-in" link instead; it must open in a new tab for the hand-off to work.

## Production setup from scratch

### 1. Supabase project

1. Create a project at https://supabase.com/dashboard (region close to Vercel `iad1`).
2. Link and push the schema:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   Do **not** run `seed.sql` in production. It creates demo auth users.

3. **Authentication → Providers → Google**: enable it and paste the Google client id and secret (below).
4. **Authentication → URL configuration**:
   - Site URL: `https://<your-vercel-domain>`
   - Redirect URLs: `https://<your-vercel-domain>/auth/callback` and, for previews, `https://*-<team>.vercel.app/auth/callback`

### 2. Google OAuth client

In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID (Web application)**:

- Authorised JavaScript origins: `https://<your-vercel-domain>`
- Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`

Set the OAuth consent screen to **Internal** so only the Clay Workspace can use it. The app also sends `hd=clay.com` and the database rejects any other domain.

### 3. Vercel

```bash
npx vercel link
npx vercel env add NEXT_PUBLIC_SUPABASE_URL
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
npx vercel env add NEXT_PUBLIC_SITE_URL          # https://<your-vercel-domain>
npx vercel env add NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN   # clay.com
npx vercel --prod
```

Or import the repo in the Vercel dashboard; the framework is auto-detected. After the first deploy, put the final domain into Supabase's redirect URLs (step 1.4) and Google's authorised origins (step 2).

### Changing the allowed domain

The domain is read from `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` in the app and from `public.allowed_email_domain()` in Postgres. Change both (a one-line migration for the SQL function).

## Data model

```
profiles          mirrors auth.users (name, email, avatar) via trigger
prompts           kind (prompt | skill), title, description, body, notes (how to use), files + links (JSON, skills only), audiences[] (one or more teams), visibility, owner, parent (fork), fork_note
prompt_apps       which tools it's built for + optional surfaces (text, validated against the catalog by trigger)
apps / surfaces / teams   the catalog: name, tag colours + install text (apps), position, archived flag; renames cascade into prompts and prompt_apps
admins            emails allowed to edit the catalog (is_admin() RPC)
prompt_editors    invited by email; linked to a profile on first sign-in
prompt_upvotes    one per user per prompt
prompt_versions   automatic snapshot of the previous content on every change
feedback          note, resolved flag, single owner/editor reply
storage           bucket skill-files: binary skill files at <prompt id>/<file path> (RLS mirrors prompt visibility)
```

Access rules (RLS): everyone at Clay can read public prompts; private prompts are readable by owner + editors; owner + editors can update prompts, manage apps, add editors, reply to and resolve feedback; only the owner can delete a prompt or remove editors; anyone can upvote, fork and post feedback on a prompt they can see; version history is visible to owner + editors only. Everyone can read the catalog; only admins can change it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:start` | Start local Supabase |
| `npm run db:reset` | Recreate local DB from migrations + seed |
| `npm run db:push` | Push migrations to the linked cloud project |
| `npm run db:types` | Generate TypeScript types from the local DB |

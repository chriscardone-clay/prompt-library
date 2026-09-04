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

- **Discover / My prompts** with search, filter by app (and surface for Claude/ChatGPT), filter by team, sort by top / newest / recently updated. Filters live in the URL so views are shareable.
- **Fill in the blanks**: `{{placeholders}}` in a prompt body become inputs; the preview updates live and one click copies the filled prompt. Fills persist per prompt in the browser.
- **Fork**: any prompt can be forked. Forks stay linked; the detail page shows the whole variant tree and the fork note ("what did you change?").
- **Upvotes** and **feedback** with reply + resolve for owners and editors.
- **Editors** invited by @clay.com email, even before they have signed in. Editors can edit and resolve feedback; only the owner can remove editors or delete.
- **Public / private** visibility. Private prompts are visible only to the owner and editors, enforced in the database.
- **Version history**: every content change snapshots the previous version automatically (Postgres trigger). Owners and editors can restore any version.
- **Google sign-in restricted to clay.com**, enforced three times: the OAuth `hd` hint, the auth callback, and a database trigger that refuses non-clay accounts.

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
  lib/
    data.ts                  all reads (server only)
    supabase/                server / browser / proxy clients
    constants.ts             apps, surfaces, audiences, colours
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
| App | https://prompt-library-clay-run-df4af71e.vercel.app (Vercel team `clay-run`, project `prompt-library`, auto-deploys from `main`) |
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

- Whole library: `https://prompts.artificialchill.com/`
- One prompt: `https://prompts.artificialchill.com/prompts/<id>` (copy the address from the prompt page)

How it works, and what to expect:

- The app sends `Content-Security-Policy: frame-ancestors` allowing Notion (`*.notion.so`, `*.notion.site`, `*.notion.com`) and itself. To allow another host, set `EMBED_FRAME_ANCESTORS` in Vercel to a space-separated list (or `*`) and redeploy.
- Inside an iframe the header goes compact and gains an "open in a new tab" control.
- Google will not run its sign-in flow inside an iframe, so the embedded login shows "Sign in with Google in a new tab". After signing in there, click "I've signed in, reload" in the embed.
- The session cookie is `SameSite=None; Secure` so it is sent to the embed. Browsers that block third-party cookies (Safari by default, Chrome Incognito) will keep showing the sign-in screen inside Notion; those users should open the library in a tab. The Notion desktop app and Chrome with default settings work.

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
prompts           title, description, body, audience, visibility, owner, parent (fork), fork_note
prompt_apps       which tools it's built for + optional surfaces (Claude: Chat/Code/Cowork, ChatGPT: Chat/Codex/Work)
prompt_editors    invited by email; linked to a profile on first sign-in
prompt_upvotes    one per user per prompt
prompt_versions   automatic snapshot of the previous content on every change
feedback          note, resolved flag, single owner/editor reply
```

Access rules (RLS): everyone at Clay can read public prompts; private prompts are readable by owner + editors; owner + editors can update prompts, manage apps, add editors, reply to and resolve feedback; only the owner can delete a prompt or remove editors; anyone can upvote, fork and post feedback on a prompt they can see; version history is visible to owner + editors only.

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

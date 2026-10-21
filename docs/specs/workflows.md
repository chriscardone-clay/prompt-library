# Workflows: a third kind of library item

Status: draft spec · Owner: Chris Cardone · Requested by: Carolyn Jones · 2026-10-21

## Why

Carolyn's team builds Clay Workflows and wants to save each one's architecture as a Markdown file (example: *Inbound Lead Enrichment & Routing — reference architecture*, 32 KB). The team should be able to submit these as they build. The library has to keep the `.md` exactly as uploaded so it can also be sent to customers.

A skill is the wrong fit. Skills get installed into an assistant, so they come with install steps, a `.skill` zip and a SKILL.md template. A workflow architecture is a reference doc that people read, build from and pass on. It needs its own type, its own place in Discover, and proper Markdown rendering.

## Goals

1. **The `.md` is the source of truth, byte for byte.** What someone uploads is exactly what anyone downloads: same bytes, same file name, no line-ending or whitespace changes.
2. **Easy to read in the library.** Rendered Markdown with GitHub-flavoured tables, wide code blocks and a table of contents, plus a toggle to view the raw source.
3. **Easy to submit while building.** Drop in a `.md`, and the title and description fill in from it. Two required fields, as with prompts.
4. **Treated like every other item.** Search, filters, upvotes, feedback, forks, favorites, editors, visibility, version history, the Slack assistant, the Claude/ChatGPT connector and the weekly digest all handle workflows.
5. **Safe to share with customers.** A check flags internal specifics before a file leaves Clay. Then the owner either downloads the `.md` or **publishes a read-only link** a customer can open without signing in.
6. **Adaptations stay visible.** Each customer- or segment-specific version is a fork labelled "Adapted for …", and every fork stays findable alongside the original.

## Non-goals (v1)

- **Importing a workflow into Clay.** Clay's architecture docs say outright that they aren't importable templates.
- **Two-way sync with a live Clay workflow.** A link to the workflow is allowed. Syncing is not.
- **Turning an existing skill into a workflow.** `kind` stays immutable. Anyone who already saved one as a skill re-uploads it.

## The item

A workflow is a `prompts` row with `kind = 'workflow'`. It reuses the existing columns:

| Field | Use for a workflow |
|---|---|
| `files[0]` | **The architecture `.md`, required.** Stored inline as a `SkillFile`, keeping the original `name` (e.g. `Inbound-Lead-Routing-Reference-Architecture.md`). |
| `files[1..]` | Optional attachments: diagrams (PNG/SVG), a JSON export, sample payloads. Binaries go to the existing Storage bucket, as skill files do. |
| `body` | A mirror of `files[0].content`, so search, history and the agent keep working unchanged (same pattern as SKILL.md for skills). |
| `links` | Optional: the live Clay workflow, a Loom walkthrough, a related Notion page. |
| `notes` | "How to use", e.g. when to reach for this architecture and what you need before building. |
| `apps` | Defaults to the catalog app **Clay Workflows** (an admin adds it in /admin). Other apps can be ticked as well. |
| `audiences`, `visibility`, `editors` | Same as now. |

New columns, added for every kind and used only by workflows:

| Column | Type | Notes |
|---|---|---|
| `trigger` | `text` (nullable) | Picked from webhook · schedule · table row · manual · other. Shown on the card and used as a filter. |
| `integrations` | `text[]` | Picked from a new Integrations catalog (Salesforce, HubSpot, Slack, Snowflake, ZoomInfo, ZeroBounce…) that **Carolyn's team maintains** (see "Integrations catalog"). Same rename-cascade and archive rules as teams. Used as a filter. |
| `stage` | `text` (nullable) | Draft · Tested · In production. A small badge. |
| `customer_ready` | `boolean`, default false | The owner confirms the file is safe to send to customers. See below. |

### Preservation rules

- **Text is never changed.** `src/lib/draft.ts` currently strips `\r\n` from prompt bodies. That step must skip workflow files. Server actions, MCP `create_item` and `update_item` all store `files[0].content` as received.
- **Size.** The main file may be up to **1 MB**, so the existing 50,000-character body limit doesn't apply to workflows. `body` mirrors only the first 50,000 characters, and search already reads only the first 8,000. The whole bundle, attachments included, stays under the existing 5 MB.
- **Download.** "Download .md" serves `files[0]` with its original name, `Content-Type: text/markdown; charset=utf-8` and `Content-Disposition: attachment`. "Download bundle (.zip)" appears only when there are attachments.
- **Copy Markdown** copies the raw source.
- **Versions.** Every version in history offers its own "Download .md", so an older revision can be sent to a customer.
- **Tested** by a round-trip check: upload a file containing CRLF line endings, tabs, trailing spaces and a BOM, then download it. The SHA-256 must match.

### Customer-ready check

The owner can set **Customer-ready** only after a checklist passes. The check runs on the client and on the server (in `draft.ts`, so the MCP `preview_item` reports the same warnings):

- No `@clay.com` email addresses, and no other email addresses outside placeholders.
- No Salesforce-style record IDs (15 or 18 characters, `00…` / `005…` / `001…`).
- No real CRM hostnames (`*.lightning.force.com`, `*.my.salesforce.com`) unless written as a placeholder such as `<your-org>`.
- No Slack channel or user IDs (`C0…` / `U0…` / `D0…`), and no Slack or Notion URLs.
- No credential-shaped strings, such as `xoxb-`, `sk-` and long base64 runs.

Each hit shows its line number and a jump link into the source view. These are warnings, not blocks. The owner can confirm anyway, and that choice is recorded. Downloading a workflow that isn't marked customer-ready shows one line: "Not marked customer-ready. Check it for internal details before sending."

Nothing is ever added to a downloaded file: no footer, no source line, no version stamp. Download means the file exactly as stored.

### Publish link (customer share)

Any workflow marked customer-ready can be **published** to a public, read-only URL that a customer opens without a Clay login. This is the first page on the site that doesn't require a clay.com login, so it is built as a separate surface with nothing shared with the signed-in app.

**Who.** The owner and editors can publish, see the link list and revoke links. Republishing or revoking is recorded in the item's activity.

**What the link serves.**
- The link is **pinned to a snapshot** taken at publish time: the `.md`, the attachments chosen at publish, the title and the description. Later edits never leak through a live link. The item page shows "Published version is behind. Update link" when the item has changed since. Updating keeps the URL and replaces the snapshot.
- The page shows the title, the description, the rendered doc with a table of contents, a Rendered / Source toggle, **Download .md** (the snapshot, byte for byte) and the attachments marked for sharing. It shows a small "Shared by Clay" header with the Clay logo and the publish date.
- It shows **none** of the following: owner, editors, notes ("How to use"), feedback, votes, forks, version history, teams, links, the library's navigation, search, or anything else from the library.

**Publishing.**
1. "Publish link" in the detail page's action row opens a panel. If the item isn't customer-ready, the panel shows the customer-ready checklist first.
2. The server re-runs the customer-ready scan on the exact snapshot and refuses if `customer_ready` is false. Warnings the owner has already acknowledged don't block.
3. Optional fields: a **label** ("Acme onboarding"), an **expiry** (none, 30, 90 or 365 days), and which attachments to include (none by default).
4. The result is a copyable URL: `https://www.clayprompts.com/s/<token>`.

**Managing links.** The detail page's side column lists every active link with its label, created by, created at, expires, views and last viewed. Each has Copy, Update to latest and **Revoke**. There can be more than one link per item, so each customer can get its own link and have it revoked separately.

**Security.**
- **Token.** 32 random bytes, base64url (43 characters). *As built:* the token is stored as is, readable only by the item's owner and editors through RLS, so they can copy the link again later. Hashing it would add no protection, because anyone who can read the row can already read the snapshot stored next to it. Tokens are never logged.
- **Routing.** `/s/*` is added to `PUBLIC_PATHS` in `src/lib/supabase/session.ts`. The route handler looks the token up with the service role and reads **only** the `workflow_shares` row, never `prompts`, so a bug in it can't expose library data. A revoked, expired or unknown token returns the same 404.
- **Headers.** `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` and a strict CSP (no inline scripts, no third-party requests). The page is rendered on the server and needs no client JS beyond the Source toggle and copy button.
- **Markdown.** Rendered without raw HTML (same `<MarkdownDoc>` as the app). Links in the doc get `rel="noopener noreferrer nofollow"`. Images only load from the share's own attachments, not from external URLs.
- **Rate limit.** *Not built.* A 256-bit token can't be guessed, so a limit would only slow down scraping of a link someone already has. Add one at the edge (Vercel firewall) if that becomes a concern.
- **Lifecycle.** Deleting the item revokes all its links. Making the item private doesn't revoke links, because publishing is an explicit owner choice, but the panel says so. Unticking customer-ready asks "Revoke N active links?".
- **Audit.** Each view increments `view_count` and sets `last_viewed_at`. No IP or user-agent is stored.

**Data.** New table `workflow_shares`:

| Column | Type |
|---|---|
| `id` | uuid |
| `prompt_id` | uuid → `prompts`, on delete cascade |
| `token_hash` | text, unique |
| `label` | text |
| `title`, `description` | text (snapshot) |
| `file` | jsonb (the `.md` `SkillFile`, snapshot) |
| `attachments` | jsonb (snapshot; binaries are copied to `shares/<share id>/…` in Storage so later edits or deletes don't affect them) |
| `source_updated_at` | timestamptz (the item's `updated_at` at publish, used for "behind") |
| `created_by`, `created_at`, `expires_at`, `revoked_at` | |
| `view_count`, `last_viewed_at` | |

RLS: owners and editors of the item can select their own item's shares. Inserts, updates and revokes go through security-definer RPCs (`publish_workflow`, `update_workflow_share`, `revoke_workflow_share`) that check the role and `customer_ready`. Anonymous users have no access; the public route uses the service role with a token-hash lookup only.

**MCP / Slack.** The connector gets `publish_workflow` and `revoke_workflow_share`. Both need the person to confirm in chat, and `publish_workflow` returns the scan warnings first. The Slack assistant never publishes; it can link to the item.

### Forks: "Adapted for"

- Forking a workflow asks **"Adapted for"** (required, e.g. "Acme — HubSpot instead of Salesforce", "Mid-market, no ZoomInfo") instead of the generic "What did you change". It is stored in `fork_note`, and the UI labels it "Adapted for …" wherever a workflow fork is shown.
- **Every fork stays available.** Forks show up in Discover, search, the Slack assistant and the connector just like originals. Nothing is hidden or collapsed under its parent. The card shows "Adapted for …" under the title.
- The detail page's variants tree is headed **Adaptations** for workflows and lists every fork with its "Adapted for" note, owner, stage and customer-ready status.
- Deleting the original keeps every adaptation. The existing reparent-on-delete behaviour (`0011_reparent_on_delete.sql`) stays, and the note reads "Original was deleted".
- Private forks stay private. "All forks remain available" means nothing is hidden by the library itself, not that visibility rules are skipped.

### Integrations catalog

- It is owned by **Carolyn's team**. A new **Workflow maintainers** role (`catalog_managers` table with `scope = 'integrations'`) can add, rename, recolour, reorder and archive integrations. It can't change apps, teams or admins.
- Admins assign the role from `/admin`. Maintainers get an `/admin/integrations` page and no other admin pages.
- The first list is seeded from the integrations named in the team's first 3–5 docs.

## Screens

### Discover and lists
- The All / Prompts / Skills toggle becomes **All / Prompts / Skills / Workflows**. The URL is `?kind=workflows`, and `/workflows` redirects to it, matching `/skills`.
- With Workflows selected, the Filters panel gains **Trigger** and **Integrations** (multi-select). Both are stored in the URL like the existing filters.
- With Workflows selected, the results bar adds a **Show** toggle: All · Reference architectures · Adaptations (with counts, stored as `?origin=reference|adapted`). A reference architecture is a workflow with no parent; an adaptation is any fork. The toggle only filters. Every adaptation still shows under All.
- Every workflow card and detail page carries a type label: **Reference architecture** (slushie tint) or **Adaptation** (ube tint). Adaptations also keep the "Adapted for …" line.
- Add **Services** to the teams catalog in /admin so it appears under "Built for". This is a data change, not code.
- **Card:** a Workflow badge, title, description, the trigger as a small label, up to three integration chips plus "+N", the stage badge, and a "Customer-ready" tick when set. Votes, forks and the owner show as they do now.

### Detail page
- **Header:** title, description, owner, stage, customer-ready status.
- **Actions:** Download .md (primary) · Publish link · Copy Markdown · Download bundle (only with attachments) · Adapt (fork) · Favorite · Upvote.
- On a fork, an "Adapted for …" line under the title links to the original.
- **Main column:** a **Rendered / Source** toggle. Rendered uses GFM (tables, task lists, fenced code), turns headings into anchors and leaves out raw HTML. Code blocks keep whitespace and scroll sideways; they never wrap, because flow-tree diagrams depend on that. Source shows the exact file with line numbers.
- **Side column:** a table of contents from H2/H3 that stays in place while scrolling and highlights the current section. Below it: trigger, integrations, **Published links** (owner and editors only), the apps and model card, links ("Open in Clay"), attachments, teams and editors.
- "How to use", feedback, the variants tree and version history keep their current placement.
- Long docs: a 32 KB file must render with no visible lag, and so must a 1 MB one with a lot of scrolling. Render on the server.

### New workflow (`/workflows/new`)
- First step: **Upload a .md** (drop zone, the default) · **Write it here** (starts from the template below) · **Paste Markdown**.
- After upload, the title comes from the first `# H1` and the description from the first paragraph after it, cut at the first sentence or 200 characters. Both stay editable.
- The trigger and integrations are guessed from the doc where possible (the word "webhook" near the top, integration names in the text). They're shown as suggestions the author confirms, never set silently.
- **Details** accordion: Where it works (defaults to Clay Workflows), Trigger, Integrations, Stage, Built for, Visibility, Editors, Customer-ready (with the checklist).
- "Add attachments" and "Add a link" work as they do for skills.
- Editing an existing workflow lets you replace the `.md`, either by uploading a new one or editing the source in a code-style textarea. Each save creates a version.

**Template** (based on Carolyn's doc):

```markdown
# <Workflow name> — reference architecture

One paragraph: what the flow does, for whom, and what it writes.

## At a glance
| | |
|---|---|
| Trigger | |
| Nodes | |
| Exit | |

## 1. What the flow does
## 2. Flow map
## 3. Input contract
## 4. Gate logic
## 5. Code nodes
## 6. LLM nodes
## 7. Actions used
## 8. What you must supply
## 9. Build recipe
## 10. Design lessons
## 11. Known issues
```

## Everywhere else

| Surface | Change |
|---|---|
| Search (`src/lib/search.ts`, `search_library()`) | Index title, description, notes and body as for other kinds. Add synonyms workflow ↔ architecture ↔ flow ↔ automation. Boost the workflow kind when the query mentions "workflow" or "architecture". Integration names count as meta, weight 0.3. |
| Slack assistant | Can recommend workflows. Cards say "Workflow · webhook · Salesforce, Slack". App Home counts workflows. |
| MCP connector | New `get_workflow` returns the Markdown exactly as stored, plus metadata. `search_library` and `browse_library` accept `kind: "workflow"`. `create_item` / `preview_item` / `update_item` accept workflows (the `.md` as a file plus trigger, integrations and stage). `start_saving` gains a "save this workflow architecture" path. |
| Weekly digest | Workflows count toward "most engaged" and "new this week", labelled as workflows. |
| Admin | New Integrations catalog, edited by Workflow maintainers. Admins assign that role. |
| Public share page `/s/<token>` | New, separate layout with none of the app's navigation. See "Publish link". |
| README | Features section updated. |

## Data and migrations

1. `0021_workflow_kind.sql` adds the value: `alter type prompt_kind add value 'workflow';`. This must be its own migration, because Postgres can't use a new enum value inside the transaction that adds it.
2. `0022_workflows.sql`:
   - adds the `trigger`, `integrations`, `stage` and `customer_ready` columns;
   - creates the `integrations` catalog table with RLS and rename-cascade triggers, copying `teams`;
   - rewrites `prompts_body_check` to require `files[0]` to be a `.md` for workflows, keep the 50k body limit, and allow an empty body only for skills;
   - updates `prompts_before_update` so the new columns count as content changes and get snapshotted (and adds them to `prompt_versions`);
   - updates `restore_prompt_version`;
   - updates `weekly_digest()` and `search_library()`;
   - creates `catalog_managers` and lets that role write to `integrations`.
3. `0023_workflow_shares.sql` creates `workflow_shares`, its RLS, the publish / update / revoke RPCs and the revoke trigger when customer-ready is unticked. Snapshot binaries go to a `shares/` prefix in Storage, readable only through the service role.
4. **Type layer:** `KINDS` / `KIND_LABELS` in `src/lib/constants.ts` plus the `Prompt` / `PromptDraft` types. Then work through the roughly 60 places across 23 files that branch on `"skill"`. Most are `kind === "skill"` checks that need a third case, not new logic.
5. **Markdown renderer:** `react-markdown` + `remark-gfm` + `rehype-slug`, with no `rehype-raw` (so no raw HTML), rendered server-side. A shared `<MarkdownDoc>` component. Skills could use it later for SKILL.md.

## Build phases

**Phase 1 (built, behind `WORKFLOWS_BETA`)**
- The workflow item type, migrations 0021–0022, and seeded `Clay Workflows` app and `Services` team.
- Upload, write or paste the `.md`, stored byte for byte. The editor refuses files that aren't valid UTF-8 instead of altering them. Docs are capped at 512 KB, to fit the existing `files` column limit.
- Title and description filled in from the doc, with suggested trigger and integrations.
- Discover:
  - a Workflows tab with All / Reference architectures / Adaptations;
  - Trigger, Integrations and Customer-ready filters;
  - workflow cards.
- The detail page:
  - the doc rendered or as source, with a contents list;
  - Copy Markdown and Download .md, including earlier versions;
  - "Adapted for" on adaptations and an Adaptations tree;
  - the customer-ready check for owners and editors.
- Adaptations must say what they're "Adapted for". They start as Draft and not customer-ready.
- Workflows are kept out of the Slack assistant, the MCP connector and the weekly digest.

**Phase 2 (built, migration 0023)**
- **Publish links** (`/s/<token>`, `/s/<token>/download`, `/s/<token>/files/<name>`):
  - pinned snapshots, with label, expiry, chosen attachments, Update and Revoke;
  - unticking customer-ready revokes every live link (a database trigger);
  - headers: noindex, no-referrer, no framing, and a sandbox CSP on attachments.
- **Integrations catalog** at `/admin/integrations`:
  - run by Workflow maintainers (`catalog_managers`); admins choose who they are;
  - add, rename (cascades to workflows), recolour, reorder, archive, and delete when unused;
  - the editor offers the list, and anything typed in shows under "In use but not on the list" for maintainers to add.
- **Attachments**:
  - up to 10 files, 5 MB in total, stored in the `skill-files` bucket;
  - always downloaded as attachments with nosniff and a sandbox CSP;
  - copied to adaptations and into publish links.

**Still to do**
- A security review of `/s/*` before the flag comes off.
- Workflows in the Slack assistant, the connector (`get_workflow`, `publish_workflow`) and the digest.
- A "Download bundle (.zip)" button.
- Search synonyms in SQL.
- Snapshotting trigger, stage and integrations in version history.

## Rollout

1. Ship behind `NEXT_PUBLIC_WORKFLOWS=1` and try it on preview with Carolyn's inbound-routing doc.
2. Add the Clay Workflows app in /admin and give Carolyn's team the Workflow maintainers role so they can seed integrations.
3. Carolyn's team submits 3–5 architectures and publishes one test link to an internal "customer" (a personal Gmail). Fix rendering problems in real docs, especially wide tables and ASCII trees.
4. **Security review** of `/s/*` before the flag comes off. Check that a token can't read anything beyond its own snapshot, that revoked, expired and unknown tokens all return the same 404, that the headers are set, and that the rate limit works.
5. Remove the flag and announce in `#auto-clayprompts`.

**Done when:**
- An uploaded `.md` downloads with a matching SHA-256, from both the library and a publish link.
- Carolyn's doc renders with every table and the flow map intact, in the app and on the public page.
- Editing an item doesn't change its published link until someone updates it. Revoking a link makes it 404 at once.
- Every adaptation shows up in Discover and the Adaptations tree.
- Workflows shows up in Discover, search, Slack and the connector.
- `npm run build` and lint pass, and the migrations apply cleanly to a copy of prod.

## Decisions

1. **Customer links:** in v1, as a snapshot-pinned, revocable publish link. See "Publish link".
2. **Integrations list:** Carolyn's team owns it through the Workflow maintainers role.
3. **Downloads:** never changed. No footer and no stamp.
4. **Forks:** labelled "Adapted for …", and every fork stays available.

## Open questions

1. Should a publish link offer a custom slug (`/s/acme-inbound-routing`) as well as the random token? A readable slug is easier to guess, so the default is token only.
2. Should expiry default to none, or to 90 days?

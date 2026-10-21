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
5. **Safe to share with customers.** A pre-download check flags internal specifics before a file leaves Clay.

## Non-goals (v1)

- **Public, unauthenticated links for customers.** Sharing means downloading the file and sending it. The site stays clay.com-only. See open question 1.
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
| `integrations` | `text[]` | Picked from a new admin-managed catalog (Salesforce, HubSpot, Slack, Snowflake, ZoomInfo, ZeroBounce…). Same rename-cascade and archive rules as teams. Used as a filter. |
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

## Screens

### Discover and lists
- The All / Prompts / Skills toggle becomes **All / Prompts / Skills / Workflows**. The URL is `?kind=workflows`, and `/workflows` redirects to it, matching `/skills`.
- With Workflows selected, the Filters panel gains **Trigger** and **Integrations** (multi-select). Both are stored in the URL like the existing filters.
- **Card:** a Workflow badge, title, description, the trigger as a small label, up to three integration chips plus "+N", the stage badge, and a "Customer-ready" tick when set. Votes, forks and the owner show as they do now.

### Detail page
- **Header:** title, description, owner, stage, customer-ready status.
- **Actions:** Download .md (primary) · Copy Markdown · Download bundle (only with attachments) · Fork · Favorite · Upvote.
- **Main column:** a **Rendered / Source** toggle. Rendered uses GFM (tables, task lists, fenced code), turns headings into anchors and leaves out raw HTML. Code blocks keep whitespace and scroll sideways; they never wrap, because flow-tree diagrams depend on that. Source shows the exact file with line numbers.
- **Side column:** a table of contents from H2/H3 that stays in place while scrolling and highlights the current section. Below it: trigger, integrations, the apps and model card, links ("Open in Clay"), attachments, teams and editors.
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
| Admin | New Integrations catalog (add, rename, recolour, reorder, archive). |
| README | Features section updated. |

## Data and migrations

1. `0021_workflow_kind.sql` adds the value: `alter type prompt_kind add value 'workflow';`. This must be its own migration, because Postgres can't use a new enum value inside the transaction that adds it.
2. `0022_workflows.sql`:
   - adds the `trigger`, `integrations`, `stage` and `customer_ready` columns;
   - creates the `integrations` catalog table with RLS and rename-cascade triggers, copying `teams`;
   - rewrites `prompts_body_check` to require `files[0]` to be a `.md` for workflows, keep the 50k body limit, and allow an empty body only for skills;
   - updates `prompts_before_update` so the new columns count as content changes and get snapshotted (and adds them to `prompt_versions`);
   - updates `restore_prompt_version`;
   - updates `weekly_digest()` and `search_library()`.
3. **Type layer:** `KINDS` / `KIND_LABELS` in `src/lib/constants.ts` plus the `Prompt` / `PromptDraft` types. Then work through the roughly 60 places across 23 files that branch on `"skill"`. Most are `kind === "skill"` checks that need a third case, not new logic.
4. **Markdown renderer:** `react-markdown` + `remark-gfm` + `rehype-slug`, with no `rehype-raw` (so no raw HTML), rendered server-side. A shared `<MarkdownDoc>` component. Skills could use it later for SKILL.md.

## Rollout

1. Ship behind `NEXT_PUBLIC_WORKFLOWS=1` and try it on preview with Carolyn's inbound-routing doc.
2. Add the Clay Workflows app and a starting set of integrations in /admin.
3. Carolyn's team submits 3–5 architectures. Fix rendering problems in real docs, especially wide tables and ASCII trees.
4. Remove the flag and announce in `#auto-clayprompts`.

**Done when:** an uploaded `.md` downloads with a matching SHA-256; Carolyn's doc renders with every table and the flow map intact; Workflows shows up in Discover, search, Slack and the connector; `npm run build` and lint pass; and the migration applies cleanly to a copy of prod.

## Open questions

1. **Customer links.** Should a customer-ready workflow get a public, read-only, revocable share link instead of a downloaded file? That would be the first unauthenticated page on the site, so it needs a security pass. Recommended for v2.
2. **Integration list.** Who owns it, Carolyn's team or the library admins? Should Clay's action packages seed it automatically?
3. **Clay branding for customers.** Should a downloaded file get a footer (source, version, date)? That would break the byte-for-byte rule, so the default is no, with an optional "Download with footer".
4. **Forks.** Is a fork of a reference architecture a fork, or "adapted for <customer>"? Same mechanism either way; possibly different wording.

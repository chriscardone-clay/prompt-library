Extend the **Clay Prompt Library** design (project: Clay Prompt Management Platform → Prompt Library, Terra brand design system) with a third kind of library item: **Workflows**. Keep every existing component, token, type style and pattern. This should look like it shipped with the original, not like a new product.

## Context

The library holds Prompts and Skills today. Clay's Workflows team wants to save the architecture of each Clay Workflow they build as a single Markdown file, a "reference architecture". These docs are long (10–40 KB), technical and structured: an "At a glance" table, a monospace ASCII flow tree up to 100 lines deep, tables of gate rules and code nodes, CLI snippets, "what you must supply" checklists. The `.md` file is the deliverable. It gets downloaded unchanged and sent to customers, so **Download .md** is the main action, not Copy.

## Screens to design (light and dark, desktop 1440 and mobile 390)

1. **Discover with the Workflows filter.** The All / Prompts / Skills toggle becomes All / Prompts / Skills / Workflows. With Workflows selected, the Filters panel gains *Trigger* (webhook, schedule, table row, manual) and *Integrations* (multi-select chips: Salesforce, HubSpot, Slack, Snowflake, ZoomInfo, ZeroBounce…). Show active-filter chips.

2. **Workflow card.** A Workflow badge (it needs its own icon and tint, clearly different from Skill), title, two-line description, the trigger as a small label ("Webhook"), up to three integration chips plus "+N", a stage badge (Draft / Tested / In production), and a small "Customer-ready" tick when set. Keep the existing upvote, fork-count and owner-avatar footer. Show a grid that mixes prompts, skills and workflows so the three read as one family.

3. **Workflow detail page.** This is the most important screen.
   - **Header:** title, description, owner, stage badge, customer-ready status.
   - **Action row:** **Download .md** (primary) · Copy Markdown · Download bundle (.zip, only with attachments) · Fork · Favorite · Upvote.
   - **Main column:** a *Rendered / Source* segmented toggle above the document.
     - Rendered: long-form Markdown typography for H1–H3, paragraphs, bold and inline code, GFM tables (zebra rows, sticky header, horizontal scroll inside the table when it's wider than the column), and fenced code blocks that **never wrap** and scroll sideways, because they hold ASCII flow trees with `└─` connectors.
     - Source: the raw file in mono with line numbers.
   - **Side column:** a table of contents (H2/H3) that stays in place and highlights the current section. Below it: trigger, integrations, "Where it works" with a model card (existing pattern), links ("Open in Clay"), attachments (file name, size, download), teams, editors.
   - Below the document: the existing "How to use", Feedback, Variants and Version history sections. Each version row gains a small "Download .md".
   - Design the doc with realistic content: *"Inbound Lead Enrichment & Routing — reference architecture"*, an at-a-glance table (74 nodes, 97 edges, 1 webhook trigger), a 25-line ASCII flow tree, a gate-logic section with rule bullets, and a 15-row "Actions used" table with two columns (Purpose, actionKey).

4. **Download when not customer-ready.** A light confirm popover from Download .md: "Not marked customer-ready. Check it for internal details before sending." with Download anyway / Review checklist. This should be a nudge, not a modal wall.

5. **New workflow: choose how it arrives.** Three option cards, the same pattern as the new-skill chooser: *Upload a .md* (the default, a big drop zone), *Write it here* (starts from a section template), *Paste Markdown*.

6. **New workflow: after upload.** A file chip (name, size, replace) with the title and description already filled in from the file and marked "from your file". Suggested trigger and integration chips the author confirms or dismisses ("We spotted Salesforce, Slack, Snowflake. Add them?"). A collapsed preview of the rendered doc. Then the existing one-column editor and a **Details** accordion with these rows: Where it works (defaults to Clay Workflows), Trigger, Integrations, Stage, Built for, Visibility, Editors, Customer-ready. Keep the REQUIRED chips and the "what's still missing" hint in the footer.

7. **Customer-ready checklist.** The Customer-ready row opened in the accordion. It shows the results of an automatic scan: warnings like "Line 212: looks like a Salesforce record ID", "Line 340: internal Slack channel ID", "Line 18: real CRM hostname, use a placeholder like `<your-org>`". Each warning links to that line in Source view. Then a checkbox: "I've checked this is safe to send to customers." Also show the all-clear state.

8. **Empty state** for Workflows in Discover ("No workflows yet. Upload your first architecture .md") and in a filtered view with no matches.

## Constraints

- Use Terra tokens only. Dark mode must hold WCAG AA (4.5:1) for every text/background pair, including table zebra rows and code blocks.
- Long docs must stay readable. Cap the line length in the rendered view, with tables and code allowed to break out wider than the text column.
- At 390 mobile width the table of contents becomes a "Contents" dropdown at the top of the doc. Tables and code scroll sideways; the page itself never does.
- Name the components you add (MarkdownDoc, DocToc, WorkflowCard, IntegrationChip, CustomerReadyCheck) and note how they reuse existing ones (Chip, Tag, CopyField, the SkillFiles file tabs, the Details accordion).

Deliver the screens plus a short handoff note listing the new components, their states and every new token or icon.

Extend the **Clay Prompt Library** design (project: Clay Prompt Management Platform → Prompt Library, Terra brand design system) with a third kind of library item: **Workflows**. Keep every existing component, token, type style and pattern. This should look like it shipped with the original, not like a new product.

**Put all of this work on a new, dedicated page in the project called "Workflows".** Don't edit the existing Prompt Library pages. Lay that page out so it can be shared with a stakeholder (Carolyn Jones, who leads the Workflows team) and understood with no walkthrough: a short intro at the top, then each screen in the order below, each with a title and a one-line caption saying what it shows and why. Desktop and mobile go side by side, and the dark-mode version sits next to each light-mode screen. End the page with the handoff notes.

## Context

The library holds Prompts and Skills today. Clay's Workflows team wants to save the architecture of each Clay Workflow they build as a single Markdown file, a "reference architecture".

These docs are long (10–40 KB), technical and structured: an "At a glance" table, a monospace ASCII flow tree up to 100 lines deep, tables of gate rules and code nodes, CLI snippets, "what you must supply" checklists.

The `.md` file is the deliverable, and it reaches customers two ways:
- it is downloaded unchanged and sent, so **Download .md** is the main action, not Copy;
- or it is opened through a **published read-only link** that a customer opens without a Clay login.

Teams adapt an architecture for a specific customer or segment by forking it, and every adaptation stays visible.

## Page intro (top of the Workflows page)

A short header block:
- the title "Workflows in the Clay Library";
- two sentences on what it is ("Save the architecture of every Clay Workflow you build as a Markdown file. Find it, adapt it, and share it with customers exactly as written.");
- three short value points: *Preserved exactly* (the .md you upload is the .md you send), *Adapt per customer* (forks labelled "Adapted for…", all kept), *Share safely* (customer-ready check plus revocable publish links);
- a simple flow strip: Upload → Review → Mark customer-ready → Download or Publish link → Adapt.

## Screens to design (light and dark, desktop 1440 and mobile 390)

1. **Discover with the Workflows filter.** The All / Prompts / Skills toggle becomes All / Prompts / Skills / Workflows. With Workflows selected, the Filters panel gains *Trigger* (webhook, schedule, table row, manual) and *Integrations* (multi-select chips: Salesforce, HubSpot, Slack, Snowflake, ZoomInfo, ZeroBounce…). Show active-filter chips.

2. **Workflow card.**
   - A Workflow badge, with its own icon and tint clearly different from Skill.
   - Title and a two-line description.
   - The trigger as a small label ("Webhook").
   - Up to three integration chips plus "+N".
   - A stage badge (Draft / Tested / In production) and a small "Customer-ready" tick when set.
   - On a fork, an "Adapted for Acme — HubSpot instead of Salesforce" line under the title.
   - Keep the existing upvote, fork-count and owner-avatar footer.
   - Show a grid that mixes prompts, skills, workflows and workflow adaptations, so they read as one family and adaptations sit alongside originals rather than being hidden.

3. **Workflow detail page.** This is the most important screen.
   - **Header:** title, description, owner, stage badge, customer-ready status.
   - **Action row:** **Download .md** (primary) · **Publish link** · Copy Markdown · Download bundle (.zip, only with attachments) · **Adapt** (fork) · Favorite · Upvote.
   - **Main column:** a *Rendered / Source* segmented toggle above the document.
     - Rendered: long-form Markdown typography for H1–H3, paragraphs, bold and inline code, GFM tables (zebra rows, sticky header, horizontal scroll inside the table when it's wider than the column), and fenced code blocks that **never wrap** and scroll sideways, because they hold ASCII flow trees with `└─` connectors.
     - Source: the raw file in mono with line numbers.
   - **Side column:**
     - a table of contents (H2/H3) that stays in place and highlights the current section;
     - trigger and integrations;
     - **Published links** (owner and editors only): each link's label, created, expires, view count, a "Behind latest" warning, and Copy / Update / Revoke actions;
     - "Where it works" with a model card (existing pattern);
     - links ("Open in Clay"), attachments, teams, editors.
   - **Below the document:**
     - the existing "How to use" and Feedback sections;
     - an **Adaptations** tree (replacing "Variants" for workflows), where each fork shows its "Adapted for…" note, owner, stage and customer-ready tick;
     - Version history, where each version row gains a small "Download .md".
   - Design the doc with realistic content: *"Inbound Lead Enrichment & Routing — reference architecture"*, an at-a-glance table (74 nodes, 97 edges, 1 webhook trigger), a 25-line ASCII flow tree, a gate-logic section with rule bullets, and a 15-row "Actions used" table with two columns (Purpose, actionKey).
   - Also show the same page as an **adaptation**: an "Adapted for Acme — HubSpot instead of Salesforce" line under the title, linking to the original.

4. **Download when not customer-ready.** A light confirm popover from Download .md: "Not marked customer-ready. Check it for internal details before sending." with Download anyway / Review checklist. This should be a nudge, not a modal wall.

5. **Publish link panel.** A side sheet from Publish link, in three states:
   - **(a) Not customer-ready:** the checklist inline, with "Mark customer-ready" before anything else.
   - **(b) Ready:**
     - a Label field ("Acme onboarding");
     - Expiry (None / 30 / 90 / 365 days);
     - attachments to include (checkboxes, all off by default);
     - a short "What the customer sees" summary: "Title, description, the document and Download .md. Not your notes, feedback, owners or history.";
     - Publish button.
   - **(c) Published:** the URL in a copy field (`clayprompts.com/s/…`), "Open as customer", and a note that the link shows this exact version until someone updates it.

6. **Public share page (what the customer sees, `/s/<token>`).** This is a separate, pared-back layout:
   - a slim header with the Clay logo and "Shared by Clay · Published 21 Oct 2026";
   - the title and description;
   - **Download .md** as the main button, plus attachments if any;
   - a Rendered / Source toggle;
   - the rendered doc with a table of contents.
   - No library navigation, search, avatars, votes, feedback or sign-in. It should feel like a polished Clay-branded document a customer would be glad to receive.
   - Also design the **link unavailable** state (revoked, expired or unknown all look the same): "This link isn't available. Ask your Clay contact for a new one."

7. **Adapt (fork) dialog.** It shows the source workflow and a required **"Adapted for"** field (examples: "Acme — HubSpot instead of Salesforce", "Mid-market, no ZoomInfo"), plus whether to start from the current version. Then it opens the editor.

8. **New workflow: choose how it arrives.** Three option cards, the same pattern as the new-skill chooser: *Upload a .md* (the default, a big drop zone), *Write it here* (starts from a section template), *Paste Markdown*.

9. **New workflow: after upload.**
   - A file chip (name, size, replace), with the title and description already filled in from the file and marked "from your file".
   - Suggested trigger and integration chips the author confirms or dismisses ("We spotted Salesforce, Slack, Snowflake. Add them?").
   - A collapsed preview of the rendered doc.
   - Then the existing one-column editor and a **Details** accordion with these rows: Where it works (defaults to Clay Workflows), Trigger, Integrations, Stage, Built for, Visibility, Editors, Customer-ready.
   - Keep the REQUIRED chips and the "what's still missing" hint in the footer.

10. **Customer-ready checklist.** The Customer-ready row opened in the accordion. It shows the results of an automatic scan: warnings like "Line 212: looks like a Salesforce record ID", "Line 340: internal Slack channel ID", "Line 18: real CRM hostname, use a placeholder like `<your-org>`". Each warning links to that line in Source view. Then a checkbox: "I've checked this is safe to send to customers." Also show the all-clear state.

11. **Integrations catalog (Workflow maintainers).** A small admin page for Carolyn's team: a list of integrations with name, colour tint, item count, and drag to reorder. Add, Rename (with "Updates N workflows"), Archive. A header note: "Maintained by the Workflows team."

12. **Empty states:**
    - Workflows in Discover with nothing yet: "No workflows yet. Upload your first architecture .md".
    - A filtered view with no matches.
    - The Published links list with no links yet.

## Constraints

- Use Terra tokens only. Dark mode must hold WCAG AA (4.5:1) for every text/background pair, including table zebra rows and code blocks.
- Long docs must stay readable. Cap the line length in the rendered view, with tables and code allowed to break out wider than the text column.
- At 390 mobile width the table of contents becomes a "Contents" dropdown at the top of the doc. Tables and code scroll sideways; the page itself never does.
- The public share page must not depend on anything that requires sign-in, and must look complete on its own.
- Name the components you add (MarkdownDoc, DocToc, WorkflowCard, IntegrationChip, CustomerReadyCheck, PublishPanel, ShareLinkRow, SharePage, AdaptDialog) and note how they reuse existing ones (Chip, Tag, CopyField, the SkillFiles file tabs, the Details accordion, VariantsTree).

## Handoff notes (end of the Workflows page)

List each new component with its states, every new token or icon, and the interaction details an engineer needs: TOC scroll behaviour, table and code overflow, the Rendered/Source toggle, the publish-panel states, and the copy for every warning and empty state.

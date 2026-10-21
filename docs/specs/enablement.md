# Enablement Approved

Status: built behind the `ENABLEMENT_APPROVED` Vercel flag (off for everyone by default). Design: the "Enablement Approved in the Clay Library" Claude Design canvas.

## What it is

Enablement keeps a **gold standard** for each common job (a *use case*, e.g. "Account research"), and approves other items after a review. Approved items carry a badge and rank higher everywhere people and agents look for items. Unreviewed items are unchanged.

| Tier | Who sets it | Boost |
|---|---|---|
| Gold standard | A reviewer, one per use case | +0.35 |
| Enablement approved | A reviewer, after the rubric | +0.20 |
| Community | Default | 0 |

## Rules

- **Approval covers the reviewed content.** Changing the prompt text, skill files or workflow .md marks the approval stale (`approval_stale`): no boost, "Approved earlier version" for viewers, "Re-review needed" for owners, and a re-review request is queued automatically. Title, description, notes, tags, apps and teams can change freely.
- **Only public items** can be approved. Making an approved item private removes the approval.
- **One gold standard per use case.** Replacing it keeps the old one Enablement approved. Removing or declining an approval also clears gold.
- **Reviews come due** after 30, 90 (default) or 180 days and show under *Due* 14 days ahead. Approval stays until a reviewer decides.
- **Boost, not filter.** Ranking adds the boost to search relevance only after the relevance cut-off, so a gold standard never shows up for a search it doesn't match. Discover's *Recommended* sort (default with the flag) orders gold, approved, then upvotes.

## Roles

- **Owners and editors** request a review (use case, note) or withdraw one; see changes requested and notes.
- **Reviewers** (`enablement_reviewers`) see `/enablement`: Needs review, Due, Approved, Gold standards (use cases and their gold items). Decisions: Approve, Approve as gold standard, Request changes, Not approved, Remove approval.
- **Admins** manage the reviewers list (Reviewers tab). Admins aren't reviewers unless they add themselves.

## Surfaces

- Discover: badges on cards, gold standards shelf, Recommended sort, *Enablement approved* toggle and filter group (approved / gold only).
- Item page: banner under the description, *Enablement review* side panel (facts, rubric, note, built-from gold standard, history), request dialog.
- Editor: a note when editing approved content.
- Claude connector: `- enablement:` line on every result, `approved_only` on `search_library` / `browse_library`, `recommended` sort (default with the flag), boost in search and `recommend_for_me`, instructions to prefer approved items when they fit.
- Slack assistant: candidates ordered by tier, tier shown to the model with a rule to prefer it when it fits, 🏅 / ✅ on reply cards, boost in the non-AI fallback.
- Slack DMs to the owner (and requester) on every decision; new requests to `ENABLEMENT_SLACK_CHANNEL` when set.

People without the flag see none of this, and their ranking is unchanged.

## Data

Migration `0024_enablement_approval.sql`:

- `enablement_reviewers (email)`, `can_review()`.
- `enablement_use_cases (id, name, description, gold_prompt_id unique, position, archived)`.
- `prompts.approval ('none'|'approved'|'gold')`, `approval_stale`, `approved_at`, `approved_by`, `approval_due_at`, `approval_use_case`.
- `prompt_reviews`: one row per request and decision (reason, status, tier, use case, requester, request note, reviewer, decision note, rubric, approved text snapshot for diffs). One open request per item.
- Functions: `review_request`, `review_withdraw`, `review_decide`, `review_revoke`, `review_set_gold`. A trigger keeps approval columns read-only to everyone else, marks approvals stale on content edits and re-queues them.

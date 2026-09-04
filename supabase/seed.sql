-- ═══════════════════════════════════════════════════════════════════
-- LOCAL DEVELOPMENT SEED — runs with `supabase db reset`.
-- Creates four demo Clay accounts (password: "password") and the sample
-- prompts, forks, versions and feedback from the design prototype.
-- Do NOT run this against production.
-- ═══════════════════════════════════════════════════════════════════

-- Demo users -------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'chris@clay.com',  crypt('password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Chris Cardone","avatar_url":"/avatars/shapeA.jpg"}', now(), now(), '', '', '', ''),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'priya@clay.com',  crypt('password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Priya Natarajan","avatar_url":"/avatars/shapeB.jpg"}', now(), now(), '', '', '', ''),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'marcus@clay.com', crypt('password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Marcus Lee","avatar_url":"/avatars/shapeC.jpg"}', now(), now(), '', '', '', ''),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dana@clay.com',   crypt('password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Dana Whitfield","avatar_url":"/avatars/shapeD.jpg"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email in ('chris@clay.com', 'priya@clay.com', 'marcus@clay.com', 'dana@clay.com');

-- Prompts ----------------------------------------------------------------
-- Triggers are disabled while seeding so we can set historic timestamps
-- and write version rows by hand.
alter table public.prompts disable trigger prompts_before_update;
alter table public.prompts disable trigger prompts_before_insert;

insert into public.prompts (id, title, description, body, audiences, visibility, owner_id, parent_id, fork_note, last_edited_by, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000001', 'Account research brief',
   'A one-page brief on any target account before a first call.',
   E'You are a senior GTM researcher at Clay. Write a one-page research brief on {{company}} for a first call with a {{persona}}.\n\nInclude:\n1. What they sell and to whom, in two sentences\n2. Three recent signals (funding, hiring, launches) with dates\n3. Their current GTM stack, if public\n4. Two ways {{product}} could help, phrased as questions I can ask\n\nBe specific. Cite sources inline. No filler.',
   '{GTM}', 'public', '22222222-2222-2222-2222-222222222222', null, '', '22222222-2222-2222-2222-222222222222', now() - interval '61 days', now() - interval '9 days'),
  ('a0000000-0000-0000-0000-000000000002', 'Account research brief · enterprise',
   'The research brief, tuned for enterprise accounts with multiple stakeholders.',
   E'You are a senior GTM researcher at Clay. Write a research brief on {{company}} for a first call with a {{persona}}.\n\nInclude:\n1. What they sell and to whom, in two sentences\n2. Three recent signals with dates\n3. Likely buying committee: titles, what each cares about\n4. Competitors they already use for {{category}} and where those fall short\n5. Two ways {{product}} could help, phrased as questions\n\nBe specific. Cite sources inline.',
   '{GTM}', 'public', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001',
   'Added a competitor section and a buying-committee map. Cut the stack section.', '11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '2 days'),
  ('a0000000-0000-0000-0000-000000000003', 'Research brief · 5 bullets only',
   'Fastest version. Five bullets, nothing else.',
   'Research {{company}}. Give me exactly five bullets, each under 20 words: what they do, one recent signal, their likely buyer, one competitor, one question to open a call with a {{persona}}.',
   '{GTM}', 'public', '33333333-3333-3333-3333-333333333333', 'a0000000-0000-0000-0000-000000000002',
   'Trimmed to five bullets so it fits in a Slack message. Moved it to ChatGPT.', '33333333-3333-3333-3333-333333333333', now() - interval '12 days', now() - interval '12 days'),
  ('a0000000-0000-0000-0000-000000000004', 'PRD first draft',
   'Turns a rough problem statement into a PRD skeleton the team can react to.',
   E'Draft a PRD for {{feature}}.\n\nContext: {{problem}}\nSuccess metric: {{metric}}\n\nSections: Problem, Who it’s for, Proposed solution, Out of scope, Open questions, Launch plan. Keep each section under 120 words. Flag any assumption you had to make with [ASSUMPTION].',
   '{EPD}', 'public', '11111111-1111-1111-1111-111111111111', null, '', '22222222-2222-2222-2222-222222222222', now() - interval '40 days', now() - interval '1 day'),
  ('a0000000-0000-0000-0000-000000000005', 'Support reply rewrite',
   'Rewrites a draft reply in Clay’s voice: warm, direct, no fluff.',
   E'Rewrite this support reply in Clay’s voice: warm, direct, confident, no exclamation marks, no corporate phrasing. Keep every fact. Address the customer as {{customer_name}}.\n\nDraft:\n{{draft}}',
   '{GS}', 'public', '44444444-4444-4444-4444-444444444444', null, '', '44444444-4444-4444-4444-444444444444', now() - interval '22 days', now() - interval '22 days'),
  ('a0000000-0000-0000-0000-000000000006', 'Find the pricing page',
   'Claygent column prompt: returns the pricing URL and the cheapest plan.',
   'Visit {{domain}}. Find the pricing page. Return JSON: { "pricing_url": string, "has_free_tier": boolean, "lowest_paid_plan_usd_month": number | null }. If there is no public pricing, return pricing_url as null and note "contact sales".',
   '{GTM}', 'public', '22222222-2222-2222-2222-222222222222', null, '', '22222222-2222-2222-2222-222222222222', now() - interval '18 days', now() - interval '5 days'),
  ('a0000000-0000-0000-0000-000000000007', 'Friday EGS newsletter digest',
   'Turns a week of channel exports into the Friday digest. Internal draft.',
   E'You are writing the Friday digest for the {{team}} team. Input is a week of Slack exports below. Output: a 5-bullet executive summary, then sections by theme. Bold launch names. Prefer leadership posts. Skip anything about a single customer.\n\n{{exports}}',
   '{Other}', 'private', '11111111-1111-1111-1111-111111111111', null, '', '11111111-1111-1111-1111-111111111111', now() - interval '8 days', now() - interval '3 days'),
  ('a0000000-0000-0000-0000-000000000008', 'Meeting recap for Slack',
   'Transcript in, customer-ready recap out.',
   E'From the transcript below, write a Slack recap for {{customer}}. Sections: Recap, Action items (owner + date), Next steps. Under 200 words. Sentence case. No emoji.\n\n{{transcript}}',
   '{GS}', 'public', '33333333-3333-3333-3333-333333333333', null, '', '33333333-3333-3333-3333-333333333333', now() - interval '15 days', now() - interval '6 days'),
  ('a0000000-0000-0000-0000-000000000009', 'Job change outreach',
   'A three-line note to someone who just changed jobs.',
   'Write a three-line note to {{first_name}}, who just started as {{new_title}} at {{company}}. Line 1: congratulate without flattery. Line 2: one specific thing about {{company}}. Line 3: a low-pressure ask. No subject line.',
   '{GTM}', 'public', '44444444-4444-4444-4444-444444444444', null, '', '44444444-4444-4444-4444-444444444444', now() - interval '3 days', now() - interval '3 days');

-- Skills (kind = 'skill'): files/links live as JSON; body mirrors SKILL.md.
insert into public.prompts (id, kind, title, description, body, files, links, audiences, visibility, owner_id, last_edited_by, created_at, updated_at) values
  ('b0000000-0000-0000-0000-000000000001', 'skill', 'Clay formulas',
   'Teaches the model Clay’s formula syntax: JavaScript expressions, column references, common transforms.',
   E'---\nname: clay-formulas\ndescription: Write Clay table formulas using JavaScript expression syntax. Use when a user needs to transform, score, or extract data in a Clay column.\n---\n\n# Clay formulas\n\nClay formulas are single JavaScript expressions. No statements, no semicolons, no variable declarations.\n\n## Rules\n\n- Reference columns with double curly braces around the column name.\n- Return a value; do not write `return`.\n- Use optional chaining for nested JSON.\n- Ternaries for branching. Chain `.map` / `.filter` / `.join` for arrays.\n\n## Patterns\n\nSee examples.md for scoring, extraction, and formatting recipes.\n',
   jsonb_build_array(
     jsonb_build_object('name', 'SKILL.md', 'content', E'---\nname: clay-formulas\ndescription: Write Clay table formulas using JavaScript expression syntax. Use when a user needs to transform, score, or extract data in a Clay column.\n---\n\n# Clay formulas\n\nClay formulas are single JavaScript expressions. No statements, no semicolons, no variable declarations.\n\n## Rules\n\n- Reference columns with double curly braces around the column name.\n- Return a value; do not write `return`.\n- Use optional chaining for nested JSON.\n- Ternaries for branching. Chain `.map` / `.filter` / `.join` for arrays.\n\n## Patterns\n\nSee examples.md for scoring, extraction, and formatting recipes.\n'),
     jsonb_build_object('name', 'examples.md', 'content', E'# Examples\n\n## Score an account\n\n`({{Employees}} > 200 ? 2 : 1) + ({{Industry}} === "Software" ? 2 : 0)`\n\n## First name from full name\n\n`{{Full Name}}.split(" ")[0]`\n\n## Join a list\n\n`{{Tech Stack}}.filter(Boolean).join(", ")`\n')
   ),
   '[]'::jsonb, '{GTM}', 'public', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', now() - interval '20 days', now() - interval '4 days'),
  ('b0000000-0000-0000-0000-000000000002', 'skill', 'Slack customer recap',
   'Turns a transcript into a customer-facing Slack recap with the standard section headers.',
   E'---\nname: slack-customer-recap\ndescription: Generate customer-facing Slack recap messages from meeting transcripts. Use when asked for a Slack recap, channel recap, or meeting follow-up.\n---\n\n# Slack customer recap\n\n1. Read the transcript. Pull decisions, action items with owners, open questions.\n2. Write in Clay’s voice: warm, direct, sentence case, no emoji in body copy.\n3. Use the section template in template.md.\n4. Keep it under 200 words.\n',
   jsonb_build_array(
     jsonb_build_object('name', 'SKILL.md', 'content', E'---\nname: slack-customer-recap\ndescription: Generate customer-facing Slack recap messages from meeting transcripts. Use when asked for a Slack recap, channel recap, or meeting follow-up.\n---\n\n# Slack customer recap\n\n1. Read the transcript. Pull decisions, action items with owners, open questions.\n2. Write in Clay’s voice: warm, direct, sentence case, no emoji in body copy.\n3. Use the section template in template.md.\n4. Keep it under 200 words.\n'),
     jsonb_build_object('name', 'template.md', 'content', E'*Recap*\n> • \n\n*Action items*\n> • Owner — item — date\n\n*Next steps*\n> • \n')
   ),
   jsonb_build_array(jsonb_build_object('label', 'Claude project', 'url', 'https://claude.ai/project/slack-customer-recap')),
   '{GS}', 'public', '33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', now() - interval '11 days', now() - interval '11 days'),
  ('b0000000-0000-0000-0000-000000000003', 'skill', 'Deal desk assistant',
   'Custom GPT that answers pricing, discount, and approval questions from the deal desk playbook.',
   '', '[]'::jsonb,
   jsonb_build_array(
     jsonb_build_object('label', 'Open the GPT', 'url', 'https://chatgpt.com/g/g-deal-desk-assistant'),
     jsonb_build_object('label', 'Playbook source', 'url', 'https://docs.google.com/document/d/deal-desk-playbook')
   ),
   '{GTM}', 'public', '44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', now() - interval '5 days', now() - interval '1 day');

alter table public.prompts enable trigger prompts_before_update;
alter table public.prompts enable trigger prompts_before_insert;

insert into public.prompt_apps (prompt_id, app, surfaces) values
  ('b0000000-0000-0000-0000-000000000001', 'Claude',   '{Code,Cowork}'),
  ('b0000000-0000-0000-0000-000000000002', 'Claude',   '{Code,Cowork}'),
  ('b0000000-0000-0000-0000-000000000003', 'ChatGPT',  '{Chat,Work}'),
  ('a0000000-0000-0000-0000-000000000001', 'Claude',   '{Chat}'),
  ('a0000000-0000-0000-0000-000000000002', 'Claude',   '{Chat,Cowork}'),
  ('a0000000-0000-0000-0000-000000000003', 'ChatGPT',  '{Chat}'),
  ('a0000000-0000-0000-0000-000000000004', 'Town',     '{}'),
  ('a0000000-0000-0000-0000-000000000004', 'Claude',   '{Cowork}'),
  ('a0000000-0000-0000-0000-000000000005', 'ChatGPT',  '{Chat,Work}'),
  ('a0000000-0000-0000-0000-000000000005', 'Claude',   '{Chat}'),
  ('a0000000-0000-0000-0000-000000000006', 'Claygent', '{}'),
  ('a0000000-0000-0000-0000-000000000007', 'Claude',   '{Code}'),
  ('a0000000-0000-0000-0000-000000000008', 'Claude',   '{Chat}'),
  ('a0000000-0000-0000-0000-000000000008', 'ChatGPT',  '{Chat}'),
  ('a0000000-0000-0000-0000-000000000009', 'ChatGPT',  '{}');

insert into public.prompt_editors (prompt_id, email, added_by) values
  ('a0000000-0000-0000-0000-000000000001', 'marcus@clay.com', '22222222-2222-2222-2222-222222222222'),
  ('a0000000-0000-0000-0000-000000000004', 'priya@clay.com',  '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000007', 'priya@clay.com',  '11111111-1111-1111-1111-111111111111');

insert into public.prompt_upvotes (prompt_id, user_id) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333'),
  ('a0000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444'),
  ('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222'),
  ('a0000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222'),
  ('a0000000-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333'),
  ('a0000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444'),
  ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222'),
  ('a0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000006', '33333333-3333-3333-3333-333333333333'),
  ('a0000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222'),
  ('a0000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222'),
  ('a0000000-0000-0000-0000-000000000008', '44444444-4444-4444-4444-444444444444');

insert into public.prompt_versions (prompt_id, title, description, body, saved_at, saved_by) values
  ('a0000000-0000-0000-0000-000000000001', 'Account research brief', 'A one-page brief on any target account before a first call.',
   E'Write a research brief on {{company}} for a first call with a {{persona}}.\n\nInclude what they sell, recent news, and how {{product}} could help.',
   now() - interval '61 days', '22222222-2222-2222-2222-222222222222'),
  ('a0000000-0000-0000-0000-000000000001', 'Account research brief', 'A one-page brief on any target account before a first call.',
   E'You are a senior GTM researcher at Clay. Write a one-page research brief on {{company}} for a first call with a {{persona}}.\n\nInclude:\n1. What they sell and to whom, in two sentences\n2. Three recent signals (funding, hiring, launches)\n3. Their current GTM stack, if public\n4. Two ways {{product}} could help\n\nBe specific. No filler.',
   now() - interval '35 days', '33333333-3333-3333-3333-333333333333'),
  ('a0000000-0000-0000-0000-000000000004', 'PRD skeleton', 'Turns a rough problem statement into a PRD skeleton.',
   E'Draft a PRD for {{feature}}.\n\nContext: {{problem}}\n\nSections: Problem, Solution, Open questions.',
   now() - interval '40 days', '11111111-1111-1111-1111-111111111111');

alter table public.feedback disable trigger feedback_before_insert;
insert into public.feedback (prompt_id, user_id, text, created_at, resolved, reply, reply_by, replied_at) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Signals section is great, but it keeps citing press releases older than a year. Could we scope it to 12 months?',
   now() - interval '20 days', true, 'Added “in the last 12 months” to the signals line. Thanks.', '22222222-2222-2222-2222-222222222222', now() - interval '19 days'),
  ('a0000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   'Works well in Claude. In ChatGPT it ignores the “no filler” line and adds an intro paragraph.',
   now() - interval '6 days', false, '', null, null),
  ('a0000000-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333',
   'Could the launch plan section ask for rollout phases? It tends to give one big-bang launch.',
   now() - interval '4 days', false, '', null, null),
  ('a0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222',
   'Action items sometimes lack owners when the transcript is ambiguous. Maybe ask it to flag unassigned ones?',
   now() - interval '2 days', false, '', null, null);
alter table public.feedback enable trigger feedback_before_insert;

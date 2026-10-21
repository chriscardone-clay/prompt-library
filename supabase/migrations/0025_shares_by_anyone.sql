-- Anyone at Clay can publish a customer link to a customer-ready workflow,
-- not just its owner and editors. People see the links they published;
-- owners and editors still see (and can revoke) every link to their item.
-- Writes stay server-side with the service role (src/app/share-actions.ts).
alter policy workflow_shares_select on public.workflow_shares
  using (public.is_allowed_user() and (public.can_edit_prompt(prompt_id) or created_by = auth.uid()));

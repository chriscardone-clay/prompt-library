-- Better non-AI search for the Slack assistant (and anything else that wants
-- ranked library search): per-field word matching, fuzzy title matching,
-- app/team names as searchable text, synonym support, and intent boosts.

create extension if not exists pg_trgm with schema extensions;

-- Searchable text per field. App and team names use the 'simple' dictionary so
-- "granola" or "gtme" match literally; prose fields are stemmed English.
create or replace function public.prompt_search_fields(p public.prompts, out t_title tsvector, out t_desc tsvector, out t_meta tsvector, out t_body tsvector)
language sql
stable
security definer
set search_path = public
as $$
  select to_tsvector('english', coalesce(p.title, '')),
         to_tsvector('english', coalesce(p.description, '')),
         to_tsvector('english', coalesce(p.notes, ''))
           || to_tsvector('simple',
                coalesce((select string_agg(pa.app || ' ' || array_to_string(coalesce(pa.surfaces, '{}'), ' '), ' ')
                            from public.prompt_apps pa where pa.prompt_id = p.id), '')
                || ' ' || array_to_string(coalesce(p.audiences, '{}'), ' ')),
         to_tsvector('english', left(coalesce(p.body, ''), 8000));
$$;

/**
 * Ranked search over public items.
 *
 * Each content word scores by the best field it appears in: title 1.0,
 * description 0.5, notes/apps/teams 0.3, body 0.1. The item's score is the
 * average over the words (so 3 of 4 words in the title beats 4 of 4 buried in
 * the body), plus: +0.3 when every word appears somewhere outside the body,
 * +0.3 × synonym coverage, +0.35 × fuzzy title similarity (against the cleaned
 * words and against the question as typed), +0.1 for the kind
 * the person asked for, +0.15 for an app they named.
 *
 *   p_words  content words from the question (cleaned by the app)
 *   p_extra  synonym expansions
 *   p_query  the cleaned question as one string, for fuzzy title matching
 *   p_kind   'prompt' | 'skill' | null
 *   p_apps   lower-cased app names mentioned
 *   p_raw    the question as typed (lower-cased); rewards titles phrased like the ask
 */
create or replace function public.search_library(
  p_words text[],
  p_extra text[] default '{}',
  p_query text default '',
  p_kind text default null,
  p_apps text[] default '{}',
  p_limit int default 5,
  p_raw text default ''
)
returns table (id uuid, score real, matched_words text[], and_match boolean, title_sim real, best_weight real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  n_words int := coalesce(array_length(p_words, 1), 0);
  n_extra int := coalesce(array_length(p_extra, 1), 0);
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'search_library: admins only' using errcode = '42501';
  end if;
  if n_words = 0 and n_extra = 0 and coalesce(p_query, '') = '' then
    return;
  end if;

  return query
  with items as (
    select p.id, p.title, p.kind::text as kind, f.*
      from public.prompts p
      cross join lateral public.prompt_search_fields(p) f
     where p.visibility = 'public'
  ),
  per_word as (
    select i.id, w.word, w.ord,
           case when numnode(plainto_tsquery('english', w.word)) = 0 then null
                when i.t_title @@ plainto_tsquery('english', w.word) then 1.0
                when i.t_desc  @@ plainto_tsquery('english', w.word) then 0.5
                when i.t_meta  @@ plainto_tsquery('english', w.word)
                  or i.t_meta  @@ plainto_tsquery('simple',  w.word) then 0.3
                when i.t_body  @@ plainto_tsquery('english', w.word) then 0.1
                else 0 end as weight
      from items i
      cross join unnest(coalesce(p_words, '{}')) with ordinality as w(word, ord)
  ),
  per_extra as (
    select i.id,
           case when numnode(plainto_tsquery('english', w)) = 0 then null
                when i.t_title @@ plainto_tsquery('english', w) then 1.0
                when i.t_desc  @@ plainto_tsquery('english', w) then 0.5
                when i.t_meta  @@ plainto_tsquery('english', w) then 0.3
                when i.t_body  @@ plainto_tsquery('english', w) then 0.1
                else 0 end as weight
      from items i
      cross join unnest(coalesce(p_extra, '{}')) as w
  ),
  agg as (
    select i.id, i.kind, i.title,
           coalesce((select avg(pw.weight) from per_word pw where pw.id = i.id and pw.weight is not null), 0) as word_score,
           coalesce((select bool_and(pw.weight >= 0.3) from per_word pw where pw.id = i.id and pw.weight is not null), false)
             and exists (select 1 from per_word pw where pw.id = i.id and pw.weight is not null) as all_outside_body,
           coalesce((select array_agg(pw.word order by pw.ord) from per_word pw where pw.id = i.id and pw.weight > 0), '{}') as matched,
           coalesce((select avg(pe.weight) from per_extra pe where pe.id = i.id and pe.weight is not null), 0) as extra_score,
           greatest(
             case when coalesce(p_query, '') <> '' then greatest(word_similarity(lower(p_query), lower(i.title)), similarity(lower(p_query), lower(i.title))) else 0 end,
             case when coalesce(p_raw, '') <> '' then word_similarity(lower(regexp_replace(i.title, '[^[:alnum:] ]', ' ', 'g')), lower(p_raw)) else 0 end
           ) as t_sim,
           coalesce((select max(pw.weight) from per_word pw where pw.id = i.id), 0) as best_weight
      from items i
  )
  select a.id,
         ( a.word_score
         + case when a.all_outside_body then 0.3 else 0 end
         + 0.3 * a.extra_score
         + 0.35 * a.t_sim
         + case when p_kind is not null and a.kind = p_kind then 0.1 else 0 end
         + case when coalesce(array_length(p_apps, 1), 0) > 0
                 and exists (select 1 from public.prompt_apps pa where pa.prompt_id = a.id and lower(pa.app) = any (p_apps))
                then 0.15 else 0 end
         )::real as score,
         a.matched::text[] as matched_words,
         a.all_outside_body as and_match,
         a.t_sim::real as title_sim,
         a.best_weight::real as best_weight
    from agg a
   where (a.word_score + 0.3 * a.extra_score + 0.35 * a.t_sim) > 0.04
   order by 2 desc, a.title
   limit p_limit;
end;
$$;

grant execute on function public.search_library(text[], text[], text, text, text[], int, text) to authenticated, service_role;

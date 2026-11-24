-- Iischi Party (Openair Gampel 2027) – Rangliste für Supabase
-- Einmal im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Das Skript kann gefahrlos mehrmals ausgeführt werden.
--
-- Sicherheit:
-- * Das Spiel darf die Tabelle weder direkt lesen noch direkt beschreiben.
-- * Es ruft nur die zwei Funktionen unten auf.
-- * E-Mail-Adressen verlassen die Datenbank nie. Sichtbar sind sie nur im
--   Supabase-Dashboard (Table Editor -> iischi_party_alle_spiele).

-- Tabelle iischi_party_alle_spiele: jedes gespielte Spiel mit Name, E-Mail und Punkten.
-- (Früherer Name iischi_party_scores wird umbenannt, Einträge bleiben erhalten.)
do $$
begin
  if to_regclass('public.iischi_party_scores') is not null and to_regclass('public.iischi_party_alle_spiele') is null then
    alter table public.iischi_party_scores rename to iischi_party_alle_spiele;
  end if;
end $$;

create table if not exists public.iischi_party_alle_spiele (
  id         bigint generated always as identity primary key,
  name       text        not null check (char_length(name) between 1 and 24),
  email      text        not null check (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  score      integer     not null check (score between 0 and 30000),
  accuracy   integer     not null default 0 check (accuracy between 0 and 100),
  best_combo integer     not null default 0 check (best_combo between 0 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists iischi_party_scores_email_idx on public.iischi_party_alle_spiele (lower(email));
create index if not exists iischi_party_scores_score_idx on public.iischi_party_alle_spiele (score desc);

alter table public.iischi_party_alle_spiele enable row level security;
revoke all on table public.iischi_party_alle_spiele from anon, authenticated;

-- Bestenliste: pro Spieler (E-Mail) zählt nur das beste Ergebnis.
-- Gibt nur Platz, Name und Punkte zurück, nie die E-Mail.
create or replace function public.iischi_party_board(p_limit integer default 10)
returns table (rank bigint, name text, score integer)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select distinct on (lower(s.email)) s.name, s.score, s.created_at
    from public.iischi_party_alle_spiele s
    order by lower(s.email), s.score desc, s.created_at asc
  )
  select rank() over (order by b.score desc) as rank, b.name, b.score
  from best b
  order by b.score desc, b.created_at asc
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

-- Ergebnis eintragen. Gibt den Platz des Spielers, seine Bestpunktzahl
-- und die Anzahl Spieler auf der Rangliste zurück.
create or replace function public.iischi_party_submit(p_name text, p_email text, p_score integer, p_accuracy integer, p_combo integer)
returns table (rank bigint, best_score integer, total bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_best  integer;
begin
  -- Schutz gegen Spam: höchstens 20 Einträge pro E-Mail-Adresse und Stunde.
  if (select count(*) from public.iischi_party_alle_spiele s
      where lower(s.email) = v_email and s.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too_many_entries' using errcode = 'P0001';
  end if;

  insert into public.iischi_party_alle_spiele (name, email, score, accuracy, best_combo)
  values (v_name, v_email, p_score, coalesce(p_accuracy, 0), coalesce(p_combo, 0));

  select max(s.score) into v_best from public.iischi_party_alle_spiele s where lower(s.email) = v_email;

  -- Der zuletzt eingegebene Name gilt für alle Einträge dieses Spielers.
  update public.iischi_party_alle_spiele s set name = v_name where lower(s.email) = v_email and s.name <> v_name;

  return query
    with best as (
      select lower(s.email) as player, max(s.score) as top
      from public.iischi_party_alle_spiele s
      group by lower(s.email)
    )
    select (select count(*) from best where top > v_best) + 1,
           v_best,
           (select count(*) from best);
end;
$$;

-- Übersicht für das Supabase-Dashboard (Table Editor -> iischi_party_rangliste):
-- bestes Ergebnis pro Spieler mit E-Mail, sortiert nach Platz.
-- Nur im Dashboard sichtbar, das Spiel hat keinen Zugriff.
create or replace view public.iischi_party_rangliste with (security_invoker = true) as
  with best as (
    select distinct on (lower(s.email)) s.name, s.email, s.score, s.accuracy, s.best_combo, s.created_at
    from public.iischi_party_alle_spiele s
    order by lower(s.email), s.score desc, s.created_at asc
  ),
  runs as (
    select lower(s.email) as player, count(*) as laeufe from public.iischi_party_alle_spiele s group by lower(s.email)
  )
  select rank() over (order by b.score desc) as platz,
         b.name, b.email, b.score as punkte, b.accuracy as treffer_prozent,
         b.best_combo as beste_serie, r.laeufe, b.created_at as datum
  from best b join runs r on r.player = lower(b.email)
  order by b.score desc, b.created_at asc;

revoke all on table public.iischi_party_rangliste from anon, authenticated;
revoke all on function public.iischi_party_board(integer) from public;
revoke all on function public.iischi_party_submit(text, text, integer, integer, integer) from public;
grant execute on function public.iischi_party_board(integer) to anon, authenticated;
grant execute on function public.iischi_party_submit(text, text, integer, integer, integer) to anon, authenticated;

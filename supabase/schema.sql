-- Dano: baza za testno aplikacijo.
-- Ena "družina" (space) ima člane; vsi zapisi aplikacije (živali, urniki, odmerki,
-- vpisi, člani, povabila) so v tabeli docs, dostop pa omejujejo pravila RLS:
-- vsak vidi in ureja samo zapise družin, katerih član je.

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.space_members (
  space uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'druzina' check (role in ('lastnik', 'druzina', 'skrbnik')),
  joined_at timestamptz not null default now(),
  primary key (space, user_id)
);
create index space_members_user_idx on public.space_members (user_id);

create table public.docs (
  space uuid not null references public.spaces(id) on delete cascade,
  col text not null check (col in ('pets', 'schedules', 'doses', 'events', 'members', 'invites')),
  id text not null check (char_length(id) between 1 and 200),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (space, col, id)
);

-- Ali je prijavljeni uporabnik član družine?
create function public.is_member(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.space_members m where m.space = s and m.user_id = auth.uid());
$$;
create function public.is_member_txt(s text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.space_members m where m.space::text = s and m.user_id = auth.uid());
$$;

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.docs enable row level security;

create policy spaces_read on public.spaces for select to authenticated using (public.is_member(id));
create policy members_read on public.space_members for select to authenticated using (public.is_member(space));
create policy docs_read on public.docs for select to authenticated using (public.is_member(space));
create policy docs_insert on public.docs for insert to authenticated with check (public.is_member(space));
create policy docs_update on public.docs for update to authenticated using (public.is_member(space)) with check (public.is_member(space));
create policy docs_delete on public.docs for delete to authenticated using (public.is_member(space));

-- Nova družina za uporabnika, ki še ni v nobeni.
create function public.create_space() returns uuid
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.spaces (owner) values (auth.uid()) returning id into s;
  insert into public.space_members (space, user_id, role) values (s, auth.uid(), 'lastnik');
  return s;
end $$;

-- Podatki o povabilu za nekoga, ki še ni član (ime živali, vloga).
create function public.invite_info(code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('space', i.space, 'invite', i.data, 'pet', p.data, 'petId', p.id)
  from public.docs i
  left join public.docs p on p.space = i.space and p.col = 'pets' and p.id = i.data->>'petId'
  where i.col = 'invites' and i.id = code and auth.uid() is not null
  limit 1;
$$;

-- Sprejem povabila: doda uporabnika med člane.
create function public.join_space(code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into i from public.docs d where d.col = 'invites' and d.id = code limit 1;
  if not found then raise exception 'invite_not_found'; end if;
  if coalesce((i.data->>'cancelled')::boolean, false) then raise exception 'invite_cancelled'; end if;
  if i.data->>'usedBy' is not null and i.data->>'usedBy' <> auth.uid()::text then raise exception 'invite_used'; end if;
  insert into public.space_members (space, user_id, role)
  values (i.space, auth.uid(), case when i.data->>'role' = 'skrbnik' then 'skrbnik' else 'druzina' end)
  on conflict (space, user_id) do nothing;
  return i.space;
end $$;

-- Lastnik odstrani člana (izgubi dostop do zapisov).
create function public.remove_member(s uuid, uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.spaces sp where sp.id = s and sp.owner = auth.uid()) then raise exception 'not_owner'; end if;
  if uid = auth.uid() then raise exception 'cannot_remove_owner'; end if;
  delete from public.space_members m where m.space = s and m.user_id = uid;
end $$;

revoke execute on function public.is_member(uuid), public.is_member_txt(text), public.create_space(), public.invite_info(text), public.join_space(text), public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_member_txt(text), public.create_space(), public.invite_info(text), public.join_space(text), public.remove_member(uuid, uuid) to authenticated;

-- Spremembe v živo (kljukice se pokažejo vsem družinskim članom takoj).
alter publication supabase_realtime add table public.docs;

-- Fotografije: javno branje prek naključnega imena, nalaganje samo za člane družine.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dano', 'dano', true, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create policy dano_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'dano' and public.is_member_txt((storage.foldername(name))[1]));
create policy dano_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dano' and public.is_member_txt((storage.foldername(name))[1]));

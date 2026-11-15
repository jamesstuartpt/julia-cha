-- ==================================================================
-- Julia — Baby Shower
-- Base de dados das reservas de presentes
-- ==================================================================
-- COMO USAR:
--   1. Onde? No painel do Supabase: SQL Editor > New query.
--   2. Cole todo este ficheiro e clique em "Run".
--   3. Depois copie o Project URL e a chave "anon public"
--      (Project Settings > API Keys) para o ficheiro config.js.
--   4. Voltar a correr este ficheiro é seguro (usa IF NOT EXISTS).
-- ==================================================================


-- ------------------------------------------------------------------
-- Tabela de reservas: UMA LINHA POR PRESENTE reservado.
-- Todos os nomes das pessoas que participam na oferta ficam juntos
-- no campo "nome" (ex: "Ana, João e Maria"). O nome do presente vem
-- do ficheiro presentes.json (não se repete aqui).
-- ------------------------------------------------------------------
create table if not exists public.reservas (
  id           uuid primary key default gen_random_uuid(),
  presente_id  text not null,
  nome         text not null check (char_length(trim(nome)) between 1 and 600),
  mensagem     text check (char_length(mensagem) <= 200),
  criado_em    timestamptz not null default now()
);

-- NOTA: a função RPC "reservar_presente" garante que cada presente só
-- aparece numa linha. A verificação de "já está reservado" é feita
-- dentro da própria função, com bloqueio (pg_advisory_xact_lock).


-- ------------------------------------------------------------------
-- Row Level Security
-- Sem servidor, quem fala com a base de dados é o browser do convidado.
-- Estas regras garantem que ele apenas pode RESERVAR (INSERT).
--
-- IMPORTANTE — privacidade:
-- NÃO existe policy de SELECT na tabela. Isso é intencional: se existisse,
-- qualquer pessoa conseguia ler os nomes de quem reservou o quê.
-- O público lê em vez disso a vista "reservas_publicas", que mostra
-- apenas os presentes já reservados.
-- ------------------------------------------------------------------
alter table public.reservas enable row level security;

drop policy if exists "lista visivel para todos" on public.reservas;

-- A policy de INSERT abaixo foi retirada: a partir de agora as reservas
-- só entram pela função RPC "reservar_presente" (definida no fim deste
-- ficheiro), que é atómica e impede duplicados. Manter aqui o create
-- policy abriria a tabela a INSERTs diretos.
-- drop policy if exists "qualquer convidado pode reservar" on public.reservas;
-- create policy "qualquer convidado pode reservar"
--   on public.reservas for insert
--   to anon
--   with check (true);

-- Nota: não existem policies de UPDATE nem DELETE para o anon,
-- por isso essas operações são recusadas automaticamente.


-- ------------------------------------------------------------------
-- Migração: se já correrares uma versão anterior deste ficheiro,
-- remove o índice único de presente_id e alarga o limite do nome
-- (antes 120 caracteres, agora 600, para caber vários nomes na mesma
-- linha). Seguro de correr várias vezes.
-- ------------------------------------------------------------------
drop index if exists public.reservas_presente_id_unico;
alter table public.reservas drop constraint if exists reservas_nome_check;
alter table public.reservas
  add constraint reservas_nome_check
  check (char_length(trim(nome)) between 1 and 600);


-- ------------------------------------------------------------------
-- Vista pública: só diz QUAIS presentes estão reservados, nunca por quem.
-- Usa DISTINCT porque um presente pode ter várias linhas (uma por pessoa
-- do grupo), mas o público só precisa de saber se está reservado ou não.
-- ------------------------------------------------------------------
drop view if exists public.reservas_publicas;
create view public.reservas_publicas as
  select distinct presente_id from public.reservas;

grant select on public.reservas_publicas to anon, authenticated;


-- ------------------------------------------------------------------
-- Sugestões de presentes que não estão na lista.
-- O público só pode inserir sugestões; não há policy de SELECT.
-- ------------------------------------------------------------------
create table if not exists public.sugestoes_presentes (
  id         uuid primary key default gen_random_uuid(),
  sugestao   text not null check (char_length(trim(sugestao)) between 1 and 300),
  nome       text check (char_length(nome) <= 80),
  criado_em  timestamptz not null default now()
);

alter table public.sugestoes_presentes enable row level security;

drop policy if exists "qualquer convidado pode sugerir presente" on public.sugestoes_presentes;
create policy "qualquer convidado pode sugerir presente"
  on public.sugestoes_presentes for insert
  to anon
  with check (true);


-- ------------------------------------------------------------------
-- Tabela de presenças: UMA LINHA POR PESSOA.
-- O convidado escreve o nome (ou nomes) de quem vai ao baby shower.
-- O site separa os nomes automaticamente e insere uma linha por cada
-- um, para que seja fácil contar quantas pessoas vêm.
-- Estes nomes NUNCA são mostrados no site público (não há policy de
-- SELECT), por isso só vocês os veem no painel do Supabase.
-- ------------------------------------------------------------------
create table if not exists public.presencas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (char_length(trim(nome)) between 1 and 120),
  criado_em  timestamptz not null default now()
);

-- Migração: se a tabela já existir com a coluna antiga "nomes",
-- renomeia para "nome" e ajusta a restrição. Seguro de correr.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'presencas'
      and column_name = 'nomes'
  ) then
    alter table public.presencas rename column nomes to nome;
    alter table public.presencas drop constraint if exists presencas_nomes_check;
    alter table public.presencas
      add constraint presencas_nome_check
      check (char_length(trim(nome)) between 1 and 120);
  end if;
end $$;

-- Migração: adiciona a coluna de restrição alimentar, se ainda não existir.
-- Seguro de correr várias vezes.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'presencas'
      and column_name = 'restricao'
  ) then
    alter table public.presencas add column restricao text;
  end if;
end $$;

alter table public.presencas enable row level security;

drop policy if exists "qualquer convidado pode confirmar presenca" on public.presencas;
create policy "qualquer convidado pode confirmar presenca"
  on public.presencas for insert
  to anon
  with check (true);

-- Sem policy de SELECT nem de UPDATE/DELETE: o público apenas regista
-- a presença e nunca consegue ler ou alterar as confirmações dos outros.


-- ------------------------------------------------------------------
-- Reserva atómica de um presente.
-- O site chama esta função (e não faz INSERT direto na tabela) para
-- evitar que duas pessoas reservem o mesmo presente ao mesmo tempo.
--
-- Como funciona:
--   1. Bloqueia o presente com pg_advisory_xact_lock (baseado no id),
--      para que outra reserva do mesmo presente tenha de esperar.
--   2. Verifica se o presente já tem reservas. Se sim, devolve false.
--   3. Se não, insere UMA ÚNICA LINHA com todos os nomes juntos
--      (ex: "Ana, João e Maria") e devolve true.
--
-- security definer: a função corre com as permissões do dono da tabela,
-- por isso consegue inserir mesmo que o anon não tenha policy de INSERT.
-- set search_path = public: evita ambiguidades de schema.
-- ------------------------------------------------------------------

-- Remove a versão antiga da função (que recebia um array de nomes e
-- criava uma linha por pessoa), para não ficar duplicada.
drop function if exists public.reservar_presente(text, text[], text);

create or replace function public.reservar_presente(
  p_presente_id text, p_nome text, p_mensagem text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_presente_id));
  if exists (select 1 from reservas where presente_id = p_presente_id) then
    return false;
  end if;
  insert into reservas (presente_id, nome, mensagem)
  values (p_presente_id, p_nome, p_mensagem);
  return true;
end $$;

-- Retira permissões de execução para o público e concede apenas ao anon.
revoke all on function public.reservar_presente(text, text, text) from public;
grant execute on function public.reservar_presente(text, text, text) to anon;

-- Remove a policy de INSERT direto na tabela, se por acaso existir de
-- uma versão anterior deste ficheiro. A partir de agora só se reserva
-- pela função RPC acima.
drop policy if exists "qualquer convidado pode reservar" on public.reservas;


-- ------------------------------------------------------------------
-- Para verem QUEM reservou o quê e QUEM confirmou presença:
--   Table Editor > reservas  |  presencas
--   (só vocês, com o vosso login, têm acesso)
--
-- Depois de testar, descomente as linhas abaixo para começar do zero:
-- ------------------------------------------------------------------
-- delete from public.reservas;
-- delete from public.presencas;

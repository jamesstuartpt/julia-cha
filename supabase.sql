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
-- Tabela de reservas: UMA LINHA POR RESERVA.
-- Cada linha guarda quantas unidades foram reservadas num presente
-- (campo "quantidade") — por isso um mesmo presente pode ter várias
-- linhas, de pessoas diferentes, enquanto houver unidades disponíveis.
-- Todos os nomes das pessoas que participam na oferta ficam juntos
-- no campo "nome" (ex: "Ana, João e Maria"). O nome do presente e o
-- total de unidades vêm do ficheiro presentes.json.
-- ------------------------------------------------------------------
create table if not exists public.reservas (
  id           uuid primary key default gen_random_uuid(),
  presente_id  text not null,
  nome         text not null check (char_length(trim(nome)) between 1 and 600),
  mensagem     text check (char_length(mensagem) <= 200),
  quantidade   integer not null default 1 check (quantidade >= 1),
  criado_em    timestamptz not null default now()
);

-- Migração: adiciona a coluna de quantidade a bases de dados criadas
-- por versões anteriores (em que cada presente só podia ter uma linha).
-- Seguro de correr várias vezes.
alter table public.reservas add column if not exists quantidade integer not null default 1;

-- NOTA: a função RPC "reservar_presente" soma as quantidades já
-- reservadas, compara com o total do presente e só aceita a reserva
-- se ainda houver unidades suficientes (com bloqueio, pg_advisory_xact_lock).


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
-- Vista pública: diz QUANTAS unidades de cada presente estão reservadas,
-- nunca por quem. A soma agrupa todas as linhas do mesmo presente.
--
-- security_invoker = false: a vista corre com as permissões do DONO da
-- vista (postgres), contornando o RLS da tabela "reservas".
-- ------------------------------------------------------------------
drop view if exists public.reservas_publicas;
create view public.reservas_publicas with (security_invoker = false) as
  select presente_id, sum(quantidade)::integer as quantidade
  from public.reservas
  group by presente_id;

grant select on public.reservas_publicas to anon, authenticated;


-- ------------------------------------------------------------------
-- Função pública de reserva: devolve, por presente, quantas unidades
-- já estão reservadas (nunca quem reservou).
--
-- security definer: a função corre com as permissões do dono da tabela,
-- por isso consegue ler a tabela "reservas" mesmo que o anon não tenha
-- policy de SELECT. Esta é a forma mais fiável de contornar o RLS.
-- O site usa esta função (via RPC) em vez da vista, para garantir que
-- os presentes aparecem com a contagem certa após um refresh.
-- ------------------------------------------------------------------
drop function if exists public.get_reservas_publicas();
create or replace function public.get_reservas_publicas()
returns table (presente_id text, quantidade integer)
language sql
security definer
set search_path = public
as $$
  select r.presente_id, sum(r.quantidade)::integer as quantidade
  from public.reservas r
  group by r.presente_id;
$$;

revoke all on function public.get_reservas_publicas() from public;
grant execute on function public.get_reservas_publicas() to anon, authenticated;


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
-- Reserva atómica de unidades de um presente.
-- O site chama esta função (e não faz INSERT direto na tabela) para
-- evitar que duas pessoas reservem as mesmas unidades ao mesmo tempo.
--
-- Como funciona:
--   1. Bloqueia o presente com pg_advisory_xact_lock (baseado no id),
--      para que outra reserva do mesmo presente tenha de esperar.
--   2. Soma as unidades já reservadas desse presente.
--   3. Se a nova reserva ultrapassar o total (p_total), devolve -1.
--   4. Caso contrário, insere UMA LINHA com os nomes juntos
--      (ex: "Ana, João e Maria") e a quantidade reservada, e devolve
--      o total de unidades reservadas nesse presente após a inserção.
--
-- p_total é o número total de unidades do presente (vem do
-- presentes.json), para a função saber quantas ainda estão livres.
--
-- security definer: a função corre com as permissões do dono da tabela,
-- por isso consegue inserir mesmo que o anon não tenha policy de INSERT.
-- set search_path = public: evita ambiguidades de schema.
-- ------------------------------------------------------------------

-- Remove versões antigas da função (uma recebia um array de nomes e
-- outra reservava o presente inteiro), para não ficarem duplicadas.
drop function if exists public.reservar_presente(text, text[], text);
drop function if exists public.reservar_presente(text, text, text);

create or replace function public.reservar_presente(
  p_presente_id text, p_nome text, p_mensagem text,
  p_quantidade integer, p_total integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservado integer;
  v_qtd       integer := greatest(coalesce(p_quantidade, 1), 1);
  v_total     integer := greatest(coalesce(p_total, 1), 1);
begin
  perform pg_advisory_xact_lock(hashtext(p_presente_id));

  select coalesce(sum(quantidade), 0) into v_reservado
    from reservas
   where presente_id = p_presente_id;

  -- Já não há unidades suficientes para esta reserva.
  if v_reservado + v_qtd > v_total then
    return -1;
  end if;

  insert into reservas (presente_id, nome, mensagem, quantidade)
  values (p_presente_id, p_nome, p_mensagem, v_qtd);

  return v_reservado + v_qtd;
end $$;

-- Retira permissões de execução para o público e concede apenas ao anon.
revoke all on function public.reservar_presente(text, text, text, integer, integer) from public;
grant execute on function public.reservar_presente(text, text, text, integer, integer) to anon;

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

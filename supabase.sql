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
-- Tabela de reservas: uma linha por presente reservado.
-- O nome do presente vem do ficheiro presentes.json (não se repete aqui),
-- por isso pode editar a lista sem tocar na base de dados.
-- ------------------------------------------------------------------
create table if not exists public.reservas (
  id           uuid primary key default gen_random_uuid(),
  presente_id  text not null,
  nome         text not null check (char_length(trim(nome)) between 1 and 40),
  mensagem     text check (char_length(mensagem) <= 200),
  criado_em    timestamptz not null default now()
);

-- Um presente só pode ser reservado uma vez.
create unique index if not exists reservas_presente_id_unico
  on public.reservas (presente_id);


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

drop policy if exists "qualquer convidado pode reservar" on public.reservas;
create policy "qualquer convidado pode reservar"
  on public.reservas for insert
  to anon
  with check (true);

-- Nota: não existem policies de UPDATE nem DELETE para o anon,
-- por isso essas operações são recusadas automaticamente.


-- ------------------------------------------------------------------
-- Vista pública: só diz QUAIS presentes estão reservados, nunca por quem.
-- Corre com as permissões do dono da tabela, por isso consegue ler as
-- linhas sem expor as colunas "nome" e "mensagem".
-- ------------------------------------------------------------------
drop view if exists public.reservas_publicas;
create view public.reservas_publicas as
  select presente_id from public.reservas;

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

alter table public.presencas enable row level security;

drop policy if exists "qualquer convidado pode confirmar presenca" on public.presencas;
create policy "qualquer convidado pode confirmar presenca"
  on public.presencas for insert
  to anon
  with check (true);

-- Sem policy de SELECT nem de UPDATE/DELETE: o público apenas regista
-- a presença e nunca consegue ler ou alterar as confirmações dos outros.


-- ------------------------------------------------------------------
-- Para verem QUEM reservou o quê e QUEM confirmou presença:
--   Table Editor > reservas  |  presencas
--   (só vocês, com o vosso login, têm acesso)
--
-- Depois de testar, descomente as linhas abaixo para começar do zero:
-- ------------------------------------------------------------------
-- delete from public.reservas;
-- delete from public.presencas;

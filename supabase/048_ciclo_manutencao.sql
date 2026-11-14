-- =====================================================================
-- 048 - Ciclo de manutenção: a IA acompanha quem fez o serviço (pedido do Victor, 14/11/2026)
--
-- Depois de um serviço da linha (ex.: "Mega hair"), a IA manda alôs em dias contados a partir do
-- atendimento: cuidado (3 dias), meio (32), janela (50) e passou (63). Aproveita tudo do alô combinado
-- (supabase/028): cada alô do ciclo é uma linha em retornos_combinados com origem = 'ciclo', criada só
-- no dia em que vence. O fluxo "IA - Retorno combinado" chama n8n_alos_para_chamar, que primeiro cria as
-- linhas do dia e depois devolve o mesmo que n8n_retornos_para_chamar, com a origem e a etapa.
--
-- Só soma: colunas novas com valor padrão e funções novas. Nenhuma função antiga muda.
-- Ligar na loja: empresas.config.ciclo = {"ligado": true, "so_para": [], "linhas": ["Mega hair"],
--   "desde": "2026-11-01", "atraso_dias": 3,
--   "etapas": [{"etapa":"cuidado","dias":3},{"etapa":"meio","dias":32},{"etapa":"janela","dias":50},{"etapa":"passou","dias":63}]}
-- Sem config.ciclo.ligado, não cria nada. O envio também depende de config.retorno.ligado (hora, limite por dia).
-- =====================================================================

alter table retornos_combinados add column if not exists origem text not null default 'combinado';
alter table retornos_combinados add column if not exists etapa text;
alter table retornos_combinados add column if not exists agendamento_id uuid references agendamentos(id) on delete set null;
create unique index if not exists retornos_combinados_ciclo on retornos_combinados (agendamento_id, etapa) where origem = 'ciclo';

-- Cria os alôs do ciclo que vencem hoje (ou venceram há até atraso_dias). Uma vez por atendimento e etapa.
-- Conta só o ÚLTIMO serviço da linha de cada cliente: uma manutenção nova recomeça o ciclo.
-- Não cria: cliente excluída, fora do so_para, com horário marcado (menos na etapa "cuidado"), ou com outro
-- alô ainda esperando para sair.
create or replace function n8n_ciclo_gerar(p_empresa_id uuid, p_agora timestamptz default now())
returns integer language sql set search_path = public as $$
  with cfg as (
    select coalesce(e.config->'ciclo', '{}'::jsonb) as c, (p_agora at time zone 'America/Cuiaba')::date as hoje
      from empresas e where e.id = p_empresa_id
  ), base as (
    select distinct on (f.cliente_id) f.cliente_id, f.agendamento_id, f.servico_nome,
           (f.inicio at time zone 'America/Cuiaba')::date as dia
      from servicos_feitos f cross join cfg
     where f.empresa_id = p_empresa_id
       and f.linha in (select jsonb_array_elements_text(coalesce(cfg.c->'linhas', '["Mega hair"]'::jsonb)))
     order by f.cliente_id, f.inicio desc
  ), etapas as (
    select x->>'etapa' as etapa, (x->>'dias')::int as dias
      from cfg cross join jsonb_array_elements(coalesce(cfg.c->'etapas',
        '[{"etapa":"cuidado","dias":3},{"etapa":"meio","dias":32},{"etapa":"janela","dias":50},{"etapa":"passou","dias":63}]'::jsonb)) x
  ), novos as (
    insert into retornos_combinados (empresa_id, cliente_id, data, assunto, origem, etapa, agendamento_id)
    select p_empresa_id, b.cliente_id, b.dia + t.dias,
           'acompanhamento de ' || coalesce(b.servico_nome, 'serviço') || ' feito em ' || to_char(b.dia, 'DD/MM') || ' (' || t.dias || ' dias)',
           'ciclo', t.etapa, b.agendamento_id
      from base b
      cross join etapas t
      cross join cfg
      join clientes c on c.id = b.cliente_id
     where coalesce((cfg.c->>'ligado')::boolean, false)
       and (jsonb_array_length(coalesce(cfg.c->'so_para', '[]'::jsonb)) = 0 or (cfg.c->'so_para') ? c.telefone)
       and b.dia >= coalesce((cfg.c->>'desde')::date, date '2000-01-01')
       and t.etapa is not null and t.dias is not null
       and b.dia + t.dias <= cfg.hoje
       and b.dia + t.dias >= cfg.hoje - coalesce((cfg.c->>'atraso_dias')::int, 3)
       and not ('sistema:excluida' = any (c.etiquetas))
       and (t.etapa = 'cuidado' or not exists (select 1 from agendamentos f
              where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > p_agora))
       and not exists (select 1 from retornos_combinados r
              where r.cliente_id = c.id and r.situacao = 'aguardando'
                and r.data >= cfg.hoje - coalesce((cfg.c->>'atraso_dias')::int, 3))
    on conflict do nothing
    returning 1
  )
  select count(*)::int from novos
$$;

-- O que o fluxo chama a cada 10 min: cria os alôs do ciclo do dia e devolve quem chamar agora
-- (as mesmas regras do alô combinado: horário do salão, limite por dia, espaço entre envios, sem horário
-- marcado, a dona não falou depois, a cliente não escreveu hoje, sem pausa).
create or replace function n8n_alos_para_chamar(p_empresa_id uuid, p_agora timestamptz default now())
returns table (retorno_id uuid, cliente_id uuid, nome text, telefone text, data date, assunto text,
               combinado_em timestamptz, resumo_ia text, historico jsonb,
               origem text, etapa text, servico text, feito_em date, dias_desde integer)
language plpgsql set search_path = public as $$
begin
  perform n8n_ciclo_gerar(p_empresa_id, p_agora);
  return query
    select r.retorno_id, r.cliente_id, r.nome, r.telefone, r.data, r.assunto, r.combinado_em, r.resumo_ia, r.historico,
           rc.origem, rc.etapa, s.nome,
           (a.inicio at time zone 'America/Cuiaba')::date,
           ((p_agora at time zone 'America/Cuiaba')::date - (a.inicio at time zone 'America/Cuiaba')::date)::int
      from n8n_retornos_para_chamar(p_empresa_id, p_agora) r
      join retornos_combinados rc on rc.id = r.retorno_id
      left join agendamentos a on a.id = rc.agendamento_id
      left join servicos s on s.id = a.servico_id;
end $$;

revoke all on function n8n_ciclo_gerar(uuid, timestamptz) from public, anon, authenticated;
revoke all on function n8n_alos_para_chamar(uuid, timestamptz) from public, anon, authenticated;
grant execute on function n8n_ciclo_gerar(uuid, timestamptz) to service_role;
grant execute on function n8n_alos_para_chamar(uuid, timestamptz) to service_role;

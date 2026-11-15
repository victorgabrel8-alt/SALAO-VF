-- Funções novas (só soma), usadas pelas lojas em que a dona repassa o agendamento sem dizer o serviço
-- (Caroline e Loja Teste; ver n8n/demo-agente/assistente-marcar.js). A Gleide continua na v2 e no reagendar de sempre.

-- marcar: serviço dito -> igual à v2; sem serviço -> o da última vez dessa cliente; sem histórico -> reserva o bloco,
-- anota "Serviço não confirmado." e devolve as opções numeradas para a assistente perguntar.
create or replace function public.n8n_assistente_marcar_horario_c(
  p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid, p_telefone text, p_nome text, p_servico text,
  p_inicio timestamptz, p_observacoes text default null, p_forcar boolean default false,
  p_duracao_min integer default null, p_bloco_min integer default 150)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v jsonb; v_cli uuid; v_tel text; v_ult text; v_plac text; v_ops jsonb;
begin
  if nullif(trim(coalesce(p_servico, '')), '') is not null then
    return n8n_assistente_marcar_horario_v2(p_empresa_id, p_pedido_por, p_cliente_id, p_telefone, p_nome, p_servico, p_inicio, p_observacoes, p_forcar, p_duracao_min)
      || jsonb_build_object('servico_origem', 'dito_pela_dona');
  end if;
  v_cli := p_cliente_id;
  if v_cli is null then
    v_tel := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
    if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
    select id into v_cli from clientes where empresa_id = p_empresa_id and telefone = v_tel;
  end if;
  if v_cli is not null then
    select s.nome into v_ult
      from agendamentos a join servicos s on s.id = a.servico_id
     where a.empresa_id = p_empresa_id and a.cliente_id = v_cli and a.status <> 'cancelado' and s.ativo
       and coalesce(a.observacoes, '') !~* 'servi[cç]o n[aã]o confirmado'
     order by a.inicio desc limit 1;
  end if;
  if v_ult is not null then
    v := n8n_assistente_marcar_horario_v2(p_empresa_id, p_pedido_por, p_cliente_id, p_telefone, p_nome, v_ult, p_inicio, p_observacoes, p_forcar, p_duracao_min);
    return v || jsonb_build_object('servico_origem', 'ultima_vez',
      'diga', 'Ela não disse o serviço: marquei com o da última vez dessa cliente (' || v_ult || '). Diga isso em uma frase e que, se for outro, é só avisar. Não pergunte mais nada.');
  end if;
  select nome into v_plac from servicos where empresa_id = p_empresa_id and ativo
   order by (lower(nome) = 'manicure') desc, coalesce(duracao_min, 60), nome limit 1;
  if v_plac is null then raise exception 'qual o serviço?'; end if;
  select jsonb_agg(n || ' ' || nome order by n) into v_ops
    -- os serviços mais marcados da loja primeiro; os outros ela escreve pelo nome
    from (select row_number() over (order by (select count(*) from agendamentos a where a.servico_id = s.id and a.status <> 'cancelado' and coalesce(a.observacoes, '') !~* 'servi[cç]o n[aã]o confirmado') desc, s.nome) n, s.nome
            from servicos s where s.empresa_id = p_empresa_id and s.ativo) t
   where n <= 7;
  v := n8n_assistente_marcar_horario_v2(p_empresa_id, p_pedido_por, p_cliente_id, p_telefone, p_nome, v_plac, p_inicio,
         concat_ws(' ', nullif(trim(coalesce(p_observacoes, '')), ''), 'Serviço não confirmado.', case when p_duracao_min is not null then 'Tempo estipulado pela dona.' end), p_forcar, coalesce(p_duracao_min, p_bloco_min));
  return (v - 'servico') || jsonb_build_object('servico', 'NÃO CONFIRMADO', 'servico_origem', 'nao_confirmado', 'opcoes', v_ops,
    'diga', 'Diga que marcou (dia e hora) e pergunte "Qual o serviço?" mostrando estas opções numeradas, todas numa linha só. Não diga nome de serviço como se estivesse marcado. Quando ela responder com o número ou o nome, use reagendar com o mesmo dia e hora, forcar = sim e o serviço escolhido: o tempo passa a ser o desse serviço.');
end $$;
revoke all on function public.n8n_assistente_marcar_horario_c(uuid, text, uuid, text, text, text, timestamptz, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.n8n_assistente_marcar_horario_c(uuid, text, uuid, text, text, text, timestamptz, text, boolean, integer, integer) to service_role;

-- reagendar: horário que estava como "não confirmado" (sem tempo estipulado pela dona) e recebe o serviço passa a ter o
-- tempo desse serviço; nos outros casos, trocar o serviço não mexe no tempo já reservado. A marca sai das observações.
create or replace function public.n8n_assistente_reagendar_confirma(
  p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid, p_inicio timestamptz, p_servico text, p_forcar boolean)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v jsonb; v_dur interval; v_fim timestamptz; v_marca boolean; v_tem_serv boolean := nullif(trim(coalesce(p_servico, '')), '') is not null;
begin
  select fim - inicio, (coalesce(observacoes, '') ~* 'servi[cç]o n[aã]o confirmado' and coalesce(observacoes, '') !~* '(dura[cç][aã]o acertada|tempo estipulado)') into v_dur, v_marca
    from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  v := n8n_assistente_reagendar(p_empresa_id, p_pedido_por, p_agendamento_id, p_inicio, p_servico, p_forcar);
  if v_dur is not null and v_dur > interval '0' and not (coalesce(v_marca, false) and v_tem_serv) then
    update agendamentos set fim = inicio + v_dur
     where id = p_agendamento_id and empresa_id = p_empresa_id and fim is distinct from inicio + v_dur
    returning fim into v_fim;
    if v_fim is not null and v ? 'ate' then
      v := jsonb_set(v, '{ate}', to_jsonb(to_char(v_fim at time zone 'America/Cuiaba', 'HH24:MI')));
    end if;
  end if;
  if v_tem_serv then
    update agendamentos
       set observacoes = nullif(trim(regexp_replace(observacoes, '\s*servi[cç]o n[aã]o confirmado[^.\n]*\.?', '', 'gi')), '')
     where id = p_agendamento_id and empresa_id = p_empresa_id and observacoes ~* 'servi[cç]o n[aã]o confirmado';
  end if;
  return v;
end $$;
revoke all on function public.n8n_assistente_reagendar_confirma(uuid, text, uuid, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.n8n_assistente_reagendar_confirma(uuid, text, uuid, timestamptz, text, boolean) to service_role;

-- =====================================================================
-- 013_assistente_faz_tudo.sql — precisa do 012 aplicado antes
-- A Gleide faz pelo WhatsApp, conversando com a assistente, o que hoje ela faz no app:
--   - horarios_livres     quais horários estão livres num dia (mesmas regras do app)
--   - marcar_horario      novo horário (cliente da lista ou nova, com nome e telefone)
--   - reagendar           muda o horário (e o serviço, se ela quiser) do MESMO agendamento
--                         ("reagenda a das 14:00 para 14:40, atrasei")
--   - atrasar_agenda      empurra todos os horários do dia a partir de uma hora (atraso que se arrasta)
--   - concluir            ✓ do app: realizado, com o serviço feito e os serviços a mais (atendimento_servicos)
--   - chegou              botão "Chegou" (a IA não cobra atraso de quem chegou)
--   - excluir_horario     horário lançado por engano
--   - bloquear_dias / desbloquear_dias   dias sem atender (empresas.config.bloqueios)
--   - pausar_ia           pausa / reativa a IA para uma cliente (12 h, igual ao app)
--   - editar_cliente      nome e aniversário
--   - avisar_cliente      a IA manda pelo número do salão: aviso de horário mudado ou o pedido
--                         de remarcação do app (imprevisto da Gleide). Grava o contato ANTES de
--                         enviar: o eco da mensagem cai no "alô do CRM" e não pausa a IA da cliente.
-- Também: agenda_do_dia mostra fim, "chegou" e os serviços a mais; buscar_cliente traz os
-- horários marcados (com agendamento_id) para reagendar pelo nome.
-- Regras do horário iguais às do app (crm/lib/horarios.ts): salão aberto no dia, dia não
-- bloqueado, dentro do expediente contando a duração, fora do almoço e sem encavalar.
-- A assistente pode passar por cima (forcar) depois de mostrar o problema e a Gleide confirmar.
-- Só service_role (o n8n), sempre conferindo o número de quem pediu (assistente_autorizado).
-- =====================================================================

-- O aviso da Gleide para a cliente (horário mudado, cancelado...): a IA de atendimento lê na ficha
alter table contatos drop constraint contatos_tipo_check;
alter table contatos add constraint contatos_tipo_check
  check (tipo in ('retorno', 'reativacao', 'aniversario', 'outro', 'remarcacao', 'falta', 'vaga', 'atraso', 'aviso'));

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------

-- Sem acento, minúsculo, espaços simples ("Manutenção – Queratina" -> "manutencao - queratina")
create or replace function assistente_normalizar(p_texto text)
returns text language sql immutable as $$
  select trim(regexp_replace(
    translate(lower(coalesce(p_texto, '')), 'áàâãäéèêëíìîïóòôõöúùûüç–—', 'aaaaaeeeeiiiiooooouuuuc--'),
    '\s+', ' ', 'g'))
$$;

-- "hoje às 14:00", "amanhã às 09:30", "sex, 24/10 às 14:00"
create or replace function assistente_quando(p_ts timestamptz)
returns text language sql stable set search_path = public as $$
  select case (p_ts at time zone 'America/Cuiaba')::date - hoje_cuiaba()
           when 0 then 'hoje' when 1 then 'amanhã' when -1 then 'ontem'
           else (array['dom','seg','ter','qua','qui','sex','sáb'])[extract(dow from p_ts at time zone 'America/Cuiaba')::int + 1]
                || ', ' || to_char(p_ts at time zone 'America/Cuiaba', 'DD/MM') end
         || ' às ' || to_char(p_ts at time zone 'America/Cuiaba', 'HH24:MI')
$$;

-- "sexta-feira, 24 de outubro" (o mesmo do app, crm/lib/formato.ts formatarDiaLongo)
create or replace function assistente_dia_longo(p_dia date)
returns text language sql immutable as $$
  select (array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'])[extract(dow from p_dia)::int + 1]
         || ', ' || extract(day from p_dia)::int || ' de '
         || (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[extract(month from p_dia)::int]
$$;

-- O serviço pelo nome que a Gleide falou ("manutenção queratina", "progressiva"). Sem acento, todas
-- as palavras precisam aparecer no nome. Nenhum ou mais de um: erro com a lista, para a assistente perguntar.
create or replace function assistente_achar_servico(p_empresa_id uuid, p_nome text)
returns uuid language plpgsql stable set search_path = public as $$
declare v_busca text := assistente_normalizar(p_nome); v_ids uuid[]; v_lista text;
begin
  if v_busca = '' then raise exception 'qual serviço?'; end if;
  select array_agg(id order by length(nome)) into v_ids from servicos
   where empresa_id = p_empresa_id and ativo and assistente_normalizar(nome) = v_busca;
  if v_ids is null then
    select array_agg(id order by length(nome)) into v_ids from servicos s
     where s.empresa_id = p_empresa_id and s.ativo
       and not exists (select 1 from regexp_split_to_table(v_busca, '[^a-z0-9]+') w
                        where length(w) >= 3 and position(w in assistente_normalizar(s.nome)) = 0)
       and exists (select 1 from regexp_split_to_table(v_busca, '[^a-z0-9]+') w where length(w) >= 3);
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
  if v_ids is not null then
    select string_agg(nome, '; ' order by nome) into v_lista from servicos where id = any (v_ids);
    raise exception 'serviço "%" pode ser: %. Pergunte qual.', p_nome, v_lista;
  end if;
  select string_agg(nome, '; ' order by nome) into v_lista from servicos where empresa_id = p_empresa_id and ativo;
  raise exception 'não achei o serviço "%". Os serviços do salão são: %', p_nome, v_lista;
end $$;

-- Pode marcar um horário a atender aqui? null = pode; senão, o motivo (igual ao conferirHorario do app).
-- p_ignorar: o próprio horário que está mudando (não conta como ocupado).
create or replace function assistente_conferir_horario(p_empresa_id uuid, p_inicio timestamptz, p_duracao_min int,
                                                       p_ignorar uuid default null)
returns text language plpgsql stable set search_path = public as $$
declare
  v_config jsonb; v_dia date := (p_inicio at time zone 'America/Cuiaba')::date;
  v_bloq jsonb; v_faixa text; v_abre int; v_fecha int; v_ini int; v_fim int;
  v_alm_ini int; v_alm_fim int; v_choques text;
begin
  select config into v_config from empresas where id = p_empresa_id;
  select b into v_bloq from jsonb_array_elements(coalesce(v_config->'bloqueios', '[]'::jsonb)) b
   where v_dia between (b->>'de')::date and greatest((b->>'de')::date, (b->>'ate')::date) limit 1;
  if v_bloq is not null then
    return 'Esse dia está marcado como sem atender' || coalesce(' (' || nullif(v_bloq->>'motivo', '') || ')', '') || '.';
  end if;
  if v_config ? 'horario_funcionamento' then
    v_faixa := v_config->'horario_funcionamento'->>(array['dom','seg','ter','qua','qui','sex','sab'])[extract(dow from v_dia)::int + 1];
    if v_faixa is null or v_faixa = '' then return 'O salão não abre nesse dia.'; end if;
  else
    v_faixa := '09:00-18:00';
  end if;
  v_abre  := extract(epoch from split_part(v_faixa, '-', 1)::time)::int / 60;
  v_fecha := extract(epoch from split_part(v_faixa, '-', 2)::time)::int / 60;
  v_ini := extract(epoch from (p_inicio at time zone 'America/Cuiaba')::time)::int / 60;
  v_fim := v_ini + greatest(p_duracao_min, 1);
  if v_ini < v_abre or v_fim > v_fecha then
    return format('Fora do horário do salão nesse dia (%s às %s), contando a duração do serviço (%s min).',
                  split_part(v_faixa, '-', 1), split_part(v_faixa, '-', 2), p_duracao_min);
  end if;
  -- almoço: config.almoco = null desliga; sem nada salvo vale 11:00 às 13:00 (crm/lib/almoco.ts)
  if not (v_config ? 'almoco' and jsonb_typeof(v_config->'almoco') = 'null') then
    v_alm_ini := extract(epoch from coalesce(nullif(v_config->'almoco'->>'inicio', ''), '11:00')::time)::int / 60;
    v_alm_fim := extract(epoch from coalesce(nullif(v_config->'almoco'->>'fim', ''), '13:00')::time)::int / 60;
    if v_ini < v_alm_fim and v_fim > v_alm_ini then
      return format('Esse horário cai no almoço (%s às %s).',
                    coalesce(v_config->'almoco'->>'inicio', '11:00'), coalesce(v_config->'almoco'->>'fim', '13:00'));
    end if;
  end if;
  select string_agg(format('%s (%s às %s)', coalesce(c.nome, 'outra cliente'),
                           to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI'),
                           to_char(coalesce(a.fim, a.inicio + interval '1 hour') at time zone 'America/Cuiaba', 'HH24:MI')),
                    ', ' order by a.inicio)
    into v_choques
    from agendamentos a join clientes c on c.id = a.cliente_id
   where a.empresa_id = p_empresa_id and a.status in ('agendado', 'realizado')
     and a.id is distinct from p_ignorar
     and a.inicio < p_inicio + make_interval(mins => greatest(p_duracao_min, 1))
     and coalesce(a.fim, a.inicio + interval '1 hour') > p_inicio;
  if v_choques is not null then return 'Encavala com ' || v_choques || '.'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------

-- Horários livres de um dia para um serviço (de 30 em 30 min), como o "Novo horário" do app
create or replace function n8n_assistente_horarios_livres(p_empresa_id uuid, p_pedido_por text, p_data date default null,
                                                          p_servico text default null, p_ignorar uuid default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_dia date := coalesce(p_data, hoje_cuiaba()); v_serv uuid; v_dur int := 60; v_nome text; v_livres text[]; v_motivo text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if nullif(trim(coalesce(p_servico, '')), '') is not null then
    v_serv := assistente_achar_servico(p_empresa_id, p_servico);
    select coalesce(duracao_min, 60), nome into v_dur, v_nome from servicos where id = v_serv;
  elsif p_ignorar is not null then
    select coalesce(s.duracao_min, extract(epoch from a.fim - a.inicio)::int / 60, 60), s.nome into v_dur, v_nome
      from agendamentos a left join servicos s on s.id = a.servico_id where a.id = p_ignorar and a.empresa_id = p_empresa_id;
  end if;
  select array_agg(to_char(t at time zone 'America/Cuiaba', 'HH24:MI') order by t) into v_livres
    from generate_series((v_dia + time '06:00') at time zone 'America/Cuiaba',
                         (v_dia + time '22:00') at time zone 'America/Cuiaba', interval '30 minutes') g(t)
   where t > now() and assistente_conferir_horario(p_empresa_id, t, v_dur, p_ignorar) is null;
  if v_livres is null then
    v_motivo := assistente_conferir_horario(p_empresa_id, (v_dia + time '12:00') at time zone 'America/Cuiaba', 1, p_ignorar);
  end if;
  return jsonb_build_object('dia', assistente_dia_longo(v_dia), 'servico', v_nome, 'duracao_min', v_dur,
                            'livres', coalesce(to_jsonb(v_livres), '[]'::jsonb),
                            'obs', case when v_livres is null then coalesce(v_motivo, 'nenhum horário livre nesse dia') end);
end $$;

-- agenda_do_dia (006) com fim, "chegou" e os serviços a mais
create or replace function n8n_assistente_agenda_do_dia(p_empresa_id uuid, p_pedido_por text, p_data date default null)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  return (select coalesce(jsonb_agg(x order by x.inicio), '[]'::jsonb) from (
    select a.id as agendamento_id, a.cliente_id, c.nome, right(c.telefone, 4) as tel_final,
           to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI') as hora,
           to_char(coalesce(a.fim, a.inicio + interval '1 hour') at time zone 'America/Cuiaba', 'HH24:MI') as fim,
           a.inicio, s.nome as servico, a.status, a.valor, a.chegou_em is not null as chegou,
           (select jsonb_agg(s2.nome) from atendimento_servicos x join servicos s2 on s2.id = x.servico_id
             where x.agendamento_id = a.id) as servicos_a_mais
      from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id
     where a.empresa_id = p_empresa_id
       and (a.inicio at time zone 'America/Cuiaba')::date = coalesce(p_data, hoje_cuiaba())
       and not ('sistema:excluida' = any (c.etiquetas))) x);
end $$;

-- buscar_cliente (006) com os horários marcados de hoje em diante (para reagendar pelo nome)
create or replace function n8n_assistente_buscar_cliente(p_empresa_id uuid, p_pedido_por text, p_busca text)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select c.id as cliente_id, c.nome, c.telefone, c.status, f.etapa, c.ultima_visita, c.proximo_agendamento,
           f.pre_resumo, f.pre_tecnica_interesse, f.valor_orcado, f.data_proximo_passo, c.observacoes, c.aniversario, c.ia_pausada,
           (select jsonb_agg(jsonb_build_object('agendamento_id', a.id, 'quando', assistente_quando(a.inicio), 'servico', s.nome)
                             order by a.inicio)
              from agendamentos a left join servicos s on s.id = a.servico_id
             where a.cliente_id = c.id and a.status = 'agendado'
               and (a.inicio at time zone 'America/Cuiaba')::date >= hoje_cuiaba()) as horarios_marcados
      from clientes_status c join funil_clientes f on f.cliente_id = c.id
     where c.empresa_id = p_empresa_id
       and (assistente_normalizar(c.nome) like '%' || assistente_normalizar(p_busca) || '%'
            or (regexp_replace(p_busca, '\D', '', 'g') <> '' and c.telefone like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'))
     order by c.ultima_mensagem desc nulls last limit 8) x);
end $$;

-- ---------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------

-- Novo horário a atender. Cliente da lista (p_cliente_id) ou nova (telefone + nome; se o telefone já
-- existe, usa a ficha que existe e a tira de "excluídas", como o app).
create or replace function n8n_assistente_marcar_horario(p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid,
  p_telefone text, p_nome text, p_servico text, p_inicio timestamptz, p_observacoes text default null,
  p_forcar boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare v_serv uuid; v_dur int; v_serv_nome text; v_cliente clientes%rowtype; v_tel text; v_problemas text[] := '{}';
        v_motivo text; v_ja text; v_id uuid; v_fim timestamptz;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_inicio is null then raise exception 'qual dia e hora?'; end if;
  if p_inicio < now() then
    raise exception 'esse horário já passou. Atendimento que já aconteceu: use registrar_atendimento';
  end if;
  v_serv := assistente_achar_servico(p_empresa_id, p_servico);
  select coalesce(duracao_min, 60), nome into v_dur, v_serv_nome from servicos where id = v_serv;

  if p_cliente_id is not null then
    select * into v_cliente from clientes where id = p_cliente_id and empresa_id = p_empresa_id;
    if not found then raise exception 'cliente % não encontrada', p_cliente_id; end if;
  else
    v_tel := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
    if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
    if v_tel !~ '^55[0-9]{10,11}$' then raise exception 'telefone inválido: peça com DDD, ex.: 66 99999-8888'; end if;
    select * into v_cliente from clientes where empresa_id = p_empresa_id and telefone = v_tel;
    if not found and nullif(trim(coalesce(p_nome, '')), '') is null then raise exception 'qual o nome da cliente?'; end if;
  end if;

  if not p_forcar then
    v_motivo := assistente_conferir_horario(p_empresa_id, p_inicio, v_dur);
    if v_motivo is not null then v_problemas := v_problemas || v_motivo; end if;
    if v_cliente.id is not null then
      select string_agg(format('%s (%s, agendamento_id=%s)', assistente_quando(a.inicio), coalesce(s.nome, 'sem serviço'), a.id), '; ')
        into v_ja
        from agendamentos a left join servicos s on s.id = a.servico_id
       where a.cliente_id = v_cliente.id and a.status = 'agendado' and a.inicio > now();
      if v_ja is not null then
        v_problemas := v_problemas || ('Ela já tem horário marcado: ' || v_ja || '. Se for para mudar esse, use reagendar.');
      end if;
    end if;
    if array_length(v_problemas, 1) > 0 then
      raise exception 'NÃO MARQUEI: % Conte à Gleide; se ela quiser assim mesmo, chame de novo com forcar = sim.',
        array_to_string(v_problemas, ' ');
    end if;
  end if;

  if v_cliente.id is null then
    insert into clientes (empresa_id, telefone, nome) values (p_empresa_id, v_tel, trim(p_nome)) returning * into v_cliente;
  elsif 'sistema:excluida' = any (v_cliente.etiquetas) then
    update clientes set etiquetas = array_remove(etiquetas, 'sistema:excluida') where id = v_cliente.id;
  end if;

  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, status, origem, observacoes)
  values (p_empresa_id, v_cliente.id, v_serv, p_inicio, 'agendado', 'manual', nullif(trim(coalesce(p_observacoes, '')), ''))
  returning id, fim into v_id, v_fim;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, v_cliente.id, 'assistente', 'n8n_assistente_marcar_horario', 'agendamentos', v_id,
          jsonb_build_object('servico_id', v_serv, 'inicio', p_inicio, 'forcar', p_forcar), p_pedido_por);

  return jsonb_build_object('agendamento_id', v_id, 'cliente_id', v_cliente.id, 'nome', v_cliente.nome,
    'tel_final', right(v_cliente.telefone, 4), 'servico', v_serv_nome, 'quando', assistente_quando(p_inicio),
    'ate', to_char(v_fim at time zone 'America/Cuiaba', 'HH24:MI'));
end $$;

-- Reagendar o MESMO agendamento (como o "Reagendar" do app): novo horário, volta para "agendado" e
-- anota "Reagendado de DD/MM às HH:MM" nas observações. p_servico troca o serviço junto (opcional).
create or replace function n8n_assistente_reagendar(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
  p_inicio timestamptz, p_servico text default null, p_forcar boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_serv uuid; v_dur int; v_motivo text; v_nome text; v_tel text; v_fim timestamptz; v_serv_nome text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  if ag.status = 'realizado' then raise exception 'esse horário já foi concluído (realizado): não dá para reagendar'; end if;
  if p_inicio is null then raise exception 'para que horário?'; end if;
  if p_inicio < now() - interval '5 minutes' then raise exception 'esse horário já passou'; end if;
  v_serv := case when nullif(trim(coalesce(p_servico, '')), '') is not null
                 then assistente_achar_servico(p_empresa_id, p_servico) else ag.servico_id end;
  select s.duracao_min into v_dur from servicos s where s.id = v_serv;
  v_dur := coalesce(v_dur, extract(epoch from ag.fim - ag.inicio)::int / 60, 60);

  if not p_forcar then
    v_motivo := assistente_conferir_horario(p_empresa_id, p_inicio, v_dur, ag.id);
    if v_motivo is not null then
      raise exception 'NÃO REAGENDEI: % Conte à Gleide; se ela quiser assim mesmo, chame de novo com forcar = sim.', v_motivo;
    end if;
  end if;

  update agendamentos
     set inicio = p_inicio,
         fim = case when v_serv is null then p_inicio + make_interval(mins => v_dur) end,
         servico_id = v_serv,
         status = 'agendado',
         observacoes = case when ag.inicio is distinct from p_inicio
                            then concat_ws(E'\n', nullif(ag.observacoes, ''),
                                           'Reagendado de ' || to_char(ag.inicio at time zone 'America/Cuiaba', 'DD/MM') ||
                                           ' às ' || to_char(ag.inicio at time zone 'America/Cuiaba', 'HH24:MI'))
                            else ag.observacoes end
   where id = ag.id
  returning fim into v_fim;

  select c.nome, c.telefone into v_nome, v_tel from clientes c where c.id = ag.cliente_id;
  select nome into v_serv_nome from servicos where id = v_serv;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, ag.cliente_id, 'assistente', 'n8n_assistente_reagendar', 'agendamentos', ag.id,
          jsonb_build_object('de', ag.inicio, 'para', p_inicio, 'servico_id', v_serv, 'status_antes', ag.status, 'forcar', p_forcar), p_pedido_por);

  return jsonb_build_object('agendamento_id', ag.id, 'nome', v_nome, 'tel_final', right(v_tel, 4), 'servico', v_serv_nome,
    'de', assistente_quando(ag.inicio), 'para', assistente_quando(p_inicio),
    'ate', to_char(v_fim at time zone 'America/Cuiaba', 'HH24:MI'));
end $$;

-- Atraso que se arrasta: empurra (ou adianta, minutos negativos) todos os horários a atender do dia a
-- partir de uma hora, mantendo a duração de cada um. Sem conferir encavalamento (a ordem não muda);
-- avisa se algum passar do fim do expediente ou cair no almoço. Não abre vaga (o horário não ficou livre).
create or replace function n8n_assistente_atrasar_agenda(p_empresa_id uuid, p_pedido_por text, p_minutos int,
  p_a_partir text default null, p_data date default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_dia date := coalesce(p_data, hoje_cuiaba()); v_de timestamptz; v_ids uuid[]; v_movidos jsonb; v_avisos text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_minutos is null or p_minutos = 0 or abs(p_minutos) > 240 then raise exception 'quantos minutos? (de 5 a 240)'; end if;
  v_de := case when nullif(trim(coalesce(p_a_partir, '')), '') is not null
               then (v_dia + p_a_partir::time) at time zone 'America/Cuiaba'
               else greatest(now() - interval '1 hour', v_dia::timestamp at time zone 'America/Cuiaba') end;

  select array_agg(a.id order by a.inicio) into v_ids from agendamentos a
   where a.empresa_id = p_empresa_id and a.status = 'agendado' and a.inicio >= v_de
     and (a.inicio at time zone 'America/Cuiaba')::date = v_dia;
  if v_ids is null then raise exception 'não tem horário a atender nesse dia a partir das %', to_char(v_de at time zone 'America/Cuiaba', 'HH24:MI'); end if;

  select jsonb_agg(jsonb_build_object('agendamento_id', a.id, 'nome', c.nome, 'tel_final', right(c.telefone, 4),
           'de', to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI'),
           'para', to_char((a.inicio + make_interval(mins => p_minutos)) at time zone 'America/Cuiaba', 'HH24:MI')) order by a.inicio)
    into v_movidos
    from agendamentos a join clientes c on c.id = a.cliente_id where a.id = any (v_ids);

  update agendamentos a
     set inicio = a.inicio + make_interval(mins => p_minutos),
         fim = coalesce(a.fim, a.inicio + interval '1 hour') + make_interval(mins => p_minutos),
         observacoes = concat_ws(E'\n', nullif(a.observacoes, ''),
                                 'Reagendado de ' || to_char(a.inicio at time zone 'America/Cuiaba', 'DD/MM') ||
                                 ' às ' || to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI'))
   where a.id = any (v_ids);
  -- o trigger do 010 abre vaga quando um horário (a mais de 3 h) sai do lugar: aqui ninguém liberou nada
  delete from vagas where agendamento_id = any (v_ids) and criado_em = now() and motivo = 'remarcado';

  select string_agg(format('%s às %s: %s', c.nome, to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI'),
                           assistente_conferir_horario(p_empresa_id, a.inicio, (extract(epoch from a.fim - a.inicio) / 60)::int, a.id)), '; ')
    into v_avisos
    from agendamentos a join clientes c on c.id = a.cliente_id
   where a.id = any (v_ids)
     and assistente_conferir_horario(p_empresa_id, a.inicio, (extract(epoch from a.fim - a.inicio) / 60)::int, a.id) !~ '^Encavala';

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  select p_empresa_id, a.cliente_id, 'assistente', 'n8n_assistente_atrasar_agenda', 'agendamentos', a.id,
         jsonb_build_object('minutos', p_minutos), p_pedido_por
    from agendamentos a where a.id = any (v_ids);

  return jsonb_build_object('movidos', v_movidos, 'atencao', v_avisos);
end $$;

-- O ✓ do app pela conversa: realizado, com o serviço feito (se foi outro no lugar do marcado: fica
-- anotado "Marcado era: ...", como no app) e os serviços a mais no MESMO horário (atendimento_servicos, 010).
-- p_extras: nomes separados por vírgula ou "+".
create or replace function n8n_assistente_concluir(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
  p_servico text default null, p_extras text default null, p_valor numeric default null)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_serv uuid; v_extra uuid; v_nome text; v_extras text[] := '{}'; v_antigo text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  v_serv := case when nullif(trim(coalesce(p_servico, '')), '') is not null
                 then assistente_achar_servico(p_empresa_id, p_servico) else ag.servico_id end;
  select nome into v_antigo from servicos where id = ag.servico_id;

  update agendamentos
     set status = 'realizado', servico_id = v_serv, valor = coalesce(p_valor, valor),
         observacoes = case when v_serv is distinct from ag.servico_id
                            then concat_ws(E'\n', nullif(ag.observacoes, ''), 'Marcado era: ' || coalesce(v_antigo, 'serviço não informado'))
                            else ag.observacoes end
   where id = ag.id;

  for v_nome in select trim(x) from regexp_split_to_table(coalesce(p_extras, ''), '\s*[,+]\s*|\s+e\s+') x where trim(x) <> '' loop
    v_extra := assistente_achar_servico(p_empresa_id, v_nome);
    if v_extra is distinct from v_serv then
      insert into atendimento_servicos (empresa_id, agendamento_id, servico_id)
      values (p_empresa_id, ag.id, v_extra) on conflict (agendamento_id, servico_id) do nothing;
      v_extras := v_extras || (select nome from servicos where id = v_extra);
    end if;
  end loop;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, ag.cliente_id, 'assistente', 'n8n_assistente_concluir', 'agendamentos', ag.id,
          jsonb_build_object('servico_id', v_serv, 'extras', v_extras, 'valor', p_valor, 'status_antes', ag.status), p_pedido_por);

  return jsonb_build_object('agendamento_id', ag.id, 'status', 'realizado',
    'servico', (select nome from servicos where id = v_serv), 'servicos_a_mais', to_jsonb(v_extras));
end $$;

-- "Chegou" (o botão do Início do app, 012): a IA não cobra atraso de quem chegou. p_chegou = false desfaz.
create or replace function n8n_assistente_chegou(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
  p_chegou boolean default true)
returns jsonb language plpgsql set search_path = public as $$
declare v_cliente uuid;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  update agendamentos set chegou_em = case when p_chegou then coalesce(chegou_em, now()) end
   where id = p_agendamento_id and empresa_id = p_empresa_id
  returning cliente_id into v_cliente;
  if v_cliente is null then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, v_cliente, 'assistente', 'n8n_assistente_chegou', 'agendamentos', p_agendamento_id,
          jsonb_build_object('chegou', p_chegou), p_pedido_por);
  return jsonb_build_object('agendamento_id', p_agendamento_id, 'chegou', p_chegou);
end $$;

-- Excluir de vez um horário lançado por engano (para quem desmarcou, o certo é cancelar).
-- O que foi apagado fica guardado no registros_ia.
create or replace function n8n_assistente_excluir_horario(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_nome text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  delete from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id returning * into ag;
  if ag.id is null then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  select nome into v_nome from clientes where id = ag.cliente_id;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, ag.cliente_id, 'assistente', 'n8n_assistente_excluir_horario', 'agendamentos', ag.id, to_jsonb(ag), p_pedido_por);
  return jsonb_build_object('excluido', v_nome || ' ' || assistente_quando(ag.inicio));
end $$;

-- Dias sem atender (viagem, folga, curso): o app e a IA de atendimento param de oferecer horário.
-- Devolve os horários já marcados nesses dias, para a Gleide decidir (pedir para remarcarem).
create or replace function n8n_assistente_bloquear_dias(p_empresa_id uuid, p_pedido_por text, p_de date, p_ate date default null,
  p_motivo text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_ate date := greatest(p_de, coalesce(p_ate, p_de)); v_marcados jsonb;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_de is null then raise exception 'qual dia?'; end if;
  update empresas
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{bloqueios}',
                            coalesce(config->'bloqueios', '[]'::jsonb) ||
                            jsonb_build_array(jsonb_build_object('de', p_de, 'ate', v_ate, 'motivo', nullif(trim(coalesce(p_motivo, '')), ''))))
   where id = p_empresa_id;
  select jsonb_agg(jsonb_build_object('agendamento_id', a.id, 'nome', c.nome, 'quando', assistente_quando(a.inicio)) order by a.inicio)
    into v_marcados
    from agendamentos a join clientes c on c.id = a.cliente_id
   where a.empresa_id = p_empresa_id and a.status = 'agendado'
     and (a.inicio at time zone 'America/Cuiaba')::date between p_de and v_ate;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_bloquear_dias', 'empresas', p_empresa_id,
          jsonb_build_object('de', p_de, 'ate', v_ate, 'motivo', p_motivo), p_pedido_por);
  return jsonb_build_object('bloqueado', case when v_ate = p_de then assistente_dia_longo(p_de)
                                              else 'de ' || assistente_dia_longo(p_de) || ' a ' || assistente_dia_longo(v_ate) end,
                            'horarios_marcados_nesses_dias', coalesce(v_marcados, '[]'::jsonb));
end $$;

-- Tira o bloqueio que cobre o dia
create or replace function n8n_assistente_desbloquear_dias(p_empresa_id uuid, p_pedido_por text, p_dia date)
returns jsonb language plpgsql set search_path = public as $$
declare v_tirados jsonb;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  select jsonb_agg(b) into v_tirados from empresas e, jsonb_array_elements(coalesce(e.config->'bloqueios', '[]'::jsonb)) b
   where e.id = p_empresa_id and p_dia between (b->>'de')::date and greatest((b->>'de')::date, (b->>'ate')::date);
  if v_tirados is null then raise exception 'não tem bloqueio nesse dia'; end if;
  update empresas e
     set config = jsonb_set(e.config, '{bloqueios}', coalesce((
           select jsonb_agg(b) from jsonb_array_elements(e.config->'bloqueios') b
            where not (p_dia between (b->>'de')::date and greatest((b->>'de')::date, (b->>'ate')::date))), '[]'::jsonb))
   where e.id = p_empresa_id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_desbloquear_dias', 'empresas', p_empresa_id,
          jsonb_build_object('tirados', v_tirados), p_pedido_por);
  return jsonb_build_object('desbloqueado', v_tirados);
end $$;

-- ---------------------------------------------------------------------
-- Cliente
-- ---------------------------------------------------------------------

-- Pausar (12 h, motivo 'manual', igual ao app) ou reativar a IA para uma cliente
create or replace function n8n_assistente_pausar_ia(p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid,
  p_pausar boolean default true, p_horas int default 12)
returns jsonb language plpgsql set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  update clientes
     set ia_pausada_ate = case when p_pausar then now() + make_interval(hours => least(greatest(coalesce(p_horas, 12), 1), 720)) end,
         motivo_pausa   = case when p_pausar then 'manual' end
   where id = p_cliente_id and empresa_id = p_empresa_id;
  if not found then raise exception 'cliente % não encontrada', p_cliente_id; end if;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, p_cliente_id, 'assistente', 'n8n_assistente_pausar_ia', 'clientes', p_cliente_id,
          jsonb_build_object('pausar', p_pausar, 'horas', p_horas), p_pedido_por);
  return jsonb_build_object('cliente_id', p_cliente_id, 'ia', case when p_pausar then 'pausada' else 'atendendo' end);
end $$;

-- Nome e aniversário (vazio = não muda)
create or replace function n8n_assistente_editar_cliente(p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid,
  p_nome text default null, p_aniversario date default null)
returns jsonb language plpgsql set search_path = public as $$
declare c clientes%rowtype;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  update clientes
     set nome = coalesce(nullif(trim(coalesce(p_nome, '')), ''), nome), aniversario = coalesce(p_aniversario, aniversario)
   where id = p_cliente_id and empresa_id = p_empresa_id
  returning * into c;
  if c.id is null then raise exception 'cliente % não encontrada', p_cliente_id; end if;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, p_cliente_id, 'assistente', 'n8n_assistente_editar_cliente', 'clientes', p_cliente_id,
          jsonb_build_object('nome', p_nome, 'aniversario', p_aniversario), p_pedido_por);
  return jsonb_build_object('cliente_id', c.id, 'nome', c.nome, 'aniversario', to_char(c.aniversario, 'DD/MM'));
end $$;

-- Mensagem para a cliente pelo número do salão (o n8n envia com o que esta função devolver).
--   p_tipo 'aviso'      horário mudado / cancelado (sem p_texto: monta o aviso do último "Reagendado de")
--   p_tipo 'remarcacao' o "Pedir para remarcar" do app: imprevisto da Gleide, a IA de atendimento remarca
--                       quando a cliente responder (ALÔ DE REMARCAÇÃO) e o horário não vira vaga (010)
-- O contato é gravado ANTES do envio: o eco da mensagem bate com ele e não pausa a IA da cliente.
create or replace function n8n_assistente_avisar_cliente(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
  p_tipo text default 'aviso', p_texto text default null)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; c clientes%rowtype; v_nome text; v_texto text := nullif(trim(coalesce(p_texto, '')), '');
        v_de text; v_contato uuid;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_tipo not in ('aviso', 'remarcacao') then raise exception 'tipo deve ser aviso ou remarcacao'; end if;
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  select * into c from clientes where id = ag.cliente_id;
  v_nome := nullif(split_part(trim(coalesce(c.nome, '')), ' ', 1), '');

  if p_tipo = 'remarcacao' then
    if ag.status <> 'agendado' or ag.inicio < now() then raise exception 'esse horário não está mais a atender'; end if;
    v_texto := coalesce(v_texto, 'Oi' || coalesce(', ' || v_nome, '') || '! Tudo bem? Tive um imprevisto e não vou conseguir te atender ' ||
      lower(assistente_dia_longo((ag.inicio at time zone 'America/Cuiaba')::date)) || ' às ' ||
      to_char(ag.inicio at time zone 'America/Cuiaba', 'HH24:MI') || '. Vamos remarcar? Me diz qual dia fica melhor pra você 💛');
  elsif v_texto is null then
    v_de := substring(ag.observacoes from '.*Reagendado de (\d\d/\d\d às \d\d:\d\d)');
    if v_de is null or ag.status <> 'agendado' then raise exception 'diga o texto do aviso (texto)'; end if;
    v_texto := 'Oi' || coalesce(', ' || v_nome, '') || '! Tudo bem? Precisei ajustar seu horário: em vez de ' ||
      case when left(v_de, 5) = to_char(ag.inicio at time zone 'America/Cuiaba', 'DD/MM') then substring(v_de from 10) else v_de end ||
      ', vai ser ' || assistente_quando(ag.inicio) || ' 💛 Fica bom pra você? Se não der, me avisa que eu vejo outro horário.';
  end if;

  insert into contatos (empresa_id, cliente_id, tipo, canal, mensagem, agendamento_id, horario_original)
  values (p_empresa_id, c.id, p_tipo, 'ia', v_texto, ag.id, ag.inicio)
  returning id into v_contato;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, c.id, 'assistente', 'n8n_assistente_avisar_cliente', 'contatos', v_contato,
          jsonb_build_object('agendamento_id', ag.id, 'tipo', p_tipo, 'mensagem', v_texto), p_pedido_por);
  return jsonb_build_object('contato_id', v_contato, 'telefone', c.telefone, 'nome', c.nome, 'mensagem', v_texto);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'assistente_achar_servico(uuid, text)',
    'assistente_conferir_horario(uuid, timestamptz, int, uuid)',
    'n8n_assistente_horarios_livres(uuid, text, date, text, uuid)',
    'n8n_assistente_agenda_do_dia(uuid, text, date)',
    'n8n_assistente_buscar_cliente(uuid, text, text)',
    'n8n_assistente_marcar_horario(uuid, text, uuid, text, text, text, timestamptz, text, boolean)',
    'n8n_assistente_reagendar(uuid, text, uuid, timestamptz, text, boolean)',
    'n8n_assistente_atrasar_agenda(uuid, text, int, text, date)',
    'n8n_assistente_concluir(uuid, text, uuid, text, text, numeric)',
    'n8n_assistente_chegou(uuid, text, uuid, boolean)',
    'n8n_assistente_excluir_horario(uuid, text, uuid)',
    'n8n_assistente_bloquear_dias(uuid, text, date, date, text)',
    'n8n_assistente_desbloquear_dias(uuid, text, date)',
    'n8n_assistente_pausar_ia(uuid, text, uuid, boolean, int)',
    'n8n_assistente_editar_cliente(uuid, text, uuid, text, date)',
    'n8n_assistente_avisar_cliente(uuid, text, uuid, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

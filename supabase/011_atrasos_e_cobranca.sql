-- =====================================================================
-- 011_atrasos_e_cobranca.sql — precisa do 010 aplicado antes
-- 1) Atraso: a cliente não chegou ao horário. A IA chama sozinha, no máximo 2 vezes:
--      +5 min  "Seu horário era às 14:00, está a caminho?"
--      +25 min "Conseguiu vir? Se hoje não der, vejo outro horário"
--    Sem resposta 10 min depois da 2ª: a IA PERGUNTA à Gleide "veio ou libera?"
--    (pendência 'atraso_confirmar'). Silêncio nunca libera: a cliente pode estar na
--    cadeira e a Gleide ocupada. Só com o "libera" (ou "não veio") dela a assistente
--    usa liberar_horario: o horário vira 'faltou', o resto dele vira uma vaga
--    (motivo 'atraso') e a IA oferece para adiantar quem vem depois no mesmo dia
--    (uma cliente por vez, 10 min cada). "veio" = realizado, nada é liberado.
--    Liberou e a cliente apareceu depois de outra já ter adiantado: a Gleide recebe
--    o aviso de conflito (n8n_conflitos_atraso) e decide.
--    Não chama: quem já falou com o salão desde 1 h antes do horário (avisou que
--    atrasou, que está chegando...), IA pausada, cliente excluída.
--    Quem foi chamada pelo atraso não recebe também o "sentimos sua falta".
--    Ligar: empresas.config.atrasos = {"chamar": true, "so_para": []}
--      (so_para com números = só esses; vazio = todas). A vaga só é oferecida
--      com config.vagas.oferecer ligado (010).
-- 2) Cobrança da Gleide (assistente): o disparo passa a ser de 1 em 1 h e a mesma
--    pendência é perguntada por 2 h no máximo (na hora, +1 h e +2 h); depois para.
-- =====================================================================

alter table contatos drop constraint contatos_tipo_check;
alter table contatos add constraint contatos_tipo_check
  check (tipo in ('retorno', 'reativacao', 'aniversario', 'outro', 'remarcacao', 'falta', 'vaga', 'atraso'));

alter table vagas drop constraint vagas_motivo_check;
alter table vagas add constraint vagas_motivo_check check (motivo in ('cancelado', 'remarcado', 'atraso'));

-- ---------------------------------------------------------------------
-- Atraso: quem chamar agora (etapa 1 = +5 min, etapa 2 = +25 min)
-- As janelas (até +20 e até +45 min) evitam mandar mensagem velha se o n8n ficou parado.
-- ---------------------------------------------------------------------
create or replace function n8n_atrasos_para_chamar(p_empresa_id uuid)
returns table (agendamento_id uuid, cliente_id uuid, nome text, telefone text, inicio timestamptz, servico text, etapa int)
language sql stable set search_path = public as $$
  select a.id, c.id, c.nome, c.telefone, a.inicio, s.nome, x.feitas + 1
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    join empresas e on e.id = a.empresa_id
    left join servicos s on s.id = a.servico_id
    cross join lateral (select count(*)::int as feitas, max(ct.criado_em) as ultima
                          from contatos ct where ct.agendamento_id = a.id and ct.tipo = 'atraso') x
   where a.empresa_id = p_empresa_id
     and a.status = 'agendado'
     and coalesce((e.config->'atrasos'->>'chamar')::boolean, false)
     and (jsonb_array_length(coalesce(e.config->'atrasos'->'so_para', '[]'::jsonb)) = 0
          or (e.config->'atrasos'->'so_para') ? c.telefone)
     and ((x.feitas = 0 and a.inicio <= now() - interval '5 minutes' and a.inicio > now() - interval '20 minutes')
          or (x.feitas = 1 and a.inicio <= now() - interval '25 minutes' and a.inicio > now() - interval '45 minutes'
              and x.ultima <= now() - interval '15 minutes'))
     -- ela (ou a Gleide pelo celular) já falou na conversa perto do horário: não cobra
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor in ('cliente', 'humano')
                      and m.criado_em > a.inicio - interval '1 hour')
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < now())
   order by a.inicio
$$;

-- Depois de enviar: grava o contato (a resposta dela cai na IA com o "ALÔ DE ATRASO") e a mensagem
create or replace function n8n_registrar_chamada_atraso(p_empresa_id uuid, p_agendamento_id uuid, p_mensagem text, p_wa_message_id text default null)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_contato uuid;
begin
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  insert into contatos (empresa_id, cliente_id, tipo, canal, mensagem, agendamento_id, horario_original)
  values (p_empresa_id, ag.cliente_id, 'atraso', 'ia', p_mensagem, ag.id, ag.inicio)
  returning id into v_contato;
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, wa_message_id)
  values (p_empresa_id, ag.cliente_id, 'saida', 'ia', 'texto', p_mensagem, p_wa_message_id)
  on conflict (wa_message_id) do nothing;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, ag.cliente_id, 'atendimento', 'n8n_registrar_chamada_atraso', 'contatos', v_contato,
          jsonb_build_object('agendamento_id', ag.id, 'mensagem', p_mensagem));
  return jsonb_build_object('contato_id', v_contato);
end $$;

-- ---------------------------------------------------------------------
-- Pendências da Gleide (igual ao 006) + 'atraso_confirmar': não respondeu às 2 mensagens
-- (10 min depois da 2ª) e o horário ainda não acabou. A Gleide diz se ela veio ou se libera.
-- Depois do fim do horário, o mesmo agendamento vira 'atendimento_sem_status' (mesmo pendencia_id,
-- então a cobrança de 2 h continua contando de onde parou).
-- ---------------------------------------------------------------------
create or replace view pendencias_gleide with (security_invoker = true) as
select p.*,
       (select max(r.criado_em) from registros_ia r
         where r.acao = 'perguntou' and r.registro_id = p.pendencia_id) as perguntado_em
from (
  select 'avaliacao_sem_resultado' as tipo, av.id as pendencia_id, av.empresa_id, av.cliente_id,
         c.nome, c.telefone, av.id as avaliacao_id, ag.id as agendamento_id, ag.inicio,
         s.nome as servico, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join agendamentos ag on ag.id = av.agendamento_id
    join clientes c on c.id = av.cliente_id
    left join servicos s on s.id = ag.servico_id
   where av.resultado = 'pendente'
     and ag.status in ('agendado', 'realizado')
     and coalesce(ag.fim, ag.inicio) < now() - interval '30 minutes'
  union all
  select 'atendimento_sem_status', ag.id, ag.empresa_id, ag.cliente_id,
         c.nome, c.telefone, null, ag.id, ag.inicio,
         s.nome, null, null
    from agendamentos ag
    join clientes c on c.id = ag.cliente_id
    left join servicos s on s.id = ag.servico_id
   where ag.status = 'agendado'
     and coalesce(ag.fim, ag.inicio) < now()
     and (ag.inicio at time zone 'America/Cuiaba')::date >= hoje_cuiaba() - 1
     and not exists (select 1 from avaliacoes av where av.agendamento_id = ag.id)
  union all
  select 'atraso_confirmar', ag.id, ag.empresa_id, ag.cliente_id,
         c.nome, c.telefone, null, ag.id, ag.inicio,
         s.nome, null, null
    from agendamentos ag
    join clientes c on c.id = ag.cliente_id
    left join servicos s on s.id = ag.servico_id
   where ag.status = 'agendado'
     and coalesce(ag.fim, ag.inicio) >= now()
     and ag.inicio < now()
     and (select count(*) from contatos ct where ct.agendamento_id = ag.id and ct.tipo = 'atraso') >= 2
     and not exists (select 1 from contatos ct where ct.agendamento_id = ag.id and ct.tipo = 'atraso'
                      and (ct.resultado <> 'pendente' or ct.criado_em > now() - interval '10 minutes'))
     and not exists (select 1 from mensagens m where m.cliente_id = ag.cliente_id and m.autor in ('cliente', 'humano')
                      and m.criado_em > ag.inicio - interval '1 hour')
  union all
  select 'pensando_vencido', av.id, av.empresa_id, av.cliente_id,
         c.nome, c.telefone, av.id, null, null,
         av.tecnica_indicada, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join clientes c on c.id = av.cliente_id
   where av.resultado = 'pensando'
     and av.data_proximo_passo <= hoje_cuiaba()
) p;

-- Atrasos para perguntar à Gleide agora (o n8n de faltas pergunta na hora; a cobrança de 1 em 1 h repete)
create or replace function n8n_atrasos_para_confirmar(p_empresa_id uuid)
returns setof pendencias_gleide language sql stable set search_path = public as $$
  select * from pendencias_gleide
   where empresa_id = p_empresa_id and tipo = 'atraso_confirmar' and perguntado_em is null
   order by inicio
$$;

-- ASSISTENTE: a Gleide disse "libera" / "não veio" para uma cliente atrasada. Marca 'faltou' e abre a
-- vaga com o resto do horário: começa na próxima meia hora depois de 40 min (tempo de a outra cliente
-- chegar; o remarcar aceita a partir de 30 min) e só existe se sobrar pelo menos 30 min.
create or replace function n8n_assistente_liberar_horario(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_ini timestamptz; v_fim timestamptz; v_vaga uuid; v_oferece boolean;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then
    raise exception 'número % não autorizado', p_pedido_por;
  end if;
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  if ag.status <> 'agendado' then
    raise exception 'esse horário não está mais em aberto (está como %)', ag.status;
  end if;

  update agendamentos set status = 'faltou' where id = ag.id;
  v_ini := to_timestamp(ceil(extract(epoch from now() + interval '40 minutes') / 1800) * 1800);
  v_fim := coalesce(ag.fim, ag.inicio + interval '1 hour');
  if v_fim - v_ini >= interval '30 minutes' then
    insert into vagas (empresa_id, inicio, fim, agendamento_id, motivo)
    values (ag.empresa_id, v_ini, v_fim, ag.id, 'atraso')
    returning id into v_vaga;
  end if;
  select coalesce((config->'vagas'->>'oferecer')::boolean, false) into v_oferece from empresas where id = p_empresa_id;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, ag.cliente_id, 'assistente', 'n8n_assistente_liberar_horario', 'agendamentos', ag.id,
          jsonb_build_object('vaga_id', v_vaga, 'vaga_inicio', case when v_vaga is not null then v_ini end), p_pedido_por);

  return jsonb_build_object('status', 'faltou',
    'vaga', case when v_vaga is null then 'não sobrou tempo para oferecer o horário'
                 when not v_oferece then 'vaga aberta, mas a oferta de vagas está desligada no salão'
                 else 'vou oferecer a partir das ' || to_char(v_ini at time zone 'America/Cuiaba', 'HH24:MI') ||
                      ' para quem tem horário mais tarde hoje' end);
end $$;

-- Conflito: a Gleide liberou, outra cliente adiantou para dentro do horário e depois a atrasada
-- apareceu (status voltou para realizado/agendado). Avisa uma vez por adiantamento (n8n_marcar_avisado,
-- situacao 'conflito').
create or replace function n8n_conflitos_atraso(p_empresa_id uuid)
returns table (contato_id uuid, nome_atrasada text, horario_atrasada timestamptz, nome_adiantou text, novo_horario timestamptz)
language sql stable set search_path = public as $$
  select ct.id, c0.nome, a0.inicio, cb.nome, ab.inicio
    from vagas v
    join agendamentos a0 on a0.id = v.agendamento_id
    join clientes c0 on c0.id = a0.cliente_id
    join contatos ct on ct.vaga_id = v.id and ct.tipo = 'vaga' and ct.resultado = 'agendou'
    join agendamentos ab on ab.id = ct.agendamento_id and ab.status = 'agendado'
    join clientes cb on cb.id = ab.cliente_id
   where v.empresa_id = p_empresa_id
     and v.motivo = 'atraso'
     and v.criado_em > now() - interval '1 day'
     and a0.status in ('realizado', 'agendado')
     and ab.inicio < coalesce(a0.fim, a0.inicio + interval '1 hour')
     and coalesce(ab.fim, ab.inicio + interval '1 hour') > a0.inicio
     and not exists (select 1 from registros_ia r where r.registro_id = ct.id and r.acao = 'avisou_conflito')
   order by ab.inicio
$$;

-- ---------------------------------------------------------------------
-- Falta: quem já foi chamada pelo atraso não recebe também o "sentimos sua falta"
-- ---------------------------------------------------------------------
create or replace function n8n_faltas_para_chamar(p_empresa_id uuid)
returns table (agendamento_id uuid, cliente_id uuid, nome text, telefone text, inicio timestamptz, servico text)
language sql stable set search_path = public as $$
  select a.id, c.id, c.nome, c.telefone, a.inicio, s.nome
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    join empresas e on e.id = a.empresa_id
    left join servicos s on s.id = a.servico_id
   where a.empresa_id = p_empresa_id
     and a.status = 'faltou'
     and (a.inicio at time zone 'America/Cuiaba')::date >= hoje_cuiaba() - 1
     and coalesce((e.config->'faltas'->>'chamar')::boolean, false)
     and (jsonb_array_length(coalesce(e.config->'faltas'->'so_para', '[]'::jsonb)) = 0
          or (e.config->'faltas'->'so_para') ? c.telefone)
     and not exists (select 1 from contatos ct where ct.agendamento_id = a.id and ct.tipo in ('falta', 'atraso'))
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > now())
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < now())
   order by a.inicio
$$;

-- Atraso se resolve como a falta: com um horário novo de verdade, ou com o próprio horário mudando
create or replace function contato_marca_remarcado() returns trigger
language plpgsql set search_path = public as $$
begin
  update contatos
     set resultado = 'agendou'
   where agendamento_id = new.id
     and tipo in ('remarcacao', 'vaga', 'atraso')
     and resultado in ('pendente', 'respondeu');
  return new;
end $$;

create or replace function contato_marca_agendou() returns trigger
language plpgsql set search_path = public as $$
begin
  update contatos
     set resultado = 'agendou'
   where cliente_id = new.cliente_id
     and resultado in ('pendente', 'respondeu')
     and criado_em >= now() - interval '14 days'
     and tipo not in ('remarcacao', 'vaga')
     and (tipo not in ('falta', 'atraso') or (new.status = 'agendado' and new.inicio > now()));
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Vagas: igual ao 010, mais a vaga de atraso (mesmo dia, uma oferta a cada 10 min, fecha se a
-- cliente atrasada aparecer ou se ficar a menos de 30 min). Vale para todas: a cliente logo depois
-- da vaga também pode adiantar mesmo se o serviço dela for mais longo que a vaga.
-- ---------------------------------------------------------------------
create or replace function n8n_vagas_para_oferecer(p_empresa_id uuid)
returns table (vaga_id uuid, vaga_inicio timestamptz, vaga_fim timestamptz, agendamento_id uuid,
               cliente_id uuid, nome text, telefone text, inicio_atual timestamptz, servico text)
language plpgsql set search_path = public as $$
begin
  update vagas v set status = 'preenchida'
   where v.empresa_id = p_empresa_id and v.status = 'aberta'
     and exists (select 1 from agendamentos a
                  where a.empresa_id = v.empresa_id and a.status in ('agendado', 'realizado')
                    and a.id is distinct from v.agendamento_id
                    and a.inicio < v.fim and coalesce(a.fim, a.inicio + interval '1 hour') > v.inicio);
  update vagas v set status = 'expirada'
   where v.empresa_id = p_empresa_id and v.status = 'aberta'
     and (case when v.motivo = 'atraso' then v.inicio < now() + interval '30 minutes'
               else v.inicio < now() + interval '3 hours' end
          -- a cliente atrasada apareceu (a Gleide corrigiu o status): o horário não está livre
          or (v.motivo = 'atraso' and exists (select 1 from agendamentos x where x.id = v.agendamento_id and x.status <> 'faltou')));

  return query
  select distinct on (v.id)
         v.id, v.inicio, v.fim, a.id, c.id, c.nome, c.telefone, a.inicio, s.nome
    from vagas v
    join empresas e on e.id = v.empresa_id
    join agendamentos a on a.empresa_id = v.empresa_id and a.status = 'agendado'
                       and a.inicio >= v.fim and a.inicio <= v.inicio + interval '14 days'
                       and (v.inicio + (coalesce(a.fim, a.inicio + interval '1 hour') - a.inicio) <= v.fim or a.inicio = v.fim)
    join clientes c on c.id = a.cliente_id
    left join servicos s on s.id = a.servico_id
   where v.empresa_id = p_empresa_id
     and v.status = 'aberta'
     and coalesce((e.config->'vagas'->>'oferecer')::boolean, false)
     and (jsonb_array_length(coalesce(e.config->'vagas'->'so_para', '[]'::jsonb)) = 0
          or (e.config->'vagas'->'so_para') ? c.telefone)
     -- vaga de atraso: só para quem tem horário no mesmo dia
     and (v.motivo <> 'atraso' or (a.inicio at time zone 'America/Cuiaba')::date = (v.inicio at time zone 'America/Cuiaba')::date)
     and not exists (select 1 from jsonb_array_elements(coalesce(e.config->'bloqueios', '[]'::jsonb)) b
                      where (v.inicio at time zone 'America/Cuiaba')::date between (b->>'de')::date and (b->>'ate')::date)
     and a.cliente_id is distinct from (select x.cliente_id from agendamentos x where x.id = v.agendamento_id)
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < now())
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.vaga_id = v.id)
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.resultado in ('pendente', 'respondeu')
                      and ct.criado_em > now() - interval '24 hours')
     -- uma oferta por vez para cada vaga (atraso: a próxima depois de 10 min; as outras: 2 h / 30 min)
     and not exists (select 1 from contatos ct where ct.vaga_id = v.id
                      and (ct.resultado = 'agendou'
                           or (ct.resultado = 'pendente' and ct.criado_em > now() -
                               case when v.motivo = 'atraso' then interval '10 minutes' else interval '2 hours' end)
                           or (ct.resultado = 'respondeu' and ct.criado_em > now() -
                               case when v.motivo = 'atraso' then interval '10 minutes' else interval '30 minutes' end)))
   order by v.id, a.inicio;
end $$;

-- ---------------------------------------------------------------------
-- Avisos para a Gleide: igual ao 010, e "remarcou" também para quem foi chamada pelo atraso
-- (atraso sem resposta vira a pendência 'atraso_confirmar': a Gleide já é perguntada por ela)
-- ---------------------------------------------------------------------
create or replace function n8n_avisos_para_gleide(p_empresa_id uuid)
returns table (contato_id uuid, tipo text, situacao text, nome text, telefone text,
               horario_original timestamptz, novo_horario timestamptz, servico text)
language sql stable set search_path = public as $$
  select y.contato_id, y.tipo, y.situacao, y.nome, y.telefone, y.horario_original, y.novo_horario, y.servico
  from (
    select distinct on (coalesce(ct.agendamento_id, ct.id))
           ct.id as contato_id, ct.tipo, ct.criado_em,
           case when ct.resultado = 'agendou' then 'remarcou' else 'sem_resposta' end as situacao,
           c.nome, c.telefone, ct.horario_original,
           case when ct.tipo in ('remarcacao', 'vaga') then a.inicio
                when ct.tipo = 'atraso' and a.status = 'agendado' and a.inicio is distinct from ct.horario_original then a.inicio
                else (select min(f.inicio) from agendamentos f
                       where f.cliente_id = c.id and f.status = 'agendado' and f.criado_em >= ct.criado_em) end as novo_horario,
           s.nome as servico,
           ct.resultado, a.status as status_horario, a.inicio as inicio_horario
      from contatos ct
      join clientes c on c.id = ct.cliente_id
      left join agendamentos a on a.id = ct.agendamento_id
      left join servicos s on s.id = a.servico_id
     where ct.empresa_id = p_empresa_id
       and ct.tipo in ('falta', 'remarcacao', 'vaga', 'atraso')
       and ct.criado_em > now() - interval '7 days'
     order by coalesce(ct.agendamento_id, ct.id), ct.criado_em desc
  ) y
  where (
          (y.resultado = 'agendou'
            and (y.tipo not in ('remarcacao', 'vaga') or (y.status_horario = 'agendado' and y.inicio_horario is distinct from y.horario_original)))
          or (y.resultado = 'pendente' and y.tipo not in ('vaga', 'atraso') and y.criado_em < now() - interval '24 hours')
        )
    and not exists (select 1 from registros_ia r where r.registro_id = y.contato_id and r.acao = 'avisou_' || y.situacao)
  order by y.horario_original
$$;

-- ---------------------------------------------------------------------
-- Cobrança da Gleide: de 1 em 1 h (o disparo do n8n), por no máximo 2 h por pendência
-- (perguntou na hora, +1 h e +2 h; a folga de 10 min cobre o atraso do agendador)
-- ---------------------------------------------------------------------
create or replace function n8n_assistente_pendencias_novas(p_empresa_id uuid)
returns setof pendencias_gleide language sql stable set search_path = public as $$
  select p.* from pendencias_gleide p
   where p.empresa_id = p_empresa_id
     and (p.perguntado_em is null or p.perguntado_em < now() - interval '50 minutes')
     and coalesce((select min(r.criado_em) from registros_ia r
                    where r.acao = 'perguntou' and r.registro_id = p.pendencia_id), now())
         > now() - interval '2 hours 10 minutes'
   order by p.inicio nulls last
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'n8n_atrasos_para_chamar(uuid)',
    'n8n_registrar_chamada_atraso(uuid, uuid, text, text)',
    'n8n_atrasos_para_confirmar(uuid)',
    'n8n_assistente_liberar_horario(uuid, text, uuid)',
    'n8n_conflitos_atraso(uuid)',
    'n8n_faltas_para_chamar(uuid)',
    'n8n_vagas_para_oferecer(uuid)',
    'n8n_avisos_para_gleide(uuid)',
    'n8n_assistente_pendencias_novas(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- 037: a assistente entende o serviço do jeito que a dona fala, e aceita "vou gastar 1h30".
--
-- Em 11/11/2026 a Gleide escreveu "agenda a Vitória para sexta às 8, fazer a colocação do mega". O serviço se chama
-- "Aplicação de mega hair – mão de obra", a busca exigia todas as palavras no nome e devolveu "não achei". Foram 5
-- mensagens para marcar, e o horário ficou com 4 h (duração do cadastro) mesmo com ela dizendo que levaria 1h30.
--
-- Só soma: coluna nova, funções novas, e a busca de serviço ganha dois passos DEPOIS dos que já existiam (o que hoje
-- acha continua achando o mesmo serviço; muda só o que hoje daria "não achei").

-- 1) Apelidos: outros jeitos de falar o serviço, por loja (ex.: {colocação, colocar} para "Aplicação de mega hair").
alter table servicos add column if not exists apelidos text[] not null default '{}';
comment on column servicos.apelidos is
  'Outros jeitos de a dona falar este serviço para a assistente (ex.: colocação, tirar, pintar). Usado por assistente_achar_servico.';

-- 2) Busca do serviço: nome igual → todas as palavras no nome → apelido → palavras que importam, pelo começo.
create or replace function assistente_achar_servico(p_empresa_id uuid, p_nome text)
returns uuid language plpgsql stable set search_path = public as $$
declare
  v_busca text := assistente_normalizar(p_nome); v_ids uuid[]; v_lista text;
  -- o que ela disse, só letras e números, com espaço nas pontas (para achar apelido como palavra inteira)
  v_pal text := ' ' || trim(regexp_replace(assistente_normalizar(p_nome), '[^a-z0-9]+', ' ', 'g')) || ' ';
  -- palavras que não dizem qual é o serviço: enfeite, técnica, "mega hair"
  v_ignorar text[] := array['mega','hair','mao','obra','cabelo','cabelos','queratina','fita','adesiva','tela','telas',
    'costurada','ponto','americano','capsula','capsulas','microcapsula','microcapsulas','tecnica','servico','para','pra',
    'com','uma','dos','das','que','fazer','faz','ela','dela','rapida','rapido','completa','completo','simples','normal'];
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

  -- apelido cadastrado no serviço, como palavra inteira dentro do que ela disse ("colocação do mega" → Aplicação).
  -- Se apelidos de dois serviços aparecem ("retoque de mechas"), não escolhe: pergunta qual.
  if v_ids is null then
    select array_agg(distinct s.id) into v_ids
      from servicos s
      cross join lateral (select trim(regexp_replace(assistente_normalizar(a), '[^a-z0-9]+', ' ', 'g')) as ap
                            from unnest(s.apelidos) a) x
     where s.empresa_id = p_empresa_id and s.ativo and x.ap <> ''
       and position(' ' || x.ap || ' ' in v_pal) > 0;
    if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
  end if;

  -- tolerante: ignora as palavras que não distinguem serviço e compara pelo começo da palavra
  -- ("manutenção de queratina" → Manutenção; "aplicar tela" → Aplicação)
  if v_ids is null then
    select array_agg(s.id) into v_ids from servicos s
     where s.empresa_id = p_empresa_id and s.ativo
       and exists (select 1 from regexp_split_to_table(v_busca, '[^a-z0-9]+') w
                    where length(w) >= 3 and w <> all (v_ignorar))
       and not exists (select 1 from regexp_split_to_table(v_busca, '[^a-z0-9]+') w
                        where length(w) >= 3 and w <> all (v_ignorar)
                          and position(left(w, 5) in assistente_normalizar(s.nome)) = 0);
    if coalesce(array_length(v_ids, 1), 0) = 1 then return v_ids[1]; end if;
  end if;

  if v_ids is not null then
    select string_agg(nome, '; ' order by nome) into v_lista from servicos where id = any (v_ids);
    raise exception 'serviço "%" pode ser: %. Pergunte qual.', p_nome, v_lista;
  end if;
  select string_agg(nome, '; ' order by nome) into v_lista from servicos where empresa_id = p_empresa_id and ativo;
  raise exception 'não achei o serviço "%". Os serviços do salão são: %', p_nome, v_lista;
end $$;

revoke all on function assistente_achar_servico(uuid, text) from public, anon, authenticated;
grant execute on function assistente_achar_servico(uuid, text) to service_role;

-- 3) Apelidos do Salão Toda Bonita (os jeitos que a Gleide e as clientes falam). Só preenche onde está vazio.
update servicos s set apelidos = v.apelidos
  from (values
    ('Aplicação de mega hair – mão de obra', array['colocação','colocar','colocada','botar','instalar','instalação','mega novo']),
    ('Manutenção – mão de obra',             array['apertar','aperto','reaperto','reapertar','subir o mega']),
    ('Remoção de mega hair',                 array['remover','tirar','retirar','retirada','tirada']),
    ('Coloração',                            array['pintar','pintura','tinta','tintura','tingir','retoque de raiz']),
    ('Mechas / luzes',                       array['luz','reflexo','reflexos']),
    ('Hidratação ou reconstrução',           array['hidratar','reconstruir']),
    ('Selagem',                              array['selar']),
    ('Avaliação',                            array['avaliar','presencial','orçamento']),
    ('Avaliação online',                     array['online','ligação','chamada','por telefone']),
    ('Visita para escolher cabelo',          array['escolher cabelo','ver cabelo','ver os cabelos','olhar cabelo','comprar cabelo'])
  ) as v(nome, apelidos)
 where s.empresa_id = '00000000-0000-0000-0000-000000000001' and s.ativo and s.nome = v.nome and s.apelidos = '{}';

-- 4) Marcar horário dizendo quanto tempo vai levar. Função NOVA (a antiga fica como está para o fluxo publicado):
--    igual à n8n_assistente_marcar_horario, mais p_duracao_min. Sem p_duracao_min, vale a duração do cadastro.
create or replace function n8n_assistente_marcar_horario_v2(
  p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid, p_telefone text, p_nome text, p_servico text,
  p_inicio timestamptz, p_observacoes text default null, p_forcar boolean default false, p_duracao_min int default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_serv uuid; v_dur int; v_serv_nome text; v_cliente clientes%rowtype; v_tel text; v_problemas text[] := '{}';
        v_motivo text; v_ja text; v_id uuid; v_fim timestamptz;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_inicio is null then raise exception 'qual dia e hora?'; end if;
  if p_inicio < now() then
    raise exception 'esse horário já passou. Atendimento que já aconteceu: use registrar_atendimento';
  end if;
  if p_duracao_min is not null and (p_duracao_min < 10 or p_duracao_min > 720) then
    raise exception 'duração de % minutos não parece certa: confirme com a Gleide quanto tempo vai levar', p_duracao_min;
  end if;
  v_serv := assistente_achar_servico(p_empresa_id, p_servico);
  select coalesce(duracao_min, 60), nome into v_dur, v_serv_nome from servicos where id = v_serv;
  v_dur := coalesce(p_duracao_min, v_dur);

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

  -- com duração dita, o fim vai junto; sem ela, o gatilho agendamento_regras calcula pelo cadastro (como antes)
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem, observacoes)
  values (p_empresa_id, v_cliente.id, v_serv, p_inicio,
          case when p_duracao_min is not null then p_inicio + make_interval(mins => p_duracao_min) end,
          'agendado', 'manual', nullif(trim(coalesce(p_observacoes, '')), ''))
  returning id, fim into v_id, v_fim;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, v_cliente.id, 'assistente', 'n8n_assistente_marcar_horario', 'agendamentos', v_id,
          jsonb_build_object('servico_id', v_serv, 'inicio', p_inicio, 'forcar', p_forcar, 'duracao_min', p_duracao_min), p_pedido_por);

  return jsonb_build_object('agendamento_id', v_id, 'cliente_id', v_cliente.id, 'nome', v_cliente.nome,
    'tel_final', right(v_cliente.telefone, 4), 'servico', v_serv_nome, 'quando', assistente_quando(p_inicio),
    'ate', to_char(v_fim at time zone 'America/Cuiaba', 'HH24:MI'));
end $$;

revoke all on function n8n_assistente_marcar_horario_v2(uuid, text, uuid, text, text, text, timestamptz, text, boolean, int) from public, anon, authenticated;
grant execute on function n8n_assistente_marcar_horario_v2(uuid, text, uuid, text, text, text, timestamptz, text, boolean, int) to service_role;

-- 5) Mudar quanto tempo leva um horário JÁ marcado ("a da Vitória vai levar só 1h30").
create or replace function n8n_assistente_ajustar_duracao(
  p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid, p_minutos int, p_forcar boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_motivo text; v_fim timestamptz; v_nome text; v_serv_nome text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  if ag.status <> 'agendado' then raise exception 'esse horário está como %: só dá para mudar a duração de horário marcado', ag.status; end if;
  if p_minutos is null or p_minutos < 10 or p_minutos > 720 then
    raise exception 'quantos minutos vai levar? (entre 10 e 720)';
  end if;
  if not p_forcar then
    v_motivo := assistente_conferir_horario(p_empresa_id, ag.inicio, p_minutos, ag.id);
    if v_motivo is not null then
      raise exception 'NÃO MUDEI: % Conte à Gleide; se ela quiser assim mesmo, chame de novo com forcar = sim.', v_motivo;
    end if;
  end if;
  update agendamentos set fim = inicio + make_interval(mins => p_minutos) where id = ag.id returning fim into v_fim;
  select nome into v_nome from clientes where id = ag.cliente_id;
  select nome into v_serv_nome from servicos where id = ag.servico_id;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, ag.cliente_id, 'assistente', 'n8n_assistente_ajustar_duracao', 'agendamentos', ag.id,
          jsonb_build_object('fim_antes', ag.fim, 'minutos', p_minutos, 'forcar', p_forcar), p_pedido_por);
  return jsonb_build_object('agendamento_id', ag.id, 'nome', v_nome, 'servico', v_serv_nome,
    'quando', assistente_quando(ag.inicio), 'ate', to_char(v_fim at time zone 'America/Cuiaba', 'HH24:MI'), 'minutos', p_minutos);
end $$;

revoke all on function n8n_assistente_ajustar_duracao(uuid, text, uuid, int, boolean) from public, anon, authenticated;
grant execute on function n8n_assistente_ajustar_duracao(uuid, text, uuid, int, boolean) to service_role;

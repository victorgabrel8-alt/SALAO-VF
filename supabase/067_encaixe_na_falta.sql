-- =====================================================================
-- 067_encaixe_na_falta.sql — encaixe na falta (parte 4 do portão, pedido do Victor em 21/11/2026)
-- A Gleide confirma à assistente que uma cliente faltou. A assistente pergunta, em conversa normal, se pode ver com a
-- cliente do horário mais próximo DEPOIS da vaga, no mesmo dia, se ela consegue vir antes. Só com o "pode" da Gleide sai
-- UMA mensagem para essa cliente. A cliente diz a hora em que consegue chegar, a IA confirma por extenso e só remarca
-- depois do sim. Sem resposta ou "não": fica tudo como está, e NUNCA se chama a segunda cliente.
--
-- Só soma: tabela nova e funções novas. Nenhuma função que já existe é trocada (as novas chamam as antigas).
--   encaixes                                 1 por falta, 1 pergunta pendente por vez, 1 oferta por cliente por dia
--   encaixe_candidata                        quem pode ser chamada (ou o motivo de não ter ninguém)
--   n8n_assistente_liberar_horario_encaixe   = liberar_horario de sempre + a pergunta do encaixe
--   n8n_assistente_status_agendamento_encaixe= status_atendimento de sempre + a pergunta do encaixe (status faltou)
--   n8n_assistente_chamar_para_encaixe       a Gleide autorizou (ou disse que não): grava e devolve telefone + mensagem
--   n8n_encaixe_registrar_saida              = n8n_registrar_saida + marca o encaixe como oferecido (mensagem saiu)
--   n8n_encaixe_pendente_texto               a pergunta que espera a resposta da Gleide (entra no prompt da assistente)
--   n8n_encaixe_da_cliente                   a oferta aberta desta cliente (entra na ficha: "ALÔ DE ENCAIXE")
--   n8n_vagas_para_oferecer_v2               a rotina de vagas sem as vagas de falta/atraso (essas são só do encaixe)
--
-- Ligar: empresas.config.encaixe = {"ligado": true, "so_para": [], "folga_min": 30}
--   so_para com números = só essas clientes podem ser chamadas (teste); vazio = todas. Sem config.encaixe, nada muda:
--   as duas funções "_encaixe" respondem igual às antigas.
--   folga_min = só chama se o horário da cliente for pelo menos tantos minutos depois de agora (padrão 30).
-- O contato da oferta é do tipo 'vaga' (já existe): a Gleide recebe o aviso "⏩ adiantou" que já existia quando a
-- cliente aceita, e o conflito "a atrasada apareceu" (011) continua funcionando.
-- Teste: n8n/demo-agente/teste-067-encaixe.sql (Loja Teste, transação desfeita).
-- =====================================================================

create table encaixes (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references empresas(id) on delete cascade,
  falta_agendamento_id  uuid not null references agendamentos(id) on delete cascade,  -- o horário de quem faltou
  agendamento_id        uuid not null references agendamentos(id) on delete cascade,  -- o horário da cliente que pode vir antes
  cliente_id            uuid not null references clientes(id) on delete cascade,
  dia                   date not null,
  janela_inicio         timestamptz not null,   -- começo do horário que faltou: antes disso não é encaixe
  horario_original      timestamptz not null,   -- o horário dela quando a pergunta foi feita (continua garantido)
  -- perguntado: a assistente perguntou à dona · nao_autorizado: a dona disse não · expirado: a dona não respondeu a
  -- tempo (ou a cliente deixou de valer) · autorizado: a dona autorizou, mensagem gerada · oferecido: mensagem saiu ·
  -- aceito: a cliente veio antes · recusado: respondeu e não adiantou · sem_resposta: não respondeu até o horário dela
  status                text not null default 'perguntado'
                          check (status in ('perguntado', 'nao_autorizado', 'expirado', 'autorizado', 'oferecido', 'aceito', 'recusado', 'sem_resposta')),
  mensagem              text,
  contato_id            uuid references contatos(id) on delete set null,  -- apagado quando o WhatsApp não enviou
  vaga_id               uuid references vagas(id) on delete set null,
  novo_horario          timestamptz,
  pedido_por            text,
  perguntado_em         timestamptz not null default now(),
  respondido_em         timestamptz,   -- quando a dona respondeu (sim ou não)
  oferecido_em          timestamptz,
  fechado_em            timestamptz,
  criado_em             timestamptz not null default now()
);
-- uma cliente só por falta: nunca a segunda
create unique index encaixes_um_por_falta on encaixes (falta_agendamento_id);
-- uma pergunta pendente por vez para a dona
create unique index encaixes_uma_pergunta_por_vez on encaixes (empresa_id) where status = 'perguntado';
-- no máximo uma oferta por cliente por dia
create unique index encaixes_uma_oferta_por_cliente_dia on encaixes (empresa_id, cliente_id, dia)
  where status in ('autorizado', 'oferecido', 'aceito', 'recusado', 'sem_resposta');
create index encaixes_abertos on encaixes (empresa_id, status) where status in ('perguntado', 'autorizado', 'oferecido');
alter table encaixes enable row level security;  -- só o n8n (service_role) mexe
revoke all on table encaixes from anon, authenticated;

-- "15h", "15h30": como se fala
create or replace function encaixe_hora(p_ts timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(p_ts at time zone 'America/Cuiaba', 'FMHH24') || 'h' ||
         case when extract(minute from p_ts at time zone 'America/Cuiaba') > 0 then to_char(p_ts at time zone 'America/Cuiaba', 'MI') else '' end
$$;

create or replace function encaixe_folga(p_empresa_id uuid)
returns interval language sql stable set search_path = public as $$
  select make_interval(mins => greatest(coalesce((select nullif(config->'encaixe'->>'folga_min', '')::int from empresas where id = p_empresa_id), 30), 10))
$$;

-- Quem pode ser chamada para a vaga desta falta: {"ok": true, agendamento_id, cliente_id, nome, telefone, inicio, ...}
-- ou {"ok": false, "motivo": "..."}. Só a cliente do horário mais próximo depois da vaga, no mesmo dia; se ela não
-- pode ser chamada, ninguém é (não pula para a seguinte).
create or replace function encaixe_candidata(p_empresa_id uuid, p_falta_agendamento_id uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_cfg jsonb; f agendamentos%rowtype; a agendamentos%rowtype; c clientes%rowtype;
  v_hoje date := hoje_cuiaba(); v_folga interval := encaixe_folga(p_empresa_id); v_dur int; v_de timestamptz;
begin
  select config into v_cfg from empresas where id = p_empresa_id;
  if not coalesce((v_cfg->'encaixe'->>'ligado')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', 'encaixe desligado');
  end if;
  select * into f from agendamentos where id = p_falta_agendamento_id and empresa_id = p_empresa_id;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'horário da falta não encontrado'); end if;
  if f.status <> 'faltou' then return jsonb_build_object('ok', false, 'motivo', 'esse horário não está como falta'); end if;
  if (f.inicio at time zone 'America/Cuiaba')::date <> v_hoje then
    return jsonb_build_object('ok', false, 'motivo', 'a falta não é de hoje');
  end if;
  if coalesce(f.fim, f.inicio + interval '1 hour') <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'o horário de quem faltou já terminou');
  end if;

  -- a do horário mais próximo depois da vaga (mesma profissional, mesmo dia)
  select * into a from agendamentos x
   where x.empresa_id = p_empresa_id and x.id <> f.id and x.status in ('agendado', 'realizado')
     and x.inicio > f.inicio and (x.inicio at time zone 'America/Cuiaba')::date = v_hoje
     and x.profissional_id is not distinct from f.profissional_id
   order by x.inicio, x.criado_em limit 1;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'não tem outra cliente marcada depois, hoje'); end if;
  if a.status <> 'agendado' then return jsonb_build_object('ok', false, 'motivo', 'a próxima cliente já foi atendida'); end if;
  if a.chegou_em is not null then return jsonb_build_object('ok', false, 'motivo', 'a próxima cliente já chegou'); end if;
  if a.cliente_id = f.cliente_id then return jsonb_build_object('ok', false, 'motivo', 'o próximo horário é da mesma cliente'); end if;
  if a.inicio < now() + v_folga then
    return jsonb_build_object('ok', false, 'motivo', 'o horário da próxima cliente já está perto demais');
  end if;

  select * into c from clientes where id = a.cliente_id;
  if coalesce(c.telefone, '') = '' or 'sistema:excluida' = any (c.etiquetas) then
    return jsonb_build_object('ok', false, 'motivo', 'a próxima cliente não tem WhatsApp no cadastro');
  end if;
  if c.ia_pausada_ate is not null and c.ia_pausada_ate > now() then
    return jsonb_build_object('ok', false, 'motivo', 'a IA está pausada para a próxima cliente');
  end if;
  if jsonb_array_length(coalesce(v_cfg->'encaixe'->'so_para', '[]'::jsonb)) > 0 and not ((v_cfg->'encaixe'->'so_para') ? c.telefone) then
    return jsonb_build_object('ok', false, 'motivo', 'encaixe em teste: a próxima cliente não está na lista');
  end if;
  -- no máximo 1 oferta por cliente por dia (a desta mesma falta não conta: é a que está sendo decidida)
  if exists (select 1 from encaixes e where e.empresa_id = p_empresa_id and e.cliente_id = c.id and e.dia = v_hoje
               and e.falta_agendamento_id <> f.id
               and e.status in ('autorizado', 'oferecido', 'aceito', 'recusado', 'sem_resposta')) then
    return jsonb_build_object('ok', false, 'motivo', 'a próxima cliente já recebeu uma oferta de encaixe hoje');
  end if;

  -- a vaga ainda faz sentido? Algum início entre agora e 15 min antes do horário dela passa nas regras da agenda
  -- (expediente, almoço, bloqueios, outras clientes), com a duração do serviço dela
  v_dur := greatest(1, (extract(epoch from coalesce(a.fim, a.inicio + interval '1 hour') - a.inicio) / 60)::int);
  v_de := greatest(f.inicio, now());
  v_de := to_timestamp(ceil(extract(epoch from v_de) / 300) * 300);
  if not exists (select 1 from generate_series(v_de, a.inicio - interval '15 minutes', interval '5 minutes') t
                  where assistente_conferir_horario(p_empresa_id, t, v_dur, a.id) is null) then
    return jsonb_build_object('ok', false, 'motivo', 'o serviço da próxima cliente não cabe antes do horário dela (almoço, bloqueio ou outra cliente)');
  end if;

  return jsonb_build_object('ok', true, 'agendamento_id', a.id, 'cliente_id', c.id, 'nome', c.nome, 'telefone', c.telefone,
    'inicio', a.inicio, 'janela_inicio', f.inicio,
    'vaga_id', (select v.id from vagas v where v.agendamento_id = f.id and v.motivo = 'atraso' order by v.criado_em desc limit 1));
end $$;

-- Arruma o estado dos encaixes abertos. Chamada no começo das outras funções (não precisa de rotina própria).
create or replace function encaixe_fechar_vencidos(p_empresa_id uuid)
returns void language plpgsql set search_path = public as $$
declare v_hoje date := hoje_cuiaba(); v_folga interval := encaixe_folga(p_empresa_id);
begin
  -- a dona não respondeu a tempo, o envio falhou e passou a hora, ou a cliente deixou de valer
  update encaixes e set status = 'expirado', fechado_em = now()
   where e.empresa_id = p_empresa_id
     and (e.status = 'perguntado' or (e.status = 'autorizado' and e.contato_id is null))
     and (e.dia <> v_hoje
          or not exists (select 1 from agendamentos a where a.id = e.agendamento_id and a.status = 'agendado' and a.chegou_em is null
                            and a.inicio = e.horario_original and a.inicio >= now() + v_folga)
          or not exists (select 1 from agendamentos f where f.id = e.falta_agendamento_id and f.status = 'faltou'));
  -- a cliente veio antes
  update encaixes e set status = 'aceito', novo_horario = a.inicio, fechado_em = now()
    from agendamentos a
   where a.id = e.agendamento_id and e.empresa_id = p_empresa_id
     and e.status in ('autorizado', 'oferecido') and e.contato_id is not null
     and a.status in ('agendado', 'realizado') and a.inicio < e.horario_original
     and (a.inicio at time zone 'America/Cuiaba')::date = e.dia;
  -- chegou o horário dela (ou o horário mudou de outro jeito) sem ela adiantar
  update encaixes e
     set status = case when exists (select 1 from contatos ct where ct.id = e.contato_id and ct.resultado in ('respondeu', 'agendou'))
                       then 'recusado' else 'sem_resposta' end,
         fechado_em = now()
    from agendamentos a
   where a.id = e.agendamento_id and e.empresa_id = p_empresa_id
     and e.status in ('autorizado', 'oferecido') and e.contato_id is not null
     and (e.horario_original <= now() or e.dia <> v_hoje or a.status <> 'agendado' or a.inicio <> e.horario_original);
end $$;

-- Depois de gravar a falta: tem alguém para chamar? Devolve a pergunta para a assistente fazer à dona
-- ({"perguntar": true, "pergunta": "..."}) ou {"perguntar": false, "motivo": "..."}. Grava o encaixe como 'perguntado'.
create or replace function n8n_encaixe_apos_falta(p_empresa_id uuid, p_pedido_por text, p_falta_agendamento_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare e encaixes%rowtype; p encaixes%rowtype; v_c jsonb; v_nome text; v_quem text;
begin
  if not coalesce((select (config->'encaixe'->>'ligado')::boolean from empresas where id = p_empresa_id), false) then
    return jsonb_build_object('perguntar', false, 'motivo', 'encaixe desligado');
  end if;
  perform encaixe_fechar_vencidos(p_empresa_id);

  select * into e from encaixes where falta_agendamento_id = p_falta_agendamento_id and empresa_id = p_empresa_id;
  if found and e.status <> 'perguntado' then
    return jsonb_build_object('perguntar', false, 'motivo', 'o encaixe desta falta já foi tratado');
  end if;
  if not found then
    v_c := encaixe_candidata(p_empresa_id, p_falta_agendamento_id);
    if not (v_c->>'ok')::boolean then return jsonb_build_object('perguntar', false, 'motivo', v_c->>'motivo'); end if;
    select * into p from encaixes where empresa_id = p_empresa_id and status = 'perguntado';
    if found then
      return jsonb_build_object('perguntar', false, 'motivo', 'já tem uma pergunta de encaixe esperando a resposta dela (' ||
        coalesce((select nullif(split_part(trim(coalesce(c.nome, '')), ' ', 1), '') from clientes c where c.id = p.cliente_id), 'cliente') ||
        ', das ' || encaixe_hora(p.horario_original) || ')');
    end if;
    insert into encaixes (empresa_id, falta_agendamento_id, agendamento_id, cliente_id, dia, janela_inicio, horario_original, vaga_id, pedido_por)
    values (p_empresa_id, p_falta_agendamento_id, (v_c->>'agendamento_id')::uuid, (v_c->>'cliente_id')::uuid, hoje_cuiaba(),
            (v_c->>'janela_inicio')::timestamptz, (v_c->>'inicio')::timestamptz, nullif(v_c->>'vaga_id', '')::uuid, p_pedido_por)
    returning * into e;
  end if;

  select nullif(split_part(trim(coalesce(c.nome, '')), ' ', 1), '') into v_nome from clientes c where c.id = e.cliente_id;
  v_quem := case when v_nome is null then 'a cliente das ' || encaixe_hora(e.horario_original)
                 else 'a ' || v_nome || ' (das ' || encaixe_hora(e.horario_original) || ')' end;
  return jsonb_build_object('perguntar', true, 'cliente', coalesce(v_nome, 'cliente das ' || encaixe_hora(e.horario_original)),
    'agendamento_id', e.agendamento_id, 'horario', to_char(e.horario_original at time zone 'America/Cuiaba', 'HH24:MI'),
    'pergunta', 'Quer que eu veja com ' || v_quem || ' se ela consegue vir antes?',
    'como', 'Termine a sua resposta com essa pergunta. Só use chamar_para_encaixe depois que a Gleide responder que pode.');
end $$;

-- liberar_horario de sempre (marca falta e abre a vaga) + a pergunta do encaixe. Com o encaixe desligado, igual à antiga.
create or replace function n8n_assistente_liberar_horario_encaixe(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare r jsonb; v_enc jsonb;
begin
  r := n8n_assistente_liberar_horario(p_empresa_id, p_pedido_por, p_agendamento_id);
  if not coalesce((select (config->'encaixe'->>'ligado')::boolean from empresas where id = p_empresa_id), false) then return r; end if;
  -- a vaga desta falta é só do encaixe (a dona autoriza): a rotina automática de vagas nunca oferece nem passa para a seguinte
  update vagas set status = 'expirada'
   where empresa_id = p_empresa_id and agendamento_id = p_agendamento_id and motivo = 'atraso' and status = 'aberta';
  begin
    v_enc := n8n_encaixe_apos_falta(p_empresa_id, p_pedido_por, p_agendamento_id);
  exception when others then
    v_enc := jsonb_build_object('perguntar', false, 'motivo', 'erro: ' || sqlerrm);  -- a falta fica gravada de qualquer jeito
  end;
  return (r - 'vaga') || jsonb_build_object('encaixe', v_enc);
end $$;

-- status_atendimento de sempre + a pergunta do encaixe quando o status é faltou. Com o encaixe desligado, igual à antiga.
create or replace function n8n_assistente_status_agendamento_encaixe(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
                                                                    p_status text, p_valor numeric default null)
returns jsonb language plpgsql set search_path = public as $$
declare r jsonb; v_enc jsonb;
begin
  r := n8n_assistente_status_agendamento(p_empresa_id, p_pedido_por, p_agendamento_id, p_status, p_valor);
  if p_status <> 'faltou'
     or not coalesce((select (config->'encaixe'->>'ligado')::boolean from empresas where id = p_empresa_id), false) then return r; end if;
  begin
    v_enc := n8n_encaixe_apos_falta(p_empresa_id, p_pedido_por, p_agendamento_id);
  exception when others then
    v_enc := jsonb_build_object('perguntar', false, 'motivo', 'erro: ' || sqlerrm);
  end;
  return r || jsonb_build_object('encaixe', v_enc);
end $$;

-- A Gleide respondeu à pergunta do encaixe. p_recusou = true: ela disse que não (ninguém é chamado, a pergunta se encerra).
-- Senão: grava o contato e devolve telefone + mensagem para o n8n mandar (mesmo formato do avisar_cliente).
-- p_agendamento_id / p_nome: a cliente de quem a Gleide falou; têm de bater com a pergunta que está esperando.
create or replace function n8n_assistente_chamar_para_encaixe(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid default null,
                                                             p_nome text default null, p_recusou boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare e encaixes%rowtype; c clientes%rowtype; v_c jsonb; v_nome text; v_h text; v_texto text; v_contato uuid; v_conf text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  perform encaixe_fechar_vencidos(p_empresa_id);
  -- a pergunta que espera a resposta dela (ou a que ela autorizou e o WhatsApp não enviou: pode tentar de novo)
  select * into e from encaixes
   where empresa_id = p_empresa_id and dia = hoje_cuiaba()
     and (status = 'perguntado' or (status = 'autorizado' and contato_id is null))
   order by (status = 'perguntado') desc, perguntado_em desc limit 1;
  if not found then
    raise exception 'não tem pergunta de encaixe esperando a resposta dela agora (passou do tempo ou já foi respondida). Ninguém foi chamado.';
  end if;
  select * into c from clientes where id = e.cliente_id;
  v_nome := nullif(split_part(trim(coalesce(c.nome, '')), ' ', 1), '');
  v_h := encaixe_hora(e.horario_original);
  if p_agendamento_id is not null and p_agendamento_id <> e.agendamento_id then
    raise exception 'a pergunta de encaixe que está esperando é sobre % (das %), não sobre esse horário. Ninguém foi chamado.', coalesce(v_nome, 'a cliente'), v_h;
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'diga em cliente_nome o nome da cliente que a Gleide autorizou. Ninguém foi chamado.';
  end if;
  v_conf := n8n_assistente_conferir_nome(p_empresa_id, e.cliente_id, null, p_nome);
  if v_conf <> 'ok' then
    raise exception 'a pergunta de encaixe que está esperando é sobre % (das %), não sobre "%". Ninguém foi chamado.', coalesce(v_nome, 'a cliente'), v_h, p_nome;
  end if;

  if p_recusou then
    update encaixes set status = 'nao_autorizado', respondido_em = now(), fechado_em = now(), pedido_por = p_pedido_por where id = e.id;
    insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
    values (p_empresa_id, e.cliente_id, 'assistente', 'n8n_assistente_chamar_para_encaixe', 'encaixes', e.id,
            jsonb_build_object('autorizou', false), p_pedido_por);
    return jsonb_build_object('chamou', false, 'nota', 'a Gleide não quis: ninguém foi chamado e fica tudo como está');
  end if;

  -- confere de novo na hora de mandar: ainda é ela e ainda dá tempo?
  v_c := encaixe_candidata(p_empresa_id, e.falta_agendamento_id);
  if not (v_c->>'ok')::boolean then
    raise exception 'não dá mais para chamar %: %. Ninguém foi chamado e fica tudo como está.', coalesce(v_nome, 'a cliente'), v_c->>'motivo';
  end if;
  if (v_c->>'agendamento_id')::uuid <> e.agendamento_id or (v_c->>'inicio')::timestamptz <> e.horario_original then
    raise exception 'a agenda mudou depois da pergunta (o horário de % não é mais o das %). Ninguém foi chamado.', coalesce(v_nome, 'a cliente'), v_h;
  end if;

  v_texto := 'Oi' || coalesce(', ' || v_nome, '') || '! Abriu um horário hoje mais cedo aqui no salão. Se for bom pra você vir antes das ' ||
    v_h || ', me fala que horas você consegue chegar. Se não der, tudo certo: seu horário das ' || v_h || ' continua garantido 💛';
  insert into contatos (empresa_id, cliente_id, tipo, canal, mensagem, agendamento_id, horario_original, vaga_id)
  values (p_empresa_id, c.id, 'vaga', 'ia', v_texto, e.agendamento_id, e.horario_original, e.vaga_id)
  returning id into v_contato;
  update encaixes set status = 'autorizado', respondido_em = now(), mensagem = v_texto, contato_id = v_contato, pedido_por = p_pedido_por
   where id = e.id;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, c.id, 'assistente', 'n8n_assistente_chamar_para_encaixe', 'contatos', v_contato,
          jsonb_build_object('encaixe_id', e.id, 'agendamento_id', e.agendamento_id, 'mensagem', v_texto), p_pedido_por);
  return jsonb_build_object('contato_id', v_contato, 'telefone', c.telefone, 'nome', c.nome, 'mensagem', v_texto);
end $$;

-- A mensagem do encaixe saiu pelo WhatsApp: grava na conversa (como sempre) e marca o encaixe como oferecido.
create or replace function n8n_encaixe_registrar_saida(p_empresa_id uuid, p_telefone text, p_conteudo text, p_autor text,
                                                      p_tipo text default 'texto', p_wa_message_id text default null)
returns jsonb language plpgsql set search_path = public as $$
declare r jsonb;
begin
  r := n8n_registrar_saida(p_empresa_id, p_telefone, p_conteudo, p_autor, p_tipo, p_wa_message_id);
  update encaixes e set status = 'oferecido', oferecido_em = now()
   where e.empresa_id = p_empresa_id and e.status = 'autorizado' and e.contato_id is not null
     and e.cliente_id in (select id from clientes where empresa_id = p_empresa_id and telefone = p_telefone);
  return r;
end $$;

-- O que espera a resposta da Gleide agora (entra no prompt da assistente a cada mensagem dela)
create or replace function n8n_encaixe_pendente_texto(p_empresa_id uuid)
returns text language plpgsql set search_path = public as $$
declare v text;
begin
  perform encaixe_fechar_vencidos(p_empresa_id);
  select string_agg('- ' || coalesce(nullif(split_part(trim(coalesce(c.nome, '')), ' ', 1), ''), 'cliente sem nome') ||
           ' (agendamento_id ' || e.agendamento_id || '), horário dela hoje às ' || to_char(e.horario_original at time zone 'America/Cuiaba', 'HH24:MI') ||
           case when e.status = 'perguntado'
                then ': às ' || to_char(e.perguntado_em at time zone 'America/Cuiaba', 'HH24:MI') || ' você perguntou à Gleide se pode ver com ela se consegue vir antes'
                else ': a Gleide autorizou, mas o WhatsApp não enviou a mensagem; se ela pedir, tente de novo com chamar_para_encaixe' end ||
           coalesce(' (vaga da falta de ' || nullif(split_part(trim(coalesce(cf.nome, '')), ' ', 1), '') || ')', ''), E'\n' order by e.perguntado_em)
    into v
    from encaixes e
    join clientes c on c.id = e.cliente_id
    left join agendamentos f on f.id = e.falta_agendamento_id
    left join clientes cf on cf.id = f.cliente_id
   where e.empresa_id = p_empresa_id and e.dia = hoje_cuiaba()
     and (e.status = 'perguntado' or (e.status = 'autorizado' and e.contato_id is null));
  return coalesce(v, '(nenhuma)');
end $$;

-- A oferta de encaixe aberta desta cliente (ou null): a IA de atendimento lê na ficha ("ALÔ DE ENCAIXE")
create or replace function n8n_encaixe_da_cliente(p_empresa_id uuid, p_cliente_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare v jsonb;
begin
  if p_cliente_id is null then return null; end if;
  if not exists (select 1 from encaixes e where e.empresa_id = p_empresa_id and e.cliente_id = p_cliente_id
                   and e.status in ('autorizado', 'oferecido')) then return null; end if;
  perform encaixe_fechar_vencidos(p_empresa_id);
  select jsonb_build_object('encaixe_id', e.id, 'agendamento_id', e.agendamento_id, 'horario_original', e.horario_original,
           'janela_inicio', e.janela_inicio, 'mensagem', e.mensagem, 'enviado_em', coalesce(e.oferecido_em, e.respondido_em),
           'servico', s.nome)
    into v
    from encaixes e
    join agendamentos a on a.id = e.agendamento_id
    left join servicos s on s.id = a.servico_id
   where e.empresa_id = p_empresa_id and e.cliente_id = p_cliente_id
     and e.status in ('autorizado', 'oferecido') and e.contato_id is not null
     and e.dia = hoje_cuiaba() and a.status = 'agendado' and a.inicio = e.horario_original and a.inicio > now()
   order by e.perguntado_em desc limit 1;
  return v;
end $$;

-- A rotina de vagas (faltas-workflows.js, "Vagas para oferecer") sem as vagas de falta/atraso: essas só saem pelo
-- encaixe, com a autorização da dona. As outras (horário cancelado ou remarcado) continuam como eram.
create or replace function n8n_vagas_para_oferecer_v2(p_empresa_id uuid)
returns table (vaga_id uuid, vaga_inicio timestamptz, vaga_fim timestamptz, agendamento_id uuid, cliente_id uuid,
               nome text, telefone text, inicio_atual timestamptz, servico text)
language sql set search_path = public as $$
  select x.vaga_id, x.vaga_inicio, x.vaga_fim, x.agendamento_id, x.cliente_id, x.nome, x.telefone, x.inicio_atual, x.servico
    from n8n_vagas_para_oferecer(p_empresa_id) x
   where not exists (select 1 from vagas v where v.id = x.vaga_id and v.motivo = 'atraso')
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'encaixe_hora(timestamptz)',
    'encaixe_folga(uuid)',
    'encaixe_candidata(uuid, uuid)',
    'encaixe_fechar_vencidos(uuid)',
    'n8n_encaixe_apos_falta(uuid, text, uuid)',
    'n8n_assistente_liberar_horario_encaixe(uuid, text, uuid)',
    'n8n_assistente_status_agendamento_encaixe(uuid, text, uuid, text, numeric)',
    'n8n_assistente_chamar_para_encaixe(uuid, text, uuid, text, boolean)',
    'n8n_encaixe_registrar_saida(uuid, text, text, text, text, text)',
    'n8n_encaixe_pendente_texto(uuid)',
    'n8n_encaixe_da_cliente(uuid, uuid)',
    'n8n_vagas_para_oferecer_v2(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

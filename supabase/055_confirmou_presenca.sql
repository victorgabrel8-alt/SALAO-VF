-- 055: "confirmo" ao lembrete vai para a agenda (PDF "IA da Carol · Erros", erro 3: 9 de 9 confirmações se perderam).
-- Na véspera a cliente recebe o lembrete (contatos.tipo = 'lembrete', supabase/027) e responde "confirmo". A IA
-- agradecia, mas o app não tinha o estado "confirmou": a Caroline não sabia quem vem.
-- Só soma: coluna nova (vazia em tudo que já existe) e função nova. Quem chama é o n8n da loja com
-- "confirmou_presenca": true no loja.json (a Gleide não chama). O app mostra o selo "Confirmou".

alter table agendamentos add column if not exists confirmado_em timestamptz;

-- p_texto: a mensagem da cliente como chegou. Só conta resposta curta que confirma, sem pedir mudança.
-- Vale para o horário futuro dela que recebeu lembrete nas últimas 30 h e ainda não está confirmado.
create or replace function n8n_confirmar_presenca(p_empresa_id uuid, p_cliente_id uuid, p_texto text, p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = public as $$
declare
  v_t  text;
  v_ag uuid;
begin
  if p_cliente_id is null or p_texto is null then return jsonb_build_object('confirmado', false, 'motivo', 'sem_dados'); end if;
  v_t := lower(translate(btrim(p_texto), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'));
  if length(v_t) = 0 or length(v_t) > 160 then return jsonb_build_object('confirmado', false, 'motivo', 'texto'); end if;
  -- pede mudança, não pode, pergunta alguma coisa: não é confirmação (a IA de atendimento cuida).
  -- O "tudo bem?" do cumprimento não conta como pergunta ("Oi, tudo bem? Confirmado").
  if regexp_replace(v_t, '(tudo bem|tudo bom|td bem|td bom|como vai|como voce esta)\s*\?+', ' ', 'g') ~ '\?'
     or v_t ~ '(\mnao\M|\mn\M|\mnem\M|desmarc|cancel|remarc|reagend|\mmud|\mtroc|outro (dia|horario)|adiar|\matras|imprevisto|\mdepois\M|\mmais tarde\M|\mtalvez\M|\macho que\M|\mse der\M|\mfalt|\mmas\M|\mso posso\M|\mso consigo\M|infelizmente|\msurgiu\M|esqueci|\mvou ver\M|\mpensar\M|\mte aviso\M|\maviso\M)'
  then return jsonb_build_object('confirmado', false, 'motivo', 'texto'); end if;
  if not (v_t ~ '(\mconfirm|\msi+m+\M|^s+$|\mok|\mokay\M|\mestarei\M|\mirei\M|\mvou sim\M|\mvou estar\M|^vou[!. ]*$|\mcombinad|\mcertinho\M|\mcerto\M|\mbeleza\M|\mblz\M|\mcom certeza\M|\mpode (sim|confirmar|deixar|ser)\M|\mclaro\M|\mperfeito\M|\m(estou|to|tou) indo\M|\mta bom\M|\mtudo certo\M|\mfechado\M|\mfechou\M|\mshow\M|\mpositivo\M|\muhum\M|\maham\M|\misso\M|👍|✅|🙏|❤|🥰)')
  then return jsonb_build_object('confirmado', false, 'motivo', 'texto'); end if;

  select a.id into v_ag
    from agendamentos a
   where a.empresa_id = p_empresa_id and a.cliente_id = p_cliente_id
     and a.status = 'agendado' and a.confirmado_em is null and a.inicio > p_agora
     and exists (select 1 from contatos c
                  where c.empresa_id = p_empresa_id and c.agendamento_id = a.id and c.tipo = 'lembrete'
                    and c.criado_em > p_agora - interval '30 hours' and c.criado_em <= p_agora)
   order by a.inicio
   limit 1;
  if v_ag is null then return jsonb_build_object('confirmado', false, 'motivo', 'sem_lembrete'); end if;

  update agendamentos set confirmado_em = p_agora where id = v_ag and confirmado_em is null;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, p_cliente_id, 'atendimento', 'n8n_confirmar_presenca', 'agendamentos', v_ag,
          jsonb_build_object('texto', left(p_texto, 160)));
  return jsonb_build_object('confirmado', true, 'agendamento_id', v_ag);
end $$;

-- Horário remarcado (pela IA, pela assistente ou pelo app) perde o "Confirmou": ela confirmou o horário antigo.
-- Gatilho novo (só soma): só apaga confirmado_em, que fora desta loja fica sempre vazio.
create or replace function agendamentos_limpar_confirmacao() returns trigger language plpgsql set search_path = public as $$
begin
  if new.inicio is distinct from old.inicio then new.confirmado_em := null; end if;
  return new;
end $$;

create or replace trigger agendamentos_limpar_confirmacao before update of inicio on agendamentos
  for each row execute function agendamentos_limpar_confirmacao();

revoke all on function n8n_confirmar_presenca(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function n8n_confirmar_presenca(uuid, uuid, text, timestamptz) to service_role;

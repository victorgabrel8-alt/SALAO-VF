-- 078: a cliente diz que não vem a um horário marcado -> aviso à dona na hora, sem depender da IA.
--
-- Pedido do Victor (24/11/2026): "o que eu mais preciso tomar cuidado é a assistente, ela precisa avisar se o cliente
-- faltou". Caso da Rebeca (23/11): "amanhã eu não vou poder, tô sem condução" e ninguém avisou a Caroline. Desde 24/11 o
-- prompt manda a IA avisar (perguntar_para_gleide "AVISO…"), mas isso depende do Gemini lembrar.
--
-- Cada mensagem da cliente, logo depois de registrada, passa por esta função (nao-vem.js, só nas lojas com
-- "aviso_nao_vem": true). Ela reconhece o jeito de dizer que não vem, acha o próximo horário marcado da cliente (de 2 h
-- atrás até 10 dias) e devolve o que a dona precisa saber. Avisa UMA vez por horário a cada 12 h (registros_ia
-- acao 'aviso_nao_vem'). Sem horário marcado, ou mensagem que não diz que não vem: não faz nada.
-- Só soma: função nova; nada da Gleide usa.

create or replace function public.n8n_cliente_nao_vem(p_empresa_id uuid, p_cliente_id uuid, p_texto text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  t  text;
  ag record;
begin
  if p_cliente_id is null or p_texto is null or length(p_texto) > 1500 then
    return jsonb_build_object('avisar', false);
  end if;
  -- minúsculo e sem acento; áudio chega como "[áudio] …"
  t := lower(translate(p_texto, 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc'));
  -- "não vou poder pagar o sinal agora" fala do pagamento, não do horário
  t := regexp_replace(t, '\m(nao|n)\s+(vou|vo|consigo|posso)\s+(poder\s+|conseguir\s+)?(pagar|mandar|enviar|transferir|fazer\s+o\s+(pix|sinal))\M', ' ', 'g');
  if not (
       t ~ '\m(nao|n|nem)\s+(vou|vo|vai|consigo|consegui|posso|podemos|vamos)\s+(mais\s+)?(poder|conseguir|ir|comparecer|chegar|dar|vir|estar)\M'
    or t ~ '\m(nao|n|nem)\s+(vai|vou)\s+(dar|rolar)\M'
    or t ~ '\m(nao|n)\s+(da|dara|vai\s+dar)\s+(pra|para|pa)\s+(ir|mim|eu|vir|hoje|amanha)\M'
    or t ~ '\m(nao|n)\s+vou\s+mais\M'
    or t ~ '\m(desmarcar|desmarca|desmarque|cancelar|cancela|cancele|remarcar|remarca|remarque|reagendar|reagenda)\M'
    or t ~ '\m(imprevisto|vou\s+faltar|vou\s+ter\s+que\s+faltar)\M'
    or t ~ '\msem\s+(conducao|carro|carona|transporte|moto)\M'
  ) then
    return jsonb_build_object('avisar', false);
  end if;

  select a.id, a.inicio, c.nome, p.nome as profissional, s.nome as servico into ag
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    left join profissionais p on p.id = a.profissional_id
    left join servicos s on s.id = a.servico_id
   where a.empresa_id = p_empresa_id and a.cliente_id = p_cliente_id and a.status = 'agendado'
     and a.inicio between now() - interval '2 hours' and now() + interval '10 days'
   order by a.inicio limit 1;
  if not found then return jsonb_build_object('avisar', false, 'motivo', 'sem horário marcado'); end if;

  -- um aviso por horário a cada 12 h: a cliente manda várias mensagens seguidas ("não vou poder", "desculpa", "imprevisto")
  if exists (select 1 from registros_ia r where r.registro_id = ag.id and r.acao = 'aviso_nao_vem' and r.criado_em > now() - interval '12 hours') then
    return jsonb_build_object('avisar', false, 'motivo', 'já avisado');
  end if;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, p_cliente_id, 'atendimento', 'aviso_nao_vem', 'agendamentos', ag.id, jsonb_build_object('texto', left(p_texto, 300)));

  return jsonb_build_object('avisar', true, 'agendamento_id', ag.id, 'nome', ag.nome, 'inicio', ag.inicio,
    'profissional', ag.profissional, 'servico', ag.servico, 'texto', left(p_texto, 300));
end $$;

revoke all on function public.n8n_cliente_nao_vem(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.n8n_cliente_nao_vem(uuid, uuid, text) to service_role;

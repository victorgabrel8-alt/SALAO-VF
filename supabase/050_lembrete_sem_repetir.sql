-- Função nova (só soma): o lembrete não repete o combinado que a cliente acabou de ouvir.
-- 14/11/2026, Gleide: a cliente marcou com a IA às 14:46 para o dia seguinte, ouviu na conversa o combinado
-- (horário só dela, pontualidade, sinal) e às 18h do mesmo dia recebeu o lembrete da véspera com o mesmo texto.
-- Pedido do Victor: esse segundo aviso não precisa, não fica profissional.
--   1. horário marcado pela IA HOJE para outro dia (a partir das 9h): o lembrete da véspera não sai; ela recebe o
--      lembrete do próprio dia (de 4 h a 45 min antes). Horário antes das 9h continua com o da véspera, porque a
--      rotina só roda a partir das 8h e o do dia não daria tempo.
--   2. "curto" = marcado pela IA há menos de 24 h: o texto do lembrete vai sem repetir o combinado.
-- Horário marcado pela dona (app ou assistente) não muda: a cliente não ouviu o combinado da IA.
-- A regra de quem recebe continua em n8n_lembretes_para_mandar (supabase/027); aqui só o filtro a mais.
create or replace function public.n8n_lembretes_sem_repetir(p_empresa_id uuid, p_agora timestamptz default now())
returns table(agendamento_id uuid, cliente_id uuid, nome text, telefone text, inicio timestamptz, servico text,
              online boolean, endereco text, curto boolean)
language sql stable set search_path to 'public' as $$
  select l.agendamento_id, l.cliente_id, l.nome, l.telefone, l.inicio, l.servico, l.online, l.endereco,
         (a.origem = 'ia' and a.criado_em > p_agora - interval '24 hours')
    from n8n_lembretes_para_mandar(p_empresa_id, p_agora) l
    join agendamentos a on a.id = l.agendamento_id
   where not (a.origem = 'ia'
              and (a.criado_em at time zone 'America/Cuiaba')::date = (p_agora at time zone 'America/Cuiaba')::date
              and (l.inicio at time zone 'America/Cuiaba')::date > (p_agora at time zone 'America/Cuiaba')::date
              and (l.inicio at time zone 'America/Cuiaba')::time >= time '09:00')
   order by l.inicio
$$;
revoke all on function public.n8n_lembretes_sem_repetir(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.n8n_lembretes_sem_repetir(uuid, timestamptz) to service_role;

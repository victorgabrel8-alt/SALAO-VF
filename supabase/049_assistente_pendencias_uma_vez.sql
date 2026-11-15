-- Função nova (só soma): a assistente pergunta cada pendência UMA vez só, e junta as perguntas em poucos momentos do dia
-- (p_horas, hora de Cuiabá; padrão 12h e 18h). "Não chegou, veio ou libera?" (atraso_confirmar) continua saindo na hora,
-- também uma vez. Usada pela Gleide e pelas lojas (ver n8n/demo-agente/pendencias-loja.js); a função antiga,
-- n8n_assistente_pendencias_novas (na hora, +1 h e +2 h), fica no banco sem uso.
create or replace function public.n8n_assistente_pendencias_uma_vez(p_empresa_id uuid, p_horas integer[] default '{12,18}')
returns setof pendencias_gleide language sql stable set search_path to 'public' as $$
  select p.* from pendencias_gleide p
   where p.empresa_id = p_empresa_id
     and p.perguntado_em is null
     and (p.tipo = 'atraso_confirmar'
          or extract(hour from now() at time zone 'America/Cuiaba')::int = any (p_horas))
   order by p.inicio nulls last
$$;
revoke all on function public.n8n_assistente_pendencias_uma_vez(uuid, integer[]) from public, anon, authenticated;
grant execute on function public.n8n_assistente_pendencias_uma_vez(uuid, integer[]) to service_role;

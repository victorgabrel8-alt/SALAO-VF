-- Ligação recebida no WhatsApp do salão (só soma: tabela nova e função nova).
-- 15/11/2026, pedido do Victor: a IA precisa saber o que fazer quando a cliente liga. Até aqui a ligação era recusada
-- com uma mensagem automática repetida, que ainda pausava a IA por 12 h, e ninguém ficava sabendo.
-- Agora cada ligação é anotada aqui e a função diz ao n8n (n8n/demo-agente/ligacao.js) o que fazer:
--   responder: só a primeira ligação a cada 10 minutos recebe a mensagem da IA (ela pode ligar 3 vezes seguidas);
--   avisar:    a dona só é avisada se a cliente tem horário nas próximas 24 h, ou se ligou 3 vezes em meia hora;
--   horário:   o próximo horário marcado, para a IA responder com contexto ("é sobre o seu horário de hoje às 14h?").
create table if not exists public.ligacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  telefone text not null,
  cliente_id uuid references public.clientes(id) on delete set null,
  respondida boolean not null default false,
  avisou_dona boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists ligacoes_empresa_telefone_idx on public.ligacoes (empresa_id, telefone, criado_em desc);
alter table public.ligacoes enable row level security;  -- sem política: só o n8n (service_role) lê e grava por enquanto

create or replace function public.n8n_ligacao_recebida(p_empresa_id uuid, p_telefone text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_sem9 text;
  v_cli record;
  v_inicio timestamptz;
  v_servico text;
  v_online boolean := false;
  v_10 int;
  v_30 int;
  v_responder boolean;
  v_avisar boolean;
begin
  if v_tel = '' then return jsonb_build_object('responder', false, 'avisar', false); end if;
  -- duas "ofertas" da mesma ligação chegam quase juntas: uma de cada vez
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || v_tel, 0));
  -- o WhatsApp manda 2 ou 3 sinais para a MESMA ligação em poucos segundos: conta como uma só
  if exists (select 1 from ligacoes l where l.empresa_id = p_empresa_id and l.telefone = v_tel and l.criado_em > now() - interval '30 seconds') then
    return jsonb_build_object('responder', false, 'avisar', false, 'mesma_ligacao', true);
  end if;
  v_sem9 := regexp_replace(v_tel, '^(55\d{2})9(\d{8})$', '\1\2');
  select c.id, c.nome, (c.ia_pausada_ate is not null and c.ia_pausada_ate > now()) pausada into v_cli
    from clientes c where c.empresa_id = p_empresa_id and regexp_replace(c.telefone, '\D', '', 'g') in (v_tel, v_sem9)
   order by (c.nome is not null) desc, c.criado_em limit 1;
  if v_cli.id is not null then
    select a.inicio, s.nome servico, coalesce(s.nome ilike '%online%', false) online into v_inicio, v_servico, v_online
      from agendamentos a left join servicos s on s.id = a.servico_id
     where a.empresa_id = p_empresa_id and a.cliente_id = v_cli.id and a.status = 'agendado'
       and a.inicio > now() - interval '1 hour' and a.inicio < now() + interval '24 hours'
     order by a.inicio limit 1;
  end if;
  select count(*) filter (where l.criado_em > now() - interval '10 minutes'), count(*) + 1 into v_10, v_30
    from ligacoes l where l.empresa_id = p_empresa_id and l.telefone = v_tel and l.criado_em > now() - interval '30 minutes';
  v_responder := v_10 = 0;
  v_avisar := (v_responder and v_inicio is not null) or v_30 = 3;
  insert into ligacoes (empresa_id, telefone, cliente_id, respondida, avisou_dona)
  values (p_empresa_id, v_tel, v_cli.id, v_responder, v_avisar);
  return jsonb_build_object(
    'responder', v_responder, 'avisar', v_avisar, 'chamadas', v_30,
    'cliente_id', v_cli.id, 'nome', v_cli.nome, 'pausada', coalesce(v_cli.pausada, false),
    'inicio', v_inicio, 'servico', v_servico, 'online', coalesce(v_online, false),
    -- avaliação por ligação: de 30 min antes a 1 h depois do horário, ela está esperando a ligação da profissional
    'hora_da_online', coalesce(v_online and v_inicio between now() - interval '1 hour' and now() + interval '30 minutes', false));
end $$;
revoke all on function public.n8n_ligacao_recebida(uuid, text) from public, anon, authenticated;
grant execute on function public.n8n_ligacao_recebida(uuid, text) to service_role;

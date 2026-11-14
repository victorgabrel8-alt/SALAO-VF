-- Motor único: gravar os ajustes da loja feitos pela agência (painel, tela Lojas) sem regravar a config inteira.
-- Só soma: uma função nova.
--
-- O painel lia a config, mudava e gravava tudo de volta: se a dona salvasse horário ou recado no app nesse
-- meio-tempo, a mudança dela sumia. Esta função troca, numa instrução só, apenas:
--   - config.ia          (p_ia entra por cima; as chaves de p_ia_remover saem)
--   - config.loja.sinal_pix (p_sinal entra por cima; null = não mexe)
-- e só em loja que está no motor (config.ia.motor = true). Devolve true se gravou.
-- config.ia.motor não pode ser mudado por aqui.

create or replace function motor_configurar(
  p_empresa_id uuid,
  p_ia jsonb default '{}'::jsonb,
  p_ia_remover text[] default '{}'::text[],
  p_sinal jsonb default null
)
returns boolean
language plpgsql
volatile
set search_path = public
as $$
begin
  if jsonb_typeof(coalesce(p_ia, '{}'::jsonb)) <> 'object' or (p_sinal is not null and jsonb_typeof(p_sinal) <> 'object') then
    raise exception 'motor_configurar: p_ia e p_sinal precisam ser objetos';
  end if;

  update empresas e
  set config = jsonb_set(
    jsonb_set(e.config, '{ia}', ((e.config->'ia') || (coalesce(p_ia, '{}'::jsonb) - 'motor')) - array_remove(coalesce(p_ia_remover, '{}'::text[]), 'motor')),
    '{loja}',
    case
      when p_sinal is null then coalesce(e.config->'loja', '{}'::jsonb)
      else coalesce(e.config->'loja', '{}'::jsonb)
           || jsonb_build_object('sinal_pix', coalesce(e.config->'loja'->'sinal_pix', '{}'::jsonb) || p_sinal)
    end
  )
  where e.id = p_empresa_id
    and e.config->'ia'->>'motor' = 'true';

  return found;
end;
$$;

revoke all on function motor_configurar(uuid, jsonb, text[], jsonb) from public, anon, authenticated;
grant execute on function motor_configurar(uuid, jsonb, text[], jsonb) to service_role;

-- =====================================================================
-- 021_mega_hair_valor_unico.sql — aplicado no Supabase em 27/10/2026
-- Pedido do Victor: um valor só de mão de obra para aplicação e manutenção de mega hair,
-- qualquer técnica: a partir de R$ 350. A remoção entra nesse valor (sai da lista).
--   - Aplicação de mega hair – mão de obra: R$ 450 -> R$ 350
--   - Manutenção por técnica (queratina, tela adesiva, tela costurada / ponto americano) e
--     Remoção de mega hair: desativados (horários antigos continuam apontando para eles)
--   - novo "Manutenção de mega hair – mão de obra": R$ 350, 120 min, retorno 60 dias
--   - aplicação e manutenção na mesma linha "Mega hair": uma cumpre o retorno da outra
-- =====================================================================

update servicos set preco = 350, linha = 'Mega hair'
 where id = '5e36db8b-442d-4cdc-8a83-2217be9222f2';

update servicos set ativo = false
 where id in ('c22832f4-b71e-4c35-ae5b-58c92abcac13',  -- Manutenção – queratina
              '97a95149-e229-4b4d-9f1c-4eda80303c3e',  -- Manutenção – tela adesiva
              '23e40a8c-afab-449c-bbf8-3f996bb946d8',  -- Manutenção – tela costurada / ponto americano
              '57d626d7-c0fb-4c1f-a583-360d2c25390b'); -- Remoção de mega hair

insert into servicos (empresa_id, nome, preco, duracao_min, dias_retorno, ativo, categoria, linha, a_partir_de)
select '00000000-0000-0000-0000-000000000001', 'Manutenção de mega hair – mão de obra', 350, 120, 60, true, 'manutencao', 'Mega hair', true
 where not exists (select 1 from servicos where empresa_id = '00000000-0000-0000-0000-000000000001'
                    and nome = 'Manutenção de mega hair – mão de obra');

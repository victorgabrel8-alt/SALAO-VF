# Checklist de entrega — segunda, 26/10/2026

## Antes de ir ao salão (domingo)
- [ ] Todos os cenários de teste dos dois prompts passaram
- [ ] Salão Demo apagado; salão real criado (`supabase/manual/criar_salao_producao.sql`)
- [ ] Serviços com preço, duração e **dias de retorno** conferidos com a dona
- [ ] App OAuth do Google em **"Em produção"** (senão para de agendar em 7 dias) e autorização refeita depois da mudança
- [ ] Alerta de erro do n8n chegando no WhatsApp do Victor
- [ ] Backup: exportar workflows do n8n para `/n8n` e fazer commit
- [ ] Backup do banco: o Supabase grátis **não** faz backup diário — criar um fluxo semanal no n8n que exporta as tabelas (ou subir para o plano Pro quando houver mais salões)
- [ ] Login da dona criado no Supabase e testado no CRM
- [ ] Monitor de disponibilidade (ex.: UptimeRobot) no n8n

## No salão
- [ ] Conectar o número do salão (Cloud API com coexistência, ou plano B)
- [ ] Instalar o CRM no iPhone dela: Safari → Compartilhar → **Adicionar à Tela de Início**
- [ ] Fazer login com ela e deixar salvo
- [ ] **Testar o botão "Responder no WhatsApp" no iPhone dela** — abre o **Business** e não o pessoal?
- [ ] Ela manda uma mensagem de outro celular e vê a IA respondendo e aparecendo no app
- [ ] Mostrar: Precisam de você · Pausar/Reativar IA · Registrar atendimento · Mandar alô
- [ ] Explicar: **marcar "Realizado"** em cada atendimento é o que faz as listas de retorno funcionarem
- [ ] Combinar o período de ajuste (primeira semana olhando as conversas da IA)
- [ ] Combinar o canal de suporte (quem ela chama se algo der errado)

## Primeira semana
- [ ] Ler as conversas da IA todo dia e ajustar o prompt
- [ ] Conferir se os atendimentos estão sendo marcados como realizados
- [ ] Anotar o que ela pedir na lista "Depois de segunda" do `CONTRATO.md`

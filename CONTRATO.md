# CONTRATO — Atendimento (n8n) ⇄ CRM (app)

Este arquivo é o acordo entre as duas partes do projeto. **O banco do Supabase é a única ligação entre o n8n e o CRM.** Se algo aqui mudar, atualize este arquivo no mesmo commit e avise no grupo.

| Parte | Responsável | Pasta |
|---|---|---|
| Atendimento (IA no WhatsApp) | Victor | `/n8n` |
| App da dona (Início, Conversas, Agenda) | José Paulo | `/crm` |
| Painel CRM da agência (clientes, IA de retorno) | José Paulo | `/painel-crm` |
| Banco (guardião) | [definir: um só] | `/supabase` |

---

## 1. Regras de convivência

1. **Ninguém altera o banco sozinho.** Precisa de campo ou tabela nova? Pede no grupo → o guardião escreve um novo arquivo `supabase/00X_descricao.sql`, roda no SQL Editor, faz commit e atualiza este contrato.
2. **Nunca editar um arquivo `.sql` que já foi rodado.** Mudança = arquivo novo com o próximo número.
3. **Ideia nova vai para a lista "Depois de segunda"** (seção 7), não para o código.
4. **Segredos nunca vão para o GitHub.** Chaves ficam em `.env` (já está no `.gitignore`).
5. **Nada vai para o número da dona sem os dois testarem juntos.**

---

## 2. Formatos combinados

| Dado | Formato | Exemplo |
|---|---|---|
| Telefone | só números, `55` + DDD + número | `5566999998888` |
| Datas/horas | `timestamptz` (o banco guarda em UTC) | o app mostra em `America/Cuiaba` |
| "Hoje" | sempre no fuso do salão | função `hoje_cuiaba()` |
| Empresa | todo registro tem `empresa_id` | demo: `00000000-0000-0000-0000-000000000001` |
| Número de alerta | `empresas.config.whatsapp_alerta`, mesmo formato do telefone (ou `null`) | `5566996834918` (José Paulo, até configurar o da dona) |
| Horário de almoço | `empresas.config.almoco = {"inicio":"11:00","fim":"13:00"}` (sem nada salvo, o app usa 11:00–13:00; `null` desliga). O app não deixa marcar/reagendar nesse intervalo; **a IA também não deve oferecer esses horários** | `{"inicio":"11:00","fim":"13:00"}` |
| Dias sem atender | `empresas.config.bloqueios = [{"de":"AAAA-MM-DD","ate":"AAAA-MM-DD","motivo":"Viagem"}]` (datas inclusivas; a dona cria e remove em Agenda › Próximas › Dias sem atender). O app não oferece horário nesses dias e **a IA também não** (`agenda-calculo.js` zera o expediente do dia). Bloquear não desmarca quem já estava marcado | `[{"de":"2026-11-10","ate":"2026-11-15","motivo":"Viagem"}]` |
| Limite do celular | `empresas.config.dias_limite_celular` (padrão 30): no celular da dona, atrasadas há mais que isso (contando da **data de retorno**) só aparecem no CRM do computador | `30` |

---

## 3. Tabelas (resumo — o detalhe está em `supabase/001_schema.sql`)

| Tabela | Quem ESCREVE | Quem LÊ | Para quê |
|---|---|---|---|
| `empresas` | guardião (config pelo CRM) | os dois | dados e configurações do salão (`config`) |
| `usuarios_empresa` | guardião | CRM | quem pode logar no CRM de cada salão |
| `profissionais` | CRM | os dois | quem atende; `google_calendar_id` usado pela IA |
| `servicos` | CRM | os dois | preço, duração, **`dias_retorno`** |
| `clientes` | n8n (cria) e CRM (cria e edita) | os dois | cadastro; **`ia_pausada_ate`** controla a IA |
| `agendamentos` | n8n (`origem='ia'`) e CRM (`origem='manual'` e mudança de status) | os dois | horários e atendimentos |
| `mensagens` | **só o n8n** (pelas funções abaixo) | CRM | histórico das conversas do WhatsApp |
| `contatos` | CRM (botão "Mandar alô") | CRM | registro de cada vez que a cliente foi chamada |

### Views prontas para o CRM (só leitura)
- **`clientes_status`** — cada cliente com `ultima_visita`, `dias_sem_visita`, `proximo_agendamento`, `retorno_previsto`, `ultimo_contato`, `ia_pausada` e **`status`**.
- **`retornos_por_servico`** — última vez de cada serviço por cliente e o retorno previsto (para a ficha).
- **`conversas`** — última mensagem de cada cliente (para a aba Conversas).

### Funções só do n8n (o CRM **não** tem permissão para chamar)
- **`n8n_registrar_entrada(empresa_id, telefone, nome, conteudo, tipo, wa_message_id)`** — mensagem que a **cliente** mandou. Cria a cliente se for nova, grava a mensagem e devolve `{cliente_id, nome, ia_pausada, nova_cliente}`.
- **`n8n_registrar_saida(empresa_id, telefone, conteudo, autor, tipo, wa_message_id, pausar_horas, motivo_pausa)`** — mensagem **enviada** pela IA (`autor='ia'`) ou pela dona no WhatsApp Business (`autor='humano'`). Com `pausar_horas > 0`, pausa a IA para aquela cliente. Se o `wa_message_id` já existe (eco de mensagem que a própria IA mandou), não grava nem pausa e devolve `{duplicada: true}`.

---

## 4. Regras de negócio (o banco já faz sozinho)

**Status da cliente** (`clientes_status.status`):

| Status | Cor no app | Regra |
|---|---|---|
| `em_dia` | 🟢 | tem horário futuro, ou o retorno ainda está longe |
| `retorno_chegando` | 🟡 | retorno previsto nos próximos 7 dias (`config.dias_retorno_chegando`) |
| `retorno_atrasado` | 🟠 | passou da data de retorno e não marcou |
| `inativa` | 🔴 | mais de 90 dias sem vir (`config.dias_inativa`) e sem horário |
| `sem_visita` | ⚪ | nunca teve atendimento realizado (só conversou) |

**Status manual (só no Painel CRM, sem mudar o banco):** no Quadro dá para arrastar a cliente para **Atrasadas**, **Retorno chegando** ou **Inativas**. O CRM grava duas etiquetas internas, `sistema:status:<status>` e `sistema:status_em:<data>`, e o Painel mostra esse status no lugar do calculado **até a cliente marcar horário ou voltar ao salão** depois da mudança. `clientes_status.status` continua sendo o automático: a IA e o app do salão não enxergam o status manual.

**Retorno previsto:** quando um agendamento vira `realizado`, o banco calcula `data do atendimento + servicos.dias_retorno`. Se o status sair de `realizado`, o retorno é apagado.

**Fim do agendamento:** se `fim` vier vazio, o banco calcula pela duração do serviço.

**Contatos:** quando a cliente manda mensagem depois de um "alô" pendente, o contato vira `respondeu`; quando ela agenda em até 14 dias, vira `agendou`. É assim que mostramos quantas voltaram.

> ⚠️ Tudo isso só funciona se os atendimentos forem marcados como **realizado**. Por isso o CRM precisa do botão rápido **"Registrar atendimento"** (cliente que chegou sem agendar).

---

## 5. Pontos de integração (onde um depende do outro)

| Situação | n8n faz | CRM faz |
|---|---|---|
| Mensagem chega | chama `n8n_registrar_entrada`; se `ia_pausada = true`, **não responde** | mostra em tempo real (Realtime na tabela `mensagens`) |
| IA responde | envia e chama `n8n_registrar_saida(..., autor='ia', wa_message_id do envio)` | mostra o balão como "IA" |
| Cliente pede humano / reclama / fora do escopo | grava a resposta da IA com `n8n_registrar_saida(..., autor='ia', pausar_horas=12, motivo_pausa='pediu_humano')` (ou `reclamacao`, `fora_escopo`) **e manda um WhatsApp para `empresas.config.whatsapp_alerta`** com nome, telefone da cliente e o que ela pediu (desde 23/10/2026: workflow "Pausar IA" → "Avisar a dona no WhatsApp"; sem número cadastrado, só pausa) | mostra em **"Precisam de você"** no Início, com botão para abrir o WhatsApp da cliente; o número de alerta é editado em **Configurações → WhatsApp para alertas** |
| Dona responde pelo WhatsApp Business | chama `n8n_registrar_saida(..., autor='humano', pausar_horas=12)` (motivo vira `dona_respondeu`) | mostra o balão como "Você" |
| Dona aperta "Pausar IA" / "Reativar IA" | lê `ia_pausada_ate` antes de cada resposta | grava `ia_pausada_ate` (`now()+12h` ou `null`) e `motivo_pausa='manual'` |
| IA agenda | grava em `agendamentos` (`origem='ia'`); sem Google Agenda desde 23/10/2026 (a agenda é só a do app) | mostra na Agenda |
| Dona marca realizado/faltou/cancelado | — | atualiza `agendamentos.status` |
| Dona cancela pelo CRM | — (a IA lê o status em `agendamentos`; não há Google Agenda para apagar) | atualiza `agendamentos.status` |
| Dona altera serviço/preço | lê `servicos` a cada conversa (preço sempre atualizado) | edita `servicos` |

---

## 6. Ambiente

| Item | Onde |
|---|---|
| Supabase | um projeto só, os dois convidados em Organization → Team |
| URL e chaves | Project Settings → API |
| n8n | usa **service_role key** (acesso total — nunca no navegador) |
| CRM | usa **anon key** + login da dona (RLS protege os dados) |
| Dados de teste | `002_seed_dev.sql` cria o "Salão Demo"; na sexta, apagar com `delete from empresas where id = '00000000-0000-0000-0000-000000000001';` |

---

## 7. Depois de segunda (não fazer agora)

- Responder pelo app (hoje: botão abre o WhatsApp Business)
- Notificações push no iPhone
- Envio automático de retorno/reativação pela IA (templates pagos da API oficial). **Combinado:** a dona não manda alô pelo celular; uma IA chama a cliente na data do retorno. Cada envio deve gravar uma linha em `contatos` com `canal='ia'` e `tipo='retorno'` ou `'reativacao'` — assim o CRM mostra "Chamada há X dias" e o banco marca sozinho `respondeu`/`agendou`. O botão "Mandar alô" fica só no CRM do computador, como plano B manual.
- **IA alimentando o CRM** (IA agenda com a intenção no card, ✓ da Gleide com "Foi isso" / "Mudou algo" / resultado da avaliação, serviços por técnica com retorno próprio; assistente no WhatsApp fica opcional): plano em `docs/PLANO-IA-ALIMENTA-CRM.md`, banco em `supabase/004_avaliacoes_ia_RASCUNHO.sql` e serviços em `supabase/manual/servicos_toda_bonita_RASCUNHO.sql` (aguardando o guardião; dias de retorno provisórios). O que entra antes de segunda está na seção "Ordem" do plano. Quando o 004 rodar, atualizar as seções 3 e 5 deste contrato.
- Aniversários, campanhas, relatórios
- Cancelar no CRM apagando também do Google Agenda
- Comissão, estoque, financeiro
- Vários salões funcionando (o banco já está preparado)
- _(adicione aqui as ideias que surgirem)_

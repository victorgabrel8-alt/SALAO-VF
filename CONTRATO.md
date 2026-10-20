# CONTRATO — Atendimento (n8n) ⇄ CRM (app)

Este arquivo é o acordo entre as duas partes do projeto. **O banco do Supabase é a única ligação entre o n8n e o CRM.** Se algo aqui mudar, atualize este arquivo no mesmo commit e avise no grupo.

| Parte | Responsável | Pasta |
|---|---|---|
| Atendimento (IA no WhatsApp) | Victor | `/n8n` |
| CRM (app da dona) | [nome do amigo] | `/crm` |
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
| Cliente pede humano / reclama / fora do escopo | grava a resposta da IA com `n8n_registrar_saida(..., autor='ia', pausar_horas=12, motivo_pausa='pediu_humano')` (ou `reclamacao`, `fora_escopo`) **e manda um WhatsApp para `empresas.config.whatsapp_alerta`** com nome, telefone da cliente e o que ela pediu | mostra em **"Precisam de você"** no Início, com botão para abrir o WhatsApp da cliente; o número de alerta é editado em **Configurações → WhatsApp para alertas** |
| Dona responde pelo WhatsApp Business | chama `n8n_registrar_saida(..., autor='humano', pausar_horas=12)` (motivo vira `dona_respondeu`) | mostra o balão como "Você" |
| Dona aperta "Pausar IA" / "Reativar IA" | lê `ia_pausada_ate` antes de cada resposta | grava `ia_pausada_ate` (`now()+12h` ou `null`) e `motivo_pausa='manual'` |
| IA agenda | cria evento no Google Agenda **e** grava em `agendamentos` (`origem='ia'`, `google_event_id`) | mostra na Agenda |
| Dona marca realizado/faltou/cancelado | — | atualiza `agendamentos.status` |
| Dona cancela pelo CRM | — (por enquanto **não** apaga do Google) | avisa na tela: "apague também do Google Agenda" |
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
- Envio automático de retorno/reativação pela IA (templates pagos da API oficial)
- Aniversários, campanhas, relatórios
- Cancelar no CRM apagando também do Google Agenda
- Comissão, estoque, financeiro
- Vários salões funcionando (o banco já está preparado)
- _(adicione aqui as ideias que surgirem)_

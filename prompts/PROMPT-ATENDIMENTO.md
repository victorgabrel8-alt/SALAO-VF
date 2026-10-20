# Prompt para o Claude Code — Atendimento (secretária de IA no WhatsApp)

> Cole este texto no Claude Code, aberto na raiz do repositório `salao-ia`.
> Preencha a seção **Dados do salão** no final antes de enviar.

---

## Contexto

Sou o Victor. Presto serviço de marketing (Google Ads, Google Perfil, site) para empresas locais e fechei com uma dona de salão de beleza. **Entrega na segunda-feira, 26/10/2026**, em dupla:
- **Parte A (eu, você está me ajudando):** secretária de IA no WhatsApp do salão, no **n8n**. Responde dúvidas, informa preços, agenda horários e passa para humano quando preciso.
- **Parte B (meu amigo):** CRM (app) onde a dona acompanha clientes e conversas. Ele lê os dados que eu gravo.

O banco já existe no Supabase. **Não altere a estrutura do banco.** Leia `CONTRATO.md` e `supabase/001_schema.sql` antes de começar: lá estão as tabelas, as funções `n8n_registrar_entrada` e `n8n_registrar_saida` (chame pela API do Supabase: `POST /rest/v1/rpc/<nome>` com a service_role key) e as regras de integração com o CRM. Se precisar de algo novo no banco, pare e me diga o SQL.

## Infra

- VPS (Hostinger ou Hetzner) com **Easypanel**
- No Easypanel: **n8n** e **Redis** (e **Evolution API v2 + Postgres**, só se formos para o plano B)
- **Supabase** (cloud) como banco central, acessado pelo n8n com a **service_role key**
- LLM: **Gemini Flash** (Google AI Studio), também para transcrever áudio
- **Google Agenda** para os horários (uma agenda por profissional: `profissionais.google_calendar_id`)
- Fuso: `America/Cuiaba`. Idioma: português do Brasil.
- Workflows exportados em JSON na pasta `/n8n` do repositório.

## Canal do WhatsApp: API oficial com plano B

A dona usa o **WhatsApp Business (app)** no número do salão e quer continuar usando o app. Plano:
- **Plano A — API oficial da Meta (Cloud API) com Coexistência:** o mesmo número continua no app Business e conecta na API. Mensagens enviadas pelo app chegam como eco no webhook (para pausarmos a IA). Me guie no cadastro: conta empresarial da Meta, app no painel de desenvolvedores, número, webhook, token permanente, e qual caminho de cadastro a Coexistência exige (parceiro/BSP ou Tech Provider). **Isso tem prazo fora do nosso controle, então é a primeira coisa a fazer.**
- **Plano B — Evolution API:** se a Meta não liberar até sábado, entregamos com a Evolution conectada ao app Business por QR code e migramos depois.

**Arquitetura obrigatória:** separe o canal da inteligência.
- Workflow **"Canal - Entrada"**: recebe o webhook (Cloud API ou Evolution) e converte para um formato único:
  `{ telefone, nome, tipo, conteudo, midia_id, wa_message_id, de_mim }`
- Workflow **"Agente"**: só trabalha com esse formato único.
- Workflow **"Canal - Envio"**: recebe `{ telefone, texto }` e envia pelo canal ativo.

Trocar Evolution ↔ Cloud API deve significar mexer só nos workflows de canal.

## Escopo (somente isto)

### Fase 1 — Infra (terça)
- Easypanel com n8n + Redis no ar, com HTTPS.
- Credenciais no n8n: Supabase (service_role), Gemini, Redis.
- Iniciar o cadastro na Meta (plano A).
- Workflow de canal recebendo mensagens do **meu número** de teste.

### Fase 2 — Agente (quarta)
- Ignorar grupos, status e broadcast.
- Para cada mensagem recebida: chamar `n8n_registrar_entrada(empresa_id, telefone, nome, conteudo, tipo, wa_message_id)`.
  - Se `ia_pausada = true`: **parar** (não responder).
- **Buffer:** juntar mensagens seguidas da mesma pessoa (~8 segundos, Redis) antes de chamar a IA.
- **Agente:** nó AI Agent do n8n + Gemini Flash, memória curta por telefone (últimas ~20 mensagens), prompt de sistema abaixo.
  - Serviços, preços e durações lidos da tabela `servicos` a cada conversa (preço sempre atualizado).
  - Horário, endereço, pagamento e regras lidos de `empresas.config`.
- **Resposta humanizada:** marcar como lida, "digitando..." proporcional ao tamanho, quebrar em até 2–3 mensagens.
- **Gravar cada resposta** com `n8n_registrar_saida(empresa_id, telefone, conteudo, 'ia', 'texto', wa_message_id)`, usando o `wa_message_id` que o canal devolve ao enviar. Assim, quando o WhatsApp mandar o eco dessa mesma mensagem, a função reconhece como duplicada e **não** pausa a IA.

### Fase 3 — Agenda (quinta)
Tools do agente:
- `consultar_horarios_livres(servico, data, profissional opcional)` → lê o Google Agenda e devolve 2–3 opções dentro do horário de funcionamento, respeitando a duração do serviço.
- `criar_agendamento(nome, servico, profissional, inicio)` → cria o evento no Google Agenda **e** grava em `agendamentos` com `origem='ia'`, `status='agendado'` e `google_event_id`. Atualiza `clientes.nome` se estava vazio.
- Me guie no OAuth do Google Cloud Console (faço manualmente). **O app OAuth precisa estar "Em produção"**, não em "Teste", senão o token expira em 7 dias. (Vai aparecer um aviso de "app não verificado" ao autorizar: é normal para uso próprio, basta avançar.)

### Fase 4 — Áudio, humano e alertas (sexta)
- **Áudio:** baixar a mídia pelo canal, transcrever com Gemini, gravar a transcrição em `mensagens` (`tipo='audio'`) e tratar como texto.
- **Transferência para humano:** se a cliente pedir para falar com alguém, reclamar ou sair do escopo, o agente avisa e grava a resposta com `n8n_registrar_saida(..., 'ia', ..., p_pausar_horas => 12, p_motivo_pausa => 'pediu_humano')` (ou `'reclamacao'`, `'fora_escopo'`).
- **Dona respondeu pelo app Business** (`de_mim = true`): chamar `n8n_registrar_saida(empresa_id, telefone, conteudo, 'humano', tipo, wa_message_id, 12)`. Se voltar `duplicada: true`, era o eco de uma mensagem da própria IA: ignorar. Caso contrário, a IA fica pausada 12h para aquela cliente (`motivo_pausa='dona_respondeu'`).
- **Alerta:** workflow de erro do n8n que me manda uma mensagem no meu WhatsApp quando qualquer workflow falhar.

### Fase 5 — Integração e testes (sexta à noite)
- Junto com o CRM: apagar o Salão Demo, rodar `supabase/manual/criar_salao_producao.sql`, configurar o `EMPRESA_ID` real.
- Rodar todos os cenários de teste abaixo.
- Exportar todos os workflows para `/n8n` (sem credenciais) e fazer commit.

### Fase 6 — Entrega (segunda)
- Conectar o número do salão (Cloud API ou plano B).
- Acompanhar as primeiras conversas ao vivo.

## Fora do escopo (não fazer agora)

Envio automático de retorno/reativação, lembretes automáticos de horário, campanhas, cancelar/remarcar pela IA (por enquanto ela passa para humano), multi-salão funcionando, relatórios. Se achar que algo é necessário, me pergunte.

## Cenários de teste

1. Preço de serviço que existe e de um que não existe.
2. 3 mensagens seguidas rápidas → responde uma vez só.
3. Agendar para amanhã à tarde → aparece no Google Agenda **e** no CRM (aba Agenda).
4. Pedir horário com o salão fechado.
5. Áudio pedindo horário.
6. "Quero falar com a dona" → pausa e aparece em "Precisam de você" no CRM.
7. Responder manualmente pelo app Business → a IA para de responder aquela cliente.
8. Reativar a IA pelo CRM → ela volta a responder.
9. Cliente nova → aparece no CRM com status "sem visita".
10. Forçar um erro no workflow → chega o alerta no meu WhatsApp.

## Prompt de sistema do agente (base, pode melhorar)

```
Você é a atendente virtual do {{empresa.nome}}.
Fale como uma recepcionista simpática de salão: mensagens curtas, linguagem
natural, no máximo 1 emoji por mensagem, uma pergunta por mensagem.
Data e hora atual: {{ $now }} (America/Cuiaba).
Nome da cliente (se souber): {{cliente.nome}}

SERVIÇOS (nome – preço – duração): {{lista da tabela servicos}}
PROFISSIONAIS: {{lista da tabela profissionais}}
HORÁRIO: {{config.horario_funcionamento}}
ENDEREÇO: {{config.endereco}}
PAGAMENTO: {{config.formas_pagamento}}

REGRAS:
- Nunca invente preço, serviço, profissional ou horário. Se não souber, diga
  que vai confirmar com a equipe.
- Para agendar: pergunte o serviço, use consultar_horarios_livres, ofereça
  2–3 opções, confirme nome e horário escolhido, só então use
  criar_agendamento e confirme data, hora, serviço e profissional.
- {{config.regras_ia}}
- Se a cliente pedir para falar com uma pessoa, reclamar, pedir para
  cancelar/remarcar ou perguntar algo fora do escopo, responda
  "Vou chamar alguém da equipe pra te ajudar 😊" e acione a transferência.
```

## Dados do salão

```
[COLE AQUI: nome, cidade, serviços com preço, duração e dias de retorno,
profissionais, horários, endereço, formas de pagamento, o que a IA nunca deve fazer]
```

## Regras para você (Claude Code)

- Trabalhe por fases e pare ao fim de cada uma para eu testar no celular.
- Explique o que eu preciso fazer manualmente (Easypanel, Meta, Google Cloud, Supabase).
- Segredos só em credenciais do n8n ou `.env`, nunca em arquivos versionados.
- Prefira o simples. Se travar em algo, proponha um atalho que mantenha o prazo.

# Plano — a IA alimenta o CRM

**Objetivo:** a Gleide não digita nada no CRM. A IA preenche antes, a Gleide só confirma com um toque, e o sistema calcula o resto.
**Banco:** rascunho em [`supabase/004_avaliacoes_ia_RASCUNHO.sql`](../supabase/004_avaliacoes_ia_RASCUNHO.sql) — o guardião revisa antes de rodar.
**Serviços:** rascunho em [`supabase/manual/servicos_toda_bonita_RASCUNHO.sql`](../supabase/manual/servicos_toda_bonita_RASCUNHO.sql) — **dias de retorno provisórios**.

## A ideia: padrão automático + exceção com um toque

Mega hair não tem um caminho só. Tem cliente que faz química antes de colocar o mega, cliente que faz manutenção e selagem no mesmo dia, cliente que vem para a avaliação e já fecha. Por isso a IA **não decide sozinha**: ela segue uma base de informação e a Gleide corrige quando algo muda, com o mínimo de toques.

```
Cliente ──WhatsApp──► IA de atendimento ──► agenda + intenção no card ──┐
                        (lê a base de serviços)                          ├─► Supabase ◄── CRM
Gleide ──toca no ✓ da agenda──► "Foi isso" / "Mudou algo" / resultado ──┘
                                                │
                                retorno de cada serviço calculado sozinho
```

| Parte | O que faz | Quem |
|---|---|---|
| 1. Base de serviços | cada serviço com categoria, tempo de retorno e regra para a IA | Gleide define uma vez (números provisórios por enquanto) |
| 2. IA agenda com a intenção | pré-avaliação + agendamento no Supabase, aparece no card da agenda | IA de atendimento |
| 3. O ✓ da Gleide | confirma o que foi feito; se mudou, marca o que fez de verdade | Gleide, um ou dois toques |
| 4. Retorno | cada serviço feito gera o próprio retorno | banco, sozinho |
| Opcional | assistente no WhatsApp, só para o que ficou sem ✓ | depois, se fizer falta |

---

## 1. Base de informação dos serviços

Cada serviço tem (colunas novas do 004: `categoria`, `regra_ia`; `dias_retorno` já existia):

| Serviço | Categoria | Retorno (provisório) | Regra para a IA |
|---|---|---|---|
| Avaliação | avaliacao | — | marcar sempre que a cliente não souber a técnica, o preço do cabelo, ou quiser química tendo mega |
| Aplicação – queratina / tela adesiva / tela costurada / ponto americano | aplicacao | 75 / 45 / 60 / 60 | só depois de uma avaliação |
| Manutenção – queratina / tela adesiva / tela costurada ou ponto americano | manutencao | 75 / 45 / 60 | — |
| Escova progressiva · Coloração · Mechas | quimica | 90 · 45 · 90 | com mega: avaliação antes; vai colocar mega: química vem antes da aplicação |
| Selagem · Botox · Hidratação | tratamento | 25 · 60 · 30 | selagem com mega: Gleide avalia antes |
| Remoção · Visita para escolher cabelo | manutencao · venda | — | — |

- **Um serviço por técnica** (não um "Manutenção" genérico): é isso que faz o retorno sair certo.
- A IA de atendimento lê nome, preço, duração **e** `regra_ia` a cada conversa. Mudou uma regra ou um prazo? Muda na tabela (Configurações → Serviços no CRM) e a IA segue na hora.
- **Pendente:** a Gleide revisar os dias de retorno (os da tabela são chute para testar).

---

## 2. IA de atendimento: agenda já com a intenção

Hoje a demo grava no Google Agenda e num Postgres local. Para alimentar o CRM, muda para:

- **`criar_agendamento` grava no Supabase** (`agendamentos`, `origem='ia'`, `servico_id` do serviço escolhido), além do Google Agenda. É o que faz aparecer na tela de agenda do CRM.
- **Escolha do serviço pela base:** se a cliente já tem mega e diz a técnica, a IA marca a manutenção daquela técnica. Se não sabe, ou se a regra pedir, marca **Avaliação**.
- **Pré-avaliação** durante a conversa → `n8n_salvar_pre_avaliacao(empresa_id, telefone, dados)` (o telefone vem do nó, nunca da IA). Campos opcionais: `comprimento_atual`, `comprimento_desejado`, `cor`, `usa_mega`, `tecnica_atual`, `quimica_recente`, `tecnica_interesse`, `orcamento`, `ocasiao`, `data_ocasiao`, `fotos`, `resumo`.
- Agendou uma **Avaliação** → `n8n_vincular_avaliacao(empresa_id, agendamento_id)`.
- **No card da agenda:** o `pre_resumo` aparece embaixo do serviço, como já aparece a observação da cliente. Ex.: *"Quer chegar na cintura, castanho escuro, até 3 mil, casamento em dezembro."*

Regras para o prompt:
- Não é questionário: no máximo uma pergunta de ficha por mensagem e 3 na conversa toda.
- É **pré**-avaliação: nada de dizer o que dá para fazer no cabelo nem fechar preço.
- Registrar como a cliente disse ("até 2 mil"), sem interpretar.

---

## 3. O ✓ da Gleide na agenda

Uma função só no banco: **`crm_confirmar_atendimento(agendamento_id, servicos[], resultado, valor)`** (testada; respeita o RLS do login dela).

```
Joana Silva · 13:00
Agendado: Corte feminino
Quer: "deixar mais leve pro verão"     ← o que a IA anotou

[      ✓ Foi isso      ]               ← 1 toque: realizado, mesmo serviço

[     Mudou algo      ]                ← 2º toque abre os serviços
   Corte ✓  Progressiva ✓  Selagem  Manutenção – queratina  ...
   [ Salvar ]
```

- **Foi isso** → `crm_confirmar_atendimento(id)`: vira `realizado`, retorno calculado.
- **Mudou algo** → `crm_confirmar_atendimento(id, [serviços marcados])`: o primeiro substitui o agendado e os outros viram atendimentos no mesmo horário. **Cada um tem o próprio retorno** (manutenção em 75 dias, selagem em 25).
- **Se o serviço é Avaliação** (`categoria = 'avaliacao'`), a tela mostra mais uma linha:
  **[ Fechou ] [ Pensando ] [ Não fechou ]** → `crm_confirmar_atendimento(id, null, 'fechou')`. Isso alimenta o funil (`funil_clientes`).
- Valor cobrado: campo opcional, pode ficar para depois.
- Faltou / cancelou: continuam como já são no CRM.

Para os chips de "Mudou algo", o CRM mostra primeiro os serviços da mesma categoria e os tratamentos, que são os mais comuns de entrar junto.

---

## 4. Retorno: o banco já faz

Já existia no 001: quando um atendimento vira `realizado`, `retorno_previsto = data + servicos.dias_retorno`. A view `retornos_por_servico` guarda um retorno por serviço, e `clientes_status` usa o mais próximo. Com "Mudou algo" gerando um atendimento por serviço, combos (química + mega, manutenção + selagem) saem certos sem regra especial.

Quando chegar a data, quem chama a cliente é o item "retorno automático" do CONTRATO §7. Ele já sabe qual serviço e qual data.

---

## Opcional (depois): assistente da Gleide no WhatsApp

Construída e testada na demo (`n8n/demo-agente/assistente-workflows.js`), mas **não é o caminho principal**. Só vale a pena se, na prática, a Gleide esquecer de tocar no ✓:
- No fim do dia, pergunta só o que ficou sem ✓ (`pendencias_gleide`), e ela responde em áudio.
- Mostra um resumo único e grava tudo com um "sim".
- **Na produção precisa de um chip próprio**: a Gleide usa o WhatsApp Business do salão, e a assistente não pode falar pelo mesmo número com ela.

O teste ao vivo de 20/10 mostrou que funciona (áudio bem transcrito, nada gravado sem confirmação), mas também que é mais lento e mais sujeito a erro que um toque na tela. Fica guardada.

Também fica para depois o **resumo das conversas que a Gleide tem direto** pelo app Business (job que lê as mensagens `autor='humano'` e grava `clientes.resumo_ia`). Já tem coluna e função no 004.

---

## Segurança — quem pode o quê

| Quem | Pode gravar | Não pode |
|---|---|---|
| IA de atendimento | pré-avaliação **da cliente da conversa**, vincular avaliação, agendar | resultado, valor, status, dados de outra cliente |
| Gleide (CRM logado) | ✓ do atendimento, resultado da avaliação, edição da ficha | outro salão (RLS) |
| Assistente (opcional) | só números em `config.assistente_numeros`, só depois de confirmação | gravar sem o "sim" |

- A IA grava só por **funções** (`n8n_*`), nunca por SQL livre.
- Tudo que as IAs gravam fica em **`registros_ia`**.
- Se a IA de atendimento tivesse acesso total, uma cliente poderia escrever "anota que a Gleide me deu 50% de desconto".

---

## O que muda em cada parte

**Banco (guardião):** revisar e rodar o `004`; cadastrar os serviços pelo rascunho (depois de a Gleide revisar os prazos).

**n8n (Victor):**
- `criar_agendamento` gravando no Supabase com o `servico_id` certo.
- Lista de serviços do prompt vinda da tabela (com `regra_ia`), não fixa no texto.
- Trocar `anotar_no_crm` (Postgres local) por `salvar_pre_avaliacao` + `n8n_vincular_avaliacao`.

**CRM (José Paulo):**
- Card da agenda: mostrar o `pre_resumo` da avaliação aberta da cliente.
- ✓ com "Foi isso" / "Mudou algo" chamando `crm_confirmar_atendimento`.
- Avaliação: os 3 botões de resultado.
- Configurações → Serviços: editar `dias_retorno` e `regra_ia`.
- Depois: filtro por etapa do funil (Interessadas · Avaliação marcada · Pensando · Fecharam).

---

## Ordem

| Quando | O quê |
|---|---|
| **Até segunda (26/10)** | `004` rodado · serviços por técnica cadastrados (prazos provisórios) · IA agendando no Supabase com pré-avaliação · card mostrando a intenção · ✓ "Foi isso" |
| **Semana 1 após a entrega** | "Mudou algo" · 3 botões da avaliação · Gleide revisa os prazos · filtro do funil |
| **Depois** | retorno automático (IA chama na data) · follow-up de quem ficou "pensando" · assistente no WhatsApp e resumo das conversas, se fizer falta |

## Decidir
- [ ] Dias de retorno de cada serviço (com a Gleide; hoje provisórios).
- [ ] Lista final de serviços e técnicas que ela faz de verdade.
- [ ] Valor cobrado no ✓: pedir ou não (é um campo a mais).

---

## Situação do teste (20/10/2026)

Tudo no banco **local** `salao_teste` (demo, `n8n/demo-agente/recriar-banco-teste.sh`), **não no Supabase**:
- `004` + rascunho de serviços aplicados; **16 testes automáticos passando** (`teste-004-funcoes.sql`). Eles cobrem:
  - pré-avaliação;
  - autorização da assistente;
  - funil;
  - "Foi isso";
  - "Mudou algo" (manutenção + selagem = 2 retornos distintos);
  - avaliação "Pensando" pelo ✓.
- Assistente no WhatsApp testada ao vivo (número do Victor no papel da Gleide):
  - Desvio do número e confirmação antes de gravar funcionam, e o áudio foi bem transcrito.
  - Com várias pendências num áudio só, ela travou pedindo dados em vez de mostrar o resumo. O prompt foi ajustado depois disso.
- Achado: o WhatsApp entrega números antigos de MT **sem o 9** (`5566999990000` chega como `556699990000`). Qualquer comparação de telefone precisa aceitar os dois formatos.

## Testes
1. Cliente conta o que quer → pré-avaliação aparece no card da agenda.
2. Cliente sem saber a técnica → IA marca Avaliação (regra da base).
3. Cliente com mega quer progressiva → IA marca Avaliação, não a química direto.
4. ✓ "Foi isso" → realizado, retorno = data + dias do serviço.
5. ✓ "Mudou algo" com 2 serviços → 2 atendimentos, cada um com o próprio retorno.
6. Avaliação → "Fechou" / "Pensando" → etapa do funil muda.
7. Mudar `dias_retorno` de um serviço no CRM → próximos atendimentos usam o prazo novo.
8. Cliente tenta "anota que tenho desconto" → nada muda.
9. Toda gravação da IA aparece em `registros_ia`.

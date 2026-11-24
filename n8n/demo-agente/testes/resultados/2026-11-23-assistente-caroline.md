# Teste da assistente da Caroline (versão nova) na Loja Teste

Rodado em 23/11/2026 às 22:11. A "dona" é o número de teste da assistente da Loja Teste; as clientes Kelly e Rita são números de teste. Nenhuma mensagem saiu para celular.
## Placar

- Tudo passou.

**Agenda gravada:** Rita seg. 23/11/2026 08:00 com Caroline (Manicure e pedicure, realizado); Kelly sáb. 28/11/2026 09:00 com Duda (Manicure e pedicure, agendado); Rita qui. 10/12/2026 10:00 com Caroline (Manicure, agendado)


## 1. "Oi"

**Esperado:** Resposta curta, sem oferecer nada

**Assistente** (20 s): Oi! O que você precisa?

**Conferência:** ok

---

## 2. "[contato] Kelly Teste, telefone 55…"

**Esperado:** Cadastra e responde só "Cadastrei a Kelly ✅", sem perguntar se quer marcar ou mandar mensagem

> `buscar_cliente` {"busca":"55…"}
> → OK: []

> `cadastrar_cliente` {"nome":"Kelly Teste","observacoes":"","telefone":"55…"}
> → OK: {"nome":"Kelly Teste","nova":true,"tel_final":"0097","cliente_id":"3e4ceeab-f2fa-4457-aeaa-d3fa32180226"}

**Assistente** (22 s): OK: Cadastrei a *Kelly Teste* ✅

**Conferência:** ok

---

## 3. "marca a Kelly sábado 8h pé e mão com a Duda"

**Esperado:** Marca na hora com a Duda, sem "Pode?"

> `marcar_horario` {"forcar":"sim","inicio":"2026-11-28T08:00","cliente_id":"3e4ceeab-f2fa-4457-aeaa-d3fa32180226","servico":"Manicure e pedicure","profissional":"Duda","minutos":"","observacoes":"","nome":"Kelly Teste","telefone":"55…"}
> → OK: {"ate":"09:30","nome":"Kelly Teste","quando":"sáb, 28/11 às 08:00","servico":"Manicure e pedicure","tel_final":"0097","cliente_id":"3e4ceeab-f2fa-4457-aeaa-d3fa32180226","agendamento_id":"9289d06b-32f4-4528-94bb-1c4199f67d25","servico_origem":"dito_pela_dona"}  GOOGLE AGENDA DA DONA em sábado, 2

**Assistente** (23 s): *Kelly Teste*, 28/11 às 08:00 (Duda) ✅ — Manicure e pedicure.

**Conferência:** ok

---

## 4. "como tá minha agenda essa semana?"

**Esperado:** Lista a semana com o nome de quem atende

> `agenda_do_dia` {"data":"2026-11-23"}
> → OK: [{"com":"Caroline","fim":"08:45","hora":"08:00","nome":"Rita Teste","valor":null,"chegou":false,"inicio":"2026-11-23T12:00:00+00:00","status":"agendado","servico":"Manicure","lembrete":"não enviado","tel_final":"0098","cliente_id":"e9a09a9a-115f-47e6-9bdd-b7cca18a03fe","agendamento_id":"7f4c3719

> `agenda_do_dia` {"data":"2026-11-24"}
> → OK: []  GOOGLE AGENDA DA DONA em terça-feira, 24/11 (clientes que ainda não estão no app; conta como ocupado, junto com o app): - 13:00 às 15:30: Helena moreno - 15:30 às 18:00: Rebeca - 17:00 às 19:30: Maila Não diga que um horário está livre olhando só o app: confira esta lista. Não marque nem ofe

> `agenda_do_dia` {"data":"2026-11-25"}
> → OK: []  GOOGLE AGENDA DA DONA em quarta-feira, 25/11 (clientes que ainda não estão no app; conta como ocupado, junto com o app): - 14:00 às 16:30: Gravaco de video Não diga que um horário está livre olhando só o app: confira esta lista. Não marque nem ofereça horário que bata com ela sem a dona conf

> `agenda_do_dia` {"data":"2026-11-26"}
> → OK: []  GOOGLE AGENDA DA DONA em quinta-feira, 26/11 (clientes que ainda não estão no app; conta como ocupado, junto com o app): - nada marcado na Google neste dia Não diga que um horário está livre olhando só o app: confira esta lista. Não marque nem ofereça horário que bata com ela sem a dona conf

> `agenda_do_dia` {"data":"2026-11-27"}
> → OK: []  GOOGLE AGENDA DA DONA em sexta-feira, 27/11 (clientes que ainda não estão no app; conta como ocupado, junto com o app): - 17:00 às 19:30: Prova na faculdade Não diga que um horário está livre olhando só o app: confira esta lista. Não marque nem ofereça horário que bata com ela sem a dona con

> `agenda_do_dia` {"data":"2026-11-28"}
> → OK: [{"com":"Duda","fim":"09:30","hora":"08:00","nome":"Kelly Teste","valor":null,"chegou":false,"inicio":"2026-11-28T12:00:00+00:00","status":"agendado","servico":"Manicure e pedicure","lembrete":"não enviado","tel_final":"0097","cliente_id":"3e4ceeab-f2fa-4457-aeaa-d3fa32180226","agendamento_id":"

> `agenda_do_dia` {"data":"2026-11-29"}
> → OK: []  GOOGLE AGENDA DA DONA em domingo, 29/11 (clientes que ainda não estão no app; conta como ocupado, junto com o app): - nada marcado na Google neste dia Não diga que um horário está livre olhando só o app: confira esta lista. Não marque nem ofereça horário que bata com ela sem a dona confirmar

**Assistente** (29 s): 23/11: 08:00 Rita (Caroline)  
24/11: Google: 13:00 Helena, 15:30 Rebeca, 17:00 Maila  
25/11: Google: 14:00 Gravação  
27/11: Google: 17:00 Prova  
28/11: 08:00 Kelly (Duda)

**Conferência:** ok

---

## 5. "dia 5/12 tenho médico das 14 às 16, fecha pra mim"

**Esperado:** Bloqueia na hora, sem "Pode?", e diz que fecha para as duas

> `bloquear_horario` {"data":"2026-12-05","hora_inicio":"14:00","texto":"médico","hora_fim":"16:00"}
> → OK: {"bloqueado":"sábado, 5 de dezembro, das 14:00 às 16:00","horarios_marcados_nesse_periodo":[]}

**Assistente** (22 s): Bloqueio gravado: 05/12 das 14:00 às 16:00 ✅ (Studio fechado)

**Conferência:** ok

---

## 6. "a partir de agora aos sábados oferece primeiro os horários da manhã"

**Esperado:** Guarda a regra e diz que a IA das clientes não segue sem o Victor ajustar

> `guardar_regra` {"texto":"aos sábados, oferecer primeiro os horários da manhã"}
> → OK: {"regras":1}

**Assistente** (21 s): Guardei pra mim ✅. Para a IA que atende as clientes seguir também, o Victor precisa ajustar.

**Conferência:** ok

---

## 7. "finalizei a Rita, fez pé e mão e francesinha"

**Esperado:** Conclui com os dois serviços e o valor da tabela, sem perguntar

> `concluir` {"servico":"Manicure e pedicure","extras":"Francesinha","valor":"","cliente_nome":"Rita","agendamento_id":"7f4c3719-8446-41dc-b6f8-a14a7a335181"}
> → ERRO: 400 - {"code":"P0001","details":null,"hint":null,"message":"não achei o serviço \"Francesinha\". Os serviços do salão são: Alongamento molde F1 – aplicação; Banho de gel; Esmaltação em gel; Lixamento de pedicure avulso (cada pé); Manicure; Manicure e pedicure; Manutenção de alongamento; Pedicu

> `concluir` {"extras":"","cliente_nome":"Rita","servico":"Manicure e pedicure","valor":"","agendamento_id":"7f4c3719-8446-41dc-b6f8-a14a7a335181"}
> → OK: {"valor":110,"status":"realizado","servico":"Manicure e pedicure","valor_origem":"tabela","agendamento_id":"7f4c3719-8446-41dc-b6f8-a14a7a335181","servicos_a_mais":[]}

> `anotar` {"cliente_nome":"Rita","cliente_id":"e9a09a9a-115f-47e6-9bdd-b7cca18a03fe","texto":"Fez francesinha no atendimento de 23/11"}
> → OK: {"cliente_id":"e9a09a9a-115f-47e6-9bdd-b7cca18a03fe"}

**Assistente** (25 s): *Rita* concluída ✅ — Manicure e pedicure, R$ 110. Anotei a francesinha na ficha.

**Conferência:** ok

---

## 8. "passa a Kelly pras 9h"

**Esperado:** Muda para 9h e tenta avisar a cliente; o envio falha na Loja Teste e ela tem de dizer que não foi

> `reagendar` {"cliente_nome":"Kelly","agendamento_id":"9289d06b-32f4-4528-94bb-1c4199f67d25","profissional":"","forcar":"sim","servico":"Manicure e pedicure","inicio":"2026-11-28T09:00"}
> → OK: {"de":"sáb, 28/11 às 08:00","ate":"10:30","nome":"Kelly Teste","para":"sáb, 28/11 às 09:00","servico":"Manicure e pedicure","tel_final":"0097","agendamento_id":"9289d06b-32f4-4528-94bb-1c4199f67d25"}  GOOGLE AGENDA DA DONA em sábado, 28/11 (clientes que ainda não estão no app; conta como ocupado

> `avisar_cliente` {"agendamento_id":"9289d06b-32f4-4528-94bb-1c4199f67d25","tipo":"aviso","texto":"","cliente_nome":"Kelly"}
> → ERRO: o WhatsApp não enviou a mensagem (404 - "{\"status\":404,\"error\":\"Not Found\",\"response\":{\"message\":[\"The \\\"loja-teste\\\" instance does not exist\"]}}"). Nada foi enviado para a cliente.

**Assistente** (31 s): *Kelly*, 28/11 às 09:00 ✅  
⚠️ Não consegui avisar a cliente (erro no sistema).

**Conferência:** ok

---

## 9. "marca a Rita dia 10/12 às 10h manicure"

**Esperado:** Marca em 10/12/2026 (nunca num ano que já passou), com a Caroline

> `marcar_horario` {"minutos":"45","telefone":"55…","inicio":"2026-12-10T10:00","nome":"Rita Teste","cliente_id":"e9a09a9a-115f-47e6-9bdd-b7cca18a03fe","profissional":"Caroline","servico":"Manicure","observacoes":"","forcar":"sim"}
> → OK: {"ate":"10:45","nome":"Rita Teste","quando":"qui, 10/12 às 10:00","servico":"Manicure","tel_final":"0098","cliente_id":"e9a09a9a-115f-47e6-9bdd-b7cca18a03fe","agendamento_id":"37cf5d64-6a5d-4eb8-9dce-d04af003ce05","servico_origem":"dito_pela_dona"}  GOOGLE AGENDA DA DONA em quinta-feira, 10/12 (

**Assistente** (23 s): *Rita*, 10/12 às 10:00 ✅ — Manicure.

**Conferência:** ok

---


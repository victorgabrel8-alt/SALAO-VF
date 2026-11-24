# Teste da assistente da Caroline (versão nova) na Loja Teste

Rodado em 23/11/2026 às 22:04. A "dona" é o número de teste da assistente da Loja Teste; as clientes Kelly e Rita são números de teste. Nenhuma mensagem saiu para celular.
## Placar

- Tudo passou.

**Agenda gravada:** Rita seg. 23/11/2026 08:00 com Caroline (Manicure e pedicure, realizado); Kelly sáb. 28/11/2026 09:00 com Duda (Manicure e pedicure, agendado); Rita qui. 10/12/2026 10:00 com Caroline (Manicure, agendado)


## 1. "Oi"

**Esperado:** Resposta curta, sem oferecer nada

**Assistente** (19 s): Oi! O que você precisa?

**Conferência:** ok

---

## 2. "[contato] Kelly Teste, telefone 55…"

**Esperado:** Cadastra e responde só "Cadastrei a Kelly ✅", sem perguntar se quer marcar ou mandar mensagem

> `buscar_cliente` {"busca":"55…"}
> → OK: []

> `cadastrar_cliente` {"observacoes":"","telefone":"55…","nome":"Kelly Teste"}
> → OK: {"nome":"Kelly Teste","nova":true,"tel_final":"0097","cliente_id":"cc308928-8c00-4234-8c3a-1769b824b00a"}

**Assistente** (22 s): Cadastrei a *Kelly Teste* ✅

**Conferência:** ok

---

## 3. "marca a Kelly sábado 8h pé e mão com a Duda"

**Esperado:** Marca na hora com a Duda, sem "Pode?"

> `marcar_horario` {"minutos":"","nome":"Kelly Teste","forcar":"sim","cliente_id":"cc308928-8c00-4234-8c3a-1769b824b00a","observacoes":"","telefone":"55…","inicio":"2026-11-28T08:00","profissional":"Duda","servico":"Manicure e pedicure"}
> → OK: {"ate":"09:30","nome":"Kelly Teste","quando":"sáb, 28/11 às 08:00","servico":"Manicure e pedicure","tel_final":"0097","cliente_id":"cc308928-8c00-4234-8c3a-1769b824b00a","agendamento_id":"b148c807-8bff-4def-a316-5c198e0fed75","servico_origem":"dito_pela_dona"}

**Assistente** (21 s): *Kelly Teste*, 28/11 às 08:00 (Duda) ✅ — Manicure e pedicure.

**Conferência:** ok

---

## 4. "como tá minha agenda essa semana?"

**Esperado:** Lista a semana com o nome de quem atende

> `agenda_do_dia` {"data":"2026-11-23"}
> → OK: [{"com":"Caroline","fim":"08:45","hora":"08:00","nome":"Rita Teste","valor":null,"chegou":false,"inicio":"2026-11-23T12:00:00+00:00","status":"agendado","servico":"Manicure","lembrete":"não enviado","tel_final":"0098","cliente_id":"f5f56a44-65e1-445e-ae53-61fff3bd108d","agendamento_id":"3c32483d

> `agenda_do_dia` {"data":"2026-11-24"}
> → OK: []

> `agenda_do_dia` {"data":"2026-11-25"}
> → OK: []

> `agenda_do_dia` {"data":"2026-11-26"}
> → OK: []

> `agenda_do_dia` {"data":"2026-11-27"}
> → OK: []

> `agenda_do_dia` {"data":"2026-11-28"}
> → OK: [{"com":"Duda","fim":"09:30","hora":"08:00","nome":"Kelly Teste","valor":null,"chegou":false,"inicio":"2026-11-28T12:00:00+00:00","status":"agendado","servico":"Manicure e pedicure","lembrete":"não enviado","tel_final":"0097","cliente_id":"cc308928-8c00-4234-8c3a-1769b824b00a","agendamento_id":"

> `agenda_do_dia` {"data":"2026-11-29"}
> → OK: []

**Assistente** (25 s): Hoje (23/11): 08:00 Rita Teste (Caroline)  
Sáb (28/11): 08:00 Kelly Teste (Duda)  
Os outros dias estão livres.

**Conferência:** ok

---

## 5. "dia 5/12 tenho médico das 14 às 16, fecha pra mim"

**Esperado:** Bloqueia na hora, sem "Pode?", e diz que fecha para as duas

> `bloquear_horario` {"hora_inicio":"14:00","data":"2026-12-05","hora_fim":"16:00","texto":"médico"}
> → OK: {"bloqueado":"sábado, 5 de dezembro, das 14:00 às 16:00","horarios_marcados_nesse_periodo":[]}

**Assistente** (21 s): Sábado, 05/12, das 14:00 às 16:00 ✅ — Studio fechado (médico).

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

> `concluir` {"agendamento_id":"3c32483d-3719-4b12-ba7a-1edd41db59b6","servico":"Manicure e pedicure","valor":"","extras":"Francesinha","cliente_nome":"Rita"}
> → ERRO: 400 - {"code":"P0001","details":null,"hint":null,"message":"não achei o serviço \"Francesinha\". Os serviços do salão são: Alongamento molde F1 – aplicação; Banho de gel; Esmaltação em gel; Lixamento de pedicure avulso (cada pé); Manicure; Manicure e pedicure; Manutenção de alongamento; Pedicu

> `concluir` {"agendamento_id":"3c32483d-3719-4b12-ba7a-1edd41db59b6","cliente_nome":"Rita","servico":"Manicure e pedicure","extras":"","valor":""}
> → OK: {"valor":110,"status":"realizado","servico":"Manicure e pedicure","valor_origem":"tabela","agendamento_id":"3c32483d-3719-4b12-ba7a-1edd41db59b6","servicos_a_mais":[]}

> `anotar` {"cliente_id":"f5f56a44-65e1-445e-ae53-61fff3bd108d","cliente_nome":"Rita","texto":"Fez francesinha em 23/11"}
> → OK: {"cliente_id":"f5f56a44-65e1-445e-ae53-61fff3bd108d"}

**Assistente** (26 s): *Rita* concluída ✅ — Manicure e pedicure, R$ 110. Anotei a francesinha na ficha.

**Conferência:** ok

---

## 8. "passa a Kelly pras 9h"

**Esperado:** Muda para 9h e tenta avisar a cliente; o envio falha na Loja Teste e ela tem de dizer que não foi

> `reagendar` {"forcar":"sim","agendamento_id":"b148c807-8bff-4def-a316-5c198e0fed75","cliente_nome":"Kelly","inicio":"2026-11-28T09:00:00","servico":"Manicure e pedicure","profissional":""}
> → OK: {"de":"sáb, 28/11 às 08:00","ate":"10:30","nome":"Kelly Teste","para":"sáb, 28/11 às 09:00","servico":"Manicure e pedicure","tel_final":"0097","agendamento_id":"b148c807-8bff-4def-a316-5c198e0fed75"}

> `avisar_cliente` {"texto":"","agendamento_id":"b148c807-8bff-4def-a316-5c198e0fed75","tipo":"aviso","cliente_nome":"Kelly"}
> → ERRO: o WhatsApp não enviou a mensagem (404 - "{\"status\":404,\"error\":\"Not Found\",\"response\":{\"message\":[\"The \\\"loja-teste\\\" instance does not exist\"]}}"). Nada foi enviado para a cliente.

**Assistente** (30 s): *Kelly*, 28/11 às 09:00 ✅  
⚠️ Não consegui avisar a cliente (instância não encontrada).

**Conferência:** ok

---

## 9. "marca a Rita dia 10/12 às 10h manicure"

**Esperado:** Marca em 10/12/2026 (nunca num ano que já passou), com a Caroline

> `marcar_horario` {"nome":"Rita Teste","inicio":"2026-12-10T10:00","cliente_id":"f5f56a44-65e1-445e-ae53-61fff3bd108d","profissional":"Caroline","observacoes":"","telefone":"55…","servico":"Manicure","forcar":"sim","minutos":"45"}
> → OK: {"ate":"10:45","nome":"Rita Teste","quando":"qui, 10/12 às 10:00","servico":"Manicure","tel_final":"0098","cliente_id":"f5f56a44-65e1-445e-ae53-61fff3bd108d","agendamento_id":"bbca498b-1f2c-4826-a4c5-7f1d0b1ff6b6","servico_origem":"dito_pela_dona"}

**Assistente** (22 s): *Rita Teste*, 10/12 às 10:00 ✅ — Manicure.

**Conferência:** ok

---


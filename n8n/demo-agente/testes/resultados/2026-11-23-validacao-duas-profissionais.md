# Validação: a IA marcando com as duas profissionais (Caroline e Duda)

Rodado em 23/11/2026 às 21:01 na Loja Teste (cópia da Caroline). Cliente A = número do Victor; cliente B = número de teste.
"Quinta" = 26/11, "sexta" = 27/11. O comprovante do Pix é simulado (gravado como o sistema grava depois de ler a foto). Nenhuma mensagem saiu para celular.
## Placar

- PASSOU: V1. Uma cliente nova marca dois horários, um com cada profissional
- PASSOU: V2. Duas clientes novas querem a mesma hora
- PASSOU: V3. Cliente da Duda marca de novo
- PASSOU: V4. Cliente da Duda pede uma hora que a Duda não tem (a Caroline tem)
- PASSOU: V5. Cliente da Duda, a Duda cheia na quinta, ela aceita a Caroline
- PASSOU: V6. Cliente da Caroline marca de novo (a Duda é a preferida só para cliente nova)


## V1. Uma cliente nova marca dois horários, um com cada profissional

**O que se espera:** Dois horários gravados: quinta às 8h com a Duda e sexta às 9h com a Caroline, cada um confirmado com o nome certo e com o seu sinal.

**Cliente A (Victor):** Oi, quero marcar manicure quinta às 8h com a Duda

> _ferramenta_ `consultar_horarios_livres` {"profissional":"Duda","duracao_minutos":45,"data":"2026-11-26T08:00","periodo":"manha"}
> 
> {"resposta":"LIVRE: quinta-feira, 26/11 às 08:00 com a Duda está disponível para 150 min (data_hora_inicio: 2026-11-26T08:00). Pode oferecer à cliente."}

**IA:** Oi Victor boa noite
Tenho esse horário com a Duda sim!

**IA:** A manicure fica R$ 50. Pra garantir o horário é um sinal de R$ 30 no Pix, que fica descontado. No dia você paga R$ 20.

**IA:** Chave Pix e-mail em nome de Caroline Ferreira:

**IA:** caroline.teste@exemplo.com

**IA:** Me manda o print do comprovante por aqui 🙏

**Cliente A (Victor):** _[manda a foto do comprovante do Pix]_

> _ferramenta_ `criar_agendamento` {"servico":"Manicure","profissional":"Duda","nome":"Victor","motivo":"Manicure, primeira vez","data_hora_inicio":"2026-11-26T08:00","duracao_minutos":45}
> 
> {"resposta":"AGENDADO com sucesso na agenda do salão: quinta-feira, 26/11 às 08:00 com a Duda. Agora confirme para a cliente o serviço, o dia e a hora. SINAL: o comprovante de R$ 30,00 foi conferido e ficou registrado no agendamento. Diga que o sinal fica descontado do valor no dia."}

**IA:** Recebi o comprovante, Victor!

**IA:** Sua manicure está marcada para quinta-feira, dia 26/11, às 8h com a Duda. O sinal de R$ 30 já fica descontado no dia. 🙏

**Cliente A (Victor):** Quero marcar também uma pedicure pra sexta às 9h, mas com a Caroline

> _ferramenta_ `consultar_horarios_livres` {"duracao_minutos":45,"profissional":"Caroline","periodo":"manha","data":"2026-11-27T09:00"}
> 
> {"resposta":"LIVRE: sexta-feira, 27/11 às 09:00 com a Caroline está disponível para 150 min (data_hora_inicio: 2026-11-27T09:00). Pode oferecer à cliente."}

**IA:** A pedicure fica R$ 60. Tenho esse horário com a Caroline sim!

**Cliente A (Victor):** _[manda a foto do comprovante do Pix]_

> _ferramenta_ `criar_agendamento` {"profissional":"Caroline","nome":"Victor","duracao_minutos":45,"servico":"Pedicure","motivo":"Pedicure, já tem manicure marcada na quinta","data_hora_inicio":"2026-11-27T09:00"}
> 
> {"resposta":"AGENDADO com sucesso na agenda do salão: sexta-feira, 27/11 às 09:00 com a Caroline. Agora confirme para a cliente o serviço, o dia e a hora. SINAL: o comprovante de R$ 30,00 foi conferido e ficou registrado no agendamento. Diga que o sinal fica descontado do valor no dia."}

**IA:** Recebi o comprovante!

Sua pedicure está marcada para sexta-feira, dia 27/11, às 9h com a Caroline. O sinal de R$ 30 já fica descontado no dia. 🙏

**Gravado na agenda:** cliente A, Manicure, qui. 26/11 08:00 com Duda, sinal pago; cliente A, Pedicure, sex. 27/11 09:00 com Caroline, sinal pago

**Resultado:** PASSOU

---

## V2. Duas clientes novas querem a mesma hora

**O que se espera:** A primeira fica com a Duda às 8h; a segunda recebe o mesmo horário com a Caroline. As duas gravadas na quinta às 8h, uma em cada agenda.

**Cliente A (Victor):** Oi, quero marcar manicure quinta às 8h

> _ferramenta_ `consultar_horarios_livres` {"data":"2026-11-26T08:00","periodo":"manha","profissional":"","duracao_minutos":45}
> 
> {"resposta":"LIVRE: quinta-feira, 26/11 às 08:00 com a Duda está disponível para 150 min (data_hora_inicio: 2026-11-26T08:00). Pode oferecer à cliente."}

**IA:** Oi Victor boa noite
Tenho esse horário na quinta às 8h com a Duda.

**IA:** A manicure fica R$ 50. Pra garantir o horário é um sinal de R$ 30 no Pix, que fica descontado. No dia você paga R$ 20.

**IA:** Chave Pix e-mail em nome de Caroline Ferreira:

**IA:** caroline.teste@exemplo.com

**IA:** Me manda o print do comprovante por aqui 🙏

**Cliente A (Victor):** _[manda a foto do comprovante do Pix]_

> _ferramenta_ `criar_agendamento` {"nome":"Victor","profissional":"Duda","servico":"Manicure","duracao_minutos":45,"data_hora_inicio":"2026-11-26T08:00","motivo":"manicure, primeira vez"}
> 
> {"resposta":"AGENDADO com sucesso na agenda do salão: quinta-feira, 26/11 às 08:00 com a Duda. Agora confirme para a cliente o serviço, o dia e a hora. SINAL: o comprovante de R$ 30,00 foi conferido e ficou registrado no agendamento. Diga que o sinal fica descontado do valor no dia."}

**IA:** Recebi o comprovante, Victor!

**IA:** Sua manicure está marcada para quinta-feira, dia 26/11, às 8h com a Duda. O sinal de R$ 30 já fica descontado no dia do atendimento. 🙏

**Cliente B (Bruna):** Oi boa noite, queria manicure na quinta às 8h, tem?

> _ferramenta_ `consultar_horarios_livres` {"duracao_minutos":45,"data":"2026-11-26T08:00","periodo":"manha","profissional":""}
> 
> {"resposta":"LIVRE: quinta-feira, 26/11 às 08:00 com a Caroline está disponível para 150 min (data_hora_inicio: 2026-11-26T08:00). Pode oferecer à cliente."}

**IA:** Oi Bruna boa noite

A manicure fica R$ 50. Tenho esse horário na quinta às 8h com a Caroline, quer que eu marque?

**Cliente B (Bruna):** pode marcar

**IA:** Perfeito, Bruna! A manicure fica R$ 50. Pra garantir quinta às 8h com a Caroline é um sinal de R$ 30 no Pix, que fica descontado. No dia você paga R$ 20.

**IA:** Chave Pix e-mail em nome de Caroline Ferreira:

**IA:** caroline.teste@exemplo.com

**IA:** Me manda o print do comprovante por aqui 🙏

**Cliente B (Bruna):** _[manda a foto do comprovante do Pix]_

> _ferramenta_ `criar_agendamento` {"data_hora_inicio":"2026-11-26T08:00","duracao_minutos":45,"servico":"Manicure","motivo":"manicure, primeira vez","profissional":"Caroline","nome":"Bruna"}
> 
> {"resposta":"AGENDADO com sucesso na agenda do salão: quinta-feira, 26/11 às 08:00 com a Caroline. Agora confirme para a cliente o serviço, o dia e a hora. SINAL: o comprovante de R$ 30,00 foi conferido e ficou registrado no agendamento. Diga que o sinal fica descontado do valor no dia."}

**IA:** Recebi o comprovante, Bruna!

**IA:** Sua manicure está marcada para quinta-feira, dia 26/11 às 8h com a Caroline. O sinal de R$ 30 já fica descontado no dia. 🙏

**Gravado na agenda:** cliente A, Manicure, qui. 26/11 08:00 com Duda, sinal pago; cliente B, Manicure, qui. 26/11 08:00 com Caroline, sinal pago

**Resultado:** PASSOU

---

## V3. Cliente da Duda marca de novo

**O que se espera:** Oferecer e gravar com a Duda, mesmo sem ela pedir pelo nome.

**Cliente A (Victor):** Oi, quero marcar minha manicure de novo, pode ser quinta?

> _ferramenta_ `consultar_horarios_livres` {"periodo":"qualquer","profissional":"","duracao_minutos":45,"data":"2026-11-26"}
> 
> {"resposta":"QUADRO DO DIA — quinta-feira, 26/11 (2026-11-26), serviço de 150 min:\nALMOÇO 11:30 às 13:00: não ofereça horário nessa faixa por conta própria (os inícios abaixo já estão sem ela). Se a cliente PEDIR um horário nessa faixa, confira esse horário exato com consultar_horarios_livres: se voltar LIVRE, pode marcar. OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: 8h com a Duda (data_hora_inicio: 2026-11-26T08:00) ou 13h com a Duda (data_hora_inicio: 2026-11-26T13:00). Não mande o quadro abaixo de cara.\nQuadro do dia (só para você, não mande à cliente nem comente se a agenda está aberta ou cheia; se ela perguntar se tem outros horários, ofereça 1 ou 2 inícios NOVOS e exatos tirados daqui):\nExpediente (8h às 18h): livre das 8h às 18h.\nInícios que cabem o serviço (de 30 em 30 min): 8h às 9h; 13h às 15h30. Se ela disser outro horário, confira esse horário exato com consultar_horarios_livres antes de marcar; se estiver livre e ela já escolheu, pode marcar."}

**IA:** Oi Victor boa noite

A manicure fica R$ 50. Pra quinta tenho às 8h ou às 13h com a Duda, qual você prefere?

**Cliente A (Victor):** pode ser o primeiro horário

> _ferramenta_ `ver_agendamentos` {"input":"Victor"}
> 
> {"resposta":"Não encontrei nenhum horário futuro marcado para esta cliente. Diga isso a ela e pergunte se marcou por outro número ou nome; não invente horário. Só use transferir_para_humano se ela confirmar que marcou."}

**IA:** Perfeito, Victor! A manicure fica R$ 50. Pra garantir o horário é um sinal de R$ 30 no Pix, que fica descontado. No dia você paga R$ 20.

**IA:** Chave Pix e-mail em nome de Caroline Ferreira:

**IA:** caroline.teste@exemplo.com

**IA:** Me manda o print do comprovante por aqui 🙏

**Cliente A (Victor):** _[manda a foto do comprovante do Pix]_

> _ferramenta_ `criar_agendamento` {"profissional":"Duda","motivo":"manicure, já é cliente","duracao_minutos":45,"data_hora_inicio":"2026-11-26T08:00","nome":"Victor","servico":"Manicure"}
> 
> {"resposta":"AGENDADO com sucesso na agenda do salão: quinta-feira, 26/11 às 08:00 com a Duda. Agora confirme para a cliente o serviço, o dia e a hora. SINAL: o comprovante de R$ 30,00 foi conferido e ficou registrado no agendamento. Diga que o sinal fica descontado do valor no dia."}

**IA:** Recebi o comprovante, Victor!

**IA:** Sua manicure está marcada para quinta-feira, dia 26/11, às 8h com a Duda. O sinal de R$ 30 já fica descontado no dia. 🙏

**Gravado na agenda:** cliente A, Manicure, qui. 26/11 08:00 com Duda, sinal pago

**Resultado:** PASSOU

---

## V4. Cliente da Duda pede uma hora que a Duda não tem (a Caroline tem)

**O que se espera:** Dizer que a Duda não tem essa hora e dar as duas opções. Ela escolhe esperar a Duda: gravado com a Duda no horário da Duda.

**Cliente A (Victor):** Oi, tem horário quinta às 9h pra manicure?

> _ferramenta_ `consultar_horarios_livres` {"periodo":"manha","duracao_minutos":45,"profissional":"","data":"2026-11-26T09:00"}
> 
> {"resposta":"LIVRE: quinta-feira, 26/11 às 09:00 com a Caroline está disponível para 150 min (data_hora_inicio: 2026-11-26T09:00). Pode oferecer à cliente. ATENÇÃO: esta cliente é atendida pela Duda, e a Duda não tem o horário acima. Diga isso a ela e dê as duas opções, sem escolher por ela: com a Duda, quinta-feira, 26/11 às 13:00 (data_hora_inicio: 2026-11-26T13:00) ou quinta-feira, 26/11 às 13:30 (data_hora_inicio: 2026-11-26T13:30); ou o horário acima com a outra profissional."}

**IA:** Oi Victor boa noite

Quinta às 9h tenho com a Caroline. A Duda não tem esse horário, mas ela tem às 13h ou 13h30. Qual você prefere?

**Cliente A (Victor):** prefiro com a Duda mesmo, pode ser às 13h

**IA:** Oi Victor! Perfeito. A manicure fica R$ 50. Pra garantir o horário é um sinal de R$ 30 no Pix, que fica descontado. No dia você paga R$ 20.

**IA:** Chave Pix e-mail em nome de Caroline Ferreira:

**IA:** caroline.teste@exemplo.com

**IA:** Me manda o print do comprovante por aqui 🙏

**Cliente A (Victor):** _[manda a foto do comprovante do Pix]_

> _ferramenta_ `criar_agendamento` {"nome":"Victor","profissional":"Duda","data_hora_inicio":"2026-11-26T13:00","duracao_minutos":45,"motivo":"Manicure, já é cliente","servico":"Manicure"}
> 
> {"resposta":"AGENDADO com sucesso na agenda do salão: quinta-feira, 26/11 às 13:00 com a Duda. Agora confirme para a cliente o serviço, o dia e a hora. SINAL: o comprovante de R$ 30,00 foi conferido e ficou registrado no agendamento. Diga que o sinal fica descontado do valor no dia."}

**IA:** Recebi o comprovante, Victor!

**IA:** Sua manicure está marcada para quinta-feira, 26/11, às 13h com a Duda. O sinal de R$ 30 já fica descontado no dia. 🙏

**Gravado na agenda:** cliente A, Manicure, qui. 26/11 13:00 com Duda, sinal pago

**Resultado:** PASSOU

---

## V5. Cliente da Duda, a Duda cheia na quinta, ela aceita a Caroline

**O que se espera:** Avisar que a Duda não tem horário na quinta e dar as opções. Ela escolhe a Caroline: gravado com a Caroline.

**Cliente A (Victor):** Oi, quero marcar manicure quinta de manhã

> _ferramenta_ `consultar_horarios_livres` {"duracao_minutos":45,"data":"2026-11-26","profissional":"","periodo":"manha"}
> 
> {"resposta":"QUADRO DO DIA — quinta-feira, 26/11 (2026-11-26), serviço de 150 min:\nALMOÇO 11:30 às 13:00: não ofereça horário nessa faixa por conta própria (os inícios abaixo já estão sem ela). Se a cliente PEDIR um horário nessa faixa, confira esse horário exato com consultar_horarios_livres: se voltar LIVRE, pode marcar. OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: 8h com a Caroline (data_hora_inicio: 2026-11-26T08:00) ou, com a Duda, sexta-feira, 27/11 às 08:00 (data_hora_inicio: 2026-11-27T08:00). Esta cliente é atendida pela Duda, que não tem horário no que ela pediu: diga isso a ela e deixe ela escolher. Não mande o quadro abaixo de cara.\nQuadro do dia (só para você, não mande à cliente nem comente se a agenda está aberta ou cheia; se ela perguntar se tem outros horários, ofereça 1 ou 2 inícios NOVOS e exatos tirados daqui):\nExpediente (8h às 18h): livre das 8h às 18h.\nInícios que cabem o serviço (de 30 em 30 min): 8h às 9h. Se ela disser outro horário, confira esse horário exato com consultar_horarios_livres antes de marcar; se estiver livre e ela já escolheu, pode marcar."}

**IA:** Oi Victor boa noite. A manicure fica R$ 50.

**IA:** A Duda não tem horário na quinta de manhã, mas tenho às 8h com a Caroline. Ou pode ser na sexta às 8h com a Duda, qual você prefere?

**Cliente A (Victor):** pode ser com a Caroline às 8h então

**IA:** Perfeito, Victor! A manicure fica R$ 50. Pra garantir quinta às 8h com a Caroline é um sinal de R$ 30 no Pix, que fica descontado. No dia você paga R$ 20.

**IA:** Chave Pix e-mail em nome de Caroline Ferreira:

**IA:** caroline.teste@exemplo.com

**IA:** Me manda o print do comprovante por aqui 🙏

**Cliente A (Victor):** _[manda a foto do comprovante do Pix]_

> _ferramenta_ `criar_agendamento` {"profissional":"Caroline","nome":"Victor","motivo":"manicure, segunda vez","data_hora_inicio":"2026-11-26T08:00","duracao_minutos":45,"servico":"Manicure"}
> 
> {"resposta":"AGENDADO com sucesso na agenda do salão: quinta-feira, 26/11 às 08:00 com a Caroline. Agora confirme para a cliente o serviço, o dia e a hora. SINAL: o comprovante de R$ 30,00 foi conferido e ficou registrado no agendamento. Diga que o sinal fica descontado do valor no dia."}

**IA:** Recebi o comprovante, Victor. Seu horário de manicure está marcado para quinta-feira, 26/11, às 8h com a Caroline. O sinal de R$ 30 já fica descontado no dia. 🙏

**Gravado na agenda:** cliente A, Manicure, qui. 26/11 08:00 com Caroline, sinal pago

**Resultado:** PASSOU

---

## V6. Cliente da Caroline marca de novo (a Duda é a preferida só para cliente nova)

**O que se espera:** Oferecer e gravar com a Caroline.

**Cliente A (Victor):** Oi, quero marcar manicure quinta à tarde

> _ferramenta_ `consultar_horarios_livres` {"periodo":"tarde","data":"2026-11-26","duracao_minutos":45,"profissional":""}
> 
> {"resposta":"QUADRO DO DIA — quinta-feira, 26/11 (2026-11-26), serviço de 150 min:\nALMOÇO 11:30 às 13:00: não ofereça horário nessa faixa por conta própria (os inícios abaixo já estão sem ela). Se a cliente PEDIR um horário nessa faixa, confira esse horário exato com consultar_horarios_livres: se voltar LIVRE, pode marcar. OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: 13h com a Caroline (data_hora_inicio: 2026-11-26T13:00) ou 15h com a Caroline (data_hora_inicio: 2026-11-26T15:00). Não mande o quadro abaixo de cara.\nQuadro do dia (só para você, não mande à cliente nem comente se a agenda está aberta ou cheia; se ela perguntar se tem outros horários, ofereça 1 ou 2 inícios NOVOS e exatos tirados daqui):\nExpediente (8h às 18h): livre das 8h às 18h.\nInícios que cabem o serviço (de 30 em 30 min): 13h às 15h30. Se ela disser outro horário, confira esse horário exato com consultar_horarios_livres antes de marcar; se estiver livre e ela já escolheu, pode marcar."}

**IA:** Oi Victor boa noite

A manicure fica R$ 50. Na quinta à tarde tenho às 13h ou às 15h com a Caroline, qual você prefere?

**Cliente A (Victor):** pode ser o primeiro

**IA:** Perfeito, Victor! A manicure fica R$ 50. Pra garantir o horário é um sinal de R$ 30 no Pix, que fica descontado. No dia você paga R$ 20.

**IA:** Chave Pix e-mail em nome de Caroline Ferreira:

**IA:** caroline.teste@exemplo.com

**IA:** Me manda o print do comprovante por aqui 🙏

**Cliente A (Victor):** _[manda a foto do comprovante do Pix]_

> _ferramenta_ `criar_agendamento` {"data_hora_inicio":"2026-11-26T13:00","profissional":"Caroline","duracao_minutos":45,"nome":"Victor","servico":"Manicure","motivo":"Manicure, já é cliente"}
> 
> {"resposta":"AGENDADO com sucesso na agenda do salão: quinta-feira, 26/11 às 13:00 com a Caroline. Agora confirme para a cliente o serviço, o dia e a hora. SINAL: o comprovante de R$ 30,00 foi conferido e ficou registrado no agendamento. Diga que o sinal fica descontado do valor no dia."}

**IA:** Recebi o comprovante, Victor!

**IA:** Seu horário de manicure está marcado para quinta, dia 26/11, às 13h com a Caroline. O sinal de R$ 30 já fica descontado no dia. 🙏

**Gravado na agenda:** cliente A, Manicure, qui. 26/11 13:00 com Caroline, sinal pago

**Resultado:** PASSOU

---


# Plano: conversar com a cliente pelo app

Pedido do Victor em 29/10/2026: a dona (ou a recepção) abre a conversa no app, digita e manda a mensagem
para a cliente pelo WhatsApp do salão, sem sair do app. Vale para todas as lojas (mega hair, manicure,
estúdio). A Gleide está no ar com anúncio: nada muda para ela até o teste passar.

## Como é hoje

- **Conversas** (`crm/app/(app)/conversas/[id]`): mostra o histórico (tabela `mensagens`, em tempo real),
  pausa/reativa a IA e tem o botão **Abrir no WhatsApp**, que abre o app do WhatsApp no celular.
- Quando a dona responde **pelo celular**, a Evolution manda a mensagem para o n8n como `fromMe` e o
  workflow principal já: pausa a IA 12 h para a cliente (Redis `pausa:` + `clientes.ia_pausada_ate`) e grava
  a mensagem como `humano` (`n8n_registrar_saida`). `#ia` devolve para a IA.
- Mensagem mandada **pela API** da Evolution (é o que o app vai usar) **não volta** para o n8n como `fromMe`.
  Por isso o envio pelo app tem de fazer, ele mesmo, o que a resposta pelo celular dispara.

## Como fica

```
App (Conversas)  ──POST + token do login──►  n8n "Enviar pelo app" (webhook)
                                               1. confere o login no Supabase e se a cliente é da loja dele
                                               2. manda pela Evolution (instância da loja)
                                               3. pausa a IA 12 h (Redis + ficha) e grava a mensagem como "humano"
                                               4. devolve ok / erro
App mostra a mensagem na hora (tempo real da tabela mensagens)
```

Por que pelo n8n (e não direto do app): a chave da Evolution e o Redis da IA só existem lá; o app nunca
vê chave nenhuma. A segurança é o próprio login: o n8n pergunta ao Supabase quem é o usuário
(`/auth/v1/user` com o token dele) e só envia se a cliente for de uma loja ligada a esse login
(`usuarios_empresa`). Cada loja tem o próprio webhook (o gerador `--loja` já prefixa), e o app sabe qual
chamar por `empresas.config.envio_app.url`.

## Fases

### 1. n8n: workflow "Enviar pelo app" (Victor) — 1 dia
- [ ] Webhook POST `enviar-pelo-app` com CORS só para o endereço do app (`app.oistudio.com.br` e localhost)
- [ ] Confere o token no Supabase e a cliente (`clientes` da empresa do login); recusa o resto (403)
- [ ] Trava de teste: `empresas.config.envio_app.so_para` (no começo só o número do Victor) e limite de
  mensagens por minuto por login
- [ ] Envia pela Evolution, com o "digitando…" curto como a IA faz (anti-ban)
- [ ] Pausa a IA 12 h e grava `humano` com o id da mensagem do WhatsApp (mesma função de hoje)
- [ ] Entra no gerador (`montar-workflow.js`), então já sai certo para as lojas com `--loja`
- [ ] Testes no n8n sem o app: token inválido, cliente de outra loja, número fora da trava, mensagem vazia

### 2. App: caixa de mensagem na conversa (Victor ou José) — 1 dia
- [ ] Campo para digitar + botão Enviar no fim da conversa (Enter manda no computador; no celular, botão)
- [ ] A mensagem aparece na hora como "enviando…" e vira enviada quando o n8n confirma; se falhar,
  mostra o erro e deixa tentar de novo (o texto não se perde)
- [ ] Aviso curto: "Ao enviar, a IA pausa 12 h para esta cliente" + o botão Reativar IA que já existe
- [ ] Mensagens da dona aparecem do lado do salão, com selo "Você" (as da IA continuam com o selo da IA)
- [ ] Só aparece se a loja tiver `envio_app.url` (loja sem isso continua só com "Abrir no WhatsApp")
- [ ] Testador: Loja Teste no app local + mensagens de teste para o número do Victor

### 3. Ligar para a Gleide — meio dia
- [ ] Gerar e enviar o workflow novo da Gleide (o resto dos workflows dela não muda: conferir antes/depois)
- [ ] Publicar o app (branch `deploy-cloudflare`)
- [ ] Trava só no número do Victor; o Victor testa; depois libera para todas as clientes

### Depois (não entra agora)
- Mandar foto e áudio pelo app
- Respostas rápidas (textos prontos da dona)
- Marcar a conversa como lida / não lida
- Ver no app as mensagens que a dona mandou pelo celular — isso já acontece hoje

## Riscos

1. **Mandar para a cliente errada ou de outra loja** — o n8n confere a cliente pela loja do login, nunca pelo
   que o app manda; a trava de teste começa só no número do Victor.
2. **A IA responder por cima da dona** — o envio pausa a IA 12 h, igual à resposta pelo celular.
3. **Banimento** — mensagem digitada por pessoa é o uso normal; o limite por minuto evita disparo em massa.
4. **Quebrar a Gleide** — workflow novo ao lado; os 14 de hoje são conferidos antes/depois; o app só mostra a
   caixa onde `envio_app.url` estiver configurado.

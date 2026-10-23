# Passagem — 23/10/2026

Onde o projeto parou, para continuar em outro computador ou numa conversa nova do Claude.
Branch de trabalho: `ia-assistente-e-faltas` (ainda **não** foi para o `main`).

## Começar num computador novo (Windows)

No PowerShell:

```powershell
irm https://raw.githubusercontent.com/victorgabrel8-alt/SALAO-VF/ia-assistente-e-faltas/instalar-pc-novo.ps1 | iex
```

Instala Git, Node.js e o app do Claude, baixa o projeto em `%USERPROFILE%\SALAO-VF` e prepara o
app (`crm`). Depois preencha `crm\.env.local` (Supabase → Project Settings → API: URL e chave `anon`).

## O que NÃO está no GitHub (fica no PC de casa)

| O quê | Onde | Para quê |
|---|---|---|
| `.env` da IA | `agente-whatsapp\.env` | chaves do Supabase (service), n8n, Evolution, números |
| `.env.local` do app | `salao-ia\salao-ia\crm\.env.local` | URL e chave pública do Supabase |
| Credenciais do n8n | dentro do n8n (Docker) | Gemini, Redis, Postgres do CRM antigo |
| WhatsApp conectado | Evolution (Docker) | a sessão do número do salão |
| Áudios da Gleide | `agente-whatsapp\audio\` e os `.mp3` | áudios prontos que a IA manda |
| IDs dos workflows | `agente-whatsapp\.workflow-*-id` | o `montar-workflow.js --enviar` cria de novo se faltar |

**A IA roda no Docker do PC de casa.** Se ele desligar, a IA para de responder as clientes.

A cópia que vale da IA é `agente-whatsapp\` (no PC de casa); `n8n\demo-agente\` no repositório é a
cópia versionada. Editar sempre num lugar e sincronizar para o outro, nunca nos dois sentidos.

## Pendências (em ordem)

1. **Aplicar `supabase/013_vaga_pelo_app.sql` no Supabase** (SQL Editor, projeto `zgbzyzsqpkqvwkquofpn`).
   Sem ela, "Remarcou para outro dia" e "Desmarcou (cancelar horário)" no app dão
   `row-level security policy for table "vagas"`. Testada num banco local: resolve.
2. Merge do `ia-assistente-e-faltas` no `main` (Pull Request).
3. Publicar o app (Cloudflare, branch `deploy-cloudflare`). Até isso, o celular da Gleide usa a versão antiga.
4. Subir a IA numa VPS (o PC de casa já caiu de madrugada e o Docker parou à tarde).
5. App Store: o app é web (Next.js). Para a loja precisa empacotar (ex.: Capacitor), Mac com Xcode,
   conta Apple Developer e revisão da Apple (1–3 dias, e ela recusa "só um site dentro de um app").
   Hoje dá para instalar pelo Safari ("Adicionar à Tela de Início").
6. Testes manuais pelo WhatsApp: atraso real (+5 e +25 min, "veio ou libera?"), áudio chegando de verdade.
7. Desfazer a configuração de teste: `ASSISTENTE_NUMEROS` e `empresas.config` (`assistente_numeros`,
   `atrasos.so_para`, `vagas.so_para` com o número do Victor).
8. Crédito do Gemini: pré-pago de R$ 30, sem recarga automática. Quando acaba, a IA para de responder.

## O que foi feito hoje

- Agenda só no app (Supabase): Google Agenda retirado da IA.
- IA: respostas da IA voltaram a aparecer no app (falhavam quando a mensagem esperava outra resposta);
  serviço certo ao marcar (manutenção x aplicação); não cota cabelo sem gramas; filtro de preço não
  some com os horários; anotações (`anotar_no_crm`) vão para o app (ficha "O que ela quer");
  alerta no WhatsApp de alerta quando a cliente pede humano/reclama; tools com `.first()`;
  Supabase com limite de 15 s e nova tentativa nas leituras.
- App: "Fez outro serviço" mantém o serviço marcado como principal; "Desmarcou (cancelar horário)";
  tempo real junta mudanças em rajada; Conversas traz as 100 mais recentes e a busca vai ao banco.
- Supabase: `010_retorno_por_linha_e_varios_servicos` aplicado; `013` escrito (falta aplicar).
- Bateria: 47/47 cenários passaram (`n8n/demo-agente/testes/`).

## Para a conversa nova do Claude

Leia este arquivo, o `CONTRATO.md` (quem faz o quê entre app, banco e IA) e
`n8n/demo-agente/README.md`. Os commits de 23/10 explicam cada correção.

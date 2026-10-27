# Plano: várias lojas (mega hair, estúdio de beleza, manicure)

Combinado com o Victor em 27/10/2026. A Gleide (Salão Toda Bonita, mega hair) continua usando tudo
como está enquanto montamos. Quando estiver pronto e testado, a loja de manicure entra pelo painel da
agência e a Gleide passa para o mesmo esquema.

**Regra de ouro durante a obra:** nada pode mudar o que a Gleide usa hoje. Banco só recebe mudança que
**soma** (coluna nova com valor padrão, tabela nova, função nova); o n8n novo roda **ao lado** dos
workflows dela até a troca; o app só ganha coisas que ela não precisa usar.

## Como fica no final

- **Um banco** (o Supabase de hoje): cada registro tem `empresa_id`; cada dona só enxerga a própria loja.
- **Um app** para todas as donas (o `crm`), com textos e categorias do nicho da loja.
- **Painel da agência** (o `painel-crm`): lista de lojas, criar loja nova, ligar/desligar recursos, ver
  conversas e custo da IA de cada uma.
- **Um conjunto de workflows no n8n** para todas as lojas: a loja é descoberta pela instância do WhatsApp
  (Evolution) que recebeu a mensagem.
- **Prompt em 3 partes:** base comum (jeito de escrever, segurança, agenda) + parte do nicho + dados da loja.

## Fases

### Fase 1 — Banco (Victor) — em andamento
- [x] `empresas` ganha `nicho`, `fuso`, `ativo`, `instancia_whatsapp` (supabase/024)
- [x] Categorias de serviço para manicure e estúdio de beleza (supabase/024)
- [x] Serviços modelo por nicho, sem preço, para a loja nova começar pronta (`servicos_modelo`, supabase/024)
- [x] Função `criar_loja(...)`: cria loja, profissional e serviços do modelo de uma vez (supabase/024)
- [ ] Funções com "America/Cuiaba" fixo passam a usar `empresas.fuso` (só precisa se alguma loja for fora de MT)

### Fase 2 — App (José Paulo)
- [ ] Categorias de serviço vindas do nicho da loja (hoje fixas em mega hair; manicure cai em "Outros")
- [ ] Textos de mega hair só para loja de mega hair (etiqueta "mega hair", ficha de pré-avaliação, placeholder)
- [ ] Fuso da loja em vez de `FUSO = "America/Cuiaba"` (`crm/lib/config.ts`)
- [ ] Painel da agência: lista de lojas e "Nova loja" (chama `criar_loja`, mostra o QR code da Evolution)

### Fase 3 — n8n para várias lojas (Victor)
- [ ] Primeiro passo de todo workflow: descobrir a loja pela instância (`empresas.instancia_whatsapp`)
- [ ] Trocar `$env.EMPRESA_ID` e `$env.EVOLUTION_INSTANCE` pelos dados da loja
- [ ] Prefixo da loja em todas as chaves do Redis (`memoria`, `pausa`, `buffer`, `pedido`, `processando`, `assistente`)
- [ ] Recursos por loja em `empresas.config` (catálogo de cabelos só mega hair; áudios; retomada; faltas)
- [ ] Retomada, faltas, atrasos e vagas percorrendo todas as lojas ativas
- [ ] Teste obrigatório: duas lojas e o mesmo número de cliente, nada vaza de uma para a outra
- [ ] Troca da Gleide para o n8n novo num horário calmo, com volta rápida se der problema

### Fase 4 — Prompts por nicho (Victor)
- [ ] Separar o prompt de hoje em base comum + parte mega hair + dados da loja
- [ ] Parte de manicure e parte de estúdio de beleza
- [ ] Bateria de conversas de teste por nicho

### Fase 5 — Loja de manicure entra
- [ ] Dados da loja (nome, endereço, horários, almoço, pagamento, serviços com preço, quem atende)
- [ ] Convite de login da dona (Supabase → Authentication → Invite user) e ligação em `usuarios_empresa`
- [ ] Instância do WhatsApp dela na Evolution (QR code)
- [ ] Bateria de testes e piloto de 2 semanas acompanhando as conversas

## Riscos

1. **Misturar dados entre lojas** — o pior erro. Prefixo no Redis, todo acesso filtrado por loja e o teste com duas lojas.
2. **Quebrar a Gleide durante a obra** — por isso a regra de ouro acima.
3. **Banimento de número** — cada loja com o próprio número; a leitura humanizada e as pausas que já existem ajudam.

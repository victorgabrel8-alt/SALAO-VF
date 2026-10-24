// Organização visual dos workflows no n8n: posição de cada nó + notas coloridas por etapa.
// Chamado pelo montar-workflow.js antes de gravar/enviar. Nó novo sem posição aqui gera um aviso.
// Cores das notas no n8n: 1 amarelo, 2 laranja, 3 vermelho, 4 verde, 5 azul, 6 roxo, 7 cinza

let nNota = 0;
const nota = (x, y, w, h, color, content) => ({
  id: `00000000-0000-4000-9000-${String(++nNota).padStart(12, '0')}`, name: `Nota ${nNota}`,
  type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [x, y], parameters: { content, width: w, height: h, color },
});

const organizar = (wf, pos, notas) => {
  for (const nd of wf.nodes) if (pos[nd.name]) nd.position = pos[nd.name];
  const semPos = wf.nodes.filter((nd) => !pos[nd.name]).map((nd) => nd.name);
  if (semPos.length) console.warn(`[layout] ${wf.name}: sem posição definida para ${semPos.join(', ')}`);
  wf.nodes = [...notas, ...wf.nodes];
};

module.exports = (principal, agenda, pausa) => {
  organizar(principal, {
    // 1. Entrada
    'Webhook Evolution': [0, 0], 'Extrair dados': [220, 0], 'Minha resposta manual?': [440, 0],
    // número da Gleide -> workflow "Assistente da Gleide"
    'É a Gleide (assistente)?': [440, -620], 'Repassar para a assistente': [700, -700],
    // sua resposta manual / #ia
    'Comando #ia?': [700, -320], 'Pausa: remover': [940, -440], 'Pausa: humano assumiu (12h)': [940, -300],
    // 2. Filtro e pausa
    'Filtro': [700, 0], 'Pausa: verificar': [920, 0], 'IA ativa?': [1140, 0],
    // 3. Áudio e fotos
    'É áudio ou foto?': [1400, 0], 'Baixar mídia (Evolution)': [1620, -160], 'Entender mídia (Gemini)': [1840, -160], 'Texto da mensagem': [2060, 0],
    // 4. Buffer
    'Buffer: guardar msg': [2320, 0], 'Buffer: marcar última': [2540, 0], 'Aguardar (juntar mensagens)': [2760, 0], 'Buffer: ler última': [2980, 0],
    'É a última msg?': [3200, 0], 'Pausa: verificar de novo': [3420, 0], 'Ainda ativa?': [3640, 0],
    'Trava: ler': [3880, 0], 'Ninguém respondendo?': [4100, 0], 'Aguardar 3s (IA respondendo)': [4100, 200], 'Trava: marcar': [4320, 0],
    'Buffer: ler mensagens': [4540, 0], 'Buffer: limpar': [4760, 0], 'Buffer: descartar (pausada)': [3880, 200],
    // 5. Agente IA (linha de baixo)
    'Montar entrada': [0, 800], 'Marcar como lida': [220, 800], 'Agente IA': [560, 800],
    // memória sem começo quebrado (memoria-janela.js), logo antes do agente
    'Memória: ler (Agente IA)': [560, 520], 'Memória: conferir (Agente IA)': [700, 520], 'Memória: cortar? (Agente IA)': [840, 520],
    'Memória: apagar (Agente IA)': [980, 440], 'Memória: regravar itens (Agente IA)': [1120, 440], 'Memória: regravar (Agente IA)': [1260, 440],
    'Memória: pronta (Agente IA)': [1260, 600],
    'Gemini Flash': [100, 1100], 'Memória (Redis)': [240, 1100], 'consultar_horarios_livres': [380, 1100], 'ver_agendamentos': [520, 1100],
    'criar_agendamento': [660, 1100], 'remarcar_agendamento': [800, 1100], 'cancelar_agendamento': [940, 1100], 'transferir_para_humano': [1080, 1100],
    'anotar_no_crm': [1220, 1100], 'CRM: registrar contato': [0, 980],
    // 6. Resposta humanizada
    'Quebrar mensagens': [1440, 800], 'IA falhou? (alerta)': [1550, 560], 'Avisar Victor (IA falhou)': [1660, 560], 'Tem texto pra enviar?': [1550, 680], 'Um balão por vez': [1660, 800], 'Trava: liberar': [1880, 720], 'Pausa (lendo/respirando)': [1880, 940], 'Digitando (blocos de 8s)': [2100, 1060], 'Digitando...': [2100, 940], 'Enviar mensagem': [2320, 940],
    // Supabase (banco do CRM)
    'Supabase: ficha da cliente': [300, 980], 'Supabase: histórico da cliente': [300, 1180], 'Sobre esta cliente': [420, 980],
    'Supabase: áudios do salão': [420, 1180], 'Supabase: áudios já enviados': [540, 1180], 'Áudios disponíveis': [540, 980], 'enviar_audio': [1360, 1100],
    'Supabase: registrar entrada': [2060, 220], 'Pausa: alinhar com o CRM': [2280, 220], 'Supabase: registrar saída': [2540, 940],
    'Supabase: dona respondeu': [1160, -280], 'Supabase: reativar IA': [1160, -440],
    'Supabase: alô recente': [940, -160], 'É o alô do CRM?': [1160, -160], 'Supabase: registrar alô': [1380, -160],
    'Supabase: último alô': [300, 1380], 'Supabase: últimas mensagens': [300, 1580],
  }, [
    nota(-60, -140, 680, 320, 7, '## 1. Entrada\nMensagem do WhatsApp chega da Evolution.\nExtrai telefone, nome, tipo e texto.'),
    nota(640, -520, 540, 340, 3, '## Sua resposta pelo celular\nMensagem SUA (fromMe) numa conversa → **pausa a IA 12 h** para esse número.\nMandou `#ia` → tira a pausa.'),
    nota(640, -140, 680, 320, 4, '## 2. Filtro e pausa\nIgnora grupos, status e figurinhas.\nSe a cliente está pausada (pediu humano ou você respondeu), para aqui.'),
    nota(1340, -320, 920, 500, 6, '## 3. Áudio e fotos\nBaixa a mídia pela Evolution.\nÁudio → Gemini **transcreve**. Foto → Gemini **descreve o cabelo**.\nTexto normal passa direto.'),
    nota(2260, -140, 2740, 500, 2, '## 4. Buffer de 20 s + trava\nJunta mensagens seguidas da mesma pessoa (Redis).\nSó a ÚLTIMA mensagem da rajada segue, depois de 20 s sem novas.\nConfere a pausa de novo antes de responder.\n**Trava:** se a IA ainda está respondendo essa pessoa, espera terminar e lê tudo junto.\n\n➡️ continua na linha de baixo (Montar entrada)'),
    nota(-60, 660, 1380, 600, 5, '## 5. Agente IA\nGemini + memória por telefone (Redis, 24 h) + ferramentas:\nagenda (consultar, criar, ver, remarcar, cancelar), transferir para humano e anotar no CRM.\nCRM: registrar contato = cria/atualiza a ficha da cliente a cada conversa.\nPrompt: `prompt-agente.md` · publicar: `node montar-workflow.js --enviar --ativar`'),
    nota(1380, 660, 1180, 480, 4, '## 6. Resposta humanizada\nUma mensagem só, um parágrafo por assunto, sem negrito.\nPausa de leitura (1–5 s) → "digitando…" 60–90 ms por letra (3–10 s) → envia.\nTenta 3x se o WhatsApp oscilar.'),
  ]);

  organizar(agenda, {
    'Recebe pedido do agente': [0, 0], 'Preparar': [220, 0],
    'Supabase: horários ocupados': [440, 0], 'Supabase: config do salão': [660, 0], 'Supabase: agendamentos da cliente': [880, 0],
    'Calcular': [1100, 0],
    'Criar evento?': [1320, 0],
    'Supabase: cliente e serviços': [1540, -180], 'Supabase: serviços': [1760, -180], 'Supabase: profissionais': [1980, -180],
    'Montar agendamento': [2200, -180], 'Supabase: gravar agendamento': [2420, -180], 'Supabase: nome da cliente': [2640, -180],
    'Resposta (agendado)': [2860, -180],
    'Cancelar evento?': [1540, 120], 'Supabase: cancelar agendamento': [1760, 40], 'Resposta (cancelado)': [1980, 40],
    'Remarcar evento?': [1760, 260], 'Supabase: remarcar agendamento': [1980, 200], 'Resposta (remarcado)': [2200, 200],
    'Resposta': [1980, 400],
  }, [
    nota(-60, -160, 1340, 360, 5, '## 1. Lê a agenda do app\nChamado pelas ferramentas do agente.\nSupabase: horários ocupados (IA + Gleide) · horário do salão · horários desta cliente.\n**Calcular** = regras de `agenda-calculo.js` (expediente, almoço, bloqueios, faixas livres).'),
    nota(1280, -340, 1820, 900, 4, '## 2. Executa a ação no app\n**criar** → novo horário (origem IA) · **cancelar** → status cancelado · **remarcar** → move o MESMO horário\nConsultar/ver → só devolve o texto (Resposta).'),
  ]);

  organizar(pausa, { 'Recebe pedido do agente': [0, 0], 'Gravar pausa (12h)': [220, 0], 'CRM: com humano': [440, 0], 'Supabase: pausar IA': [660, 0], 'Resposta': [880, 0] }, [
    nota(-60, -180, 920, 360, 3, '## Transferir para humano\nChamado pelo agente quando a cliente pede uma pessoa, reclama ou sai do escopo.\nGrava `pausa:{telefone}` no Redis por 12 h. Mande `#ia` na conversa para devolver à IA.'),
  ]);
};

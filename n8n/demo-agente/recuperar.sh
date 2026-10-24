#!/usr/bin/env bash
# Recupera o ambiente num computador novo (sem os volumes antigos do Docker).
# Uso (Git Bash, nesta pasta):  bash recuperar.sh
# Serve para rodar a IA neste PC (Docker Desktop) ou num VPS com Easypanel: no modo VPS ele roda
# daqui do seu PC e configura o n8n e a Evolution do servidor pelos domínios (https).
# Pergunta só o que depende de você (chaves e senha do n8n) e faz o resto.
# Pode rodar quantas vezes quiser: cada passo só faz o que ainda falta.
# Detalhes e o que fica de fora: RECUPERACAO.md
set -euo pipefail
cd "$(dirname "$0")"

# Projeto do Supabase do salão (não são segredos: a URL e a anon key vão no app do CRM)
SUPABASE_PADRAO=https://zgbzyzsqpkqvwkquofpn.supabase.co
SUPABASE_ANON=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnYnp5enNxcGtxdndrcXVvZnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MTEwMjQsImV4cCI6MjEwODA4NzAyNH0._w57590MAXqJjBFvFI774-CzyXj6PQhP0G9xJbFlcoE
EMPRESA_PADRAO=00000000-0000-0000-0000-000000000001

ok()   { echo "  ✅ $*"; }
info() { echo "  ➜ $*"; }
erro() { echo; echo "❌ $*"; echo "   Corrija e rode de novo:  bash recuperar.sh"; exit 1; }
abrir() { start "" "$1" 2>/dev/null || xdg-open "$1" >/dev/null 2>&1 || true; }
aleatorio() { openssl rand -hex 24 2>/dev/null || node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"; }
# grava CHAVE=valor no .env (troca a linha se existir, senão acrescenta)
gravar() {
  node -e "const fs=require('fs');const [k,v]=process.argv.slice(1);let s=fs.readFileSync('.env','utf8');
    const re=new RegExp('^'+k+'=.*$','m');s=re.test(s)?s.replace(re,()=>k+'='+v):s.replace(/\n*$/,'\n')+k+'='+v+'\n';fs.writeFileSync('.env',s)" "$1" "$2"
}
carregar() { set -a; . ./.env; set +a; }
# perguntar VAR "pergunta" [página para abrir] [secreto]  -> só pergunta se VAR estiver vazia
novo=""
perguntar() {
  novo=""
  [ -z "${!1:-}" ] || return 0
  novo=1
  echo
  [ -z "${3:-}" ] || { info "abrindo $3"; abrir "$3"; }
  local v
  if [ -n "${4:-}" ]; then read -rsp "  $2: " v; echo; else read -rp "  $2: " v; fi
  v=$(printf '%s' "$v" | tr -d '\r' | sed 's/^ *//; s/ *$//')
  [ -n "$v" ] || erro "$1 ficou vazio."
  gravar "$1" "$v"; printf -v "$1" '%s' "$v"
}

command -v node >/dev/null || erro "Node.js não instalado. No PowerShell: winget install OpenJS.NodeJS.LTS  (depois feche e abra o Git Bash)"

echo "1/7 Arquivo .env"
[ -f .env ] || { cp .env.example .env; ok ".env criado"; }
carregar
for k in POSTGRES_PASSWORD EVOLUTION_API_KEY N8N_ENCRYPTION_KEY; do
  case "${!k:-}" in ''|troque-esta-*) gravar "$k" "$(aleatorio)" ;; esac
done
[ -n "${SUPABASE_URL:-}" ] || gravar SUPABASE_URL "$SUPABASE_PADRAO"
[ -n "${EMPRESA_ID:-}" ] || gravar EMPRESA_ID "$EMPRESA_PADRAO"
carregar
if [ -z "${MODO:-}" ]; then
  echo; read -rp "  Onde a IA vai rodar?  1 = neste PC   2 = VPS com Easypanel  [2]: " v
  case "$(printf '%s' "${v:-2}" | tr -d '\r ')" in
    1) gravar MODO pc ;;
    *) gravar MODO vps
       # IDs de uma tentativa anterior neste PC não valem no n8n do VPS
       for k in N8N_API_KEY N8N_REDIS_CRED_ID N8N_GEMINI_CRED_ID N8N_GCAL_CRED_ID N8N_CRM_CRED_ID; do gravar "$k" ""; done ;;
  esac
  carregar
fi
if [ "$MODO" = vps ]; then
  echo; info "Domínios do VPS: crie no seu DNS um registro A de cada um apontando para o IP do VPS."
  perguntar DOMINIO_N8N "Domínio do n8n (ex.: n8n.seudominio.com.br)"
  perguntar DOMINIO_EVO "Domínio da Evolution/WhatsApp (ex.: evo.seudominio.com.br)"
  for k in DOMINIO_N8N DOMINIO_EVO; do
    v=$(printf '%s' "${!k}" | sed -E 's#^https?://##; s#/.*$##'); gravar "$k" "$v"
  done
  carregar
  N8N=https://$DOMINIO_N8N; EVO_URL=https://$DOMINIO_EVO
else
  N8N=http://localhost:5678; EVO_URL=http://localhost:8080
fi
gravar N8N_URL "$N8N"

echo "2/7 O que só você sabe (pergunto uma vez e guardo no .env)"
perguntar MEU_NUMERO "Número do WhatsApp que vai ler o QR code (55+DDD+número, só dígitos)"
if ! grep -q '^NUMEROS_PERMITIDOS=.' .env; then
  echo; read -rp "  Números que podem falar com a IA, separados por vírgula (Enter = só $MEU_NUMERO): " v
  v=$(printf '%s' "${v:-$MEU_NUMERO}" | tr -d '\r '); gravar NUMEROS_PERMITIDOS "$v"
fi
perguntar SUPABASE_SERVICE_KEY "Supabase: cole a chave service_role / secret (clique em Reveal)" \
  "https://supabase.com/dashboard/project/zgbzyzsqpkqvwkquofpn/settings/api-keys" secreto
[ -z "$novo" ] || curl -sf -m 15 "$SUPABASE_URL/rest/v1/empresas?select=id&limit=1" -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" >/dev/null \
  || { gravar SUPABASE_SERVICE_KEY ""; erro "O Supabase recusou essa chave. Confira se copiou a service_role inteira."; }
perguntar GEMINI_API_KEY "Gemini: cole a API key (use a que já existe ou 'Create API key')" "https://aistudio.google.com/apikey" secreto
[ -z "$novo" ] || curl -sf -m 15 "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" >/dev/null \
  || { gravar GEMINI_API_KEY ""; erro "O Google recusou essa chave do Gemini."; }
if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ]; then
  echo
  info "Google Cloud: abra o cliente OAuth 'Aplicativo da Web' do projeto do salão."
  info "  Em 'URIs de redirecionamento autorizados' adicione: $N8N/rest/oauth2-credential/callback"
  info "  Em 'Chaves secretas do cliente' clique em 'Adicionar chave secreta'."
fi
perguntar GOOGLE_CLIENT_ID "Google Cloud: cole o ID do cliente (...apps.googleusercontent.com)" "https://console.cloud.google.com/apis/credentials"
perguntar GOOGLE_CLIENT_SECRET "Google Cloud: cole a chave secreta do cliente" "" secreto
ok "dados guardados no .env"
carregar

echo "3/7 Containers"
if [ "$MODO" = vps ]; then
  amb=easypanel-environment.txt
  { for k in POSTGRES_USER POSTGRES_PASSWORD EVOLUTION_API_KEY EVOLUTION_INSTANCE N8N_ENCRYPTION_KEY MEU_NUMERO \
      NUMEROS_PERMITIDOS ASSISTENTE_NUMEROS SUPABASE_URL SUPABASE_SERVICE_KEY EMPRESA_ID GOOGLE_CALENDAR_ID DOMINIO_N8N DOMINIO_EVO; do
      echo "$k=${!k:-}"; done; } > "$amb"
  if ! curl -sf -m 10 "$N8N/rest/settings" | grep -q userManagement; then
    clip < "$amb" 2>/dev/null && copiado=" (já está copiado: é só colar com Ctrl+V)" || copiado=""
    echo
    info "No Easypanel (Hostinger → Gerenciar painel):"
    info "  1. No projeto 'salao-vf' → + Serviço → Compose → nome 'ia'."
    info "  2. Fonte → Git:  URL https://github.com/victorgabrel8-alt/SALAO-VF.git"
    info "     Ramo claude/gracious-ptolemy-2w5gr1 · Caminho de Build /"
    info "     Arquivo do Docker Compose: n8n/demo-agente/easypanel/docker-compose.yml → Salvar"
    info "  3. Ambiente (Environment): cole o conteúdo de $amb$copiado → Salvar."
    info "  4. Domínios → Adicionar Domínio (HTTPS ligado):"
    info "       $DOMINIO_N8N  → serviço n8n,       porta 5678, HTTPS ligado"
    info "       $DOMINIO_EVO  → serviço evolution, porta 8080, HTTPS ligado"
    info "  5. Implantar."
    abrir "$amb"
    read -rp "  Aperte Enter depois do Deploy... " _
  fi
  info "esperando $N8N e $EVO_URL responderem..."
  for i in $(seq 1 100); do
    curl -sf -m 5 "$EVO_URL" >/dev/null && curl -sf -m 5 "$N8N/rest/settings" | grep -q userManagement && break
    sleep 6
  done
  curl -sf -m 5 "$N8N/rest/settings" | grep -q userManagement || erro "$N8N não respondeu. Confira no Easypanel os logs do serviço n8n e os domínios (DNS apontando para o VPS)."
  curl -sf -m 5 "$EVO_URL" >/dev/null || erro "$EVO_URL não respondeu. Confira no Easypanel o domínio da Evolution."
  rm -f "$amb"
  ok "n8n e Evolution no ar no VPS"
else
docker info >/dev/null 2>&1 || erro "O Docker não está rodando. Abra o Docker Desktop e espere 'Engine running'."
docker compose up -d >/dev/null 2>&1 || docker compose up -d
info "esperando Evolution e n8n responderem (a primeira vez demora uns minutos)..."
for i in $(seq 1 100); do
  curl -sf -m 3 localhost:8080 >/dev/null && curl -sf -m 3 localhost:5678/rest/settings | grep -q userManagement && break
  sleep 3
done
curl -sf -m 3 localhost:5678/rest/settings | grep -q userManagement || erro "O n8n não respondeu. Veja: docker compose logs n8n"
ok "containers no ar"
fi

echo "4/7 Banco do CRM local"
if [ "$MODO" = vps ]; then ok "o Postgres do VPS cria o banco crm sozinho na primeira subida"; else
PSQL=(docker compose exec -T postgres psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -q)
if [ "$("${PSQL[@]}" -d evolution -tAc "SELECT 1 FROM pg_database WHERE datname='crm'" </dev/null)" != "1" ]; then
  "${PSQL[@]}" -d evolution -c "CREATE DATABASE crm" </dev/null
  "${PSQL[@]}" -d crm < crm-schema.sql
fi
ok "banco crm pronto"
fi

echo "5/7 Conta do n8n"
if [ -z "${N8N_API_KEY:-}" ] || ! curl -sf "$N8N/api/v1/workflows?limit=1" -H "X-N8N-API-KEY: $N8N_API_KEY" >/dev/null; then
  COOKIE=$(mktemp)
  config=$(curl -s "$N8N/rest/settings")
  if node -e "process.exit(JSON.parse(process.argv[1]).data.userManagement.showSetupOnFirstLoad?0:1)" "$config"; then
    echo; info "Crie o login do n8n (pode ser o mesmo de antes). A senha precisa de 8+ letras, 1 número e 1 maiúscula."
  else
    echo; info "Entre com o login do n8n ($N8N)."
  fi
  read -rp "  E-mail: " email; read -rsp "  Senha: " senha; echo
  corpo=$(node -e "console.log(JSON.stringify({email:process.argv[1],password:process.argv[2],firstName:'Victor',lastName:'Salão',emailOrLdapLoginId:process.argv[1]}))" "$email" "$senha")
  if node -e "process.exit(JSON.parse(process.argv[1]).data.userManagement.showSetupOnFirstLoad?0:1)" "$config"; then
    r=$(curl -s -c "$COOKIE" -X POST "$N8N/rest/owner/setup" -H 'Content-Type: application/json' -d "$corpo")
    echo "$r" | grep -q '"id"' || erro "O n8n não aceitou a conta: $r"
  fi
  r=$(curl -s -b "$COOKIE" -c "$COOKIE" -X POST "$N8N/rest/login" -H 'Content-Type: application/json' -d "$corpo")
  echo "$r" | grep -q '"id"' || erro "E-mail ou senha do n8n não conferem."
  escopos=$(curl -s -b "$COOKIE" "$N8N/rest/api-keys/scopes" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).data)))")
  r=$(curl -s -b "$COOKIE" -X POST "$N8N/rest/api-keys" -H 'Content-Type: application/json' \
    -d "{\"label\":\"recuperar.sh $(date +%d-%m-%Y)\",\"expiresAt\":null,\"scopes\":$escopos}")
  chave=$(node -e "try{console.log(JSON.parse(process.argv[1]).data.rawApiKey||'')}catch{console.log('')}" "$r")
  rm -f "$COOKIE"
  [ -n "$chave" ] || erro "Não consegui criar a API key do n8n: $r"
  gravar N8N_API_KEY "$chave"; carregar
fi
ok "login e API key do n8n prontos"

echo "6/7 Credenciais e workflows no n8n"
API=$N8N/api/v1
H=(-H "X-N8N-API-KEY: $N8N_API_KEY" -H 'Content-Type: application/json')
# criar_credencial VAR_DO_ID nome tipo json-dos-dados
criar_credencial() {
  if [ -n "${!1:-}" ]; then ok "$2"; return; fi
  local corpo resp id
  corpo=$(node -e "console.log(JSON.stringify({name:process.argv[1],type:process.argv[2],data:JSON.parse(process.argv[3])}))" "$2" "$3" "$4")
  resp=$(curl -s -X POST "$API/credentials" "${H[@]}" -d "$corpo")
  id=$(node -e "try{console.log(JSON.parse(process.argv[1]).id||'')}catch{console.log('')}" "$resp")
  [ -n "$id" ] || erro "Não consegui criar a credencial $2: $resp"
  gravar "$1" "$id"; ok "$2 criada"
}
criar_credencial N8N_REDIS_CRED_ID "Redis local" redis '{"host":"redis","port":6379,"database":0,"password":""}'
criar_credencial N8N_CRM_CRED_ID "CRM Postgres" postgres \
  "{\"host\":\"postgres\",\"port\":5432,\"database\":\"crm\",\"user\":\"$POSTGRES_USER\",\"password\":\"$POSTGRES_PASSWORD\",\"ssl\":\"disable\",\"allowUnauthorizedCerts\":false,\"sshTunnel\":false}"
criar_credencial N8N_GEMINI_CRED_ID "Google Gemini(PaLM) Api account" googlePalmApi \
  "{\"host\":\"https://generativelanguage.googleapis.com\",\"apiKey\":\"$GEMINI_API_KEY\"}"
criar_credencial N8N_GCAL_CRED_ID "Google Calendar account 2" googleCalendarOAuth2Api \
  "{\"clientId\":\"$GOOGLE_CLIENT_ID\",\"clientSecret\":\"$GOOGLE_CLIENT_SECRET\",\"sendAdditionalBodyProperties\":false,\"additionalBodyProperties\":\"\"}"
carregar
node montar-workflow.js --enviar --ativar | grep -E 'erro|Criado|Atualizado' || true
# app do CRM e painel: mesma URL e anon key do Supabase
for app in ../../crm ../../painel-crm; do
  [ -d "$app" ] && [ ! -f "$app/.env.local" ] && \
    printf 'NEXT_PUBLIC_SUPABASE_URL=%s\nNEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$SUPABASE_URL" "$SUPABASE_ANON" > "$app/.env.local"
done
ok "workflows publicados e ativos"

echo "7/7 Os dois cliques que só você pode dar"
echo
info "GOOGLE AGENDA: vou abrir a credencial no n8n. Clique em 'Sign in with Google' →"
info "  sua conta → Avançado → Acessar → Permitir → 'Account connected' → Save."
abrir "$N8N/home/credentials/$N8N_GCAL_CRED_ID"
read -rp "  Aperte Enter quando aparecer 'Account connected'... " _

EVO=(-H "apikey: $EVOLUTION_API_KEY" -H 'Content-Type: application/json')
if ! curl -s $EVO_URL/instance/fetchInstances "${EVO[@]}" | grep -q "\"name\":\"$EVOLUTION_INSTANCE\""; then
  curl -s -X POST $EVO_URL/instance/create "${EVO[@]}" -d "{\"instanceName\":\"$EVOLUTION_INSTANCE\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true,\"groupsIgnore\":true,
    \"webhook\":{\"url\":\"http://n8n:5678/webhook/whatsapp-salao\",\"byEvents\":false,\"base64\":true,\"events\":[\"MESSAGES_UPSERT\"]}}" >/dev/null
fi
estado() { curl -s "$EVO_URL/instance/connectionState/$EVOLUTION_INSTANCE" "${EVO[@]}" | grep -oE '"state":"[a-z]+"' | cut -d'"' -f4 || true; }
if [ "$(estado)" != "open" ]; then
  echo
  info "WHATSAPP: no celular, em Dispositivos conectados, DESCONECTE o aparelho antigo ('Toda Bonita')."
  info "  Depois toque em 'Conectar dispositivo' e leia o QR code que vou abrir (ele se renova sozinho)."
  QR=qrcode.html; aberto=""
  for i in $(seq 1 18); do
    [ "$(estado)" = "open" ] && break
    img=$(curl -s "$EVO_URL/instance/connect/$EVOLUTION_INSTANCE" "${EVO[@]}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).base64||'')}catch{console.log('')}})")
    if [ -n "$img" ]; then
      printf '<meta http-equiv="refresh" content="10"><body style="text-align:center;font-family:sans-serif"><h2>Leia no WhatsApp: Dispositivos conectados → Conectar dispositivo</h2><img src="%s" width="380"></body>' "$img" > "$QR"
      [ -n "$aberto" ] || { abrir "$QR"; aberto=1; }
    fi
    sleep 10
  done
  rm -f "$QR"
fi
if [ "$(estado)" = "open" ]; then ok "WhatsApp conectado"; else
  info "WhatsApp ainda não conectou. Rode 'bash recuperar.sh' de novo para outro QR code,"
  info "  ou use o painel: $EVO_URL/manager (API Key = EVOLUTION_API_KEY do .env)."; fi

echo
echo "✅ Tudo pronto. Teste: de outro celular (de NUMEROS_PERMITIDOS) mande 'oi' para $MEU_NUMERO."
echo "   ⚠️  Guarde uma cópia do arquivo .env fora deste computador (Drive, pendrive)."

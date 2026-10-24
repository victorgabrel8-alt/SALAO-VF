#!/usr/bin/env bash
# Recupera o ambiente num computador novo (sem os volumes antigos do Docker).
# Uso (Git Bash, nesta pasta):  bash recuperar.sh
# Pode rodar quantas vezes quiser: cada passo só faz o que ainda falta.
# Passo a passo completo e o que fica de fora: RECUPERACAO.md
set -euo pipefail
cd "$(dirname "$0")"

ok()   { echo "  ✅ $*"; }
info() { echo "  ➜ $*"; }
pare() { echo; echo "⏸  $*"; echo "   Depois rode de novo:  bash recuperar.sh"; exit 0; }
aleatorio() { openssl rand -hex 24 2>/dev/null || node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"; }
# grava CHAVE=valor no .env (troca a linha se existir, senão acrescenta)
gravar() {
  if grep -q "^$1=" .env; then
    node -e "const fs=require('fs');const [k,v]=process.argv.slice(1);fs.writeFileSync('.env',fs.readFileSync('.env','utf8').replace(new RegExp('^'+k+'=.*$','m'),k+'='+v))" "$1" "$2"
  else
    printf '\n%s=%s\n' "$1" "$2" >> .env
  fi
}
carregar() { set -a; . ./.env; set +a; }

echo "1/6 Arquivo .env"
if [ ! -f .env ]; then
  cp .env.example .env
  gravar POSTGRES_PASSWORD "$(aleatorio)"
  gravar EVOLUTION_API_KEY "$(aleatorio)"
  gravar N8N_ENCRYPTION_KEY "$(aleatorio)"
  ok ".env criado com senhas novas (guarde uma cópia dele fora do PC!)"
else
  ok ".env já existe"
fi
carregar
for k in POSTGRES_PASSWORD EVOLUTION_API_KEY N8N_ENCRYPTION_KEY; do
  case "${!k:-}" in ''|troque-esta-*) gravar "$k" "$(aleatorio)"; info "$k gerada" ;; esac
done
carregar
[ -n "${MEU_NUMERO:-}" ] || pare "Preencha MEU_NUMERO (e NUMEROS_PERMITIDOS, SUPABASE_URL, SUPABASE_SERVICE_KEY, EMPRESA_ID) no .env."

echo "2/6 Containers"
docker info >/dev/null 2>&1 || pare "O Docker não está rodando. Abra o Docker Desktop e espere 'Engine running'."
docker compose up -d
info "esperando Evolution e n8n responderem..."
for i in $(seq 1 60); do
  curl -sf -m 3 localhost:8080 >/dev/null && curl -sf -m 3 localhost:5678/healthz >/dev/null && break
  sleep 3
done
curl -sf -m 3 localhost:5678/healthz >/dev/null || pare "O n8n não respondeu. Veja: docker compose logs n8n"
ok "containers no ar"

echo "3/6 Banco do CRM local (Postgres do docker)"
PSQL=(docker compose exec -T postgres psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -q)
if [ "$("${PSQL[@]}" -d evolution -tAc "SELECT 1 FROM pg_database WHERE datname='crm'")" != "1" ]; then
  "${PSQL[@]}" -d evolution -c "CREATE DATABASE crm"
  "${PSQL[@]}" -d crm < crm-schema.sql
  ok "banco crm criado"
else
  ok "banco crm já existe"
fi

echo "4/6 Instância do WhatsApp na Evolution"
EVO=(-H "apikey: $EVOLUTION_API_KEY" -H 'Content-Type: application/json')
if ! curl -s localhost:8080/instance/fetchInstances "${EVO[@]}" | grep -q "\"name\":\"$EVOLUTION_INSTANCE\""; then
  curl -s -X POST localhost:8080/instance/create "${EVO[@]}" -d "{\"instanceName\":\"$EVOLUTION_INSTANCE\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true,\"groupsIgnore\":true,
    \"webhook\":{\"url\":\"http://n8n:5678/webhook/whatsapp-salao\",\"byEvents\":false,\"base64\":true,\"events\":[\"MESSAGES_UPSERT\"]}}" >/dev/null
  ok "instância $EVOLUTION_INSTANCE criada (com o webhook do n8n)"
fi
estado=$(curl -s "localhost:8080/instance/connectionState/$EVOLUTION_INSTANCE" "${EVO[@]}" | grep -oE '"state":"[a-z]+"' | cut -d'"' -f4 || true)
if [ "$estado" = "open" ]; then
  ok "WhatsApp conectado"
else
  info "WhatsApp ainda NÃO conectado (estado: ${estado:-?}). Leia o QR code em http://localhost:8080/manager"
  info "  Server URL http://localhost:8080 · API Key = EVOLUTION_API_KEY do .env · instância $EVOLUTION_INSTANCE"
  info "  (dá para continuar e conectar depois)"
fi

echo "5/6 Credenciais no n8n"
[ -n "${N8N_API_KEY:-}" ] || pare "Abra http://localhost:5678, crie a conta de dono e depois em http://localhost:5678/settings/api crie uma API key (sem expiração). Cole no .env: N8N_API_KEY=..."
API=localhost:5678/api/v1
H=(-H "X-N8N-API-KEY: $N8N_API_KEY" -H 'Content-Type: application/json')
curl -sf "$API/workflows?limit=1" "${H[@]}" >/dev/null || pare "A N8N_API_KEY do .env não foi aceita pelo n8n. Crie outra em http://localhost:5678/settings/api."
# criar_credencial VAR_DO_ID nome tipo json-dos-dados
criar_credencial() {
  if [ -n "${!1:-}" ]; then ok "$2 (já no .env: ${!1})"; return; fi
  local corpo resp id
  corpo=$(node -e "console.log(JSON.stringify({name:process.argv[1],type:process.argv[2],data:JSON.parse(process.argv[3])}))" "$2" "$3" "$4")
  resp=$(curl -s -X POST "$API/credentials" "${H[@]}" -d "$corpo")
  id=$(node -e "try{console.log(JSON.parse(process.argv[1]).id||'')}catch{console.log('')}" "$resp")
  [ -n "$id" ] || { echo "  ❌ erro ao criar $2: $resp"; exit 1; }
  gravar "$1" "$id"; ok "$2 criada ($id)"
}
criar_credencial N8N_REDIS_CRED_ID "Redis local" redis '{"host":"redis","port":6379,"database":0,"password":""}'
criar_credencial N8N_CRM_CRED_ID "CRM Postgres" postgres \
  "{\"host\":\"postgres\",\"port\":5432,\"database\":\"crm\",\"user\":\"$POSTGRES_USER\",\"password\":\"$POSTGRES_PASSWORD\",\"ssl\":\"disable\",\"allowUnauthorizedCerts\":false,\"sshTunnel\":false}"
if [ -n "${GEMINI_API_KEY:-}" ]; then
  criar_credencial N8N_GEMINI_CRED_ID "Google Gemini(PaLM) Api account" googlePalmApi \
    "{\"host\":\"https://generativelanguage.googleapis.com\",\"apiKey\":\"$GEMINI_API_KEY\"}"
fi
if [ -n "${GOOGLE_CLIENT_ID:-}" ] && [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  criar_credencial N8N_GCAL_CRED_ID "Google Calendar account 2" googleCalendarOAuth2Api \
    "{\"clientId\":\"$GOOGLE_CLIENT_ID\",\"clientSecret\":\"$GOOGLE_CLIENT_SECRET\",\"sendAdditionalBodyProperties\":false,\"additionalBodyProperties\":\"\"}"
fi
carregar
falta=""
[ -n "${N8N_GEMINI_CRED_ID:-}" ] || falta="$falta\n   - GEMINI_API_KEY=...  (crie em https://aistudio.google.com/apikey)"
[ -n "${N8N_GCAL_CRED_ID:-}" ] || falta="$falta\n   - GOOGLE_CLIENT_ID=... e GOOGLE_CLIENT_SECRET=...  (Google Cloud Console, ver RECUPERACAO.md)"
[ -z "$falta" ] || pare "$(printf "Coloque no .env:%b" "$falta")"

echo "6/6 Workflows"
node montar-workflow.js --enviar --ativar
echo
echo "✅ Pronto. Falta só o que é feito à mão:"
echo "   - n8n > Credentials > 'Google Calendar account 2' > Sign in with Google (se ainda não fez)"
echo "   - WhatsApp conectado pelo QR code (passo 4)"
echo "   - Testes: RECUPERACAO.md, seção 'Conferir se voltou tudo'"

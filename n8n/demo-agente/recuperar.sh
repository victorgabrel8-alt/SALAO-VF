#!/usr/bin/env bash
# Recupera o ambiente num computador novo (sem os volumes antigos do Docker).
# Uso (Git Bash, nesta pasta):  bash recuperar.sh
# Serve para rodar a IA neste PC (Docker Desktop) ou num VPS com Easypanel: no modo VPS ele roda
# daqui do seu PC e configura o n8n e a Evolution do servidor pelos domínios (https).
# Pergunta só o que depende de você (chaves e senha do n8n) e faz o resto.
# A agenda é a do app (Supabase): não usa Google Agenda.
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
# grava CHAVE=valor no .env: uma linha só por chave (no lugar da primeira, senão no fim)
gravar() {
  node -e "const fs=require('fs');const [k,v]=process.argv.slice(1);const ls=fs.readFileSync('.env','utf8').split(/\r?\n/);
    const i=ls.findIndex(l=>l.startsWith(k+'='));const fora=ls.filter(l=>!l.startsWith(k+'='));
    if(i<0){while(fora.length&&!fora[fora.length-1])fora.pop();fora.push(k+'='+v,'')}else fora.splice(ls.slice(0,i).filter(l=>!l.startsWith(k+'=')).length,0,k+'='+v);
    fs.writeFileSync('.env',fora.join('\n'))" "$1" "$2"
}
# lê o .env sem executar nada (um comando colado por engano numa resposta não roda)
carregar() {
  local l
  while IFS= read -r l || [ -n "$l" ]; do
    l=${l%$'\r'}
    [[ $l =~ ^[A-Z0-9_]+= ]] && export "${l%%=*}=${l#*=}"
  done < .env
}
# perguntar VAR "pergunta" [página para abrir] [secreto] [regex válida] [dica se inválida]
# Só pergunta se VAR estiver vazia; repete até a resposta ser válida.
novo=""; abertas=""
perguntar() {
  novo=""
  [ -z "${!1:-}" ] || return 0
  novo=1
  echo
  case " $abertas " in *" ${3:-} "*) ;; *) [ -z "${3:-}" ] || { info "abrindo $3"; abrir "$3"; abertas="$abertas $3"; } ;; esac
  local v
  while true; do
    if [ -n "${4:-}" ]; then read -rsp "  $2: " v; echo; else read -rp "  $2: " v; fi
    # tira caracteres invisíveis (Ctrl+V no Git Bash) e espaços nas pontas; chave secreta não tem espaço
    v=$(printf '%s' "$v" | tr -d '[:cntrl:]' | sed 's/^ *//; s/ *$//')
    [ -z "${4:-}" ] || v=$(printf '%s' "$v" | tr -d '[:space:]')
    # número: aceita "+55 (66) 99999-9999" e deixa só os dígitos
    [ "${5:-}" != "$RE_NUMERO" ] || v=$(printf '%s' "$v" | tr -cd '0-9')
    if [ -z "$v" ]; then info "ficou vazio. Para colar no Git Bash use o botão direito do mouse (ou Shift+Insert)."; continue; fi
    if [ -n "${5:-}" ] && ! [[ $v =~ $5 ]]; then info "resposta inválida: ${6:-confira e digite de novo}"; continue; fi
    break
  done
  gravar "$1" "$v"; printf -v "$1" '%s' "$v"
}
RE_NUMERO='^55[0-9]{10,11}$'
RE_NUMEROS='^(55[0-9]{10,11})(,55[0-9]{10,11})*$'
RE_DOMINIO='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'

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
# apaga do .env linhas que não são CHAVE=valor (sobra de comando colado) e chaves repetidas (vale a última)
node -e "const fs=require('fs');const ls=fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>!l.trim()||/^#|^[A-Z0-9_]+=/.test(l));
  const ult={};ls.forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=/);if(m)ult[m[1]]=l});const feito=new Set();
  fs.writeFileSync('.env',ls.flatMap(l=>{const m=l.match(/^([A-Z0-9_]+)=/);if(!m)return[l];if(feito.has(m[1]))return[];feito.add(m[1]);return[ult[m[1]]]}).join('\n'))"
carregar
# respostas erradas de uma rodada anterior (ex.: um comando colado no lugar do número): pergunta de novo
[ -z "${MEU_NUMERO:-}" ] || [[ $MEU_NUMERO =~ $RE_NUMERO ]] || gravar MEU_NUMERO ""
[ -z "${NUMEROS_PERMITIDOS:-}" ] || [[ $NUMEROS_PERMITIDOS =~ $RE_NUMEROS ]] || { gravar NUMEROS_PERMITIDOS ""; gravar NUMEROS_PERMITIDOS_OK ""; }
for k in DOMINIO_N8N DOMINIO_EVO; do [ -z "${!k:-}" ] || [[ ${!k} =~ $RE_DOMINIO ]] || gravar "$k" ""; done
case "${MODO:-}" in ''|pc|vps) ;; *) gravar MODO "" ;; esac
for k in MEU_NUMERO NUMEROS_PERMITIDOS NUMEROS_PERMITIDOS_OK DOMINIO_N8N DOMINIO_EVO MODO; do unset "$k"; done
carregar
if [ -z "${MODO:-}" ]; then
  echo; read -rp "  Onde a IA vai rodar?  1 = neste PC   2 = VPS com Easypanel  [2]: " v
  case "$(printf '%s' "${v:-2}" | tr -d '[:cntrl:][:space:]')" in
    1) gravar MODO pc ;;
    *) gravar MODO vps
       # IDs de uma tentativa anterior neste PC não valem no n8n do VPS
       for k in N8N_API_KEY N8N_REDIS_CRED_ID N8N_GEMINI_CRED_ID N8N_CRM_CRED_ID; do gravar "$k" ""; done ;;
  esac
  carregar
fi
if [ "$MODO" = vps ]; then
  echo; info "Domínios do VPS: crie no seu DNS um registro A de cada um apontando para o IP do VPS."
  perguntar DOMINIO_N8N "Domínio do n8n (ex.: n8n.seudominio.com.br)" "" "" "^(https?://)?[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/?$" "só o endereço, ex.: n8n.oistudio.com.br"
  perguntar DOMINIO_EVO "Domínio da Evolution/WhatsApp (ex.: evo.seudominio.com.br)" "" "" "^(https?://)?[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/?$" "só o endereço, ex.: evo.oistudio.com.br"
  for k in DOMINIO_N8N DOMINIO_EVO; do
    v=$(printf '%s' "${!k}" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##'); gravar "$k" "$v"
  done
  carregar
  N8N=https://$DOMINIO_N8N; EVO_URL=https://$DOMINIO_EVO
else
  N8N=http://localhost:5678; EVO_URL=http://localhost:8080
fi
gravar N8N_URL "$N8N"

echo "2/7 O que só você sabe (pergunto uma vez e guardo no .env)"
perguntar MEU_NUMERO "Número do WhatsApp que vai ler o QR code (55+DDD+número, só dígitos)" "" "" "$RE_NUMERO" "só números, começando com 55. Ex.: 5566999999999"
# vazio = a IA responde qualquer número (NUMEROS_PERMITIDOS_OK marca que já foi perguntado)
if ! grep -q '^NUMEROS_PERMITIDOS_OK=1' .env; then
  echo
  while true; do
    read -rp "  Quem pode falar com a IA? Enter = TODOS, ou digite os números separados por vírgula: " v
    v=$(printf '%s' "$v" | tr -cd '0-9,' | sed 's/,,*/,/g; s/^,//; s/,$//')
    [ -z "$v" ] || [[ $v =~ $RE_NUMEROS ]] && break
    info "resposta inválida: aperte só Enter (todos) ou números com 55, separados por vírgula"
  done
  gravar NUMEROS_PERMITIDOS "$v"; gravar NUMEROS_PERMITIDOS_OK 1
fi
# a service_role "legacy" (JWT eyJ...): os workflows mandam a chave também em "Authorization: Bearer",
# e as chaves novas sb_secret_ não são aceitas aí
conferir_supabase() {
  local k=$1 papel codigo
  case "$k" in
    sb_secret_*|sb_publishable_*) echo "essa é a chave nova ($( [ "${k#sb_secret_}" != "$k" ] && echo secret || echo publishable )). Use a aba 'Legacy API Keys' → service_role (começa com eyJ)."; return 1 ;;
    eyJ*) ;;
    *) echo "não parece uma chave do Supabase (a service_role começa com eyJ e é bem longa)."; return 1 ;;
  esac
  papel=$(node -e "try{const p=JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64url'));console.log(p.role+'|'+p.ref)}catch{console.log('?|?')}" "$k")
  [ "${papel#*|}" = zgbzyzsqpkqvwkquofpn ] || { echo "essa chave é de outro projeto do Supabase."; return 1; }
  [ "${papel%|*}" = service_role ] || { echo "essa é a chave '${papel%|*}'. Copie a da linha service_role (clique em Reveal)."; return 1; }
  codigo=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$SUPABASE_URL/rest/v1/empresas?select=id&limit=1" -H "apikey: $k" -H "Authorization: Bearer $k")
  [ "$codigo" = 200 ] || { echo "o Supabase respondeu $codigo (sem internet, ou a chave foi trocada no painel)."; return 1; }
}
while true; do
  perguntar SUPABASE_SERVICE_KEY "Supabase: cole a service_role (aba Legacy API Keys → Reveal → Copy)" \
    "https://supabase.com/dashboard/project/zgbzyzsqpkqvwkquofpn/settings/api-keys" secreto
  [ -n "$novo" ] || break
  if motivo=$(conferir_supabase "$SUPABASE_SERVICE_KEY"); then ok "chave do Supabase conferida"; break; fi
  info "chave recusada: $motivo"; gravar SUPABASE_SERVICE_KEY ""; SUPABASE_SERVICE_KEY=""
done
while true; do
  perguntar GEMINI_API_KEY "Gemini: cole a API key (começa com AIza)" "https://aistudio.google.com/apikey" secreto
  [ -n "$novo" ] || break
  codigo=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY")
  if [ "$codigo" = 200 ]; then ok "chave do Gemini conferida"; break; fi
  info "o Google recusou essa chave (resposta $codigo). Copie de novo pelo botão de copiar do AI Studio."
  gravar GEMINI_API_KEY ""; GEMINI_API_KEY=""
done
ok "dados guardados no .env"
carregar

echo "3/7 Containers"
if [ "$MODO" = vps ]; then
  # O Easypanel não repassa a aba Ambiente para o compose (tudo chegava vazio). Então o compose vai
  # para o Easypanel já com os valores: Fonte → aba "docker-compose.yml" → colar.
  cmp=easypanel-compose.yml
  node -e "const fs=require('fs');const v=(k,pad)=>process.env[k]!==undefined&&process.env[k]!==''?process.env[k]:(pad||'');
    const s=fs.readFileSync('../../docker-compose.easypanel.yml','utf8').split('\n').map(l=>{
      const m=l.match(/^(\s*[A-Za-z0-9_]+:\s*)\\$\{([A-Z0-9_]+)(?::-([^}]*))?\}\s*$/);
      if(m)return m[1]+JSON.stringify(v(m[2],m[3]));
      return l.replace(/\\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g,(_,k,pad)=>v(k,pad));
    }).join('\n');
    if(/\\$\{/.test(s))throw new Error('sobrou variável sem valor');
    // sem comentários e sem acento: o clip do Windows estraga UTF-8 ao colar
    const limpo=s.split('\n').filter(l=>!/^\s*#/.test(l)).join('\n').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x00-\x7e]/g,'-');
    fs.writeFileSync(process.argv[1],limpo)" "$cmp"
  # n8n certo = já responde pelo domínio (um n8n subido sem as variáveis responde com localhost)
  n8n_certo() { curl -sf -m 10 "$N8N/rest/settings" | grep -q "https://$DOMINIO_N8N"; }
  if ! n8n_certo; then
    clip < "$cmp" 2>/dev/null && copiado=" (já está copiado: é só colar com Ctrl+V)" || copiado=""
    echo
    info "No Easypanel (Hostinger → Gerenciar painel), serviço 'ia' do projeto 'salao-vf'"
    info "  (se ainda não existe: + Serviço → Compose → nome 'ia'):"
    info "  1. Fonte → aba 'docker-compose.yml' (não a aba Git): apague o que tiver e cole"
    info "     o conteúdo de $cmp$copiado → Salvar."
    info "  2. Domínios (HTTPS ligado):"
    info "       $DOMINIO_N8N  → serviço n8n,       porta 5678"
    info "       $DOMINIO_EVO  → serviço evolution, porta 8080"
    info "  3. Implantar. No log deve aparecer 'database system is ready' e 'Editor is now accessible'."
    info "  O arquivo tem suas senhas: não mande print dele."
    abrir "$cmp"
    read -rp "  Aperte Enter depois do Deploy... " _
  fi
  info "esperando $N8N e $EVO_URL responderem..."
  for i in $(seq 1 100); do
    curl -sf -m 5 "$EVO_URL" >/dev/null && n8n_certo && break
    sleep 6
  done
  if ! n8n_certo; then
    curl -sf -m 5 "$N8N/rest/settings" >/dev/null \
      && erro "O n8n responde, mas sem o domínio: o compose colado não tem os valores. Rode de novo e cole o $cmp na aba 'docker-compose.yml'." \
      || erro "$N8N não respondeu. Confira no Easypanel os logs do serviço ia (n8n) e os domínios."
  fi
  curl -sf -m 5 "$EVO_URL" >/dev/null || erro "$EVO_URL não respondeu. Confira no Easypanel o domínio da Evolution."
  rm -f "$cmp" easypanel-environment.txt
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
carregar
node montar-workflow.js --enviar --ativar | grep -E 'erro|Criado|Atualizado' || true
# app do CRM e painel: mesma URL e anon key do Supabase
for app in ../../crm ../../painel-crm; do
  [ -d "$app" ] && [ ! -f "$app/.env.local" ] && \
    printf 'NEXT_PUBLIC_SUPABASE_URL=%s\nNEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$SUPABASE_URL" "$SUPABASE_ANON" > "$app/.env.local"
done
ok "workflows publicados e ativos"

echo "7/7 WhatsApp (o QR code é a única coisa que só você pode fazer)"

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
echo "✅ Tudo pronto. Teste: de outro celular mande 'oi' para $MEU_NUMERO."
echo "   ⚠️  Guarde uma cópia do arquivo .env fora deste computador (Drive, pendrive)."

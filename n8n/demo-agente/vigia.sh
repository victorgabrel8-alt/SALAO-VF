#!/usr/bin/env bash
# Vigia da demo: a cada 60 s confere Docker, containers e WhatsApp; se algo cair, tenta subir de novo.
# Uso (Git Bash, na pasta agente-whatsapp):  bash vigia.sh      (Ctrl+C para parar)
# Registro em vigia.log
cd "$(dirname "$0")"
LOG=vigia.log
log() { echo "[$(date '+%d/%m %H:%M:%S')] $*" | tee -a "$LOG"; }
set -a; . ./.env; set +a
desconectado=0
log "vigia iniciado"
while true; do
  if ! timeout 15 docker info >/dev/null 2>&1; then
    log "Docker fora do ar -> abrindo Docker Desktop"
    "/c/Program Files/Docker/Docker/Docker Desktop.exe" >/dev/null 2>&1 &
    for i in $(seq 1 60); do timeout 5 docker info >/dev/null 2>&1 && break; sleep 5; done
    if timeout 5 docker info >/dev/null 2>&1; then log "Docker voltou"; else log "Docker NAO voltou em 5 min"; sleep 60; continue; fi
  fi
  rodando=$(docker compose ps --status running --format '{{.Service}}' 2>/dev/null | wc -l)
  if [ "$rodando" -lt 4 ]; then
    log "só $rodando/4 containers rodando -> docker compose up -d"
    docker compose up -d >/dev/null 2>&1
    sleep 30
  fi
  estado=$(curl -s -m 10 "localhost:8080/instance/connectionState/$EVOLUTION_INSTANCE" -H "apikey: $EVOLUTION_API_KEY" | grep -oE '"state":"[a-z]+"' | cut -d'"' -f4)
  if [ "$estado" = "open" ]; then
    [ $desconectado -gt 0 ] && log "WhatsApp reconectado"
    desconectado=0
  else
    desconectado=$((desconectado + 1))
    log "WhatsApp estado='${estado:-sem resposta}' ($desconectado min)"
    if [ $desconectado -ge 3 ]; then
      log "WhatsApp fora há 3 min -> reiniciando Evolution"
      docker compose restart evolution >/dev/null 2>&1
      desconectado=0
      sleep 30
    fi
  fi
  sleep 60
done

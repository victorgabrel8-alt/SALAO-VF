# Prepara um computador Windows para continuar o projeto do salão (app + IA).
# Rode no PowerShell (não precisa ser administrador; o winget pode pedir permissão):
#   irm https://raw.githubusercontent.com/victorgabrel8-alt/SALAO-VF/ia-assistente-e-faltas/instalar-pc-novo.ps1 | iex
# ou, com o arquivo baixado:  powershell -ExecutionPolicy Bypass -File instalar-pc-novo.ps1
#
# O que faz: instala Git, Node.js (LTS) e o app do Claude; baixa o projeto em
# %USERPROFILE%\SALAO-VF (branch ia-assistente-e-faltas); instala as dependências do app;
# cria crm\.env.local a partir do exemplo para você preencher.
# NÃO instala o Docker nem sobe a IA (n8n + WhatsApp): isso é só para rodar a IA nesta máquina
# (ver PASSAGEM.md, "Rodar a IA em outra máquina").

$ErrorActionPreference = 'Stop'
$pasta = Join-Path $env:USERPROFILE 'SALAO-VF'
$branch = 'ia-assistente-e-faltas'

function Instalar($id, $nome) {
  if (winget list --id $id -e 2>$null | Select-String -SimpleMatch $id) { Write-Host "ok  $nome já instalado"; return }
  Write-Host "... instalando $nome"
  winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw 'O winget não existe neste Windows. Instale o "Instalador de Aplicativo" pela Microsoft Store e rode de novo.'
}
Instalar 'Git.Git' 'Git'
Instalar 'OpenJS.NodeJS.LTS' 'Node.js'
Instalar 'Anthropic.Claude' 'Claude (app)'

# o PATH novo (git, node) só vale em janela nova: recarrega nesta
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

if (Test-Path (Join-Path $pasta '.git')) {
  Write-Host "ok  projeto já baixado em $pasta (atualizando)"
  git -C $pasta fetch origin
  git -C $pasta checkout $branch
  git -C $pasta pull --ff-only
} else {
  Write-Host "... baixando o projeto em $pasta"
  git clone --branch $branch https://github.com/victorgabrel8-alt/SALAO-VF.git $pasta
}

Write-Host '... instalando as dependências do app (crm)'
Push-Location (Join-Path $pasta 'crm')
npm install
if (-not (Test-Path '.env.local')) {
  Copy-Item '.env.local.example' '.env.local'
  Write-Host ''
  Write-Host 'ATENÇÃO: preencha crm\.env.local com o endereço e a chave pública (anon) do Supabase'
  Write-Host '         (Supabase > Project Settings > API). Sem isso o app não abre.'
}
Pop-Location

Write-Host ''
Write-Host "Pronto. Projeto em $pasta"
Write-Host 'Para trabalhar: abra o app do Claude, aba Code, e escolha essa pasta.'
Write-Host 'Para ver o app:  cd SALAO-VF\crm ; npm run dev   (abre em http://localhost:3000)'
Write-Host 'Leia PASSAGEM.md: o que foi feito, o que falta e o que NÃO está no GitHub.'

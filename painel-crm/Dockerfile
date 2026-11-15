# Imagem do painel da agência para o Easypanel (App → GitHub → Build Path /painel-crm → Dockerfile).
# A URL e a anon key do Supabase não são segredos (vão no navegador) e entram no build.
# As chaves de serviço (SUPABASE_SERVICE_KEY, EVOLUTION_API_KEY etc., ver .env.local.example) NÃO entram
# na imagem: são lidas só quando o painel roda, da aba Ambiente do serviço no Easypanel.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL=https://zgbzyzsqpkqvwkquofpn.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnYnp5enNxcGtxdndrcXVvZnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MTEwMjQsImV4cCI6MjEwODA4NzAyNH0._w57590MAXqJjBFvFI774-CzyXj6PQhP0G9xJbFlcoE
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
# As rotas do servidor (tela Lojas) leem a URL e a anon key também quando o painel roda, não só no build
ARG NEXT_PUBLIC_SUPABASE_URL=https://zgbzyzsqpkqvwkquofpn.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnYnp5enNxcGtxdndrcXVvZnBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MTEwMjQsImV4cCI6MjEwODA4NzAyNH0._w57590MAXqJjBFvFI774-CzyXj6PQhP0G9xJbFlcoE
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app ./
USER node
EXPOSE 3000
CMD ["npx", "next", "start"]

# Imagem do app da dona para o Easypanel (App → GitHub → Build Path /crm → Dockerfile).
# A URL e a anon key do Supabase não são segredos (vão no navegador) e entram no build;
# para trocar, defina NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY no Easypanel.
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
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app ./
USER node
EXPOSE 3000
CMD ["npx", "next", "start"]

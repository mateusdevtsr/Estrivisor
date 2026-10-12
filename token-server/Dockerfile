FROM node:24-alpine
WORKDIR /app
# package-lock.json fixa as versões exatas das dependências; "npm ci" instala exatamente elas
# (e falha se o lock não bater com o package.json, em vez de baixar versões novas sem avisar).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.js ./
# Roda como o usuário "node" (sem poderes de administrador dentro do container).
# A pasta de dados (./dados no notebook) precisa pertencer a esse usuário (uid 1000).
USER node
EXPOSE 8080
# O Docker confere sozinho, a cada 30 s, se o servidor responde. Se travar, aparece "unhealthy".
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/saude || exit 1
CMD ["node", "server.js"]

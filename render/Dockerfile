# ssa-render: servicio de render del Disenador IA (Chromium sin pantalla).
#
# La version de la imagen tiene que ser IGUAL a la de `playwright` en
# package.json (hoy 1.65.0): la imagen trae los navegadores de esa version y
# Playwright no los descarga de nuevo. Al subir una, subir la otra.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# La imagen de Playwright trae este usuario sin privilegios.
USER pwuser

EXPOSE 8080
CMD ["node", "server.mjs"]

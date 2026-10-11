# Prompt para Claude Code — Bloque G: Integraciones

**Rama:** `feat/integraciones-dos-secciones` · **Migraciones:** ninguna · **Plano:** sección 7
**Previo:** Bloques N, I y S mergeados en `main`.

```bash
cd /Users/wendymardigian/Documents/SSA-business-ai-os
git checkout main && git pull
git worktree add ../ssa-integraciones -b feat/integraciones-dos-secciones
cd ../ssa-integraciones && npm install
```

Adjuntá **`CLAUDE.md`** y **`docs/requerimientos-ui-navegacion-observabilidad.md`**, y pegá esto:

---INICIO---

Vas a hacer un cambio sobre este proyecto, que ya tiene código construido y funcionando. Te adjunto el CLAUDE.md y el documento de requerimientos v2.0.

El trabajo de esta sesión es el **Bloque G: Integraciones** — sección 7, funcionalidades G1 a G10. Es el bloque con más superficie de los cinco.

Hacé las dos cosas de abajo y después parás a esperar mi aprobación. **No escribas código hasta que te diga que sí.**

## 1. Explorar

**Punto de partida.** `npx vitest run` y `npm run build`. Si algo viene en rojo, pará.

**Lo que se va a tocar:**

- `lib/integrations/providers.ts` — **listame los proveedores con su `id`, `section`, `type` y `connection`, textuales**, y decime cuántos son
- `lib/integrations/status.ts` — `integrationStatus()`, sus parámetros y sus cinco caminos
- `lib/integrations/usage.ts`, `usage-counts.ts`, `test-connection.ts`, `ai-key-check.ts`, `secret-validation.ts`
- `app/(dashboard)/dashboard/settings/integrations/page.tsx` — qué consulta y cómo arma las cards
- `components/settings/integrations/` — `integrations-grid.tsx`, `integration-card.tsx`, `integration-modal.tsx`, los tres `*-footer.tsx`
- `lib/oauth/` y `lib/social/{google,linkedin,threads/auth,google-calendar}.ts`
- La tabla `oauth_connections` (migración `00082`) — sus columnas
- `app/(dashboard)/dashboard/channels/` — `channels-view.tsx` y `callback/page.tsx`
- `lib/social/accounts-schema.ts` — `PUBLISHER_IDS`, `PUBLISHER_STATUSES`, `social_accounts.publishers` y `default_publisher`
- `components/content/editor/network-row.tsx` — el `<select>` de "Publicar por"
- `lib/jobs/handlers/metrics-sync.ts` — la función `readAccount()` y su `switch` por plataforma

**Confirmame cuatro cosas.** El documento se escribió leyendo este código, pero todo el plan depende de ellas:

a) **`integrationStatus()` se llama sin `connection` ni `requiredScopes`** desde la pantalla, así que los caminos de vencimiento de token y de scopes faltantes nunca se ejecutan. Y `oauth_connections` no se lee desde ninguna página ni componente, solo desde el cron de refresco.
b) **Zernio es una sola card**, no dos.
c) **Postproxy no es fuente de métricas de nada** — el `switch` de `readAccount()` no lo menciona.
d) **No hay ningún scope de Drive** en el repo, y `google_calendar` es una conexión aparte, por persona, configurada en Agenda.

Si alguna no es cierta, decímelo: el plan cambia.

**Impacto.** Si cambio `SECTION_ORDER` de seis valores a dos, ¿qué se rompe? ¿`providersBySection()` tiene tests? Si convierto el modal en una ruta `[providerId]`, ¿qué exige `lib/nav/page-actions.test.ts`? ¿Qué cubren `providers.test.ts` y `status.test.ts`?

## 2. El plan

- **G1** — `SECTION_ORDER` pasa a dos secciones: **Conexiones** e **Inteligencia artificial**. El agrupamiento fino lo recuperan **chips de tipo**, con el mapeo card → chips del documento. El chip activo viaja como `?tipo=`.
- **G2** — la card muestra todas las razones (no solo la primera) y la fecha de conexión. El botón navega al detalle en vez de abrir un modal.
- **G3** — **la mejora con mejor relación valor/esfuerzo del documento.** Se le pasa a `integrationStatus()` el `connection` de `oauth_connections` y los `requiredScopes` de los adaptadores que ya existen. **No se escribe lógica nueva: se enchufa la que ya está escrita y testeada.**
- **G4** — la card de Google lista sus servicios con estado propio: YouTube acá, Calendar con link a Agenda (es por persona, así que muestra cuántas personas lo tienen, no un sí/no). **Drive no se menciona: no existe.**
- **G5** — el modal pasa a la ruta `/dashboard/settings/integrations/[providerId]` con tres pestañas: Credenciales, Cuentas, Actividad. Hay que registrarla en `PAGE_META`.
- **G6** — WhatsApp: **no se construye gestión de instancias.** El modelo real es un número por workspace. La pestaña Cuentas muestra el canal con su estado y linkea a `/dashboard/channels` para el QR.
- **G7** — reemplaza al "selector de fuente de métricas", que no tiene sentido porque Postproxy no lee métricas. Se expone el **publicador por defecto de cada cuenta** (`social_accounts.default_publisher`), que hoy solo se elige post por post. Debajo, una línea informativa de dónde salen las métricas de esa red — incluido que LinkedIn no permite leerlas desde afuera.
- **G8** — franja de primera conexión mientras falte alguno de los tres mínimos (mensajería, IA de texto, email saliente), mostrando solo los que faltan.
- **G9** — Channels ya salió del menú en el Bloque N, pero **la pantalla se conserva entera**.
- **G10** — límites: no se agrega ningún proveedor (Whop no existe y entra con Ventas), no se cambia cómo se conecta nada, no se toca Vault, no se agregan scopes. Lo único que se borra es el código muerto de `MigrateToVault`.

El plan dice el orden, los archivos, y cómo verificás la no-regresión.

## Reglas

- **`integrationStatus()` no cambia de firma ni de lógica.** Sus tests tienen que pasar sin tocarlos. Si te parece que hay que modificarla, pará y avisame.
- **No se toca `testConnection`, `saveIntegration`, `disconnectIntegration` ni el flujo de OAuth.**
- **El umbral de vencimiento es uno solo**: `EXPIRY_WARNING_DAYS` de `status.ts`. Ninguna pantalla calcula días por su cuenta.
- Lo que haga falta guardar va al `config jsonb` de `integration_configs`. **Este bloque no escribe migraciones.** Si creés que hace falta una, pará y avisame.
- **`lib/vault-boundary.test.ts` es crítico acá**: el catálogo lo importa un Client Component, y si la cadena de imports llega a `lib/vault.ts` el secreto termina en el bundle del navegador. Corrélo después de cada archivo nuevo.
- Test de caracterización: **el conjunto de proveedores es el mismo antes y después.** Este bloque reagrupa; no agrega ni quita integraciones.

## Definición de listo

Las diez funcionalidades cumplen sus criterios; `npx vitest run` sale 0 incluyendo `vault-boundary` y los tests de `lib/integrations/`; `npm run build` compila; `node scripts/verify-rls.mjs` en verde; capturas a 1440 px y 390 px en `docs/shots/`.

---FIN---

---

## Cuando termine

**Probá** (sección 14, puntos 16 a 20): dos secciones, catorce cards, chips que filtran solo Conexiones · la card de Google muestra YouTube y Calendar por separado · **una conexión OAuth cercana a vencer aparece en `Requiere atención` diciendo cuántos días faltan** (si ninguna está por vencer, subí `EXPIRY_WARNING_DAYS` a 400 en una corrida de prueba y volvelo a 7) · entrás al detalle de Zernio y volvés, el chip sigue puesto · `/dashboard/channels` funciona entera.

**Commit:** `feat: integraciones en dos secciones, con chips, detalle en pantalla y salud de credencial`

**Mergeá a main.**

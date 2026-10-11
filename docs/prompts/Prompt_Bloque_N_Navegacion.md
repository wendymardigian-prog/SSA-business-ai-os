# Prompt para Claude Code — Bloque N: Menú lateral

**Rama:** `feat/nav-grupos` · **Migraciones:** ninguna · **Plano:** sección 4

```bash
cd /Users/wendymardigian/Documents/SSA-business-ai-os
git checkout main && git pull
git worktree add ../ssa-nav -b feat/nav-grupos
cd ../ssa-nav && npm install
```

Abrí Claude Code en `../ssa-nav`, adjuntá **`CLAUDE.md`** y **`docs/requerimientos-ui-navegacion-observabilidad.md`**, y pegá esto:

---INICIO---

Vas a hacer un cambio sobre este proyecto, que ya tiene código construido y funcionando. Te adjunto el CLAUDE.md y el documento de requerimientos v2.0.

El trabajo de esta sesión es el **Bloque N: Menú lateral** — sección 4 del documento, funcionalidades N1 a N5.

Hacé las dos cosas de abajo y después parás a esperar mi aprobación. **No escribas código hasta que te diga que sí.**

## 1. Explorar

**Punto de partida.** Corré `npx vitest run` y `npm run build` y decime cómo están HOY, antes de tocar nada. Si algo ya viene en rojo, pará ahí y avisame: no construimos encima de una base rota.

**Lo que se va a tocar.** Leé y contame cómo funciona hoy:

- `lib/nav/items.ts` — el array `NAV_ITEMS` y `visibleNavItems()`
- `lib/nav/items.test.ts` — qué aserciones fija
- `components/sidebar.tsx` — cómo renderiza, el mapa `ICONS`, el mecanismo de colapso, cómo marca el activo, el badge de borradores
- `app/(dashboard)/layout.tsx` — dónde vive el sidebar
- `lib/nav/page-actions.ts` — `PAGE_META` y `PAGES_WITHOUT_HEADER`
- `lib/auth/permissions.ts` — las claves de `PERMISSION_KEYS`
- `lib/auth/member-baseline.test.ts` — qué fija exactamente

**Impacto.** Quién más lee `NAV_ITEMS`, `visibleNavItems` o el mapa `ICONS`.

**Los tests estructurales.** La sección 2.6 del documento nombra cuatro tests que son la red del sistema. Para este bloque importan `items.test.ts`, `member-baseline.test.ts` y `page-actions.test.ts`. Decime, aserción por aserción, **cuáles se rompen con este cambio y cuál es la regla nueva que las reemplaza**. Esos tests no se borran ni se saltean: se reescribe la aserción.

## 2. El plan

Con eso a la vista, planificá N1 a N5:

- **N1** — `NavItemMeta` gana un campo de grupo; el menú pasa de lista plana a grupos con título. Dashboards y Bandeja sueltos arriba; Adquisición (Contenido, Social); Ventas (Contactos, Agenda); Automatización (Automatizaciones, Agentes, Conocimiento); Integraciones y Ajustes al fondo. Etiquetas al español. `Channels` sale del menú. `Integraciones` entra, con el ícono `Blocks`.
- **N2** — `Integraciones` es `adminOnly: true`; el resto conserva lo que tiene. **Ninguna clave nueva en `PERMISSION_KEYS`.**
- **N3** — colapsado: los títulos pasan a línea separadora, el tooltip dice `Contactos · Ventas`. El mecanismo de colapso (clase en el `<html>` + localStorage + script del `<head>`) **no se migra a estado de React**.
- **N4** — estado activo: Integraciones en `/dashboard/settings/integrations` y en `/dashboard/channels`; Ajustes en el resto de `/dashboard/settings`.
- **N5** — reescribir las aserciones que identificaste.

El plan tiene que decir el orden y por qué, qué archivos tocás, y cómo verificás que no rompiste nada. Si alguna zona que vas a mover no tiene test, escribí primero un test de caracterización que capture el comportamiento actual.

## Reglas

- **Las rutas no cambian.** Cambian etiquetas y agrupamiento, no URLs. Todo `href` tiene que seguir resolviendo.
- **`/dashboard/channels` se conserva entera**: sale del menú, pero la pantalla con el QR de WhatsApp, el alta de canales y la sincronización queda intacta.
- **No se agrega ninguna clave a `PERMISSION_KEYS`.** Si te parece que hace falta, pará y avisame.
- Ningún test se borra ni se salta.
- Commits por funcionalidad, con la convención del CLAUDE.md.

## Definición de listo

Las cinco funcionalidades cumplen sus criterios de la sección 4; `npx vitest run` sale 0 con las aserciones **reescritas, no borradas**; `npm run build` compila; y están las capturas a 1440 px y 390 px en `docs/shots/`.

Para las capturas usá tu navegador. Si la app pide login y no hay sesión, no ingreses credenciales: anotalo en `docs/PENDIENTE-N.md`.

---FIN---

---

## Cuando termine

**Probá** (sección 14, puntos 1 a 6): los grupos en orden · colapsar y recargar · `/dashboard/settings/integrations` marca Integraciones · `/dashboard/channels` marca Integraciones y la pantalla funciona · con un Member, seis ítems y ningún título de grupo vacío.

**Commit:** `feat: menu lateral en grupos, en espanol, con Integraciones`

**Mergeá a main** antes de abrir el worktree siguiente — el Bloque I cuelga de esto.

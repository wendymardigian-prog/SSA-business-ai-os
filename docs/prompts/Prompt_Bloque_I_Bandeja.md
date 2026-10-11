# Prompt para Claude Code — Bloque I: Bandeja

**Rama:** `feat/bandeja-barra` · **Migraciones:** ninguna · **Plano:** sección 5
**Previo:** Bloque N mergeado en `main`.

```bash
cd /Users/wendymardigian/Documents/SSA-business-ai-os
git checkout main && git pull
git worktree add ../ssa-bandeja -b feat/bandeja-barra
cd ../ssa-bandeja && npm install
```

Adjuntá **`CLAUDE.md`** y **`docs/requerimientos-ui-navegacion-observabilidad.md`**, y pegá esto:

---INICIO---

Vas a hacer un cambio sobre este proyecto, que ya tiene código construido y funcionando. Te adjunto el CLAUDE.md y el documento de requerimientos v2.0.

El trabajo de esta sesión es el **Bloque I: Bandeja** — sección 5, funcionalidades I1 a I7.

Hacé las dos cosas de abajo y después parás a esperar mi aprobación. **No escribas código hasta que te diga que sí.**

## 1. Explorar

**Punto de partida.** `npx vitest run` y `npm run build`. Decime cómo están hoy. Si algo viene en rojo, pará.

**Lo que se va a tocar:**

- `app/(dashboard)/dashboard/(comunicacion)/inbox/page.tsx` e `inbox-view.tsx` — qué le pasa al `PageHeader`
- `app/(dashboard)/dashboard/(comunicacion)/layout.tsx`
- `components/comunicacion/section-tabs.tsx` — `COMUNICACION_TABS` y los cuatro lugares donde se renderiza
- `components/inbox/inbox-filters.tsx` — el panel inline, el buscador, las pastillas de estado
- `components/inbox/conversation-list.tsx` — la cabecera, los badges, el Realtime
- `lib/inbox/filters.ts`, `lib/inbox/needs-human.ts` y sus tests
- `lib/url-params.ts`
- `components/page-header.tsx` — los props `left`, `right`, `filters` y el breakpoint `topbar:`
- `components/dashboards/chat/filters/filter-menu.tsx` — `FilterMenu` y sus helpers
- `components/content/view-switcher.tsx` — el patrón de segmented control del repo

**Impacto.** Quién importa `FilterMenu` hoy y qué imports hay que actualizar si lo muevo a `components/ui/`. Qué otras pantallas usan `SectionTabs`. Qué cubren `lib/inbox/filters.test.ts`, `needs-human.test.ts` y `scripts/verify-inbox-filters.mjs`.

**Confirmame tres cosas.** El documento dice que la lógica de filtros ya está hecha y que el trabajo es sobre todo mover cosas de lugar. Confirmá o desmentí:

a) `countActiveFilters()` ya existe en `lib/inbox/filters.ts` y ya alimenta el contador del botón.
b) Los parámetros de URL son exactamente `q`, `estado`, `canal`, `tag`, `asignado`, `fecha`, `desde`, `hasta`, `error-agente`, `necesita-humano`, `page`, `c`.
c) `FilterMenu` ya maneja teclado completo (flechas, Home, End, Esc con retorno de foco) y click-outside.

Si alguna no es cierta, decímelo: el plan cambia.

## 2. El plan

- **I1** — mover `filter-menu.tsx` a `components/ui/filter-menu.tsx` **sin cambiar su API**, y actualizar los imports del dashboard de Chat.
- **I2** — `SectionTabs` sube al prop `left` del `PageHeader` de las cuatro pantallas, y pasa de pastillas a segmented control. El título de `PAGE_META` para `/dashboard/inbox` pasa de `Inbox` a `Bandeja`.
- **I3** — el panel inline pasa a popover sobre `FilterMenu`, y el botón sube al prop `filters`. El contador sale de `countActiveFilters()`. Debajo de la barra, una línea de resumen de lo filtrado cuando hay al menos un filtro activo.
- **I4** — el buscador sube a la barra, con el placeholder adaptado por sección (los cuatro textos están en el documento).
- **I5** — el filtro es exclusivo de Conversaciones.
- **I6** — la columna conserva todo lo demás tal cual. **Las pastillas de estado quedan fuera del popover**, arriba de la lista.
- **I7** — nueva conversación saliente: **fuera de alcance**, se anota en `docs/PENDIENTE.md` con su razón.

El plan dice el orden, los archivos, y cómo verificás la no-regresión.

## Reglas

- **No se cambia la semántica de la búsqueda ni de los filtros.** La lógica de `lib/inbox/filters.ts` se consume, no se reescribe. Si te parece que hay que tocarla, pará y avisame.
- **Los parámetros de URL no se renombran.**
- **El Realtime de `conversation-list.tsx` no se toca.** Canal, debounce de 800 ms y merge en cliente quedan idénticos. Escribí un test de caracterización antes de mover nada de ese archivo.
- **390 px sin scroll horizontal de página.** Las pestañas scrollean internamente.
- `lib/vault-boundary.test.ts` en verde: si creás un componente cliente nuevo, revisá que su cadena de imports no arrastre `lib/vault.ts`.

## Definición de listo

Las siete funcionalidades cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; **el dashboard de Chat sigue funcionando igual** después de mover `FilterMenu`; capturas a 1440 px y 390 px en `docs/shots/`.

---FIN---

---

## Cuando termine

**Probá** (sección 14, puntos 7 a 11): las pestañas en la barra · tres filtros, `Esc`, el foco vuelve y el contador dice 3 · la URL con filtros abre con los filtros puestos · 390 px sin scroll de página · no hay filtro en Broadcasts, Sequences ni Growth · **el dashboard de Chat sigue andando** (es lo que se rompe sin que te des cuenta al mover `FilterMenu`).

**Commit:** `feat: bandeja con pestanas, buscador y filtros en la barra superior`

**Mergeá a main.**

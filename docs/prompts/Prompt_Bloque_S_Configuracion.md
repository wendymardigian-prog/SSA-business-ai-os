# Prompt para Claude Code — Bloque S: Configuración

**Rama:** `feat/ajustes-secciones` · **Migraciones:** ninguna · **Plano:** sección 6
**Previo:** Bloques N e I mergeados en `main`.

```bash
cd /Users/wendymardigian/Documents/SSA-business-ai-os
git checkout main && git pull
git worktree add ../ssa-ajustes -b feat/ajustes-secciones
cd ../ssa-ajustes && npm install
```

Adjuntá **`CLAUDE.md`** y **`docs/requerimientos-ui-navegacion-observabilidad.md`**, y pegá esto:

---INICIO---

Vas a hacer un cambio sobre este proyecto, que ya tiene código construido y funcionando. Te adjunto el CLAUDE.md y el documento de requerimientos v2.0.

El trabajo de esta sesión es el **Bloque S: Configuración** — sección 6, funcionalidades S1 a S7.

Hacé las dos cosas de abajo y después parás a esperar mi aprobación. **No escribas código hasta que te diga que sí.**

## 1. Explorar

**Punto de partida.** `npx vitest run` y `npm run build`. Si algo viene en rojo, pará.

**Lo que se va a tocar:**

- `app/(dashboard)/dashboard/settings/page.tsx` y `settings-view.tsx` — **enumerame las secciones que renderiza hoy, en orden, con su título textual**
- `components/settings/settings-tabs.tsx` — el array `TABS` y cómo marca la activa
- Las seis sub-rutas (`team`, `roles`, `custom-fields`, `background`, `templates`, `integrations`) — qué guard usa cada una y cuáles renderizan `SettingsTabs`
- `components/settings/team-view.tsx` y `components/settings/roles/roles-view.tsx` — cómo se llega de una a la otra, dónde está el botón de crear rol
- Los componentes sueltos de `components/settings/`: `timezone-settings`, `lead-scope-settings`, `message-persistence-settings`, `chat-media-settings`, `opt-out-settings`
- `components/scheduling/config-nav.tsx` y `config-shell.tsx` — el patrón de navegación interna que vamos a reusar
- `lib/actions/workspace.ts` → `updateWorkspaceSettings`, y `lib/actions/agents.ts` → `updateWorkspaceAiLimits`

**Las columnas de `workspaces`.** Decime cuáles de configuración existen y **cuáles no tienen interfaz en ninguna pantalla hoy** — me interesan `ai_daily_cost_limit_usd`, `ai_monthly_cost_limit_usd` y `agent_escalate_on_unreadable`.

**Impacto.** Si saco las cinco tarjetas-link duplicadas de la raíz, ¿hay algo que linkee a ellas desde otro lado? ¿`lib/auth/member-baseline.test.ts` se ve afectado? (El documento dice que no, porque no se agregan páginas con `requireWorkspaceAdmin` — confirmalo.) ¿Qué tests cubren hoy estas pantallas?

## 2. El plan

- **S1** — las pestañas pasan de 4 a 6, sumando `Campos personalizados` y `Respuestas rápidas`, que hoy tienen ruta pero quedaron fuera del sistema de navegación. Se mantiene el subrayado y las sub-rutas: **no se migra a `?tab=`**.
- **S2** — General se parte en cinco secciones con navegación interna (Workspace, Conversaciones, Archivos, IA, Zona de peligro), reusando el patrón de `config-nav.tsx`. **Se eliminan las cinco tarjetas-link duplicadas.** La sección IA expone los dos topes de gasto y el escalado, que hoy no tienen interfaz acá.
- **S3** — un segmented control `Miembros | Roles` dentro de la pestaña. Era el motivo real de que no se encontrara dónde se crean los roles: una ruta propia cuya única puerta era una tarjeta enterrada. El botón `Nuevo rol` se queda donde está, en el `right` del `PageHeader`.
- **S4** — español parejo. La tabla de traducciones está en el documento, y también va `channels/callback`, que está entera en inglés.
- **S5** — estados vacíos en las seis pestañas, con los textos del documento.
- **S6** — los permisos **no cambian**. Test de caracterización por rol.
- **S7** — link a Corridas en la sección IA, gateado por `ai_costs.view` (la clave ya existe). Hasta que exista la pantalla, apunta a `/dashboard/agents`.

El plan dice el orden, los archivos, y cómo verificás la no-regresión.

## Reglas

- **Cada ajuste conserva su forma de guardado actual.** El botón de abajo sigue guardando nombre y palabras clave; los demás siguen guardando solos. **No se unifica el guardado en este bloque.**
- Los topes de gasto se guardan con `updateWorkspaceAiLimits`, que ya existe. No escribas una nueva.
- **No cambia ningún permiso.** Si te parece que hay que cambiar un guard, pará y avisame.
- Los nombres técnicos (modelos, claves de permiso, códigos de error) no se traducen.
- `lib/vault-boundary.test.ts` en verde.

## Definición de listo

Las siete funcionalidades cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; el test de caracterización de permisos da lo mismo antes y después; no queda texto visible en inglés en Configuración ni en Canales; capturas a 1440 px y 390 px en `docs/shots/`.

---FIN---

---

## Cuando termine

**Probá** (sección 14, puntos 12 a 15): cinco secciones con navegación interna y ninguna tarjeta-link duplicada · las seis pestañas, con `custom-fields` y `templates` renderizándolas · el segmented lleva de Miembros a Roles y el botón `Nuevo rol` sigue en la barra · buscá "Save Changes" o "Workspace Name" en pantalla y no aparecen · **con un Member, ve exactamente lo que veía antes**.

**Commit:** `feat: configuracion en secciones, seis pestanas y espanol parejo`

**Mergeá a main.**

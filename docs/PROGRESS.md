# Progreso — Fase 3, Bloques 2e y 3

Corrida autónoma en la rama `oneshot-fase3-2e-3`. Plano: `docs/requerimientos-fase3-bloques-2e-3.md` (v1.1).

## Punto de partida (26/9/2026, `main` @ `4c3d24a`)

| Comando | Resultado de hoy |
|---|---|
| `npx vitest run` | 90 archivos, **1059 tests en verde** |
| `npm run build` | OK (exit 0) |
| `npm run lint` | 0 errores, **45 warnings preexistentes** (directivas `eslint-disable` sin uso) |
| `node scripts/verify-rls.mjs` | Todo verde, limpieza OK |

Base: última migración aplicada `00073_tag_effects`. La `00072` **no está aplicada** (diferida). 1580 salientes (0 con autor), 837 entrantes, 593 conversaciones, 0 runs, 0 borradores. Agente apagado, Instagram en `draft`. Sin `workspaces.timezone`, sin `messages.origin`.

## Bloques

- [x] **Bloque 0 — Arranque:** rama, copia del plano, PROGRESS/PENDIENTE
- [x] **Bloque 1 — Base común** — 00074/00075/00076 aplicadas
  - [x] F1 · Diagnóstico de autoría (`docs/diagnostico-autoria.md`) — conclusión (a): 1580 salientes por historial
  - [x] F2 · Columna `messages.origin` (builder único + 11 caminos + backfill + `message.sent`) — 1580 external, 838 inbound null
  - [x] F3 · Zona horaria del workspace (`workspaces.timezone`, selector en Settings)
  - [x] F4 · `already_answered` + fuentes del clasificador + `normalize_for_grouping` (paridad SQL/TS en 20 casos)
- [x] **Bloque 2 — Verificación y reglas de respuesta** — 00077 aplicada, agente sigue apagado
  - [x] F5 · Verificación antes de responder (momentos 1/2 + refresco Zernio, `lib/agent/refresh.ts`, `reply-check.ts`)
  - [x] F6 · Borrador respondido por otro medio (refresco en `approveDraft` + trigger momento 3 + cron `drafts-refresh` + aviso en la cola)
  - [x] F7 · Espera tras respuesta externa (`external_reply_cooldown_minutes`, campo en config)
  - [x] F8 · Evaluador de reglas (`lib/agent/rules/`: fields, evaluate, schema, template, known-buttons)
  - [x] F9 · Integración de reglas en el turno (modo `rules`, evaluación previa/final, `routing`)
  - [x] F10 · Editor de reglas + plantilla + modo del canal (`rules-editor.tsx`, acciones de servidor, unreachable)
  - [x] F11 · Simulación (`simulate.ts` + loader best-effort desde borradores)
  - [x] F12 · Visibilidad (oración de decisión en Runs, etiqueta de regla en la cola, salud del refresco + notificación)
- [ ] **Bloque 3 — Navegación y dashboard de Chat**
  - [ ] F13 · Navegación global (barra 56 px)
  - [ ] F14 · Filtros y período
  - [ ] F15 · Funciones de métricas + `verify-dashboards.mjs`
  - [ ] F16 · Pantalla: números, tendencias, contexto
  - [ ] F17 · Sección del agente y aprobación de borradores
  - [ ] F18 · Tabla "Quién responde"
- [ ] **Bloque 4 — Patrones de mensajes**
  - [ ] F19 · Textos y categorías
  - [ ] F20 · Clasificador
  - [ ] F21 · Corrección desde el dashboard
  - [ ] F22 · Sección Patrones
- [ ] **Bloque 5 — Tareas en segundo plano, calidad e intención**
  - [ ] F23 · Configuración de tareas en segundo plano
  - [ ] F24 · Jobs de despacho y recolección
  - [ ] F25 · Calidad, revisión rápida, set de control y versiones
  - [ ] F26 · Intención declarada por el agente y reglas por intención

## Migraciones creadas

| # | Qué crea | Aplicada |
|---|---|---|
| 00074 | `messages.origin` + CHECK + backfill + trigger `messages_fill_origin` + índice | ✅ |
| 00075 | `workspaces.timezone` (default America/Costa_Rica) | ✅ |
| 00076 | `agent_runs.status` +`already_answered`; `source` +clasificador; `normalize_for_grouping()` | ✅ |
| 00077 | `agents.response_rules`/`response_rules_default`/`external_reply_cooldown_minutes`; `agent_runs.routing`; RPC `claim_agent_reply`; trigger momento 3; cron `ssa-cron-drafts-refresh` | ✅ |

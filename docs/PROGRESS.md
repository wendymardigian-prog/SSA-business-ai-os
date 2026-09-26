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
- [x] **Bloque 3 — Navegación y dashboard de Chat** — 00078 aplicada
  - [x] F13 · Navegación: Dashboards primero, redirect 308 de `/dashboard/analytics`, `PageHeader` 56 px + tooltip (rollout global a otras páginas en PENDIENTE)
  - [x] F14 · Filtros y período (11 atajos, estado en URL) — tests puros
  - [x] F15 · Funciones de métricas SQL + `verify-dashboards.mjs` en verde (valores a mano, caso Member)
  - [x] F16 · Números con comparación + tendencias (1 serie; 4 pestañas en PENDIENTE)
  - [x] F17 · Sección del agente (3 %, tres estados) — se oculta al filtrar por persona
  - [x] F18 · Tabla "Quién responde" (umbrales de color, filtro por clic, scope por rol)
- [x] **Bloque 4 — Patrones de mensajes** — 00079 aplicada
  - [x] F19 · `message_categories`/`message_texts`, `messages.text_norm`, trigger, categorías fallback, siembra de 12 botones, backfill (533 textos) — verify-dashboards cubre variantes/emoji
  - [x] F20 · Clasificador (`lib/patterns/classifier.ts`): selección de pendientes, ≤3 categorías nuevas, no toca human/rule, JSON inválido — tests con modelo mockeado
  - [x] F21 · Correcciones (`lib/patterns/corrections.ts` + Server Actions): mover, nueva categoría, renombrar, unir; "Otro" protegida — tests
  - [x] F22 · Sección Patrones en el dashboard (`chat_dashboard_patterns`, variantes con confianza ámbar <70%) — "qué le responden" (§11.7) en PENDIENTE
- [x] **Bloque 5 — Tareas en segundo plano, calidad e intención** — 00080 aplicada
  - [x] F23 · `workspaces.ai_background_settings` + Settings → Tareas en segundo plano (defaults §13.1, indexación no apagable) — módulo testeado + página
  - [x] F24 · Ventanas de despacho (`dueWindow`, `planDispatch`, dedupe idempotente) + rutas cron `bg-dispatch`/`bg-collect` + interfaz `BatchProvider`; ejecución del lote/recolección en PENDIENTE
  - [x] F25 · Fórmulas de calidad (`lib/patterns/quality.ts`: precisión, corregidos, sin categoría por volumen, dudosos, calibración) — testeadas; UI de revisión/versiones en PENDIENTE
  - [x] F26 · `agent_runs.intent` + herramienta `declarar_intencion` (opt-in) + captura en el runner + `validateIntent` + condición en el evaluador + graduación (`graduation.ts`) — testeados

## Migraciones creadas

| # | Qué crea | Aplicada |
|---|---|---|
| 00074 | `messages.origin` + CHECK + backfill + trigger `messages_fill_origin` + índice | ✅ |
| 00075 | `workspaces.timezone` (default America/Costa_Rica) | ✅ |
| 00076 | `agent_runs.status` +`already_answered`; `source` +clasificador; `normalize_for_grouping()` | ✅ |
| 00077 | `agents.response_rules`/`response_rules_default`/`external_reply_cooldown_minutes`; `agent_runs.routing`; RPC `claim_agent_reply`; trigger momento 3; cron `ssa-cron-drafts-refresh` | ✅ |
| 00078 | Funciones SQL del dashboard: `chat_episodes`, `chat_dashboard_numbers/agent/team/trends`, `chat_waiting_now`, `chat_author_match` | ✅ |
| 00079 | Patrones: `message_categories`, `message_texts`, `messages.text_norm`, triggers (upsert texto, seed de categorías por workspace), `chat_dashboard_patterns` | ✅ |
| 00080 | `workspaces.ai_background_settings`; `agent_runs.intent`; crons `ssa-cron-bg-dispatch`/`ssa-cron-bg-collect` | ✅ |

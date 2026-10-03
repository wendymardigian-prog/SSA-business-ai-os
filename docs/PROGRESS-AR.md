# Bloques A + R — Observabilidad de IA (A1-A6, R1-R4)

**Rama:** `feat/observabilidad-ia` (worktree aparte, `.claude/worktrees/observabilidad-ia`,
desde `main`). **Migraciones:** una sola, `00112_ai_spend_by_day.sql`, y solo agrega
funciones.

## Punto de partida

`main` estaba sano: `npx vitest run` → 371 archivos, 4469 tests, 0 en rojo.
`npm run build` compila. Último commit de `main` al arrancar: Bloques N, I, S y
G ya mergeados.

## Las cinco confirmaciones del documento (§2.1 y §2.7)

Verificadas contra la base real con el MCP de Supabase, no solo leyendo las
migraciones:

- **a) Cierta.** `agent_runs`, `agent_run_steps`, `model_pricing` existen;
  `cost_usd numeric(12,6)`, se congela en `close()` (`lib/ai/run.ts`).
- **b) Cierta, con un matiz.** Diez de los once valores del CHECK se
  escriben. `message_classification_eval` no lo escribe nadie (anotado en
  R5.3).
- **c) Cierta.** Verificado en `information_schema.column_privileges`: 23
  columnas con GRANT para `authenticated`, 7 sin GRANT (`input_tokens`,
  `output_tokens`, `cached_tokens`, `embedding_tokens`, `cost_usd`,
  `pricing_id`, `audio_seconds`).
- **d) Cierta.** Ninguna función agrupaba `cost_usd` por fecha.
- **e) Cierta.** `messages.agent_run_id` desde la `00059`.

El acordeón de `runs-tab.tsx` mostraba más que la pantalla `runs/[runId]`
(enrutamiento, prompt version, `describeModelError`, tokens/costo, nombre de
contacto y canal, títulos de fragmentos de KB, `input` de los pasos, links).
Resuelto con el componente compartido `RunDetail` (R4).

## Decisiones tomadas con Wendy (etapa B)

1. **Tope de gasto diario.** En vez de apagar el agente (como el mensual),
   un tope diario corta el turno hasta la medianoche local y lo deja
   encendido: al día siguiente la suma vuelve a cero.
2. **Clic en el gráfico de barras.** `TrendChart` gana un prop opcional
   `hrefFor`, aditivo: sin pasarlo, el gráfico queda idéntico a hoy.
3. **Parámetro de período.** `?range=&from=&to=`, el mismo vocabulario que
   ya usa el dashboard de Chat, en vez de `?period=`.

## Hallazgos que el documento no tenía

1. **`workspace-budget.ts` cortaba el día a medianoche UTC**, seis horas
   antes que la de Costa Rica, y dejaba pasar todo si no podía leer el
   workspace (*fail-open*). Unificado con `spend.ts` vía
   `workspaceSpendCandidates()`: la misma ventana, *fail-closed*.
2. **`SpendChartTabs` conservaba la dispersión del período viejo** al
   cambiar de período: React preserva el `useState` de un componente
   cliente entre renders del servidor en el mismo lugar del árbol. Un
   `key={rango}` lo resuelve. Encontrado probando en el navegador, no por
   un test.
3. **`FilterMenu align="right"` mandaba el popover de Filtros fuera de
   pantalla**: el botón de Corridas queda cerca del borde izquierdo, y el
   default alinea el menú por su borde derecho. `align="left"` lo arregla.
4. **Pasar una función de un Server Component a un Client Component rompe
   en runtime, no en build ni en `tsc`.** `runs/[runId]/page.tsx` le pasaba
   `agentHref={(id) => ...}` a `RunDetail` ("use client"). `RunDetail` arma
   el link por su cuenta ahora, sin recibir una función.
5. **`loadWorkspaceAgents` ya traía `responseRules`** de cada agente: no
   hizo falta una consulta aparte para las opciones de "Regla" cuando
   Corridas filtra por un agente específico.
6. **`AI_RUNS_HREF` (S7) apuntaba a `/dashboard/agents`** a propósito,
   "hasta que exista Corridas". Ya existe: se actualizó, con su test.

## Qué se hizo

| Commit | Qué cambia |
|---|---|
| `feat: 00112` | `ai_spend_by_day` y `ai_runs_scatter`: serie densa por día y origen, dispersión muestreada conservando errores/escaladas. Solo `service_role`. Verificadas contra datos reales (69 corridas) y contra `verify-rls.mjs`. |
| `fix: AGENT_RUN_PUBLIC_COLUMNS` | Suma `inbound_at`, `responded_at`, `intent` (tenían GRANT, no se pedían). Test que la cruza contra los GRANT reales de las migraciones. |
| `fix: tope diario` | `workspaceSpendCandidates()` compartido entre `spend.ts` y `workspace-budget.ts`; un corte diario pausa, no apaga. |
| `docs:` | Los tres huecos de R5 (transcripción sin corrida si falla, modo Económico sin medir, `message_classification_eval` sin escribir) más dos observaciones propias, en `docs/PENDIENTE.md`. |
| `feat: paleta por origen` | `RUN_SOURCE_LABELS` completo (11 valores, antes 5), con test contra el CHECK. Ocho colores categóricos validados con el script de la guía de dataviz; los tres de sistema caen en "Otros" (gris de `--c-ext`), no un noveno color. `TrendChart.hrefFor`, aditivo. |
| `feat: módulos puros del dashboard` | `url-state.ts`, `spend-chart.ts`, `source-palette.ts`, `log-scale.ts`, `scatter-points.ts`, `kpis.ts`, `system-status.ts`. Todo testeado, cero llamadas a Supabase. |
| `feat: cargador de datos` | `loadAiDashboardData` (3 llamadas: informe del período, del anterior, serie por día) y `loadAiScatter` (la cuarta, aparte). Reusa `fetchCostReport` de `costs-query.ts` en vez de reescribirlo. |
| `feat: mini dashboard en Agentes` | `PageHeader` suma `PeriodPopover`, gateado por `ai_costs.view`. `AiDashboardSection` en su propio `<Suspense>`. Cinco tarjetas, gráfico de dos pestañas, estado del sistema (consume `integrationStatus()` de G), plegable por `localStorage`. |
| `fix: dispersión con key` | Ver hallazgo 2. |
| `test: caracterización de loadRuns` | Fija la forma exacta de hoy (Member sin costo, Admin con costo) antes de generalizar. |
| `refactor: generalizar loadRuns` | `dateRange` ya resuelto en vez de `DatePreset` interno (D6); `currentAgentId: string \| null`; filtro `origen`; `getRunDetail`/`findAdjacentRun` reusan el mapeo de `loadRuns`. Runs deja de ser pestaña del agente: redirect de `?tab=runs` a la pantalla global. `runs-tab.tsx` se borra. |
| `feat: atajos` | Los cinco de R2, con `needsCost` para los dos que leen costo. |
| `feat: pantalla de Corridas` | Ruta `/dashboard/agents/runs`, abierta a cualquier Member. `loadRunsScreenInputs` compartido entre la pantalla y el export a CSV. Tabla de doce columnas con `RunDetail` inline. Popover único de filtros sobre `FilterMenu`. |
| `fix: popover fuera de pantalla` | Ver hallazgo 3. |
| `fix: función servidor→cliente` | Ver hallazgo 4. |

## Verificación

- `npx vitest run`: **373 archivos, 4486 tests, 0 en rojo.**
- `npm run build`: compila sin errores.
- `node scripts/verify-rls.mjs`: todo verde, incluidas las 7 pruebas nuevas
  de `ai_spend_by_day`/`ai_runs_scatter`.
- `node scripts/verify-roles.mjs`: todo verde (sin cambios de este bloque,
  corrido igual por tocar permisos).
- `node scripts/verify-dashboards.mjs`: todo verde (tocado un link del
  dashboard de Chat).
- Navegador: dashboard de Agentes (las dos pestañas del gráfico, período,
  plegado, estado del sistema), Corridas (filtros, los cinco atajos, tabla
  de doce columnas, detalle inline, export a CSV con datos reales), la
  corrida sola con anterior/siguiente — en 1440 px, 390 px y modo oscuro.
  Capturas en `docs/shots/` (`1440-` y `390-` con prefijo `agentes-dashboard-`
  y `corridas-`).

## Checklist de seguridad (CLAUDE.md)

- [x] RLS habilitada en todo lo tocado (no se crea tabla; las dos funciones
      nuevas son `SECURITY DEFINER` solo para `service_role`)
- [x] Ninguna Server Action ni ruta nueva sin su guard (`ai_costs.view` o
      RLS del cliente del usuario)
- [x] Ninguna consulta de costo o tokens fuera de service role +
      `ai_costs.view` (ni para armar el CSV)
- [x] No se agregó ningún GRANT de columna
- [x] `lib/auth/member-baseline.test.ts` actualizado, no reescrito a mano
- [x] `verify-rls.mjs` y `verify-roles.mjs` en verde

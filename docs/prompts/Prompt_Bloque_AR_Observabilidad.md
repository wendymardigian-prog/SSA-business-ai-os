# Prompt para Claude Code — Bloques A + R: Observabilidad de IA

**Rama:** `feat/observabilidad-ia` · **Migración:** `00112` · **Plano:** secciones 8 y 9
**Previo:** Bloques N, I, S y G mergeados en `main`. Backup del día de la base.

> Es un solo prompt, igual que los demás, pero **tiene una parada tuya adentro**: construye la parte de datos, para y te muestra, y recién cuando le decís que sí arranca las pantallas. Es el único bloque con migración, y el único donde un error no explota: registra mal y no te enterás hasta que confiás en un número que está mal.

```bash
cd /Users/wendymardigian/Documents/SSA-business-ai-os
git checkout main && git pull
git worktree add ../ssa-observa -b feat/observabilidad-ia
cd ../ssa-observa && npm install
```

Adjuntá **`CLAUDE.md`** y **`docs/requerimientos-ui-navegacion-observabilidad.md`**, y pegá esto:

---INICIO---

Vas a hacer un cambio sobre este proyecto, que ya tiene código construido y funcionando. Te adjunto el CLAUDE.md y el documento de requerimientos v2.0.

El trabajo de esta sesión son los **Bloques A y R: Observabilidad de IA** — secciones 8 y 9.

**Lo más importante antes de empezar:** la observabilidad de IA **ya está construida del lado de los datos**. No vas a crear tablas ni a instrumentar llamadas. Vas a construir las dos pantallas que faltan sobre el sistema que ya existe. La sección 2.1 del documento lo explica.

Esta sesión tiene tres momentos: explorar, construir los datos, y construir las pantallas. **Entre el segundo y el tercero parás y esperás mi aprobación.**

## 1. Explorar

**Punto de partida.** `npx vitest run` y `npm run build`. Si algo viene en rojo, pará.

**El modelo de datos existente:**

- `supabase/migrations/00059_agent_runs.sql` — las columnas de `agent_runs`, `agent_run_steps` y `model_pricing`
- `00060_agents_rls.sql` — las policies y, sobre todo, **los privilegios de columna (los GRANT)**
- `00064_ai_spend_sum.sql`, `00069_ai_cost_report.sql` y `00071_draft_metrics.sql` — las firmas de `sum_ai_spend` y `ai_cost_report`, y qué devuelve el jsonb
- `00103` — qué le cambió a `agent_runs`
- Los valores vigentes de los CHECK de `agent_runs.source`, `.status`, `.trigger` y `agent_run_steps.kind`
- `supabase/seeds/00_model_pricing.sql` y `01_transcription_pricing.sql`

Si tengo el MCP de Supabase conectado, revisá también el esquema real contra las migraciones.

**El código existente:**

- `lib/ai/run.ts` — `openAiRun`, el handle, `recordRunOutcome`, `closeStaleRuns`
- `lib/ai/pricing.ts`, `spend.ts`, `workspace-budget.ts`
- `lib/agent/public.ts` — `AGENT_RUN_PUBLIC_COLUMNS` y `AGENT_RUN_COST_COLUMNS`
- `lib/agent/runs-query.ts`, `runs-filters.ts`, `costs-query.ts`, `run-labels.ts`, `routing-sentence.ts`
- `components/agents/runs-tab.tsx`, `costs-tab.tsx`, `filters.tsx`
- `app/(dashboard)/dashboard/agents/page.tsx` y `runs/[runId]/page.tsx`
- `components/dashboards/chat/trend-chart.tsx`, `kpi-cards.tsx`, `filters/period-popover.tsx`
- `lib/dashboards/period.ts` y `lib/dates.ts` — los **dos** vocabularios de período

**Confirmame cinco cosas.** El plan entero depende de ellas:

a) **Existen `agent_runs`, `agent_run_steps` y `model_pricing`**, el costo se guarda en `cost_usd numeric(12,6)` y se congela al cerrar la corrida.
b) **`lib/ai/run.ts` es la puerta única** y hay once fuentes instrumentadas. Hacé el grep de `openAiRun` y `recordRunOutcome` y listame los call sites con su `source`.
c) **Un usuario autenticado, incluido un Owner, NO puede leer `cost_usd` ni los tokens** de `agent_runs`, por los privilegios de columna de la `00060`. Listame qué columnas tienen GRANT y cuáles no.
d) **No existe ninguna función que agrupe `cost_usd` por fecha.** Buscá en todas las migraciones.
e) **`messages.agent_run_id` ya existe** desde la `00059`.

**Compará las dos vistas de detalle.** `components/agents/runs-tab.tsx` (el acordeón) contra `app/(dashboard)/dashboard/agents/runs/[runId]/page.tsx` (la pantalla). Decime cuál muestra más y qué le falta a la otra.

## 2. El plan y la etapa A — los datos

Planificá los dos bloques completos, pero **construí solo la parte de datos**, que es la sección 8.A1.

**Migración `00112_ai_spend_by_day.sql`**, con dos funciones y nada más:

1. `ai_spend_by_day(p_workspace_id uuid, p_from timestamptz, p_to timestamptz, p_tz text) RETURNS jsonb` — agrupa por día y por `source`, excluyendo `status = 'running'`. **Rellena con cero los días sin corridas** usando `generate_series`: un día que falta en vez de valer cero hace que el gráfico mienta la forma (es el mismo problema que resolvió la `00110`).
2. `ai_runs_scatter(p_workspace_id uuid, p_from timestamptz, p_to timestamptz, p_limit int DEFAULT 500) RETURNS jsonb` — devuelve filas, no agregados. Cuando hay más de `p_limit`, **conserva todas las corridas con estado de error o escalada** y muestrea las que salieron bien. Una dispersión que esconde los errores no sirve para nada.

Las dos: `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`, `GRANT EXECUTE` solo a `service_role`, igual que sus hermanas. Idempotentes.

**Más dos consistencias** que la pantalla va a exponer (sección 9.R6):

3. `lib/ai/spend.ts` y `lib/ai/workspace-budget.ts` responden distinto a "llegué al tope": uno evalúa el tope diario con `notify` y el otro con `disable`. **Unificar en `disable`**, que es lo que ya hace el camino que efectivamente corta. Test que compara los dos módulos.
4. `AGENT_RUN_PUBLIC_COLUMNS` omite `inbound_at`, `responded_at` e `intent`, que **sí tienen GRANT**. Agregarlos, con un test que verifique que esa constante no incluye ninguna columna sin GRANT.

**Y anotá los tres huecos de cobertura** de la sección 9.R5 en `docs/PENDIENTE.md`, con archivo y línea. No los arregles: solo anotalos.

**Aplicá la `00112` y enseguida verificala**: llamá a las dos funciones con un rango real y mostrame el resultado, incluido un rango con días sin corridas. Después corré `node scripts/verify-rls.mjs`. **Si la verificación falla, PARÁ**, anotá en `docs/PENDIENTE.md` qué falló y cómo volver atrás, y no sigas.

### Reglas de esta etapa

- **La migración NO altera ninguna tabla.** Solo agrega funciones. Si te parece que hace falta un `ALTER`, pará y avisame: el alcance cambió.
- **No se crean tablas nuevas de observabilidad.**
- **No se toca `lib/ai/run.ts`**, ni se agregan valores al CHECK de `source`, ni se instrumenta nada nuevo.
- **No se agrega ningún GRANT** sobre las columnas de costo. El muro de privilegios es la defensa principal.
- **Nada toca `messages`, `conversations`, `contacts` ni `chat_media`.**
- Numeración: la última aplicada es la `00111`. La banda `00104`-`00109` quedó libre pero **no se usa**: seguí desde `00112`. Después de escribirla, `node scripts/build-all-migrations.mjs`; antes de aplicarla, `list_migrations`.

### ⏸ Acá parás

Mostrame: la migración entera · el resultado de las dos funciones contra datos reales, con un rango que incluya días vacíos · el resultado de `verify-rls.mjs` · los tres huecos que anotaste.

**No arranques las pantallas hasta que yo te diga que sí.**

## 3. La etapa B — las pantallas (solo con mi aprobación)

**Bloque A, el mini dashboard arriba de la lista de Agentes:**

- **A2** — período con `PeriodPopover` (los 11 presets) en el prop `filters` del `PageHeader`. Params `?period=`, `?from=`, `?to=`. Default `30d`. Zona del workspace, no del navegador.
- **A3** — cinco tarjetas con el patrón de `KpiCards`: gasto de hoy (compara contra **ayer**), gasto del período, tokens, corridas, estado del sistema. Aviso cuando hay corridas sin precio.
- **A4** — un gráfico con dos pestañas. **Barras:** `TrendChart` con `mode="stack"`, una barra por día segmentada por origen. **Puntos:** la dispersión, costo contra tiempo, verde/rojo por estado. Hay que **completar `RUN_SOURCE_LABELS`**, que hoy tiene 5 de los 11 valores, y declarar una paleta por origen en los dos temas.
- **A5** — estado del sistema con tres señales: errores en 24 h, integraciones en atención, corridas sin precio. **Consume el estado ya resuelto por `integrationStatus()`** (que el Bloque G dejó enchufado): no calcula días de vencimiento por su cuenta. **No hay señal de latido del worker**: no existe esa fuente y no se inventa.
- **A6** — plegable (a `localStorage`), esqueleto de carga, estado vacío, y **solo para quien tiene `ai_costs.view`**.

**Bloque R, la pantalla de Corridas:**

- **R1** — ruta nueva `/dashboard/agents/runs`, registrada en `PAGE_META`. Hay que **generalizar `parseRunFilters` y `loadRuns`**, que hoy exigen un `agentId`. La pestaña Runs del agente pasa a ser esa vista con `?agente={id}`.
- **R2** — los once filtros que ya existen, más el de origen, en un popover sobre el `FilterMenu` que el Bloque I dejó en `components/ui/`. Cinco atajos: solo errores, escaladas, sin precio, más lentas de 30 s, más caras.
- **R3** — la tabla con sus doce columnas (tokens y costo **solo con `ai_costs.view`**) y export a CSV que respeta el permiso.
- **R4** — el detalle se extrae a **un componente compartido** que usan la lista y la pantalla. Hoy el acordeón muestra más que la pantalla: gana el más completo. La query de pasos tiene que pedir `input` y `audit_log_id`, que hoy no pide.

### Reglas de esta etapa

- **Todo lo que muestre costo o tokens es server-side con service role detrás de un guard.** Sin `ai_costs.view`, esas columnas **no se consultan** — no se ocultan en el cliente, no se piden.
- **No se modifica `TrendChart`, ni `KpiCards`, ni `PeriodPopover`, ni `integrationStatus()`.** Se consumen. Si hiciera falta un cambio, pará y avisame.
- **No se agrega ninguna librería de gráficos.** La dispersión se escribe en SVG a mano siguiendo la convención del repo: `viewBox` fijo, `<title>` como tooltip, escalas con `niceStep` y `axisTicks`.
- **El gráfico arma sus segmentos desde los datos, no desde la lista de valores del CHECK** (hay un valor que nadie escribe y aparecería siempre vacío).
- **Cuando `cost_usd` es NULL y hay tokens, se dice `sin precio`, nunca `$0,00`.** Son cosas distintas y confundirlas hace que el total mienta.
- **Cuando el visor no es admin, la pantalla avisa** que ve solo las corridas de sus conversaciones. Por la RLS, las corridas sin `conversation_id` no las ve un Member, y un subconjunto sin aviso es peor que un subconjunto.
- Antes de generalizar `loadRuns`, escribí un **test de caracterización** que fije lo que devuelve hoy con un `agentId`.

## Definición de listo

Las funcionalidades de las secciones 8 y 9 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `node scripts/verify-rls.mjs` y `node scripts/verify-roles.mjs` en verde; capturas a 1440 px y 390 px en `docs/shots/`, incluidas las dos pestañas del gráfico.

---FIN---

---

## Cuando termine

**Probá** (sección 14, puntos 21 a 31). Lo que no hay que saltearse:

- Un día sin corridas aparece como cero, no se saltea.
- En la pestaña de puntos, los errores se ven en rojo y **no quedaron fuera del muestreo**.
- Clic en un segmento de barra: abre Corridas filtrado por ese día y ese origen.
- **Con un usuario sin `ai_costs.view`:** no hay columnas de costo, y en la pestaña de red del navegador **no viaja ningún `cost_usd`**.
- **Con un usuario Member:** la pantalla avisa que ve solo las corridas de sus conversaciones.
- Exportá el CSV con y sin permiso: las columnas cambian.

**Commit:** `feat: mini dashboard de IA y pantalla de Corridas para auditoria`

**Mergeá a main** y poné el tag: `git tag -a v2.1.0 -m "Navegacion, bandeja, configuracion, integraciones y observabilidad"`

Y actualizá el link de S7, que hasta ahora apuntaba a `/dashboard/agents`, para que apunte a `/dashboard/agents/runs`.

# Progreso · Módulo Llamadas (Fathom + analizador IA)

Rama `feat/llamadas`. Plano: [requerimientos-llamadas.md](requerimientos-llamadas.md).
Pendientes y decisiones: [PENDIENTE-llamadas.md](PENDIENTE-llamadas.md).

## Punto de partida (10/10/2026, `main` en `ce12347`)

| Chequeo | Resultado |
|---|---|
| `npx vitest run` | 472 archivos, 6.045 tests, todo en verde |
| `npm run build` | compila (exit 0) |
| `npm run lint` | 0 errores, 36 avisos (techo: no puede haber errores nuevos) |
| `verify-rls.mjs` | verde **con `--despues-de-00143`** (sin el flag falla una línea esperada de antes de la 00143: la 00143 ya está aplicada) |
| `verify-roles.mjs` | verde |
| `verify-dashboards.mjs` | verde |
| `verify-content.mjs` | verde |
| `verify-scheduling.mjs` | verde |
| `verify-knowledge.mjs` | **FALLA ya en el punto de partida** (1 caso, "un documento eliminado desaparece de la busqueda"). Ver PENDIENTE-llamadas |
| Huella `md5(pg_get_functiondef('private.call_app_cron'))` | `c90fa613fca0660903111c36f6fb6973` (debe ser igual al final) |
| Huella `md5(pg_get_expr(polqual))` de `audit_log_select` | `5b4ffabd6da14a30309c552801302836` (debe ser igual al final) |
| SPSP | md5 `bc2313d1…` y `51b40ca6…` verificados |

## Migraciones (renumeradas: el plano partía de la 00143, que ya está ocupada)

| Número real | Número del plano | Qué hace | Estado |
|---|---|---|---|
| 00144 | 00143 | `audit_log.actor_type`, `actor_label`, índice | **aplicada y registrada** (actor_type sin nulos) |
| 00145 | 00144 | `calls`, `can_see_call`, CHECK provider, sync, closer, candado de refresh | **aplicada y registrada** (`verify-calls`, `verify-rls`, `verify-roles` en verde) |
| 00146 | 00145 | `private.enqueue_fathom_sync()` + cron `fathom-sync` | **aplicada y registrada** (`call_app_cron` con la misma huella `c90fa613…`; `verify-calls` en verde) |
| 00147 | 00146 | política `audit_log_select_calls` | **aplicada y registrada** (`audit_log_select` con la misma huella `5b4ffabd…`; `verify-audit-visibility` igual antes y después) |
| 00148 | 00147 | CHECK `agent_runs.source` / `ai_task_prompt_versions.task`, `set_ai_background_task_settings` | **aplicada y registrada** (`verify-calls` ampliado en verde) |
| 00149 | 00148 | CHECK `triggers.type` / `content_ideas.source`, `content_ideas.call_id` | **aplicada y registrada** (los dos CHECK con los valores nuevos y los de antes; `verify-calls` ampliado en verde) |

Próxima libre al cerrar: **00150**.

## Bloque L1 · Conexión, ingesta y vinculación — **cerrado** (migraciones 00144–00147 aplicadas)
- [x] F1 Historial transversal
- [x] F2 Permisos de Llamadas
- [x] F3 Tabla `calls` y cambios en tablas existentes
- [x] F4 Marca "es closer" y correos alternos
- [x] F5 App OAuth de Fathom en Integraciones
- [x] F6 Conectar mi Fathom
- [x] F7 Token vigente (refresh de un solo uso)
- [x] F8 Ingesta paginada cada 10 minutos
- [x] F9 Vinculación automática con contacto y agenda
- [x] F10 Sincronizar ahora
- [x] F11 Importar una transcripción a mano
- [x] F12 Lista de llamadas
- [x] F13 Ficha de la llamada y vincular a mano
- [x] F14 Métricas de conversación

## Bloque L2 · Clasificación y análisis — **cerrado** (migración 00148 aplicada; SPSP v10 cargado como versión 1)
- [x] F15 CHECKs de IA y escritura de la configuración de una tarea
- [x] F16 Tres tareas de IA en el catálogo (+ SPSP v1)
- [x] F17 Clasificación por reglas
- [x] F18 Clasificación con IA y "por revisar"
- [x] F19 Configuración de las tareas
- [x] F20 El análisis (salida estructurada)
- [x] F21 Puntajes por código, citas verificadas, dos copias
- [x] F22 Automático o a mano, con el tope del workspace
- [x] F23 Corregir a mano
- [x] F24 Corregir con IA
- [x] F25 Regenerar con motivo
- [x] F26 Probar el borrador
- [x] F27 Propuestas de categoría
- [x] F28 El closer puede objetar

## Bloque L3 · Uso de lo analizado — **cerrado** (migración 00149 aplicada)
- [x] F29 Resumen, próximos pasos e ideas de contenido
- [x] F30 Memoria del contacto
- [x] F31 Transcripción a la base de conocimiento
- [x] F32 Triggers de llamadas
- [x] F33 Dashboard Llamadas
- [x] F34 Llamadas en la ficha del contacto y de la agenda

## Cierre
- [x] docs/llamadas.md, flow-registry.md, CLAUDE.md, .env.example (sin variables nuevas, dicho), BITACORA.md
- [x] Definición de listo (todos los verify, vitest, build, lint)
- [x] PR abierto (sin mergear)

## Bloque L2 — lo que se verificó al cerrarlo
- `npx vitest run` 529 archivos, 6.705 tests en verde · `npm run build` compila · `npm run lint` 0 errores y 36 avisos (los mismos del punto de partida).
- `verify-calls` (ampliado: claim concurrente del análisis, objeciones, `set_ai_background_task_settings`, los CHECK nuevos), `verify-rls --despues-de-00143`, `verify-roles --despues-de-00136` y `verify-audit-visibility --despues-de-00147` en verde, de a uno.
- **SPSP cargado** en el workspace de Wendy: `ai_task_prompt_versions` (`call_analysis`, versión 1, 13.543 caracteres) activa en `ai_task_prompt_active`; rúbrica con `version: 1` (closer 8 criterios = 100, lead 7 = 100) y 29 categorías aceptadas en `ai_background_settings.call_analysis`. El análisis automático **queda apagado** (`mode: off`): el primer gasto lo decide una persona. La carga dejó una fila de historial ("Carga inicial del SPSP"). Ni el prompt ni la rúbrica se commitean (`claude/` está en `.gitignore`).
- Revisión visual: configuración de Clasificación y de Análisis (con el SPSP cargado), ficha con las herramientas de cada sección, editor de una sección (guardó, recalculó el puntaje y dejó auditoría sin tocar `analysis_ai`), cambio de tipo de una llamada por revisar. Se hizo con la sesión ya abierta y 4 llamadas de prueba (`zz-prueba visual L2…`) **borradas** al terminar. Ver el límite en PENDIENTE-llamadas.

## Definición de listo — corrida final (11/10/2026)
- `npx vitest run`: 547 archivos, **6.865 tests**, todo en verde (el punto de partida era 472 archivos y 6.045 tests: ningún test que pasaba se rompió).
- `npm run build`: compila (exit 0). `npm run lint`: **0 errores y 36 avisos** (los mismos del punto de partida).
- De a uno, todos con exit 0: `verify-rls --despues-de-00143`, `verify-roles --despues-de-00136`, `verify-calls`, `verify-audit-visibility --despues-de-00147`, `verify-dashboards`, `verify-content`, `verify-knowledge` y `verify-scheduling`. `verify-knowledge` fallaba desde el punto de partida: se corrigió su caso (ver BITACORA).
- Huellas iguales a las del punto de partida: `private.call_app_cron` `c90fa613…` y `audit_log_select` `5b4ffabd…`.
- Migraciones 00144 a 00149 aplicadas y registradas en el historial de Supabase; `ALL_MIGRATIONS.sql` regenerado (146 migraciones). Próxima libre: **00150**.
- El SPSP está cargado como versión 1 de `call_analysis` con su rúbrica (closer 8 criterios = 100, lead 7 = 100, 29 categorías), con el análisis automático **apagado**. No está en el repo.
- Limpieza: no quedan datos de prueba (`zz-…`) en `calls`, `contacts`, `content_ideas`, usuarios ni workspaces.

## Bloque L3 — lo que se verificó al cerrarlo
- Ver la sección "Definición de listo" más abajo: la corrida completa de `vitest`, `build`, `lint` y todos los `verify-*` se hizo una sola vez al final, de a uno.
- `verify-calls` cubre lo de L3 contra la base real: los dos CHECK nuevos, una idea con `source = 'call'` que sobrevive al borrado de su llamada, que el documento interno de una llamada **no** sale en la búsqueda del agente (`p_include_internal = false`) y la visibilidad de las llamadas desde la ficha del contacto.
- Revisión visual: dashboard (con 4 llamadas de prueba, la del domingo 23:30 en Costa Rica cae en la semana del domingo), sección "Llamadas" de la ficha del contacto y tarjeta "Resumen y próximos pasos" de la ficha de la llamada. Todo con datos de prueba (`zz-prueba … L3`) **borrados** al terminar. El detalle de la agenda no se revisó a ojo (necesita una agenda real vinculada): lo cubren los tests de la lógica y de la carga.

## Bloque L1 — lo que se verificó al cerrarlo
- `npx vitest run` 6.402 tests en verde · `npm run build` compila · `npm run lint` 0 errores y 36 avisos (los mismos del punto de partida).
- `verify-rls`, `verify-roles`, `verify-calls`, `verify-audit-visibility` (con `--despues-de-00147`) y `verify-scheduling` en verde, de a uno.
- `private.call_app_cron` con la misma huella (`c90fa613…`); `audit_log_select` con la misma huella (`5b4ffabd…`); `lib/cron-config.test.ts` sin tocar.
- Revisión visual (1440 y 390 px, oscuro y claro): lista, ficha, Mi Fathom, tarjeta de Fathom en Integraciones y control de closer en Equipo. Se hizo con la sesión ya abierta del navegador, con 4 llamadas de prueba (`zz-prueba visual…`) que se insertaron para mirar y **se borraron** al terminar.

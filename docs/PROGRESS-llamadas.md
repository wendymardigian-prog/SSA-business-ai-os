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
| 00146 | 00145 | `private.enqueue_fathom_sync()` + cron `fathom-sync` | pendiente |
| 00147 | 00146 | política `audit_log_select_calls` | pendiente |
| 00148 | 00147 | CHECK `agent_runs.source` / `ai_task_prompt_versions.task`, `set_ai_background_task_settings` | pendiente |
| 00149 | 00148 | CHECK `triggers.type` / `content_ideas.source`, `content_ideas.call_id` | pendiente |

Próxima libre al cerrar: **00150**.

## Bloque L1 · Conexión, ingesta y vinculación
- [ ] F1 Historial transversal
- [ ] F2 Permisos de Llamadas
- [ ] F3 Tabla `calls` y cambios en tablas existentes
- [ ] F4 Marca "es closer" y correos alternos
- [ ] F5 App OAuth de Fathom en Integraciones
- [ ] F6 Conectar mi Fathom
- [ ] F7 Token vigente (refresh de un solo uso)
- [ ] F8 Ingesta paginada cada 10 minutos
- [ ] F9 Vinculación automática con contacto y agenda
- [ ] F10 Sincronizar ahora
- [ ] F11 Importar una transcripción a mano
- [ ] F12 Lista de llamadas
- [ ] F13 Ficha de la llamada y vincular a mano
- [ ] F14 Métricas de conversación

## Bloque L2 · Clasificación y análisis
- [ ] F15 CHECKs de IA y escritura de la configuración de una tarea
- [ ] F16 Tres tareas de IA en el catálogo (+ SPSP v1)
- [ ] F17 Clasificación por reglas
- [ ] F18 Clasificación con IA y "por revisar"
- [ ] F19 Configuración de las tareas
- [ ] F20 El análisis (salida estructurada)
- [ ] F21 Puntajes por código, citas verificadas, dos copias
- [ ] F22 Automático o a mano, con el tope del workspace
- [ ] F23 Corregir a mano
- [ ] F24 Corregir con IA
- [ ] F25 Regenerar con motivo
- [ ] F26 Probar el borrador
- [ ] F27 Propuestas de categoría
- [ ] F28 El closer puede objetar

## Bloque L3 · Uso de lo analizado
- [ ] F29 Resumen, próximos pasos e ideas de contenido
- [ ] F30 Memoria del contacto
- [ ] F31 Transcripción a la base de conocimiento
- [ ] F32 Triggers de llamadas
- [ ] F33 Dashboard Llamadas
- [ ] F34 Llamadas en la ficha del contacto y de la agenda

## Cierre
- [ ] docs/llamadas.md, flow-registry.md, CLAUDE.md, .env.example, BITACORA.md
- [ ] Definición de listo (todos los verify, vitest, build, lint)
- [ ] PR abierto (sin mergear)

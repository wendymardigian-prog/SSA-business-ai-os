# Progreso — Extra A: Sistema de Tareas (T1–T4)

Rama: `feat/tareas` (desde `origin/main` 68bbf6a). Plano: [requerimientos-tareas.md](requerimientos-tareas.md). Pendientes: [PENDIENTE-tareas.md](PENDIENTE-tareas.md).

## Estado

- [ ] **T1 — Base y reglas**: [ ] F1 tabla/RLS · [ ] F2 permisos · [ ] F3 fechas (pura) · [ ] F4 completar con corrimientos · [ ] F5 dependencias · [ ] F6 limpieza · [ ] F7 auditoría · [ ] F8 acciones/zod · [ ] F9 proyectos
- [ ] **T2 — Tabla, celda y drawer**: [ ] F10 tabla · [ ] F11 edición en celda · [ ] F12 drawer · [ ] F13 diálogo de fechas · [ ] F14 filtros/URL · [ ] F15 creación rápida y menú
- [ ] **T3 — Tablero, avisos y superficies**: [ ] F16 kanban · [ ] F17 notificaciones · [ ] F18 cron de vencimientos · [ ] F19 Mis tareas · [ ] F20 contacto y bandeja · [ ] F21 mobile
- [ ] **T4 — Origen automático**: [ ] F22 nodo create_task · [ ] F23 tool crear_tarea · [ ] F24 tarea al escalar · [ ] F25 triggers task_* (también sin contacto) · [ ] F26 origen visible y robustez
- [ ] Cierre: docs/tareas.md · flow-registry.md · CLAUDE.md · PR

## Migraciones (plano → número real)

| Plano | Real | Estado |
|---|---|---|
| 00196 | 00196_tasks | pendiente |
| 00197 | 00197_tasks_functions | pendiente |
| 00198 | 00198_tasks_due_cron | pendiente |
| 00199 | 00199_task_trigger_types | pendiente |

## Punto de partida (13/10/2026, sobre origin/main)

- `npx vitest run`: 779 archivos, 9.770 tests, 0 fallas.
- `npx eslint .`: 0 errores, 36 warnings (no pueden aumentar).
- `next build`: compila.
- `scripts/verify-*.mjs`: sin correr todavía (escriben datos `zz-test-` en la base real); se corren de a uno al arrancar la ejecución y se anota acá.
- Base: última migración `00195_ads_crm_metrics`; `00196` libre.

---

# Plan aprobado (tal cual)


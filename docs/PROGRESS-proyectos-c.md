# Corrida C · Extensión de proyectos (bloque PY del panel + P7 del portal)

**Para retomar:** esta página. Requerimientos: `claude/v12/requerimientos-v12-servicios.md` (bloque PY, §8.2 tablas 15 a 17) y
`../portal/docs/requerimientos-v12-portal.md` (P7, F232–F242). Todo lleva `@plantilla-quitar(proyectos)` y el código vive en `lib/projects/`.
La extensión está **apagada** hasta que la plataforma prenda `workspaces.portal_settings.extensions.projects`.

## Etapas

| Etapa | Qué | Estado |
|---|---|---|
| C1 | SX1 (00395): esquema, tablas, Sala de la fama, buckets, revisor, secciones con la extensión | **Aplicada** (17/11) |
| C2 | Panel: Proyectos y facturación (Sala de la fama, Pagos reportados, Proyectos, Mesa de trabajo, Ideas), ficha › Proyectos e ingresos, KPI | Pendiente |
| C3 | Funciones del portal: proyectos, pasos y versiones, armado del prompt, pagos y comprobantes | Pendiente |
| C4 | Pantallas del portal (P7) desde el prototipo | Pendiente |
| C5 | Análisis con IA (revisor), mismo cupo de créditos que el tutor | Pendiente (falta `investigacion-proyectos-metodo-builder.md` v2) |

## Migraciones

| Mig. | Qué | Ensayo y estado |
|---|---|---|
| 00395 | SX1: esquema `app_servicio_proyectos` (cerrado), `project_ideas`, `student_projects`, `student_revenue_entries` (CHECK + CO010/CO011/CO012), `project_problems`, vista `student_revenue_totals`, `fame_plan`/`fame_ranking`, buckets `student-projects` y `student-revenue`, `agent_runs.source` + `portal_project_review`, `projects_ensure_reviewer`, `fame`/`projects` solo con la extensión (validadores y `portal_section_enabled`), `merge_contacts_hook` | Ensayo corrido por Leonardo en el SQL Editor (17/11): los 30 casos compartidos coinciden con TypeScript; apagada: fama vacía, secciones «no disponible», revisor SV005; prendida: secciones aceptadas, revisor uno solo y guardado; práctica con monto, ganado sin fecha, reto sin servicio, pago cero y ajuste sin motivo rechazados por CHECK; CO010 (pago a práctica, real→práctica con pagos), CO011 (fase inexistente), CO012 (proyecto o servicio ajeno); fama con lo verificado; totales 150.000/100.000/50.000 con 1 sin comprobante; esquema cerrado y buckets privados. **Aplicada y registrada** por Leonardo el 17/11/2026 (versión `20261117150024`) |

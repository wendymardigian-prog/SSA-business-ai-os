# Tareas

El sistema de tareas del equipo: una tarea tiene responsable, seguidores, proyecto, fechas y
dependencias. Se ve como tabla o como tablero, se edita en la celda o en un drawer, avisa en la
campana, se puede crear desde la ficha de un contacto, desde una conversación, desde un flujo de
automatización y desde el agente de IA, y completar una tarea puede disparar otro flujo.

Plano en `docs/requerimientos-tareas.md` (v1.0). Plan, avance y decisiones en
`docs/PROGRESS-tareas.md`; lo que quedó afuera, en `docs/PENDIENTE-tareas.md`.

## Una sola tabla: `tasks`

Migraciones **00196** a **00199**, todas idempotentes y con su "Como volver atras":

| Migración | Qué hace |
|---|---|
| `00196_tasks` | La tabla, índices, RLS, `can_see_task` / `can_see_task_id`, privilegios por columna y el trigger que limpia a quien sale del workspace |
| `00197_tasks_functions` | `complete_task_with_shifts`, `set_task_blockers`, `delete_task` y la política ADICIONAL `audit_log_select_tasks` |
| `00198_tasks_due_cron` | El cron horario `tasks-due-enqueue` (SQL directo, patrón de la 00167) |
| `00199_task_trigger_types` | Los disparadores `task_completed` / `task_overdue` y los eventos sin contacto |

- **Proyecto = texto.** `project` guarda lo que escribió la persona y `project_key` su forma
  normalizada (minúsculas, sin acentos, espacios colapsados): "Lanzamiento Q4" y "lanzamiento q4"
  son el mismo proyecto. No hay tabla de proyectos.
- **Dependencias** en `blocked_by` (jsonb): cada bloqueante con los días de distancia (`gap_days`)
  que había entre los dos vencimientos al vincularlos. Sin ciclos, máximo 10.
- **Seguidores** en `follower_ids uuid[]` (máximo 20).
- **Origen** (`source`): `manual`, `flow`, `agent` o `cx`; `source_ref` es la referencia de
  idempotencia (una tarea abierta por origen y referencia, con un único parcial).
- **Borrado lógico**: `deleted_at`. No hay DELETE directo: se borra con `delete_task`.

## Quién ve y quién puede

Tres claves en `lib/auth/permissions.ts` (el catálogo es la fuente): `tasks.view`, `tasks.edit` y
`tasks.delete`, con alcance `own` o `all` (módulo `tasks`). El Member de sistema tiene `view` y
`edit` con alcance `own`.

`can_see_task` = miembro del workspace Y (Owner/Admin, o la creó, o es el responsable, o la
sigue, o tiene `tasks.view` con alcance `all`). Devuelve **siempre** true o false, nunca NULL (un
NULL deja pasar un `NOT (...)` en plpgsql).

`has_permission()` es siempre falso para el Member de sistema (sus claves viven solo en
TypeScript), por eso las policies de escritura usan el patrón de la 00150
(`role_id IS NULL OR system_role = 'member' OR ...`).

El cliente no puede escribir `workspace_id`, `source`, `source_ref`, `blocked_by`, `deleted_at` ni
`created_by` al actualizar (privilegios por columna). `blocked_by` solo cambia por
`set_task_blockers`.

## La regla de fechas

Completar una tarea que **bloquea** a otras puede atrasar las fechas de las que dependen de ella:

- Solo **atrasa**, nunca adelanta. Si el bloqueante se completa hoy y la dependiente vencía antes
  de `hoy + gap_days`, pasa a `hoy + gap_days`; y eso se propaga a las que dependen de ésa, en
  orden topológico.
- **El cálculo es una función pura** (`lib/tasks/date-rules.ts`, `computeDateShifts`). La RPC
  `complete_task_with_shifts` **no recalcula**: valida (solo atrasa, solo tareas abiertas del
  workspace, `updated_at` esperado) y aplica todo en una transacción. Si algo cambió entre la vista
  previa y la confirmación, devuelve `stale` y la pantalla vuelve a armar el plan.
- La persona **ve la vista previa** antes de confirmar («Moviste la fecha de 2 tareas») y puede
  «completar sin mover fechas».
- El plan se arma **solo con las tareas que la persona ve** (la RLS decide): una dependiente que no
  ve no se mueve ni se le muestra el título.

## Las pantallas

- **`/dashboard/tareas`** (`tasks.view`): tabla (`@tanstack/react-table`, la única dependencia
  nueva) y tablero, con "Mis tareas", filtros y estado de la vista **en la URL**
  (`lib/tasks/view-state.ts`, ida y vuelta exacta).
- **Edición en la celda** (estado, prioridad, responsable, seguidores, proyecto, fechas): optimista,
  con vuelta atrás y mensaje claro si falla (`lib/tasks/cell-edit.ts`). Completar siempre pasa por
  la vista previa de fechas cuando mueve algo.
- **Drawer** propio (`?task=<id>`), con campos que guardan solos (blur, Enter o al cerrar; Esc
  vuelve al valor guardado), dependencias, contacto/conversación vinculados e historial.
- **Tablero** (`lib/tasks/kanban-model.ts`): HTML5 nativo, menú "Mover a…" para teclado y celular.
  Arrastrar a «Completada» pasa por la misma vista previa.
- **Celular** (<768 px): lista de tarjetas en vez de tabla (`lib/tasks/layout.ts`).
- **Ficha del contacto**: sección «Tareas» (tras «Seguimiento»).
- **Bandeja**: botón «Crear tarea» en el encabezado de la conversación, con título sugerido.
- La lógica de pantalla vive en `lib/tasks/*`; los componentes (`components/tasks/*`) solo la
  componen. Las acciones (`lib/actions/tasks.ts`) son delgadas: el núcleo testeable es
  `lib/tasks/core.ts`, que recibe los clientes de base.

## Avisos en la campana

Siete tipos (`lib/notifications/types.ts`): te asignaron, seguís una tarea, cambió, quedó libre,
se movió la fecha, vence hoy y está vencida. Reglas (`lib/tasks/notifications.ts`):

- `recipient_id` **siempre concreto** y **nunca quien hizo el cambio**.
- `task_changed` no se repite: `createNotificationOnce` (10 minutos, por persona).
- Quien no puede ver la tarea igual ve el aviso que le **dirigieron** (`can_see_notification`:
  `recipient_id = yo`; esa función no se tocó).
- El envío **nunca lanza**: una tarea no falla porque no se pudo avisar.

**Vencimientos.** Cada hora, `private.enqueue_tasks_due_sweep()` deja **un job `tasks_due_sweep` por
workspace y día local**, y solo si hay tareas candidatas y ya son las 08:00 locales. El handler
(`lib/jobs/handlers/tasks-due-sweep.ts`) avisa **una vez por tarea y fecha de vencimiento** (compara
`metadata.due_date`), así que es idempotente aunque el job corra dos veces. Si no hay responsable ni
seguidores, no hay a quién avisar y no se encola.

## Crear tareas desde un flujo, el agente o una derivación

Todo pasa por `createTaskFromAutomation` (`lib/tasks/create-from-automation.ts`), que **captura
sus errores** y los registra con `[tareas]`: nada de esto frena lo que lo origina.

- **Nodo «Crear tarea»** (`create_task`, `needsContact: false`): título, descripción y proyecto con
  variables; responsable fijo, «quien envió el reporte» o nadie; vencimiento fijo o «+N días»
  (hoy en la zona del workspace). Origen `flow`, `source_ref = flow:sesión:nodo`: la misma ejecución
  no crea dos tareas abiertas. Si la persona elegida ya no es del equipo, queda sin responsable y
  se avisa a Owner/Admin. Detalle en [flow-registry.md](flow-registry.md).
- **Herramienta del agente `crear_tarea`** (`lib/agent/tools/create-task.ts`): responsable = la
  persona asignada a la conversación, si no el setter, si no el vendedor, si no nadie (y entonces
  avisa a Owner/Admin). Tope de tareas abiertas por conversación y detección de duplicado. Auditoría
  con el agente como actor. **No toca `programar_seguimiento` ni `contacts.next_followup_date`**: el
  seguimiento es «volver a escribirle al lead»; una tarea es trabajo de una persona.
- **Al derivar a una persona** (`escalateToHuman`): opción **apagada por defecto**
  (`guardrails.escalation.createTaskOnEscalate`, en la pestaña Configuración → Escalamiento de cada
  agente). Con el interruptor apagado, la derivación hace exactamente lo de siempre
  (`escalate-characterization.test.ts`).

## Disparadores: completar o vencer una tarea

`task_completed` y `task_overdue` (`lib/flow-engine/registry/task-triggers.ts`), con filtros
opcionales por proyecto y por origen. **Funcionan con y sin contacto**:

- Con contacto, el evento viaja con el contacto y sigue el camino de siempre.
- Sin contacto, viaja con la **persona del equipo a cargo** (responsable, si no quien la creó, si no
  quien hizo el cambio) y el flujo corre sin contacto, como los de fin de día. Los pasos que
  necesitan un contacto se saltean y se anotan. Si no hay ninguna persona, no se emite (queda en el
  log).
- `task_overdue` se emite desde el barrido de vencimientos, una vez por tarea y vencimiento, y solo
  para tareas con responsable o seguidores.
- El evento lleva **solo escalares** y nunca `booking_id`. Emitir **nunca rompe** lo que lo origina.
- Variables: `{{task.title}}`, `{{task.project}}`, `{{task.status}}`, `{{task.priority}}`,
  `{{task.source}}`, `{{task.due_date}}`, `{{task.owner}}` y `{{task.url}}`.

## Historial

Cada cambio queda en `audit_log` (`entity_type = 'task'`; acciones `task.*`). La visibilidad es una
política **adicional** (`audit_log_select_tasks`): quien ve la tarea ve su historial. `audit_log_select`
no se reescribió (`scripts/verify-audit-visibility.mjs` compara antes y después). El drawer lo muestra
con `<Historial entityType="task">`; la ficha del contacto, en su historial.

## Scripts de verificación

```
node scripts/verify-tasks.mjs     # RLS, privilegios por columna, ciclos, atomicidad, núcleo, cron, avisos y disparadores
node scripts/verify-tasks.mjs --hasta 198   # solo hasta una migración (útil si la 00199 aún no está aplicada)
```

Crea y limpia sus datos (prefijo `zz-test-`) y no se corre en simultáneo con los otros `verify-*`.
El bloque de la 00199 prueba de punta a punta: completar una tarea sin contacto emite el evento,
dispara un flujo publicado con el motor real, la sesión queda sin contacto, el paso «Crear tarea»
deja otra tarea y el mismo evento no dispara dos veces.

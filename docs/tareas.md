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

# Tareas × CRM (octubre 2026, rama `feat/tareas-crm`)

Segunda tanda del módulo: las tareas se conectan con el CRM (contacto, seguimiento, cobranza), con el calendario de Agenda y con la
fusión de contactos. Plan y avance en `docs/PROGRESS-tareas-crm.md`; pendientes y decisiones en `docs/PENDIENTE-tareas-crm.md`.
Migraciones: **00206** (hora, duración, seguimiento único) y **00207** (fusión de contactos y regla de fechas del sistema).

## La sección «Tareas» del contacto (ficha y bandeja)

- Un solo componente (`components/tasks/contact-tasks.tsx`) para la ficha del contacto y el panel de contacto de la bandeja. Lista las
  abiertas por vencimiento (sin fecha al final) y las últimas 5 completadas (`lib/tasks/contact-tasks.ts`, puro).
- El estado y la fecha se cambian en la línea (mismos caminos que la tabla, incluido el diálogo de mover fechas); el título abre el
  **drawer sin salir de la página**; «Agregar tarea» abre el drawer con el contacto ya vinculado.
- `ContactTasksProvider` pone arriba de la página un **anfitrión de tareas** (`components/tasks/task-workbench.tsx`: las tareas en
  pantalla, las acciones y el drawer). La sección «Tareas» y la tarea del seguimiento leen del mismo, así un cambio en una se ve en la
  otra al instante. En la bandeja lo arma `ContactTasksLoader` (pide las tareas con `listContactTasks`).
- Estados: cargando, error con «Reintentar» (un fallo de lectura **nunca** se ve como «sin tareas») y vacío con «Agregar tarea».
  Sin `tasks.edit`, todo es de solo lectura; sin `tasks.view`, la sección no existe.
- El drawer se puede usar fuera de `/dashboard/tareas`: pide al abrirse el resto de las tareas que la persona ve
  (`loadTaskContext`) para sus dependencias y proyectos.

## «Próximo seguimiento» con «Crear tarea»

- `FollowupField` suma dos props **opcionales** (`canCreateTask`, `contactName`); sin un `ContactTasksProvider` arriba es el campo de
  siempre (`followup-field.characterization.test.ts` lo fija).
- Con fecha y sin tarea para esa fecha: botón «Crear tarea». Con tarea: la tarea (estado, fecha, mismas acciones). La clave es
  `source_ref = 'followup:AAAA-MM-DD'`; el índice único parcial `uq_tasks_followup` (00206: contacto + fecha, **incluye las completadas**,
  una borrada libera la fecha) hace que dos clics o dos personas a la vez no creen dos: la acción devuelve la existente.
- **El día se decodifica con la zona del workspace** (`followupDateOf`), la misma para todos. Límite conocido: si quien cargó la
  fecha está a 12 horas o más de esa zona, el día puede correrse.
- Cambiar o quitar la fecha **no toca ninguna tarea**: para la fecha nueva vuelve a aparecer el botón; la anterior sigue en «Tareas».
- `createFollowupTask` valida el permiso (`tasks.edit`) y que el contacto se vea con la sesión, y escribe con el cliente de servicio
  (`source` y `source_ref` no son escribibles por la sesión). `contacts.next_followup_date` y `programar_seguimiento` no se tocaron.

## Hora y duración (R6)

- `tasks.due_time` (hora local del workspace, sin fecha) y `tasks.duration_minutes` (5 a 1440): **opcionales**; una tarea es solo fecha
  por defecto. La base exige que la hora tenga fecha (CHECK) y la acción borra hora y duración cuando se borra la fecha.
- Se agregan a propósito: «Agregar hora» en el selector de fecha de la celda, campos «Hora» y «Duración» en el drawer, o arrastrando en
  el calendario. Se muestran junto a la fecha («Hoy · 14:30») con el 12 h / 24 h del perfil de agenda (`scheduling_profiles.time_format`,
  24 h por defecto).
- **Las reglas de fechas siguen siendo por DÍA**: `computeDateShifts`, la validación de «la bloqueada no vence antes que su bloqueante»,
  el barrido de vencimientos y el filtro «vencidas» no miran la hora. Un corrimiento solo toca fechas: la hora y la duración se conservan.
- El orden es por fecha y, en el mismo día, por hora (las sin hora después). Las tareas de seguimiento y de cobranza son solo fecha; los
  nodos de flujo y la herramienta del agente no reciben hora.

## La regla de fechas es del sistema (R10)

Al completar un bloqueante, las fechas de **todas** las tareas que dependen de él (transitivas) se corrigen, sin importar si quien
completa las ve o las puede editar. Los permisos no cambian: sigue haciendo falta poder editar y ver **ese** bloqueante, y un Member sigue
sin poder leer ni editar las ajenas.

- `task_shift_context(p_task_id)` (00207, `authenticated`) verifica adentro `can_edit_tasks` y `can_see_task` del bloqueante y devuelve las
  dependientes con lo que la regla necesita (estado, fechas, hora, dependencias, responsable, seguidores, `updated_at`) y el **título solo
  de las que la persona ve**. Nada de descripciones.
- `complete_task_with_shifts` valida cada corrimiento contra el **árbol de dependientes** (abiertas, no borradas, del workspace, que solo
  atrasan, con el `updated_at` esperado); uno fuera del árbol rechaza **toda** la operación.
- La vista previa lista las que la persona ve con título y fechas y resume las otras en una línea («Y N tareas de otras personas también se
  van a mover»); la respuesta a la pantalla no lleva ids, títulos ni fechas de las ajenas (`hiddenShifted`).
- `task_date_moved` y `task_unblocked` llegan al responsable y a los seguidores de cada tarea movida (incluidas las ocultas), nunca al
  actor. El historial de cada una dice quién la movió y por qué (`metadata.reason = 'dependencia completada'`, `caused_by_task_id`).
- Los flujos (nodo «Completar tarea») no mueven fechas.

## Cobranza con tareas (R3, R4, R5)

- Nodo **«Crear tarea» ampliado**: responsable «Vendedor de la venta» (vendedor, si no el setter) y «Persona asignada al contacto»
  (vendedor, si no setter, si no quien tiene su conversación más reciente); si no queda nadie, se avisa a **cada** Owner/Admin. Vencimiento
  «hoy + N días» (0 es hoy). **Clave de origen** (`source_key`, con variables, por ejemplo `payment:{{payment.id}}`): se guarda como
  `source_ref` y evita crear otra tarea mientras haya una abierta con la misma clave. Si una variable de la clave no se resuelve, **no se
  usa la clave** (no se colapsan todos los pagos en una).
- Nodo nuevo **«Completar tarea»** (`complete_task`): cierra las tareas abiertas con esa clave como lo haría una persona pero sin mover
  fechas; si no hay ninguna, no hace nada. Nunca cierra una tarea sin `source_ref` coincidente.
- Variables de Ventas: se suman `{{contact.first_name}}` y `{{contact.display_name}}` (antes, `Hola {{contact.first_name}}` de los
  flujos de cobranza por email salía literal).
- **Interruptor «Crear una tarea cuando un pago vence»** (Ajustes › General › Ventas): crea y publica dos flujos
  (`task_payment_overdue` y `task_payment_paid_close`, en `lib/tasks/automation-templates.ts`, con claves propias que **no** están en
  `SALES_TEMPLATE_KEYS`). Se apaga pasándolos a borrador (las tareas quedan). El estado sale del flujo publicado: no hay columna. La
  publicación vive en `lib/flow-engine/publish.ts`, extraída de `POST /api/v1/flows/[flowId]/publish` sin cambiar la ruta.

## Tareas en el calendario de Agenda (R7)

- Interruptor «Tareas» junto a Día/Semana/Mes (`tareas=1` mías, `tareas=todas`; solo con `tasks.view`). **Apagado no se consulta nada de
  tareas** y el calendario es exactamente el de antes (`calendar-grid.characterization.test.ts`).
- Distintas de las agendas: borde punteado, icono de casilla, punto por prioridad y color de estado; completadas atenuadas y tachadas.
  Con hora, bloque de alto = duración (30 min si no tiene); sin hora, franja «Sin hora» arriba de cada día y etiqueta en el mes. Lo que se
  superpone va lado a lado (`layoutOverlaps`, solo con tareas). Panel plegable «Sin fecha» (máx. 50, con buscador).
- La hora de una tarea es del workspace; el calendario usa la zona del perfil de quien mira (`placeTasksInCalendar`).
- Clic abre el mismo drawer (`?task=`). **Las tareas se arrastran SIN confirmar** (HTML5 nativo, solo escritorio ≥ 768 px y con
  `tasks.edit`): hora de la rejilla (pasos de 15 min), franja «Sin hora» (quita hora y duración) o celda del mes (conserva la hora). Se
  aplica al instante, con las mismas validaciones que la edición en celda, y el aviso trae «Deshacer».

## Arrastrar agendas, siempre con confirmación (R8)

- Solo las agendas **activas** (agendada, confirmada, reagenda), con `bookings.manage`, en escritorio. Al soltar siempre se abre un modal
  (`dragConfirmReducer`: `idle → pending → confirming → done | error`; la acción solo se llama al entrar a `confirming`). Esc, clic afuera
  o «Cancelar» la dejan donde estaba. Se dibuja un fantasma en el horario nuevo mientras está abierto.
- Confirmar llama a `rescheduleAsHost` sin cambiarlo. Si responde «Ese horario ya no está disponible.» el modal ofrece «Reagendar igual
  (ignorar la disponibilidad)»; un choque con otra agenda no lo ofrece (la base lo impide). El texto de lo que pasa sale de lo que de
  verdad hace el reagendado (`rescheduleEffects`).

## Fusión de contactos (R9)

Detalle en [contactos-fusion.md](contactos-fusion.md).

## Scripts de verificación

```
node scripts/verify-tasks.mjs           # suma los bloques de 00206 (hora, seguimiento único), de la cobranza de punta a punta y de 00207 (regla de fechas)
node scripts/verify-contact-merge.mjs   # la fusión de contactos con una fusión real, la atomicidad y la guardia de deriva
```

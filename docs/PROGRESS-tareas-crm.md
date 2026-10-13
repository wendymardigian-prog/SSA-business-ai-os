# Progreso: Tareas × CRM y calendario (rama `feat/tareas-crm`)

Este archivo es lo que sigue la construcción aunque la conversación se resuma. **Releerlo al empezar cada requisito.** Pendientes y decisiones de trabas: `docs/PENDIENTE-tareas-crm.md`.

## Checklist

- [x] M1 (00206) aplicada y registrada
- [x] R1 · Sección «Tareas» del contacto (ficha y bandeja)
- [x] R2 · «Próximo seguimiento» con «Crear tarea»
- [x] R6 · Hora y duración opcionales
- [ ] R3 · Nodo «Crear tarea» ampliado
- [ ] R4 · Nodo «Completar tarea»
- [ ] R5 · Interruptor de cobranza (tarea al vencer un pago)
- [ ] M2 (00207) aplicada, registrada y verificada
- [ ] R10 · Regla de fechas global
- [ ] R9 · Fusión de contactos
- [ ] R7 · Tareas en el calendario de Agenda
- [ ] R8 · Arrastrar agendas con confirmación
- [ ] Revisión visual (1440 y 390 px, claro y oscuro)
- [ ] Cierre: docs, CLAUDE.md, limpieza `zz-test-`, PR

## Punto de partida (13/10/2026)

(se completa abajo con la salida real)

## Migraciones

| N.º | Archivo | Contenido | Estado |
|---|---|---|---|
| M1 | `00206_tasks_time_and_followup.sql` | `due_time`, `duration_minutes`, CHECK, GRANT por columna, índice único de seguimiento | aplicada y registrada (13/10/2026) |
| M2 | `00207_contact_merge_and_task_shift_context.sql` | `merge_contacts`, `task_shift_context`, reemplazo de `complete_task_with_shifts` | pendiente |

Próxima libre después de estas: `00208`.

---

# Plan aprobado (tal cual)

# Plan: Tareas × CRM (rama `feat/tareas-crm`)

## Contexto

La corrida anterior (Extra A, T1–T4, PR #48) dejó el sistema de tareas funcionando. Esta tanda lo conecta con el CRM: seguimiento del contacto, sección «Tareas» en ficha y bandeja, cobranza automática, hora en las tareas, tareas y arrastre en el calendario de Agenda, fusión real de contactos y una regla de fechas que ya no depende de lo que la persona ve. Es un sistema en producción: todo es aditivo, con caracterización antes de tocar y migraciones que no cambian datos existentes.

**Decisiones tomadas con Wendy (en esta sesión):**
1. Fusión (R9): la atribución del principal se **recalcula con todos los toques** (`private.refresh_contact_attribution`), no «solo si está vacía».
2. Seguimiento (R2): el día de `followup:<fecha>` y de `due_date` se decodifica con la **zona del workspace**. Límite conocido: si quien cargó la fecha está a 12 h o más de esa zona (ej. Tokio vs. Costa Rica), el día puede correrse. Queda documentado.
3. Variable `{{contact.first_name}}`: se **agrega** (y `contact.display_name`) a las variables de los eventos de Ventas, aditivo. Arregla de paso el saludo de los 4 flujos de cobranza existentes (hoy saldría literal; se confirma corriéndolo antes de tocar). Va en el PR.
4. Responsable «Persona asignada al contacto» = vendedor del contacto → si no, setter → si no, `assigned_to` de su conversación más reciente → si no, nadie (aviso a Owner/Admin).

## Punto de partida (medido hoy, 13/10/2026)

| Chequeo | Resultado |
|---|---|
| `npx vitest run` | **812 archivos / 10.129 tests, todo verde** |
| `npm run lint` | 0 errores, 36 warnings (ya existían) |
| `tsc --noEmit` | sin errores |
| `npm run build` y los `verify-*.mjs` | **No corridos todavía**: escriben (el build regenera `public/embed/embed.js`; los verify crean y borran datos `zz-test-` en la base real). El modo plan no permite escribir. **Se corren como primer paso después de aprobar** y se anota el resultado en PROGRESS. |
| Base | Última migración registrada: `00199_task_trigger_types`. **Libres: `00206` (M1) y `00207` (M2) (la otra sesión «Regla única de contactos» tiene reservadas la 00200 a 00205).** `tasks` tiene 0 filas; hay 843 contactos activos. |

## Lo que no coincide con tu descripción (gana el código real)

1. **R1 ya está a medias.** Existe `components/tasks/contact-tasks.tsx` en la ficha (lista, estado, fecha en línea, mover fechas, solo lectura sin `tasks.edit`). Falta: «Agregar tarea» abre el **drawer** (hoy es un alta rápida solo con título); el título abre el drawer **sin salir de la ficha** (hoy es un link a `/dashboard/tareas?task=`); estado de **error con reintento** (hoy un fallo de lectura se ve como «vacío»); reordenar tras editar; y el **panel de la bandeja no tiene nada de tareas** (solo el botón `CreateTaskButton` en el hilo). Ya existe `pickContactTasks` (`lib/tasks/contact-section.ts`): `tasksForContact`/`splitOpenDone` van en `lib/tasks/contact-tasks.ts` y `pickContactTasks` delega (sin romper su export).
2. **El drawer no se puede abrir fuera de `/dashboard/tareas`:** `lib/tasks/drawer-url.ts` tiene `TASKS_BASE="/dashboard/tareas"` fijo, y `startCreate({contact_id})` existe pero nadie lo llama (sin vínculo visible al crear). Hay que parametrizar la base y armar un anfitrión reutilizable (`TaskDrawerHost`) que sirva a ficha, bandeja y Agenda.
3. **`source` y `source_ref` no son escribibles por la sesión** (privilegios por columna; `createTaskSchema` es `.strict()` sin ellos). `createFollowupTask` escribe con el cliente de servicio **después** de validar permiso y visibilidad del contacto. `due_time`/`duration_minutes` **necesitan GRANT INSERT/UPDATE para `authenticated`** en M1 (si no, el editor falla en silencio).
4. **`source_ref` de `create_task` hoy es `flowId:sessionId:nodeId`** (no `flow_id:run_id`). Sin `source_key` se mantiene así.
5. **Ventas no usa ningún editor simplificado.** Los flujos de Ventas se editan solo en el lienzo (`/dashboard/flows/[flowId]`), donde ambos nodos ya están (el nuevo se suma a la paleta). El catálogo único de pasos simples (`lib/automations/step-catalog.ts`, pantallas forms/agenda/eod) **no se toca**; queda anotado.
6. **No hay función compartida para publicar:** la lógica está inline en `POST /api/v1/flows/[flowId]/publish` (con sesión de usuario). Se extrae a `lib/flow-engine/publish.ts` **sin cambiar la ruta** (mismos pasos, misma respuesta). Además `checkMemberFlow` devuelve `[]` para todo flujo de contacto, así que **publicar no valida nada estructural en Ventas**: la validación real de las plantillas la pongo yo en el test y en `ensureTaskPaymentFlows`.
7. **Formato de fecha:** hoy se ve `dd/mm` o «Hoy/Mañana/Hace N días» (`dueLabel`), nunca «20 oct». Mantengo ese estilo y le sumo la hora: «Hoy · 14:30», «20/10 · 2:30 p. m.». El 12h/24h **no es una preferencia general**: vive en `scheduling_profiles.time_format` (por usuario, default 24h); se usa ese con 24h de respaldo.
8. **Calendario de Agenda:** su zona sale de `scheduling_profiles.timezone` (no de `user_preferences`). No hay tests de componentes ni jsdom (solo `.test.ts` en node): las caracterizaciones de `FollowupField` y del calendario se hacen con `renderToStaticMarkup` (viene con `react-dom`, sin dependencias nuevas); el arrastre en sí no es testeable ahí, por eso toda su lógica va en funciones puras y se prueba en el navegador.
9. **`rescheduleAsHost` devuelve solo un texto de error**, sin código. Para ofrecer «Reagendar igual» solo cuando corresponde, comparo con los mensajes exactos («Ese horario ya no está disponible.») y un test los fija. **No se ofrece la casilla** para «Ese horario se acaba de ocupar» (la exclusión de la base no se salta con `ignoreAvailability`). Además el reagendado del anfitrión **no hace nada si la agenda no está activa** (filtra `status_group='active'`): solo se arrastran scheduled/confirmed/rescheduled, y solo con `bookings.manage` (lo que exige `visibleBooking`).
10. **Hoy el banner de vinculación pasa el contacto que estás mirando como duplicado**, o sea que **borra la ficha en la que estás** y terminás en 404. El aviso «Se unificaron…» no se puede mostrar ahí: después de fusionar redirijo a la ficha del **principal** y muestro el resumen allá (banner descartable).
11. **Inventario de relaciones con `contacts` en la base: 24, exactamente tu lista** (verificado con `pg_constraint`). Detalles que la lista no decía: `sales` es `ON DELETE RESTRICT`; hay índices únicos que obligan a reglas de conflicto además de las que pediste: `messages (conversation_id, platform_message_id)`, `agent_drafts` (un borrador abierto por conversación), `form_submissions (form_id, once_key)` con `once_key = contact:<id>` (se reescribe al principal salvo conflicto). `automation_events` **no tiene columna de estado**: «pendiente» = `processed_at IS NULL`, «cancelado» = se marca `processed_at` + `error='fusion de contactos'`.
12. **`complete_task_with_shifts` hoy valida cada corrimiento con `can_edit_tasks AND can_see_task` del destino y que el pedido traiga `updated_at` esperado de cada tarea.** Para R10, `task_shift_context` devuelve además `updated_at`, hora y duración de cada dependiente (necesarios para el control de concurrencia y para conservar la hora); el título solo si la persona la ve. Es un agregado a lo que describías.
13. **Los tipos de `tasks` en `database.ts` son parciales tipados** (no `Record<string, never>`: eso es de Ventas). `TaskRow` vive en `lib/tasks/types.ts`.
14. **`node` nuevo no entra en `NodeType`** (el código ya castea `"create_task" as NodeType`); hago lo mismo con `complete_task`.
15. **`lib/actions/task-settings.ts`, `lib/tasks/automation-templates.ts`, `followup.ts`, `contact-tasks.ts`, `calendar*.ts` y `booking-drag.ts` no existen:** son archivos nuevos.

## Orden de construcción

M1 (aplicar) → **R1** → **R2** → **R6** → **R3** → **R4** → **R5** → M2 (aplicar) → **R10** → **R9** → **R7** → **R8** → cierre.

Motivos: R2 necesita el índice de M1; R7 necesita la hora de R6 y el anfitrión del drawer de R1; R9 y R10 necesitan M2. Las migraciones se aplican antes de mergear el PR (código viejo sigue andando con base nueva; el nuevo no con la vieja). Tras cada R: `npm test`, tildar PROGRESS, commit `feat: tareas-crm - Rn (nombre)` y push.

## Caracterización (antes de tocar cada cosa)

| Qué | Cómo |
|---|---|
| `linkContacts` | Test nuevo `lib/actions/contacts.test.ts` con base simulada: fija lo que mueve hoy (conversaciones salvo canal repetido, canales, etiquetas, notas, rellenado, borrado lógico + `merged_into`, auditoría). Hoy no hay ningún test. |
| Plan de fechas para un Administrador | Caso nuevo en `date-rules.test.ts` + chequeo en `verify-tasks` (Administrador completa un bloqueante: mismo resultado antes y después de M2). |
| Registro de nodos | Hoy `listNodes()` = 30 (`registry.test.ts`), lista contact-free fija (`consistency.test.ts`). Se actualiza **solo con lo nuevo** (31 y `complete_task`). |
| Nodo `create_task` | Sus 14 tests actuales siguen en verde sin cambios; los campos nuevos tienen defaults equivalentes. |
| `FollowupField` | `followup-field.characterization.test.ts` con `renderToStaticMarkup` y mocks: fija el HTML con los dos usos (sin props nuevas). |
| Calendario de agendas | `calendar-grid.characterization.test.ts`: `placeInCalendar` (ya tiene 4 casos) + HTML de día/semana/mes sin tareas y sin props nuevas. |

## Migraciones

### M1 · `00206_tasks_time_and_followup.sql` (aditiva, riesgo bajo)
1. `ADD COLUMN IF NOT EXISTS due_time time NULL`, `duration_minutes integer NULL`.
2. CHECK (con guarda `DO $$`): `due_time IS NULL OR due_date IS NOT NULL`; `duration_minutes IS NULL OR BETWEEN 5 AND 1440`.
3. `GRANT SELECT/INSERT/UPDATE (due_time, duration_minutes) ... TO authenticated` (privilegios por columna).
4. `CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_followup ON tasks (workspace_id, contact_id, source_ref) WHERE source_ref LIKE 'followup:%' AND deleted_at IS NULL` (incluye completadas). Antes: consulta que prueba 0 filas violadoras (hoy `tasks` tiene 0 filas).
5. Cabecera «Como volver atras»: `DROP INDEX / CONSTRAINT / COLUMN IF EXISTS`. Se revisa que ninguna función con `INSERT` de columnas fijas se rompa (`tasks_before_write`, `complete_task_with_shifts`, `delete_task` no listan columnas nuevas; ok).

### M2 · `00207_contact_merge_and_task_shift_context.sql` (modifica lógica, riesgo medio)
Todas `SECURITY DEFINER`, `SET search_path = ''`, nombres con `public.`, `REVOKE ALL FROM PUBLIC, anon`.
1. **`merge_contacts(p_workspace_id, p_main, p_duplicate, p_actor)`**: solo `service_role`. Una transacción: valida mismo workspace / no borrados / distintos, `FOR UPDATE` en orden fijo de id, mueve las 24 relaciones con las reglas de R9 y devuelve JSON con conteo por tabla. No hace nada hasta que se la llama.
2. **`task_shift_context(p_task_id)`**: `authenticated`; verifica adentro `can_edit_tasks AND can_see_task` del bloqueante; devuelve por cada dependiente transitiva: id, estado, `start/due_date`, `due_time`, `duration_minutes`, `blocked_by`, `owner_id`, `follower_ids`, `updated_at` y `title` solo si `can_see_task` (si no, `null`). Nada de descripciones.
3. **`complete_task_with_shifts`** (reemplazo): la definición vigente (leída hoy con `pg_get_functiondef`) se copia completa en la cabecera. Misma firma y mismo JSON. Cambia solo la validación de cada corrimiento: en vez de `can_edit AND can_see` del destino, exige que sea **dependiente transitiva del bloqueante que se completa**, abierta, no borrada, del mismo workspace, que solo atrase y con el `updated_at` esperado. Todo lo demás (rechazo total ante un corrimiento fuera del árbol, `stale`, auditoría) igual; la auditoría suma `metadata.reason='dependencia completada'` + `caused_by_task_id`. Hora y duración se conservan solas (la función solo toca fechas).
- Vuelta atrás: `DROP FUNCTION IF EXISTS` de las dos nuevas y restaurar la definición vieja.
- Verificación: `verify-contact-merge.mjs`, `verify-tasks.mjs`, y una consulta de control con `pg_get_functiondef` + `has_function_privilege` (negativo para `anon`/`authenticated` en `merge_contacts`). Si algo falla: PARO y anoto en PENDIENTE qué falló y cómo volver.
- Después de cada una: `node scripts/build-all-migrations.mjs`, aplicar con `supabase db query --linked -f`, registrar en `supabase_migrations.schema_migrations`, actualizar `lib/types/database.ts`.

## Requisitos

### R1 · Sección «Tareas» del contacto (ficha y bandeja)
**Construyo:** `lib/tasks/contact-tasks.ts` (`tasksForContact`, `splitOpenDone`; `pickContactTasks` delega) + test; `components/tasks/task-drawer-host.tsx` (drawer + `ShiftDialog` + `useTaskActions` + `ToastProvider`, base de URL parametrizada en `drawer-url.ts`, vínculo al contacto visible al crear); `ContactTasks` pasa a abrir el drawer, estados cargando/error con reintento, reordenado, sin scroll horizontal en 390 px; acción `listContactTasks(contactId)` (permiso `tasks.view`, devuelve filas + miembros) para el panel de la bandeja, que carga en cliente con su `reload`; se monta en `contact-panel.tsx`.
**Listo cuando:** ficha y bandeja muestran lo mismo, «Agregar tarea» abre el drawer con el contacto, el título abre el drawer sin salir, completar con dependientes abre el diálogo, sin `tasks.edit` es solo lectura, tests puros verdes.
**Riesgo:** bajo. El drawer en una página nueva necesita sus propios datos (miembros, proyectos); se cargan en el servidor de esa página.

### R2 · «Próximo seguimiento» con «Crear tarea»
**Construyo:** `lib/tasks/followup.ts` (`followupRef`, `followupDateOf(iso, tz)`, `findFollowupTask`, `buildFollowupTask`) + test (Costa Rica, Buenos Aires, Tokio); acción `createFollowupTask(contactId, date)` en `lib/actions/tasks.ts`: valida contacto visible con la sesión, inserta con cliente de servicio (`source='manual'`, `source_ref='followup:<fecha>'`, título «Seguimiento a <nombre>», responsable = quien crea, `due_date` = día en zona del workspace), `logAudit`, si el índice rechaza devuelve la existente, nunca lanza. `FollowupField` suma props **opcionales** `contactName`, `canCreateTask` (firma obligatoria intacta): botón «Crear tarea» o la tarea existente (la más reciente) con las acciones de R1; al cambiar la fecha reaparece el botón y la tarea vieja no se toca; quitar la fecha tampoco toca nada. Los dos usos (ficha, panel) pasan las props.
**Listo cuando:** dos clics / dos personas = una tarea; el agente cambiando la fecha hace aparecer el botón; sin `tasks.edit` no hay botón.
**Riesgo:** medio-bajo. La tarea del seguimiento se busca por `source_ref` en las tareas del contacto (ya cargadas por R1).

### R3 · Nodo «Crear tarea» ampliado
**Construyo:** `owner` suma `seller` (vendedor de la venta → setter → nadie) y `contact_assigned` (decisión 4); `dueMode:"days"` ya existe (0 = hoy); `sourceKey` con variables → `source_ref`, sin él queda `flowId:sessionId:nodeId`; sin responsable se avisa **a cada Owner/Admin por separado** (`ownerAdminIds`, ya existente). El vendedor/setter se leen de la venta por `event_sale_id` en el nodo (el payload de pagos no los trae). Panel `CreateTaskPanel` con los campos nuevos; tarjeta del lienzo (`action-node.tsx`) muestra la clave; variables: `payment.id/due_date/amount` y `sale.vendedor_name` ya existen; **se agregan `contact.first_name` y `contact.display_name`** a `salesVariables`/`salesVariableSchema` (decisión 3) con test. `create-task.test.ts` suma modos de responsable, `source_key` con variables, idempotencia, nunca lanza.
**Riesgo:** medio. Antes de tocar, confirmo corriendo un evento simulado que hoy `{{contact.first_name}}` sale literal.

### R4 · Nodo nuevo «Completar tarea» (`complete_task`)
**Construyo:** `lib/flow-engine/nodes/complete-task.ts` (`needsContact:false`, `sourceKey` con variables) + `lib/tasks/complete-from-automation.ts`: cliente de servicio, completa **solo** abiertas, no borradas, del workspace con ese `source_ref` (jamás sin `source_ref` coincidente), `completed_at`, auditoría actor `system`, avisos habituales (`task_unblocked`), emite `task_completed` como lo haría una persona, **no mueve fechas**, nunca lanza; sin coincidencia no hace nada. Registro (`nodes.ts`, `contact-free.ts`), paleta, panel, tarjeta propia en el lienzo, simulador (el test de consistencia lo exige). Actualizo solo lo nuevo en los tests de registro/consistencia (31 nodos; lista contact-free).
**Riesgo:** medio. Calcular «desbloqueadas» sin sesión de usuario: reuso las funciones puras de `lib/tasks/notifications.ts` / `planCompleted`.

### R5 · Interruptor «Crear una tarea cuando un pago vence»
**Construyo:** `lib/flow-engine/publish.ts` (extraído de la ruta, misma respuesta; los tests de ruta quedan intactos); `lib/tasks/automation-templates.ts` con `task_payment_overdue` y `task_payment_paid_close` (grafos exactos de tu texto: trigger `payment_status_changed` → «Crear tarea» / «Completar tarea»); `ensureTaskPaymentFlows(db, ws, {enabled})` idempotente por `template_key`, no pisa un grafo editado (solo cambia estado), publica con el servicio extraído o pasa a borrador (al apagar borro los `triggers` del flujo, como hace Formularios); `getPaymentTasksState` (publicado = encendido, sin columna); acción `setPaymentTasksEnabled` en el archivo nuevo `lib/actions/task-settings.ts` (`settings.manage`, audita, devuelve el estado real; si publicar falla, borrador + motivo + interruptor apagado). UI: tarjeta nueva junto a `SalesSettings` en `settings-view.tsx` (no edito `lib/actions/sales-settings.ts` ni `lib/sales/automation/templates*.ts`), con ayuda, enlaces a los dos flujos y estados cargando/error. Tests: grafos válidos, nodos y triggers existen en el registro, estado apagado sin flujos, idempotencia, no pisa edición.
**Riesgo:** medio. Publicar desde el servidor es lo más delicado. Si no se puede de forma segura: flujos en borrador + botón «Activar» y lo anoto en PENDIENTE.
**Comportamiento esperado:** pago pasa a vencido → una tarea (no se duplica si vuelve a vencer mientras siga abierta); se cobra → se completa sola; si ya estaba completada, no pasa nada.

### R6 · Hora y duración opcionales
**Construyo:** `TaskRow`/`TASK_COLUMNS`/`database.ts`; `schema.ts` (`HH:MM`, duración entera 5–1440, hora sin fecha rechazada); `core.ts` (al borrar la fecha, también hora y duración, en el mismo patch); auditoría con `changes {old,new}`; `table-model.ts` (orden fecha → hora, sin hora después); `format.ts` `formatTaskWhen(date, time, timeFormat)`; UI: «Agregar hora»/«Quitar hora» en la celda, campos Hora y Duración (15/30/45/60/90/120 o vacío) en el drawer, hora visible en tabla, tablero, ficha, «Mis tareas» y drawer. `computeDateShifts` y el RPC no cambian de resultado (conservan hora y duración porque solo tocan fechas); caso nuevo en `date-rules.test.ts` que lo prueba. Seguimiento y cobranza siguen siendo solo fecha; nodos y herramienta del agente sin campos de hora.
**Riesgo:** bajo-medio (muchas superficies, todas por `formatTaskWhen`).

### R10 · Regla de fechas global
**Construyo:** `buildPlan` (`core.ts`) pasa a usar `task_shift_context` (todas las dependientes) en vez de las visibles; `completeTaskCore` manda esos corrimientos y `updated_at`; avisos `task_date_moved`/`task_unblocked` a responsable y seguidores de cada tarea movida (incluidas las que quien completa no ve), nunca al actor; `ShiftDialog` lista las visibles con título y fechas y resume las otras en una línea («Y N tareas de otras personas también se van a mover»), sin título ni datos; se mantienen «Mover fechas y completar» y «Completar sin mover fechas». Los flujos (R4) siguen sin mover fechas. Docs: se revierte la decisión de PENDIENTE («dependientes que no ve no se mueven»).
**Tests:** `date-rules.test.ts` (los 13 actuales verdes + «el plan con todas las tareas = el de un Administrador»); `verify-tasks.mjs`: un Member completa un bloqueante propio con dependientes ajenos → fechas corregidas, dueños reciben `task_date_moved`, el Member sigue sin poder leerlas ni editarlas, `task_shift_context` no devuelve títulos de las que no ve, un corrimiento fuera del árbol falla toda la operación, completar un bloqueante que no ve/edita se rechaza; y que las pruebas de RLS/roles no cambian.
**Riesgo:** medio-alto (toca permisos indirectamente). Mitigación: la validación SQL exige pertenencia al árbol del bloqueante.

### R9 · Fusión de contactos
**Construyo:** `merge_contacts` (M2) con estas reglas explícitas (todas probadas en `verify-contact-merge.mjs`):
- `conversations` (única por canal+contacto): si el principal ya tiene conversación en ese canal, los mensajes del duplicado pasan a la del principal en orden cronológico (los que chocan por `platform_message_id` quedan en la vieja y se informan), se recalculan `last_message_at/preview/unread_count`, el borrador abierto del duplicado se cancela si el principal ya tiene uno, y la conversación vacía queda con `deleted_at` (soft delete, como el resto). Las demás se mueven enteras.
- `contact_tags`/`contact_custom_fields`: se mueven los que faltan; en un campo repetido gana el del principal.
- `sequence_enrollments`: si el principal ya está activo/pausado en esa secuencia, la viva del duplicado pasa a `cancelled` con motivo «fusión de contactos»; el resto se mueve.
- `flow_sessions`: activas del duplicado se mueven salvo que el principal tenga una activa del mismo flujo (entonces `cancelled`); el historial siempre se mueve.
- `automation_events` pendientes (`processed_at IS NULL`) del duplicado se marcan cancelados; los procesados se mueven.
- `tasks`: si ambos tienen `followup:<misma fecha>`, la del duplicado pasa con `source_ref = NULL`. Ninguna se pierde.
- `contact_touches`: se mueven todos y se recalcula la atribución del principal (decisión 1). No se toca `record_contact_touch`.
- `form_submissions.once_key`: se reescribe a `contact:<principal>` salvo conflicto.
- `referred_by_contact_id`, `sales` (y sus pagos), `bookings`, `calls`, etc.: cambian de dueño, sin tocar montos ni estados.
- Rellenado de vacíos del principal (lista actual + `next_followup_date`), unión de notas, borrado lógico con `metadata.merged_into` y borrado de la sugerencia: dentro de la misma transacción.
`linkContacts` conserva Owner/Admin y su pre-validación y delega con el cliente de servicio; `logAudit` `link` con `metadata` = conteo por tabla + `merged_from` + `automatic:false`. `lib/contacts/merge.ts` (`CONTACT_MERGE_TABLES`, `summarizeMerge` con pluralización, exclusiones con motivo). El banner redirige a la ficha del principal con el resumen («Se unificaron 2 conversaciones, 1 agenda, 3 tareas, 1 venta…») y hace `revalidatePath` de ambos.
**Guardia de deriva:** `scripts/verify-contact-merge.mjs` lee el catálogo con la CLI (como `verify-sales`) y falla si hay una relación con `contacts` que no esté en `CONTACT_MERGE_TABLES` ni en la lista de exclusiones. Siembra un duplicado con filas en **cada** tabla y un principal con todos los conflictos, fusiona y comprueba todo (incluidos mensajes, pagos, Member rechazado y **atomicidad** forzando un error a mitad). `sales` es RESTRICT: la limpieza borra ventas antes que contactos.
**Riesgo:** alto (datos reales). Es aditivo hasta que alguien fusione; M2 no cambia nada existente.

### R7 · Tareas en el calendario de Agenda
**Construyo:** `lib/tasks/calendar.ts` (`placeTasksInCalendar({tasks, workspaceTz, viewerTz, view, range})`, convierte hora de la tarea a la zona del calendario, cruce de medianoche, sin hora queda en su fecha) y `layoutOverlaps` (reparto en columnas, solo con el interruptor encendido); `lib/tasks/calendar-drag.ts` (`snapMinutes`, `dropTarget`, `undoPatch`). Interruptor «Tareas» junto a Día/Semana/Mes (URL `tareas=1`, `tareas=todas`; por defecto «mías» = responsable yo; solo con `tasks.view`). Con el interruptor apagado **no se consulta nada de tareas** y el calendario no cambia. Con él encendido, la página carga las tareas visibles (RLS) con `due_date` en el rango (con margen de un día por zona) + la lista «Sin fecha» (máx. 50 abiertas, con buscador). Aspecto: borde punteado, ícono de casilla, punto de prioridad, completadas atenuadas/tachadas y no arrastrables; franja «Sin hora» por día; etiqueta en el mes; en celular (<768 px) van en la lista por día. Clic abre `TaskDrawerHost` con `?task=` (no choca con `agenda=`). Arrastre HTML5 nativo (patrón del kanban), solo ≥768 px y con `tasks.edit`: hora de la rejilla (pasos de 15 min, conserva duración), franja «Sin hora» (solo fecha, quita hora), celda del mes (cambia día, conserva hora); aplica al instante (optimista) con las mismas acciones y validaciones que la celda; rechazo → vuelve y muestra el motivo; éxito → aviso con «Deshacer». Al toast de Contenido se le suma `action?: {label, onClick}` (aditivo, con test). Las llamadas no se agregan.
**Tests:** `calendar.test.ts`, `layoutOverlaps.test.ts`, `calendar-drag.test.ts`, y la caracterización con el interruptor apagado.
**Riesgo:** medio (UI grande). Mitigación: todo con props opcionales; revisión visual a 1440 y 390.

### R8 · Arrastrar agendas, siempre con confirmación
**Construyo:** `lib/scheduling/booking-drag.ts` (`bookingDropToStartUtc(drop, viewerTz, currentStartUtc)`, `dragConfirmReducer`: `idle → pending(drop) → confirming → done | error`; ninguna transición llama a la acción sin pasar por `pending` y una confirmación explícita; cancelar vuelve a `idle` sin efectos) + test. Arrastrables: solo activas (scheduled/confirmed/rescheduled), con `bookings.manage`, ≥768 px, aunque las tareas estén apagadas. Al soltar, **siempre** un modal (Esc / clic afuera = cancelar) con invitado, tipo de evento, «De → A» en la zona del calendario, motivo opcional y el texto real del reagendado: la agenda conserva su duración y pasa a «Reagendada»; si está sincronizada con Google, Google actualiza el evento y le avisa al invitado; los recordatorios pendientes se mueven al nuevo horario; el aviso por email «Aviso de reagendamiento» solo sale si el workspace lo publicó (viene apagado de fábrica); queda en el historial. Fantasma en la posición nueva mientras está abierto. Confirmar llama a `rescheduleAsHost({bookingId, startUtc, reason})`; si responde «Ese horario ya no está disponible.», el modal queda abierto con la casilla «Reagendar igual (ignorar la disponibilidad)» y solo con ella reintenta con `ignoreAvailability:true`; cualquier otro error se muestra sin cerrar. No se tocan `rescheduleBooking` ni `rescheduleAsHost`.
**Riesgo:** medio. El texto del modal se arma según lo que la agenda realmente tiene (con o sin evento de Google).

## Limpieza y datos de prueba
Todo test/verify que crea datos usa `zz-test-` y limpia en `try/finally`. Amplío `scripts/test-cleanup.mjs` con un **informe de residuos** (cuenta por tabla relevante: workspaces, usuarios, contactos, tareas, ventas, pagos, agendas, conversaciones) y lo corro al final mostrando que no queda ningún `zz-test-`. Datos reales nunca se tocan.

## Revisión visual (navegador propio, 1440 y 390 px, claro y oscuro)
Sección Tareas de ficha y bandeja; campo de seguimiento (sin tarea / con tarea / fecha cambiada); panel de «Crear tarea» y de «Completar tarea»; interruptor de Ajustes › Ventas y los dos flujos; hora en celda y drawer; calendario con tareas apagado (idéntico) y encendido (día, semana, mes, con/sin hora, panel «Sin fecha», solapes); modal de confirmación de agenda; resumen de la fusión en la ficha del principal. Si el navegador permite arrastrar, pruebo soltar una tarea (se mueve + «Deshacer») y una agenda (siempre modal; «Cancelar» la deja); si no, se anota en `PENDIENTE-tareas-crm.md`. Si pide login sin sesión, se anota; nunca escribo credenciales.

## Cierre
`docs/tareas.md` (fusión, regla de fechas global, seguimiento, ficha, cobranza, nodos, hora, calendario, arrastre de agendas), `docs/flow-registry.md`, `docs/contactos-fusion.md`, `CLAUDE.md` (subsección «Tareas × CRM» con «Lo que no se puede romper» y próxima migración libre `00208`), `docs/PENDIENTE-tareas.md` actualizado. Abro PR `feat/tareas-crm` → `main` con `gh pr create` (resumen de PROGRESS y PENDIENTE). **No mergeo.**

## Primeros pasos tras aprobar (antes de R1) y luego FRENO
1. Crear `docs/PROGRESS-tareas-crm.md` con este plan tal cual, R1–R10 como checklist, «Punto de partida» y «Migraciones» (00206 / 00207).
2. Crear `docs/PENDIENTE-tareas-crm.md` (qué quedó / por qué / qué se decidió).
3. Correr `npm run build` y cada `verify-*.mjs` de a uno y anotar el resultado en «Punto de partida».
4. Commit `docs: plan de tareas x CRM` + `git push origin feat/tareas-crm`.
5. **Frenar y esperar tu `/goal`.** No empiezo R1 hasta entonces.

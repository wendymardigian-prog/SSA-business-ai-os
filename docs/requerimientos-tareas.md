# Requerimientos — SSA Business AI OS
## Extra A — Sistema de Tareas (fase única, bloques T1 a T4)
Versión: 1.0
Fecha: 2026-10-13
Cliente: SSA (single-tenant, white-label: un clon por cliente)
Base: `claude/alcance-v10.md` (vigente) + `claude/investigacion-sistema-tareas.md`
Tipo de trabajo: **brownfield** (se agrega sobre un sistema en marcha; ver sección 14e)

---

## 1. Mapa de ruta de fases

| Etapa / Fase | Estado |
|---|---|
| Etapas 1–5 + Extras hasta L (CRM, Bandeja, Flows, Agente, Contenido, Llamadas, Ventas, Formularios/EOD, Atribución, Webhooks, Extra L) | Construido |
| **Extra A — Sistema de Tareas (T1–T4)** | **ESTA FASE** |
| Asistente (requerimientos-asistente.md) | Después. Las tareas se construyen antes para que el Asistente pueda crearlas y leerlas |
| CX Fase 2 («tarea con SLA») | Después. Queda reservado: `tasks.source = 'cx'` y `source_ref` |
| Gastos | Después, sin relación |

**Contemplado en el diseño pero NO se construye ahora:**
- Tabla `projects` (el proyecto es texto + `project_key` normalizado dentro de `tasks`; migrar a tabla es un backfill de `SELECT DISTINCT`).
- Subtareas, tareas recurrentes, comentarios en la tarea, adjuntos, etiquetas, horas/tiempo estimado.
- Aviso por email o WhatsApp (solo campana).
- Tarea ligada a venta/llamada/agenda (solo contacto y conversación).
- Origen `cx` (columna lista, nadie escribe `cx` todavía).

---

## 2. Cambios en la base de datos y riesgos (A APROBAR ANTES DE CONSTRUIR)

**Regla del pedido: 1 sola tabla nueva (`tasks`).** Todo lo demás reutiliza infraestructura existente.

| N° | Qué hace, en una línea | Tipo | Riesgo | Reversible |
|----|------------------------|------|--------|------------|
| 00196 | Tabla nueva `tasks` + índices + RLS + `can_see_task` / `can_see_task_id` + trigger que limpia referencias cuando una persona sale del workspace | Aditiva | Bajo | Sí (`DROP TABLE tasks CASCADE` + `DROP FUNCTION`) |
| 00197 | Funciones atómicas: `complete_task_with_shifts`, `set_task_blockers`, `delete_task`; policy nueva `audit_log_select_tasks` (aditiva, **no toca** `audit_log_select` ni las otras `audit_log_select_*`) | Aditiva (funciones y policy nuevas) | Medio | Sí (`DROP FUNCTION` ×3 + `DROP POLICY audit_log_select_tasks`) |
| 00198 | Función SQL `private.enqueue_tasks_due_sweep()` + cron horario que encola 1 job por workspace y día local (patrón 00167). No toca `private.call_app_cron` | Aditiva | Bajo | Sí (`cron.unschedule` + `DROP FUNCTION` + cancelar jobs pendientes) |
| 00199 | **Amplía el CHECK `triggers_type_check`** para aceptar `task_completed` y `task_overdue` (patrón 00155 / 00149). Solo si se construye F25 | **Modifica estructura existente** | **Medio** | Sí, con la lista vieja copiada en el comentario de la migración |

> Los números son los siguientes libres según el repo (última: `00195_ads_crm_metrics.sql`). El builder DEBE confirmarlos con `ls supabase/migrations` y con `list_migrations` antes de crear archivos; si hay otra rama que ya usó 00196, se corre todo el bloque al siguiente libre y se actualiza este documento.

### Qué se aprueba
- **00196:** crea la tabla de tareas. No cambia nada existente. El trigger de limpieza solo actúa sobre filas de `tasks`.
- **00197:** crea tres funciones nuevas que hacen en una sola transacción lo que no puede quedar a medias (completar una tarea y mover las fechas de las que dependen; guardar dependencias sin ciclos; borrar una tarea quitándola de las dependencias de las demás). Y agrega una policy para que el historial de una tarea lo vea quien ve la tarea.
- **00199 (la única de riesgo medio sobre algo existente):** el constraint que lista los tipos de disparador de flujos se reescribe con dos valores más. Si se escribe mal, se podrían bloquear altas de flujos con triggers; por eso la migración copia la lista vigente antes de modificarla y el verify prueba que los triggers existentes siguen aceptados.

### Orden contra el deploy
- 00196, 00197, 00198: **aditivas**. El código viejo sigue andando sin ellas → se pueden aplicar por adelantado.
- 00199: aditiva en la práctica (solo acepta más valores). El código viejo no la nota.
- El **código nuevo SÍ necesita 00196 y 00197 aplicadas antes de desplegar** (consulta `tasks` y llama las funciones). Orden: aplicar migraciones → verificar → desplegar.
- Regla del repo: tras cada migración, `node scripts/build-all-migrations.mjs`; aplicar con `supabase db query --linked -f <archivo>` y registrar en `supabase_migrations.schema_migrations`.

### Qué pasa con los datos existentes
- No hay backfill: `tasks` nace vacía. No se modifica ni se borra ninguna fila existente.
- `contacts.next_followup_date` (seguimiento del agente) **no se migra ni se toca**. Convive: es el «volver a escribirle» del lead, la tarea es trabajo del equipo.
- Los permisos nuevos (`tasks.*`) no existen en roles personalizados ya guardados: quedan **sin acceso** hasta que alguien los marque, salvo Owner/Admin (todos) y Member (ver «Usuarios y roles»). Es la conducta ya conocida de los permisos del repo.

### Cómo se verifica después de aplicar
- `node scripts/verify-tasks.mjs` (nuevo, parte del bloque T1; patrón `verify-calls.mjs`, prefijo `zz-test-`, limpia lo suyo): RLS por rol, `set_task_blockers` rechaza ciclos, `complete_task_with_shifts` es atómica (si un corrimiento es inválido no se completa nada), borrar persona limpia referencias, cron encola 1 job por workspace/día.
- Control rápido: `SELECT count(*) FROM information_schema.tables WHERE table_name='tasks'` = 1 y `SELECT count(*) FROM tasks` = 0 tras aplicar.
- Para 00199: `node scripts/verify-tasks.mjs` incluye insertar un trigger `task_completed` y uno ya existente (`sale_created`) y ambos deben aceptarse.

### Cómo se vuelve atrás
- 00197 y 00199 (riesgo medio): los `DOWN` están escritos en el encabezado de cada migración (patrón del repo «Como volver atras»). Ninguna es **IRREVERSIBLE**. Antes de revertir 00199 hay que borrar triggers de tipo `task_*`.
- Reversión total de la fase: revertir 00199 → 00198 → 00197 → 00196. Las tareas creadas se pierden (es una tabla nueva); no hay otras tablas afectadas.

---

## 3. Objetivo y mapa de bloques

**Objetivo:** que el equipo gestione trabajo pendiente (con responsable, seguidores, proyecto, fechas y dependencias) en una tabla y un tablero muy interactivos, con avisos en la campana y creación desde flujos y desde el agente de IA.

**Por qué ahora:** el Asistente y CX Fase 2 necesitan un destino para «algo por hacer»; construir tareas antes evita que cada módulo invente el suyo.

| Bloque | Día | Qué se construye | Contexto compartido |
|---|---|---|---|
| **T1 — Base y reglas** | 1 | Tabla, RLS, permisos, regla de fechas pura + RPC atómicas, dependencias sin ciclos, limpieza de referencias, auditoría, acciones de servidor con validación | `tasks`, `lib/tasks/*`, `lib/actions/tasks.ts`, `lib/auth/permissions.ts`, `audit_log` |
| **T2 — Tabla, edición en celda y drawer** | 2 | Vista tabla, edición en celda, drawer `?task=`, diálogo de fechas, filtros, creación rápida, ítem de menú | `components/tasks/*`, `app/(dashboard)/dashboard/tareas`, `lib/nav/items.ts` |
| **T3 — Tablero, avisos y superficies** | 3 | Kanban, notificaciones, cron de vencimientos, «Mis tareas», tareas en ficha de contacto y bandeja, mobile | `lib/notifications/*`, `lib/jobs/*`, ficha de contacto, bandeja |
| **T4 — Origen automático** | 4 | Acción de flujo «Crear tarea», triggers `task_completed`/`task_overdue`, tool del agente `crear_tarea`, tarea al escalar, origen visible | `lib/flow-engine/*`, `lib/agent/tools/*` |
| Testing de fase | 5 | `npm test`, `build`, `lint`, `verify-tasks`, revisión visual, correcciones | — |

Cada bloque se ejecuta como un solo prompt. En el modo one-shot los cuatro bloques se encadenan en una corrida (ver `Prompt_OneShot_Tareas.md`).

---

## 4. Usuarios y roles

| Rol | Ve | Puede | No puede |
|---|---|---|---|
| **Owner / Admin** | Todas las tareas del workspace | Todo: crear, editar, completar, reasignar, borrar, ver historial | — |
| **Member (rol de sistema)** | Las que **creó, tiene a cargo o sigue** (RLS) | Crear (queda como creador y por defecto como responsable), editar y completar las que ve, agregar seguidores | Ver tareas ajenas en las que no figura; borrar (requiere `tasks.delete`) |
| **Rol personalizado** | Según `tasks.view` + alcance `own`/`all` del módulo `tasks` | Según `tasks.edit` / `tasks.delete` | Lo que no tenga marcado |

- Permisos nuevos (`lib/auth/permissions.ts`, módulo `tasks`): `tasks.view`, `tasks.edit`, `tasks.delete`. Módulo nuevo `tasks` en `PERMISSION_MODULES` y en `SCOPED_MODULES` (alcances `own` | `all`).
- Defaults: Owner y Admin reciben todo (ya lo hacen por `ALL_PERMISSION_KEYS`). **Member recibe `tasks.view` y `tasks.edit`, alcance `own`**; sin `tasks.delete`.
- ⚠️ El repo tiene un test de caracterización del Member (`member-baseline.test.ts`). Al sumar permisos al Member hay que **actualizarlo de forma explícita y mínima** (solo las dos claves nuevas), no desactivarlo.
- «Seguidor» y «responsable» ven la tarea aunque su rol tenga alcance `own`: `own` significa creador ∪ responsable ∪ seguidor.
- Primer usuario: Owner (sin cambios).

---

## 5. Alcance específico de esta fase

### 5.1 Tarea
- **Qué hace:** unidad de trabajo con título, descripción (texto plano), estado (`pending|in_progress|completed`), prioridad (`low|normal|high|urgent`), fecha de inicio y de vencimiento (solo fecha, zona del workspace), un responsable principal, seguidores (varios), proyecto (texto), dependencias, y vínculo opcional a un contacto y/o conversación.
- **Hasta dónde llega:** fecha sin hora. Descripción sin formato enriquecido (máx. 5000 caracteres; título máx. 200).
- **Qué NO hace:** subtareas, recurrencia, comentarios, adjuntos, etiquetas, tiempo estimado.
- **Dónde va lo que queda afuera:** backlog posterior; no hay fase asignada.

### 5.2 Responsable y seguidores
- Un único `owner_id` (puede quedar vacío) + `follower_ids` (máx. 20). Quien es responsable no puede estar además en seguidores (se normaliza al guardar).
- Solo se pueden elegir miembros del workspace.
- Al salir una persona del workspace: `owner_id → null`, se la quita de `follower_ids`, y si una tarea abierta queda sin responsable, no se genera aviso automático (la tarea aparece con el filtro «Sin responsable»).

### 5.3 Proyecto (sin tabla)
- Texto libre (máx. 80). Se guarda `project` (como lo escribió la primera vez) y `project_key` (normalizado: minúsculas, sin acentos, espacios colapsados, trim).
- La lista de proyectos existentes = `SELECT DISTINCT project` agrupado por `project_key` (se muestra la variante más usada/antigua). Escribir «Lanzamiento  Q4» o «lanzamiento q4» reutiliza el existente; la UI ofrece «Crear «…»» solo si la clave normalizada no existe.
- **Qué NO hace:** renombrar un proyecto en masa, archivarlo, darle dueño o fechas. Eso es la futura tabla `projects`.

### 5.4 Dependencias
- Una tarea puede estar bloqueada por **varias** tareas (`blocked_by`: `[{task_id, gap_days}]`, máx. 10). Sin ciclos (directos ni indirectos). Misma workspace. No se permite bloquearse a sí misma.
- La tarea bloqueada **puede completarse igual** (el bloqueo es informativo).
- **Regla de fechas** (decisiones 279–284, 297 del alcance), ver 6 / F3:
  - Se evalúa **al completar un bloqueante**.
  - Solo considera dependientes **no completadas con fecha de vencimiento**.
  - Fecha mínima permitida de la dependiente = **máximo, entre todos sus bloqueantes**, de (fecha real de completado si está completado, si no su vencimiento) + `gap_days`.
  - **Solo atrasa, nunca adelanta.** Se muestra vista previa y la persona confirma, o elige «dejar fechas como están». Propaga por la cadena en una sola confirmación. Días corridos (sin saltar fines de semana). Reabrir una tarea no deshace corrimientos.
  - `start_date`, si existe, se corre los mismos días que `due_date` (conserva la duración). *(Decisión del redactor — ver sección 15.)*
  - Tareas sin fecha de vencimiento no participan.
  - Una tarea bloqueada no puede vencer **antes** que su bloqueante (mismo día sí). Si alguien edita la fecha de la bloqueada, `gap_days` se recalcula; si quedaría negativo, se rechaza.
- **Qué NO hace:** adelantar fechas, saltar fines de semana/feriados, mover fechas sin confirmación.

### 5.5 Notificaciones (solo campana)
Siempre con destinatario concreto (`recipient_id`), nunca el atajo «null = Owner/Admin». Nunca a quien hizo la acción. Tipos: `task_assigned`, `task_follow_added`, `task_changed` (a seguidores y responsable, con tope), `task_unblocked`, `task_date_moved`, `task_due_today`, `task_overdue`. **Sin email ni WhatsApp.**

### 5.6 Vistas
Tabla (principal), tablero kanban por estado, «Mis tareas» (filtro guardado en URL), drawer, secciones de tareas en ficha de contacto y botón «Crear tarea» en la bandeja. Sin calendario ni Gantt.

### 5.7 Origen
Manual, acción de flujo «Crear tarea» y tool del agente `crear_tarea`. `source ∈ manual|flow|agent|cx`.

---

## 6. Funcionalidades y criterios de aceptación

> Convención de pruebas: **Vitest** (`npm test` = `vitest run`) para lógica pura y acciones con Supabase simulado (patrón `lib/actions/*.test.ts`); **`scripts/verify-tasks.mjs`** contra la base real para RLS y atomicidad (lo que Vitest no puede probar). No se agregan dependencias de testing. La lógica de pantalla vive en funciones puras (`lib/tasks/*`) y los componentes solo las componen.
> Los tests nombrados los **escribe Claude Code** como parte del bloque.

### Bloque T1 — Base y reglas

#### F1 — Tabla `tasks`, RLS y visibilidad
**Descripción:** migración 00196.
**Columnas:** ver sección 8.
**Criterios:**
- DADO un Owner/Admin, CUANDO consulta `tasks`, ENTONCES ve todas las del workspace.
- DADO un Member sin tareas propias, CUANDO consulta `tasks`, ENTONCES recibe 0 filas; DADO que es creador, responsable o seguidor de una tarea, ENTONCES la ve; DADO que NO figura, ENTONCES no la ve ni por `id`.
- CUANDO un Member con `tasks.view` pero sin `tasks.edit` intenta `UPDATE`/`INSERT`, EL SISTEMA DEBE rechazarlo (RLS).
- CUANDO un usuario de OTRO workspace consulta, EL SISTEMA DEBE devolver 0 filas.
- CUANDO se hace `DELETE` directo por cliente autenticado, EL SISTEMA DEBE rechazarlo: el borrado va por `delete_task` (soft delete).
- La migración es idempotente: correrla dos veces no falla. Tiene encabezado «Como volver atras».
- `scripts/verify-tasks.mjs` cubre estos 6 casos y sale 0. `node scripts/build-all-migrations.mjs` corre sin error.

#### F2 — Permisos y alcance
**Criterios:**
- CUANDO se listan `PERMISSION_KEYS`, EL SISTEMA DEBE incluir `tasks.view`, `tasks.edit`, `tasks.delete` con etiqueta en castellano y descripción.
- `SCOPED_MODULES` incluye `tasks` con opciones `own|all`; `normalizeScope("tasks", "x")` = `own`.
- DADO el rol Member, ENTONCES tiene `tasks.view` y `tasks.edit` y no `tasks.delete`; Owner/Admin tienen las tres.
- La pantalla de roles muestra el módulo «Tareas» (test en `lib/auth/permissions.test.ts` + `member-baseline.test.ts` actualizado solo en lo mínimo). `npm test` en verde.

#### F3 — Regla de fechas (función pura)
**Archivo:** `lib/tasks/date-rules.ts` → `computeDateShifts({tasks, completedTaskId, completedOn}): DateShiftPlan`.
**Criterios (tests en `lib/tasks/date-rules.test.ts`):**
1. DADO A(due hoy) bloquea B(due mañana, gap 1), CUANDO A se completa **hoy**, ENTONCES plan vacío.
2. DADO A(due 10) bloquea B(due 11, gap 1), CUANDO A se completa el 13, ENTONCES B pasa al 14 (13+1).
3. CUANDO A se completa **antes** de su vencimiento, ENTONCES B no se adelanta (plan vacío).
4. DADO cadena A→B→C con fechas ajustadas, CUANDO A se completa tarde, ENTONCES B y C se corren y el plan los contiene a ambos en orden topológico.
5. DADO B con dos bloqueantes A1 y A2, ENTONCES manda el **mayor** (basis+gap) de los dos; si A2 no está completo usa su `due_date`.
6. DADO un dependiente **completado**, o **sin due_date**, ENTONCES no participa.
7. DADO un bloqueante sin fecha y sin completar, ENTONCES se ignora ese bloqueante.
8. DADO `start_date` presente, ENTONCES se corre los mismos días; si no hay, queda null.
9. Meses, años bisiestos y cambio de mes: 2028-02-28 +1 = 2028-02-29.
10. Es determinista, no muta su entrada y no depende de `Date.now()`.
`npm test -- lib/tasks/date-rules` en verde.

#### F4 — Completar con corrimientos (RPC atómica)
**Descripción:** `complete_task_with_shifts(p_task_id, p_shifts jsonb, p_expected jsonb)` en 00197. `p_shifts = [{task_id, due_date, start_date?}]`; `p_expected` trae el `updated_at` de cada tarea afectada.
**Criterios:**
- CUANDO se completa con shifts válidos, EL SISTEMA DEBE, en una transacción, marcar `completed`, poner `completed_at`, y actualizar las fechas.
- CUANDO un shift **adelanta** una fecha, o apunta a una tarea completada/ajena/de otro workspace/borrada, EL SISTEMA DEBE abortar **todo** (la tarea no queda completada) con error tipificado.
- CUANDO el `updated_at` esperado no coincide (alguien editó), EL SISTEMA DEBE abortar con `stale` y la UI recalcula el plan.
- CUANDO `p_shifts` es `[]` («dejar como están»), EL SISTEMA DEBE solo completar.
- Una persona sin permiso de edición sobre alguna tarea del plan: toda la operación se rechaza.
- Escribe auditoría (F7). `verify-tasks.mjs` cubre atomicidad (inyectar un shift inválido y comprobar que la tarea sigue pendiente).

#### F5 — Dependencias sin ciclos
**Descripción:** `set_task_blockers(p_task_id, p_blockers jsonb)`.
**Criterios:**
- CUANDO se agrega una dependencia que cierra un ciclo (A→B→C→A, o A→A), EL SISTEMA DEBE rechazarla con error `cycle`.
- CUANDO el vencimiento de la bloqueada es anterior al del bloqueante, EL SISTEMA DEBE rechazar con `date_before_blocker`; mismo día se acepta.
- CUANDO se agrega una dependencia, `gap_days` = due(bloqueada) − due(bloqueante) (≥0); si alguna no tiene fecha, 0.
- Máx. 10 bloqueantes, mismo workspace, sin duplicados.
- Pura en TS `lib/tasks/dependencies.ts` → `wouldCreateCycle`, `computeGap`, con tests (`dependencies.test.ts`: ciclo directo, indirecto, diamante válido, auto-bloqueo).

#### F6 — Limpieza de referencias
**Criterios:**
- CUANDO una persona deja de ser miembro, EL SISTEMA DEBE poner `owner_id = null` y quitarla de `follower_ids` en las tareas de ese workspace (trigger en `workspace_members`).
- CUANDO se llama `delete_task`, EL SISTEMA DEBE poner `deleted_at`, quitar esa tarea de los `blocked_by` de las demás y NO mover fechas.
- Las consultas ignoran `deleted_at IS NOT NULL`.
- Cubierto en `verify-tasks.mjs`.

#### F7 — Auditoría
**Criterios:**
- `AuditEntityType` incluye `task` (cambio solo de TypeScript; `audit_log.entity_type` no tiene CHECK, verificado).
- CUANDO se crea, cambia estado/responsable/fecha/proyecto/dependencias, completa, reabre o borra una tarea, EL SISTEMA DEBE llamar `logAudit` con `changes {old,new}`; acciones del agente con `actor_type='agent'`, de flujos `'system'`/`'webhook'` según corresponda.
- La policy `audit_log_select_tasks` hace que el historial de una tarea lo vea quien `can_see_task_id`. Los demás `entity_type` no cambian de visibilidad (`verify-audit-visibility.mjs` sigue en verde).
- Test `lib/tasks/audit.test.ts`: cada mutación genera la entrada esperada con los campos correctos.

#### F8 — Acciones de servidor y validación
**Archivo:** `lib/actions/tasks.ts` (Server Actions, patrón del repo) + `lib/tasks/schema.ts` (zod).
**Criterios (`lib/actions/tasks.test.ts`):**
- CUANDO se crea con título vacío, > 200 caracteres, estado/prioridad inválidos, fecha mal formada, responsable que no es miembro, seguidores > 20 o `start_date > due_date`, EL SISTEMA DEBE rechazar con mensaje en castellano sin tocar la base.
- CUANDO se actualiza una tarea ajena (no visible), EL SISTEMA DEBE responder error de permiso, no «no existe» distinto, sin filtrar datos.
- Las acciones validan en servidor aunque el cliente ya haya validado.
- Cada acción devuelve `{ok:true,data}` o `{ok:false,error,code}` (nunca lanza al cliente).
- `planCompletion(taskId)` devuelve el plan de fechas para el diálogo; `completeTask(taskId, applyShifts)` ejecuta F4.

#### F9 — Proyectos por texto
**Archivo:** `lib/tasks/project.ts`.
**Criterios (`project.test.ts`):**
- `normalizeProjectKey("  Lanzamiento   Q4 ")` = `"lanzamiento q4"`; acentos y mayúsculas se ignoran (`"Diseño"` ≡ `"diseno"`); vacío → `null`.
- `listProjects(tasks)` agrupa por clave y devuelve el nombre más usado, ordenado alfabéticamente, con conteo de tareas abiertas.
- `shouldOfferCreate(input, projects)` = true solo si la clave normalizada no existe.
- Máx. 80 caracteres; más se recorta o se rechaza (definido: se rechaza).

**Bloque T1 listo cuando:** F1 a F9 cumplen sus criterios, `npm test` sale 0, `node scripts/verify-tasks.mjs` sale 0 contra la base con 00196–00198 aplicadas, `npm run build` compila, `npm run lint` sin errores nuevos y ningún test previo se rompió.

---

### Bloque T2 — Tabla, edición en celda y drawer

> Dependencia nueva aprobada: `@tanstack/react-table` (MIT, ~15 KB, headless). Es la única que se agrega. Sin librería de drag-and-drop (se usa HTML5 nativo como en `components/content/kanban.tsx`).

#### F10 — Vista tabla
**Ruta:** `/dashboard/tareas`.
**Criterios (`lib/tasks/table-model.test.ts`, funciones puras):**
- `buildRows(tasks, members, opts)` produce una fila por tarea con: título, estado, responsable (nombre/avatar), seguidores (conteo), proyecto, vencimiento, prioridad, bloqueada (bool + conteo), origen.
- Orden por columna (asc/desc) estable; por defecto: vencimiento asc con vacías al final, luego prioridad.
- Agrupar por proyecto (grupo «Sin proyecto» último) y por estado.
- `isOverdue(task, todayLocal)` = vencimiento < hoy y no completada; `isBlocked(task, byId)` = tiene algún bloqueante no completado.
- Paginación/virtualización: hasta 500 tareas visibles sin paginar; más → «cargar más» de 100 en 100.

#### F11 — Edición en celda (sin abrir la tarea)
**Criterios (`lib/tasks/cell-edit.test.ts` + acción):**
- Se edita desde la tabla: **estado** (menú), **fecha de vencimiento** (selector de fecha), **responsable** (selector de miembros), **seguidores** (selector múltiple), **proyecto** (combo con existentes + «Crear «…»»), **prioridad** (menú) y **título** (doble clic).
- CUANDO se edita una celda, EL SISTEMA DEBE aplicar el cambio **de forma optimista** y llamar la acción; SI falla, revierte el valor y muestra el error (`applyOptimistic`/`rollback` puros, testeados).
- CUANDO el estado pasa a `completed` y hay dependientes afectados, EL SISTEMA DEBE abrir el diálogo de F13 antes de confirmar.
- CUANDO se cambia la fecha de una tarea bloqueada a una anterior a su bloqueante, EL SISTEMA DEBE rechazar el cambio y revertir con mensaje claro.
- `Esc` cancela la edición; `Enter` confirma; `Tab` pasa a la celda siguiente.
- Un Member sin `tasks.edit` ve las celdas de solo lectura (sin menús).

#### F12 — Drawer de la tarea
**Criterios:**
- CUANDO se hace clic en una fila (o `?task=<id>` en la URL), EL SISTEMA DEBE abrir un drawer a la derecha **más ancho que el `Sheet` actual (`max-w-md`)** — nuevo componente `components/tasks/task-drawer.tsx`, sin cambiar `Sheet`. Mantiene la tabla de fondo.
- `lib/tasks/drawer-url.ts` (patrón de `lib/content/drawer-url.ts`): `parseTaskParam`, `withTaskParam`, `withoutTaskParam` preservan los demás parámetros (test).
- El drawer muestra y edita: título, descripción, estado, prioridad, fechas, responsable, seguidores, proyecto, **bloqueada por** (agregar/quitar con búsqueda de tareas) y **bloquea a** (solo lectura, con enlace), contacto/conversación vinculados, origen, historial (auditoría).
- Cierra con `Esc`, clic en el fondo y botón; vuelve el foco a la fila.
- Si el `id` de la URL no existe o no es visible, EL SISTEMA DEBE mostrar «No encontramos esta tarea» y limpiar el parámetro.
- Cambios del drawer guardan por campo (al salir del campo), con el mismo patrón optimista de F11.

#### F13 — Diálogo de vista previa de fechas
**Criterios (`lib/tasks/shift-preview.test.ts`):**
- CUANDO al completar hay plan no vacío, EL SISTEMA DEBE mostrar una lista «Tarea — fecha actual → fecha nueva (+N días)», agrupada por cadena, con dos botones: «Mover fechas y completar» y «Completar sin mover fechas».
- «Mover…» llama `completeTask(id, true)`; «Completar sin mover…» llama `completeTask(id, false)`. Cerrar el diálogo con `Esc` **no** completa.
- CUANDO la RPC responde `stale`, EL SISTEMA DEBE recalcular y reabrir el diálogo con el plan nuevo.
- `formatShiftLine(...)` puro, con pluralización (1 día / N días).
- Plan vacío → se completa directo, sin diálogo.

#### F14 — Filtros, orden y estado en la URL
**Criterios (`lib/tasks/filters.test.ts`):**
- Filtros: estado (multi), responsable (incluye «Yo» y «Sin responsable»), seguidor, proyecto, prioridad, vencidas, bloqueadas, origen, texto en título.
- Todo el estado de la vista (filtros, orden, agrupación, vista tabla/tablero) se serializa en la URL (`parseViewState`/`serializeViewState` ida y vuelta idénticos, valores inválidos ignorados).
- Reusa `components/ui/filter-menu.tsx` y `popover.tsx`.

#### F15 — Creación rápida y navegación
**Criterios:**
- CUANDO se escribe un título en la fila «+ Nueva tarea» al pie y se pulsa `Enter`, EL SISTEMA DEBE crear la tarea (responsable = quien la crea; proyecto = el del grupo si hay agrupación) y dejar el foco listo para la siguiente.
- Botón «Nueva tarea» abre el drawer con formulario completo.
- `lib/nav/items.ts`: ítem «Tareas» (`/dashboard/tareas`, ícono de lista de verificación) en el **grupo `inicio`**, junto a Bandeja, con `permissions: ["tasks.view"]`. Test en `lib/nav/items.test.ts` (existente o nuevo): aparece para Owner/Admin/Member; no aparece para rol personalizado sin `tasks.view`; el orden de los demás ítems no cambia.
- Estados: vacío (mensaje + botón crear), cargando (skeleton), error (mensaje + reintentar).

**Bloque T2 listo cuando:** F10 a F15 cumplen sus criterios, sus tests pasan (`npm test` sale 0), `npm run build` compila, `npm run lint` sin errores nuevos, `verify-tasks.mjs` sigue en verde y ningún test previo se rompió.

---

### Bloque T3 — Tablero, avisos y superficies

#### F16 — Tablero kanban por estado
**Criterios (`lib/tasks/kanban-model.test.ts`):**
- Tres columnas: Pendiente / En progreso / Completada. `groupByStatus` respeta los filtros de F14 y ordena por `position`.
- Arrastrar una tarjeta a otra columna (HTML5 nativo) cambia el estado de forma optimista con rollback si falla; arrastrar a «Completada» pasa por el diálogo de F13.
- Reordenar dentro de una columna actualiza `position` (`computePosition(prev,next)` puro con fracciones; test de inserción al inicio, medio, final y columna vacía).
- Tarjeta: título, responsable (avatar), vencimiento (rojo si vencida), proyecto, ícono de candado si está bloqueada, contador de seguidores.
- Accesible por teclado: menú «Mover a…» en cada tarjeta (alternativa al arrastre).

#### F17 — Notificaciones (campana)
**Criterios (`lib/tasks/notifications.test.ts`, con `createNotification` simulado):**
- `NOTIFICATION_DEFINITIONS` suma `task_assigned`, `task_follow_added`, `task_changed`, `task_unblocked`, `task_date_moved`, `task_due_today`, `task_overdue` (todos con `entity: "task"`; `NotificationEntity` suma `"task"`; deep-link a `/dashboard/tareas?task=<id>`). Sin migración (la tabla no tiene CHECK de tipo).
- CUANDO se asigna un responsable distinto de quien actúa, EL SISTEMA DEBE crear `task_assigned` para él; al agregar seguidores, `task_follow_added` a cada nuevo.
- CUANDO una tarea seguida cambia (estado, fecha, responsable), EL SISTEMA DEBE crear `task_changed` para responsable y seguidores **excepto el actor**, con tope: no más de 1 `task_changed` SIN LEER por (destinatario, tarea) en 10 minutos (reusar el helper de no-repetición de `lib/notifications/create.ts`).
- CUANDO se completa un bloqueante y una dependiente queda sin bloqueantes pendientes, EL SISTEMA DEBE crear `task_unblocked` para su responsable.
- CUANDO se mueven fechas (F4), EL SISTEMA DEBE crear `task_date_moved` para responsable y seguidores de cada tarea movida.
- Todos con `recipient_id` concreto (nunca null); nunca al actor; nunca lanzan (`createNotification` ya garantiza); un fallo de aviso no revierte la operación.
- `can_see_notification` ya muestra al destinatario sus avisos (`recipient_id = auth.uid()`): `verify-tasks.mjs` lo confirma con un Member.

#### F18 — Cron de vencimientos
**Criterios:**
- 00198 crea `private.enqueue_tasks_due_sweep()`: por workspace, desde las 08:00 locales (`workspaces.timezone`), encola **un** job `tasks_due_sweep` por workspace y día local (`dedupe_key = 'tasks-due:<ws>:<fecha>'`, `ON CONFLICT DO NOTHING`), solo si hay candidatas (no completadas, no borradas, con responsable/seguidores, vencen hoy o están vencidas sin aviso). Una falla en un workspace no frena a los demás. SECURITY DEFINER, `search_path=''`, no ejecutable por usuarios.
- Handler `lib/jobs/handlers/tasks-due-sweep.ts` registrado en `lib/jobs/registry.ts` (con su test de registro): crea `task_due_today` (vence hoy) y `task_overdue` (venció, primera vez) para el responsable (y seguidores en `due_today`), **una vez por tarea y fecha** (dedupe por `type + entity_id + metadata.due_date`).
- DADO un workspace en `America/Costa_Rica`, CUANDO son las 07:59 locales, ENTONCES no encola; a las 08:00 sí (test de la función de ventana `isSweepWindow(now, tz)` pura).
- Tests: `tasks-due-sweep.test.ts` (idempotencia: correrlo dos veces no duplica avisos) + `verify-tasks.mjs` (la función encola 1 job por workspace/día).
- NO se usa `call_app_cron` ni se agrega ruta en `app/api/cron/` (`lib/cron-config.test.ts` queda intacto).

#### F19 — «Mis tareas»
**Criterios:**
- Atajo en la barra de la vista: «Mis tareas» = responsable=yo y estado≠completada, ordenado por vencimiento. Es un estado de URL (F14), no una ruta aparte.
- Contadores en la cabecera: vencidas, vencen hoy, próximas 7 días (`summarizeMine(tasks, todayLocal)` puro, test).

#### F20 — Tareas en contacto y bandeja
**Criterios:**
- En la ficha del contacto: sección «Tareas» con las abiertas y completadas recientes de ese contacto, botón «Agregar tarea» (precarga `contact_id`), edición mínima en línea (estado, fecha) y enlace al drawer. Respeta la visibilidad (el Member solo ve las que le corresponden).
- En la bandeja, acción «Crear tarea» sobre la conversación: precarga `contact_id` y `conversation_id` y un título sugerido «Dar seguimiento a <contacto>» editable.
- Una tarea con contacto muestra el contacto en la tabla y el drawer; si el contacto se elimina/fusiona, el vínculo se mantiene vía los mecanismos existentes (`contact_id` con `ON DELETE SET NULL`; la fusión de contactos de `find_or_link_contact` NO se modifica: el builder verifica si hay un punto de fusión que reapunte tablas hijas y, si existe, lo documenta en `docs/PENDIENTE-tareas.md` en vez de tocarlo).
- No se modifica ninguna otra pantalla de la bandeja más allá del botón.

#### F21 — Mobile
**Criterios:**
- A 390 px: la tabla se muestra como **lista de tarjetas** (título, estado, vencimiento, responsable); edición de estado/fecha desde un menú; el drawer ocupa toda la pantalla; el kanban se vuelve columnas con scroll horizontal **dentro** del tablero (la página no hace scroll horizontal).
- `selectLayout(width)` puro (`<768` lista, `≥768` tabla) con test.

**Bloque T3 listo cuando:** F16 a F21 cumplen sus criterios, `npm test` sale 0, `verify-tasks.mjs` sale 0 (con 00198 aplicada), `npm run build` compila, lint sin errores nuevos y ningún test previo se rompió.

---

### Bloque T4 — Origen automático

#### F22 — Acción de flujo «Crear tarea»
**Criterios:**
- Nuevo nodo `create_task` en `lib/flow-engine/nodes/` registrado en `registry/nodes.ts` (patrón `notify-team.ts`), `needsContact: false` (sirve con y sin contacto; con contacto, lo vincula).
- Campos: título (con variables `{{...}}` vía `interpolateVariables`), descripción, responsable (persona fija, «quien envió el reporte» o nadie), seguidores, proyecto, prioridad, vencimiento (fecha fija o «+N días desde hoy»).
- CUANDO se ejecuta, EL SISTEMA DEBE crear la tarea con `source='flow'` y `source_ref = flow_id:run_id`; si no hay título tras interpolar, no crea y registra advertencia (no frena el flujo); si el responsable no es miembro del workspace, queda sin responsable y se avisa a los Owner/Admin.
- **Nunca lanza**: un fallo al crear la tarea no corta el flujo (test: error simulado → el flujo continúa).
- Idempotencia: el mismo `(flow_run, nodo)` no crea dos veces (`source_ref` único por tarea abierta; test).
- Tests: `create-task.test.ts` (campos, variables, error, idempotencia) y `registry-characterization.test.ts` / `consistency.test.ts` existentes siguen en verde (se actualizan **solo** con el nodo nuevo).

#### F23 — Tool del agente `crear_tarea`
**Archivo:** `lib/agent/tools/create-task.ts`, registrada como las demás (`registerAgentTool`).
**Criterios (`create-task.test.ts`):**
- Input (zod): `titulo` (3–200), `descripcion?`, `dias?` o `fecha?` (AAAA-MM-DD), `motivo`.
- Responsable: **persona asignada a la conversación → setter → vendedor → ninguno** (si ninguno, se avisa a Owner/Admin con un aviso a cada uno por `recipient_id` concreto).
- Límites: máx. **3** tareas por conversación; si ya hay una tarea **abierta similar** (misma conversación y título normalizado igual o contenido), devuelve `forModel` «ya existe» y no crea otra.
- `source='agent'`, `source_ref = run_id`, auditoría con `actor_type='agent'` y `performed_by_agent_id`.
- `configSchema`: `maxPerConversation` (default 3), `defaultDueDays` (default 2). Aparece en la pantalla de herramientas del agente como las demás (`configFields`).
- No toca `contacts.next_followup_date` ni `programar_seguimiento` (test de que no la modifica).
- `registry.test.ts` existente en verde (se actualiza solo con la herramienta nueva si cuenta herramientas).
- Disponible solo si el agente la habilitó (`allowedTools`), igual que el resto.

#### F24 — Tarea al escalar (opcional, apagada por defecto)
**Criterios:**
- Ajuste del agente «Crear una tarea cuando derive a una persona» (default **apagado**). Si está encendido, CUANDO el agente escala (`needs_human` / herramienta `escalate`), EL SISTEMA DEBE crear una tarea `source='agent'` vinculada a la conversación, con el responsable por el mismo orden de F23, **sin cambiar** el flujo de escalamiento ni sus avisos actuales.
- Apagado: el comportamiento de escalamiento es idéntico al actual (test de caracterización existente en verde).
- Si crear la tarea falla, el escalamiento sigue (test).

#### F25 — Disparadores de flujo `task_completed` y `task_overdue`
**Criterios:**
- 00199 amplía `triggers_type_check` (el builder copia la lista vigente del último CHECK aplicado, no la de 00155).
- Nuevos triggers en `lib/flow-engine/registry/task-triggers.ts` (patrón `sales-triggers.ts`/`call-triggers.ts`), registrados en `triggers.ts`: `task_completed` (con filtro opcional por proyecto/origen) y `task_overdue`. Son flujos **con o sin contacto** (usan el contacto de la tarea si lo tiene).
- Se emiten al completar (`completeTask`) y desde el handler del cron (F18), vía el mismo emisor de eventos de automatización que usan Ventas/Llamadas, **sin bloquear** la operación de origen (try/catch, patrón «events never break origin»).
- Tests: `task-triggers.test.ts` (match con/sin filtro) + `triggers-characterization.test.ts` y `consistency.test.ts` en verde (se actualizan solo con los dos triggers).
- Si durante la construcción 00199 resulta de riesgo desproporcionado, el builder construye F22–F24 y deja F25 documentada en `docs/PENDIENTE-tareas.md` (no es bloqueante para el cierre de la fase).

#### F26 — Origen visible y robustez
**Criterios:**
- La tabla y el drawer muestran el origen («Manual», «Flujo: <nombre>», «Agente», «CX») con enlace al flujo/conversación cuando existe (`formatSource` puro, test).
- Los filtros de F14 permiten filtrar por origen.
- Ninguna creación automática (flujo/agente) puede romper su origen: en `lib/tasks/create-from-automation.ts` toda excepción se captura y se registra con `console.error('[tareas] ...')`.

**Bloque T4 listo cuando:** F22 a F26 cumplen sus criterios (F25 puede quedar documentada como pendiente solo en el caso descrito), `npm test` sale 0, `verify-tasks.mjs` sale 0, `npm run build` compila, lint sin errores nuevos y ningún test previo se rompió.

---

### Definición de «listo» global de la fase
Los cuatro bloques listos; `npm test` completo en verde; `node scripts/verify-tasks.mjs` y los `verify-*` existentes relevantes (`verify-audit-visibility.mjs`) en verde contra la base con 00196–00198 (y 00199 si aplica) aplicadas; `npm run build` compila; `npm run lint` sin errores nuevos; `docs/PROGRESS-tareas.md` actualizado y los bloqueos anotados en `docs/PENDIENTE-tareas.md`.

### Funcionalidades de fases siguientes (no se construyen ahora)
- F-futura-1: Tabla `projects` (dueño, estado, fechas) — posterior.
- F-futura-2: Subtareas, recurrencia, comentarios, adjuntos — posterior.
- F-futura-3: Aviso por email/WhatsApp — posterior.
- F-futura-4: «Tarea con SLA» desde CX — CX Fase 2.
- F-futura-5: Tareas desde el Asistente — fase Asistente.
- F-futura-6: Vista calendario / Gantt — posterior.

---

## 7. Flujos principales

### Flujo A — Completar una tarea que bloquea a otra
1. La persona cambia el estado de A a «Completada» desde la celda (o arrastra a la columna).
2. El sistema llama `planCompletion(A)` → `computeDateShifts`.
3. Plan vacío → se completa de inmediato y se avisa a quien corresponda (`task_unblocked`).
4. Plan con corrimientos → diálogo de vista previa.
   - «Mover fechas y completar» → `complete_task_with_shifts` (atómica) → avisos `task_date_moved` + `task_unblocked`.
   - «Completar sin mover fechas» → solo completa.
   - Cerrar el diálogo → no pasa nada.
5. Si la RPC devuelve `stale`, se recalcula y vuelve al paso 4.
**Resultado:** A completada; fechas coherentes o decisión explícita de no moverlas. **Errores:** permiso → mensaje y rollback visual; fallo de red → rollback y reintentar.

### Flujo B — Crear tarea desde la tabla con proyecto nuevo
1. Escribe el título en «+ Nueva tarea», Enter → se crea.
2. Clic en la celda Proyecto, escribe «Lanzamiento Q4».
3. Si la clave normalizada existe, se ofrece el existente; si no, «Crear «Lanzamiento Q4»».
4. Elige → se guarda `project` + `project_key`.

### Flujo C — Asignar y seguir
1. Cambia el responsable en la celda → `task_assigned` al nuevo (si no es el actor).
2. Agrega seguidores → `task_follow_added` a cada uno.
3. Después, cada cambio de estado/fecha de esa tarea genera `task_changed` (con tope).

### Flujo D — Agente crea una tarea
1. En una conversación, el lead pide «que me llame un asesor mañana».
2. El agente (con `crear_tarea` habilitada) llama la herramienta con motivo y `dias=1`.
3. El sistema resuelve el responsable (asignado → setter → vendedor → ninguno), verifica el tope y duplicados, crea la tarea con `source='agent'`, audita y avisa al responsable.
4. Sin responsable: aviso individual a cada Owner/Admin.

### Flujo E — Vencimientos
1. Cada hora el cron revisa; desde las 08:00 locales de un workspace con candidatas, encola 1 job del día.
2. El handler crea `task_due_today` / `task_overdue` una sola vez por tarea y fecha.

### Flujo F — Editar una fecha de tarea bloqueada
1. Cambia el vencimiento de B (bloqueada por A).
2. Si queda antes del de A → se rechaza. Si no, se actualiza y se recalcula `gap_days` de esa dependencia.

---

## 8. Modelo de datos

### Tabla nueva: `tasks`
| Campo | Tipo | Req. | Descripción |
|---|---|---|---|
| id | uuid PK default gen_random_uuid() | Sí | |
| workspace_id | uuid → workspaces ON DELETE CASCADE | Sí | |
| title | text CHECK (char_length 1..200) | Sí | |
| description | text CHECK (≤5000) | No | |
| status | text CHECK in (pending,in_progress,completed) default pending | Sí | |
| priority | text CHECK in (low,normal,high,urgent) default normal | Sí | |
| start_date | date | No | |
| due_date | date | No | En zona del workspace |
| completed_at | timestamptz | No | Se pone al completar; se borra al reabrir |
| owner_id | uuid → auth.users ON DELETE SET NULL | No | Responsable principal |
| follower_ids | uuid[] default '{}' | Sí | Seguidores (máx. 20) |
| project | text | No | Como lo escribió la primera vez |
| project_key | text | No | Normalizado (minúsculas, sin acentos) |
| blocked_by | jsonb default '[]' | Sí | `[{task_id, gap_days}]` (máx. 10) |
| contact_id | uuid → contacts ON DELETE SET NULL | No | |
| conversation_id | uuid → conversations ON DELETE SET NULL | No | |
| source | text CHECK in (manual,flow,agent,cx) default manual | Sí | |
| source_ref | text | No | flow:run, run_id del agente, o id CX |
| position | double precision default 0 | Sí | Orden dentro de columna en el kanban |
| created_by | uuid → auth.users ON DELETE SET NULL | No | |
| created_at / updated_at | timestamptz default now() | Sí | `updated_at` con trigger (patrón del repo) |
| deleted_at | timestamptz | No | Soft delete |

**Índices:** `(workspace_id, status, due_date) WHERE deleted_at IS NULL`; `(workspace_id, owner_id) WHERE deleted_at IS NULL`; GIN en `follower_ids`; `(workspace_id, project_key)`; `(contact_id)`; GIN en `blocked_by jsonb_path_ops`; único parcial `(workspace_id, source, source_ref) WHERE source IN ('flow','agent') AND source_ref IS NOT NULL AND status <> 'completed' AND deleted_at IS NULL` (idempotencia F22/F23).
**RLS:** SELECT `can_see_task(tasks)`; INSERT/UPDATE por miembros con `tasks.edit` que además `can_see_task`; sin DELETE directo.
**Funciones:** `can_see_task(tasks)`, `can_see_task_id(uuid)` (espejo de `can_see_call` / `can_see_call_id` — el builder copia el patrón exacto del alcance `own|all` de esa función), `complete_task_with_shifts`, `set_task_blockers`, `delete_task`, `private.enqueue_tasks_due_sweep`.

### Notas de optimización
- **Una sola tabla**: proyecto, seguidores y dependencias viven en `tasks`. Costo asumido: no hay FK sobre los arrays → la integridad la sostienen F6 (limpieza) y las RPC. Migrar a `projects`/`task_followers`/`task_links` es un backfill directo.
- Se reutilizan `notifications`, `audit_log`, `scheduled_jobs`, `workspace_members` y `workspaces.timezone`.
- Campos para el futuro ya presentes: `source='cx'`, `source_ref`, `position`.

### Políticas de datos
- **Soft delete:** `deleted_at` (vía `delete_task`).
- **Auditoría:** `created_by`, `created_at`, `updated_at` + `audit_log` con `changes {old,new}`.
- **Snapshots:** no aplica.

---

## 9. Arquitectura del sistema
- **Frontend:** Next.js 16 App Router, Server Components para la carga inicial; componentes cliente para tabla, tablero y drawer. Estado de vista en la URL.
- **Backend:** Server Actions (`lib/actions/tasks.ts`); las operaciones atómicas son RPC en Postgres.
- **Base de datos:** Supabase Postgres con RLS; reglas que no pueden quedar a medias en funciones SQL (no en el cliente).
- **Jobs:** `scheduled_jobs` + `lib/jobs/registry.ts` + cron SQL (patrón 00167).
- **Integraciones externas:** ninguna nueva.
- **Auth:** la existente.
- **Archivos:** no aplica.

Diagrama conceptual: `UI (tabla/kanban/drawer) → Server Actions → (lógica pura lib/tasks) → Supabase (tasks + RPC) → notifications / audit_log`; `Flows y Agente → create-from-automation → misma capa`; `pg_cron → enqueue_tasks_due_sweep → scheduled_jobs → handler → notifications`.

## 10. Stack y decisiones técnicas

| Componente | Tecnología | Justificación |
|---|---|---|
| Frontend | Next.js 16 / React 19 / Tailwind v4 | Stack del repo |
| Tabla | `@tanstack/react-table` (MIT) | Única dependencia nueva; headless, ~15 KB, sin estilos impuestos |
| Drag & drop | HTML5 nativo | Igual que `components/content/kanban.tsx`; sin dependencia |
| Estado global | Ninguno (hooks + URL) | Regla del repo (sin Redux/Zustand) |
| Base de datos | Supabase Postgres + RLS | Stack |
| Tests | Vitest 3 + `verify-*.mjs` | Lo que el repo ya tiene |
| Deploy | Railway | Sin cambios |

## 11. Pantallas

### 11.1 Convenciones globales
- Navegación: ítem «Tareas» en el grupo `inicio` del sidebar.
- Sistema visual: componentes existentes (`components/ui/*`, `filter-menu`, `popover`); colores de estado coherentes con el resto (info/warning/success).
- Estados estándar: vacío con CTA «Crear tu primera tarea», skeleton al cargar, error con «Reintentar», confirmaciones con el toast existente.
- Responsive: ≥768 px tabla; <768 px lista de tarjetas; sin scroll horizontal de página a 390 px.
- Textos en castellano neutro, tono directo.

### 11.2 Detalle

#### Bloque T2

##### Pantalla: Tareas (tabla)
- **Propósito:** ver y editar el trabajo del equipo sin abrir cada tarea.
- **URL:** `/dashboard/tareas` (+ `?task=<id>`, `?view=table|board`, filtros).
- **Layout:** cabecera (título, contadores «Mis tareas», botón «Nueva tarea», selector Tabla/Tablero), barra de filtros, tabla, fila «+ Nueva tarea».
- **Componentes:** columnas Estado, Título, Responsable, Seguidores, Proyecto, Vencimiento, Prioridad, Bloqueada, Origen; agrupación opcional.
- **Estados:** con datos / vacío (CTA) / cargando (skeleton) / error (reintentar).
- **Interacciones:** clic en celda editable abre su editor; doble clic en título edita en sitio; clic en el resto de la fila abre el drawer; `Esc` cancela, `Enter` confirma.
- **Reglas:** `tasks.view` para entrar; `tasks.edit` para editar; vencidas en rojo; bloqueadas con candado.
- **Responsive:** lista de tarjetas.

##### Pantalla: Drawer de tarea
- **Propósito:** ver y editar todo de una tarea.
- **Layout:** panel derecho ancho (~560–640 px desktop), cabecera con título editable y estado; secciones: Detalles, Personas, Proyecto, Dependencias, Vínculos, Historial.
- **Interacciones:** guardado por campo; agregar/quitar bloqueantes con búsqueda; botón «Borrar» (solo con `tasks.delete`) con confirmación.
- **Reglas:** solo lectura sin `tasks.edit`; errores de fechas de dependencias en línea.
- **Responsive:** pantalla completa.

##### Diálogo: Mover fechas
- Lista de cambios (tarea, fecha actual → nueva, +N días), dos botones, cierre sin efecto.

#### Bloque T3

##### Pantalla: Tareas (tablero)
- Tres columnas, tarjetas arrastrables, menú «Mover a…», mismos filtros y mismo drawer. Mobile: columnas con scroll interno.

##### Campana
- Siete tipos nuevos con texto claro («María te asignó «Enviar propuesta»», «Se movió la fecha de «X» al 14/10»…). Clic abre `?task=`.

##### Ficha de contacto / Bandeja
- Sección «Tareas» y botón «Crear tarea» (ver F20).

## 12. Guías de UI
Diseño del sistema existente (white-label: colores de la marca del workspace). Prioridad a acciones en un clic; sin modales para formularios largos (para eso está el drawer); feedback inmediato (optimista) con rollback visible; nunca perder lo escrito si falla un guardado.

## 13. Fuera del alcance de esta fase

| Funcionalidad | Destino | Nota |
|---|---|---|
| Tabla `projects` | Posterior | Hoy proyecto = texto |
| Subtareas, recurrencia, comentarios, adjuntos, etiquetas, tiempo | Posterior | |
| Email / WhatsApp / push | Posterior | Solo campana |
| Tarea con SLA (CX) | CX Fase 2 | `source='cx'` reservado |
| Tareas desde el Asistente | Fase Asistente | |
| Calendario / Gantt | Posterior | |
| Adelantar fechas automáticamente | Fuera del proyecto | Decisión 279 |
| Saltar fines de semana / feriados | Fuera de esta versión | Días corridos |
| Modificar `contacts.next_followup_date` / `programar_seguimiento` | No se toca | Convive |
| Cambios en `find_or_link_contact`, `record_contact_touch`, `create_booking`, tablas CX/Ventas/Gastos, `ai_task_prompt_versions` | No se tocan | |

## 14. Decisiones transversales

| Decisión | Definición |
|---|---|
| Historial y auditoría | `audit_log` por mutación; historial visible en el drawer a quien ve la tarea |
| Soft delete | `deleted_at` vía `delete_task` |
| Deduplicación de contactos | No aplica; `contact_id` usa los contactos existentes |
| Snapshot de precios | No aplica |
| Estados | `pending → in_progress → completed`; cualquier transición permitida (incl. reabrir); reabrir no deshace corrimientos |
| Casos borde | Dos personas editan a la vez: la RPC compara `updated_at` (`stale`); en campos simples gana el último guardado. Cerrar la ventana en mitad de un diálogo de fechas: no se completa. Sin red: rollback y mensaje |
| Zona horaria / idioma | Fechas sin hora en la zona del workspace (`workspaces.timezone`); «hoy» siempre local; castellano |
| Motor de automatización | Nodo `create_task` y triggers (F22, F25) |
| Modelo de asignación | Responsable único + seguidores, manual; el agente usa asignado → setter → vendedor → ninguno |
| Contacto cross-canal | No aplica |
| BYOK / secrets | No aplica |
| Webhooks / broadcasts | No aplica |

## 14b. Seguridad

| Área | Definición |
|---|---|
| Autenticación | La existente |
| RLS | `tasks`: SELECT `can_see_task`; INSERT/UPDATE con `tasks.edit` y visibilidad; sin DELETE directo. Funciones `SECURITY DEFINER` con `SET search_path = ''`, validan membresía y permiso dentro de la función y filtran por workspace |
| Validación | zod en servidor siempre (F8); límites de longitud y cantidad |
| API | Server Actions autenticadas; sin endpoints públicos nuevos |
| Datos sensibles | Ninguno nuevo; los avisos no llevan PII de más (nombre de tarea y de persona) |
| Ataques | Texto plano en descripción (React escapa; nunca `dangerouslySetInnerHTML`); sin URLs de redirección; IDs siempre verificados contra el workspace |

### Checklist para la IA constructora
- [ ] RLS habilitado en `tasks` y policies testeadas en `verify-tasks.mjs` (Owner, Admin, Member creador/responsable/seguidor/ajeno, otro workspace)
- [ ] Funciones SECURITY DEFINER con `search_path=''` y chequeo de permiso interno
- [ ] Validación zod en servidor para toda mutación
- [ ] `owner_id`/`follower_ids` solo de miembros del workspace
- [ ] Sin secrets nuevos ni variables de entorno nuevas
- [ ] Avisos sin datos sensibles; `recipient_id` siempre concreto
- [ ] `lib/cron-config.test.ts` intacto
- [ ] Sin `dangerouslySetInnerHTML`

## 14c. Base técnica heredada (fork)
- **Base:** fork de ZernFlow (white-label, un clon por cliente). Next.js 16, React 19, TS 5, Tailwind v4, Supabase, AI SDK v6, Vitest 3.
- **Migraciones existentes:** hasta `00195_ads_crm_metrics.sql`. Convención `000NN_nombre.sql`, idempotentes, encabezado «Como volver atras», regenerar `ALL_MIGRATIONS.sql` con `node scripts/build-all-migrations.mjs`.
- **Ya implementado (NO reconstruir):** `notifications` + `createNotification` + campana; `audit_log` + `logAudit`; `scheduled_jobs` + registry + crons SQL; permisos y alcances; flujos (nodos/triggers); herramientas del agente; `Sheet`, `Popover`, `FilterMenu`, kanban nativo, patrón drawer-en-URL.
- **Patrones a seguir:** Server Components + hooks, mutaciones por Server Actions, RLS en la base, lógica de pantalla en funciones puras testeables.
- **Nuevo en dependencias:** solo `@tanstack/react-table`.

## 14e. Brownfield — impacto sobre lo existente

**Archivos existentes que se modifican (cambios mínimos y aditivos):**
`lib/auth/permissions.ts` (+3 claves, +módulo, +alcance) y su test de Member · `lib/types/database.ts` (`AuditEntityType` +`task`, tipos de `tasks`) · `lib/notifications/types.ts` (+7 tipos, +entidad `task`) · `lib/nav/items.ts` · `lib/jobs/registry.ts` · `lib/flow-engine/registry/nodes.ts` y `triggers.ts` · `lib/agent/tools/index.ts` (alta de la herramienta) · ficha de contacto y botón en la bandeja · `package.json` (+1 dependencia) · `ALL_MIGRATIONS.sql` (regenerado).

**Qué NO se puede romper (tests que deben seguir en verde):** `member-baseline.test.ts` (actualizado solo con las claves nuevas), `registry-characterization`, `triggers-characterization`, `consistency`, `lib/agent/tools/registry.test.ts`, `lib/cron-config.test.ts`, `verify-audit-visibility.mjs`, todo `npm test` previo.

**Estado de partida:** rama de trabajo nueva desde la rama base vigente; el repo tiene worktrees antiguos en `.claude/worktrees/` (no usarlos). El builder confirma rama base y numeración de migraciones antes de empezar.

---

## 14f. Verificación en vivo (después de construir — requiere una persona)
No entra en la Definición de listo. Se hace con el usuario y se anota en `docs/PENDIENTE-tareas.md` si no se pudo:
1. Con dos usuarios reales (Admin y Member): el Member solo ve lo suyo; recibe la campana al ser asignado.
2. Completar un bloqueante con fecha vencida y ver el diálogo de corrimiento en la UI real.
3. Un flujo real con «Crear tarea» y una conversación real donde el agente use `crear_tarea`.
4. Esperar (o forzar) el barrido de las 08:00 locales y ver los avisos de vencimiento.
5. Recorrido visual en escritorio y a 390 px (estados vacío/error, sin scroll horizontal) — si hay sesión iniciada; Claude Code no ingresa credenciales.

## 15. Notas y pendientes

**Decisiones que tomó el redactor (confirmar o corregir):**
1. `start_date` se corre junto con `due_date` al aplicar la regla.
2. Member: `tasks.view` + `tasks.edit`, sin `tasks.delete`.
3. «Tareas» va en el grupo `inicio` del menú.
4. Límites: 20 seguidores, 10 bloqueantes, título 200, descripción 5000, proyecto 80.
5. Avisos de vencimiento: una vez por tarea y fecha; barrido desde las 08:00 locales.
6. Tope de `task_changed`: 1 sin leer por destinatario/tarea cada 10 minutos.
7. F25 (triggers de flujo) y F24 (tarea al escalar) incluidos; F25 puede diferirse si 00199 resulta riesgosa.

**Supuestos NO verificados en el código (el builder los comprueba primero):**
- Nombre exacto del helper de «no repetir aviso» en `lib/notifications/create.ts`.
- Patrón exacto del alcance `own|all` en `can_see_call` (se copia).
- Última definición vigente de `triggers_type_check` (puede ser posterior a 00155).
- Si hay un punto de fusión de contactos que reapunte tablas hijas.
- Que `workspace_members` admite un trigger AFTER DELETE sin conflicto con otros.

**Necesario de Wendy antes de construir:** aprobar la sección 2 (migraciones), confirmar las 7 decisiones de arriba y que se pueda instalar `@tanstack/react-table`.

**Cambios a reflejar en documentos anteriores:** `alcance-v10.md` ya es coherente; si el builder corre la numeración de migraciones, actualizar la sección «Tablas» del alcance.

### Chequeo de sincronía con `alcance-v10`
Bloques T1–T4, decisiones #273–#297, regla de fechas y límites coinciden. Diferencias deliberadas: numeración definitiva de migraciones (00196–00199), 00199 separada de las otras por su riesgo, y el nodo de flujo con `needsContact:false`.

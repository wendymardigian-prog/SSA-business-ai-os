# Progreso — Extra A: Sistema de Tareas (T1–T4)

Rama: `feat/tareas` (desde `origin/main` 68bbf6a). Plano: [requerimientos-tareas.md](requerimientos-tareas.md). Pendientes: [PENDIENTE-tareas.md](PENDIENTE-tareas.md).

## Estado

- [x] **T1 — Base y reglas** (13/10/2026): [x] F1 tabla/RLS · [x] F2 permisos · [x] F3 fechas (pura) · [x] F4 completar con corrimientos · [x] F5 dependencias · [x] F6 limpieza · [x] F7 auditoría · [x] F8 acciones/zod · [x] F9 proyectos
- [ ] **T2 — Tabla, celda y drawer**: [ ] F10 tabla · [ ] F11 edición en celda · [ ] F12 drawer · [ ] F13 diálogo de fechas · [ ] F14 filtros/URL · [ ] F15 creación rápida y menú
- [ ] **T3 — Tablero, avisos y superficies**: [ ] F16 kanban · [ ] F17 notificaciones · [ ] F18 cron de vencimientos · [ ] F19 Mis tareas · [ ] F20 contacto y bandeja · [ ] F21 mobile
- [ ] **T4 — Origen automático**: [ ] F22 nodo create_task · [ ] F23 tool crear_tarea · [ ] F24 tarea al escalar · [ ] F25 triggers task_* (también sin contacto) · [ ] F26 origen visible y robustez
- [ ] Cierre: docs/tareas.md · flow-registry.md · CLAUDE.md · PR

## Migraciones (plano → número real)

| Plano | Real | Estado |
|---|---|---|
| 00196 | 00196_tasks | **aplicada y registrada** (version 20261013165449), verificada. Corregida el mismo dia: `can_see_task` devolvia NULL con `owner_id`/`created_by` nulos; ahora siempre true/false (COALESCE) |
| 00197 | 00197_tasks_functions | **aplicada y registrada**, verificada. Guardas de las RPC con COALESCE |
| 00198 | 00198_tasks_due_cron | pendiente |
| 00199 | 00199_task_trigger_types | pendiente |

## Punto de partida (13/10/2026, sobre origin/main)

- `npx vitest run`: 779 archivos, 9.770 tests, 0 fallas.
- `npx eslint .`: 0 errores, 36 warnings (no pueden aumentar).
- `next build`: compila.
- `scripts/verify-*.mjs`: sin correr todavía (escriben datos `zz-test-` en la base real); se corren de a uno al arrancar la ejecución y se anota acá.
- Base: última migración `00195_ads_crm_metrics`; `00196` libre.
- **`verify-*.mjs` (medido antes de tocar nada)**: en verde 21 de 26. **Ya fallaban**: `verify-attribution` (1: «todos los contactos reales tienen first_touch», 781 de 840, depende de datos reales), `verify-publishing` (2: «una publicacion sin aviso se pone al dia preguntando» y «ahi si la pieza queda publicada»), `verify-webhook` (necesita la app corriendo en localhost:3000). `verify-workspace-isolation` pasa con `--despues-de-00143`. Con flags: rls `--despues-de-00143`, roles `--despues-de-00136`, audit-visibility `--despues-de-00168`.

---

# Plan aprobado (tal cual)

## Plan — Extra A: Sistema de Tareas (T1–T4)


## Contexto

SSA necesita un sistema de tareas del equipo (responsable, seguidores, proyecto como texto, dependencias con regla de fechas, tabla + tablero + drawer, avisos en la campana, creación desde flujos y desde el agente). Se construye antes del Asistente y de CX Fase 2 para que tengan un destino común de "algo por hacer". Una sola tabla nueva: `tasks`. Es un sistema en producción: se agrega, no se reescribe.

**Decisión tomada con vos:** los triggers `task_completed` / `task_overdue` (F25) funcionan **también sin contacto** (ver §4, T4).

---

## 1. Punto de partida (medido hoy, sobre `origin/main`)

| Chequeo | Resultado |
|---|---|
| `npx vitest run` | ✅ 779 archivos, 9.770 tests, 0 fallas |
| `npx eslint .` | ✅ 0 errores, 36 warnings (los de siempre; no pueden aumentar) |
| `next build` | ✅ compila (la primera vez falló solo por un symlink de `node_modules` en mi copia de prueba, no por el código) |
| `scripts/verify-*.mjs` (28) | ⏳ **No corridos todavía**: escriben datos de prueba (`zz-test-`) en la base real y el modo plan no lo permite. Se corren de a uno, en serie, al arrancar la ejecución, y se anota el estado en PROGRESS. Lo que ya falle se anota; no puede empeorar |
| Base de datos | `list_migrations`: última = `00195_ads_crm_metrics`. **`00196` libre.** Ninguna rama local/remota usa 00196+ |

## 2. Diferencias entre el plano y el código real (gana el código)

1. **Rama.** El plano y tu mensaje dicen que ya estoy en `feat/tareas`. No: estoy en `main` y mi `main` local está **10 commits atrás** de `origin/main` (falta el Extra L: migraciones 00186–00195). → Crear `feat/tareas` desde `origin/main` actualizado.
2. **Documentos de contexto.** `claude/v10/alcance-v10.md`, `investigacion-sistema-tareas.md` y `claude/v10/requerimientos-tareas.md` **no existen en el repo**. Solo está el plano en Descargas (lo leí completo). Se copia el plano a `docs/requerimientos-tareas.md` para que viva en el repo. Si querés que lea los otros dos, pasámelos.
3. **`member-baseline.test.ts` no lista las claves del Member.** Esa lista exacta está en `lib/auth/member-permissions-characterization.test.ts` (L22-41; scopes en L45 y L52). `member-baseline.test.ts` sí tiene la lista exacta de nombres de menú visibles para un Member (L301-322) y `PERMISSION_PAGES`. Se actualizan **los dos**, solo con lo nuevo.
4. **`has_permission()` es siempre `false` para el Member de sistema** (sus claves viven solo en TypeScript). El plano dice "INSERT/UPDATE por miembros con `tasks.edit`": en SQL hay que usar el patrón de `00150_forms_core.sql:199-212` (`role_id IS NULL OR system_role='member' OR has_permission(...)`). Si no, un Member no podría ni crear tareas.
5. **El alcance `tasks` suma más archivos que los de §14e del plano.** Agregar `"tasks"` a `SCOPED_MODULES` obliga a tocar donde los scopes están escritos a mano: `lib/auth/roles-admin.ts`, `components/settings/roles/roles-view.tsx` (etiquetas y selector), `parsePermissions`, y fixtures de `roles-admin.test.ts`, `permissions.test.ts`, `settings/permissions-characterization.test.ts`. Solo aditivo.
6. **El job no se registra en `lib/jobs/registry.ts`** sino en `lib/publishing/bootstrap.ts` (`registerXxxHandler()`), y `bootstrap-characterization.test.ts` lista los 25 tipos exactos: se suma `tasks_due_sweep` en orden alfabético.
7. **El helper de no-repetir** se llama `createNotificationOnce` (`lib/notifications/create.ts`, `withinMinutes`, `perRecipient`) y compara solo avisos **sin leer**. Sirve para `task_changed` (10 min, por destinatario). Los avisos de vencimiento "una vez por tarea y fecha" no se pueden hacer con él: se consulta `notifications` por tipo + `entity_id` + `metadata.due_date` (patrón de `eod-reminder.ts:49`).
8. **`can_see_notification`** deja ver a un Member solo avisos con `recipient_id = él` (o de contacto/conversación). Los 7 tipos van siempre con `recipient_id` concreto → funciona sin migración. Falta un `case "task"` en `linkFor()` (deep link a `?task=`).
9. **El cron de 00167 deduplica solo jobs `pending`**: una vez completado, la siguiente corrida horaria puede encolar la misma clave. El handler tiene que ser idempotente (lo es por el dedupe de avisos, F18).
10. **Toasts:** no hay `sonner`; el toast existente es de Contenido (`components/content/drawer/toast.tsx`, `lib/content/toast.ts`) y no está montado global. Se reutiliza esa lógica pura montando su `ToastProvider` en la pantalla de Tareas (sin tocar Contenido).
11. **No hay selector de miembros ni date picker reutilizables.** Selector de miembro = `FilterMenu` + `MenuOption` + `Avatar` (patrón `author-menu.tsx`); fechas = `<input type="date">` nativo con `dateInputToIso/isoToDateInput` de `lib/dates.ts`. "Hoy local" = `todayInputValue(now, tz)` con `resolveViewerTimezone`.
12. **`Sheet` es fijo `max-w-md`**; el drawer ancho de Contenido (`components/content/drawer/drawer.tsx`, 560/900 px, con trampa de foco) es la referencia para `task-drawer.tsx`. `drawer-url.ts` tiene la base `/dashboard/content` escrita fija → `lib/tasks/drawer-url.ts` propio.
13. **Kanban nativo de Contenido no usa `dataTransfer`** (el id arrastrado va en estado React) y usa `useOptimistic`. Se sigue ese patrón.
14. **Flujos: el plano pide "actualizar solo con lo nuevo"** — los tests que se rompen al sumar (todos se actualizan solo con el elemento nuevo): `registry.test.ts:51` (29→30 nodos), `consistency.test.ts` (lista contact-free, `TriggerPanel` `triggerTypes`, simulador debe nombrar `create_task`), `triggers-characterization.test.ts:41` (cantidad de triggers; y L84-101 si cambia el `subject`), `crm-triggers.test.ts:148/175` (listas de event/scheduled), `agent/tools/registry.test.ts:14` (nombres de herramientas). Además hay que sumar a mano: `CONTACT_FREE_NODE_TYPES`, tipos `NodeType`/`TriggerType` en `database.ts`, entrada en `node-palette.tsx`, `step-catalog.ts` + `step-card.tsx` (editor real) y `ActionPanel`/simulador.
15. **El motor de eventos enruta por tipo de evento, no por fila** (`eventSubject(event_type)`), y `automation_events.contact_id` solo admite NULL para `eod_submitted` (CHECK `automation_events_contact_or_member`, 00182). Para "también sin contacto" hay que cambiar eso (ver T4/F25).
16. **No existe test de caracterización de `escalateToHuman`** (solo cobertura indirecta en `runner*.test.ts`). Se escribe antes de F24.
17. **Punto de fusión de contactos:** existe `linkContacts` (`lib/actions/contacts.ts:752`) que reapunta conversaciones, canales y tags al contacto principal y borra lógicamente el duplicado. **No se toca.** Una tarea ligada al duplicado queda con su `contact_id` (el contacto sigue existiendo con `deleted_at`): se anota en `PENDIENTE-tareas.md`.
18. **No hay triggers sobre `workspace_members`**: el de F6 no choca con ninguno.
19. **Ya existe la ruta `agents/tareas/[task]`** (tareas de IA). `/dashboard/tareas` está libre, pero el nombre es parecido: la UI de Tareas dice "Tareas" y la otra "Tareas de IA" (ya es así).
20. **Registros extra que fallan si se olvidan** (los pide un test): `lib/nav/page-actions.ts` (`PAGE_META` de la página nueva), ícono nuevo en el `ICONS` de `components/sidebar.tsx` (ej. `ListTodo`), `nav/items.test.ts` L236 (grupo `inicio`), `member-baseline` nombres de menú del Member.

## 3. Migraciones: plano → número real

| Plano | Real | Qué hace |
|---|---|---|
| 00196 | **00196_tasks** | Tabla `tasks`, índices, RLS, `can_see_task` / `can_see_task_id`, trigger de limpieza al salir de `workspace_members`, `updated_at` |
| 00197 | **00197_tasks_functions** | `complete_task_with_shifts`, `set_task_blockers`, `delete_task` + policy aditiva `audit_log_select_tasks` |
| 00198 | **00198_tasks_due_cron** | `private.enqueue_tasks_due_sweep()` + `cron.schedule` horario (patrón 00167) |
| 00199 | **00199_task_trigger_types** | `triggers_type_check` = los 32 tipos vigentes (00187) + `task_completed` + `task_overdue`; y (por la decisión "también sin contacto") `automation_events_contact_or_member` ampliado a los dos eventos de tareas. Cabecera con las dos definiciones viejas, copiadas con `pg_get_constraintdef` de la base real |

Todas: idempotentes, "Como volver atras", `SECURITY DEFINER` + `SET search_path = ''`. Después de cada una: aplicar con `supabase db query --linked -f`, registrar en `supabase_migrations.schema_migrations`, `node scripts/build-all-migrations.mjs`, correr `verify-tasks.mjs`. **Si algo falla: paro, lo anoto en `PENDIENTE-tareas.md` con el cómo volver atrás, y no sigo.** Antes de cada una confirmo con `list_migrations` y `ls`.

Reglas de diseño clave:
- `can_see_task(t)` = miembro del workspace AND (admin OR `created_by`=yo OR `owner_id`=yo OR yo ∈ `follower_ids` OR (`has_permission('tasks.view')` AND `permission_scope('tasks')='all'`)). Copia exacta de la estructura de `can_see_call` (00145). `can_see_task_id(uuid)` igual que `can_see_call_id`.
- RLS: SELECT por `can_see_task`; INSERT/UPDATE para miembros con `tasks.edit` (con la salvedad del Member de sistema, dif. 4) y que además vean la tarea; **sin DELETE** (`REVOKE`) — se borra con `delete_task`.
- Las RPC validan membresía y permiso adentro y filtran por workspace.
- Test nuevo `lib/tasks/migrations.test.ts`: la lista de 00199 = lista de 00187 + 2 tipos (mismo método que `lib/webhooks/migrations.test.ts`); `lib/cron-config.test.ts` queda intacto (el cron es SQL directo).

## 4. Bloques

Dependencias: **T1 → T2 → T3**; **T4 depende de T1**; F25 es la única parte con riesgo y puede quedar pendiente.

### Tests de caracterización (antes de tocar lo que cambia)
Ya existen y los confirmo en verde: `member-permissions-characterization`, `member-baseline`, `registry-characterization`, `triggers-characterization`, `consistency`, `agent/tools/registry.test`, `nav/items.test`, `jobs/bootstrap-characterization`, `cron-config.test`, `lib/eod/migrations.test`, `triggers-check.test`.
**A escribir:** `lib/agent/escalate-characterization.test.ts` (qué hace hoy `escalateToHuman`: update de conversación, auditoría, aviso a `assigned_to`) — antes de F24.

### T1 — Base y reglas (F1–F9)
Orden: dependencias del plano → migración 00196 + verify (F1, F6 parcial) → permisos (F2) → funciones puras (F3, F5 TS, F9) → 00197 + verify (F4, F5 SQL, F6 `delete_task`, F7 policy) → `lib/tasks/schema.ts` (zod) + `lib/actions/tasks.ts` (F8) + auditoría (F7).
- **Nuevos:** `supabase/migrations/00196–00197`, `lib/tasks/{date-rules,dependencies,project,schema,audit,types}.ts` + tests, `lib/actions/tasks.ts` + test, `scripts/verify-tasks.mjs`, `lib/tasks/migrations.test.ts`.
- **Modificados (aditivo):** `lib/auth/permissions.ts` (+3 claves `tasks.view|edit|delete`, módulo `tasks`, alcance `own|all`, Member con view+edit), `roles-admin.ts`, `roles-view.tsx`, `lib/types/database.ts` (`AuditEntityType` + `task`, tipos de `tasks` con Insert/Update `Record<string, never>` como Ventas, `as never` al escribir), y los tests de la dif. 3 y 5.
- **Regla de fechas = lógica pura + RPC que solo aplica:** `computeDateShifts` (los 10 casos de F3) calcula el plan; `complete_task_with_shifts` no recalcula: valida (solo atrasa, solo tareas abiertas del workspace, `updated_at` esperado → `stale`) y aplica todo en una transacción. `verify-tasks.mjs` prueba la atomicidad inyectando un corrimiento inválido.
- `verify-tasks.mjs` (patrón `verify-eod.mjs`: lanza un `.impl.ts` con vite-node, prefijo `zz-test-`, limpia lo suyo): RLS por rol (Owner, Admin, Member creador/responsable/seguidor/ajeno, otro workspace, sin `tasks.edit`), DELETE directo rechazado, ciclos, `date_before_blocker`, atomicidad, `stale`, limpieza al borrar miembro, `delete_task`, y `verify-audit-visibility.mjs --despues-de-00168` sigue verde.
- **Listo cuando:** F1–F9 cumplen, `npm test`, `build`, `lint`, `verify-tasks` en verde y nada previo roto.

### T2 — Tabla, edición en celda y drawer (F10–F15)
Primero `npm i @tanstack/react-table` (única dependencia). Puras con test: `lib/tasks/{table-model,cell-edit,drawer-url,shift-preview,filters,view-state}.ts`.
- **Nuevos:** `app/(dashboard)/dashboard/tareas/page.tsx` (+`loading`/error), `components/tasks/{tasks-table,cell-editors,task-drawer,shift-dialog,filters-bar,quick-create}.tsx`.
- **Modificados:** `lib/nav/items.ts` ("Tareas", grupo `inicio`, `permissions:["tasks.view"]`, detrás de Bandeja), `components/sidebar.tsx` (ícono), `lib/nav/page-actions.ts`, `nav/items.test.ts`, `member-baseline.test.ts` (nombres de menú).
- Drawer nuevo y más ancho (no se toca `components/ui/sheet.tsx`); filtros con `filter-menu`/`popover`; estado de vista en la URL (`parseViewState`/`serializeViewState` ida y vuelta); optimista + rollback puros; diálogo de fechas con `formatShiftLine`.
- Servidor: página con `requirePermission("tasks.view")`; las celdas son de solo lectura sin `tasks.edit`.
- **Listo cuando:** F10–F15 + tests + build + lint + verify; revisión visual (ver §5).

### T3 — Tablero, avisos y superficies (F16–F21)
- **00198** + verify (1 job por workspace/día) → handler `lib/jobs/handlers/tasks-due-sweep.ts` (+`isSweepWindow(now,tz)` puro, 08:00 local) registrado en `lib/publishing/bootstrap.ts` y en `bootstrap-characterization.test.ts`.
- Notificaciones: 7 tipos + entidad `task` en `lib/notifications/types.ts` (+`case "task"` en `linkFor`, `types.test.ts`), `lib/tasks/notifications.ts` (destinatario concreto, nunca el actor; `task_changed` con `createNotificationOnce(withinMinutes:10, perRecipient)`; todo en try/catch).
- Kanban: `lib/tasks/kanban-model.ts` (`groupByStatus`, `computePosition`) + `components/tasks/board.tsx` (HTML5 nativo, menú "Mover a…", arrastrar a Completada pasa por el diálogo de fechas).
- "Mis tareas" (`summarizeMine`, estado de URL), mobile (`selectLayout(width)`: <768 lista de tarjetas).
- Ficha del contacto (`app/(dashboard)/dashboard/contacts/[contactId]/page.tsx`: sección "Tareas" en el aside, tras "Seguimiento") y bandeja (botón "Crear tarea" en el grupo de íconos del header de `components/inbox/message-thread.tsx`, con título sugerido).
- **Listo cuando:** F16–F21 + tests + `verify-tasks` (con 00198) + build + lint.

### T4 — Origen automático (F22–F26)
- **F22** `lib/flow-engine/nodes/create-task.ts` (`needsContact:false`, patrón `notify-team.ts`, nunca lanza, idempotencia por `source_ref = flow_id:run_id:nodo` con el único parcial de `tasks`), alta en `registry/nodes.ts`, `contact-free.ts`, `database.ts`, paleta, `step-catalog`/`step-card`, simulador; tests actualizados solo con el nodo.
- **F23** `lib/agent/tools/create-task.ts` (`crear_tarea`, registrada en `tools/index.ts`; responsable = `conversations.assigned_to` → `contacts.setter_id` → `contacts.vendedor_id` → nadie, con chequeo de membresía; sin responsable: aviso a cada Owner/Admin; máx. 3 por conversación y detección de duplicado; `configSchema` con `maxPerConversation` y `defaultDueDays`; auditoría `actor_type='agent'` + `performed_by_agent_id`; **no toca** `programar_seguimiento` ni `contacts.next_followup_date`). No es `required`.
- **F24** (apagada por defecto): `guardrails.escalation.createTaskOnEscalate` (default `false`) en `lib/agent/schemas.ts` (objeto y `.default({...})`) + checkbox en `components/agents/config-tab.tsx`. El gancho va **al final de `escalateToHuman`**, en try/catch, y solo si el flag está prendido: con el flag apagado el comportamiento es idéntico (lo fija el test de caracterización).
- **F26** `lib/tasks/create-from-automation.ts` (captura y `console.error('[tareas] …')`) y `formatSource` puro.
- **F25 (decisión: también sin contacto)** — diseño: los triggers van en `registry/task-triggers.ts` (patrón `sales-triggers.ts`), `eventTypes:[type]`. Se emiten (try/catch, nunca bloquean) al completar y desde el handler del cron. Una tarea **con contacto** viaja por el camino de siempre (sin cambios). Una tarea **sin contacto** emite con `contact_id` NULL y `member_user_id` = responsable, si no el creador, si no quien actuó; si no hay ninguna persona, no se emite (queda documentado). Cambios: (a) 00199 amplía el CHECK de `automation_events`; (b) `processEvent` pasa a decidir por la **fila** para los eventos de tareas (con `contact_id` → contacto; sin él → la rama `member` ya existente, que corre con `contactId:null`); (c) los nodos con `needsContact` se saltean solos en esa rama (ya implementado); (d) tests: `task-triggers.test.ts`, actualizar `triggers-characterization`/`consistency`/`crm-triggers`. **Es lo más riesgoso del plan**: si el cambio del motor resultara desproporcionado, dejo F25 en `PENDIENTE-tareas.md` (el plano lo permite) y sigo con el resto; te aviso antes de recortar.
- **Listo cuando:** F22–F26 + tests + verify + build + lint.

## 5. Reglas de la corrida (confirmadas)

- Si un bloque se traba tras un intento serio: lo anoto y sigo con los que no dependen de él.
- Nunca debilito un permiso, un test existente ni una política de RLS para destrabar algo.
- Sin secretos ni variables de entorno nuevas. Sin `dangerouslySetInnerHTML`. Nada de Railway/producción de configuración. Ningún test llama a un proveedor externo real (`vitest.setup.ts` ya bloquea `fetch`).
- No toco `find_or_link_contact`, `record_contact_touch`, `create_booking`, `linkContacts`, `programar_seguimiento` ni `contacts.next_followup_date`.
- Ritmo: tras cada funcionalidad `npm test`; tras cada bloque: marco `PROGRESS-tareas.md`, commit `feat: tareas - bloque Tn (nombre)` y `git push origin feat/tareas`. Commits con rutas explícitas (nunca `git add -A`).
- Revisión visual con el navegador integrado, a 1440 y 390 px, claro y oscuro: tabla, celdas en edición, drawer, diálogo de fechas, tablero, campana, ficha del contacto, bandeja y panel del nodo. Si la app pide login, lo anoto; no escribo credenciales.
- Cierre: `docs/tareas.md`, actualizar `docs/flow-registry.md`, sección "Tareas" en `CLAUDE.md` ("Lo que no se puede romper" + próxima migración libre), `PENDIENTE-tareas.md` completo, y PR `feat/tareas` → `main` con `gh pr create` (resumen de PROGRESS y PENDIENTE). **No mergeo.**

## 6. Qué hago apenas apruebes (y nada más)

1. `git fetch` y crear `feat/tareas` desde `origin/main` (rama nueva; hoy no existe).
2. Copiar el plano a `docs/requerimientos-tareas.md`.
3. Crear `docs/PROGRESS-tareas.md` con: este plan tal cual, los bloques T1–T4 con sus F como checklist, "Punto de partida" (§1) y "Migraciones" (§3).
4. Crear `docs/PENDIENTE-tareas.md` (formato: qué quedó / por qué / qué se decidió), ya con: fusión de contactos (dif. 17), `verify-*` pendientes de baseline, docs de contexto faltantes.
5. Commit `docs: plan del sistema de tareas` y `git push origin feat/tareas`.
6. **Frenar y esperar tu `/goal`.** No empiezo T1 antes.

## Verificación de este plan
Cada afirmación de §2 sale de leer `origin/main` (snapshot en el scratchpad) y de `list_migrations` real; nada se modificó en el repo ni en la base durante la exploración. El baseline de §1 se completa con los `verify-*` al arrancar la ejecución.


---

## Bitácora de la corrida

### T1 — Base y reglas (13/10/2026)
- Migraciones 00196 y 00197 aplicadas con la CLI, registradas en `schema_migrations` y `ALL_MIGRATIONS.sql` regenerado. 00196 se aplicó dos veces (idempotente).
- `verify-tasks.mjs`: RLS por rol, privilegios por columna, DELETE directo rechazado, ciclos, `date_before_blocker`, atomicidad (corrimiento inválido → no se completa nada), `stale`, limpieza al salir una persona, `delete_task`, historial (`audit_log_select_tasks`), y el núcleo (`lib/tasks/core.ts`) contra la base real. Todo en verde.
- Hallazgo: una función de visibilidad que devuelve NULL (no false) deja pasar un `NOT (...)` en `plpgsql`. Se arregló con COALESCE y quedó cubierto por el verify.
- `verify-audit-visibility --despues-de-00168`, `verify-rls`, `verify-roles`, `verify-workspace-isolation` en verde. `npm test` 786 archivos / 9.866 tests; lint 0 errores / 36 warnings (igual que el punto de partida); build compila.
- Decisión: el plan de fechas se arma solo con las tareas que la persona ve (la RLS); una dependiente que no ve no se mueve ni se le muestra el título.

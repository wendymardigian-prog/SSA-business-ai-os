# Progreso: Equipo, roles, permisos e invitaciones

Plano: [requerimientos-equipo-roles.md](requerimientos-equipo-roles.md) (v1.0). Rama `feat/equipo-roles`. Pendientes y decisiones en [PENDIENTE-equipo-roles.md](PENDIENTE-equipo-roles.md).

> **Actualización 13/10/2026 (al arrancar):** la sesión de contactos se mergeó a `main` (PR #50, `7bad3d1`) y su `00205` ya está aplicada y registrada. La rama sale de ese `main`: el riesgo D3 (conflictos con contactos en curso) queda resuelto. Primer número libre confirmado con la base viva: **`00208`**.

## Checklist

### B1 · Base de permisos
- [x] Caracterización de la matriz de acceso (§7), en verde antes de tocar permisos
- [x] F1 · Catálogo nuevo (74 claves)
- [x] F2 · `catalog-usage.test.ts` (toda clave tiene un uso)
- [x] F3 · `has_permission` v2 y paridad TS↔SQL (`00208`)
- [x] F4 · Retiro de `settings.manage` (`00211`, `00210`, `00209`)
- [x] F5 · Guards y menú por permiso

### B2 · Equipo e invitaciones
- [x] F6 · Ver el equipo (`team.view`)
- [x] F7 · Invitar por email o por link (`team.invite`)
- [x] F8 · Invitaciones pendientes
- [x] F9 · Historial de invitaciones
- [x] F10 · Aceptar con el rol correcto
- [x] F11 · Cambiar rol, Closer y quitar (`00212`, después del código)

### B3 · Pantalla de roles
- [x] F12 · Alcances dentro de cada grupo
- [x] F13 · Guardado automático
- [x] F14 · Crear, duplicar y plantillas
- [x] F15 · Ver un rol de sistema y protecciones

### B4 · Ajustes e integraciones
- [x] F16 · General partido
- [x] F17 · Campos, Productos, Asignación, Actividad
- [x] F18 · Integraciones en tres secciones
- [ ] F19 · Webhooks con permiso propio (`00213`, después del código)

### B5 · Módulos
- [x] F20 · Bandeja por canal
- [x] F21 · Contactos
- [x] F22 · Automatizaciones, secuencias y broadcasts
- [x] F23 · Agentes IA, tareas de IA, topes y Conocimiento
- [ ] F24 · Contenido, dashboards y exportar (`00214`, después del código)

### B6 · Verificación y cierre
- [ ] F25 · `verify-permissions-matrix.mjs`
- [ ] F26 · Documentación (`docs/roles.md`, `CLAUDE.md`, PENDIENTE) y PR sin merge

## Punto de partida

Medido el 13/10/2026 sobre `main` (`55f61e6`; el `main` actual `7bad3d1` solo suma contactos).

| Qué | Resultado |
|---|---|
| `npx vitest run` | 830 archivos, 10 379 tests, todos verdes |
| `npm run lint` | 0 errores, 36 warnings |
| `npm run build` | _(se completa al empezar B1)_ |
| `verify-*.mjs` | _(se completa al empezar B1; antes de cada uno se chequea que no haya filas `zz-test-` de otra corrida)_ |

## Migraciones

El plano las numeraba 00200 a 00206; esos números ya estaban ocupados (Tareas y Contactos). Confirmado con `list_migrations`: la última aplicada es la `00207`.

| Plano | Real | Nombre | Bloque | Estado |
|---|---|---|---|---|
| 00200 | `00208` | `has_permission_v2` | B1 | **aplicada y registrada** (`20261014004425`) |
| 00201 | `00209` | `workspace_invites_v2` | B1 | **aplicada y registrada** (`20261014004844`) |
| 00202 | `00210` | `members_role_id_backfill` | B1 | **aplicada y registrada** (`20261014005139`); 0 miembros reales sin `role_id` |
| 00203 | `00211` | `retire_settings_manage` | B1 | **aplicada y registrada** (`20261014005202`); 0 políticas y 0 roles con `settings.manage`; Content Manager recibió `flows.publish`, `webhooks.manage` y `contacts.assign` |
| 00204 | `00212` | `team_rls` | B2 (después del código) | **aplicada y registrada** (`20261014012921`, texto corregido después: el trigger pasó a `SECURITY DEFINER`); `verify-roles` (126 comprobaciones, con los 14 casos compartidos y 40 ataques), `verify-rls`, `verify-workspace-isolation` y `verify-audit-visibility` en verde |
| 00205 | `00213` | `settings_rls` | B4 (después del código) | escrita, sin aplicar |
| 00206 | `00214` | `modules_rls` | B5 (después del código) | pendiente de escribir |

La `00212` suma tres funciones en `public` (`can_grant_permissions`, `can_give_role`, `is_own_role`), dos auxiliares en `private` (`ungrantable_keys`, `scope_rank`) y el trigger `workspace_roles_grant_check`. Las gemelas SQL de `assertCanGrant` se prueban con los mismos casos compartidos (`lib/team/grant.cases.json`) en `grant.cases.test.ts` y en `verify-roles.mjs --despues-de-00212`.

## Retiro de settings.manage

Tabla archivo → clave nueva: ver §5 del plan. Se marca archivo por archivo al ejecutar F4.

## Matriz de acceso

Foto de hoy: `lib/auth/access-matrix.baseline.json` (se genera en B1, antes de tocar permisos). Cambios aprobados del Member (M1 a M8): ver §6 del plan.

---

# Plan completo (aprobado el 13/10/2026, escrito tal cual)

# Plan: Equipo, roles, permisos e invitaciones (B1 a B6)

## Contexto

La pantalla de roles promete más de lo que cumple. El catálogo tiene 54 claves y muchas no tienen ningún guard. Hay 111 chequeos de "¿es Owner o Admin?" que ignoran el catálogo. Además, `has_permission` en la base le dice siempre "no" al Member de sistema, y por eso casi toda la RLS (las reglas de acceso de la base) sigue en "solo Admin". Invitar solo deja elegir Member o Admin, anular borra la fila y no hay reenviar ni historial. El equipo va a crecer, y el Asistente que viene después usa estos mismos permisos.

**Objetivo:** que cada clave haga lo que dice en la página, en la acción y en la base, y que invitar y administrar el equipo sea completo y seguro. **Owner y Admin no pierden nada. El Member de sistema cambia solo en las filas aprobadas (§6).**

**Fuente de verdad:** el plano v1.0 (lo adjuntaste desde Descargas). Cuando el plano supone algo que el código no hace, gana el código real. Cuando el plano y la auditoría no coinciden, gana el plano. Las decisiones que tomaste el 13/10 ganan sobre los dos (§3).

---

## 0. Primeros pasos después de que apruebes (y después FRENO)

1. Crear la rama: `git checkout -b feat/equipo-roles origin/main`. La sesión arrancó en `claude/equipo-roles-construction-354ba9`, que es `main` (55f61e6) sin cambios. Push con upstream.
2. Copiar el plano en dos lugares:
   - `docs/requerimientos-equipo-roles.md`, commiteado, como en los demás módulos.
   - `claude/v11/requerimientos-equipo-roles.md`, que git ignora, para que exista la ruta que usa el `/goal`.
3. Crear `docs/PROGRESS-equipo-roles.md`. Lleva este plan tal cual, el checklist de B1 a B6 (F1 a F26) y las secciones "Punto de partida", "Migraciones", "Retiro de settings.manage" y "Matriz de acceso".
4. Crear `docs/PENDIENTE-equipo-roles.md` con el formato qué quedó / por qué / qué se decidió.
5. Commit `docs: plan de equipo, roles, permisos e invitaciones` y push. **FRENO hasta tu `/goal`.**

**Al empezar el `/goal`, antes de tocar código:**
- **Punto de partida que el modo plan no me dejó correr**, porque escribe:
  - `npm run build`.
  - Cada `scripts/verify-*.mjs`, de a uno.

  Antes de cada `verify` chequeo que no haya filas `zz-test-` de otra sesión (§2, D3). Si las hay, espero. Si siguen después de 15 minutos, lo anoto y paso al siguiente.
- **Tests de caracterización de la matriz de acceso** (§7), en verde contra el código de hoy, commiteados antes del primer cambio de permisos.

---

## 1. Punto de partida (medido el 13/10/2026)

| Qué | Hoy |
|---|---|
| `npx vitest run` | 830 archivos y 10 379 tests, todos verdes |
| `npm run lint` | 0 errores, 36 warnings |
| `npm run build` | Sin correr (escribe `.next` y `public/embed/embed.js`). Va en el paso del `/goal`. |
| 27 `verify-*.mjs` | Sin correr (escriben en la base real). Según `PROGRESS-tareas-crm.md`, `verify-forms`, `verify-attribution` y `verify-publishing` ya fallaban. `verify-sales` y `verify-eod` fallan a veces en corridas largas por el cron real. |

**Flags con que corre cada uno:**
- `verify-rls --despues-de-00143`
- `verify-roles --despues-de-00136`
- `verify-workspace-isolation --despues-de-00143`
- `verify-audit-visibility --despues-de-00168`
- `verify-tasks` y `verify-sales`, completos
- El resto, sin flags.

**Lo que no se puede empeorar:** que lo que pasa siga pasando, y que los warnings de lint no superen 36.

---

## 2. Diferencias con el plano y la auditoría (verificadas contra `main` y la base viva)

**Documentos y concurrencia**
- **D1.** No existen `claude/v11/requerimientos-equipo-roles.md` ni `claude/auditoria-equipo-roles.md`. `claude/v11` solo tiene Extra I. Uso el plano de Descargas y el código como diagnóstico. La auditoría no está en ningún lado.
- **D2.** Migraciones aplicadas en la base viva: `00196`–`00204` y `00206`–`00207`. La **`00205` está reservada** por la sesión de contactos (`fix/contactos-regla-unica`, sin mergear). **El primer número libre es `00208`**, así que las siete van de la **`00208` a la `00214`**. Antes de cada una reconfirmo con `list_migrations` y `ls supabase/migrations`.
- **D3. La sesión de contactos está corriendo en paralelo ahora.**
  - Tiene sin commitear cambios en `lib/actions/contacts.ts`, `csv-import.ts`, `sales.ts`, `webhook-flow-editor.ts`, `lib/types/database.ts`, `CLAUDE.md` y `ALL_MIGRATIONS.sql`.
  - Ya aplicó la `00201` a la `00204`.
  - Mientras armaba este plan estaba corriendo sus `verify-*`: había 8 workspaces `zz-test-` en la base.

  **Cómo lo manejo:**
  - En esos archivos mis cambios son solo líneas de guard al principio de cada acción. No toco la lógica de contactos.
  - Antes de B5 llamo a `sync_with_base_branch`. Si contactos ya mergeó, resuelvo los conflictos ahí. Si no, lo anoto en PENDIENTE y lo resuelvo al abrir el PR.
  - `ALL_MIGRATIONS.sql` y `database.ts` se regeneran, no se resuelven a mano.
  - Nunca corro un `verify-*` mientras haya filas `zz-test-` de otra corrida.

**Datos reales** (fuera de los `zz-test-` pasajeros; se vuelven a medir al empezar)
- **D4.** Hay **1 workspace real** ("Wendy's Workspace") con **1 miembro** (Owner, ya con `role_id`). Hoy hay **0 filas reales con `role_id` nulo** (el plano decía 5 miembros, 3 nulos). La 00210 (backfill) se escribe igual, para cualquier clon, y en su cabecera lista los `user_id` que toque al aplicarla.
- **D5.** No hay workspaces sin miembros fuera de los de prueba (el plano decía ~178). En PENDIENTE queda como "verificado".
- **D6.** Hay un solo rol personalizado real: **Content Manager**, con 21 claves, 0 personas y **`flows.edit`**. Los `zz-test-alcance-*` no estaban en la foto limpia; se revisan en B6.
- **D7.** `workspace_invites` tiene 1 fila real (`revoked`). Columnas de hoy: `id, workspace_id, email, role (admin|member), invited_by, status (pending|accepted|revoked), created_at, expires_at`.

**Base: funciones y políticas** (leídas con `pg_get_functiondef` y `pg_policies`)
- **D8.** `has_permission` vivo es la versión con COALESCE: Owner y Admin dan `true`. Si no, lee el jsonb del rol, que para el Member de sistema está vacío, así que da `false`. `permission_scope`, `is_workspace_admin`, `is_workspace_owner` e `is_workspace_member` quedan como están.
- **D9. El `has_permission` nuevo le abriría al Member la lectura de webhooks**: `inbound_webhooks_select` y `webhook_endpoints_select` piden `flows.edit`, que el Member tiene. Ninguna otra política ni función cambia para el Member:
  - `meta_*`, `social_*`, `response_assets`, `booking_categories`, `scheduling_can_manage` y las 8 de `settings.manage` piden claves que el Member no tiene.
  - `can_see_booking`, `can_see_call` y `can_see_sale` piden alcance `all`, y el Member es `own`.
  - `can_view_forms`, `can_view_tasks`, `can_edit_tasks` y `can_view_eod_all` no llaman a `has_permission`.
  - **Decidiste:** las dos políticas de webhooks pasan a `webhooks.manage` en la misma 00208.
- **D10.** `settings.manage` vive en **8 políticas de 4 tablas** (el plano decía "4 políticas"): INSERT y UPDATE de `products`, `product_variants`, `assignment_rules` y `content_pillars`. Ninguna está en el §8.4. **Decidiste:** pasan a sus sucesoras en la 00211.
- **D11.** Políticas de equipo de hoy:
  - DELETE de `workspace_members` = "Owners can delete members" (chequea `role = 'owner'`).
  - UPDATE = `is_workspace_owner OR (is_workspace_admin AND role <> 'owner')`.
  - INSERT "Owners can insert members" no está en el §8.4: no se toca.
  - `workspace_invites_select` deja ver todas las invitaciones a cualquier miembro. No está en el §8.4: no se toca y queda anotado.
- **D12. Agujero en `workspace_invites_update`:** la rama "el invitado" no tiene WITH CHECK propio. El invitado puede cambiarse `role` a `admin`, `expires_at` o `workspace_id` y después aceptar. Nadie la usa: aceptar lo hace el servidor con el cliente de servicio. **Decidiste:** se saca en la 00212.
- **D13.** `flows` tiene dos políticas: "Users can manage flows" (ALL, cualquier miembro) y "Users can view flows" (SELECT). Se reescriben las dos.
- **D14. `triggers` se escribe con la sesión del usuario.** Lo hacen `publishFlow` desde `api/v1/flows/[id]/publish`, los flujos de evento de Agenda (`scheduling.use`), los flujos de Formularios y la pestaña Growth (cliente del navegador). Hoy, cuando un Member publica, el flujo queda "publicado" pero el insert de sus disparadores falla en silencio y nunca se dispara. **Decidiste:** `triggers` pasa a `flows.edit`. Es el cambio aprobado M7 (§6).

**Código**
- **D15.** El catálogo tiene **54 claves** en 19 módulos, sin `reserved` ni `ownerOnly`. El Member tiene 26. Tareas sumó `tasks.view/edit/delete` y el alcance `tasks`. Tareas × CRM no tocó `permissions.ts`.
- **D16.** `settings.manage` aparece en **17 archivos de código** (el plano decía 16) y 8 políticas. El que sumó Tareas × CRM es `lib/actions/task-settings.ts`. Tabla completa en §5.
- **D17.** Guards de hoy:
  - `requireWorkspaceAdmin`: 11 páginas y 2 acciones.
  - `getAdminContext`: 67 llamadas, en 15 archivos de `lib/` y 7 rutas de `api/v1/channels`.
  - `isAdminRole`: 20.
  - Chequeos de rol escritos a mano: 11.
  - **`requireAnyPermission` y `getAnyPermissionAction` ya existen**; el plano los da por nuevos.
- **D18.** Siete archivos con guard de Admin que el plano no menciona. Les asigno una clave que el Member no tiene, así nada cambia para él:

  | Archivo | Clave |
  |---|---|
  | `patterns.ts` | `ai_tasks.manage` |
  | `metrics.ts`, `meta-accounts.ts`, `social-accounts.ts`, `youtube-probe.ts` | `integrations.manage` |
  | `opt-out.ts` | `settings.general` |
  | `ads-analysis.ts` | `dashboards.ads.view` |
  | `tag-effects.ts` | `tags.manage` |

- **D19.** `adminOnly` está en **tres** lugares. Los tres pasan a `permissions`:
  - El menú: `lib/nav/items.ts`.
  - Los botones de cabecera: `lib/nav/page-actions.ts`.
  - Las pestañas del detalle de un agente: `lib/agent/agent-types.ts`.
- **D20.** `SETTINGS_TABS` no declara permisos; cada página se protege sola. Recursos la ve cualquier miembro.
- **D21.** Equipo hoy:
  - Invitar ofrece solo Member o Admin, sin `role_id`.
  - Pendientes lista solo las `pending`, con las vencidas atenuadas.
  - No hay reenviar ni renovar.
  - Anular hace `DELETE`.
  - Solo `setMemberRole` y `setMemberCloser` usan `team.manage`. El resto usa `isAdminRole` o un chequeo de Owner escrito a mano.
- **D22.** Roles hoy:
  - Botón "Guardar" seguido de `window.location.reload()`.
  - Los alcances están en una grilla arriba de los grupos.
  - El grupo de recursos se llama "Plantillas".
  - Faltan tildes: "Que leads ve", "Descripcion", "Configuracion".
  - La descripción de Admin sale duplicada (el seed de la 00088 y `describeRole` dicen lo mismo) y la de Owner casi duplicada.
- **D23.** Bandeja: nada lee `inbox.<canal>.*` fuera del catálogo, y `POST /api/v1/messages` no chequea el canal. F20 es nuevo para los roles personalizados. El Member tiene los seis, así que para él no cambia.
- **D24.** Integraciones hoy tiene las secciones "Conexiones" e "Inteligencia artificial" y las tarjetas de Fathom y Webhooks.
  - Las conexiones personales viven en `CalendarsView` (`components/scheduling/calendars-view.tsx`) y `MiFathomCard` (`components/calls/mi-fathom-card.tsx`).
  - `/dashboard/channels` es solo Admin y no está en el menú.
- **D25.** Contactos, Automatizaciones, Secuencias y Broadcasts usan solo `getWorkspace`, sin guard de permiso. La API de flujos y la de broadcasts no chequean nada, y toman la primera membresía (`.limit(1)`) en vez del workspace elegido.
- **D26. Exportar CSV: hay 4 en total.**

  | Export | Dónde vive | Quién puede hoy |
  |---|---|---|
  | Corridas de IA | `GET /api/v1/agent-runs/export` | Cualquier miembro |
  | Respuestas de formularios | `exportResponsesCsv` | `forms.view` |
  | Reportes EOD | `exportEodReportsCsv` | `forms.view` |
  | Tabla Meta vs CRM | Se arma en el navegador (Blob), sin endpoint | Pide `dashboards.ads.view` |

  No hay export de contactos.
- **D27.** Con la clave que sale, `verify-roles.mjs` (`has_permission`) y `verify-rls.mjs` (un rol personalizado que crea un producto) usan `settings.manage`. Cambio **la clave por su sucesora**, sin aflojar ninguna aserción.
- **D28.** `member-baseline.test.ts` prueba el menú leyendo `adminOnly`. Esa aserción se reescribe para calcular el menú del Member con `visibleNavItems` y compararlo con **la misma lista exacta** de hoy. No se desactiva ni se afloja.

---

## 3. Decisiones tomadas el 13/10 (ganan sobre el plano)

1. **`triggers` pasa a `flows.edit`.** Lo que un Member publica empieza a dispararse de verdad. Es el cambio aprobado M7.
2. **Se tocan las 10 políticas que no están en el §8.4.**
   - Las 2 de webhooks pasan a `webhooks.manage` en la 00208. Para el Member la base no cambia.
   - Las 8 de `settings.manage` pasan a sus sucesoras en la 00211.
3. **El menú del Member queda idéntico.** El ítem Integraciones se ve con `integrations.view`, `channels.manage` o `integrations.manage`. Al Member no le aparece en el menú, pero si entra por la URL ve solo "Mis conexiones". Es el cambio aprobado M8.
4. **Roles personalizados: se conserva lo que pueden.** La 00211 les suma las sucesoras de cada clave que se parte:

   | Si tiene | Se le suma |
   |---|---|
   | `settings.manage` | `settings.general`, `sales.settings`, `products.manage`, `assignment.manage` (y se le saca `settings.manage`) |
   | `flows.edit` | `flows.publish`, `webhooks.manage` |
   | `team.manage` | `team.view`, `team.invite` |
   | `roles.manage` | `roles.view` |
   | `integrations.manage` | `integrations.view`, `channels.manage` |
   | `agents.edit` | `ai_tasks.manage`, `ai_limits.manage` |
   | `contacts.edit` | `contacts.assign` (hoy cualquier miembro reasigna) |

   Hoy esto le suma a Content Manager `flows.publish`, `webhooks.manage` y `contacts.assign`. La cabecera de la migración guarda el respaldo del jsonb.
5. **El Member pierde Broadcasts** (`broadcasts.manage` en la API y en la página). Es el cambio aprobado M6.
6. **El Member queda igual que hoy en cuatro acciones** donde el mapeo del plano le cambiaría algo:
   - `dismissLinkSuggestion` → `contacts.edit`.
   - `revertAgentAction` → `agents.view` + la RLS.
   - Quitar la marca "no contactar" → `contacts.delete` (ponerla sigue con `contacts.edit`).
   - `enrollContact` → `sequences.edit`.
7. **Se cierra el agujero de `workspace_invites_update`** (D12): la rama del invitado sale en la 00212.

---

## 4. Migraciones: número del plano y número real

| Plano | Real | Nombre | Qué hace | Bloque y cuándo | Verificación |
|---|---|---|---|---|---|
| 00200 | **00208** | `has_permission_v2` | `private.member_permission_keys()` (27 claves) y `private.owner_only_keys()`, las dos IMMUTABLE. `has_permission` v2 con la misma firma, `SECURITY DEFINER`, `SET search_path = ''`, nunca NULL. Las 2 políticas de webhooks pasan a `webhooks.manage` (la de endpoints, también a `integrations.manage`). | B1, al final del bloque | `verify-rls`, `verify-roles` (+ casos de F3) |
| 00201 | **00209** | `workspace_invites_v2` | Las 10 columnas del §8.1, con CHECK y FK. `delivery` arranca en `'email'` para las filas viejas. | B1 (aditiva, inofensiva para el código viejo) | `verify-workspace-isolation` |
| 00202 | **00210** | `members_role_id_backfill` | Cada miembro con `role_id` nulo recibe su rol de sistema (el mismo UPDATE que la 00088). Los `user_id` que toca van en la cabecera. | B1 | consulta de control `count(*) where role_id is null` = 0; `verify-roles` |
| 00203 | **00211** | `retire_settings_manage` | Reescribe las 8 políticas a sus sucesoras y migra el jsonb (decisión 4). Respaldo del jsonb en la cabecera. | B1 | `verify-roles` (caso nuevo, F4), `verify-rls` |
| 00204 | **00212** | `team_rls` | `workspace_invites` (INSERT/UPDATE/DELETE → `team.invite`, sin la rama del invitado), `workspace_members` (UPDATE → `team.manage`, DELETE → `team.remove`; se mantienen las reglas del Owner), `workspace_roles` (→ `roles.manage`, `system_role IS NULL` y el trigger). Suma `private.can_grant(ws, permissions jsonb)` (§8, B2). | B2, **después** del código de B2 | `verify-roles`, `verify-rls`, `verify-workspace-isolation` |
| 00205 | **00213** | `settings_rls` | `custom_field_definitions`, `integration_configs` (SELECT → view o manage; escribir → manage), `social_accounts`, `channels` (→ `channels.manage`), `csv_imports` (SELECT: solo la rama admin pasa a `contacts.import`; quien importó sigue viendo lo suyo). Política ADICIONAL `audit_log_select_audit` (`audit.view`). | B4, **después** del código de B4 | `verify-rls`, `verify-roles`, `verify-audit-visibility --despues-de-00168`, `verify-inbound-webhooks` |
| 00206 | **00214** | `modules_rls` | `flows` (SELECT → `flows.view`; escribir → `flows.edit`), `triggers` (→ `flows.edit`), `sequences` (→ `sequences.edit`), `tags` (solo la rama admin → `tags.manage`), `agents` y `agent_prompt_versions` (INSERT → `agents.edit`, SELECT → `agents.view`), `ai_task_prompt_versions` (→ `ai_tasks.manage` o `calls.configure`), `knowledge_base` (→ `knowledge.edit`), `contacts` DELETE (→ `contacts.delete`). | B5, **después** del código de B5 | `verify-rls`, `verify-roles`, `verify-crm`, `verify-inbox-filters` |

**Reglas de todas las migraciones:**
- Son idempotentes (`DROP POLICY IF EXISTS` + `CREATE`, `ADD COLUMN IF NOT EXISTS`, `DO $$`).
- Llevan el encabezado "Cómo volver atrás".
- Toda función o política que reescriben se lee de la **base viva** (`pg_get_functiondef` / `pg_policies`) justo antes de escribirla, y su definición vigente completa se copia en la cabecera.
- Donde una política se evalúa por fila en tablas grandes, va `(select public.has_permission(...))`.
- Se aplican con `supabase db query --linked -f`. Después se registran en `supabase_migrations.schema_migrations`, se corre `node scripts/build-all-migrations.mjs` y la verificación de la tabla.
- **Si una verificación falla, PARO**: anoto en PENDIENTE qué falló y cómo volver atrás, y no sigo.
- **`audit_log_select` no se toca.**
- La lista "No se tocan" del §8.4 se respeta literalmente: `workspaces` sigue solo Admin y Ajustes escribe con el cliente de servicio después del guard.

**Qué pasa en producción mientras el código no está desplegado:** el código vive en la rama hasta el PR, pero las migraciones van a la base viva. Comprobé, política por política, que con el código de `main`:
- Owner y Admin dan exactamente lo mismo.
- El Member da lo mismo, salvo M7 (los disparadores).

Por eso en `csv_imports` y en `tags` solo se reemplaza la rama admin: así el import del Member en producción sigue andando hasta que se despliegue B5.

---

## 5. Retiro de `settings.manage` (archivo → clave nueva)

| Archivo | Uso | Pasa a |
|---|---|---|
| `app/.../settings/productos/page.tsx`, `productos/[id]/page.tsx` | página | `products.manage` |
| `app/.../settings/asignacion/page.tsx` | página | `assignment.manage` |
| `app/.../content/page.tsx` | crear desde la taxonomía y el botón de pilares | pilares → `settings.general`; productos → `products.manage` |
| `app/.../dashboards/ads/page.tsx` | `canSync` | `settings.general` |
| `app/.../dashboards/ads/sin-vincular/page.tsx` | `canManage` | `settings.general` |
| `app/.../agenda/configuracion/ajustes/page.tsx` | `canManageSettings` | `settings.general` |
| `lib/sales/wizard/load.ts` | `canManageCatalog` | `products.manage` |
| `lib/content/load-piece.ts` | crear desde el selector | pilares → `settings.general`; productos → `products.manage` |
| `lib/content/load-taxonomy.ts` | (comentario y parámetro) | igual que arriba |
| `lib/actions/meta-match.ts` | `run`, `searchMetaCatalog` | `settings.general` |
| `lib/actions/products.ts` | `manage()`, todas las acciones | `products.manage` |
| `lib/actions/sales-settings.ts` | `updateSalesSettings` | `sales.settings` |
| `lib/actions/content-taxonomy.ts` | `manageContext()` | pilares → `settings.general`; productos → `products.manage` |
| `lib/actions/assignment-rules.ts` | las 4 acciones | `assignment.manage` |
| `lib/actions/meta-ads-sync.ts` | `syncMetaAdsNow` | `settings.general` |
| `lib/actions/task-settings.ts` | `setPaymentTasksEnabled` (cobranza) | `sales.settings` |
| `lib/actions/scheduling/profile.ts` | `setAutoCreateFlows` | `settings.general` (y el texto de error deja de decir "Solo Owner y Admin") |
| `lib/auth/permissions.ts` | definición | sale la clave |
| Comentarios en `content-settings-button.tsx`, `classification-fields.tsx`, `ads-dashboard.tsx`, `ads/header-controls.tsx` | texto | actualizados |
| SQL: `products`, `product_variants` | INSERT y UPDATE | `products.manage` |
| SQL: `assignment_rules` | INSERT y UPDATE | `assignment.manage` |
| SQL: `content_pillars` | INSERT y UPDATE | `settings.general` |
| `scripts/verify-rls.mjs`, `verify-roles.mjs` | clave de prueba | su sucesora (D27) |
| Tests de esos archivos (13 archivos) | fixtures | sucesora; ninguna aserción se debilita |

---

## 6. Cambios visibles de comportamiento

**Owner y Admin: ninguno en lo que pueden hacer.** La matriz da idéntica. Admin ya no podía quitar personas (era solo del Owner), y por eso `team.remove` queda solo para el Owner sin quitarle nada a nadie.

Mejoras de pantalla que también ven, sin perder nada:
- Invitar con cualquier rol y por link.
- Reenviar, renovar e historial de invitaciones.
- Anular deja la fila como "anulada" en el historial en vez de borrarla.
- Roles con guardado automático, plantillas y duplicar.
- General partido en dos secciones.
- Integraciones en tres secciones.

Nota: la API de flujos va a tomar el workspace elegido en vez de la primera membresía. Para quien está en un solo workspace (hoy, todos los reales) da lo mismo.

**Member de sistema: solo estas filas**, cada una con su test y el comentario "cambio aprobado, plano §9.3" (o "decisión del 13/10"):

| # | Qué | Antes | Después | Origen |
|---|---|---|---|---|
| M1 | Importar contactos (`/contacts/import`, `startImport`/`importBatch`/`finishImport`, botón "Importar") | Sí | **No** | §9.3 |
| M2 | Exportar CSV (corridas de IA, respuestas de formularios, reportes EOD) | Sí | **No**, y el botón no se muestra | §9.3 |
| M3 | Webhooks (páginas de Integraciones → Webhooks y las acciones de endpoints y del editor) | Sí | **No** | §9.3 |
| M4 | Reasignar leads que ve (`contacts.assign`) | Sí | Sí | §9.3 (sin cambio) |
| M5 | Publicar flujos (`flows.publish`) | Sí (en la app) | Sí | §9.3 (sin cambio en la app) |
| M6 | Broadcasts (API y página) | Sí | **No** | decisión del 13/10 |
| M7 | Que lo que publica se dispare de verdad (`triggers` con `flows.edit`): flujos del canvas, flujos de evento de Agenda, pestaña Growth | No (el insert falla en silencio) | **Sí** | decisión del 13/10 |
| M8 | `/dashboard/settings/integrations` por URL | Redirige | **Ve solo "Mis conexiones"** (el menú no cambia) | decisión del 13/10 |
| — | `sequences.edit` sale de su lista | Las acciones ya eran solo Admin | Igual | §9.3 (no cambia nada real) |

---

## 7. Matriz de acceso de hoy: caracterización antes de tocar (regla 2)

Archivo nuevo: `lib/auth/access-matrix.characterization.test.ts`, con su foto `lib/auth/access-matrix.baseline.json`, generada **hoy** y commiteada. Cubre cuatro cosas:
- **Páginas:** cada `page.tsx` de `app/(dashboard)`. Se detecta su guard: `requireWorkspaceAdmin`, `requirePermission`, `requireAnyPermission`, `listRoles`, el guard del layout de Agenda o solo `getWorkspace`.
- **Acciones:** cada export de `lib/actions/**`, incluidos los guards en helpers locales como `manage()`, `guard()`, `run()` o `context()`.
- **Rutas:** las de `app/api/v1/{flows,broadcasts,channels,messages,agent-runs}/**` y la de OAuth.
- **Lo que se dibuja:** el menú (`visibleNavItems`), las pestañas de Ajustes, los botones de cabecera (`pageActions`) y las pestañas del agente (`tabsForViewer`).

**Cómo funciona:**
- Cada entrada se evalúa para Owner, Admin y Member con el catálogo **de la misma versión del código**.
- Los casos que el escáner no entiende van en un mapa de excepciones explícito, cada una comentada. Por ejemplo, `setDoNotContact`, que tiene dos ramas.
- **Después de cada cambio:** Owner y Admin tienen que dar idénticos a la foto. El Member también, salvo las filas M1–M8, que van en la lista blanca `APPROVED_MEMBER_CHANGES` con su comentario.
- Se suman **`lib/actions/team.characterization.test.ts`** (invitar y aceptar hoy, con Supabase y Resend simulados) y la extensión de **`member-baseline.test.ts`** y **`member-permissions-characterization.test.ts`**. Ninguno se desactiva.

---

## 8. Plan por bloques

**Dependencias:** B1 va primero. B2, B3, B4 y B5 dependen solo de B1. B6 va al final. Si un bloque se traba después de un intento serio, lo anoto en PENDIENTE y sigo con los que no dependen de él.

### B1: Base de permisos (F1 a F5)

**Orden de trabajo:**
1. Caracterización (§7) en verde.
2. **F1. Catálogo nuevo** en `lib/auth/permissions.ts`:
   - 74 claves (72 visibles), con etiquetas y descripciones en castellano con tildes.
   - Campos `reserved` (`scheduling.team_events`, `workspace.transfer`) y `ownerOnly` (`team.remove`, `workspace.transfer`).
   - Grupos del §9.1 y `visiblePermissionKeys()`.
   - Member = 27 claves (§9.3). Admin = todas menos las `ownerOnly`. Sale `settings.manage`.
3. **F4. Retiro de `settings.manage`** archivo por archivo (§5).
4. **F5. Guards y menú:**
   - En `guards.ts`, `assertCanGrant` se re-exporta desde `lib/team/grant.ts`.
   - `adminOnly` pasa a `permissions` en el menú, los botones de cabecera y las pestañas del agente.
   - `lib/settings/tabs.ts` declara las claves de cada pestaña y suma `visibleSettingsTabs(can)`, pura.
   - "Ajustes" en el menú solo con alguna clave de gestión de Ajustes. Recursos tiene su propio ítem, así que el Member no ve Ajustes.
5. **`lib/team/grant.ts` (`assertCanGrant`, pura):**
   - Quien da, solo puede dar claves y alcances que tiene.
   - Admin lo dan solo Owner o Admin.
   - Nadie edita su propio rol (salvo Owner y Admin).
   - Nadie toca al Owner.
   - En B1 se escribe con sus casos de ataque del §12. Los callers llegan en B2 y B3.
6. **F2.** `lib/auth/catalog-usage.test.ts`, con una lista de excepciones temporal (las claves que llegan en B4/B5).
7. **F3.** Migraciones `00208` → `00209` → `00210` → `00211`, en ese orden, con su verificación después de cada una.

**Archivos:**
- Modificados: `lib/auth/{permissions,guards,roles-admin}.ts`, `lib/nav/{items,page-actions}.ts`, `lib/agent/agent-types.ts`, `lib/settings/tabs.ts`, `components/sidebar.tsx`, `components/settings/settings-tabs.tsx`, los 17 de §5 y `lib/types/database.ts` (regenerado).
- Nuevos: `lib/team/grant.ts`, `lib/auth/member-sql-parity.test.ts`, `lib/auth/catalog-usage.test.ts`.

**Tests:**
- `permissions.test.ts`, `member-permissions-characterization.test.ts` y `member-baseline.test.ts` (D28), actualizados.
- `nav/items.test.ts`: tabla con Owner, Admin, Member y tres roles de prueba.
- `settings/tabs.test.ts`: solo `products.manage` ve solo Productos.
- `grant.test.ts`.
- `member-sql-parity.test.ts`: lee la última definición de `member_permission_keys` y de `owner_only_keys` en `supabase/migrations/` y la compara con TS.

**`verify-roles.mjs` suma:**
- Member de sistema: `contacts.view` = true, `team.invite` = false.
- Admin: `team.remove` = false. Owner: true.
- Un rol con `settings.manage` creado ANTES de la 00211 queda con sus 4 sucesoras y sin la vieja.
- Las sucesoras de las claves partidas.
- **Las políticas de Tareas, Formularios y Recursos dan lo mismo antes y después de la 00208.** Para eso hay una tabla de pruebas por rol: Member de sistema, Member sin `role_id`, rol personalizado con la clave y sin ella. Los mismos casos se corren antes de aplicar y después.

**Listo cuando:** F1–F5 cumplen; `vitest` sale 0; `build` compila; lint sin errores nuevos; 00208–00211 aplicadas, registradas y verificadas; `verify-rls` y `verify-roles` en verde; la matriz da igual para Owner y Admin.

**Riesgos:**
- `has_permission` es la función más usada por la RLS. Se mitiga con la cabecera para volver atrás, la tabla de paridad y los casos de antes y después en `verify-roles`.
- Que el escáner de la matriz no entienda un guard. Se mitiga con el mapa de excepciones explícito.

### B2: Equipo e invitaciones (F6 a F11)

**Orden de trabajo:**
1. **F6.** La página `team` pide `team.view`. La lógica de qué controles ve cada uno va en `lib/team/view-model.ts` (`memberRowControls`), pura.
2. **F7. Invitar:**
   - Con cualquier rol que se pueda dar (`assertCanGrant`), y elegir entre "Enviar por email" o "Solo generar link".
   - Se guardan `role_id`, `role` base, `delivery` y el estado del email.
   - Si la persona ya es miembro (`workspace_member_profiles`), o si ya tiene una invitación vigente, se ofrece copiar su link.
   - Con `delivery='link'` no se llama a `sendTransactionalEmail` (test con espía).
   - Las escrituras van con el cliente de servicio después del guard.
3. **F8. Pendientes:**
   - `lib/team/invite-state.ts` (`inviteState`, pura) dice si está pendiente, vencida, aceptada o anulada.
   - Acciones: Copiar link (queda `invite_link_copied` en el audit), Reenviar (como mucho 1 cada 60 s y 5 en total), Renovar 7 días, y Anular, que pasa a ser un `UPDATE` de `status`, `revoked_at` y `revoked_by`.
4. **F9. Historial:** se agrupa y se ordena con una función pura, con filtro y de a 20.
5. **F10. Aceptar:**
   - `finalizeAcceptInvite` guarda `role` + `role_id`. Si el rol ya no existe, entra como Member de sistema.
   - Se guardan `accepted_at` y `accepted_by`.
   - El link sigue siendo `/invite/<id>`.
   - Una invitación anulada, aceptada o vencida muestra "Esta invitación ya no es válida" (la vencida agrega que pidan una renovación).
6. **F11. Cambiar rol, Closer y quitar:**
   - Cambiar rol y Closer: `team.manage` + `assertCanGrant`. Quitar: `team.remove`.
   - Reglas duras: nadie cambia su propio rol, nadie toca al Owner, nadie se quita a sí mismo y no se quita al último Owner.
   - Al audit van `member_role_changed`, `member_removed` e `invite_*`.
   - Los logs no llevan emails ni links.
7. **Migración `00212`.** Suma `private.can_grant(ws, permissions)`, la gemela en SQL de `assertCanGrant`, que cumple dos cosas:
   - Que alguien con `team.invite` o `roles.manage` no pueda, directo contra la base, invitar o asignar un rol más poderoso que el suyo.
   - Que no pueda editar su propio rol.

   Casos compartidos en `lib/team/grant.cases.json`, que corren contra TS y contra SQL.

**Archivos:**
- Modificados: `lib/actions/team.ts`, `components/settings/team-view.tsx`, `app/.../settings/team/page.tsx`, `app/invite/[inviteId]/{page,accept-invite-view}.tsx`.
- Nuevos: `lib/team/{view-model,invite-state,invite-history}.ts` y sus tests, `lib/actions/team.invite.test.ts`.

**Tests y verify:**
- `verify-roles`: un rol con `team.invite` puede insertar una invitación y uno sin la clave no; no puede invitar con un rol más poderoso que el suyo; no puede editar su propio rol.
- `verify-workspace-isolation`: alta con un rol personalizado; el invitado ya no puede editar su invitación.

**Listo cuando:** F6–F11 cumplen; `vitest` y `build` en verde; 00212 aplicada después del código; `verify-roles`, `verify-rls` y `verify-workspace-isolation` en verde; revisión visual hecha.

**Riesgo:** romper el alta de alguien que ya tiene un link enviado. Se mitiga probando una invitación vieja, sin `role_id`, de punta a punta en `verify-workspace-isolation`.

### B3: Pantalla de roles (F12 a F15)

1. **F12. Alcances dentro de cada grupo.**
   - `scopeFieldState(module, keys)` en `roles-admin.ts`, pura.
   - El selector queda deshabilitado con "Activá Ver … para elegir el alcance".
   - Formularios muestra un texto fijo. `eod.view_all` se muestra como un selector.
2. **F13. Guardado automático.**
   - `patchRole(roleId, {addKeys, removeKeys, scopes, name, description})` devuelve el rol resultante.
   - Cola serial pura en `lib/roles/save-queue.ts`.
   - Nombre y descripción se guardan a los 700 ms sin escribir y al salir del campo.
   - Si falla, el control vuelve a su valor anterior y aparece "Reintentar".
   - Se saca `window.location.reload()`.
   - La auditoría se agrupa por sesión de edición de 10 minutos (pura, en `lib/roles/audit-session.ts`).
   - Aviso "aplica ya a N personas".
3. **F14. Crear, duplicar y plantillas.**
   - "Nuevo rol" abre un diálogo con el nombre y "Empezar desde".
   - Plantillas en `lib/roles/templates.ts` (§10.4), filtradas por `assertCanGrant`.
   - Duplicar Member da las 27 claves.
4. **F15. Ver un rol de sistema y protecciones.**
   - Los roles de sistema tienen "Ver permisos" (solo lectura) y "Duplicar".
   - `roles.view` deja ver sin editar.
   - Se arregla la descripción duplicada en la vista, sin migración.
   - Nombres: "Banca de recursos", "Qué contactos ve", tildes.

**Archivos:** `components/settings/roles/roles-view.tsx` (se parte en tarjeta, editor y diálogo), `lib/actions/roles.ts`, `lib/auth/roles-admin.ts`, y los nuevos `lib/roles/*`.

**Tests:** `save-queue`, `audit-session`, `templates` (toda clave existe en el catálogo), `scopeFieldState`, y `patchRole` con los ataques del §12.

**Listo cuando:** `vitest` y `build` en verde y la revisión visual hecha. No tiene migración.

**Riesgo:** perder un cambio entre dos guardados seguidos. Se mitiga con la cola serial y su test.

### B4: Ajustes e integraciones (F16 a F19)

1. **F16. General partido en dos.**
   - La página pide `settings.general` o `sales.settings`.
   - Las secciones salen de `lib/settings/general-sections.ts`.
   - Cada acción de `workspace.ts` y `opt-out.ts` chequea su clave y escribe con el cliente de servicio, filtrando por el workspace de la sesión. `updateBackgroundSettings` usa `ai_tasks.manage`.
2. **F17. Cada pestaña con su clave:**
   - Campos → `custom_fields.manage`.
   - Productos → `products.manage`.
   - Asignación → `assignment.manage`.
   - Actividad → `audit.view`.
3. **F18. Integraciones en tres secciones.**
   - Las secciones salen de `lib/integrations/sections.ts`, pura.
   - "Mis conexiones" reusa `CalendarsView` y `MiFathomCard`, sin tocar `lib/oauth/*`, los refresh tokens ni `claim_oauth_refresh`.
   - Canales: `/dashboard/channels` y las 7 rutas de `api/v1/channels/*` pasan a `channels.manage`.
   - Integraciones del negocio pasan a `integrations.manage`. Con `integrations.view` se ve el estado, en "Solo lectura".
   - La rama no personal de `oauthRouteContext` pasa a `getPermissionAction("integrations.manage")`. Las dos ramas personales quedan igual.
   - Los archivos de D18 pasan a su clave.
4. **F19. Webhooks.** `webhook-endpoints.ts`, `webhook-flow-editor.ts` y sus páginas pasan a `webhooks.manage`. La lista de solo lectura sigue para `integrations.view`.
5. **Migración `00213`**, después del código.

**Tests:** `general-sections`, `integrations/sections`, acciones que rechazan sin tocar la base, y la ruta `channels/connect` con 403.

**Listo cuando:** `verify-rls`, `verify-roles`, `verify-audit-visibility` y `verify-inbound-webhooks` en verde, y revisión visual hecha.

**Riesgos:**
- Romper el OAuth personal. Se mitiga con un test que fija las tres ramas de `oauthRouteContext`.
- Que `integration_configs` SELECT con `integrations.view` muestre secretos. No pasa: los secretos viven en Vault.

### B5: Módulos (F20 a F24)

Antes de empezar: `sync_with_base_branch` (D3).

1. **F20. Bandeja por canal.**
   - `visibleChannels(perms)` en `lib/inbox/` filtra la lista de conversaciones y los filtros de canal.
   - `inbox.<canal>.reply` habilita el composer, `api/v1/messages` (403 sin llamar al proveedor; test con espía), los borradores del agente y el envío de recursos.
2. **F21. Contactos:**
   - Página → `contacts.view`.
   - Editar → `contacts.edit`.
   - Importar → `contacts.import`.
   - Borrar y restaurar → `contacts.delete`.
   - Asignar → `contacts.assign`.
   - Fusionar → `contacts.merge`.
   - `dismissLinkSuggestion` y "no contactar", según la decisión 6.
   - Efectos de etiquetas → `tags.manage`.

   **Solo guards. No toco** `lib/contacts/find-or-create.ts`, `find_or_create_contact`, `find_or_link_contact`, `record_contact_touch`, `create_booking` ni `submit_form_response`.
3. **F22. Automatizaciones, secuencias y broadcasts:**
   - `api/v1/flows/*`: GET → `flows.view`; escribir → `flows.edit`; publicar y restaurar → `flows.publish`.
   - Secuencias → `sequences.edit` para escribir y `sequences.view` para leer (`enrollContact` según la decisión 6).
   - Broadcasts → `broadcasts.manage`.
   - El menú de Automatizaciones → `flows.view`.
4. **F23. Agentes y Conocimiento:**
   - Agentes → `agents.view` para ver y `agents.edit` para las 14 acciones, salvo los topes y precios de modelos → `ai_limits.manage`.
   - `ai-tasks.ts` y `/agents/tareas/[task]` → `ai_tasks.manage` (las de llamadas también con `calls.configure`).
   - Conocimiento → `knowledge.view` y `knowledge.edit`.
5. **F24. Contenido, dashboards y exportar:**
   - `/content` → `content.view`.
   - Dashboards → `dashboards.chat.view` y `dashboards.unified.view`.
   - Exportar → `canExport(perms)`, pura, en `lib/auth/export.ts`, aplicada a los 4 exports de D26: endpoint y botón.
6. **Los `isAdminRole` de páginas** (D17) pasan a la clave equivalente. Regla: Owner y Admin true, Member igual que hoy.
7. **Migración `00214`**, después del código.
8. `catalog-usage.test.ts` **sin excepciones**.

**Tests:** cada ruta con Supabase simulado (403 sin `flows.publish`), `visibleChannels`, `canExport`, y M1, M2, M3 y M6 con su comentario.

**Listo cuando:** `verify-rls`, `verify-roles`, `verify-crm`, `verify-inbox-filters` y `verify-tasks` en verde, y revisión visual del menú hecha.

**Riesgo:** conflictos con la sesión de contactos (D3). Se mitiga con guards de una línea y el sync antes de empezar.

### B6: Verificación y cierre (F25 y F26)

- **`scripts/verify-permissions-matrix.mjs`:**
  - Mismo estilo que los demás: usuarios reales, prefijo `zz-test-`, limpieza obligatoria.
  - Crea un rol personalizado por grupo del §9.1, con solo las claves de ese grupo.
  - Prueba contra la base que cada tabla del §8.4 (y las 10 extra) deja y niega lo esperado.
  - Prueba también Member de sistema y Admin.
- **`docs/roles.md` reescrito:** catálogo, alcances, quién puede dar qué, y "cómo sumar una clave nueva en 5 pasos" (catálogo, pantalla, guard, RLS, test de uso).
- **`CLAUDE.md`:** la sección "Roles personalizados" con "Lo que no se puede romper" y la próxima migración libre (`00215`, salvo que contactos haya usado otra).
- **PENDIENTE:**
  - Limpiar los `zz-test-alcance-*` que queden. No se borran.
  - Workspaces sin miembros (D5).
  - Transferir la propiedad (queda como clave reservada).
- **PR:** `gh pr create` de `feat/equipo-roles` a `main`, con la lista M1–M8 arriba de todo y el resumen de PROGRESS y PENDIENTE. **No se mergea.**

**Definición de listo de la fase:**
- Todo lo del `/goal`.
- La foto de la matriz da igual para Owner y Admin, y para el Member solo cambian M1–M8.
- `audit_log_select` no cambió (se compara su definición en `verify-audit-visibility`).
- El OAuth personal y la lógica de contactos no se tocaron: test de las tres ramas de OAuth y huellas md5 de las funciones de contactos.

---

## 9. Reglas para toda la corrida

- **Ritmo:**
  - `npx vitest run` después de cada funcionalidad.
  - Después de cada bloque: marcar PROGRESS, commit `feat: equipo-roles - bloque Bn (nombre)` y `git push origin feat/equipo-roles`.
  - Los commits van con rutas explícitas, nunca `git add -A`, porque hay sesiones en paralelo.
- **Nunca:**
  - Debilitar un permiso, un test existente ni una política de RLS para destrabar algo.
  - Darle a Owner o Admin menos de lo que tienen hoy.
  - Desactivar `member-baseline.test.ts`.
- **Sin secretos nuevos, sin variables de entorno nuevas, sin dependencias nuevas** y sin `dangerouslySetInnerHTML`. No cambio configuración real: ni Railway, ni las variables de producción, ni Resend.
- **Nada externo de verdad:** Resend, Zernio, Evolution, Meta, Google y Fathom van simulados en los tests.
- **Lógica de pantalla en funciones puras de `lib/` con test:** controles de Equipo, estado de invitaciones, secciones de General e Integraciones, selector de alcance, pestañas y menú. Los componentes solo las componen.
- **No toco nada fuera de lo que pide el plano.** El §11.2 ("No cambia") se cumple literalmente.
- **Revisión visual de B2, B3, B4 y B5**, con el navegador propio, a 1440 y 390 px, en tema claro y oscuro. Pantallas: Equipo (miembros, invitar, pendientes, historial), Roles (guardado automático, alcances, nuevo rol, ver rol de sistema), Ajustes → General, Integraciones (tres secciones) y menú lateral. Si la app pide login y no hay sesión, lo anoto. Nunca escribo credenciales.
- **Cierre:** un PR sin merge. Después de aprobar este plan solo escribo los documentos del §0 y **freno hasta tu `/goal`**.

---

## 10. Verificación de punta a punta

- **Tests:** `npx vitest run`, con la matriz, `member-baseline`, `member-sql-parity`, `catalog-usage` sin excepciones y `grant`.
- **Build y lint:** `npm run build`, y `npm run lint` con ≤ 36 warnings y 0 errores.
- **Verificaciones contra la base, de a uno:**
  - `verify-permissions-matrix`
  - `verify-roles --despues-de-00136`
  - `verify-rls --despues-de-00143`
  - `verify-workspace-isolation --despues-de-00143`
  - `verify-audit-visibility --despues-de-00168`
  - `verify-crm`, `verify-inbox-filters`, `verify-inbound-webhooks`, `verify-tasks`
  - el resto que pasaba en el punto de partida
- **Consultas de control:**
  - `count(*) where role_id is null` = 0 (al aplicar la 00210).
  - `settings.manage` no aparece en ninguna política viva (`pg_policies`).
  - La definición de `audit_log_select` es igual a la de hoy.
- **Revisión visual** a 1440 y 390 px, en claro y oscuro, o anotada si no hay sesión.

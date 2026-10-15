# Roles, permisos y equipo

Hasta la Etapa 2, un permiso era una sola pregunta: *¿es Owner o Admin?*. Hoy cada pantalla, cada acción y cada tabla de la base
pregunta por **su propia clave**, y un rol personalizado es una lista de esas claves. Este documento es la referencia de cómo
funciona; el plano original está en [requerimientos-equipo-roles.md](requerimientos-equipo-roles.md) y el avance en
[PROGRESS-equipo-roles.md](PROGRESS-equipo-roles.md).

## Los tres roles de sistema

Vienen con cada negocio y **no se editan**.

| Rol | Qué puede |
|---|---|
| **Owner** | Todo, incluidas las dos claves solo-Owner: quitar personas del equipo y (reservada) transferir la propiedad. |
| **Admin** | Todas las claves menos las solo-Owner. |
| **Member** | Las 28 claves de la tabla de abajo (columna «Member»): atender los leads asignados, crear contenido, ver y usar Agenda, Ventas, Tareas y Formularios, ver sus propias comisiones, y poco más. |

La lista de permisos del Member vive en **dos** lugares que tienen que ser iguales: `MEMBER_PERMISSION_KEYS` (TypeScript) y
`private.member_permission_keys()` (SQL, migración 00208). El test `lib/auth/member-sql-parity.test.ts` los compara y falla si se separan.
Lo que puede un Member también lo fija `lib/auth/member-baseline.test.ts`, que recorre las páginas y acciones del código real.

### Qué cambió para el Member (equipo y roles, octubre 2026)

Cada fila tiene su test y el comentario «cambio aprobado».

| # | Cambio | Antes | Ahora |
|---|---|---|---|
| M1 | Importar contactos desde CSV | podía | **no** (`contacts.import`) |
| M2 | Exportar CSV (corridas de IA, respuestas de formularios, reportes de fin de día) | podía | **no**, y el botón no se muestra (`canExport`) |
| M3 | Webhooks entrantes | podía | **no** (`webhooks.manage`) |
| M6 | Broadcasts | podía | **no** (`broadcasts.manage`) |
| M7 | Que lo que publica se dispare de verdad | el disparador fallaba en silencio | **sí** (`triggers` pide `flows.edit`) |
| M8 | Entrar a Integraciones por la URL | lo rebotaba | ve solo «Mis conexiones». El menú cambió por el rediseño de Formularios: Integraciones y Recursos son pestañas de Ajustes, y «Ajustes» lo ve cualquiera (entra a Recursos) |
| M9 | Ver sus propias comisiones (Extra I) | no existía | **sí**, solo `commissions.view` con alcance `own`: ve «Finanzas» en el menú pero ninguna pestaña de gastos. NO tiene `commissions.manage` ni `expenses.*` |
| M4, M5 | Reasignar los leads que ve; publicar flujos | podía | sin cambios |

## El catálogo: 78 claves

La fuente es `lib/auth/permissions.ts`. Los permisos de Owner, Admin y Member **salen de ahí**, no de la base: la fila de un rol de sistema
tiene los permisos vacíos a propósito. Las claves *reservadas* existen pero no se muestran ni se dan todavía; las *solo Owner* no viajan en
ningún rol (ni el Owner las da).

### Dashboards

| Clave | Qué permite | Member |
|---|---|---|
| `dashboards.chat.view` | Ver el dashboard de chat | sí |
| `dashboards.content.view` | Ver el dashboard de contenido | — |
| `dashboards.ads.view` | Ver el dashboard de anuncios | — |
| `dashboards.agenda.view` | Ver el dashboard de agenda | — |
| `dashboards.unified.view` | Ver el dashboard unificado | — |

### Social

| Clave | Qué permite | Member |
|---|---|---|
| `social.view` | Ver la página Social | — |

### Bandeja

| Clave | Qué permite | Member |
|---|---|---|
| `inbox.instagram.view` | Ver conversaciones de Instagram | sí |
| `inbox.instagram.reply` | Responder por Instagram | sí |
| `inbox.whatsapp.view` | Ver conversaciones de WhatsApp | sí |
| `inbox.whatsapp.reply` | Responder por WhatsApp | sí |
| `inbox.email.view` | Ver conversaciones de email | sí |
| `inbox.email.reply` | Responder emails | sí |

### Contactos

| Clave | Qué permite | Member |
|---|---|---|
| `contacts.view` | Ver contactos | sí |
| `contacts.edit` | Editar contactos | sí |
| `contacts.import` | Importar contactos | — |
| `contacts.delete` | Borrar contactos | — |
| `contacts.assign` | Reasignar contactos | sí |
| `contacts.merge` | Fusionar contactos | — |
| `tags.manage` | Administrar etiquetas | — |
| `custom_fields.manage` | Administrar campos personalizados | — |
| `assignment.manage` | Administrar reglas de asignación | — |

### Automatizaciones

| Clave | Qué permite | Member |
|---|---|---|
| `flows.view` | Ver automatizaciones | sí |
| `flows.edit` | Editar automatizaciones | sí |
| `flows.publish` | Publicar automatizaciones | sí |
| `sequences.view` | Ver secuencias | sí |
| `sequences.edit` | Editar secuencias | — |
| `broadcasts.manage` | Enviar broadcasts | — |
| `webhooks.manage` | Administrar webhooks | — |

### Banca de recursos

| Clave | Qué permite | Member |
|---|---|---|
| `templates.manage` | Administrar la banca de recursos | — |

### Agente de IA

| Clave | Qué permite | Member |
|---|---|---|
| `agents.view` | Ver el agente | sí |
| `agents.edit` | Editar el agente | — |
| `ai_costs.view` | Ver los costos de IA | — |
| `ai_tasks.manage` | Administrar las tareas de IA | — |
| `ai_limits.manage` | Administrar topes y precios de IA | — |

### Base de conocimiento

| Clave | Qué permite | Member |
|---|---|---|
| `knowledge.view` | Ver la base de conocimiento | — |
| `knowledge.edit` | Editar la base de conocimiento | — |

### Contenido

| Clave | Qué permite | Member |
|---|---|---|
| `content.view` | Ver el tablero de contenido | sí |
| `content.create` | Crear y editar piezas | sí |
| `content.approve` | Aprobar y devolver piezas | — |
| `content.publish` | Programar y publicar | — |
| `content.ai` | Generar copy con IA | — |

### Agenda

| Clave | Qué permite | Member |
|---|---|---|
| `scheduling.use` | Tener agenda propia | sí |
| `scheduling.manage_others` | Configurar agendas ajenas | — |
| `scheduling.team_events` | Crear eventos de equipo _(reservada)_ | — |
| `scheduling.manage_categories` | Administrar áreas y tipos de agenda | — |
| `bookings.view` | Ver agendas | sí |
| `bookings.manage` | Gestionar agendas | sí |

### Llamadas

| Clave | Qué permite | Member |
|---|---|---|
| `calls.view` | Ver las llamadas | sí |
| `calls.edit` | Editar las llamadas | — |
| `calls.configure` | Configurar el análisis de llamadas | — |

### Formularios

| Clave | Qué permite | Member |
|---|---|---|
| `forms.view` | Ver formularios y respuestas | sí |
| `forms.manage` | Crear y publicar formularios | — |
| `eod.view_all` | Ver los reportes de fin de día de todo el equipo | — |

### Ventas

| Clave | Qué permite | Member |
|---|---|---|
| `sales.view` | Ver las ventas | sí |
| `sales.manage` | Cargar y editar ventas | sí |
| `payments.manage` | Gestionar los pagos | sí |
| `products.manage` | Administrar productos | — |
| `sales.settings` | Configurar ventas y cobranza | — |

### Finanzas

| Clave | Qué permite | Member |
|---|---|---|
| `expenses.view` | Ver Finanzas | — |
| `expenses.manage` | Administrar gastos | — |

### Comisiones

| Clave | Qué permite | Member |
|---|---|---|
| `commissions.view` | Ver comisiones (el alcance decide si ve todas o solo las que tiene a su nombre) | sí (alcance `own`) |
| `commissions.manage` | Administrar comisiones: reglas y roles, liquidaciones, asignar persona, anular y ajustes | — |

El menú «Finanzas» se ve con `expenses.view` **o** `commissions.view` (`FINANCE_ENTRY_PERMISSIONS`, `lib/finance/tabs.ts`); adentro, cada pestaña pide su propia clave.

### Tareas

| Clave | Qué permite | Member |
|---|---|---|
| `tasks.view` | Ver las tareas | sí |
| `tasks.edit` | Crear y editar tareas | sí |
| `tasks.delete` | Borrar tareas | — |

### Integraciones

| Clave | Qué permite | Member |
|---|---|---|
| `integrations.view` | Ver las integraciones | — |
| `integrations.manage` | Administrar integraciones | — |
| `channels.manage` | Administrar canales | — |

### Equipo

| Clave | Qué permite | Member |
|---|---|---|
| `team.view` | Ver el equipo | — |
| `team.invite` | Invitar personas | — |
| `team.manage` | Administrar el equipo | — |
| `team.remove` | Quitar personas del equipo _(solo Owner)_ | — |
| `roles.view` | Ver los roles | — |
| `roles.manage` | Administrar roles | — |

### Configuración

| Clave | Qué permite | Member |
|---|---|---|
| `settings.general` | Cambiar la configuración general | — |
| `audit.view` | Ver la actividad | — |
| `data.export` | Exportar datos | — |
| `workspace.transfer` | Transferir la propiedad _(solo Owner, reservada)_ | — |

## Alcances

Además de *qué* puede hacer, un rol define *cuánto ve* en siete módulos: `leads`, `conversations`, `bookings`, `calls`, `sales`, `commissions`, `tasks`. Un rol sin alcance de comisiones queda en `own` (lo más angosto).

| Alcance | Qué significa |
|---|---|
| `own` | Lo que tiene asignado. |
| `own_unassigned` | Lo asignado más lo que no tiene a nadie. |
| `all` | Todo el negocio. |

**El alcance lo aplica la base** (`can_see_contact`, `can_see_conversation`, `can_see_booking`, `can_see_call`, `can_see_sale`, `can_see_task`, y la política de lectura de comisiones), no la
pantalla. En la pantalla de Roles el selector de alcance vive dentro de su grupo y se activa recién cuando el rol tiene la clave «ver» de ese grupo.

## Quién puede dar qué («no podés dar lo que no tenés»)

Quien puede invitar, asignar roles o armar roles **no puede, por ese camino, darle a nadie más de lo que tiene**. Es la regla que impide que un rol
con `team.invite` invite como Admin o que uno con `roles.manage` se arme un rol con todo.

- Una clave solo-Owner o reservada no entra en ningún rol.
- Un Owner o un Admin pueden dar todo lo demás; el resto, solo las claves y alcances que ya tiene.
- El rol Admin lo dan solo un Owner o un Admin. El rol Owner no se da (se transfiere).
- Nadie se cambia su propio rol; nadie edita el rol que tiene asignado (salvo Owner y Admin, que no dependen de uno); nadie toca al Owner.
- Al editar un rol solo hay que poder dar lo que se **agrega**: sacar permisos nunca es una escalada.

Hay dos gemelas con los mismos casos (`lib/team/grant.cases.json`): `assertCanGrant` en TypeScript (`lib/team/grant.ts`) y
`public.can_grant_permissions` en SQL (migración 00212). La segunda es la que protege a quien arme el pedido a mano. La corre
`verify-roles.mjs --despues-de-00212`.

## Equipo e invitaciones

Pantalla: **Ajustes → Equipo y roles**.

- **Invitar** con cualquier rol que se pueda dar, por email o con «Solo generar link» (no se manda correo). El link es `/invite/<id>`.
- **Pendientes**: copiar link, reenviar (como mucho una vez por minuto y cinco en total), renovar siete días y anular. Anular deja la fila como
  «anulada» en el historial; no la borra.
- **Historial**: aceptadas, anuladas y vencidas, agrupado y de a veinte.
- **Aceptar** guarda `role` y `role_id`; si el rol personalizado ya no existe, la persona entra como Member de sistema.
- **Cambiar rol y Closer** piden `team.manage`; **quitar a alguien** pide `team.remove` y es solo del Owner.
- Cada paso queda en el registro de auditoría (`invite_*`, `member_role_changed`, `member_removed`), sin emails ni links.

## Roles

Pantalla: **Ajustes → Equipo y roles → Roles**. Cada tilde y cada selector **se guarda solo** (`patchRole`), con una cola serial para que dos cambios
seguidos no se pisen; si falla, el control vuelve a su valor y aparece «Reintentar». Hay plantillas (`lib/roles/templates.ts`), duplicar y «Ver permisos»
de los roles de sistema. Un rol con gente asignada no se borra.

## Qué tabla pide qué clave

La base repite el permiso aunque alguien se saltee la pantalla. Migraciones 00208 a 00214.

| Tabla | Operación | Clave |
|---|---|---|
| `workspace_invites` | insertar / cambiar / borrar | `team.invite` (y `can_give_role`) |
| `workspace_members` | cambiar | `team.manage` (y `can_give_role`; nunca al Owner) |
| `workspace_members` | borrar | Owner con `team.remove` |
| `workspace_roles` | insertar / cambiar / borrar | `roles.manage` (nunca un rol de sistema, ni el propio) |
| `custom_field_definitions` | insertar / cambiar | `custom_fields.manage` |
| `integration_configs` | ver | `integrations.view`, `integrations.manage` o (si es un canal) `channels.manage` |
| `integration_configs` | escribir | `integrations.manage` o (si es un canal) `channels.manage` |
| `social_accounts` | escribir | `integrations.manage` |
| `channels` | escribir | `channels.manage` |
| `csv_imports` | ver | `contacts.import`, o haberla hecho uno mismo |
| `audit_log` | ver | política adicional `audit_log_select_audit` con `audit.view` (la de siempre no se toca) |
| `flows` | ver / escribir | `flows.view` / `flows.edit` |
| `triggers` | escribir | `flows.edit` |
| `sequences` | escribir | `sequences.edit` |
| `tags` | escribir con efectos | `tags.manage` (la etiqueta simple la crea cualquiera) |
| `agents` | insertar / cambiar | `agents.edit` |
| `agent_prompt_versions` | insertar / ver | `agents.edit` |
| `ai_task_prompt_versions` | insertar / ver | `ai_tasks.manage` o `calls.configure` |
| `knowledge_base` | escribir | `knowledge.edit` |
| `contacts` | borrar | `contacts.delete` |
| `products`, `product_variants` | insertar / cambiar | `products.manage` |
| `assignment_rules` | insertar / cambiar | `assignment.manage` |
| `content_pillars` | insertar / cambiar | `settings.general` |

**No se tocan** (siguen en Admin): `workspaces` (se escribe con el cliente de servicio después del guard), `model_pricing`, `email_log`,
`automation_events`, `oauth_connections`, `message_categories`, `message_texts`, `notifications`, `conversations` (borrar), `sequence_enrollments` (borrar),
`contact_notes`, `agent_runs`, `agent_drafts`, `content_*`, `meta_ads_insights_daily` y `booking_categories`. Las conexiones personales (Google Calendar,
Fathom) no cambian: son de cada persona.

## Cómo sumar una clave nueva (5 pasos)

1. **Catálogo**: agregarla a `PERMISSION_KEYS` en `lib/auth/permissions.ts` (etiqueta y descripción con tildes). Si el Member la tiene, sumarla también a
   `MEMBER_PERMISSION_KEYS` **y** a `private.member_permission_keys()` en una migración nueva (el test de paridad lo exige).
2. **Pantalla**: ubicarla en su grupo del editor de roles (sale sola del catálogo) y, si es de un módulo con alcance, ver `SCOPE_GROUP` en
   `lib/auth/roles-admin.ts`.
3. **Guard**: pedirla en la página (`requirePermission`), en cada acción (`getPermissionAction`) y en el menú o la pestaña (`permissions` en
   `lib/nav/items.ts`, `lib/settings/tabs.ts`, `lib/agent/agent-types.ts`). Nunca `isAdminRole`.
4. **Base**: si una tabla la tiene que repetir, una política con `(select public.has_permission(workspace_id, '<clave>'))`, en una migración idempotente
   con «Cómo volver atrás» y sin tocar `audit_log_select`.
5. **Test de uso**: `lib/auth/catalog-usage.test.ts` falla si una clave del catálogo no se usa en ningún guard, menú o política. Después correr
   `node scripts/verify-permissions-matrix.mjs`.

## Para quien toque el código

- En el servidor: `requirePermission(key)` y `requireAnyPermission([...])` para páginas; `getPermissionAction(key)` y `getAnyPermissionAction([...])` para acciones;
  `getMemberAction()` para lo que usa cualquier miembro (conectar el propio Fathom). `requireWorkspaceAdmin` y `getAdminContext` ya casi no se usan: lo que
  quede es «ve todo» (alcance), no «puede hacer».
- Lo que escribe `workspaces` va con el cliente de servicio **después** del guard de la clave (la política de `workspaces` sigue en Admin).
- En la base: `has_permission(workspace_id, key)` (nunca NULL; el Member de sistema usa `member_permission_keys()`) y `permission_scope(workspace_id, module)`.
- La lógica de pantalla vive en funciones puras de `lib/` con test (`lib/team/*`, `lib/roles/*`, `lib/settings/*`, `lib/integrations/sections.ts`,
  `lib/inbox/channel-access.ts`, `lib/auth/export.ts`); los componentes solo las componen.
- `lib/auth/access-matrix.characterization.test.ts` guarda una foto de qué guard usa cada página, acción y ruta, y exige que Owner y Admin queden idénticos y que
  el Member solo cambie en las filas aprobadas (`APPROVED_MEMBER_CHANGES`).
- Verificaciones contra la base real (de a una, con prefijo `zz-test-`):

```
node scripts/verify-roles.mjs --despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212
node scripts/verify-permissions-matrix.mjs
node scripts/verify-rls.mjs --despues-de-00143 --despues-de-00208
node scripts/verify-workspace-isolation.mjs --despues-de-00143
node scripts/verify-audit-visibility.mjs --despues-de-00168
```

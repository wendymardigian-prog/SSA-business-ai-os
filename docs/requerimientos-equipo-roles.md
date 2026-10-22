# Requerimientos — Sistema Operativo de Negocio con IA (SSA)
## Extra — Equipo, roles, permisos e invitaciones (consolidación)

Versión: 1.0 · Fecha: 13/10/2026 · Cliente: SSA (Wendy Mardigian)
Tipo: **brownfield** (cambio sobre un sistema en producción). Base: `claude/auditoria-equipo-roles.md`.

---

## 1. Mapa de ruta

| Etapa / Extra | Estado |
|---|---|
| Etapa 1 (base, CRM, bandeja, agente) | Construida |
| Etapa 2 (contenido, métricas, email, **roles personalizados F68–F72**) | Construida |
| Etapa 3 (agente integral, Fathom/Llamadas) | Construida |
| Etapa 4 (agenda) · Ventas Fase 1 · Formularios + EOD · Extra L (webhooks y atribución) | Construidos |
| Extra A — Tareas | **En construcción** (`feat/tareas`) |
| **→ Este Extra: Equipo, roles, permisos e invitaciones** | **Se construye después de mergear Tareas** |
| Asistente, CX Fase 2, Gastos | Planificados (suman sus propias claves al catálogo) |

**Qué se contempla sin construirse:** el Asistente (`requerimientos-asistente.md`) suma `assistant.use`, `assistant.configure` y `agent_skills.manage`. Gastos y CX sumarán las suyas. Este Extra deja el mecanismo listo para que cada módulo nuevo agregue claves **en el catálogo, la pantalla, el guard, la RLS y el test de uso**, todo en el mismo bloque (regla §5.3).

**Rama:** `feat/equipo-roles` desde `origin/main` actualizado, **después** de que Tareas esté mergeado. Tareas modifica `lib/auth/permissions.ts`, `roles-view.tsx`, `roles-admin.ts` y `lib/types/database.ts`; construir en paralelo garantiza conflictos.

---

## 2. Cambios en la base de datos y riesgos

> Numeración **tentativa**: Tareas reservó `00196`–`00199`. Antes de escribir la primera, `list_migrations` y continuar desde la última real. Cada migración es idempotente y copia en su cabecera, letra por letra, la definición vieja de todo lo que reescribe.

| N° | Qué hace | Tipo | Riesgo | Reversible |
|---|---|---|---|---|
| 00200 | `has_permission` v2: entiende al Member de sistema (lista de claves en SQL), al Member sin `role_id` y las claves solo-Owner; nueva `private.member_permission_keys()` | **Modifica lógica existente** | **Alto** | Sí (definición vieja en la cabecera) |
| 00201 | `workspace_invites` suma `role_id`, `delivery`, `email_status`, `email_error`, `last_sent_at`, `send_count`, `accepted_at`, `accepted_by`, `revoked_at`, `revoked_by` | Aditiva | Bajo | Sí (drop columns) |
| 00202 | Backfill: miembros con `role_id` nulo → su rol de sistema (mismo UPDATE que la 00088) | Modifica datos existentes | Medio | Sí (las 3 filas se listan en la cabecera) |
| 00203 | Migra el jsonb de los roles personalizados: `settings.manage` → sus reemplazos (§9.2) | Modifica datos existentes | Bajo (0 filas hoy) | Sí (respaldo del jsonb en la cabecera) |
| 00204 | RLS de equipo: `workspace_invites`, `workspace_members`, `workspace_roles` pasan de `is_workspace_admin` a permisos | **Modifica lógica existente** | **Alto** | Sí |
| 00205 | RLS de ajustes e integraciones: `custom_field_definitions`, `integration_configs`, `social_accounts`, `channels`, `csv_imports`; política ADICIONAL `audit_log_select_audit` | **Modifica lógica existente** | **Alto** | Sí |
| 00206 | RLS de módulos: `flows`, `triggers`, `sequences`, `tags`, `agents`, `agent_prompt_versions`, `ai_task_prompt_versions`, `knowledge_base`, `contacts` (delete) | **Modifica lógica existente** | **Alto** | Sí |

**Qué se aprueba (las de riesgo alto):**
- **00200** — La función que la base usa para preguntar "¿esta persona tiene tal permiso?" hoy dice **siempre que no** para el Member de sistema, porque sus permisos viven solo en TypeScript. Por eso casi ninguna política puede usarla y quedan los "solo Admin". Se le enseña la lista del Member (una copia en SQL que un test compara contra TypeScript) y que Admin no tiene las dos claves solo-Owner (`workspace.transfer`, `team.remove`). Para Owner, Admin y roles personalizados responde igual que hoy.
- **00204** — Invitar, cambiar roles, quitar personas y editar roles deja de exigir "ser Admin" en la base y pasa a exigir el permiso. Para Owner y Admin no cambia nada. Arregla el error de hoy: un rol con `roles.manage` no podía guardar un rol.
- **00205** — Campos personalizados, integraciones, cuentas sociales, canales e importaciones pasan a su permiso. El historial de actividad suma una política **adicional** (no se reescribe `audit_log_select`, regla del proyecto).
- **00206** — Automatizaciones: hoy **cualquier miembro** puede crear o borrar flujos desde la base. Pasa a `flows.edit`. Secuencias, etiquetas con efectos, agente, tareas de IA y conocimiento pasan de "solo Admin" a su permiso.

**Orden contra el deploy:**
- 00200–00203 se pueden aplicar **antes** de desplegar: el código viejo sigue andando (Owner/Admin dan igual, y el Member gana permisos en la base solo donde una política nueva los pida).
- 00204–00206 se aplican **cada una después de desplegar el código de su bloque** (B2, B4, B5). El código viejo funciona igual contra ellas para Owner y Admin; se ordenan así para que cada bloque se verifique junto con su RLS.
- Ninguna rompe la app si se aplica sin el código nuevo.

**Qué pasa con los datos existentes (medido el 13/10/2026):**
- `workspace_members`: 5 filas. 3 sin `role_id` (1 Admin, 2 Owners) → la 00202 les pone su rol de sistema. Nada más cambia.
- `workspace_roles` personalizados: "Content Manager" (21 claves, 0 personas) y dos restos de prueba `zz-test-alcance-*`. Ninguno tiene `settings.manage`: la 00203 no cambia filas hoy, pero se escribe para cualquier clon.
- `workspace_invites`: 2 filas. Las columnas nuevas quedan nulas; `delivery` queda `'email'` por default en las viejas. Las anuladas siguen como `revoked`.
- No se borra ningún dato. No hay migración irreversible.

**Cómo se verifica después de aplicar:**
```
node scripts/verify-rls.mjs --despues-de-00143
node scripts/verify-roles.mjs --despues-de-00136        # + los casos nuevos de B1/B2/B4/B5
node scripts/verify-workspace-isolation.mjs              # alta por invitación
node scripts/verify-audit-visibility.mjs --despues-de-00168
node scripts/verify-permissions-matrix.mjs               # NUEVO (B6)
```
Consulta de control de la 00202: `select count(*) from workspace_members where role_id is null` → 0.

**Cómo se vuelve atrás:** cada migración de riesgo alto lleva en su cabecera las políticas y la función viejas completas; volver atrás es ejecutar ese bloque. La 00202 lista los `user_id` que tocó.

---

## 3. Objetivo y mapa de bloques

**Objetivo:** que cada cosa que se ve en la pantalla de roles haga exactamente lo que dice, en la página, en la acción del servidor y en la base, y que invitar y administrar el equipo sea completo y seguro.

**Por qué ahora:** el equipo de SSA va a crecer (setters, closers, content) y hoy la pantalla de roles promete cosas que no cumple. 18 de las 54 claves no hacen nada, y 111 chequeos de "es Owner/Admin" ignoran el catálogo. Además el Asistente, que viene después, usa los mismos permisos que la persona: si los permisos no son reales, el Asistente tampoco lo será.

| Bloque | Qué se construye | Contexto compartido |
|---|---|---|
| **B1 — Base de permisos** | Catálogo nuevo, `has_permission` v2, paridad TS↔SQL, retiro de `settings.manage`, test de uso de claves, helpers de guard y de menú | `lib/auth/*`, `lib/nav/items.ts`, `lib/settings/tabs.ts`, 00200, 00203 |
| **B2 — Equipo e invitaciones** | Miembros, invitaciones (email o link), pendientes, historial, rol personalizado al invitar, regla de "no dar más de lo que tenés" | `lib/actions/team.ts`, `team-view.tsx`, `/invite`, 00201, 00202, 00204 |
| **B3 — Pantalla de roles** | Alcances dentro de cada grupo, autosave, duplicar, plantillas, ver rol de sistema, protección del rol propio | `roles-view.tsx`, `lib/actions/roles.ts`, `roles-admin.ts` |
| **B4 — Ajustes e integraciones** | General partido, Campos, Productos, Asignación, Actividad, Integraciones (negocio / canales / mis conexiones), Webhooks | `/dashboard/settings/*`, `/channels`, `api/v1/channels/*`, `lib/actions/{integrations,custom-fields,products,assignment-rules,workspace,webhook-endpoints}.ts`, 00205 |
| **B5 — Módulos** | Bandeja por canal, Contactos, Automatizaciones/Secuencias/Broadcasts, Agentes IA/Conocimiento, Contenido, Dashboards, Exportar | páginas y acciones de cada módulo, `api/v1/flows/*`, 00206 |
| **B6 — Verificación y cierre** | Matriz de permisos de punta a punta, docs, CLAUDE.md, pendientes | `scripts/`, `docs/roles.md` |

Cada bloque es una corrida de Claude Code. El orden importa: B1 es prerequisito de todo. B2 y B3 pueden ir en cualquier orden entre sí. B4 y B5 dependen de B1.

---

## 4. Usuarios y roles

| Rol | Puede | No puede |
|---|---|---|
| **Owner** | Todo, incluidas las dos claves solo-Owner: `workspace.transfer` y `team.remove` | Ser quitado o degradado por nadie; quitarse a sí mismo |
| **Admin** | Todo menos `workspace.transfer` y `team.remove` | Quitar personas (igual que hoy), tocar la fila del Owner, cambiar su propio rol |
| **Member** (sistema) | Sus claves de hoy (§9.3), con alcance `own` en todo | Lo que no está en su lista; ver lo de otros |
| **Rol personalizado** | Exactamente sus claves y alcances | Dar a otro (invitar, asignar, editar un rol) una clave o un alcance que él no tiene; editar su propio rol |

- El primer usuario sigue siendo Owner (`scripts/create-owner.mjs`).
- Alta solo por invitación (no hay registro público).
- Un cambio de rol aplica en el próximo pedido (los permisos se resuelven por request).

---

## 5. Alcance

### 5.1 Base de permisos (B1)
- **Qué hace:** catálogo de §9 en `lib/auth/permissions.ts` (fuente única); copia del Member en SQL comparada por test; `has_permission` v2; claves reservadas que no se muestran; retiro de `settings.manage` con migración del jsonb; menú lateral y pestañas de Ajustes filtrados por permiso.
- **Hasta dónde llega:** la infraestructura y el catálogo. La aplicación módulo por módulo es B4/B5.
- **No hace:** permisos por registro individual (ACL), horarios de acceso, roles temporales. (Los permisos por cuenta de canal se sumaron después, el 22/10/2026: ver `docs/roles.md`, «La bandeja por cuenta».)
- **Dónde va lo que queda afuera:** fuera del proyecto, salvo pedido.

### 5.2 Equipo e invitaciones (B2)
- **Qué hace:** lista de miembros (`team.view`), invitar por email o por link (`team.invite`) con cualquier rol que el invitador pueda dar, pendientes con copiar link / reenviar / renovar / anular, historial, aceptar con `role_id`, cambiar rol y Closer (`team.manage`), quitar (`team.remove`).
- **No hace:** invitaciones masivas (CSV de emails), links reutilizables para varias personas, SSO, aprobación de solicitudes de ingreso, transferir la propiedad (la clave queda reservada).
- **Dónde va:** transferir la propiedad → pendiente, sin fase asignada.

### 5.3 Pantalla de roles (B3)
- **Qué hace:** alcances dentro de su grupo y ligados al permiso "ver"; guardado automático; crear con solo el nombre; duplicar; plantillas; ver los permisos de un rol de sistema; ocultar claves reservadas; nombres corregidos.
- **No hace:** historial de versiones de un rol con "volver a la versión X" (queda el `audit_log`), comparar dos roles lado a lado.

### 5.4 Ajustes e integraciones (B4) y módulos (B5)
- **Qué hace:** cada pantalla y acción de §8 de la auditoría pasa a su clave en página, acción, menú y RLS.
- **No hace:** rediseñar esas pantallas. Solo cambia quién entra y qué ve; las secciones nuevas (General partido, Integraciones en tres partes) reordenan componentes existentes.

---

## 6. Funcionalidades y criterios de aceptación

Comandos del proyecto: `npx vitest run`, `npm run build`, `npm run lint`, `node scripts/verify-*.mjs`. **No se suma ninguna dependencia de testing.** La lógica de cada pantalla (qué ve cada rol, estados, cálculos) vive en funciones puras con su test; los componentes solo las componen.

### Bloque 1 — Base de permisos

#### F1: Catálogo nuevo
**Descripción:** `PERMISSION_KEYS` pasa al catálogo de §9.1 (74 claves; 72 visibles). Cada clave tiene `module`, `label`, `description` y opcionalmente `reserved: true` (no se muestra) y `ownerOnly: true`. Sale `settings.manage`. Los grupos de la pantalla son los de §9.1.
**Criterios:**
- CUANDO se llama `can(perms, "settings.manage")`, EL SISTEMA DEBE devolver `false` (la clave ya no existe).
- CUANDO se resuelven los permisos de Admin, EL SISTEMA DEBE incluir todas las claves salvo las `ownerOnly`.
- CUANDO se listan las claves visibles, EL SISTEMA NO DEBE incluir las `reserved`.
- `SYSTEM_ROLE_PERMISSIONS.member.keys` es exactamente la lista de §9.3.
- Test: `lib/auth/permissions.test.ts` y `member-permissions-characterization.test.ts` actualizados y en verde.

#### F2: Toda clave tiene un uso
**Descripción:** test nuevo `lib/auth/catalog-usage.test.ts` que recorre `app/`, `lib/`, `components/` y `supabase/migrations/` (excluyendo tests, `permissions.ts` y `roles-admin.ts`) y falla si una clave visible no aparece en ningún guard, `can(...)`, ítem de menú o `has_permission(...)`.
**Criterios:**
- DADO el catálogo, CUANDO corre el test, ENTONCES pasa con 0 claves huérfanas al cerrar B5 (en B1 se lista una excepción temporal por clave pendiente, que B4/B5 vacían; al cierre de B5 la lista de excepciones DEBE estar vacía).

#### F3: `has_permission` v2 y paridad TS↔SQL (00200)
**Descripción:** `private.member_permission_keys()` devuelve `text[]` con las claves de §9.3. `has_permission(ws, key)`: sin membresía → false; owner → true; admin → `key NOT IN` claves solo-Owner; member sin `role_id` o con `role_id` de un rol de sistema Member → `key = ANY(member_permission_keys())`; member con rol personalizado → el jsonb (igual que hoy). Se agrega `private.owner_only_keys()`.
**Criterios:**
- Test `lib/auth/member-sql-parity.test.ts`: lee la última definición de `member_permission_keys` en `supabase/migrations/` y la compara con `SYSTEM_ROLE_PERMISSIONS.member.keys`. Falla si difieren. Lo mismo con `owner_only_keys`.
- `verify-roles.mjs` suma: Member de sistema → `has_permission('contacts.view')` true y `('team.invite')` false; Admin → `('team.remove')` false; Owner → true.
- `verify-rls.mjs --despues-de-00143` sigue en verde sin cambiar sus aserciones.

#### F4: Retiro de `settings.manage` (00203)
**Descripción:** cada uso en TS y SQL pasa a su reemplazo según §9.2. La 00203 reemplaza la clave en el jsonb de los roles personalizados por TODAS sus sucesoras.
**Criterios:**
- `grep -r "settings.manage"` en `app/ lib/ components/` (sin tests) y en la última definición de cada política devuelve 0.
- DADO un rol con `settings.manage`, CUANDO se aplica la 00203, ENTONCES el rol tiene `settings.general`, `sales.settings`, `products.manage`, `assignment.manage` y no tiene `settings.manage` (`verify-roles.mjs` lo prueba creando el rol antes).

#### F5: Guards y menú por permiso
**Descripción:**
- `lib/auth/guards.ts`: se suma `requireAnyPermission` para páginas (si no existe con ese uso) y `assertCanGrant(ctx, keys, scopes)` (§5.6 de reglas).
- `lib/nav/items.ts`: `adminOnly` se reemplaza por `permissions` en todos los ítems (Conocimiento → `knowledge.view`; Integraciones → `integrations.view | channels.manage | integrations.manage` o tiene conexión personal; Ajustes → cualquier clave de Ajustes).
- `lib/settings/tabs.ts`: cada pestaña declara sus claves; `visibleSettingsTabs(can)` pura.
**Criterios:**
- Test `lib/nav/items.test.ts`: para Owner, Admin, Member y tres roles personalizados de prueba, la lista de ítems visibles es la esperada (tabla en el test).
- Test `lib/settings/tabs.test.ts`: un rol con solo `products.manage` ve solo la pestaña Productos.
- `member-baseline.test.ts` actualizado: el menú del Member de sistema es idéntico al de hoy.

**Bloque 1 listo cuando:** F1–F5 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, `npm run lint` sin errores nuevos, 00200 y 00203 aplicadas y registradas, y `verify-rls`/`verify-roles` en verde.

### Bloque 2 — Equipo e invitaciones

#### F6: Ver el equipo (`team.view`)
**Descripción:** `/dashboard/settings/team` exige `team.view` (antes `requireWorkspaceAdmin`). Lista nombre, email, rol, desde cuándo, Closer. Los controles de edición se muestran solo con `team.manage`. Lectura con el cliente de servicio después del guard (como hoy).
**Criterios:**
- CUANDO un rol con solo `team.view` abre Equipo, EL SISTEMA DEBE mostrar la lista sin selectores, sin Closer editable, sin invitar y sin quitar.
- CUANDO alguien sin `team.view` abre la URL, EL SISTEMA DEBE redirigir al dashboard.
- Lógica en `lib/team/view-model.ts` (pura): `memberRowControls(viewer, member)` devuelve qué controles ve. Test con la matriz Owner/Admin/Member/rol.

#### F7: Invitar por email o por link (`team.invite`)
**Descripción:** formulario: email, **rol** (todos los roles del workspace menos Owner, filtrados por `assertCanGrant`), **cómo**: "Enviar por email" (default si Resend está conectado) o "Solo generar link". Se crea la invitación con `role_id`, `role` base (`admin` si el rol es el Admin de sistema; si no, `member`), `delivery`. Si es por email, se manda y se guarda `email_status`/`email_error`/`last_sent_at`/`send_count=1`. Siempre se devuelve el link.
**Criterios:**
- CUANDO se invita con un rol personalizado, EL SISTEMA DEBE guardar su `role_id` y `role='member'`.
- CUANDO el email ya es de un miembro del workspace (vía `workspace_member_profiles`), EL SISTEMA DEBE responder "Esa persona ya está en el equipo" sin crear nada.
- CUANDO ya hay una invitación vigente para ese email, EL SISTEMA DEBE responder con ese error y ofrecer copiar su link.
- CUANDO quien invita no tiene alguna clave del rol elegido, o el rol es Admin y quien invita no es Owner/Admin, EL SISTEMA DEBE rechazar con "No podés dar permisos que no tenés".
- CUANDO `delivery='link'`, EL SISTEMA NO DEBE llamar a `sendTransactionalEmail` (test con espía).
- Tests: `lib/actions/team.invite.test.ts` (Supabase y Resend simulados) y `lib/team/grant.test.ts` (`assertCanGrant` puro).

#### F8: Invitaciones pendientes
**Descripción:** sección siempre visible para `team.invite`. Estado derivado por función pura `inviteState(invite, now)`: `pending` | `expired` (pending y vencida) | `accepted` | `revoked`. Por fila: email, rol (nombre del rol, no solo admin/member), cómo se mandó y estado del email, quién invitó, vence el. Acciones: **Copiar link**, **Reenviar email**, **Renovar 7 días**, **Anular**.
**Criterios:**
- CUANDO se reenvía, EL SISTEMA DEBE mandar el email, sumar `send_count`, actualizar `last_sent_at`, y rechazar si pasaron menos de 60 s desde el último envío o si `send_count` ≥ 5.
- CUANDO se renueva una invitación vencida o vigente, EL SISTEMA DEBE poner `expires_at = now() + 7 días`.
- CUANDO se anula, EL SISTEMA DEBE hacer `UPDATE status='revoked', revoked_at, revoked_by` (no `DELETE`).
- CUANDO una invitación anulada o aceptada se intenta abrir, EL SISTEMA DEBE mostrar "Esta invitación ya no es válida".
- Estado vacío: "No hay invitaciones pendientes."
- Tests: `lib/team/invite-state.test.ts` y los de las acciones.

#### F9: Historial de invitaciones
**Descripción:** sección plegable debajo de pendientes: aceptadas (quién aceptó, cuándo, con qué cuenta), anuladas (quién y cuándo), vencidas sin usar. Filtro por estado. Paginada de a 20.
**Criterios:**
- DADO una invitación aceptada, ENTONCES aparece en el historial con `accepted_at` y el nombre de la cuenta.
- Test de la función pura que agrupa y ordena.

#### F10: Aceptar con el rol correcto
**Descripción:** `finalizeAcceptInvite` inserta `role` y `role_id`. Si el `role_id` de la invitación ya no existe (rol borrado), cae al rol de sistema Member. Guarda `accepted_at` y `accepted_by`. La 00202 corrige los miembros que ya entraron sin `role_id`.
**Criterios:**
- CUANDO se acepta una invitación con rol personalizado, EL SISTEMA DEBE crear el miembro con ese `role_id` y `role='member'`.
- CUANDO el rol fue borrado, EL SISTEMA DEBE usar el Member de sistema.
- `verify-workspace-isolation.mjs` (alta por invitación) suma el caso con rol personalizado y sale 0.

#### F11: Cambiar rol, Closer y quitar
**Descripción:** página, `setMemberRole`, `changeMemberRole` (si queda en uso) y `setMemberCloser` con `team.manage` + `assertCanGrant`. Quitar con `team.remove`. Reglas duras: nadie cambia su propio rol, nadie toca al Owner, nadie se quita a sí mismo, no se quita al último Owner.
**Criterios:**
- CUANDO un rol con `team.manage` intenta asignar Admin, EL SISTEMA DEBE rechazar (Admin solo lo asigna Owner/Admin).
- CUANDO Admin intenta quitar a alguien, EL SISTEMA DEBE rechazar (igual que hoy).
- Los cambios quedan en `audit_log` (`kind: member_role_changed`, `member_removed`, `invite_*`).
- 00204 aplicada; `verify-roles.mjs` prueba que un rol personalizado con `team.invite` puede insertar en `workspace_invites` y uno sin la clave no.

**Bloque 2 listo cuando:** F6–F11 cumplen, `npx vitest run` sale 0, `npm run build` compila, 00201/00202/00204 aplicadas y registradas, `verify-roles`, `verify-rls` y `verify-workspace-isolation` en verde.

### Bloque 3 — Pantalla de roles

#### F12: Alcances dentro de cada grupo
**Descripción:** desaparece la fila de selectores de arriba. Cada grupo con alcance lo muestra como primera fila (§10.3): Contactos ("Qué contactos ve"), Bandeja ("Qué conversaciones ve"), Agenda, Llamadas, Ventas, Tareas. Formularios muestra el texto fijo "Las respuestas siguen el alcance de Contactos". `eod.view_all` se muestra como selector "Qué reportes de fin de día ve: Solo los suyos / Todos los del equipo" (por detrás sigue siendo la clave).
**Criterios:**
- CUANDO el permiso "ver" del grupo está apagado, EL SISTEMA DEBE mostrar el selector deshabilitado con "Activá Ver … para elegir el alcance" (Bandeja: deshabilitado si ningún canal tiene "ver").
- Lógica en `lib/auth/roles-admin.ts`: `scopeFieldState(module, keys)` pura, con test.

#### F13: Guardado automático
**Descripción:** tildes y selectores se guardan al instante (cola serial por rol); nombre y descripción a los 700 ms sin escribir y al salir del campo. Indicador "Guardando… / Guardado / No se pudo guardar · Reintentar". Sin `window.location.reload()`: la tarjeta se actualiza en el lugar. Nombre vacío o repetido: se marca el campo y solo ese campo no se guarda. Las correcciones automáticas (responder ⇒ ver) se aplican en el tilde al instante. Aviso "Los cambios aplican ya a N personas" si el rol tiene personas. Auditoría agrupada: una fila por sesión de edición (cambios de la misma persona sobre el mismo rol en menos de 10 minutos se suman a la misma fila con la lista de claves agregadas y quitadas).
**Criterios:**
- Nueva acción `patchRole(roleId, patch)` que acepta cambios parciales (`addKeys`, `removeKeys`, `scopes`, `name`, `description`) y devuelve el rol resultante.
- CUANDO llegan dos `patchRole` seguidos, EL SISTEMA DEBE aplicarlos en orden sin perder ninguno (test con la cola pura `lib/roles/save-queue.ts`).
- CUANDO falla un guardado, EL SISTEMA DEBE revertir el control a su valor anterior.
- Test de la agrupación de auditoría (pura).

#### F14: Crear, duplicar y plantillas
**Descripción:** "Nuevo rol" abre un diálogo con nombre y "Empezar desde": En blanco / Setter / Closer / Content Manager / Líder de equipo / Duplicar un rol existente (incluidos los de sistema). Crea el rol en el acto y abre la edición. Plantillas en `lib/roles/templates.ts` (§10.4).
**Criterios:**
- CUANDO se duplica Member de sistema, EL SISTEMA DEBE crear un rol personalizado con las claves y alcances de §9.3.
- CUANDO se crea desde una plantilla, el rol tiene exactamente las claves de la plantilla filtradas por `assertCanGrant` del que crea.
- Test de las plantillas: toda clave de plantilla existe en el catálogo.

#### F15: Ver un rol de sistema y protecciones
**Descripción:** los roles de sistema tienen "Ver permisos" (la misma grilla, solo lectura) y "Duplicar". Se corrige la descripción duplicada. Nadie edita el rol que tiene asignado salvo Owner/Admin. Un rol personalizado con `roles.manage` no puede agregar a un rol una clave o alcance que él no tiene. `roles.view` permite ver la pantalla sin editar.
**Criterios:**
- CUANDO un rol con `roles.manage` intenta agregar una clave que no tiene, `patchRole` DEBE rechazar con "No podés dar permisos que no tenés".
- CUANDO intenta editar su propio rol, DEBE rechazar.
- Nombres: grupo "Plantillas" → "Banca de recursos"; "Que leads ve" → "Qué contactos ve"; tildes en "Qué", "Descripción".

**Bloque 3 listo cuando:** F12–F15 cumplen, `npx vitest run` sale 0, `npm run build` compila, y el recorrido visual de la pantalla de roles (escritorio y 390 px) se hizo o quedó anotado en `docs/PENDIENTE.md`.

### Bloque 4 — Ajustes e integraciones

#### F16: Ajustes → General partido
**Descripción:** la página exige `settings.general` **o** `sales.settings`. Sección "General" (nombre, palabras clave, no contactar, zona horaria del negocio, retención de media) con `settings.general`; sección "Ventas y cobranza" (métodos de pago, tope de descuento, días de gracia, flujos de cobranza) con `sales.settings`. Cada acción de `lib/actions/workspace.ts` chequea su clave y escribe con el cliente de servicio filtrado por el workspace de la sesión (la RLS de `workspaces` queda en Admin: patrón de Ventas).
**Criterios:**
- CUANDO un rol con solo `sales.settings` guarda el nombre del negocio, la acción DEBE rechazar.
- Test de `lib/settings/general-sections.ts` (qué secciones ve cada quien).

#### F17: Campos personalizados, Productos, Asignación, Actividad
**Descripción:** cada pestaña con su clave en página y acciones: `custom_fields.manage`, `products.manage`, `assignment.manage`, `audit.view`. Completar el valor de un campo en la ficha sigue con `contacts.edit`. Actividad suma la política adicional `audit_log_select_audit` (00205).
**Criterios:**
- CUANDO un rol sin `custom_fields.manage` llama a `createCustomField`, DEBE rechazar sin tocar la base.
- `verify-audit-visibility.mjs` compara la visibilidad antes y después y solo cambia para roles con `audit.view`.

#### F18: Integraciones en tres secciones
**Descripción:** `/dashboard/settings/integrations` exige `integrations.view` **o** `integrations.manage` **o** `channels.manage` **o** tener alguna conexión personal disponible. Secciones:
1. **Mis conexiones** (todos): Google Calendar (si tiene `scheduling.use`), Fathom (si la app de Fathom está configurada). Conectar, desconectar y sincronizar la suya. Reusa los componentes de `/agenda/configuracion/calendarios` y `/llamadas/mi-fathom`.
2. **Canales** (`channels.manage` para tocar; `integrations.view` para ver): Instagram, WhatsApp, email. `/dashboard/channels` y `api/v1/channels/*` pasan de `getAdminContext` a `channels.manage`.
3. **Integraciones del negocio** (`integrations.manage` para tocar; `integrations.view` para ver estado sin claves): IA, Resend, Meta Ads, Zernio, cuentas de publicación, apps OAuth de Google y Fathom.
Los OAuth del negocio (`oauthRouteContext` rama no-`perUser`) pasan de `getAdminContext` a `integrations.manage`. Las personales no cambian.
**Criterios:**
- CUANDO un Member de sistema abre Integraciones, EL SISTEMA DEBE mostrar solo "Mis conexiones".
- CUANDO alguien con `integrations.view` y sin `integrations.manage` abre una integración del negocio, EL SISTEMA DEBE mostrar estado sin botones de cambio y la acción `saveIntegration` DEBE rechazar.
- CUANDO alguien sin `channels.manage` llama a `api/v1/channels/connect`, DEBE responder 403.
- Test `lib/integrations/sections.test.ts` (pura: qué secciones y acciones ve cada quien).

#### F19: Webhooks con permiso propio
**Descripción:** `lib/actions/webhook-endpoints.ts`, `webhook-flow-editor.ts` y sus páginas pasan de `flows.edit` a `webhooks.manage`. La lista de solo lectura sigue para `integrations.view`.
**Criterios:**
- CUANDO un Member de sistema llama a `createWebhookEndpoint`, DEBE rechazar (cambio de comportamiento aprobado, §9.3).
- `verify-inbound-webhooks.mjs` sigue en verde.

**Bloque 4 listo cuando:** F16–F19 cumplen, `npx vitest run` sale 0, `npm run build` compila, 00205 aplicada y registrada, `verify-rls`, `verify-roles`, `verify-audit-visibility` y `verify-inbound-webhooks` en verde.

### Bloque 5 — Módulos

#### F20: Bandeja por canal
**Descripción:** `inbox.<canal>.view` filtra la lista de conversaciones y los filtros de canal (lógica pura `visibleChannels(perms)` en `lib/inbox/`); `inbox.<canal>.reply` habilita el composer, el envío (`api/v1/messages` y las acciones de borradores del agente) y el envío de recursos. El alcance de conversaciones sigue en la RLS.
**Criterios:**
- CUANDO un rol con solo `inbox.whatsapp.view` lista la bandeja, EL SISTEMA NO DEBE devolver conversaciones de Instagram ni email.
- CUANDO un rol sin `inbox.instagram.reply` manda un mensaje a una conversación de Instagram, la API DEBE responder 403 sin llamar al proveedor (test con espía).
- Borradores del agente: mandar/descartar/regenerar exigen `inbox.<canal>.reply` del canal de la conversación.

#### F21: Contactos
**Descripción:** página y menú con `contacts.view`; acciones de edición con `contacts.edit`; `startImport`/`importBatch`/`finishImport` y `/contacts/import` con `contacts.import`; `softDeleteContact`/`restoreContact` con `contacts.delete`; `assignContact` con `contacts.assign`; `linkContacts`/`dismissLinkSuggestion` con `contacts.merge`; `setDoNotContact` con `contacts.edit`; etiquetas con efecto (apagan el agente o asignan) y renombrar/borrar etiquetas con `tags.manage` (crear una etiqueta simple al vuelo sigue con `contacts.edit`, como hoy). Inscribir en secuencia: `contacts.edit` + `sequences.view`.
**Criterios:**
- CUANDO un Member de sistema llama a `startImport`, DEBE rechazar (cambio aprobado).
- CUANDO un Member de sistema reasigna un lead que ve, DEBE poder (`contacts.assign` en su lista).
- `verify-crm.mjs` sigue en verde.

#### F22: Automatizaciones, secuencias y broadcasts
**Descripción:** `api/v1/flows/*` exige `flows.view` (GET) y `flows.edit` (POST/PATCH/DELETE); `publish` y `versions/restore` exigen `flows.publish`. Menú Automatizaciones con `flows.view`. Secuencias: acciones y RLS con `sequences.edit`, lectura con `sequences.view`. Broadcasts: `broadcasts.manage` en API y menú. 00206 reemplaza la política "Users can manage flows" por SELECT con `flows.view` y escrituras con `flows.edit`; `triggers` con `flows.edit`. **Antes de cambiar `triggers`**, Claude Code verifica con qué cliente se escriben hoy; si es con el del usuario, el Member de sistema empieza a poder guardar triggers (lo tiene en `flows.edit`) y se anota en PROGRESS.
**Criterios:**
- CUANDO un rol sin `flows.publish` publica, la API DEBE responder 403.
- CUANDO un Member de sistema edita una secuencia, DEBE rechazar (sin cambio: hoy tampoco puede).
- Tests de las rutas con Supabase simulado; `verify-rls` en verde.

#### F23: Agentes IA, tareas de IA, topes y Conocimiento
**Descripción:** menú y páginas de Agentes con `agents.view`; las 14 acciones de `lib/actions/agents.ts` con `agents.edit` salvo `updateWorkspaceAiLimits` y `addModelPrice` → `ai_limits.manage`; `lib/actions/ai-tasks.ts` y `/agents/tareas/[task]` con `ai_tasks.manage` (las tareas de llamadas aceptan también `calls.configure`, como hoy en su pantalla). `revertAgentAction` con `agents.edit`. Conocimiento: página y menú con `knowledge.view`, acciones con `knowledge.edit`. RLS de `agents`, `agent_prompt_versions`, `ai_task_prompt_versions`, `knowledge_base` en 00206.
**Criterios:**
- CUANDO un rol con `agents.edit` y sin `ai_limits.manage` cambia un tope, DEBE rechazar.
- CUANDO un rol con `knowledge.view` y sin `knowledge.edit` sube un documento, DEBE rechazar.

#### F24: Contenido, dashboards y exportar
**Descripción:** `/content` con `content.view`; crear pieza/idea con `content.create`. `/dashboards/chat` con `dashboards.chat.view`; `/dashboards/unified` con `dashboards.unified.view`. Todos los botones "Exportar CSV" (respuestas de formularios, reportes EOD, corridas de IA, tabla de anuncios) y sus endpoints con `data.export`.
**Criterios:**
- CUANDO un Member de sistema pide un export, EL SISTEMA DEBE rechazar y el botón NO DEBE mostrarse (cambio aprobado: el Member no conserva exportar).
- Test del helper `canExport(perms)` y de cada endpoint.

**Bloque 5 listo cuando:** F20–F24 cumplen, `catalog-usage.test.ts` sin excepciones, `npx vitest run` sale 0, `npm run build` compila, 00206 aplicada y registrada, `verify-rls`, `verify-roles`, `verify-crm`, `verify-inbox-filters` en verde.

### Bloque 6 — Verificación y cierre

#### F25: Matriz de permisos de punta a punta
**Descripción:** `scripts/verify-permissions-matrix.mjs` (nuevo, mismo estilo que los `verify-*`: usuarios reales, prefijo `zz-test-`, limpia todo). Crea un rol personalizado por grupo con **solo** las claves de ese grupo y prueba contra la base que cada tabla de §8.4 deja y niega lo esperado. Además prueba Member de sistema y Admin.
**Criterios:** el script sale 0 y su limpieza deja 0 filas `zz-test-`.

#### F26: Documentación
**Descripción:** `docs/roles.md` reescrito (catálogo, alcances, quién puede dar qué, cómo sumar una clave nueva en 5 pasos); sección "Roles personalizados" de `CLAUDE.md` actualizada; `docs/PROGRESS-equipo-roles.md`; pendientes en `docs/PENDIENTE.md` (incluye limpiar los restos `zz-test-alcance-*` y los ~178 workspaces sin miembros, que **no** se borran en este Extra).

**Definición de "listo" de la fase:** B1–B6 listos; `npx vitest run` completo sale 0 (nuevos y existentes); `npm run build` compila; `npm run lint` sin errores nuevos (los 36 warnings no aumentan); 00200–00206 aplicadas y registradas; `verify-rls`, `verify-roles`, `verify-workspace-isolation`, `verify-audit-visibility`, `verify-crm`, `verify-inbox-filters`, `verify-inbound-webhooks` y `verify-permissions-matrix` en verde; ninguna cosa de §11.2 ("No cambia") se rompió; bloqueos anotados en `docs/PENDIENTE.md`.

### Funcionalidades de fases siguientes (no se construyen ahora)
- Transferir la propiedad del negocio (`workspace.transfer` queda reservada).
- Eventos de equipo en la agenda (`scheduling.team_events` queda reservada).
- Claves del Asistente, CX y Gastos: las suma cada módulo.

---

## 7. Flujos principales

### Invitar por email
1. Quien tiene `team.invite` escribe el email, elige rol y "Enviar por email".
2. El sistema valida (email, no es miembro, no hay vigente, puede dar ese rol), crea la invitación y manda el correo.
3. Muestra "Invitación enviada a X" + el link con "Copiar link". Aparece en Pendientes con "Email enviado".
4. Si Resend falla: "No se pudo mandar el email. Pasale este link." y en Pendientes "Email falló · Reenviar".

### Invitar con link
1. Igual, eligiendo "Solo generar link". No se manda correo.
2. Se muestra el link para copiar. En Pendientes figura "Solo link".

### Aceptar
1. La persona abre `/invite/<id>`. Si la invitación está anulada, aceptada o vencida: "Esta invitación ya no es válida" (vencida agrega "Pedile a quien te invitó que la renueve").
2. Si no tiene cuenta: nombre y contraseña; el email viene fijo de la invitación. Si tiene: inicia sesión con ese email.
3. Queda en el equipo con el rol de la invitación. La invitación pasa a `accepted` con fecha y cuenta.

### Editar un rol (autosave)
1. Abre el rol (acordeón debajo de su tarjeta). 2. Cada tilde o selector se guarda solo; el indicador dice "Guardado". 3. Si falla, el control vuelve atrás y aparece "Reintentar".

### Conectar mi calendario o mi Fathom
1. Cualquier persona entra a Integraciones y ve "Mis conexiones". 2. Conecta su cuenta (OAuth personal, igual que hoy). 3. No ve ni toca las integraciones del negocio salvo que tenga permiso.

---

## 8. Modelo de datos

### 8.1 `workspace_invites` (columnas nuevas, 00201)

| Campo | Tipo | Req. | Descripción |
|---|---|---|---|
| `role_id` | uuid FK `workspace_roles(id)` ON DELETE SET NULL | no | Rol con el que entra |
| `delivery` | text CHECK in ('email','link') default 'email' | sí | Cómo se mandó |
| `email_status` | text CHECK in ('sent','failed','not_configured') | no | Resultado del último envío |
| `email_error` | text | no | Mensaje corto del proveedor, sin datos sensibles |
| `last_sent_at` | timestamptz | no | |
| `send_count` | int default 0 | sí | Tope 5 |
| `accepted_at` / `accepted_by` | timestamptz / uuid FK auth.users | no | |
| `revoked_at` / `revoked_by` | timestamptz / uuid FK auth.users | no | |

`status` no cambia (`pending`/`accepted`/`revoked`); "vencida" se deriva (`inviteState`). El `role` (texto) se sigue llenando con el rol base para que nada que lo lea cambie.

### 8.2 `workspace_roles.permissions`
Sin cambio de estructura. Las claves nuevas entran en `keys`; `scopes` sigue con `leads`, `conversations`, `bookings`, `calls`, `sales`, `tasks`.

### 8.3 Funciones (00200)
`private.member_permission_keys() returns text[]`, `private.owner_only_keys() returns text[]` (IMMUTABLE), `public.has_permission` v2 (misma firma, `SECURITY DEFINER`, `SET search_path = ''`). `permission_scope` no cambia.

### 8.4 Políticas por tabla (00204–00206)

| Tabla | Operación | Hoy | Pasa a |
|---|---|---|---|
| `workspace_invites` | INSERT / UPDATE / DELETE | admin (UPDATE también el invitado) | `team.invite` (UPDATE conserva la rama del invitado) |
| `workspace_members` | UPDATE / DELETE | admin / owner | `team.manage` / `team.remove` (reglas del Owner se mantienen) |
| `workspace_roles` | INSERT / UPDATE / DELETE | admin | `roles.manage` (sigue `system_role IS NULL` + trigger) |
| `custom_field_definitions` | INSERT / UPDATE | admin | `custom_fields.manage` |
| `integration_configs` | SELECT | admin | `integrations.view` OR `integrations.manage` |
| `integration_configs` | INSERT / UPDATE / DELETE | admin | `integrations.manage` |
| `social_accounts` | INSERT / UPDATE / DELETE | admin | `integrations.manage` |
| `channels` | INSERT / UPDATE / DELETE | admin | `channels.manage` |
| `csv_imports` | SELECT | admin | `contacts.import` |
| `audit_log` | SELECT | `audit_log_select` | **NO se toca**; política ADICIONAL `audit_log_select_audit` con `audit.view` |
| `flows` | ALL (cualquier miembro) | member | SELECT `flows.view`; INSERT/UPDATE/DELETE `flows.edit` |
| `triggers` | INSERT / UPDATE / DELETE | admin | `flows.edit` (ver F22) |
| `sequences` | INSERT / UPDATE / DELETE | admin | `sequences.edit` |
| `tags` | INSERT / UPDATE / DELETE (rama admin) | admin | la rama `is_workspace_admin` → `has_permission('tags.manage')`; la rama de etiqueta simple no cambia |
| `agents`, `agent_prompt_versions` (INSERT) | — | admin | `agents.edit` |
| `agent_prompt_versions` (SELECT) | — | admin | `agents.view` |
| `ai_task_prompt_versions` | INSERT / SELECT | admin | `ai_tasks.manage` OR `calls.configure` |
| `knowledge_base` | INSERT / UPDATE / DELETE | admin | `knowledge.edit` |
| `contacts` | DELETE | admin | `contacts.delete` |

**No se tocan** (quedan en admin, documentado en `docs/roles.md`): `workspaces` (se escribe con servicio tras el guard), `model_pricing`, `email_log`, `automation_events`, `oauth_connections`, `message_categories`, `message_texts`, `notifications`, `conversations` DELETE, `sequence_enrollments` DELETE, `contact_notes`, `agent_runs`, `agent_drafts`, `content_*`, `meta_ads_insights_daily`, `booking_categories`.

**Notas de optimización:** no se crea tabla de permisos ni de historial de invitaciones (la misma tabla con columnas de estado alcanza); no se crea tabla de plantillas de rol (son código). `has_permission` es `STABLE` y se evalúa por fila: en las tablas de muchas filas (`flows` no lo es) usar `(select has_permission(...))` para que Postgres la evalúe una vez.

---

## 9. Catálogo

### 9.1 Claves (por grupo de la pantalla)

**Nuevas en negrita.** (R) = reservada, no se muestra. (O) = solo Owner.

| Grupo | Claves |
|---|---|
| Dashboards | `dashboards.chat.view`, `dashboards.content.view`, `dashboards.ads.view`, `dashboards.agenda.view`, **`dashboards.unified.view`** |
| Social | `social.view` |
| Bandeja | `inbox.{instagram,whatsapp,email}.{view,reply}` · alcance de conversaciones |
| Contactos | `contacts.view`, `contacts.edit`, `contacts.import`, `contacts.delete`, **`contacts.assign`**, **`contacts.merge`**, **`tags.manage`**, **`custom_fields.manage`**, **`assignment.manage`** · alcance de contactos |
| Automatizaciones | `flows.view`, `flows.edit`, **`flows.publish`**, `sequences.view`, `sequences.edit`, `broadcasts.manage`, **`webhooks.manage`** |
| Banca de recursos | `templates.manage` |
| Agente de IA | `agents.view`, `agents.edit`, `ai_costs.view`, **`ai_tasks.manage`**, **`ai_limits.manage`** |
| Conocimiento | `knowledge.view`, `knowledge.edit` |
| Contenido | `content.view`, `content.create`, `content.approve`, `content.publish`, `content.ai` |
| Agenda | `scheduling.use`, `scheduling.manage_others`, `scheduling.manage_categories`, `bookings.view`, `bookings.manage`, `scheduling.team_events` (R) · alcance de agendas |
| Llamadas | `calls.view`, `calls.edit`, `calls.configure` · alcance |
| Formularios | `forms.view`, `forms.manage`, `eod.view_all` (como selector) |
| Ventas | `sales.view`, `sales.manage`, `payments.manage`, **`products.manage`**, **`sales.settings`** · alcance |
| Tareas | `tasks.view`, `tasks.edit`, `tasks.delete` · alcance |
| Integraciones | **`integrations.view`**, `integrations.manage`, **`channels.manage`** |
| Equipo | **`team.view`**, **`team.invite`**, `team.manage`, **`team.remove`** (O), **`roles.view`**, `roles.manage` |
| Configuración | **`settings.general`**, **`audit.view`**, **`data.export`**, `workspace.transfer` (O, R) |

Total: 74 claves (72 visibles). Sale `settings.manage`. Etiquetas y descripciones en castellano con tildes, una línea que diga qué implica de verdad (estilo actual).

### 9.2 Reemplazo de `settings.manage`

| Uso de hoy | Pasa a |
|---|---|
| Productos y variantes (acciones, páginas, RLS 00159) | `products.manage` |
| Asignación (página y acciones) | `assignment.manage` |
| Métodos de pago, descuento, mora, flujos de cobranza | `sales.settings` |
| Pilares de contenido, ajustes de agenda del negocio, `setAutoCreateFlows`, vincular toque ↔ anuncio (`meta-match`), sin vincular de Anuncios, resto | `settings.general` |

Claude Code inventaría los 16 archivos y 4 políticas que la usan, completa esta tabla en PROGRESS con cada archivo, y no deja ninguno sin asignar.

### 9.3 Member de sistema después del cambio

Conserva sus 26 claves de hoy **menos** `sequences.edit` (la base nunca le dejó usarla: corrige el catálogo, sin cambio real) **más** `contacts.assign` y `flows.publish` (las dos ya las podía hacer de hecho; se conservan).

| Hoy podía (por agujero) | Después | Decisión |
|---|---|---|
| Reasignar leads que ve | Sí (`contacts.assign`) | Wendy, 13/10 |
| Publicar flujos | Sí (`flows.publish`) | Tomada en el plano para no cambiar comportamiento; se quita con una línea |
| Exportar CSV de lo que ve | **No** | Wendy, 13/10 |
| Importar contactos | **No** | Wendy, 13/10 |
| Crear webhooks | **No** | Recomendación de la auditoría |

`member-baseline.test.ts` y `member-permissions-characterization.test.ts` se actualizan **solo** con estas filas, y el PR las lista.

---

## 10. Pantallas

### 10.1 Convenciones
Las de siempre: Tailwind v4, `PageHeader`, `SettingsTabs`, `TeamRolesSwitch`, estados vacío/cargando/error, español rioplatense con tildes, mobile a 390 px sin scroll horizontal. Sin pantallas nuevas fuera de Ajustes: todo se acomoda en las rutas existentes.

### 10.2 Equipo → Miembros (`/dashboard/settings/team`)
- **Miembros (N):** tarjeta por persona (como hoy). Con `team.manage`: selector de rol con todos los roles que puede dar + Closer. Con `team.remove`: quitar. Sin permisos de edición: insignia del rol.
- **Invitar a alguien** (`team.invite`): email · rol · segmento "Enviar por email / Solo generar link" · botón "Enviar invitación" o "Generar link". Debajo, el resultado con el link y "Copiar link". Si Resend no está conectado, la opción email aparece deshabilitada con "Conectá el email en Integraciones".
- **Invitaciones pendientes (N):** siempre visible. Fila: email · rol · chip de envío ("Email enviado", "Email falló", "Solo link") · "Invitó X" · "Vence el …" o "Vencida". Acciones en ícono con tooltip: Copiar link, Reenviar, Renovar, Anular (confirmación).
- **Historial** (plegado): filtro Todas / Aceptadas / Anuladas / Vencidas; filas con fecha y actor; "Ver más".
- Mobile: acciones en un menú "⋯" por fila.

### 10.3 Equipo → Roles (`/dashboard/settings/roles`)
- Lista: roles de sistema con "Ver permisos" y "Duplicar"; personalizados con editar (acordeón debajo de la tarjeta) y borrar. Resumen: "21 permisos · contactos: todos · conversaciones: todas".
- Edición: nombre y descripción arriba, indicador de guardado a la derecha, aviso "aplica ya a N personas". Grupos plegables con "Todos/Ninguno"; en los grupos con alcance, primera fila = selector de alcance (deshabilitado si falta "ver").
- "Nuevo rol": diálogo con nombre + "Empezar desde".

### 10.4 Plantillas de rol (`lib/roles/templates.ts`)

| Plantilla | Claves | Alcances |
|---|---|---|
| Setter | `dashboards.chat.view`, los 6 de bandeja, `contacts.view/edit/assign`, `scheduling.use`, `bookings.view/manage`, `forms.view`, `tasks.view/edit` | contactos `own_unassigned`; el resto `own` |
| Closer | los 6 de bandeja, `contacts.view/edit`, `scheduling.use`, `bookings.view/manage`, `calls.view/edit`, `sales.view/manage`, `payments.manage`, `tasks.view/edit` | `own` |
| Content Manager | `dashboards.content.view`, `social.view`, `content.*`, `templates.manage`, `tasks.view/edit` | `own` |
| Líder de equipo | Setter + Closer + `team.view`, `eod.view_all`, `dashboards.agenda.view`, `data.export`, `tasks.delete` | `all` |

### 10.5 Ajustes → General
Dos secciones con título ("General", "Ventas y cobranza"), cada una visible según su clave.

### 10.6 Ajustes → Integraciones
Tres secciones en este orden: **Mis conexiones**, **Canales**, **Integraciones del negocio**. Las que la persona solo puede ver muestran el estado sin botones y con la leyenda "Solo lectura".

### 10.7 Menú lateral y pestañas
Se ven solo los ítems y pestañas que la persona puede abrir. Si no puede abrir ninguna pestaña de Ajustes, "Ajustes" no aparece.

---

## 11. Brownfield

### 11.1 Estado actual
Roles personalizados construidos en la Etapa 2 (F68–F72, `requerimientos-etapa2.md`); invitaciones de ZernFlow (00006, 00018, 00119). Detalle completo en `claude/auditoria-equipo-roles.md` §1–§8.

### 11.2 No cambia (intocable)
- `workspace_members.role` sigue siendo `owner|admin|member` y lo siguen leyendo las políticas viejas.
- `permission_scope`, `can_see_contact`, `can_see_conversation`, `can_see_call`, `can_see_sale` y el alcance por RLS.
- `audit_log_select` (solo se suman políticas adicionales).
- Lo que hoy puede Owner y Admin (salvo lo de §9.3, que es del Member).
- OAuth personal de Google Calendar y Fathom (`lib/oauth/*`), refresh tokens y sus candados.
- `find_or_link_contact`, `create_booking`, `record_contact_touch`, `submit_form_response`.
- El link de invitación sigue siendo `/invite/<id>`: los links ya enviados siguen funcionando.

### 11.3 Impacto
- **Member de sistema:** pierde importar, exportar y webhooks (§9.3). Comunicar al equipo antes de desplegar B4/B5.
- **Roles personalizados:** "Content Manager" (0 personas) pasa a depender de claves que ahora sí se aplican; revisar después de B5.
- **Tareas:** usa `tasks.*` con `has_permission` y el patrón `role_id IS NULL OR ...`; con la 00200 ese patrón sigue funcionando (no se reescriben sus políticas).
- **Asistente (futuro):** revalida con los mismos guards: queda más seguro sin cambios propios.

### 11.4 Compatibilidad y transición
Sin feature flag: cada bloque se despliega y su RLS se aplica justo después. Las invitaciones viejas siguen siendo aceptables (sin `role_id` → rol base).

---

## 12. Seguridad
- **Escalada de privilegios:** `assertCanGrant` en invitar, asignar rol, crear rol, `patchRole` y plantillas; nadie edita su propio rol (salvo Owner/Admin), nadie toca al Owner. Test dedicado (`lib/team/grant.test.ts`) con casos de ataque: rol con `team.invite` invita como Admin; rol con `roles.manage` le agrega a otro rol una clave que él no tiene; rol con `roles.manage` edita su propio rol; rol con `team.manage` se asigna a sí mismo otro rol.
- **El link de invitación es una credencial:** quien lo abre crea la cuenta con ese email. Por eso: vence a los 7 días, se anula, el reenvío tiene tope y "Copiar link" queda en el audit log (`invite_link_copied`).
- **RLS y servidor:** cada acción chequea en TS **y** la base lo vuelve a chequear; las que escriben `workspaces` usan servicio solo después del guard.
- **Logs:** nada de emails completos ni links en `console.*` (el audit log guarda el email, como hoy).
- Checklist: RLS en toda tabla tocada ✔ · políticas probadas con usuarios reales (`verify-permissions-matrix`) ✔ · guards en todas las rutas y acciones tocadas ✔ · validación en servidor ✔ · sin secretos nuevos ✔ · logs limpios ✔.

## 13. Template clonable
Migraciones idempotentes y sin datos de SSA; la 00202 y 00203 corren bien en una base vacía. Sin variables de entorno nuevas (Resend ya existe). `scripts/create-owner.mjs` no cambia.

## 14. Fuera de alcance
Transferir la propiedad · eventos de equipo · invitaciones masivas · links multiuso · SSO/2FA · permisos por registro · horarios de acceso · roles con vencimiento · historial versionado de roles con restaurar · limpieza de workspaces y roles `zz-test` huérfanos (va a PENDIENTE) · claves del Asistente, CX y Gastos (las suma cada módulo).

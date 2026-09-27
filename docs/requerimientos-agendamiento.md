# Requerimientos: Etapa 4, Agendamiento (Fases 1 y 2)

**Proyecto:** SSA Business AI OS
**Paso del Método Builder:** 05-Requerimientos (brownfield)
**Versión:** 1.3, 26 de septiembre de 2026 (v1.1: categorías y habilidad del agente; v1.2: estados de agenda definidos por Wendy, asignación por área, sin límites de cambios; v1.3: revisión del prototipo: Agendas sin pestañas, configuración detrás del engranaje, flujos de crear evento, agendar, excepción, tiempo fuera y flujo de email o mensaje; sin página pública del usuario; v1.4: modelo de datos optimizado de 14 a 8 tablas, §9.0, mensajes configurables cuando no se puede agendar, F58, y construcción en dos tandas, §0.1)
**Anclado a:** `alcance-v5-agendamiento.md` e `investigacion-agendamiento.md`
**Para:** Claude Code, bloque por bloque (supervisado u one-shot)

---

## 0. Cómo usar este documento

Este es el plano de **toda la Etapa 4**: 2 fases, 8 bloques y 56 funcionalidades (F1 a F58; F30 se eliminó en la v1.2 y F31 en la v1.3; F57 se sumó en la v1.3 y F58 en la v1.4). Se construye en orden, bloque por bloque.

> **Nota de numeración:** F50 y F51 (categorías) se agregaron en la v1.1 y se construyen **dentro del Bloque 3**, junto con los eventos. F52 a F56 forman el Bloque 8.

**Requisitos previos (no arrancar sin esto):**
1. **La Etapa 2 está construida y mergeada a `main`** (requisito de la tanda B; la tanda A no lo necesita, ver §0.1). En particular:
   - El cliente OAuth de Google y el flujo OAuth genérico (E2-F8 y E2-F9).
   - `oauth_connections` con `user_id`.
   - Vault para todos los secretos.
   - Roles personalizados (E2-F52 a E2-F56).

   > En este documento, **"E2-Fnn"** es una funcionalidad del plano de la Etapa 2 (`requerimientos-etapa2.md`). "Fnn" sin prefijo es de este plano.
   - Componentes de kanban y calendario del pipeline de contenido (E2-F18 y E2-F19).
   - Registro de handlers de `scheduled_jobs`.
   - `lib/nav.ts`.
   - Del agente de chat (Etapa 1, Fase 3): el tool registry con el schema de configuración de cada herramienta, `agents.tools_config`, los pasos del run (`agent_run_steps`) y el modo borrador por canal (Bloque 2c).
2. Hay un backup del día de la base de Supabase.
3. El plano se guarda sin cambios en `docs/requerimientos-agendamiento.md`.
4. Se trabaja en la rama `etapa4-agendamiento`, creada desde `main`.
5. **Código de referencia:** se clona Cal.diy en `git clone --depth 1 https://github.com/calcom/cal.diy docs/referencia/cal-diy` (en la tanda A, fuera del repositorio: §0.1), en la rama `main` posterior a abril de 2026, que es la versión con licencia MIT.
   - La carpeta no se importa desde el código ni se compila: excluirla en `tsconfig` y en eslint.
   - Se borra al final de la etapa.
   - **Nunca se copia código de etiquetas o forks anteriores a abril de 2026**, porque esas versiones no son MIT (son AGPL o de licencia comercial).

### 0.1 Construcción en dos tandas

La Etapa 4 se construye en **dos corridas**, para adelantar trabajo mientras la Etapa 2 todavía se construye. Este plano es el único documento de las dos; cada prompt dice qué tanda toma.

**Tanda A · Núcleo** (rama `etapa4-nucleo`, en paralelo con la Etapa 2):
- **Solo funciones puras con sus tests de Vitest:** sin base de datos, sin migraciones, sin pantallas, sin rutas, sin Server Actions, sin tocar el menú, los permisos, los flows ni ningún módulo existente.
- **Archivos compartidos que puede tocar:** solo `package.json` y el lockfile (para sumar `dayjs`), y archivos nuevos dentro de `lib/scheduling/`, `lib/embed/`, `docs/etapa4/` y la raíz (`THIRD_PARTY_NOTICES.md`).
- **Cal.diy se clona fuera del repositorio** (carpeta hermana), así no hay que tocar `.gitignore`, `tsconfig` ni ESLint.
- Si la Etapa 2 ya se mergeó a `main` antes de empezar, no hace falta la tanda A: se construye todo en la tanda B.

| F | Qué entra en la tanda A (solo la parte pura) | Archivos y tests |
|---|---|---|
| — | Atribución y dependencia | `THIRD_PARTY_NOTICES.md`, `dayjs` + plugins |
| F8 | `formatInTz`, `rangeForFilter` (sin `getViewerTimezone`, que lee el perfil) | `lib/scheduling/time/*`, `tz.test.ts` |
| F9, F11, F12 | Esquemas Zod de `weekly_hours` y `date_overrides` y la validación compartida (superposición, 24:00, fechas) | `lib/scheduling/availability-schema.ts`, `rules-validation.test.ts`, `overrides.test.ts` |
| F10 | `summarizeSchedule` | `schedules.test.ts` (solo la parte pura) |
| F13 | Conversión de un tiempo fuera de días completos a UTC según la zona | `out-of-office.test.ts` (solo la parte pura) |
| F17, F18 | `slugify` y las validaciones puras del evento | `event-types.test.ts`, `event-validation.test.ts` (solo la parte pura) |
| F20 | `buildBookingSchema` y el tipo de `booking_fields` | `lib/scheduling/booking-fields.ts`, `booking-fields.test.ts` |
| F21 | Límites y buffers | `lib/scheduling/limits/*` |
| F23 | **Motor de horarios completo** | `lib/scheduling/slots/*`, `slots.test.ts` + tests portados de Cal.diy |
| F25 | `buildMonthView`, `formatSlotLabel`, `parseEmbedParams` | `lib/scheduling/booker/*.test.ts` |
| F27 | `buildIcs` | `ics.test.ts` |
| F32 | Catálogo de estados, `canTransition`, `needsOutcome`, `groupForKanban`, `allowedDrops` (sin `filterBookings`, que arma consultas) | `booking-status.ts`, `bookings-view.ts`, `booking-status.test.ts` |
| F34 | Reglas de arrastre | `kanban.test.ts` |
| F35 | `placeInCalendar` | `calendar-view.test.ts` |
| F39, F40, F41 | Fuente del script de embed (sin integrarlo al build), `buildEmbedIframeUrl`, `generateEmbedCode`, eventos hacia la página | `lib/embed/*`, `url.test.ts`, `code.test.ts`, `events.test.ts` |
| F47 | `bookingVariables` | `variables.test.ts` |
| F58 | `resolveUnavailableMessage`, `buildCtaHref`, respaldo del embed | `unavailable.test.ts`, `fallback.test.ts` |

Donde un test del plano mezcla partes puras y partes con base o red, la tanda A escribe solo los casos puros, en el mismo archivo. La tanda B suma el resto.

**Tanda B · Todo lo demás** (rama `etapa4-agendamiento`, cuando la Etapa 2 está mergeada a `main`):
- Empieza mergeando `etapa4-nucleo` en su rama. Si choca `package.json` o el lockfile, se resuelve con `npm install`.
- Construye los 8 bloques completos **integrando el núcleo, no reescribiéndolo**. Si al integrarlo algo del núcleo no encaja con el código real (por ejemplo, un tipo de la Etapa 2), se corrige en su archivo y en su test.
- Al integrar la fuente del embed al build, `npm run build` genera `public/embed/embed.js` (F39).
- `docs/PROGRESS.md` marca las partes de la tanda A como "hechas en el núcleo" y verifica que sus tests sigan en verde.

**Reglas de la corrida** (se suman a las del `CLAUDE.md`):
- **Google Calendar y Resend van simulados en los tests.** No se llama a Google durante la construcción.
- **Migraciones:** solo se aplican las aditivas. Lo que borra o modifica datos se escribe, no se aplica y se anota en `docs/PENDIENTE.md`.
- **Tests y commits:**
  - Después de cada funcionalidad: `npx vitest run`.
  - Después de cada bloque: marcar `docs/PROGRESS.md` y hacer commit `feat: etapa 4 - bloque N (nombre)`.
- **Funciones puras:** la lógica de cada pantalla, del motor de horarios y de las zonas horarias va en funciones puras testeables con Vitest. No se suman dependencias de testing.
- **Código portado de Cal.diy:**
  - Cada archivo copiado o adaptado lleva en su encabezado: `// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.`
  - Se crea `THIRD_PARTY_NOTICES.md` en la raíz con el texto completo de la licencia MIT de Cal.diy.
  - No se usa la marca "Cal.com" en la interfaz.
- **Revisión visual:** al cerrar cada bloque con pantallas, recorrerlas con el navegador de Claude Code en escritorio y en 390 px. Las páginas públicas (booker) no piden login, así que se revisan siempre. Las internas, solo si hay sesión iniciada; si no, se anota en `docs/PENDIENTE.md`.
- **Bloqueos:** si algo queda trabado después de un intento serio, anotarlo en `docs/PENDIENTE.md` y seguir.

---

## 1. Mapa de ruta

| Etapa | Estado | Qué tiene |
|---|---|---|
| Etapa 1: Sistema Operativo Base | Construida | CRM, bandeja, flows, secuencias, base de conocimiento, agente IA |
| Etapa 2: Integraciones, Publicación y Métricas | Construida (prerrequisito) | Integraciones y Vault, OAuth de Google, contenido, métricas, email, roles personalizados |
| **Etapa 4: Agendamiento** | **Este documento** | Calendarios por usuario, disponibilidad, eventos, página de reserva, agendas, embed, automatizaciones |
| Etapa 3: Agente integral + Fathom + MCP | Futuro (puede ir después de la 4) | El agente integral activa la habilidad de agendamiento que ya deja lista esta etapa |
| Etapa 4, Fase 3: Eventos de equipo | Futuro | Round robin, collective, reasignación |
| Etapa 5: Ventas y Pipeline | Futuro | Ventas vinculadas a contactos y agendas |

**Lo que NO se construye ahora pero el diseño contempla:**
- **Equipos:** `event_types.scheduling_type` (hoy solo `individual`). La Fase 3 crea `event_type_hosts` (con backfill desde `owner_user_id`) y una tabla de referencias de Google si un evento grupal necesita varias; las dos son aditivas.
- **Agente IA:** la habilidad de agendamiento se registra en esta etapa (B8) sobre `lib/scheduling/slots` y `lib/scheduling/booking`, que son funciones de servidor sin dependencia de la interfaz. Cualquier agente futuro la activa sin código nuevo.
- **Reportes por categoría:** `bookings.category_id` + snapshot quedan listos para los dashboards de la Etapa 5.
- **Sincronización desde Google:** `calendars` tiene columnas reservadas (`push_channel_id`, `push_channel_expires_at`, `sync_token`) sin uso en esta etapa.
- **Confirmación manual y pagos:** `bookings.status` es texto con CHECK extensible.
- **Invitados adicionales:** el formulario admite en el futuro un campo "invitados". Hoy la agenda tiene un solo contacto.

---

## 2. Objetivo y mapa de bloques

**Objetivo:** que cada persona del equipo conecte su Google Calendar, defina sus disponibilidades con excepciones y vacaciones, y publique eventos clasificados por área y tipo, con link propio o embebidos en su web. Cada agenda crea el evento con Meet en su calendario, queda siempre vinculada a un contacto del CRM, se gestiona en lista, kanban y calendario, dispara automatizaciones y también puede crearla el agente de chat.

**Por qué en este orden:**
1. Sin calendarios conectados no se sabe qué está ocupado (B1).
2. Sin disponibilidad no hay horarios que ofrecer (B2).
3. Sin eventos no hay qué reservar (B3).
4. Con eso, la reserva pública cierra la Fase 1 con valor usable (B4).
5. La Fase 2 construye encima: gestión de agendas (B5), embed (B6) y automatizaciones (B7). Las automatizaciones van al final porque necesitan todos los eventos de la agenda ya emitidos.

| Fase | Bloque | Qué se construye | Contexto compartido | Funcionalidades |
|---|---|---|---|---|
| 1 | **B1** Perfil y calendarios | Perfil de agenda, conexión de Google Calendar por usuario (varias cuentas), calendarios, cliente de Google, permisos, menú | `scheduling_profiles`, `oauth_connections`, `calendars`, Vault, `lib/google-calendar` | F1 a F8 |
| 1 | **B2** Disponibilidades | Horarios, reglas semanales, excepciones, tiempo fuera | `availability_schedules` (con `weekly_hours` y `date_overrides` jsonb), `out_of_office` | F9 a F15 |
| 1 | **B3** Categorías y tipos de evento | Categorías (áreas y tipos), tablas de eventos, lista, editor completo, formulario de reserva, límites | `booking_categories`, `event_types`, `event_types.conflict_calendar_ids` | F16 a F22, F50, F51 |
| 1 | **B4** Reserva pública | Motor de horarios, API pública, booker, crear agenda, confirmación, cancelar y reagendar | `bookings` (con referencia a Google), `audit_log` como historial, `rate_limits`, rutas públicas | F23 a F29, F58 |
| 2 | **B5** Pantalla de agendas | Lista, kanban, calendario, detalle, acciones, agendar manual, ficha del contacto, notificaciones | `bookings`, contactos, notificaciones | F32 a F38 |
| 2 | **B6** Embed | Script de embed, generador, eventos, precarga, UTM | `public/embed/*`, booker | F39 a F42 |
| 2 | **B7** Automatizaciones | Eventos, triggers inmediatos y relativos, condiciones, acciones, variables, flujos por evento, plantillas, editor de flujo del evento | flow registry, `automation_events`, `scheduled_jobs`, `flows` | F43 a F49, F57 |
| 2 | **B8** Habilidad de agendamiento para agentes | Configuración por agente, herramientas (horarios, agendar, reagendar, cancelar, agendas del contacto), zona horaria del lead, modo borrador, reglas | tool registry, `agents.tools_config`, `lib/scheduling/*` | F52 a F56 |

---

## 3. Estado actual del sistema (as-is)

Supuestos verificados en el esquema real de Supabase (26/09/2026) y en `requerimientos-etapa2.md`. **Claude Code confirma cada punto en la exploración** y, si algo no coincide, lo informa en el plan antes de escribir código.

### 3.1 Stack y patrones (no cambian)

- **Stack:** Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind 4 + Zod 4 + `@supabase/ssr`.
- **Tests:** Vitest 3 (entorno node). Scripts `scripts/verify-*.mjs` contra la base, con usuarios reales y limpieza al final.
- **Dónde va cada cosa:**
  - Server Components por defecto.
  - Mutaciones en Server Actions (`lib/actions/*`).
  - Webhooks en `app/api/webhooks/*`.
  - Crons en `app/api/cron/*`, disparados por `pg_cron` (`private.call_app_cron`).
- **Cola de trabajos:** `scheduled_jobs` (`type, payload, run_at, status, attempts, last_error, claimed_at, dedupe_key`), procesada por `/api/cron/jobs` cada minuto. Tiene registro de handlers por tipo (E2-F28). **Claude Code confirma si `status` admite `cancelled`**; si el CHECK no lo admite, sumar el valor es un cambio aditivo (permitido). Los jobs de una agenda se encuentran por `payload->>'booking_id'` (índice de expresión nuevo).
- **Automatizaciones:**
  - `automation_events` (`event_type, contact_id, payload, processed_at`) se drena con `/api/cron/automation-events`.
  - `triggers` (`flow_id, type, config jsonb, is_active`) + `trigger_fires` (`dedupe_key` único por trigger).
  - Registro de triggers, nodos y condiciones documentado en `docs/flow-registry.md`.
  - Tipos de evento vistos hoy en `automation_events`: `contact_created`, `assignment_changed`.
- **Contactos:**
  - `contacts` tiene `email`, `phone`, `whatsapp_phone`, `setter_id`, `vendedor_id`, `do_not_contact`, `attribution jsonb`, `metadata jsonb`.
  - La deduplicación se hace con `find_or_link_contact` (prioridad: teléfono, después email, después usuario de red social).
  - **No existe `contacts.timezone`.**
- **Zona horaria:** `workspaces.timezone` existe (default `America/Costa_Rica`). Las fechas van en UTC y el frontend convierte según el navegador.
- **Otros módulos:**
  - Auditoría: `lib/audit.ts` → `audit_log`.
  - Notificaciones: `notifications` + `lib/notifications/*` con `NOTIFICATION_TYPES`.
  - Email saliente: Resend (`email_log`), clave en Vault.
- **Agente de chat** (Etapa 1, Fase 3, verificado en la base: tabla `agents` con `type = 'chat'` y `tools_config = {}` hoy):
  - Tool registry: cada herramienta declara nombre, descripción, schema Zod de entrada y schema de su configuración; la pantalla de Agentes renderiza la configuración sin código nuevo.
  - Todas las herramientas corren en modo "aplica solo" y dejan paso en `agent_run_steps` + efecto en `audit_log`. Máximo 20 pasos por turno.
  - Modo borrador por canal (`agent_drafts`): en esos canales la respuesta espera aprobación humana.
- **SQL:** todas las funciones nuevas llevan `SET search_path = ''`. Las migraciones continúan desde el número siguiente al último existente al arrancar.

### 3.2 Lo que deja la Etapa 2 y se reutiliza

- **Flujo OAuth genérico** `app/api/oauth/[provider]/start|callback`:
  - `oauth_states` con nonce.
  - Tokens en Vault.
  - `oauth_connections` con `(provider, user_id, external_account_id, granted_scopes, status, ...)`.
  - Único por `(workspace_id, provider, coalesce(user_id, …))`.
  - El inicio exige Owner o Admin.
- **Adaptador `google`:** Client ID y Secret en Vault, `access_type=offline`, `include_granted_scopes=true`. Refresca el token en memoria y marca `revoked` ante `invalid_grant`.
- **Notificaciones:** tipo `integration_attention`, con deduplicación por causa.
- **Permisos:** `lib/auth/permissions.ts` (`PERMISSION_KEYS`, `SYSTEM_ROLE_PERMISSIONS`, `can`, `scopeFor`), `requirePermission`, `PermissionGate`, SQL `has_permission` y `permission_scope`, `workspace_roles.scopes jsonb`.
- **Componentes:** kanban y calendario del pipeline de contenido (portados de ScaleOS), con reglas de arrastre como funciones puras.
- **Menú:** `lib/nav.ts`, filtrado por permiso.

### 3.3 Qué se porta de Cal.diy

Rutas orientativas: **Claude Code confirma las rutas reales en `docs/referencia/cal-diy`** y lista en el plan qué archivos porta.

| Pieza | Dónde está en Cal.diy (orientativo) | Cómo se porta |
|---|---|---|
| Cálculo de horarios libres | `packages/lib/slots.ts`, `packages/features/availability/**`, `packages/lib/getUserAvailability*`, `packages/lib/date-ranges.ts` | Lógica pura a `lib/scheduling/slots/*`. Se quitan Prisma y tRPC; las entradas se pasan como parámetros |
| Manejo de zonas horarias y fechas | `packages/lib/dayjs`, helpers de `date-ranges` | A `lib/scheduling/time/*` con dayjs y los plugins `utc` y `timezone` |
| Límites y buffers | `packages/lib/intervalLimits/**`, `checkBookingLimits*`, `isOutOfBounds*` | A `lib/scheduling/limits/*` |
| Booker | `packages/features/bookings/Booker/**` | Componentes a `components/scheduling/booker/*`, adaptados a Tailwind 4 y a los componentes del fork. El estado local (zustand en Cal) se simplifica si es posible |
| Editor de disponibilidad | `packages/features/schedules/**` | A `components/scheduling/availability/*` |
| Constructor de formulario | `packages/features/form-builder/**` | Solo los tipos que se usan (nombre, email, teléfono, texto corto, texto largo, selección, selección múltiple) a `components/scheduling/form-builder/*` + validación Zod en `lib/scheduling/booking-fields.ts` |
| Google Calendar | `packages/app-store/googlecalendar/lib/CalendarService.ts` | A `lib/google-calendar/*` con `fetch` (o `googleapis` si la Etapa 2 ya lo sumó), sobre nuestras tablas |
| Embed | `packages/embeds/embed-core`, `embed-snippet`, `embed-react` (MIT) | A `public/embed/embed.js` (compilado) y `lib/embed/*`. Se renombra el objeto global a `SSA` |

---

## 4. Qué cambia y qué NO cambia

### 4.1 Cambia

- **Tablas nuevas (8):** perfil de agenda, calendarios, horarios, tiempo fuera, categorías, eventos, agendas y límites de uso (`rate_limits`). El historial de la agenda usa `audit_log` (§9.0).
- **`oauth_connections`:**
  - Nuevo valor de proveedor `google_calendar`.
  - El índice único pasa a incluir `external_account_id`, para permitir varias cuentas por persona.
  - El inicio del OAuth de `google_calendar` lo puede hacer cualquier persona con `scheduling.use` y siempre a su propio nombre, no solo Owner o Admin.
- **Columnas nuevas:**
  - `contacts.timezone`.
  - `flows.event_type_id` y `flows.template_key`.
  - `workspaces.scheduling_auto_create_flows` y `workspaces.scheduling_public_base_url`.
- **Tablas de categorías:** `booking_categories` (áreas y tipos), con `event_types.category_id` y `bookings.category_id` + snapshot.
- **Tool registry del agente:** una habilidad nueva, `scheduling`, con 7 herramientas (B8).
- **Catálogo de permisos:** 6 claves nuevas (§5). Los roles de sistema las reciben según la tabla de §5.
- **Flow registry:** 9 triggers, 4 condiciones y 3 acciones nuevas. Entre las acciones, `send_email` es genérica.
- **Procesador de `scheduled_jobs`:** nuevos tipos `booking_google_sync` (con `payload.action`: `create` | `update` | `delete`), `booking_relative_trigger` y `booking_ended`.
- **Menú:** ítem "Agenda" con sub-vistas.
- **Ficha del contacto:** sección "Agendas".
- **Rutas nuevas:**
  - Públicas: `/calendario/[usuario]/[evento]` (sin página del usuario: `/calendario/[usuario]` da 404), `/calendario/agenda/[uid]`, `/calendario/agenda/[uid]/reagendar`.
  - API pública: `/api/public/scheduling/*`.
  - Script: `/embed/embed.js`.
- **Encabezados de seguridad:** las rutas `/calendario/*` permiten ser embebidas en iframes (`frame-ancestors *`). El resto de la app sigue sin poder embeberse.

### 4.2 NO cambia (intocable)

- **Conexión de Google a nivel workspace** (YouTube) y todo lo de la Etapa 2: publicación, métricas, email, integraciones.
- **Deduplicación de contactos:** `find_or_link_contact` se usa tal cual, no se modifica.
- **Scope de leads:** `can_see_contact` y `can_see_conversation` no cambian. La única interacción es que el agendamiento puede asignar `vendedor_id`/`setter_id`, por la misma vía que la asignación manual, así que dispara `assignment_changed` como hoy.
- **Motor de flows:** el engine, los 17 nodos existentes, secuencias, agente IA y borradores. Solo se registran entradas nuevas.
- **Convenciones:** la regla "UTC en la base" y el resto de las pantallas existentes. Solo las pantallas de Agenda usan la zona del perfil de agenda.

### 4.3 Análisis de impacto y riesgos

| Zona que se toca | Quién depende | Riesgo | Mitigación |
|---|---|---|---|
| Índice único de `oauth_connections` | Conexión de Google/YouTube, LinkedIn y Threads (Etapa 2) | Duplicar o romper las conexiones del workspace | Índice nuevo `(workspace_id, provider, coalesce(user_id,…), external_account_id)`. Test de caracterización de la conexión de YouTube antes del cambio |
| Inicio de OAuth para no-admins | Guard de `/api/oauth/[provider]/start` | Que un Member conecte integraciones del workspace | El guard se relaja **solo** para `google_calendar`, que siempre se guarda con `user_id = auth.uid()`. Test de que un Member sigue recibiendo 403 en `google`, `linkedin` y `threads` |
| Procesador de `scheduled_jobs` | Publicación, métricas, agente | Un job nuevo frena la cola | Handlers registrados. Tipo desconocido se marca `failed`. Los tests existentes del procesador siguen en verde |
| Flow registry | Todos los flows | Romper triggers existentes | Solo altas. `lib/flow-triggers.test.ts` existente en verde |
| Encabezados `frame-ancestors` | Seguridad de la app | Permitir clickjacking en pantallas internas | La excepción aplica solo a `/calendario/*` y `/embed/*`. Test sobre la configuración de encabezados (función pura que arma los encabezados por ruta) |
| Asignación automática del contacto | Scope de leads, trigger `assignment_changed` | Pisar asignaciones hechas a mano | Solo asigna si el campo está vacío. Test |
| Envío de emails desde flows | Cuota de Resend (compartida con la bandeja) | Agotar los 100 emails diarios | La acción respeta la cuota y marca `failed` + notificación si se agota (se reutiliza el conteo de E2-F50) |

---

## 5. Usuarios, roles y permisos

**Permisos nuevos** (se agregan a `PERMISSION_KEYS`, módulo "Agenda"):

| Clave | Qué habilita | Alcance |
|---|---|---|
| `scheduling.use` | Tener agenda propia: perfil, conectar sus cuentas de Google Calendar, sus horarios, excepciones, tiempo fuera y eventos | — |
| `scheduling.manage_others` | Editar perfil (salvo cuentas de Google), horarios y eventos de otras personas | — |
| `scheduling.team_events` | Reservado para la Fase 3 (sin uso en esta etapa) | — |
| `scheduling.manage_categories` | Crear, editar, reordenar y archivar áreas y tipos de agenda | — |
| `bookings.view` | Ver agendas | `bookings`: `own` (es anfitrión) / `all` |
| `bookings.manage` | Cancelar, reagendar, marcar, editar y agendar manualmente | mismo alcance `bookings` |

`workspace_roles.scopes` suma la clave `bookings` (`own` o `all`). Los flujos de un evento usan los permisos existentes `flows.view` y `flows.edit`. La habilidad del agente se configura con el permiso existente `agents.edit`.

| Rol de sistema | Permisos de Agenda |
|---|---|
| **Owner** | Todos, alcance `bookings: all` |
| **Admin** | Todos, alcance `bookings: all` |
| **Member** | `scheduling.use`, `bookings.view`, `bookings.manage`, alcance `bookings: own` (sin `scheduling.manage_categories`) |
| **Rol personalizado** | Lo que marque, con alcance `own` o `all` |

**Qué NO puede nadie:**
- Conectar, desconectar ni ver los tokens de una cuenta de Google de otra persona.
- Ver los eventos de Google de otra persona. Solo se leen horarios ocupados; los títulos de los eventos de Google nunca se muestran.

**Invitado (público, sin sesión):** ve la página de reserva de eventos activos u ocultos (estos últimos con link directo), agenda, y cancela o reagenda su propia agenda con el `uid` secreto.

---

## 6. Alcance específico por módulo

### 6.1 Calendarios (B1)
- **Qué hace:**
  - Cada persona conecta una o varias cuentas de Google con permisos de Calendar.
  - Ve sus calendarios y elige cuáles revisan conflictos y cuál es el destino por defecto.
  - El sistema lee horarios ocupados y crea, mueve y borra eventos.
- **Qué NO hace:** no lee títulos ni detalles de eventos ajenos al sistema; no sincroniza cambios hechos en Google; no soporta Outlook, iCloud ni CalDAV; no crea calendarios nuevos en Google.
- **Dónde va:** sincronización push → Fase 3 o futuro.

### 6.2 Disponibilidad (B2)
- **Qué hace:**
  - Horarios con nombre y zona horaria, uno por defecto.
  - Rangos por día de la semana.
  - Excepciones por fecha (por horario).
  - Tiempo fuera (por persona; aplica a todos sus horarios).
  - Asignación de eventos a horarios desde el horario.
- **Qué NO hace:** feriados por país (nice-to-have si sobra tiempo); reenvío a un compañero durante un tiempo fuera; disponibilidad distinta por semana del año.

### 6.3 Eventos (B3)
- **Qué hace:** eventos 1 a 1 con:
  - Categoría (área y tipo).
  - Detalles, ubicación (Meet o manual) y disponibilidad.
  - Calendario destino y calendarios de conflicto propios.
  - Formulario de reserva (nombre, email, teléfono + preguntas de texto corto, texto largo, selección y selección múltiple).
  - Límites y buffers, asignación del contacto, estado y redirección.
- **Qué NO hace:** eventos de equipo, recurrentes, con cupos o pagos; lógica condicional en el formulario; varias ubicaciones a elegir por el invitado; confirmación manual.

- **Categorías (F50, F51):** dos niveles, área y tipo, configurables. El evento tiene la categoría y la agenda la copia al crearse. **No hace:** más de dos niveles; categorías por persona; reglas automáticas por categoría (futuro).

### 6.4 Reserva (B4)
- **Qué hace:**
  - Booker público estilo Cal.com, con zona horaria del invitado.
  - Crea la agenda, el contacto, el evento en Google con Meet y la invitación.
  - Página de confirmación.
  - Cancelar y reagendar por el invitado.
  - Protección contra doble reserva, antispam y atribución.
- **Qué NO hace:** emails propios de confirmación (los manda Google; los de marca van por flujos en B7); pagos; captcha de terceros (nice-to-have futuro).

### 6.5 Agendas (B5)
- **Qué hace:**
  - Lista, kanban y calendario con filtros.
  - Detalle y acciones del anfitrión.
  - Agendar manual.
  - Agendas en la ficha del contacto.
  - Notificaciones.
- **Qué NO hace:** reasignar a otro anfitrión (Fase 3); exportar (nice-to-have); editar la hora sin pasar por "reagendar".

### 6.6 Embed (B6)
- **Qué hace:**
  - Inline, popup y botón flotante.
  - Tema, color y ocultar detalles.
  - Generador de código con vista previa.
  - Precarga, UTM y eventos hacia la página padre.
- **Qué NO hace:** dominio propio (nice-to-have); plugin de WordPress.

### 6.7 Automatizaciones (B7)
- **Qué hace:**
  - Triggers de agenda (inmediatos y relativos al tiempo), condiciones, acciones y variables.
  - Sección "Flujos" en cada evento.
  - 7 plantillas precreadas apagadas.
- **Qué NO hace:** SMS; plantillas HTML visuales de email (texto con formato simple + variables); workflows fuera del flow builder.

### 6.8 Habilidad de agendamiento para agentes (B8)
- **Qué hace:**
  - Habilidad `scheduling` del tool registry, encendible por agente.
  - Configuración: eventos permitidos (de cualquier anfitrión) con "Cuándo usarlo" y requisitos previos, acciones permitidas (agendar, reagendar, cancelar), modo (agenda directamente o solo comparte el link), cantidad de horarios a proponer, qué hacer si no hay horarios.
  - Herramientas: consultar horarios, agendar, reagendar, cancelar y ver agendas del contacto. Todas usan el mismo motor y la misma creación de agendas que la página pública.
  - Zona horaria del lead: usa la del contacto, la infiere si falta y la confirma.
- **Hasta dónde llega:** solo sobre el contacto de la conversación; solo eventos permitidos; siempre con confirmación explícita del lead.
- **Qué NO hace:** el agente no lee eventos de Google (solo recibe horarios libres); no agenda para terceros; no crea ni edita eventos, horarios o categorías; no agenda en canales en modo borrador (ahí solo propone o comparte link).

---

## 7. Funcionalidades y criterios de aceptación

> **Formato:** descripción + criterios **EARS** (`CUANDO …, EL SISTEMA DEBE …`) o **DADO/CUANDO/ENTONCES** + el test que debe pasar. Google y Resend van simulados (`vi.fn()` sobre `fetch` o sobre el cliente). Los tests van junto al módulo (`*.test.ts`).
>
> **Regla de fechas en tests:** todo test de horarios fija el reloj (`vi.setSystemTime`) y usa zonas IANA explícitas. Hay casos obligatorios con **cambio de horario de verano** (`America/New_York` en marzo y noviembre) y con zonas sin horario de verano (`America/Costa_Rica`).

---

### FASE 1: CALENDARIOS, DISPONIBILIDAD Y EVENTOS

### Bloque 1: Perfil y calendarios

#### F1: Tablas de perfil y calendarios
**Descripción:**
- Migraciones de `scheduling_profiles` y `calendars` (§9.1).
- Cambio en `oauth_connections`: proveedor `google_calendar` + índice único con `external_account_id`.
- `contacts.timezone`.
- Tipos regenerados en `lib/types/database.ts`.

**Criterios:**
- CUANDO la migración se aplica dos veces, NO DEBE fallar.
- CUANDO una persona consulta `calendars` o `scheduling_profiles` de otro workspace, NO DEBE ver filas.
- CUANDO una persona sin `scheduling.manage_others` consulta `calendars`, DEBE ver solo los suyos.
- DADO la conexión de Google/YouTube del workspace (Etapa 2), CUANDO se aplica el cambio de índice, ENTONCES sigue existiendo una única fila y el test de caracterización de la conexión de YouTube sigue en verde.
- Test: `scripts/verify-scheduling.mjs` (nuevo, con usuarios Owner y Member reales y limpieza) sale 0; `verify-rls.mjs` sigue en 0.

#### F2: Permisos del módulo
**Descripción:**
- Claves de §5 en `PERMISSION_KEYS`, con etiquetas en español.
- Alcance `bookings` en `scopeFor`.
- Permisos de los roles de sistema según §5.
- Backfill de `workspace_roles` de sistema existentes (aditivo: suma claves, no quita).
- Función SQL `can_see_booking(booking_id)` (`SECURITY DEFINER`, `SET search_path = ''`): Owner o Admin, o `bookings.view` con alcance `all`, o `host_user_id = auth.uid()`.

**Criterios:**
- CUANDO se evalúa el rol de sistema `member`, DEBE tener `scheduling.use`, `bookings.view` y `bookings.manage` con alcance `own`, y NO `scheduling.manage_others`.
- CUANDO un Member consulta una agenda donde no es anfitrión, `can_see_booking` DEBE devolver `false`.
- Los tests de caracterización de permisos de la Etapa 2 siguen en verde.
- Test: `lib/auth/permissions.test.ts` extendido pasa; `verify-scheduling.mjs` cubre `can_see_booking`.

#### F3: Perfil de agenda (Configuración > Ajustes)
**Descripción:** pantalla `/dashboard/agenda/configuracion/ajustes` (sección **Ajustes** de la configuración de agenda, F8) con:
- **Usuario (va en los links de tus eventos):** slug de 3 a 40 caracteres, solo minúsculas, números y guiones, único en el workspace. Hay una lista de palabras reservadas: `agenda`, `embed`, `api`, `equipo`, `admin`.
- Nombre visible, foto (bucket existente de avatares), zona horaria (selector IANA con buscador; por defecto `workspaces.timezone`), formato de hora `12h`/`24h`. **No hay página pública del usuario** (decisión de Wendy, v1.3): `/calendario/[usuario]` sin evento responde 404; cada evento se comparte por su propio link.
- **Primer ingreso a Agenda:** si la persona no tiene perfil, se le pide completar usuario y zona horaria antes de seguir. El usuario se sugiere a partir de su nombre.
- **Horario inicial:** al crear el perfil se crea "Horario normal" (lunes a viernes, 9:00 a 17:00, zona del perfil, por defecto).

**Criterios:**
- CUANDO se guarda un usuario ya usado en el workspace o reservado, DEBE rechazarse con mensaje claro.
- CUANDO se cambia el usuario y la persona tiene eventos activos, la acción DEBE requerir confirmación explícita (`confirmBrokenLinks: true`); sin ella, DEBE rechazarse indicando cuántos links cambian.
- CUANDO se crea el perfil, DEBE existir exactamente un horario con `is_default = true`.
- Test: `lib/scheduling/profile.test.ts` (validación de usuario, sugerencia, confirmación) pasa.

#### F4: Conectar Google Calendar
**Descripción:**
- Adaptador `google_calendar` del flujo OAuth de la Etapa 2, con permisos `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `…/calendar.events.freebusy` y `…/calendar.events`, más `openid email`.
- Parámetros: `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, `login_hint` opcional.
- **Guard:** exige `scheduling.use`. La conexión se guarda **siempre** con `user_id = auth.uid()` y `external_account_id` = `sub` de Google.
- **Tokens:** van a Vault con un nombre que incluye el id de la conexión.
- **Al volver:** se sincronizan los calendarios (F5) y se redirige a `/dashboard/agenda/configuracion/calendarios?connected=1`.
- **Reconectar la misma cuenta:** actualiza la fila existente, no duplica.

**Criterios:**
- CUANDO un Member inicia la conexión de `google_calendar`, DEBE poder. CUANDO inicia `google`, `linkedin` o `threads`, DEBE seguir recibiendo 403.
- CUANDO la persona no otorgó `calendar.events`, la conexión DEBE quedar `attention` con motivo "Falta el permiso para crear eventos", y sus calendarios DEBEN poder usarse solo para conflictos.
- CUANDO se conecta la misma cuenta de Google dos veces, DEBE existir una sola fila.
- CUANDO se conecta una segunda cuenta distinta, DEBEN existir dos filas para esa persona.
- Test: `lib/oauth/google-calendar.test.ts` cubre los 4 casos con Google simulado.

#### F5: Calendarios de cada cuenta
**Descripción:**
- `syncCalendars(connectionId)` lee `calendarList.list` y hace upsert en `calendars`:
  - Filtra los calendarios de sistema (id que termina en `#holiday@group.v.calendar.google.com`, `#contacts@…`, `#weeknum@…`).
  - Guarda `access_role`, `is_primary` y el color.
  - Los calendarios que ya no vienen quedan `is_active = false`.
- **Defaults en la primera conexión:**
  - `check_conflicts = true` en el calendario primario de la cuenta.
  - Si la persona no tiene calendario destino por defecto, se usa el primario de su primera cuenta (si tiene permiso de escritura).
- **Pantalla `/dashboard/agenda/configuracion/calendarios`:**
  - Una tarjeta por cuenta (email, estado, "Reconectar", "Desconectar").
  - Adentro, sus calendarios con un switch "Revisar conflictos".
  - Selector "Calendario destino por defecto" con los calendarios `owner` o `writer` de todas sus cuentas.
- **Desconectar:** pide confirmación y avisa cuántos eventos usan calendarios de esa cuenta. Borra los tokens de Vault, pone los calendarios `is_active = false` y los eventos que la usaban vuelven a "usar el de mi perfil".

**Criterios:**
- CUANDO se sincroniza, los calendarios de sistema NO DEBEN guardarse.
- CUANDO un calendario tiene `access_role = reader` o `freeBusyReader`, NO DEBE ofrecerse como destino.
- CUANDO se desconecta la cuenta que contiene el calendario destino por defecto, el destino DEBE quedar vacío y el perfil DEBE mostrar el aviso "Elegí un calendario destino".
- CUANDO se sincroniza dos veces, NO DEBE duplicar calendarios.
- Test: `lib/scheduling/calendars.test.ts` pasa.

#### F6: Cliente de Google Calendar
**Descripción:** `lib/google-calendar/client.ts`, adaptado de `CalendarService` de Cal.diy:
- `getAccessToken(connectionId)`: refresh con el refresh token de Vault, cacheado en memoria hasta 1 minuto antes de vencer. Ante `invalid_grant`, marca `revoked` y notifica.
- `getBusy(connectionId, calendarIds[], from, to)`: `freebusy.query`, partiendo el rango en tramos de hasta 90 días.
- `createEvent(connectionId, calendarId, input)`:
  - Llama con `conferenceDataVersion=1` si hay Meet (`createRequest.requestId = booking uid`, `conferenceSolutionKey.type = hangoutsMeet`) y con `sendUpdates=all`.
  - El input lleva inicio y fin en ISO UTC, `timeZone` del anfitrión, invitado (si hay email), descripción con los datos de la agenda y los links de gestionar, y `extendedProperties.private.ssaBookingUid`.
  - Devuelve el id del evento, `iCalUID` y el link de Meet.
- `updateEvent`: patch de fecha, ubicación o descripción, con `sendUpdates=all`.
- `deleteEvent`: con `sendUpdates=all`. Un 404 o 410 se trata como éxito.
- `classifyGoogleError()`: 429, 5xx y errores de red son `temporary`; 401 o `invalid_grant` son `permanent` (reconectar); 403 `insufficientPermissions` es `permanent`; 404 se trata aparte.

**Criterios:**
- CUANDO se pide ocupado en un rango de 120 días, DEBEN hacerse 2 llamadas a freebusy y unirse los resultados.
- CUANDO el refresh devuelve `invalid_grant`, la conexión DEBE quedar `revoked`, crearse `integration_attention` para esa persona y lanzarse un error `permanent`.
- CUANDO la ubicación es Meet, el cuerpo de `events.insert` DEBE incluir `conferenceData.createRequest` y la llamada `conferenceDataVersion=1`.
- CUANDO el formulario no pidió email, el evento NO DEBE tener `attendees`.
- CUANDO `deleteEvent` recibe 410, DEBE resolverse sin error.
- Test: `lib/google-calendar/client.test.ts` cubre los 5 casos con `fetch` simulado.

#### F7: Estado de las conexiones de calendario
**Descripción:**
- Función pura `calendarConnectionStatus(connection)`: `connected`, `attention` (permiso faltante), `revoked` o `error`.
- Si alguna conexión de la persona está `revoked` o `error`:
  - Aviso fijo en todas las pantallas de Agenda: "Reconectá tu Google Calendar".
  - Notificación `integration_attention`, una por causa.
  - Sus eventos dejan de ofrecer horarios (F24).

**Criterios:**
- CUANDO una conexión con calendarios de conflicto pasa a `revoked`, `isUserBookable(userId)` DEBE devolver `false` con motivo `calendar_disconnected`.
- CUANDO la conexión revocada no tiene calendarios de conflicto ni destino en uso, `isUserBookable` DEBE seguir en `true`.
- Test: `lib/scheduling/bookable.test.ts` pasa.

#### F8: Menú "Agenda" y zona horaria de la interfaz
**Descripción:**
- **Menú:** ítem "Agenda" en `lib/nav.ts` (visible con `scheduling.use` o `bookings.view`). Abre directo la pantalla de agendas (B5), **sin pestañas ni sub-menú**.
- **Configuración de agenda (engranaje):** en la barra superior de Agendas, al lado de "+ Agendar", un botón de ícono ⚙ (`aria-label` "Configuración de agenda") abre `/dashboard/agenda/configuracion`, una pantalla con navegación lateral (en móvil, fila desplazable) de 5 secciones: **Eventos** (por defecto) · **Disponibilidad** · **Calendarios de Google** · **Categorías** (visible para todos, editable con `scheduling.manage_categories`) · **Ajustes** (F3 y las opciones del workspace de F49). Cada sección tiene su ruta (`/configuracion/eventos`, `/disponibilidad`, `/calendarios`, `/categorias`, `/ajustes`) y su botón principal en la barra ("+ Nuevo evento", "+ Tiempo fuera" y "+ Nuevo horario", "+ Conectar cuenta de Google", "+ Nuevo tipo", "Guardar cambios"). La barra lleva siempre "‹ Agendas" para volver. El ítem Agenda del menú queda marcado en todas estas pantallas.
- El engranaje se muestra a quien tiene `scheduling.use` o `scheduling.manage_categories`. Quien solo tiene `bookings.view` no lo ve.
- **Zona horaria de la interfaz:** helper `getViewerTimezone(user)` devuelve la zona del perfil de agenda, o la del navegador si no tiene perfil, o la del workspace como último recurso.
- **Formateo:** helpers puros `formatInTz(date, tz, format)` y `rangeForFilter('today' | 'this_week' | {from,to}, tz)` → `{fromUtc, toUtc}`.

**Criterios:**
- CUANDO se pide "Hoy" para `America/Costa_Rica` a las 23:30 del 1/10 hora local (05:30 UTC del 2/10), el rango DEBE ser 1/10 00:00 a 2/10 00:00 hora local, expresado en UTC.
- CUANDO la persona no tiene `scheduling.use` ni `bookings.view`, "Agenda" NO DEBE aparecer.
- CUANDO la persona tiene solo `bookings.view`, el engranaje NO DEBE aparecer y `/dashboard/agenda/configuracion/*` DEBE redirigir a `/dashboard/agenda`.
- Test: `lib/scheduling/time/tz.test.ts` y `lib/nav.test.ts` extendido pasan.

**Bloque 1 listo cuando:** F1 a F8 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `node scripts/verify-rls.mjs` y `node scripts/verify-scheduling.mjs` salen 0; las pantallas se revisaron en escritorio y 390 px o quedó anotado.

---

### Bloque 2: Disponibilidades

#### F9: Tablas de disponibilidad
**Descripción:** migraciones de `availability_schedules` (con las columnas jsonb `weekly_hours` y `date_overrides`) y `out_of_office` (§9.2).
- Índice único parcial: un solo `is_default` por persona (entre los no borrados).
- `weekly_hours` y `date_overrides` se validan con Zod (`lib/scheduling/availability-schema.ts`) en cada Server Action que los escribe: rangos `HH:mm` válidos, fin mayor que inicio, sin superposición en el mismo día, fechas `YYYY-MM-DD`. Una entrada inválida no se guarda.
- RLS: la persona dueña, o quien tenga `scheduling.manage_others`.

**Criterios:**
- CUANDO se intenta insertar un segundo horario por defecto para la misma persona, DEBE fallar.
- CUANDO se intenta guardar `weekly_hours` con un rango que termina antes de empezar, la acción DEBE rechazarlo y no escribir nada.
- CUANDO un Member consulta horarios de otra persona, NO DEBE ver filas.
- Test: `verify-scheduling.mjs` extendido sale 0.

#### F10: Lista de horarios
**Descripción:** sección **Disponibilidad** de la configuración (`/dashboard/agenda/configuracion/disponibilidad`). Una sola pantalla, de arriba abajo: tarjetas de horarios → editor del horario elegido (F11, F12) → tarjeta **Tiempo fuera** (F13).
- Tarjetas de horarios con nombre, resumen ("Lun a Vie, 9:00–17:00"), zona horaria, badge "Por defecto" y cantidad de eventos que lo usan.
- Clic en una tarjeta la marca como elegida y carga su editor debajo (sin cambiar de pantalla; `?horario=<id>` en la URL).
- Acciones: "Nuevo horario" (nombre + zona; botón de la barra), "Marcar por defecto", "Duplicar" y "Borrar".
- Quien tiene `scheduling.manage_others` ve un selector de persona arriba.

**Criterios:**
- CUANDO se marca otro horario por defecto, el anterior DEBE dejar de serlo en la misma transacción.
- CUANDO se intenta borrar el horario por defecto, DEBE rechazarse.
- CUANDO se borra un horario usado por eventos, la acción DEBE exigir el horario de reemplazo y mover esos eventos (`schedule_id`) antes de borrar (soft delete).
- `summarizeSchedule(rules)` DEBE agrupar días consecutivos con los mismos rangos ("Lun a Vie, 9:00–12:00 y 14:00–18:00").
- Test: `lib/scheduling/schedules.test.ts` pasa.

#### F11: Editor semanal
**Descripción:** editor "Editar: [nombre]" debajo de las tarjetas, con un conmutador **Horario semanal | Excepciones**. Vista **Horario semanal**:
- Nombre editable y zona horaria.
- Por cada día: switch, lista de rangos con selectores de hora (cada 15 minutos) y botones "+" (agregar rango) y "copiar a…" (elegir días).
- Portado del editor de Cal.diy.
- Guardado explícito, con aviso si se sale con cambios sin guardar (`lib/unsaved-changes.ts`).

**Criterios:**
- CUANDO dos rangos del mismo día se superponen, la validación (función pura compartida por cliente y servidor) DEBE rechazar con el día marcado.
- CUANDO un rango termina a las 00:00, DEBE interpretarse como fin del día (24:00).
- Test: `lib/scheduling/rules-validation.test.ts` pasa.

#### F12: Excepciones por fecha
**Descripción:** vista **Excepciones** del horario elegido. **Aplican solo a ese horario**; los otros horarios no cambian (texto fijo arriba de la lista).
- Lista de fechas futuras con excepción (fecha y qué pasa ese día) con "Editar" y "Borrar".
- **Flujo "+ Agregar excepción"** (modal "Nueva excepción", subtítulo "Solo para el horario [nombre] · los demás horarios no cambian"):
  1. **Elegí uno o varios días:** calendario mensual de selección múltiple (clic marca y desmarca). Los días que el horario no trabaja se pueden elegir igual (sirve para abrir un sábado puntual).
  2. **¿Qué pasa esos días?:** "No disponible todo el día" (no se ofrecen horarios) u "Horario distinto" (reemplaza el horario semanal de ese día) con uno o varios rangos y "+ Rango".
  3. **Resumen** en vivo ("sáb 3 oct, sáb 10 oct · solo 10:00–12:00") y pie con la zona horaria del horario.
  4. "Guardar excepción": agrega una entrada por día en `date_overrides` y muestra el toast "Excepción guardada en N días · solo para [horario]". "Guardar" está deshabilitado sin días elegidos.
- Editar abre el mismo modal con ese día cargado.
- Las excepciones pasadas se ocultan (se conservan en la base).

**Criterios:**
- CUANDO una fecha tiene excepción con rangos, en el motor de horarios (F23) DEBE reemplazar las reglas semanales de ese día (no sumarse).
- CUANDO la excepción es "no disponible", ese día NO DEBE tener horarios.
- CUANDO se guarda una excepción en el horario A, el horario B NO DEBE cambiar.
- CUANDO se eligen 3 días y se guarda, DEBEN quedar 3 entradas nuevas en `date_overrides` del horario, en una sola actualización.
- Al guardar, las excepciones de fechas pasadas de más de 90 días se recortan de `date_overrides` (se conservan en `audit_log`).
- Test: cubierto en `lib/scheduling/slots/*.test.ts` (F23) + `lib/scheduling/overrides.test.ts` (validación) pasa.

#### F13: Tiempo fuera
**Descripción:** en la interfaz se llama **Tiempo fuera** (en la base sigue siendo `out_of_office`). Es de la persona y **aplica a todos sus horarios y todos sus eventos**. No vive dentro de un horario: es una tarjeta propia en Disponibilidad, debajo del editor, con el texto "Vacaciones, viajes, días libres. Bloquea todos tus horarios y todos tus eventos".
- Lista de períodos (fechas, chip de motivo, nota) con "Editar" y "Borrar".
- **Flujo "+ Tiempo fuera"** (botón de la barra y de la tarjeta; modal "Agregar tiempo fuera", subtítulo "Aplica a todos tus horarios ([nombres]) y a todos tus eventos"):
  1. Desde y hasta (fecha) + switch "Días completos (en tu zona)", encendido por defecto. Apagado, aparecen las horas.
  2. Motivo en chips: Vacaciones, Viaje, Enfermedad, Otro (`vacation`, `travel`, `sick`, `other`).
  3. Nota privada opcional.
  4. **Aviso de conflictos antes de guardar:** apenas el rango está completo, si hay agendas activas en ese período, se muestra "Tenés N agendas en ese período" con cada una (fecha, contacto, evento) y un link "Reagendar". Texto: "No se cancelan solas: reagendalas o cancelalas si hace falta". No bloquea el guardado.
  5. "Guardar tiempo fuera".

**Criterios:**
- CUANDO se guarda un período del 20/12 al 31/12 sin hora con zona `America/Costa_Rica`, `starts_at` DEBE ser 20/12 06:00 UTC y `ends_at` 01/01 06:00 UTC.
- CUANDO hay 2 agendas activas (Agendada, Confirmada o Reagenda) en el rango, la acción DEBE devolver esas 2 en `conflictingBookings`.
- CUANDO el fin es anterior al inicio, DEBE rechazarse.
- Test: `lib/scheduling/out-of-office.test.ts` pasa.

#### F14: Eventos que usan este horario
**Descripción:** cada tarjeta de horario muestra "Lo usan: …" y el editor del horario tiene, al pie, "Eventos con este horario": todos los eventos de la persona, con un switch.
- **Encender:** asigna el evento a este horario.
- **Apagar:** lo devuelve a "usar el horario por defecto" (`schedule_id = null`).
- Los eventos que usan implícitamente el horario por defecto se muestran encendidos en ese horario, con la etiqueta "por defecto".

**Criterios:**
- CUANDO se enciende un evento que estaba en otro horario, su `schedule_id` DEBE pasar a este.
- CUANDO se apaga un evento en el horario por defecto, NO DEBE cambiar nada (sigue usando el por defecto) y DEBE mostrarse un tooltip explicativo.
- Test: `lib/scheduling/schedule-assignment.test.ts` pasa.

#### F15: Vista previa del horario (nice-to-have)
**Descripción:** calendario de las próximas 2 semanas con los horarios libres de un evento de 30 minutos, sin contar Google.
**Criterios:**
- Usa la misma función del motor (F23) con `busy = []`.
- Test: incluido en los tests de F23.

**Bloque 2 listo cuando:** F9 a F14 (F15 si se llegó) cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-scheduling.mjs` sale 0; las pantallas se revisaron o quedó anotado.

---

### Bloque 3: Tipos de evento

#### F50: Categorías de agenda (se construye primero en este bloque)
**Descripción:**
- Migración de `booking_categories` (§9.3), una sola tabla con dos niveles: `parent_id` null = **área**; con `parent_id` = **tipo** dentro del área. No se permite un tercer nivel (CHECK por trigger: el padre tiene que ser un área).
- **Precarga por workspace** (backfill + al crear un workspace): áreas `Ventas` y `Servicio` (`is_system = true`: se renombran, no se borran); tipos `Triaje`, `Cierre` y `Seguimiento` en Ventas, y `Onboarding` y `Uno a uno` en Servicio.
- **Pantalla `/dashboard/agenda/configuracion/categorias`:**
  - Lista por área, con sus tipos debajo, color del área, cantidad de eventos y agendas.
  - Crear área o tipo (nombre de hasta 40 caracteres, color para las áreas), renombrar, reordenar arrastrando y archivar.
  - Los archivados se muestran aparte y se pueden restaurar.
- **Permisos:** `scheduling.manage_categories` para escribir; lectura para todos los miembros.

**Criterios:**
- CUANDO se crea un workspace (o corre el backfill), DEBEN existir exactamente 2 áreas y 5 tipos precargados.
- CUANDO se intenta crear un tipo cuyo padre es otro tipo, DEBE fallar.
- **No hay borrado:** áreas y tipos solo se archivan (DELETE bloqueado por RLS, sin acción en la interfaz). CUANDO se intenta archivar un área de sistema, DEBE rechazarse.
- CUANDO se crea un área con el nombre de otra área activa (sin importar mayúsculas), DEBE rechazarse.
- CUANDO se archiva un tipo, NO DEBE ofrecerse en el editor de eventos, pero los eventos y agendas que lo tienen DEBEN seguir mostrándolo.
- CUANDO un Member sin `scheduling.manage_categories` intenta crear una categoría, DEBE responder "sin permiso" (Server Action y RLS).
- Test: `lib/scheduling/categories.test.ts` pasa; `verify-scheduling.mjs` cubre RLS y precarga.

#### F51: Categoría en eventos y agendas
**Descripción:**
- **Editor de eventos, sección Detalles:** selector de **área** (obligatoria; por defecto Ventas) y **tipo** (opcional, filtrado por el área elegida). Se guarda en `event_types.category_id` (el tipo si se eligió; si no, el área).
- **Al crear una agenda** (F26), se copian `bookings.category_id` y `bookings.category_snapshot` (`{area_id, area_name, type_id, type_name}`). Reclasificar el evento no modifica agendas existentes.
- Helper puro `resolveCategory(categoryId, categories)` → `{area, type}`, usado por filtros, flujos y variables.

**Criterios:**
- CUANDO se guarda un evento sin área, DEBE rechazarse.
- CUANDO se elige un tipo que no pertenece al área, DEBE rechazarse.
- DADO un evento Ventas · Triaje con una agenda creada, CUANDO el evento pasa a Ventas · Cierre, ENTONCES la agenda existente DEBE seguir siendo Triaje y las nuevas DEBEN ser Cierre.
- CUANDO se filtra por el área Ventas, DEBEN incluirse los eventos y agendas de cualquier tipo de Ventas y los que tienen solo el área.
- Test: `lib/scheduling/categories.test.ts` (extendido) y `lib/scheduling/booking/create.test.ts` (snapshot de categoría) pasan.

#### F16: Tablas de eventos
**Descripción:**
- Migración de `event_types` (§9.3), con `conflict_calendar_ids uuid[]`. `event_types.category_id` (FK a `booking_categories`, área o tipo) se crea en esta migración; F50 crea la tabla de categorías **antes**.
- El anfitrión es `owner_user_id`. No se crea `event_type_hosts` en esta etapa.
- RLS de escritura: el dueño, o quien tenga `scheduling.manage_others`. Lectura: los miembros del workspace (para elegir eventos en flows y en el agendar manual).
- La lectura pública se hace solo desde el servidor, con service role y campos filtrados. **No hay policy para anon.**

**Criterios:**
- CUANDO se crea un evento con un slug ya usado por la misma persona (no borrado), DEBE fallar.
- CUANDO otra persona usa el mismo slug, DEBE permitirse.
- CUANDO un Member intenta editar un evento ajeno, DEBE fallar por RLS.
- Test: `verify-scheduling.mjs` extendido sale 0.

#### F17: Lista de eventos
**Descripción:** pantalla `/dashboard/agenda/configuracion/eventos`:
- Tarjetas con barra de color, título, duración, ícono de ubicación, estado (Activo, Oculto, Inactivo) y link `/{usuario}/{slug}`.
- Acciones: "Copiar link", "Vista previa" (abre el booker en otra pestaña), switch Activo/Inactivo y menú (Editar, Duplicar, Embed (B6), Borrar).
- Las tarjetas se agrupan por área (encabezado con el color del área y sus tipos).
- **Flujo "+ Nuevo evento"** (botón de la barra de Configuración > Eventos; modal "Nuevo evento"). Pide solo lo mínimo y crea el resto con lo que la persona ya tiene configurado:
  1. **Título** (obligatorio).
  2. **Link:** prefijo fijo `…/calendario/[usuario]/` + slug autogenerado desde el título y editable, con verificación en vivo ("✓ Disponible" o "Ya usás ese link").
  3. **Área** (obligatoria) y **Tipo** en chips; "+ Nueva" solo con `scheduling.manage_categories`.
  4. **Duración:** 15, 30, 45, 60 min u "Otra".
  5. **Ubicación:** Google Meet (el link se crea solo con cada agenda) o Ubicación manual.
  6. Recuadro **"Se crea con lo que ya tenés configurado"**: horario por defecto, calendario destino y de conflictos del perfil, formulario base (nombre, email y teléfono), asignación del contacto (F22) y los 7 flujos sugeridos apagados (F49, si la opción del workspace está encendida). "Todo se puede cambiar después en el editor".
  7. Pie: "Queda inactivo hasta que lo actives" + "Crear y configurar": crea el evento **Inactivo** y abre el editor (F18) con el toast "Evento creado (inactivo) · se crearon 7 flujos sugeridos, apagados".
- Selector de persona para quien tiene `scheduling.manage_others`. Filtros por área y tipo; las tarjetas muestran un chip con la categoría (color del área).
- **Vacío:** "Creá tu primer evento", y si no hay calendario conectado, "Conectá tu Google Calendar primero" con link.

**Criterios:**
- CUANDO se duplica un evento, DEBE copiarse toda la configuración con slug `<slug>-copia` (o `-copia-2`, …), estado Inactivo y sin copiar agendas.
- CUANDO se borra un evento con agendas futuras, la acción DEBE rechazar salvo `confirm: true` y, en ese caso, hacer soft delete sin tocar las agendas.
- `slugify("Llamada de Descubrimiento ñ")` DEBE dar `llamada-de-descubrimiento-n`.
- CUANDO se crea un evento desde el modal, DEBE quedar `status = 'inactive'`, con `schedule_id = null` (usa el por defecto) y el formulario base, y el editor DEBE abrirse en Detalles.
- Test: `lib/scheduling/event-types.test.ts` pasa.

#### F18: Editor, sección Detalles y ubicación
**Descripción:** pantalla `/dashboard/agenda/configuracion/eventos/[id]`.
- **Layout:**
  - En escritorio: navegación lateral de secciones (Detalles · Disponibilidad y calendarios · Formulario · Límites y buffers · Si no se puede agendar · Flujos · Compartir y embed) y, en la barra, "‹ Eventos" (vuelve a Configuración > Eventos), indicador de cambios sin guardar, "Vista previa" y "Guardar".
  - **Tarjeta "Listo para activar"** arriba de todo mientras el evento está Inactivo: chips de chequeo (✓ Detalles, ✓ Horario: [nombre], ✓ Calendario: [nombre], ○ Revisá el formulario, ○ Encendé los flujos que quieras). Cada chip lleva a su sección. Botón "Activar evento". Los tres primeros son obligatorios; formulario y flujos son recomendaciones y no bloquean. Se oculta cuando el evento está Activo u Oculto.
  - **Compartir y embed** es la sección del generador de B6 (F40), con el link del evento arriba.
  - **Si no se puede agendar** es la sección de F58.
  - En móvil: secciones en una fila desplazable.
- **Sección Detalles:**
  - Título, slug con prefijo visible y verificación de disponibilidad, descripción (editor con negrita, cursiva, listas y links; se guarda como markdown y se sanitiza al mostrar).
  - Duración: 15, 30, 45 o 60 minutos, o personalizada de 5 a 480.
  - Color (paleta de 8).
  - **Ubicación:** `google_meet` o `manual` (texto hasta 500 caracteres) + switch "Mostrar la ubicación solo después de agendar".
  - **Estado:** Activo, Oculto o Inactivo.
  - "Después de agendar": página de confirmación o redirección a una URL `https://` (con opción de pasar los datos de la agenda como parámetros).

**Criterios:**
- CUANDO la ubicación es `google_meet` y el calendario destino efectivo no es de Google o no tiene permiso de escritura, el guardado DEBE advertir "No se puede crear Meet sin un calendario destino de Google con permiso de escritura" y bloquear la activación del evento.
- CUANDO la URL de redirección no empieza con `https://`, DEBE rechazarse.
- CUANDO falta un ítem obligatorio del chequeo (detalles válidos, horario, calendario destino con escritura si es Meet), "Activar evento" DEBE estar deshabilitado con el motivo. Formulario y flujos NO DEBEN bloquear.
- CUANDO se cambia el slug de un evento con agendas futuras, DEBE pedirse confirmación.
- Test: `lib/scheduling/event-validation.test.ts` pasa.

#### F19: Editor, sección Disponibilidad y calendarios
**Descripción:**
- Selector de horario ("Horario por defecto (Horario normal)" + los demás) con resumen del horario elegido y link para editarlo.
- **Calendario destino:** "Usar el de mi perfil ([nombre])" o un calendario `owner`/`writer` de sus cuentas.
- **Calendarios de conflicto:** "Usar los de mi perfil (N calendarios)" o "Elegir para este evento" (lista de checkboxes por cuenta, que se guarda en `event_types.conflict_calendar_ids`; vacío = los del perfil). Al leer, los ids de calendarios desconectados o inactivos se ignoran; al desconectar un calendario, se quita de las listas de los eventos de esa persona.
- Nota fija: "Tus agendas del sistema siempre bloquean, sin importar esta selección".

**Criterios:**
- `resolveEventCalendars(eventType, profile, calendars)` DEBE devolver `{destination, conflicts}`:
  - Con modo `profile`, los calendarios de la persona con `check_conflicts` y `is_active`.
  - Con modo `custom`, los de la tabla que sigan activos.
  - El destino del evento, o el del perfil si es null.
- CUANDO el modo es `custom` y todos los calendarios elegidos quedaron inactivos, DEBE devolver `conflicts = []` con advertencia `no_conflict_calendars`.
- Test: `lib/scheduling/resolve-calendars.test.ts` pasa.

#### F20: Formulario de reserva
**Descripción:** sección **Formulario**, con constructor portado de Cal.diy y limitado a lo pedido.
- **Campos del sistema:**
  - `name`: siempre visible y obligatorio, sin controles.
  - `email`: visible y obligatorio por defecto. Se puede pasar a opcional u oculto.
  - `phone`: visible y opcional por defecto. Se puede pasar a obligatorio u oculto. Selector de país (por defecto el del workspace).
- **Preguntas propias:** tipos `short_text`, `long_text`, `select`, `multiselect`. Cada una tiene etiqueta, texto de ayuda, placeholder, obligatoria, opciones (2 a 50, para las de selección) e identificador (autogenerado desde la etiqueta, único, editable; se usa en variables).
- **Guardar en el contacto** (nice-to-have): una pregunta se puede mapear a un `custom_field_definitions` de tipo texto.
- Reordenar arrastrando (los campos del sistema quedan arriba, en orden fijo).
- Se guarda en `event_types.booking_fields` (jsonb, validado con Zod).
- **Validación del lado del invitado:** `buildBookingSchema(fields)` genera el esquema Zod usado en el booker y en el servidor.

**Criterios:**
- CUANDO se intenta dejar email y teléfono los dos ocultos u opcionales, el guardado DEBE rechazarse con "Email o teléfono tiene que ser obligatorio".
- CUANDO dos preguntas tienen el mismo identificador, DEBE rechazarse.
- DADO un formulario con email obligatorio y una selección múltiple obligatoria, CUANDO se valida una respuesta sin email o con una opción que no existe, ENTONCES `buildBookingSchema` DEBE devolver error en ese campo.
- CUANDO el teléfono no tiene formato válido E.164 después de normalizar con el país elegido, DEBE rechazarse.
- Test: `lib/scheduling/booking-fields.test.ts` pasa.

#### F21: Límites y buffers
**Descripción:** sección **Límites y buffers**:
- Buffer antes y después (0, 5, 10, 15, 30, 60 minutos).
- Aviso mínimo (minutos, horas o días; por defecto 2 horas).
- Intervalo entre horarios (por defecto "igual a la duración"; opciones 5, 10, 15, 20, 30, 60).
- Máximo de agendas por día y por semana (vacío = sin tope).
- Ventana futura: "N días corridos" (por defecto 60), "N días hábiles", "Entre fechas" o "Sin límite".
- **No hay límite para cancelar o reagendar** (decisión de Wendy): el invitado puede hacerlo desde el link hasta la hora de inicio.

**Criterios:**
- CUANDO se guarda "Entre fechas" con fin anterior al inicio, DEBE rechazarse.
- CUANDO el aviso mínimo supera la ventana futura, DEBE advertirse "No va a haber horarios disponibles".
- Test: `lib/scheduling/event-validation.test.ts` extendido pasa.

#### F22: Asignación del contacto
**Descripción:** en Detalles, selector "Al agendar, asignar al anfitrión como":
- `none`.
- `setter_if_empty`.
- `vendedor_if_empty`.

**Valor por defecto según el área** del evento, al crearlo o al cambiar de área (si la persona no lo tocó a mano): **Ventas → `vendedor_if_empty`**; **Servicio y cualquier otra área → `none`**. Se aplica en F26.

**Criterios:**
- `applyContactAssignment(contact, hostId, mode)` DEBE:
  - Con `vendedor_if_empty` y `vendedor_id` vacío, devolver `{vendedor_id: hostId}`.
  - Con `vendedor_id` ya lleno, devolver `{}`.
  - Con `none`, devolver `{}`.
- `defaultAssignmentForArea(area)` DEBE devolver `vendedor_if_empty` para el área de sistema Ventas y `none` para Servicio y para áreas nuevas.
- Test: `lib/scheduling/assignment.test.ts` pasa.

**Bloque 3 listo cuando:** F50, F51 y F16 a F22 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-scheduling.mjs` sale 0; las pantallas se revisaron o quedó anotado.

---

### Bloque 4: Reserva pública

#### F23: Motor de horarios libres
**Descripción:** `lib/scheduling/slots/*`, portado de Cal.diy y **puro** (sin base ni red).
- **Entrada:** `{ eventType (duración, intervalo, buffers, aviso mínimo, ventana, topes), schedule (tz, reglas), overrides, outOfOffice[], busy[] (Google, en UTC), bookings[] (del sistema: inicio, fin y buffers de su evento), bookingCounts (por día y semana en la zona del horario), now, range {from,to}, inviteeTz }`.
- **Salida:** `{ [fechaEnZonaDelInvitado]: [{ startUtc, endUtc }] }`.

**Pasos:**
1. Genera ventanas por día en la zona del horario: reglas semanales, reemplazadas por la excepción del día si existe.
2. Resta el tiempo fuera.
3. Resta ocupado de Google.
4. Resta agendas del sistema expandidas con **los buffers de las dos agendas**: la existente, con los de su evento; la nueva, con los propios.
5. Parte las ventanas en horarios según el intervalo.
6. Descarta los que no entran completos (duración + buffers).
7. Aplica aviso mínimo, ventana futura y topes por día y semana.
8. Agrupa por fecha en la zona del invitado.

**Criterios:**
- DADO un horario lunes 9:00–12:00 `America/Costa_Rica`, evento de 30 minutos e intervalo igual a la duración, ENTONCES el lunes DEBE ofrecer 6 horarios (9:00 a 11:30).
- DADO una agenda existente de 10:00 a 10:30 con buffer de 15 minutos después, y un evento nuevo sin buffers, ENTONCES NO DEBE ofrecerse 10:30 y SÍ 10:45 (con intervalo de 15).
- DADO un horario de lunes a viernes 9:00–17:00 `America/New_York` (el horario de verano empieza el domingo 8/3/2026 y termina el domingo 1/11/2026), ENTONCES el primer horario DEBE ser 14:00 UTC el viernes 6/3, 13:00 UTC el lunes 9/3, 13:00 UTC el viernes 30/10 y 14:00 UTC el lunes 2/11.
- DADO un invitado en `Asia/Tokyo` y un horario en `America/Costa_Rica` de 18:00 a 20:00, ENTONCES esos horarios DEBEN aparecer agrupados en el día siguiente en la zona del invitado.
- DADO un horario 9:00–17:00 `America/Costa_Rica`, evento de 30 minutos con intervalo de 30, aviso mínimo de 2 h y `now` = martes 6/10/2026 10:10 hora de Costa Rica (16:10 UTC), ENTONCES el primer horario de ese día DEBE ser 12:30 hora local (18:30 UTC).
- DADO un tope de 2 por día con 2 agendas ese día, ENTONCES ese día NO DEBE ofrecer horarios.
- DADO una excepción "no disponible" el miércoles, ENTONCES el miércoles DEBE estar vacío. DADO una excepción 14:00–15:00 el jueves, ENTONCES el jueves DEBE ofrecer solo ese rango.
- DADO tiempo fuera del 20/12 al 31/12, ENTONCES esos días DEBEN estar vacíos.
- Test: `lib/scheduling/slots/slots.test.ts` cubre los 8 casos (y los tests portados de Cal.diy que apliquen) y pasa.

#### F24: API pública de horarios
**Descripción:** `GET /api/public/scheduling/slots?user=&event=&from=&to=&tz=`:
1. Resuelve el evento (activo u oculto, perfil activo) con service role.
2. Verifica `isUserBookable` (F7).
3. Arma la entrada del motor: busy de Google en paralelo por conexión, agendas del sistema del anfitrión en el rango (+ margen de buffers) y conteos.
4. Devuelve horarios.

- Rango máximo: 45 días por consulta.
- Cache en memoria de 60 segundos para el busy de Google, con clave `(ids de calendarios de conflicto ordenados, from, to)` (dos eventos del mismo anfitrión pueden revisar calendarios distintos).
- `GET /api/public/scheduling/event?user=&event=` devuelve solo los datos públicos: título, descripción, duración, tipo de ubicación (el texto solo si no está oculto), nombre y foto del anfitrión, campos del formulario, formato de hora y color.

**Criterios:**
- CUANDO el evento está `inactive` o no existe, DEBE responder 404 con `{reason: 'not_found'}`.
- CUANDO `isUserBookable` es `false`, DEBE responder 200 con `{slots: {}, unavailableReason: 'temporarily_unavailable'}`, sin detalles internos.
- CUANDO Google falla con error temporal, DEBE responder `unavailableReason: 'temporarily_unavailable'` (nunca ofrecer horarios sin haber leído los calendarios de conflicto).
- CUANDO el rango supera 45 días, DEBE responder 400.
- La respuesta de `event` NO DEBE incluir ids internos de calendarios, emails del anfitrión ni configuración de límites.
- Test: `app/api/public/scheduling/slots.test.ts` y `event.test.ts` pasan (base y Google simulados).

#### F25: Booker (página pública de reserva)
**Descripción:** ruta `/calendario/[usuario]/[evento]` (Server Component que carga el evento + cliente para la interacción), portada del Booker de Cal.diy.

**Layout en escritorio** (3 columnas):
- **Izquierda:** foto y nombre del anfitrión, título, duración, ubicación (ícono de Meet o texto), descripción y selector de zona horaria (con buscador, detectada con `Intl.DateTimeFormat().resolvedOptions().timeZone`).
- **Centro:** calendario del mes con los días con horarios resaltados, navegación de meses y "hoy". Sin días disponibles en el mes, botón "Ir al próximo mes con disponibilidad".
- **Derecha:** horarios del día elegido y conmutador 12h/24h (por defecto, el del perfil del anfitrión).

**Flujo y pantallas:**
- Al elegir un horario, la columna derecha pasa al formulario con el resumen ("Martes 6 de octubre, 14:00 – 14:30") y botones "Atrás" y "Confirmar".
- **Móvil:** pasos: info → calendario → horarios → formulario.
- **Tema:** `?theme=light|dark|auto`, por defecto `auto` (según `prefers-color-scheme`). Color principal con `?color=` (hex) o el del evento.
- **Precarga:** `?name=&email=&phone=&<identificador>=`. Los UTM (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`) y `fbclid`/`gclid` se capturan.
- **Idioma:** textos en español (voseo) y fechas con `Intl` en `es`.

**Estados:**
- Cargando: skeleton.
- Sin horarios en el mes que se mira, pero sí más adelante: "No hay horarios en este mes" + "Ir al próximo mes con disponibilidad".
- Sin horarios en toda la ventana del evento: mensaje **"Sin horarios"** del evento (F58).
- `temporarily_unavailable` o error al traer los horarios: mensaje **"No disponible"** del evento (F58).
- La página o los horarios no cargan (error de red o más de 10 segundos sin respuesta): mensaje **"No carga"** del evento (F58), con "Reintentar".
- Evento inexistente: página 404 propia.
- Error al confirmar por horario tomado: mensaje y recarga de horarios, conservando lo escrito en el formulario.
- Error al confirmar por falla del servidor o de Google (503) o de red: mensaje **"No disponible"** del evento (F58), conservando lo escrito, con "Reintentar".

**Criterios:**
- `buildMonthView(slotsByDate, month, tz)` DEBE marcar como disponibles exactamente los días con al menos un horario.
- `formatSlotLabel(startUtc, tz, '12h')` para 20:00 UTC en `America/Costa_Rica` DEBE dar `2:00 p. m.` y en `24h`, `14:00` (el test normaliza los espacios especiales que agrega `Intl`, U+00A0 y U+202F, antes de comparar).
- CUANDO la URL trae `?email=a@b.com`, el campo email DEBE precargarse.
- `parseEmbedParams(searchParams)` DEBE devolver tema, color, precarga y UTM validados (color hex válido, tema dentro de la lista).
- Test: `lib/scheduling/booker/*.test.ts` pasa. Revisión visual del booker en escritorio, 390 px, claro y oscuro (no requiere sesión, así que es obligatoria).

#### F26: Crear la agenda
**Descripción:** `POST /api/public/scheduling/bookings` (y la Server Action equivalente para el agendar manual de F37), en `lib/scheduling/booking/create.ts`:

1. Valida la entrada con `buildBookingSchema` + `{eventId, startUtc, inviteeTz, utm, referrer, honeypot}`.
2. Antispam (F29).
3. Recalcula en el servidor, con el motor y datos frescos (Google sin cache), que `startUtc` sea un horario válido. Si Google falla en esta verificación, responde 503 `{reason: 'temporarily_unavailable'}` sin crear nada.

**Contacto ya conocido:** `create.ts` acepta `contactId?`. Si viene (agendar manual desde la ficha, F37; agente, F55), se saltea la búsqueda del paso 4a y se usa ese contacto; igual se completan sus campos vacíos (email, teléfono, zona horaria).
4. En **una sola transacción**, implementada como función SQL `create_booking(...)` (plpgsql, `SECURITY DEFINER`, `SET search_path = ''`, llamada por RPC desde `create.ts`; el cliente de Supabase no puede sostener una transacción entre llamadas), con `pg_advisory_xact_lock(hashtextextended(host_user_id::text, 0))`:
   - a. `find_or_link_contact` con email y teléfono. Si crea el contacto: nombre, email, teléfono, `timezone`, `attribution` (UTM, referrer, `source: 'scheduling'`). Si existe: completa solo los campos vacíos (incluida `timezone`) y no pisa nada.
   - b. Aplica la asignación (F22) actualizando `setter_id`/`vendedor_id` dentro de la función. Esa actualización dispara el trigger de Postgres existente que emite `assignment_changed` en `automation_events` (Claude Code lo confirma; si la emisión vive en TypeScript, la función devuelve `assignment_changed: true` y `create.ts` la emite después del commit).
   - c. Inserta `bookings` con `status = 'scheduled'` (Agendada), snapshot de título, ubicación, respuestas y datos del invitado, `host_timezone`, `booker_timezone`, `origin`, `utm`, `referrer_url`, `created_by`, `uid` aleatorio (22 caracteres URL-safe) e `is_do_not_contact_at_booking`. Si el contacto tenía la marca "no contactar", se registra en la agenda.
   - d. Inserta el historial en `audit_log` (`entity_type = 'booking'`, `action = 'booking.created'`; ver §9.4).
   - e. Inserta en `automation_events` el evento `booking_created`.
   - f. Encola el job `booking_google_sync` (`run_at = now`).
5. Responde `{uid, startUtc, endUtc, redirectUrl?}`.

**El job `booking_google_sync`** (`payload.action`):
- `create`: `createEvent` en el calendario destino.
- `update`: `updateEvent` con la referencia guardada en la agenda (`google_event_id`, `google_calendar_id`) (reagendar, cambio de ubicación).
- `delete`: `deleteEvent` (cancelación); deja `google_event_deleted_at`.
- Guarda en la agenda `google_connection_id`, `google_calendar_id`, `google_event_id`, `ical_uid` y `meet_url`, y pone `google_sync_status = synced`. Cada resultado queda en `audit_log` (`booking.sync_ok` o `booking.sync_failed`).
- Política de reintentos (igual para `create`, `update` y `delete`): 1 intento inicial + hasta 3 reintentos ante error `temporary` (a los 1, 5 y 15 minutos).
- Ante error `permanent` o si falla el cuarto intento: `failed` + `google_sync_error` + notificación `booking_sync_failed` al anfitrión.
- El booker espera hasta 8 segundos a que el job termine (consultando el estado) para mostrar el link de Meet. Si no llega, la confirmación dice "El link de Meet llega en la invitación".

**Protección contra doble reserva:**
- Además del lock, restricción de exclusión en `bookings`: `EXCLUDE USING gist (host_user_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status IN ('scheduled', 'confirmed', 'rescheduled'))` (estados activos, §9.4). Requiere `btree_gist`.

**Criterios:**
- DADO dos solicitudes simultáneas al mismo horario del mismo anfitrión, CUANDO se procesan en paralelo, ENTONCES exactamente una DEBE crear la agenda y la otra DEBE responder 409 `{reason: 'slot_taken'}`.
- CUANDO el `startUtc` no es un horario válido (fuera de horario, dentro del aviso mínimo, ocupado en Google), DEBE responder 409 `slot_unavailable` sin crear nada.
- CUANDO el email coincide con un contacto existente, NO DEBE crearse otro y la agenda DEBE apuntar a ese contacto. Sus campos llenos NO DEBEN cambiar.
- CUANDO no existe contacto, DEBE crearse con `attribution.source = 'scheduling'` y los UTM.
- CUANDO el evento tiene `vendedor_if_empty` y el contacto no tiene vendedor, DEBE quedar el anfitrión como vendedor y existir el evento `assignment_changed`.
- CUANDO se crea la agenda, DEBEN existir una fila en `audit_log` (`booking.created`), un `automation_events` `booking_created` y un job `booking_google_sync`.
- CUANDO Google falla con error temporal en los 4 intentos, la agenda DEBE seguir en su estado activo con `google_sync_status = 'failed'` y DEBE existir la notificación.
- Test: `lib/scheduling/booking/create.test.ts` (base y Google simulados) + `scripts/verify-booking-concurrency.mjs` (nuevo: 2 inserciones reales en paralelo contra la base, con limpieza) salen 0.

#### F27: Página de confirmación
**Descripción:** `/calendario/agenda/[uid]`, estado "confirmada":
- Tilde y "¡Listo! Tu reunión está agendada".
- Evento, fecha y hora en la zona del invitado (con la zona escrita), anfitrión y ubicación o link de Meet (si ya está).
- "Agregar a mi calendario": Google (link de template), Outlook (link) y `.ics` (endpoint `/api/public/scheduling/bookings/[uid]/ics`).
- Links "Reagendar" y "Cancelar".
- Si el evento tiene redirección, se redirige después de crear la agenda (con los datos si está configurado) en lugar de mostrar esta página.
- La misma ruta sirve para gestionar la agenda desde los links: muestra el estado para el invitado: "Agendada" (cualquier estado activo con fecha futura), "Cancelada" (cualquier estado de cancelación) o "Esta reunión ya pasó" (el resto). Nunca muestra resultados internos (Venta, No califica, seguimientos).

**Criterios:**
- `buildIcs(booking)` DEBE generar un VEVENT válido con `DTSTART` y `DTEND` en UTC, `UID` = `iCalUID` (o `uid@dominio`), `SUMMARY` y `LOCATION`.
- CUANDO el `uid` no existe, DEBE mostrarse 404 (sin revelar si existió).
- CUANDO la agenda está cancelada, NO DEBEN mostrarse los botones de reagendar ni cancelar.
- Test: `lib/scheduling/ics.test.ts` y `lib/scheduling/booking-page.test.ts` pasan.

#### F28: Cancelar y reagendar por el invitado
**Descripción:**

**Cancelar:** desde `/calendario/agenda/[uid]`, botón "Cancelar" → motivo opcional (hasta 500 caracteres) → confirmar. `lib/scheduling/booking/cancel.ts`:
- `status = 'cancelled_other'` (Cancelada – otro), `cancelled_at`, `cancelled_by_type = 'invitee'`, `cancellation_reason` (el texto que escribió).
- `audit_log` (`booking.cancelled`).
- `automation_events` `booking_cancelled`.
- Job `booking_google_sync` con `action: 'delete'` (misma política de reintentos).
- Anulación de los jobs relativos pendientes de esa agenda (F44).
- Notificación al anfitrión.

**Reagendar:** `/calendario/agenda/[uid]/reagendar` abre el booker del mismo evento con el formulario ya lleno (no se vuelve a pedir) y el aviso "Estás cambiando tu reunión del [fecha anterior]". Al confirmar, en `lib/scheduling/booking/reschedule.ts`:
- Valida el horario excluyendo la propia agenda.
- Actualiza `start_at`/`end_at` de la **misma agenda** y suma `reschedule_count`.
- `audit_log` (`booking.rescheduled`, con fecha anterior y nueva en `changes`).
- `status = 'rescheduled'` (Reagenda), también si estaba Confirmada.
- `automation_events` `booking_rescheduled`.
- Job `booking_google_sync` con `action: 'update'`.
- Reprograma los jobs relativos.
- Notificación al anfitrión.

**Criterios:**
- CUANDO se cancela o reagenda una agenda que no está en un estado activo, o cuya hora de inicio ya pasó, DEBE responder 409 sin cambios.
- CUANDO el invitado cancela, el estado DEBE ser `cancelled_other`; CUANDO reagenda, `rescheduled`.
- CUANDO se reagenda, la validación del horario NO DEBE contar la propia agenda como ocupada (se puede mover 15 minutos dentro de su propio rango).
- CUANDO se reagenda, DEBE seguir existiendo una sola fila de agenda con el mismo `uid` `reschedule_count = 1` y `status = 'rescheduled'`.
- CUANDO se cancela, los jobs `booking_relative_trigger` pendientes de esa agenda DEBEN quedar `cancelled`.
- Test: `lib/scheduling/booking/cancel.test.ts` y `reschedule.test.ts` pasan.

#### F29: Antispam y atribución
**Descripción:**
- **Campo trampa:** `website`, oculto con CSS. Si llega lleno, se responde 200 falso sin crear nada.
- **Tope por IP:** 10 intentos de creación por hora y 60 consultas de horarios por minuto, en la tabla genérica `rate_limits` (clave con prefijo `scheduling:`) (IP con hash SHA-256 + sal del servidor; se purga a las 24 h).
- **Atribución:** `origin` = `embed` si la solicitud trae `embed=1`, si no `public_page`. `referrer_url` = URL de la página padre (embed) o `document.referrer`, validada como URL `http(s)`, hasta 500 caracteres.

**Criterios:**
- CUANDO una IP supera 10 creaciones en una hora, la número 11 DEBE responder 429.
- CUANDO el campo trampa trae valor, NO DEBE crearse nada y la respuesta DEBE parecer exitosa.
- CUANDO se guarda la IP, NO DEBE quedar en texto plano en ninguna tabla ni log.
- Test: `lib/scheduling/antispam.test.ts` pasa.

#### F58: Mensajes cuando no se puede agendar
**Descripción:** cada evento define qué ve el invitado cuando no puede agendar, para que nunca quede en una pantalla vacía o con un error técnico, y siempre tenga una salida (escribirte por WhatsApp, mandar un email o ir a otra página).

**Dónde se configura:** sección **"Si no se puede agendar"** del editor de eventos (F18). El editor ya existe desde el Bloque 3; esta sección se agrega en este bloque, junto con el booker. Tres casos, elegidos con un conmutador, con vista previa en vivo en tema claro y oscuro:

| Caso (`key`) | Cuándo aparece | Texto por defecto |
|---|---|---|
| **Sin horarios** (`no_slots`) | El motor no devuelve ningún horario en toda la ventana del evento (agenda llena, tope alcanzado, tiempo fuera largo) | "No hay horarios disponibles por ahora" · "Todos los espacios de {{event_title}} están tomados. Escribinos y te buscamos un lugar." |
| **No disponible** (`unavailable`) | `temporarily_unavailable` (Google caído o desconectado, perfil inactivo, F7), error al traer los horarios o 503 al confirmar | "No podemos mostrar los horarios en este momento" · "Probá de nuevo en unos minutos o escribinos." |
| **No carga** (`load_error`) | La página o el embed no cargan: error de red, servidor caído o más de 10 segundos sin respuesta | "No pudimos cargar el calendario" · "Revisá tu conexión y probá de nuevo, o escribinos." |

**Cada caso tiene:**
- **Título** (hasta 80 caracteres) y **texto** (hasta 500, texto plano con saltos de línea). Variables permitidas: `{{event_title}}` y `{{host_name}}`.
- **Botón opcional** con texto (hasta 40) y destino:
  - **WhatsApp:** número en formato internacional + mensaje precargado opcional (con las mismas variables). Arma `https://wa.me/<número>?text=…`.
  - **Email:** dirección + asunto opcional. Arma `mailto:`.
  - **Link:** URL `https://`.
- Switch **"Usar el mismo para los tres casos"** para cargar uno solo.
- "Restablecer texto por defecto".

**Cómo se muestra:**
- En el booker (F25), el mensaje ocupa la columna del calendario y horarios. La columna izquierda (anfitrión, título, duración) se mantiene cuando hay datos. `unavailable` y `load_error` suman un botón "Reintentar"; `no_slots` no.
- En `load_error`, la página del booker muestra el mensaje con los datos que ya tenga (se entregan en el HTML inicial del Server Component, así que no dependen de la llamada que falló) y "Reintentar".
- **Embed (F39):** si el iframe no avisa que cargó (`postMessage` `ssa:loaded`) en 10 segundos o da error, `embed.js` reemplaza el iframe, en la página del cliente, por el mensaje `load_error`. Como en ese caso el servidor puede estar caído, el título, el texto y el botón de `load_error` **viajan dentro del snippet** que genera F40 (`data-ssa-fallback`, JSON). Si el snippet no los trae (código viejo), se muestra el texto por defecto y un link "Abrir el calendario en otra pestaña".
- El mensaje respeta el tema y el color del booker o del embed.
- Siempre se registra el motivo técnico en el servidor (sin datos del invitado) y el invitado nunca ve códigos de error.
- **Agente (B8):** cuando el motor no devuelve horarios, `get_available_slots` incluye en su respuesta el texto y el destino del botón de `no_slots`, para que el agente pueda ofrecer la misma salida (sin cambiar `on_no_slots` de F53).

**Modelo:** columna `event_types.unavailable_messages jsonb` (null = textos por defecto), validada con Zod: `{ same_for_all: bool, no_slots?: Msg, unavailable?: Msg, load_error?: Msg }`, donde `Msg = { title, body, cta?: { label, kind: 'whatsapp'|'email'|'link', value, prefill? } }`. Se suma en la migración de `event_types` (B3).

**Criterios:**
- `resolveUnavailableMessage(eventType, key, vars)` DEBE devolver el mensaje del caso, el de `same_for_all` si está activo, o el texto por defecto si no hay nada configurado, con las variables reemplazadas.
- `buildCtaHref({kind:'whatsapp', value:'+506 8888-1234', prefill:'Hola, quiero agendar {{event_title}}'}, vars)` DEBE dar `https://wa.me/50688881234?text=` + el texto codificado. Con `email`, DEBE dar `mailto:` con el asunto codificado. Con `link` que no empieza con `https://`, la validación DEBE rechazarlo.
- CUANDO el motor devuelve cero horarios en toda la ventana, el booker DEBE mostrar `no_slots`. CUANDO hay horarios en un mes posterior, DEBE mostrar "Ir al próximo mes con disponibilidad" y no `no_slots`.
- CUANDO la API responde `temporarily_unavailable` o 503 al confirmar, DEBE mostrarse `unavailable` y el formulario DEBE conservar lo escrito.
- CUANDO la llamada de horarios no responde en 10 segundos, DEBE mostrarse `load_error` con "Reintentar".
- `generateEmbedCode` (F40) DEBE incluir `data-ssa-fallback` con el `load_error` del evento. CUANDO el iframe no manda `ssa:loaded` en 10 segundos, `embed.js` DEBE mostrar ese mensaje (test con temporizadores simulados).
- El texto del mensaje DEBE mostrarse como texto plano (sin HTML) en el booker y en el embed.
- Test: `lib/scheduling/booker/unavailable.test.ts` y `lib/embed/fallback.test.ts` pasan. Revisión visual de los tres casos en el booker (escritorio y 390 px, claro y oscuro).

**Bloque 4 listo cuando:** F23 a F29 y F58 (F30 se eliminó en la v1.2: no hay límites de cambios; F31, la página pública del usuario, se eliminó en la v1.3) cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-scheduling.mjs` y `verify-booking-concurrency.mjs` salen 0; el booker se revisó en escritorio y 390 px en tema claro y oscuro.

**Fase 1 lista cuando:** los Bloques 1 a 4 están listos y `docs/PROGRESS.md` los marca.

---

### FASE 2: RESERVAS, EMBED, AUTOMATIZACIONES Y AGENTES

### Bloque 5: Pantalla de agendas

#### F32: Estados de agenda y lógica común
**Descripción:** catálogo de estados en código (`lib/scheduling/booking-status.ts`), definido por Wendy. Cada estado tiene clave, etiqueta, color, orden y **grupo**; el sistema decide por el grupo.

| Clave | Etiqueta | Grupo | Cómo se llega |
|---|---|---|---|
| `scheduled` | Agendada | `active` | Automático al crear la agenda |
| `confirmed` | Confirmada | `active` | A mano (o por flujo o agente) cuando el lead confirma que asiste |
| `rescheduled` | Reagenda | `active` | Automático al reagendar (invitado, equipo o agente); también a mano |
| `no_show` | No-show | `no_show` | A mano, después de la hora de inicio |
| `followup_warm` | Seguimiento tibio | `outcome` | A mano, después de la hora de inicio |
| `followup_cold` | Seguimiento frío | `outcome` | Ídem |
| `sale` | Venta | `outcome` | Ídem |
| `not_qualified` | No califica | `outcome` | Ídem |
| `cancelled_not_qualified` | Cancelada – no califica | `cancelled` | A mano (equipo), flujo o agente |
| `cancelled_no_response` | Cancelada – no contesta | `cancelled` | Ídem |
| `cancelled_other` | Cancelada – otro | `cancelled` | Automático si cancela el invitado desde el link; a mano con motivo |

**Reglas de transición** (`canTransition(from, to, booking, now)`):
- `active` → cualquier estado `active` o `cancelled` en cualquier momento.
- `active` → `no_show` u `outcome` solo si la hora de inicio ya pasó.
- `no_show` ↔ `outcome` y `outcome` ↔ `outcome` (corrección), sin límite de tiempo.
- `no_show` / `outcome` → `confirmed` (corrección: "todavía no se hizo"), solo si el horario sigue libre (la exclusión de la base lo garantiza).
- `cancelled` es final. Para volver a verla, se agenda de nuevo.
- Pasar a un estado `cancelled` ejecuta la cancelación completa (F28 o F36): borra el evento en Google y anula los jobs.

**Funciones puras en `lib/scheduling/bookings-view.ts`:**
- `needsOutcome(booking, now)`: estado `active` y el fin ya pasó ("sin resultado").
- `filterBookings(params)`: armado de la consulta con alcance según permiso.
- `groupForKanban(bookings)`: por estado, en el orden de la tabla.
- `allowedDrops(booking, now)`: columnas a las que se puede arrastrar.

**Criterios:**
- CUANDO una agenda `scheduled` terminó hace 1 minuto, `needsOutcome` DEBE dar `true`.
- CUANDO se intenta pasar a `sale` una agenda que todavía no empezó, `canTransition` DEBE dar `false`.
- CUANDO se intenta pasar de `cancelled_other` a `confirmed`, DEBE dar `false`.
- CUANDO se pasa de `no_show` a `sale`, DEBE permitirse.
- CUANDO la persona tiene alcance `own`, `filterBookings` DEBE restringir a `host_user_id = viewer` aunque el filtro pida otro anfitrión.
- La lista de claves del catálogo DEBE coincidir con el CHECK de `bookings.status` (test que compara ambas).
- Test: `lib/scheduling/booking-status.test.ts` y `bookings-view.test.ts` pasan.

#### F33: Vista lista
**Descripción:** `/dashboard/agenda` (vista por defecto: lista).
- **Sin pestañas.** La pantalla de agendas no tiene pestañas de ningún tipo (decisión de Wendy, v1.3). Arriba de la tabla, **filtros rápidos en pastillas** con contador: Próximas (activas con fecha futura, orden ascendente) · Sin resultado (activas cuya hora ya pasó) · Con resultado (No-show y resultados, orden descendente) · Canceladas.
- **Barra superior:** conmutador Lista | Kanban | Calendario, filtros Estado, Área y Anfitrión (este último solo con alcance `all`), "+ Agendar" (F37) y el engranaje ⚙ de Configuración de agenda (F8).
- **Columnas:** fecha y hora (zona de quien mira), contacto (link a la ficha), evento (con su color), categoría (área · tipo), anfitrión (si ve a otros), estado (chip con el color del estado), origen e ícono de "sin sincronizar" si aplica.
- **Cambio de estado desde la fila:** el chip de estado es un menú con los estados permitidos (`canTransition`).
- **Filtros en la URL:** estado (uno o varios), área, tipo, evento, anfitrión (solo con alcance `all`), rango de fechas (selector de período existente), búsqueda por nombre, email o teléfono.
- Paginación de 50.
- **Vacío:** "Todavía no hay agendas" + "Conectar Google Calendar" (lleva a Configuración > Calendarios) y "+ Agendar".

**Criterios:**
- CUANDO se elige el filtro Sin resultado, DEBE listar solo agendas en estado activo con el fin en el pasado.
- CUANDO un Member (alcance `own`) abre la lista, DEBE ver solo las suyas (RLS + filtro).
- Test: cubierto por F32 + `verify-scheduling.mjs` (visibilidad por RLS) sale 0.

#### F34: Vista kanban
**Descripción:**
- **Una columna por estado**, en el orden de F32: Agendada · Confirmada · Reagenda · No-show · Seguimiento tibio · Seguimiento frío · Venta · No califica · Cancelada – no califica · Cancelada – no contesta · Cancelada – otro. Con contador y scroll horizontal.
- Cada columna se puede **contraer** (queda una franja con el nombre y el contador). Por defecto quedan contraídas las 3 de cancelación. La preferencia se guarda por persona en el navegador.
- Las columnas de resultado, no-show y cancelación muestran los últimos 30 días, con "ver más".
- Los filtros de la barra (área, tipo, evento, anfitrión) aplican igual al kanban y al calendario.
- **Tarjeta:** fecha y hora, contacto, evento (color), chip de categoría, anfitrión, íconos (Meet, "no contactar", sin sincronizar) y badge **"Sin resultado"** si `needsOutcome`.
- **Arrastre:** solo a las columnas de `allowedDrops`. Soltar en una columna de cancelación abre el modal de cancelar (motivo opcional; Google avisa al invitado). Cualquier otro arrastre inválido se revierte con el motivo.
- Usa el kanban de la Etapa 2.

**Criterios:**
- CUANDO se arrastra a Venta una agenda que todavía no empezó, DEBE revertirse con "El resultado se carga después de la hora de inicio".
- CUANDO se arrastra de Agendada a No-show una agenda que ya pasó, DEBE quedar `no_show`, con `status_changed_at`/`by`, `audit_log` (`booking.status_changed`) y `automation_events` `booking_status_changed`.
- CUANDO se suelta en Cancelada – no contesta y se confirma el modal, DEBEN ocurrir los efectos de F36 (cancelar) con ese estado.
- CUANDO se intenta arrastrar una tarjeta de una columna de cancelación, NO DEBE poder moverse.
- Test: `lib/scheduling/kanban.test.ts` (reglas de arrastre) pasa.

#### F35: Vista calendario
**Descripción:**
- Vistas mes, semana y día en la zona de quien mira, con todas las agendas salvo las canceladas (se ocultan, con un switch para mostrarlas). El chip lleva el color del estado.
- Chip con hora, contacto y color del evento. Clic abre el detalle.
- Sin arrastrar para reagendar en esta etapa (se reagenda desde el detalle).
- Usa el calendario de la Etapa 2.

**Criterios:**
- `placeInCalendar(bookings, tz, view)` DEBE ubicar una agenda de 23:30 a 00:30 hora local en el día de inicio, con indicación de que cruza la medianoche.
- Test: `lib/scheduling/calendar-view.test.ts` pasa.

#### F36: Detalle y acciones del anfitrión
**Descripción:** panel lateral (en móvil, pantalla completa) con:
- Encabezado con estado y acciones.
- Contacto (nombre, email, teléfono, link a la ficha, marca "no contactar").
- Fecha y hora en tu zona + "hora del invitado" con su zona.
- Evento, anfitrión, ubicación o link de Meet (con botón copiar).
- Respuestas del formulario, origen y UTM, notas internas (editables, solo internas), historial y estado de Google (con "Reintentar sincronización" si falló).

**Acciones** (con `bookings.manage` y alcance):
- **Cambiar estado:** selector con los estados permitidos (F32).
- **Cancelar:** elegir Cancelada – no califica, Cancelada – no contesta o Cancelada – otro, motivo opcional; `cancelled_by_type = 'host'`; Google avisa al invitado.
- **Reagendar:** booker interno del evento, con opción "Ignorar disponibilidad" que igual respeta la exclusión de superposición.
- **Marcar Confirmada** con un botón directo (atajo del selector).
- **Editar ubicación manual o notas internas:** si cambió cualquiera de las dos, se dispara `booking_updated`; si cambió la ubicación, además se actualiza el evento en Google (`booking_google_sync` con `action: 'update'`).
- **Copiar link de reagendar** (para mandar por chat).
- **Corregir la categoría** de la agenda (área y tipo), con registro en `audit_log` (`booking.updated`).

**Criterios:**
- CUANDO el anfitrión cancela, DEBEN ocurrir los mismos efectos que en F28 con `cancelled_by_type = 'host'`.
- CUANDO se reagenda con "Ignorar disponibilidad" a un horario que se superpone con otra agenda del anfitrión, DEBE rechazarse (exclusión).
- CUANDO se cambia el estado, DEBEN quedar `status_changed_at`/`by`, `audit_log` (`booking.status_changed` con `from`/`to` en `changes`) y `automation_events` `booking_status_changed`.
- CUANDO una persona sin `bookings.manage` abre el detalle, NO DEBE ver las acciones y las Server Actions DEBEN responder "sin permiso".
- Test: `lib/actions/bookings.test.ts` pasa.

#### F37: Agendar manualmente
**Descripción:** botón "Agendar" en la pantalla de agendas y en la ficha del contacto.
- **Flujo "+ Agendar"** (modal "Agendar una llamada" con indicador de 5 pasos arriba, "Atrás", "Cancelar" y "Siguiente"):
  1. **Evento:** "¿Qué tipo de llamada?", eventos agrupados por área (propios, o de otros con `scheduling.manage_others`), con color, duración y anfitrión. No se listan los inactivos.
  2. **Contacto:** "¿Para quién es?", buscador por nombre, @, email o teléfono con resultados (nombre, dato de contacto, canal y zona). "+ Crear contacto nuevo" despliega nombre (obligatorio), email y teléfono. Desde la ficha del contacto, este paso viene resuelto.
  3. **Horario:** calendario del mes con solo los días que tienen horarios libres (horario del evento, excepciones, tiempo fuera y Google Calendar) y, al elegir un día, los horarios en la zona de quien agenda. Nota "[Contacto] está en [zona]: le llega en su hora" y switch "Ignorar el aviso mínimo · solo para el equipo".
  4. **Formulario:** las preguntas del evento, precargadas con lo que se sabe del contacto; para el equipo todo es opcional.
  5. **Confirmar:** resumen (evento, contacto, cuándo en ambas zonas, anfitrión, ubicación) y recuadro "Qué va a pasar al agendar" (evento en Google con Meet, invitación de Google al contacto, flujos encendidos que se disparan). Botón "Agendar".
- Al agendar: toast "Agendada · Google envió la invitación con Meet", la vista vuelve a Lista > Próximas y se abre el detalle de la nueva agenda.
- Usa `create.ts` con `origin = 'manual'` y `created_by`.

**Criterios:**
- CUANDO se agenda desde la ficha, la agenda DEBE quedar con ese `contact_id` sin pasar por la deduplicación.
- CUANDO se activa "Ignorar aviso mínimo", DEBE poder agendarse dentro del aviso, pero NO sobre un horario ocupado.
- Test: `lib/scheduling/booking/create.test.ts` extendido (modo manual) pasa.

#### F38: Agendas en la ficha del contacto y notificaciones
**Descripción:**
- **Ficha del contacto:** sección "Agendas" con próximas y pasadas (fecha, evento, estado, anfitrión), botón "Agendar" y clic al detalle. Respeta `can_see_booking`: un Member ve en la ficha solo las agendas donde es anfitrión.
- **Notificaciones nuevas en `NOTIFICATION_TYPES`:** `booking_created`, `booking_rescheduled`, `booking_cancelled` y `booking_sync_failed`, para el anfitrión, con link al detalle.

**Criterios:**
- CUANDO un invitado cancela, el anfitrión DEBE recibir una notificación `booking_cancelled` con `entity_type = 'booking'`.
- CUANDO el anfitrión cancela desde el sistema, NO DEBE notificarse a sí mismo.
- Test: `lib/notifications/create.test.ts` extendido pasa.

**Bloque 5 listo cuando:** F32 a F38 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-scheduling.mjs` sale 0; las pantallas se revisaron o quedó anotado.

---

### Bloque 6: Embed

#### F39: Script de embed
**Descripción:** portado de `embed-core` y `embed-snippet` de Cal.diy (MIT) y servido en `/embed/embed.js`. Es un snippet chico que carga el script y expone `SSA(...)`:
- `SSA("init", {origin})`.
- `SSA("inline", {elementOrSelector, calLink: "wendy/llamada", config})`.
- `SSA("floatingButton", {calLink, buttonText, buttonColor, buttonPosition})`.
- **Popup:** cualquier elemento con `data-ssa-link="wendy/llamada"` (+ `data-ssa-config` JSON) abre un modal.
- `SSA("ui", {theme: "light"|"dark"|"auto", brandColor, hideEventTypeDetails, layout: "month_view"})`.

El iframe carga `/calendario/{calLink}?embed=1&theme=…`. Si no avisa que cargó en 10 segundos, se muestra el mensaje de respaldo de F58. En modo embed, el booker no muestra encabezado ni pie, tiene fondo transparente en inline y ajusta su alto automáticamente (manda la altura por `postMessage`).

**Criterios:**
- `buildEmbedIframeUrl(calLink, config, parentUtm)` DEBE generar `/calendario/wendy/llamada?embed=1&theme=dark&color=%23aa00ff&utm_source=…`, conservando los UTM de la página padre y la precarga.
- CUANDO `brandColor` no es hex válido, DEBE ignorarse.
- Test: `lib/embed/url.test.ts` pasa; `npm run build` genera `public/embed/embed.js`.

#### F40: Generador de código
**Descripción:** modal "Embed" en la lista y en el editor de eventos:
- Conmutador Dentro de la página | Popup al hacer clic | Botón flotante (en la sección Compartir y embed del editor).
- Opciones: tema, color, ocultar detalles del evento, texto, color y posición del botón (flotante).
- Vista previa en vivo (iframe del booker con esas opciones).
- Código para copiar en HTML y en React (componente simple que inserta el snippet), con el mensaje de respaldo `load_error` del evento incluido (F58). Botón "Copiar".

**Criterios:**
- `generateEmbedCode(mode, options, baseUrl)` DEBE producir el snippet con el `origin` correcto (`workspaces.scheduling_public_base_url` o `NEXT_PUBLIC_APP_URL`) y las opciones serializadas.
- Test: `lib/embed/code.test.ts` (los 3 modos × HTML y React) pasa.

#### F41: Eventos hacia la página y precarga
**Descripción:**
- **Mensajes por `postMessage` a la ventana padre:** `ssa:bookerReady`, `ssa:slotSelected`, `ssa:bookingSuccessful` (`{uid, startTime, endTime, eventSlug, meetUrl?}`), `ssa:rescheduleSuccessful` y `ssa:bookingCancelled`.
- `SSA("on", {action, callback})` permite escucharlos.
- **Precarga desde el código:** `config: {name, email, phone, <identificador>}`.
- **Seguridad:** los mensajes no incluyen datos del formulario, solo lo listado. El iframe valida el origen de los mensajes entrantes contra el `origin` configurado.

**Criterios:**
- CUANDO se crea una agenda en modo embed, el booker DEBE emitir `ssa:bookingSuccessful` con exactamente esas claves.
- `serializeEmbedEvent` NO DEBE incluir email, teléfono ni respuestas.
- Test: `lib/embed/events.test.ts` pasa.

#### F42: Dominio propio (nice-to-have)
**Descripción:**
- Campo "URL pública de la agenda" en la configuración del workspace (`scheduling_public_base_url`, ej: `https://agenda.wendymardigian.com`), usado en links, invitaciones y embeds.
- Guía para apuntar el dominio a Railway (CNAME).
- El middleware sirve `/calendario/*` también en ese host y redirige el resto al dominio principal.

**Criterios:**
- CUANDO se pide `/dashboard` desde el host de agenda, DEBE redirigir al dominio principal.
- Test: `lib/scheduling/public-host.test.ts` pasa.

**Bloque 6 listo cuando:** F39 a F41 (F42 si se llegó) cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila y genera el script; una página HTML de prueba local (`docs/embed-test.html`, no se publica) con los 3 modos se revisó con el navegador de Claude Code.

---

### Bloque 7: Automatizaciones

#### F43: Eventos de agenda y triggers inmediatos
**Descripción:**
- **Eventos en `automation_events`**, emitidos en F26, F28, F34, F36, F46 (acciones de flows) y F55 (agente):
  - `booking_created`
  - `booking_rescheduled`
  - `booking_cancelled` (con `cancelled_by_type` y el estado de cancelación)
  - `booking_updated`
  - `booking_ended`
  - `booking_status_changed` (payload con `from_status`, `to_status`, `to_group`)
- **Payload:** `{booking_id, event_type_id, host_user_id, origin, previous_start_at?}`.
- **`booking_ended`:** lo emite el job `booking_ended`, programado en `end_at` al crear o reagendar la agenda. Se anula al cancelar.
- **Triggers en el flow registry:** `booking_created`, `booking_rescheduled`, `booking_cancelled` (filtro "por quién": cualquiera, invitado, equipo o sistema, que incluye agente y flujos), `booking_updated`, `booking_ended`, `booking_status_changed` (filtros "a estado" y opcional "desde estado", con atajos por grupo: "cualquier resultado", "cualquier cancelación"). Todos con filtros opcionales en `triggers.config`: `category_ids[]` (un área incluye todos sus tipos), `event_type_ids[]` (vacío = todos), `host_user_ids[]` y `origins[]` (incluye `agent`). Se evalúan sobre la categoría **copiada en la agenda**.
- **Idempotencia:** `dedupe_key` = `<tipo>:<booking_id>:<versión>`, donde la versión es `reschedule_count` para los que se repiten al reagendar.

**Criterios:**
- CUANDO se crea una agenda del evento A y hay un flow activo con `booking_created` filtrado al evento B, NO DEBE iniciarse. Con filtro vacío o que incluye A, SÍ.
- CUANDO un flow filtra por el área Ventas y la agenda es Ventas · Cierre, DEBE iniciarse. CUANDO filtra por Servicio, NO.
- CUANDO se procesa dos veces el mismo `automation_events`, el flow DEBE iniciarse una sola vez.
- CUANDO se cancela una agenda, su job `booking_ended` pendiente DEBE quedar `cancelled`.
- CUANDO un flow inicia por una agenda, el contexto DEBE incluir el contacto de la agenda (`contact_id`) y la variable `booking`.
- Test: `lib/scheduling/automation/triggers.test.ts` y `lib/flow-triggers.test.ts` (existente, en verde) pasan.

#### F44: Triggers relativos al tiempo
**Descripción:**
- **Triggers:**
  - `booking_before_start` (`offset` en minutos, horas o días).
  - `booking_after_end`.
  - `booking_after_created`.
  - Todos con los mismos filtros que F43.
- **Al crear una agenda** (o al activarse un flow con este trigger, solo para agendas futuras ya existentes), por cada trigger activo que aplica se crea un job `booking_relative_trigger` con `run_at` calculado sobre UTC y `dedupe_key = rel:<trigger_id>:<booking_id>:<reschedule_count>`.
- **Al reagendar:** se anulan los pendientes y se recrean con la nueva versión (los `after_created` no se recrean).
- **Al cancelar:** se anulan todos.
- **Al desactivar o borrar el flow o el trigger:** se anulan sus jobs pendientes.
- **Momento pasado:** si `run_at` ya pasó al crearse, no se crea el job.
- **Al ejecutarse:** verifica que la agenda siga en un estado activo (para `before_start`) y no cancelada (para los demás), y que el trigger siga activo. Si no, termina sin iniciar el flow.

**Criterios:**
- DADO una agenda el 10/10 15:00 UTC y un trigger "24 h antes", ENTONCES el job DEBE tener `run_at` 9/10 15:00 UTC.
- DADO una agenda creada a las 13:00 para las 15:00 del mismo día y un trigger "24 h antes", ENTONCES NO DEBE crearse el job.
- CUANDO se reagenda, el job anterior DEBE quedar `cancelled` y existir uno nuevo con el `run_at` recalculado.
- CUANDO se activa un flow con "1 h antes" y existen 3 agendas futuras que aplican, DEBEN crearse 3 jobs.
- CUANDO el job corre y la agenda fue cancelada (sin que se haya anulado por algún motivo), NO DEBE iniciar el flow.
- Test: `lib/scheduling/automation/relative.test.ts` pasa.

#### F45: Condiciones de agenda
**Descripción:** condiciones registradas:
- `has_upcoming_booking` (evento opcional).
- `last_booking_status` (uno de … estados de F32).
- `last_booking_result` ("tuvo resultado" = grupo `outcome`; "no-show"; "cancelada"; "sin resultado").
- `no_show_count` (operador + número).

Todas evaluadas sobre el contacto del flow y acotables por `category_id` (área o tipo) o `event_type_id`.

**Criterios:**
- DADO un contacto con una agenda futura del evento A, `has_upcoming_booking({eventTypeId: A})` DEBE ser `true`, y con B, `false`.
- DADO un contacto con 2 no-shows, `no_show_count >= 2` DEBE ser `true`.
- DADO un contacto con una agenda próxima Servicio · Onboarding, `has_upcoming_booking({categoryId: Ventas})` DEBE ser `false` y con `Servicio`, `true`.
- Test: `lib/scheduling/automation/conditions.test.ts` pasa.

#### F46: Acciones: enviar email y acciones de agenda
**Descripción:**

**Nodo genérico `send_email`** (sirve para cualquier flow):
- Destinatario: **el contacto** (por defecto), **el anfitrión de la agenda** (así cada persona arma sus propios avisos de "te agendaron", "cancelaron", etc.) o un email fijo.
- Asunto y cuerpo (texto con formato simple → HTML básico), ambos con variables.
- Remitente: nombre y dirección de la configuración de Resend.
- Envía por Resend con la clave de Vault y registra en `email_log`.
- Sin email en el contacto: el paso se saltea con motivo `no_email`.
- Respeta la cuota diaria (se reutiliza el conteo de E2-F50): si se agota, falla con motivo `quota` y notifica a los admins.
- Los flows de agenda envían aunque el contacto tenga "no contactar" (regla del alcance). Los demás flows respetan `do_not_contact` como los demás nodos de envío.

**Acciones de agenda:**
- `cancel_booking` (sobre la agenda del contexto, con estado de cancelación y motivo): efectos de F28 con `cancelled_by_type = 'system'`.
- `set_booking_status` (cualquier estado no cancelado permitido por `canTransition`; para cancelar se usa `cancel_booking`, que elige el estado de cancelación, por defecto `cancelled_other`).

**Criterios:**
- CUANDO el contacto no tiene email, `send_email` DEBE registrar el paso como salteado y seguir con el flow.
- CUANDO el flow viene de un trigger de agenda y el contacto tiene "no contactar", `send_email` DEBE enviar. En un flow sin trigger de agenda, NO DEBE enviar.
- CUANDO Resend responde error, el paso DEBE quedar fallido con el error y el `email_log` con estado de error.
- Test: `lib/flow-engine/nodes/send-email.test.ts` y `lib/scheduling/automation/actions.test.ts` pasan.

#### F47: Variables de agenda
**Descripción:** en el contexto del flow, `booking.*`:
- `event_title`, `category_area`, `category_type`, `start_invitee` (ej: "martes 6 de octubre, 14:00 (hora de Ciudad de México)"), `start_host`, `date_invitee`, `time_invitee`, `invitee_timezone`, `duration`.
- `location`, `meet_url`, `host_name`, `reschedule_url`, `cancel_url`, `cancellation_reason`.
- `answers.<identificador>`.

Variable global `scheduling.link.<usuario>.<slug>` para insertar el link de cualquier evento en cualquier mensaje. Todas aparecen en el selector de variables del editor de mensajes.

**Criterios:**
- `bookingVariables(booking, eventType, host)` DEBE formatear `start_invitee` en la zona del invitado y en español.
- Una respuesta de selección múltiple DEBE quedar unida por comas.
- CUANDO el flow no tiene agenda en el contexto, las variables `booking.*` DEBEN quedar vacías sin romper el mensaje.
- Test: `lib/scheduling/automation/variables.test.ts` pasa.

#### F48: Sección "Flujos" en el evento
**Descripción:** en el editor de eventos, sección **Flujos**:
- Lista de los flows cuyo trigger es de agenda y aplica a este evento (filtro vacío o que lo incluye), agrupados en "De este evento" (`flows.event_type_id` = este) y "De todos los eventos".
- Cada fila: switch activo (con `flows.edit`), nombre, "Cuándo: …" en lenguaje simple ("24 horas antes de la agenda · Email al contacto") y "Editar", que abre el **editor de flujo del evento** (F57).
- Botón "+ Nuevo flujo": crea un flow apagado con `event_type_id` = este y un trigger `booking_created` filtrado a este evento, y abre F57.

**Criterios:**
- `flowsForEventType(flows, triggers, eventTypeId)` DEBE incluir los flows con filtro vacío y los filtrados a ese evento, y excluir los filtrados a otros.
- `describeTrigger(trigger)` para `booking_before_start` con 1440 minutos DEBE dar "24 horas antes de la agenda".
- CUANDO una persona sin `flows.edit` ve la sección, los switches DEBEN estar deshabilitados.
- Test: `lib/scheduling/automation/event-flows.test.ts` pasa.

#### F49: Flujos precreados
**Descripción:**
- **"Flujo encendido"** = `flows.status = 'published'` y su trigger con `is_active = true`; **apagado** = `status = 'draft'` o trigger inactivo (`flows.status` existe, default `'draft'`, verificado). El switch de F48 cambia los dos.
- **Opción del workspace:** switch "Crear flujos sugeridos al crear un evento" (`workspaces.scheduling_auto_create_flows`), en **Configuración de agenda > Ajustes**, editable con el permiso existente `settings.manage`. En la misma sección va el dominio propio de F42 (si se construye).

Al crear un evento (si `workspaces.scheduling_auto_create_flows = true`, que es el valor por defecto), se crean **apagados** (`status = 'draft'`, trigger inactivo), con `event_type_id` y `template_key`, filtrados al evento y con nombre `[Título del evento] · <plantilla>`:

| `template_key` | Trigger | Pasos |
|---|---|---|
| `confirmation` | `booking_created` | `send_email` "Confirmamos tu reunión: {{booking.event_title}}" con fecha, ubicación/Meet y links de reagendar y cancelar |
| `reminder_24h` | `booking_before_start` 24 h | `send_email` recordatorio |
| `reminder_1h` | `booking_before_start` 1 h | `send_email` recordatorio + condición "tiene WhatsApp" → enviar mensaje por el canal WhatsApp (si hay canal conectado; si no, solo email) |
| `rescheduled` | `booking_rescheduled` | `send_email` con la nueva fecha |
| `cancelled` | `booking_cancelled` (por el invitado o el sistema) | `send_email` con link para volver a agendar (`scheduling.link…` del mismo evento) |
| `no_show` | `booking_status_changed` a No-show | `send_email` "¿Reagendamos?" con link de reagendar |
| `thank_you` | `booking_status_changed` a cualquier resultado (Seguimiento tibio o frío, Venta, No califica) + espera de 2 h (nodo Delay existente) | `send_email` de agradecimiento |

Los textos de las plantillas viven en `lib/scheduling/automation/templates.ts` (en español, voseo) y se pueden editar como cualquier flow.

Duplicar un evento duplica sus flows precreados (apagados). Borrar un evento desactiva sus flows y conserva el vínculo para el historial.

**Criterios:**
- CUANDO se crea un evento con la opción activa, DEBEN existir 7 flows con `event_type_id` = ese evento, todos inactivos, y sus triggers filtrados a ese evento.
- CUANDO la opción del workspace está apagada, NO DEBE crearse ninguno.
- CUANDO se enciende `reminder_24h` y hay agendas futuras del evento a más de 24 h, DEBEN crearse sus jobs (F44).
- Test: `lib/scheduling/automation/templates.test.ts` pasa.

#### F57: Editor de flujo del evento (flujos de email o mensaje)
**Descripción:** pantalla `/dashboard/agenda/configuracion/eventos/[id]/flujos/[flowId]`. Es una **vista lineal** de un flow normal del flow builder, pensada para los flujos típicos de agenda (confirmación, recordatorios, avisos). Se guarda en las mismas tablas (`flows`, triggers y nodos); no es un motor aparte.
- **Barra:** "‹ [Título del evento]", "Abrir en el canvas" (abre este flow en el flow builder), switch Encendido/Apagado (F49) y "Guardar".
- **Encabezado:** nombre del flujo editable + chip del alcance.
- **Paso 1, CUÁNDO** (trigger), en botones:
  - Se crea la agenda → `booking_created`.
  - Antes de la agenda → `booking_before_start` (número + minutos, horas o días; "antes del inicio").
  - Después de la agenda → `booking_after_end` ("después del fin").
  - Después de agendar → `booking_after_created`.
  - Se reagenda → `booking_rescheduled`.
  - Se cancela → `booking_cancelled`, con pastillas "por quién": cualquiera, el invitado, el equipo, el sistema (agente o flujo).
  - Cambia el estado → `booking_status_changed`, con pastillas de los estados destino (no-show, resultados y cancelaciones).
  - Pasa la hora de la agenda → `booking_ended`.
  - Para los relativos, un texto fijo explica: "Si alguien agenda cuando ese momento ya pasó, este flujo no se envía. Si reagendan, se recalcula solo" (F44).
  - **Aplica a:** Solo este evento · Todos los eventos del área (incluye los que se creen después) · Todos los eventos. Se guarda en `triggers.config` (`event_type_ids` o `category_ids` o vacío).
- **Paso 2, SI** (opcional): sin condición, "Siempre". "+ Agregar condición" ofrece: estado de la agenda, categoría, tiene agenda próxima, cantidad de no-shows (F45), etiquetas y campos del contacto. Los flujos "Antes de la agenda" nacen con "Estado de la agenda es Agendada, Confirmada o Reagenda".
- **Paso 3, ENTONCES:** conmutador Email | WhatsApp.
  - **Email** (`send_email`, F46): Para (El contacto · El anfitrión · Un email fijo), Asunto, Mensaje, chips "Insertar variable" (F47) y la línea del remitente y la cuota diaria ("46 de 100 emails hoy").
  - **WhatsApp:** canal conectado (si no hay, aviso "Este paso se va a saltear hasta que lo conectes") y mensaje con variables. Solo si el contacto tiene teléfono.
- **"+ Agregar paso":** Esperar, Enviar WhatsApp, Enviar email, Cambiar estado de la agenda, Agregar etiqueta, Notificar al equipo. Se agregan en fila, uno debajo del otro.
- **Panel derecho:** **Vista previa** del mensaje con una agenda de ejemplo del evento (variables resueltas; el email se ve con Para y Asunto; WhatsApp, como burbuja) + "Enviarme una prueba" (al email de quien edita). **Resumen** en una frase ("Cuando falten 24 horas para la agenda, si sigue activa, envía un email al contacto. Aplica a: solo este evento") con el estado y, para los relativos, "Hoy alcanzaría a N agendas próximas".
- **Flujos con ramas:** si el flow tiene nodos que la vista lineal no representa (ramas, esperas condicionales, nodos de IA), el editor lo muestra en solo lectura con "Este flujo tiene ramas: editalo en el canvas".
- En móvil, el panel derecho pasa abajo.

**Criterios:**
- `flowToLinear(flow)` y `linearToFlow(linear)` DEBEN ser inversas para cualquier flujo lineal (test de ida y vuelta con las 7 plantillas de F49).
- CUANDO el flow tiene una rama, `flowToLinear` DEBE devolver `null` y la pantalla DEBE quedar en solo lectura.
- CUANDO se elige "Todos los eventos del área" con el área Ventas, el trigger DEBE guardar `category_ids = [Ventas]` y `event_type_ids = []`.
- CUANDO se elige "Antes de la agenda" con 2 horas, el trigger DEBE guardar `offset_minutes = 120`.
- CUANDO se pide "Enviarme una prueba", DEBE enviarse solo al email de quien edita, con la agenda de ejemplo, sin registrar un envío al contacto.
- "Hoy alcanzaría a N" DEBE usar el mismo filtro que la creación de jobs de F44.
- Test: `lib/scheduling/automation/linear-flow.test.ts` pasa.

**Bloque 7 listo cuando:** F43 a F49 y F57 cumplen sus criterios; `npx vitest run` sale 0 (incluidos los tests existentes del flow engine y del procesador de jobs); `npm run build` compila; `verify-scheduling.mjs` sale 0; las pantallas se revisaron o quedó anotado.

---

### Bloque 8: Habilidad de agendamiento para agentes

> **Principio:** el agente nunca lee Google Calendar ni eventos privados. Pide horarios al sistema, que usa **el mismo motor y los mismos datos que la página pública** (F23, F24) con los tokens del anfitrión, y recibe solo horarios libres. Agendar usa la misma función que el booker (F26), con `origin = 'agent'`.

#### F52: Habilidad `scheduling` en el tool registry
**Descripción:** entrada `scheduling` en el tool registry del agente. En la pestaña **Herramientas** de la pantalla de Agentes se muestra como un grupo con switch y un formulario generado desde su schema de configuración, guardado en `agents.tools_config.scheduling`:

```
{
  enabled: boolean,
  mode: 'book' | 'link_only',                  // agenda directamente | solo comparte el link
  allow: { book: true, reschedule: true, cancel: false },
  slots_to_offer: 3,                            // 2 a 5
  search_days: 7,                               // cuántos días hacia adelante busca por defecto (1 a 30)
  on_no_slots: 'share_link' | 'handoff',        // sin horarios o con Google caído
  events: [{ event_type_id, when_to_use: string (10 a 500), prerequisites?: string (hasta 300) }]
}
```

El selector de eventos lista los eventos activos u ocultos de cualquier anfitrión, con su categoría (área · tipo). Un evento inactivo o borrado queda marcado "no disponible" en la lista y el agente no lo recibe.

**Criterios:**
- CUANDO se guarda con `enabled = true` y `events` vacío, DEBE rechazarse con "Elegí al menos un evento".
- CUANDO un evento de la lista pasa a inactivo, `effectiveSchedulingConfig(config, eventTypes)` DEBE excluirlo.
- CUANDO una persona sin `agents.edit` intenta guardar, DEBE responder "sin permiso".
- La configuración se valida con Zod en el servidor (misma función en cliente y servidor).
- Test: `lib/agents/tools/scheduling/config.test.ts` pasa; los tests existentes del tool registry siguen en verde.

#### F53: Instrucciones para el modelo
**Descripción:** cuando la habilidad está encendida, `buildSchedulingInstructions(config, eventTypes, contact, now)` agrega al contexto del turno un bloque con:
- La lista de eventos permitidos: nombre, categoría, duración, "Cuándo usarlo" y requisitos previos.
- La zona horaria del contacto (o "desconocida").
- La fecha y hora actual en esa zona.
- Las reglas duras: solo esos eventos; solo horarios devueltos por la herramienta; confirmar la zona horaria si es desconocida o inferida; proponer como máximo `slots_to_offer` opciones; **no agendar sin una confirmación explícita del lead de un horario concreto**; pedir los datos obligatorios que falten; no agendar si ya tiene una agenda próxima del mismo evento (ofrecer reagendar); si no hay opción que encaje, aplicar `on_no_slots` o derivar.

El texto de las reglas vive en `lib/agents/tools/scheduling/instructions.ts`, en español.

**Criterios:**
- DADO 2 eventos permitidos, el bloque DEBE incluir los 2 con su "Cuándo usarlo" y su categoría, y ningún otro.
- CUANDO `mode = 'link_only'`, el bloque NO DEBE mencionar agendar directamente y DEBE indicar compartir el link.
- CUANDO el contacto tiene zona horaria guardada, DEBE aparecer y NO DEBE pedirse confirmarla.
- Test: `lib/agents/tools/scheduling/instructions.test.ts` (snapshot del texto) pasa.

#### F54: Herramientas de consulta
**Descripción:**
- **`booking_ref`:** los primeros 8 caracteres de `bookings.id` (uuid). Se resuelve siempre junto con el `contact_id` de la conversación (`id::text LIKE ref || '%' AND contact_id = …`). **Nunca** se le entrega al modelo el `uid` (es el token secreto de cancelar y reagendar del invitado).
- **`scheduling_get_contact_bookings()`**: agendas próximas y las últimas 5 pasadas del contacto de la conversación (evento, categoría, fecha en su zona, estado, `booking_ref` corto). Sin datos de otros contactos.
- **`scheduling_get_slots({event_type_id, from_date?, days?, timezone})`**:
  - Valida que el evento esté permitido.
  - Llama al servicio de horarios de F24 (sin el paso HTTP: misma función de servidor), con el rango por defecto `search_days`.
  - Devuelve como máximo 20 horarios, repartidos en días distintos cuando se puede, como `{ slot_id, label_in_contact_tz, start_utc }`.
  - Si el anfitrión no está disponible o Google falla: `{ unavailable: true, reason, booking_link }`.
- **`scheduling_get_booking_link({event_type_id})`**: link público del evento con precarga de nombre, email y teléfono del contacto y `utm_source=agent`.
- **`scheduling_set_contact_timezone({timezone})`**: guarda la zona IANA confirmada por el lead en `contacts.timezone`.
- **Inferencia de zona:** helper `inferTimezone(contact)` a partir del país o el prefijo del teléfono (tabla chica en código). Devuelve la zona + `confidence: 'inferred'`; nunca se guarda sin la confirmación del lead.

**Criterios:**
- CUANDO se piden horarios de un evento no permitido, DEBE devolver error `event_not_allowed` sin consultar Google.
- CUANDO Google falla con error temporal, DEBE devolver `unavailable: true` con el link, nunca horarios.
- Los horarios devueltos DEBEN coincidir exactamente con los que el booker público muestra para el mismo evento, rango y zona (test que compara las dos salidas con los mismos datos simulados).
- CUANDO el teléfono es `+52…` y no hay país ni zona, `inferTimezone` DEBE devolver `America/Mexico_City` con `confidence: 'inferred'`.
- `scheduling_get_contact_bookings` NO DEBE devolver agendas de otro contacto aunque se le pase un id.
- Test: `lib/agents/tools/scheduling/read-tools.test.ts` pasa.

#### F55: Herramientas de acción
**Descripción:** solo se ofrecen al modelo si `mode = 'book'`, la acción está permitida en `allow` y **el canal de la conversación no está en modo borrador**.
- **`scheduling_book({event_type_id, start_utc, answers?, email?, phone?, lead_confirmed: true})`**:
  - Verifica que el evento esté permitido, `lead_confirmed === true` y que no exista una agenda próxima en estado activo del mismo evento para el contacto.
  - Valida las respuestas con `buildBookingSchema` (F20), usando los datos del contacto como base (nombre, email, teléfono). Si falta un campo obligatorio, devuelve `{ missing_fields: [...] }` sin agendar.
  - Llama a `create.ts` (F26) con `contact_id` de la conversación (sin deduplicación), `origin = 'agent'`, `created_by = null` y `metadata.agent_id` + `agent_run_id`.
  - Si el horario se ocupó: `{ slot_taken: true }`, para que el agente proponga otros.
  - Devuelve `{ booking_ref, label_in_contact_tz, meet_pending: true|false, meet_url? }`.
  - Si el email llega en `email` y el contacto no tenía, se guarda en el contacto (mismo criterio: solo campos vacíos).
- **`scheduling_reschedule({booking_ref, start_utc, lead_confirmed: true})`**: solo agendas en estado activo y futuras del contacto de la conversación. Usa `reschedule.ts` (F28).
- **`scheduling_cancel({booking_ref, reason, lead_confirmed: true})`**: ídem con `cancel.ts`, estado `cancelled_other`, `cancelled_by_type = 'system'` y `cancellation_reason` prefijado "Cancelada por el agente: ".
- **Auditoría:** cada acción queda como paso del run (`agent_run_steps`) y como efecto en `audit_log` (`performed_by_agent_id` y `metadata.actor_type = 'system'`). La agenda muestra "Creada por: [nombre del agente]" en el detalle (F36).

**Criterios:**
- CUANDO el canal de la conversación está en modo borrador, las herramientas de acción NO DEBEN estar en la lista de herramientas del turno (test sobre `toolsForTurn(agent, conversation)`).
- CUANDO `lead_confirmed` no es `true`, DEBE rechazar sin agendar.
- CUANDO falta el email y el evento lo exige, DEBE devolver `missing_fields: ['email']` sin crear nada.
- CUANDO el contacto ya tiene una agenda próxima del mismo evento, `scheduling_book` DEBE devolver `already_booked` con su `booking_ref`.
- CUANDO se intenta reagendar o cancelar una agenda de otro contacto, DEBE devolver `not_found`.
- CUANDO se agenda con éxito, la agenda DEBE tener `origin = 'agent'`, la categoría copiada del evento y existir el paso en `agent_run_steps` y la fila en `audit_log`.
- Test: `lib/agents/tools/scheduling/action-tools.test.ts` pasa.

#### F56: Comportamiento de punta a punta (con modelo simulado)
**Descripción:** tests de integración del turno del agente con el modelo simulado (respuestas guionadas del proveedor, como en los tests existentes del runner) que recorren los casos del flujo 3.7 del alcance.

**Criterios:**
- DADO un contacto sin zona horaria con teléfono +52, CUANDO el guion del modelo llama `scheduling_get_slots` sin haber confirmado la zona, ENTONCES el runner igual permite la llamada, pero las instrucciones (F53) DEBEN contener la regla de confirmar. *(La regla de comportamiento se verifica en vivo, §18.)*
- DADO el guion "consultar → proponer → confirmar → agendar", la agenda DEBE crearse una sola vez, aunque el guion repita la llamada de agendar (idempotencia por `agent_run_id` + `start_utc` + evento).
- DADO que el horario se ocupó entre la consulta y el agendado, la herramienta DEBE devolver `slot_taken` y el turno NO DEBE fallar.
- DADO un turno con la habilidad apagada, NO DEBE aparecer ninguna herramienta `scheduling_*`.
- Test: `lib/agents/tools/scheduling/e2e.test.ts` pasa; los tests existentes del runner del agente siguen en verde.

**Bloque 8 listo cuando:** F52 a F56 cumplen sus criterios; `npx vitest run` sale 0 (incluidos los tests existentes del agente y del tool registry); `npm run build` compila; la pestaña Herramientas se revisó en escritorio y 390 px o quedó anotado.

**Fase 2 lista cuando:** los Bloques 5 a 8 están listos.

---

### Definición de "listo" de toda la Etapa 4

- `docs/PROGRESS.md` tiene los 8 bloques y F1 a F58 marcados (sin F30 ni F31). Las nice-to-have F15 y F42 pueden quedar anotadas en `docs/PENDIENTE.md`.
- Salen 0: `npx vitest run`, `npm run build`, `npm run lint` (sin errores nuevos), `node scripts/verify-rls.mjs`, `node scripts/verify-scheduling.mjs`, `node scripts/verify-booking-concurrency.mjs` y los `verify-*.mjs` de la Etapa 2.
- Ningún test que pasaba en el punto de partida se rompió.
- Están creados o actualizados: `THIRD_PARTY_NOTICES.md`, `docs/agendamiento.md` (nuevo: modelo, motor, zonas horarias, cómo agregar un trigger), `docs/flow-registry.md`, `.env.example`, `CLAUDE.md` y la bitácora.
- `docs/referencia/` fue borrada.

---

## 8. Flujos principales (resumen técnico)

1. **Configurar:**
   - Ajustes / perfil (F3) → conectar Google (F4) → calendarios y switches (F5).
   - Horarios, excepciones y tiempo fuera (F10 a F13).
   - Evento (F17 a F22) + flujos precreados apagados (F49).
2. **Reservar:**
   - Booker (F25) → horarios (F24 → F23).
   - Confirmar (F26): validación en el servidor → lock + transacción (contacto, asignación, agenda, historial, evento de automatización, job de Google) → job `booking_google_sync` → Google crea el evento con Meet e invita.
   - Confirmación (F27).
   - Triggers inmediatos y relativos (F43 y F44).
3. **Cambios del invitado:** cancelar o reagendar (F28) → Google se actualiza → jobs relativos anulados o reprogramados → eventos de automatización → notificación al anfitrión.
4. **Después:** job `booking_ended` → la tarjeta muestra "Sin resultado" → el anfitrión la mueve en el kanban (F34) a No-show o a un resultado → `booking_status_changed` → flujos.

---

## 9. Modelo de datos

### 9.0 Resumen: 8 tablas nuevas

`scheduling_profiles`, `calendars`, `availability_schedules`, `out_of_office`, `booking_categories`, `event_types`, `bookings` y `rate_limits`. La v1.4 sacó 6 tablas del plano anterior (decisión de Wendy, 26/9):

| Antes | Ahora | Por qué |
|---|---|---|
| `availability_rules` | `availability_schedules.weekly_hours jsonb` | Pocas filas, siempre se leen con su horario |
| `availability_overrides` | `availability_schedules.date_overrides jsonb` | Ídem |
| `event_type_hosts` | No se crea (anfitrión = `owner_user_id`) | Hoy sería siempre una fila igual al dueño. La Fase 3 la crea con backfill |
| `event_type_conflict_calendars` | `event_types.conflict_calendar_ids uuid[]` | Es una lista de ids |
| `booking_calendar_refs` | Columnas de Google en `bookings` | Una referencia por agenda |
| `booking_history` | `audit_log` con `entity_type = 'booking'` | Ya existe y su política de lectura distingue por entidad; es lo que hizo la Etapa 2 con los posts |

Además, `scheduling_rate_limits` pasa a ser `rate_limits` (genérica) y `bookings.status_group` es una columna calculada.

> Todas las tablas nuevas llevan: `id uuid default gen_random_uuid()`, `workspace_id` con FK y `on delete cascade`, `created_at` y `updated_at` (trigger existente), RLS habilitada. Índices en columnas de filtro y orden.

### 9.1 Perfil y calendarios

| Tabla / cambio | Campos | Notas |
|---|---|---|
| `scheduling_profiles` | `user_id`, `username`, `display_name`, `avatar_url`, `timezone` (IANA), `time_format` (`12h`/`24h`), `welcome_message`, `default_schedule_id` (FK nullable), `default_destination_calendar_id` (FK nullable), `is_active` | Únicos `(workspace_id, user_id)` y `(workspace_id, lower(username))` |
| `oauth_connections` (cambio) | Valor de `provider` `google_calendar`; índice único reemplazado por `(workspace_id, provider, coalesce(user_id, '00000000-…'), external_account_id)` | Aditivo (se crea el índice nuevo y después se borra el viejo en la misma migración; no toca datos) |
| `calendars` | `connection_id` (FK `oauth_connections`), `user_id`, `external_calendar_id`, `name`, `color`, `access_role` (`owner`, `writer`, `reader`, `freeBusyReader`), `is_primary`, `check_conflicts bool default false`, `is_active bool default true`, `push_channel_id`, `push_channel_expires_at`, `sync_token` (reservadas) | Único `(connection_id, external_calendar_id)` |
| `contacts` (cambio) | `timezone text` | Aditivo |
| `rate_limits` | `key` (prefijo del módulo + hash de IP + acción, ej. `scheduling:create:<hash>`), `window_start`, `count` | Genérica, para cualquier endpoint público. Sin `workspace_id`; solo service role; purga a las 24 h. Único `(key, window_start)` |

### 9.2 Disponibilidad

| Tabla | Campos | Notas |
|---|---|---|
| `availability_schedules` | `user_id`, `name`, `timezone`, `is_default`, `weekly_hours jsonb`, `date_overrides jsonb`, `deleted_at` | Único parcial `(user_id) WHERE is_default AND deleted_at IS NULL`. `weekly_hours` = `{ "1": [{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}], "2": [...] }` (clave = día 0=domingo…6; día ausente o vacío = no trabaja; `"24:00"` válido como fin). `date_overrides` = `[{ "date":"2026-10-12", "ranges": [] }, { "date":"2026-10-02", "ranges":[{"start":"09:00","end":"12:00"}] }]` (`ranges` vacío = no disponible todo el día; reemplaza la regla semanal de ese día). Ambos validados con Zod |
| `out_of_office` | `user_id`, `starts_at timestamptz`, `ends_at timestamptz`, `all_day bool`, `reason` (`vacation`, `travel`, `sick`, `other`), `note`, `deleted_at` | CHECK `ends_at > starts_at`. Índice `(user_id, starts_at, ends_at)` |

### 9.3 Eventos

| Tabla | Campos | Notas |
|---|---|---|
| `booking_categories` | `parent_id` (null = área), `name`, `color` (solo áreas), `position`, `is_system`, `archived_at` | Único `(workspace_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'), lower(name)) WHERE archived_at IS NULL` (el `coalesce` evita áreas duplicadas, porque en Postgres dos NULL no chocan). Máximo 2 niveles (trigger). Precarga Ventas (Triaje, Cierre, Seguimiento) y Servicio (Onboarding, Uno a uno) |
| `event_types` | `category_id` (FK `booking_categories`, NOT NULL), `owner_user_id`, `title`, `slug`, `description_md`, `duration_minutes`, `color`, `location_type` (`google_meet`, `manual`), `location_text`, `hide_location_until_booked`, `status` (`active`, `hidden`, `inactive`), `scheduling_type` (`individual`; futuro `round_robin`, `collective`), `schedule_id` (null = por defecto), `destination_calendar_id` (null = perfil), `conflict_calendar_ids uuid[]` (vacío = los del perfil), `before_buffer_minutes`, `after_buffer_minutes`, `minimum_notice_minutes`, `slot_interval_minutes` (null = duración), `max_per_day`, `max_per_week`, `period_type` (`rolling_calendar`, `rolling_business`, `range`, `unlimited`), `period_days`, `period_start_date`, `period_end_date`, `contact_assignment` (`none`, `setter_if_empty`, `vendedor_if_empty`), `success_redirect_url`, `redirect_with_params`, `change_min_notice_minutes`, `booking_fields jsonb`, `unavailable_messages jsonb` (F58; null = textos por defecto), `deleted_at` | Único parcial `(owner_user_id, slug) WHERE deleted_at IS NULL` |
| `flows` (cambio) | `event_type_id uuid null` (FK `on delete set null`), `template_key text null` | Aditivo |
| `workspaces` (cambio) | `scheduling_auto_create_flows bool default true`, `scheduling_public_base_url text null` | Aditivo |

**`booking_fields` (jsonb, validado con Zod):** `[{ id, type: 'name'|'email'|'phone'|'short_text'|'long_text'|'select'|'multiselect', system: bool, label, help, placeholder, visibility: 'required'|'optional'|'hidden', options?: string[], identifier, contactFieldId? }]`.

### 9.4 Agendas

| Tabla | Campos | Notas |
|---|---|---|
| `bookings` | `uid text` (único, 22 caracteres), `event_type_id`, `category_id` (FK, copia del evento), `category_snapshot jsonb` (`{area_id, area_name, type_id, type_name}`), `metadata jsonb` (ej: `agent_id`, `agent_run_id`), `host_user_id`, `contact_id NOT NULL`, `title`, `start_at`, `end_at`, `status` (CHECK con las 11 claves de F32), `status_group` (`active`, `no_show`, `outcome`, `cancelled`; **columna calculada** `GENERATED ALWAYS AS (CASE status … END) STORED`), `status_changed_at`, `status_changed_by`, `booker_name`, `booker_email`, `booker_phone`, `booker_timezone`, `host_timezone`, `location_type`, `location_text`, `meet_url`, `responses jsonb`, `origin` (`public_page`, `embed`, `manual`, `agent`, `api`), `utm jsonb`, `referrer_url`, `created_by` (null si es público), `reschedule_count int default 0`, `cancelled_at`, `cancelled_by_type` (`invitee`, `host`, `system`), `cancelled_by_user_id`, `cancellation_reason`, `internal_notes`, `google_sync_status` (`pending`, `synced`, `failed`, `not_applicable`), `google_sync_error`, `google_connection_id` (FK `oauth_connections`, null), `google_calendar_id` (FK `calendars`, null), `google_event_id`, `ical_uid`, `google_event_deleted_at`, `is_do_not_contact_at_booking bool` | `EXCLUDE USING gist (host_user_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (status IN ('scheduled','confirmed','rescheduled'))` (extensión `btree_gist`). Índices `(workspace_id, start_at)`, `(workspace_id, category_id, start_at)`, `(host_user_id, start_at)`, `(contact_id, start_at)`, `(workspace_id, status, start_at)`. Sin soft delete: las agendas no se borran |
| `audit_log` (se reutiliza, sin columnas nuevas) | Historial de la agenda: `entity_type = 'booking'`, `entity_id` = id de la agenda, `action` (`booking.created`, `booking.rescheduled`, `booking.cancelled`, `booking.updated`, `booking.status_changed`, `booking.sync_ok`, `booking.sync_failed`), `changes` (`from_start_at`/`to_start_at`, `from_status`/`to_status`, campos editados), `metadata` (`actor_type`: `invitee`, `user`, `system`, `flow`; `flow_id`), `performed_by`, `performed_by_agent_id` | La política `audit_log_select` suma una rama: miembro del workspace y `entity_type = 'booking'` y la agenda es visible para él (`EXISTS` sobre `bookings`, que aplica su RLS). Índice `(entity_type, entity_id, performed_at)` si no existe. Los usuarios no pueden editar ni borrar filas (sin cambios) |

**Estados y transiciones:** ver F32 (11 estados en 4 grupos). Solo los estados del grupo `active` ocupan el horario (exclusión). `cancelled` es final.

### 9.5 Migraciones: plan y clasificación

| Migración (nombre orientativo) | Tipo | ¿Se aplica? |
|---|---|---|
| `scheduling_profiles_calendars` (+ cambio de índice en `oauth_connections`, `contacts.timezone`) | Aditiva (el índice viejo se reemplaza sin tocar datos) | Sí, **después** del test de caracterización de la conexión de YouTube |
| `scheduling_permissions` (suma claves a los roles de sistema existentes) | Aditiva con backfill que no quita permisos | Sí |
| `availability` | Aditiva | Sí |
| `booking_categories` (+ precarga por workspace) | Aditiva con backfill | Sí |
| `event_types` (+ `flows` y `workspaces`) | Aditiva | Sí |
| `bookings` (+ `btree_gist`, exclusión, columnas de Google, `rate_limits`, rama nueva en la política de `audit_log`) | Aditiva (la política de `audit_log` solo suma lectura) | Sí, **después** de un test de caracterización de lo que ve hoy cada rol en `audit_log` |

---

## 10. Arquitectura

```
Públicas (sin sesión)                         Internas (sesión + permisos)
/calendario/[u]/[e]  ── booker ─┐             /dashboard/agenda/* (agendas, eventos,
/calendario/agenda/[uid]        │              disponibilidad, calendarios, perfil)
/embed/embed.js (iframe) ───────┤                    │ Server Actions (requirePermission)
                                ▼                    ▼
              /api/public/scheduling/{event,slots,bookings,ics}
                                │
            lib/scheduling ─────┼── slots (puro, portado de Cal.diy)
                                ├── booking/{create,cancel,reschedule}
                                ├── time (dayjs utc/timezone), limits, booking-fields
                                └── automation (triggers, relative, conditions, actions, templates)
                                │
            lib/google-calendar (freebusy, events) ◄── tokens: Vault (oauth_connections)
                                │
   scheduled_jobs: booking_google_sync · booking_relative_trigger · booking_ended
   automation_events ──► /api/cron/automation-events ──► flow engine (registry)
   Supabase: scheduling_profiles, calendars, availability_schedules, out_of_office,
             booking_categories, event_types, bookings, rate_limits (+ audit_log como historial)
```

**Principios:**
- **Todo instante en UTC.** Las reglas se guardan en hora local + zona IANA del horario.
- **El servidor decide.** El cliente nunca determina si un horario es válido.
- **Doble protección contra doble reserva:** advisory lock por anfitrión + restricción de exclusión.
- **Google fuera de la transacción:** el evento se crea en un job con reintentos. La agenda nunca se pierde por una falla de Google.
- **Público con service role y campos filtrados** en el servidor. Sin policies para anon.

---

## 11. Storage

No hay buckets nuevos. La foto del perfil de agenda usa el bucket de avatares existente (Claude Code confirma cuál). Límite de 2 MB, tipos jpg, png y webp.

---

## 12. Stack y decisiones técnicas

| Decisión | Elección | Por qué |
|---|---|---|
| Fechas y zonas horarias en el módulo | **dayjs** + plugins `utc`, `timezone`, `isBetween` (dependencia nueva, solo en `lib/scheduling` y los componentes del módulo) | El código portado de Cal.diy la usa. Evita reescribir la lógica más delicada. El resto del sistema sigue con date-fns |
| Google Calendar | `fetch` directo (o `googleapis` si la Etapa 2 ya lo sumó) | Sin dependencia extra |
| Protección contra doble reserva | Advisory lock + `EXCLUDE USING gist` | Garantía en la base, no solo en la aplicación |
| Creación del evento en Google | Job asíncrono con reintentos | Resiliencia y respuesta rápida al invitado |
| Embed | Portado de Cal.diy, compilado a `public/embed/embed.js` (esbuild ya disponible con Next; si no, script de build simple) | MIT, probado |
| Estado del booker | El de Cal.diy (zustand) si simplifica el portado; si no, estado local de React | Claude Code decide en el plan y lo justifica |
| Textos de fechas públicos | `Intl.DateTimeFormat('es', {timeZone})` | Sin catálogos de idioma extra |

---

## 13. Pantallas detalladas

### 13.0 Convenciones globales
- **Pantallas internas:** barra superior de 56 px con título e ícono ⓘ, como en el resto del sistema. Zona horaria de quien mira siempre visible en Agenda (chip "Hora de Costa Rica (GMT-6)" que lleva al perfil).
- **Estados en toda pantalla nueva:** skeleton, vacío con acción, error con "Reintentar" y toast de éxito.
- **Responsive:** 390 px sin scroll horizontal. Kanban con scroll horizontal por columnas. Calendario en vista agenda en móvil.
- **Textos:** español con voseo, sin jerga.
- **Páginas públicas:** diseño neutro tipo Cal.com (tipografía del sistema, bordes suaves, mucho espacio), tema claro, oscuro o automático, color principal configurable. Sin el menú ni la marca de la app, salvo un pie discreto opcional.

### 13.1 Agenda > Agendas (B5)
- **Sin pestañas.** Barra: conmutador Lista | Kanban | Calendario, filtros Estado, Área y Anfitrión, "+ Agendar" y el engranaje ⚙ (Configuración de agenda) al lado.
- Debajo de la barra: chip de alcance ("Todas las agendas del equipo" o "Solo tus agendas") y la zona de quien mira.
- **Lista:** filtros rápidos en pastillas (Próximas, Sin resultado, Con resultado, Canceladas) + tabla. **Kanban:** una columna por estado (11), contraíbles, las 3 de cancelación contraídas por defecto. **Calendario:** mes, semana y día.
- **Detalle:** panel derecho de 480 px (en móvil, pantalla completa). El chip de estado del encabezado es un menú agrupado (Activas · Después de la llamada · Cancelar) con los estados no permitidos deshabilitados. Si la llamada ya pasó sin resultado, un recuadro "¿Cómo resultó?" con los resultados en botones.
- **Modal "Agendar una llamada"** (F37): 5 pasos con indicador.

### 13.2 Configuración de agenda (⚙)
- Una pantalla con navegación lateral: Eventos · Disponibilidad · Calendarios de Google · Categorías · Ajustes. La barra tiene "‹ Agendas" y el botón principal de la sección.
- **Eventos (B3):** tarjetas agrupadas por área (1, 2 o 3 columnas). Modal "Nuevo evento" (F17).
- **Editor de evento:** tarjeta "Listo para activar" mientras está inactivo + navegación lateral de 7 secciones (Detalles · Disponibilidad y calendarios · Formulario · Límites y buffers · Si no se puede agendar · Flujos · Compartir y embed) + barra con "‹ Eventos", "Vista previa" y "Guardar". Indicador de cambios sin guardar.
  - **Formulario:** lista arrastrable de campos (los del sistema, bloqueados arriba), panel de edición del campo elegido y "Agregar pregunta".
  - **Flujos:** lista con switches, "Editar" y "+ Nuevo flujo" → editor de flujo (F57): tres pasos Cuándo / Si / Entonces unidos por una línea, "+ Agregar paso" y panel derecho con vista previa y resumen.
- **Disponibilidad (B2):** tarjetas de horarios → editor del elegido (conmutador Horario semanal | Excepciones) → tarjeta Tiempo fuera. Modales "Nueva excepción" (calendario multi-día + qué pasa + resumen) y "Agregar tiempo fuera" (fechas, días completos, motivo, nota, aviso de agendas en el período).
  - **Horario:** 7 filas (switch + día + rangos + "+ Rango" · "Copiar a…").
- **Calendarios de Google (B1):** tarjeta por cuenta (email, estado, acciones) con la lista de calendarios y el switch de conflictos. Arriba, el selector de destino por defecto. Vacío: "Conectá tu Google Calendar" (botón grande).
- **Categorías:** áreas con sus tipos.
- **Ajustes:** usuario (va en los links), nombre visible, foto, zona horaria, formato de hora y las opciones del workspace (flujos sugeridos, dominio propio). Sin página pública del usuario.

### 13.3 Públicas (B4, B6)
- **Booker:** 3 columnas en ≥ 1024 px (320 / flexible / 280), 2 columnas en tablet (info arriba) y pasos en móvil.
- **Confirmación y gestión:** tarjeta centrada de 560 px.
- **Modo embed:** sin márgenes externos, fondo transparente en inline, alto automático.
- **Sin agendar posible (F58):** el mensaje del evento ocupa el lugar del calendario y los horarios: ícono suave, título, texto y botón (WhatsApp, email o link), más "Reintentar" cuando corresponde. En el embed, el respaldo aparece en la página del cliente si el calendario no carga.

---

## 14. Guía de UI

- Las pantallas internas siguen el diseño actual del fork (Tailwind 4, `components/ui`).
- Los componentes portados de Cal.diy (`@calcom/ui`) se adaptan a las clases y componentes del fork. **No se importan paquetes `@calcom/*`**: se copia y adapta el código necesario.
- Las páginas públicas replican la estructura y el espaciado del booker de Cal.com, con la paleta neutra del fork y el color del evento como acento.

---

## 15. Seguridad

**Autenticación:** las pantallas internas y las Server Actions exigen sesión y `requirePermission`. Las rutas públicas no piden sesión y exponen solo lo necesario.

**RLS por tabla nueva:**

| Tabla | SELECT | INSERT / UPDATE | DELETE |
|---|---|---|---|
| `scheduling_profiles` | Miembros del workspace (para elegir anfitriones) | La persona dueña; `scheduling.manage_others` | No (se desactiva) |
| `calendars` | La persona dueña; `scheduling.manage_others` | Solo servidor (sync), salvo `check_conflicts`: la persona dueña | Solo servidor |
| `availability_*`, `out_of_office` | Dueña; `scheduling.manage_others` | Dueña; `scheduling.manage_others` | Soft delete, mismos |
| `event_types` | Miembros del workspace | Dueña; `scheduling.manage_others` | Soft delete, mismos |
| `bookings` | `can_see_booking(id)` | Solo servidor (acciones con permiso) | Nadie |
| `audit_log` (filas `booking`) | Igual que la agenda (rama nueva de la política) | Solo servidor | Nadie |
| `rate_limits` | Nadie (sin policies, solo service role) | Solo servidor | Solo servidor |
| `booking_categories` | Miembros del workspace | `scheduling.manage_categories` | Nadie (se archiva) |

**Endpoints públicos:**
- Validación Zod estricta y tope por IP (F29).
- Los `uid` de agenda son aleatorios de 22 caracteres (unos 131 bits), no secuenciales.
- Las respuestas nunca revelan datos internos (ids de calendarios, emails del anfitrión, títulos de eventos de Google).
- El 404 no distingue entre "no existe" e "inactivo con otro dueño".

**Encabezados:**
- `/calendario/*` y `/embed/*`: `Content-Security-Policy: frame-ancestors *` (embebibles).
- Resto de la app: `frame-ancestors 'none'` / `X-Frame-Options: DENY`, como hoy.
- Función pura `securityHeadersFor(path)` con test.

**Datos sensibles:**
- Tokens de Google solo en Vault, nunca en respuestas ni logs.
- IP solo como hash.
- El `audit_log` registra acciones de agenda sin guardar respuestas completas del formulario.
- La descripción del evento de Google incluye solo nombre, email y respuestas (el anfitrión ya tiene acceso a esos datos).

**Redirecciones:** `success_redirect_url` solo `https://`, sin `javascript:`. Los parámetros añadidos se codifican.

**Markdown de la descripción:** se sanitiza al mostrarlo (sin HTML crudo ni scripts).

**Checklist por bloque:**
- [ ] RLS habilitada en tablas nuevas y probada con `verify-scheduling.mjs`
- [ ] `requirePermission` en toda Server Action nueva
- [ ] Validación Zod en servidor (formularios internos y endpoints públicos)
- [ ] Tokens solo en Vault; nada sensible en logs
- [ ] Tope por IP y campo trampa en endpoints públicos
- [ ] Encabezados de iframe solo en rutas públicas
- [ ] Horarios validados siempre en el servidor

---

## 16. Decisiones transversales

- **Auditoría:** `logAudit` en conectar y desconectar calendarios, crear, editar y borrar eventos y horarios, y cada creación, cancelación, reagendamiento y marca de agenda Las filas con `entity_type = 'booking'` son también el historial visible de la agenda (F36).
- **Soft delete:** `availability_schedules`, `out_of_office`, `event_types` (entran al purgado de 30 días existente, salvo los eventos con agendas: se conservan). Las agendas no se borran.
- **Deduplicación de contactos:** siempre `find_or_link_contact` (teléfono, después email). Nunca por nombre.
- **Estados:** F32 y §9.4. "Sin resultado" es calculado, no se guarda.
- **Casos borde:**
  - Doble reserva simultánea: exclusión + lock (F26).
  - El invitado cierra el booker a mitad de camino: no se crea nada.
  - Falla Google: job con reintentos (F26).
  - Conexión revocada: el evento deja de ofrecer horarios (F7, F24).
  - Dos personas editan el mismo evento: gana el último guardado, con aviso si `updated_at` cambió desde que se abrió.
  - Una persona sale del workspace: sus eventos pasan a Inactivo y sus agendas futuras se listan para el Owner en una notificación (reasignar queda para la Fase 3; mientras, se cancelan a mano).
- **Zona horaria e idioma:** ver §4.3 del alcance v5. Español con voseo; fechas públicas con `Intl` en `es`.
- **Motor de automatización vs cron:** los recordatorios son triggers relativos en el flow builder, ejecutados por `scheduled_jobs`. `booking_ended` es un job programado. No se agregan crons nuevos: todo va por la cola existente.
- **Modelo de asignación:** anfitrión = dueño de la agenda. La asignación al contacto es configurable por evento (F22).
- **Precios:** no aplica en esta etapa (sin cobros).

---

## 17. Fuera de alcance de la Etapa 4

- Round robin, collective, managed events, reasignación de anfitrión (Fase 3).
- Confirmación manual del anfitrión y agendas "pendientes".
- Sincronizar cambios hechos en Google Calendar (push) y detectar respuestas de sí/no del invitado.
- Outlook, iCloud, CalDAV, Zoom, Teams.
- Cobros al agendar, eventos recurrentes, cupos, encuestas de fecha, routing forms, lógica condicional en el formulario, invitados adicionales.
- SMS; emails de confirmación propios fuera del flow builder; plantillas HTML visuales.
- Feriados por país; límites de agendas a nivel persona (sumando todos los eventos).
- Reportes y dashboards por categoría (Etapa 5).
- Que el agente lea eventos de Google, agende para terceros o cree eventos, horarios o categorías.
- Exportar agendas a CSV, varias duraciones por evento y máximo de agendas activas por invitado (nice-to-have del alcance que no entran en este plano).
- Página pública del usuario con todos sus eventos (`/calendario/[usuario]`): se quitó en la v1.3. Cada evento se comparte por su link.

---

## 18. Verificación en vivo (después de la construcción, con Wendy)

No forma parte de la definición de listo:
1. En Google Cloud: habilitar la Google Calendar API y agregar los permisos de Calendar a la pantalla de consentimiento.
2. Crear el perfil, conectar la cuenta de Google de trabajo y la personal, y elegir calendarios.
3. Crear "Horario normal" y "Solo tardes", una excepción y un tiempo fuera.
4. Crear un evento con Meet. Agendar desde otra cuenta y desde el celular con otra zona horaria (cambiar la zona del booker a "Madrid"), y verificar la hora en la invitación y en Google.
5. Reagendar y cancelar desde los links de la invitación. Ver Google actualizado y el historial.
6. Embeber los 3 modos en una página de prueba de tu web, en tema oscuro, y agendar desde ahí (revisar los UTM en la agenda).
7. Encender "Recordatorio 1 h antes" con una agenda a 70 minutos y recibir el email.
8. Marcar no-show en el kanban y recibir el email de seguimiento.
9. Crear un rol "Solo su agenda", asignarlo a un usuario de prueba y verificar que no ve agendas ni eventos ajenos.
10. Encender la habilidad Agendamiento en el agente de chat con "Llamada de triaje" y su "Cuándo usarlo". Desde otra cuenta de Instagram, pedir una llamada: verificar que confirme la zona horaria, proponga 3 horarios, pida el email y agende solo después de la confirmación. Revisar la agenda (origen agente, categoría Ventas · Triaje) y el run.
11. Poner el canal en modo borrador y verificar que el agente solo proponga horarios o comparta el link.
12. Crear un área "Comunidad" con un tipo, asignarla a un evento y filtrar agendas y flujos por esa área.
13. Revocar el acceso desde la cuenta de Google y ver el aviso "Reconectá" y la página del evento "no disponible por el momento".

---

## 19. Si algo bloquea

- **Rutas de Cal.diy distintas a las listadas:** buscar el equivalente, portar desde ahí y documentarlo en el plan.
- **Código de Cal.diy demasiado acoplado a Prisma o tRPC:** reescribir la capa de datos manteniendo la lógica pura; si no se puede aislar, implementar desde este documento con los mismos casos de test y anotarlo.
- **`btree_gist` no disponible:** mantener el advisory lock y agregar una verificación de superposición dentro de la transacción con `SELECT … FOR UPDATE`; anotarlo.
- **El flujo OAuth de la Etapa 2 no admite varias cuentas por persona sin cambios mayores:** implementar el adaptador `google_calendar` con su propio callback reutilizando `oauth_states` y Vault; anotarlo.
- **Test de caracterización que revela un comportamiento distinto** (conexión de YouTube, permisos del Member): gana el comportamiento actual; ajustar y anotar.
- **Nunca quedarse en un loop:** después de un intento serio, anotar y seguir.

---

## 20. Chequeo de sincronía con el alcance v5

Divergencias menores con el alcance, a favor de simplificar:
- Tres nice-to-have del alcance (exportar CSV, varias duraciones, máximo de agendas activas por invitado) quedan fuera de este plano (§17).

Precisiones técnicas que el alcance no detallaba:
- La acción **"Enviar email"** del flow builder es genérica (sirve para cualquier flujo).
- **v1.2:** estados de agenda de Wendy (F32), default de asignación por área (F22), sin límites de cambios (se elimina F30), `send_email` al anfitrión (F46).
- **Cambio del índice único de `oauth_connections`** de la Etapa 2, para permitir varias cuentas de Google por persona.
- **`dayjs`** como dependencia nueva, acotada al módulo.
- **v1.4 (mensajes):** cada evento configura qué ve el invitado sin horarios, con el evento no disponible o si la página o el embed no cargan, con botón a WhatsApp, email o link (F58).
- **v1.4 (modelo de datos):** 8 tablas nuevas en lugar de 14 (§9.0): reglas y excepciones como jsonb del horario, calendarios de conflicto como lista en el evento, sin `event_type_hosts` hasta la Fase 3, referencia de Google en la agenda, historial en `audit_log`, `rate_limits` genérica y `status_group` calculada.
- **v1.3 (revisión del prototipo):** Agendas sin pestañas y configuración detrás del engranaje (F8, F33); flujos de nuevo evento con chequeo para activar (F17, F18), agendar a mano (F37), excepción por horario (F12) y tiempo fuera para todos los horarios (F13); editor lineal de flujos de email o mensaje (F57); sin página pública del usuario (se elimina F31). Reflejado en el alcance v5 (decisiones #82 a #89).
- **v1.1:** categorías (F50, F51) y habilidad de agendamiento para agentes (Bloque 8, F52 a F56), ya reflejadas en el alcance v5.

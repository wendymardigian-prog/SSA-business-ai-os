# Progreso — Etapa 4 (Agendamiento), Tanda B

Corrida autónoma en la rama `etapa4-agendamiento`. Plano: [docs/requerimientos-agendamiento.md](requerimientos-agendamiento.md) (v1.4). Alcance: [docs/alcance-v5-agendamiento.md](alcance-v5-agendamiento.md) (v5.1).
Este archivo es la memoria de la corrida: se actualiza por funcionalidad, no solo al cerrar cada bloque. Si el contexto se compacta, se retoma desde acá.

El núcleo (Tanda A, rama `etapa4-nucleo`) ya está mergeado en `main`: [docs/etapa4/nucleo.md](etapa4/nucleo.md) dice qué hay y cómo se usa; [docs/etapa4/PROGRESS-nucleo.md](etapa4/PROGRESS-nucleo.md) qué se hizo; [docs/etapa4/PENDIENTE-nucleo.md](etapa4/PENDIENTE-nucleo.md) lo que dejó para esta tanda (todo eso entra acá).

## Punto de partida (27/9/2026, `main` = `origin/main` = `9c49c8c`)

| Comando | Resultado de hoy |
|---|---|
| `npx vitest run` | 241 archivos, **2886 tests en verde** (incluye los 29 archivos / 237 tests del núcleo) |
| `npm run build` | OK ("Compiled successfully", 52 páginas) |
| `npm run lint` | 0 errores, **44 warnings preexistentes** (directivas `eslint-disable` sin uso) |
| `verify-rls`, `verify-roles`, `verify-content`, `verify-crm`, `verify-inbox-filters`, `verify-dashboards`, `verify-csv-import`, `verify-enrichment`, `verify-message-persistence`, `verify-optout`, `verify-publishing` | **11 de 11 "Todo verde"**, limpieza OK (en serie) |
| `verify-knowledge` | No corrido: llama a Voyage real |
| `verify-webhook` | No corrido: manda payloads a la app desplegada |

"Sin errores nuevos de lint" = seguir en **0 errores**; los 44 warnings son la línea base.

**Base** (`knrxjnmxnmjavivyuwew`): última migración aplicada `00094_copywriter_agent`. **La Etapa 4 empieza en `00095`** (la banda `00121` era para correr en paralelo con la Etapa 2, que ya está mergeada entera). `00072` sigue sin aplicar. `btree_gist` disponible, no instalada.

**Datos al arrancar:** 1 workspace, 1 Owner (sin Members), `oauth_connections` vacía, `automation_events` solo `contact_created`, agentes `chat` y `copywriter` con `tools_config = {}`.

**Referencias:** Cal.diy en `docs/referencia/cal-diy` (MIT, commit `54343aa` del 20/9/2026). Prototipo en `docs/referencia/prototipo/agenda.html` (el artifact "SSA BAIOS Prototipo", más nuevo que la copia local `dashboards-de-chat.html`). Se leen, nunca se importan; se borran al cerrar.

**Diferencias con el plano** encontradas en la exploración (36, gana el código): en el plan de la corrida y, las que dejan deuda, en [PENDIENTE.md](PENDIENTE.md). Las que más pesan: el núcleo ya estaba en `main`; migraciones desde `00095`; el guardado de conexiones OAuth de la Etapa 2 fallaba contra la base real (42P10) y se arregla; hoy no hay encabezados de seguridad (se agregan); no hay bucket de avatares (se crea `avatars`); el menú filtra por rol, no por permiso; los triggers de evento del editor nunca se guardaban; un flow no arrancaba sin conversación; la pantalla de Herramientas borraba claves de `tools_config` que no fueran herramientas.

## Bloques

- [x] **Bloque 0 — Arranque:** rama `etapa4-agendamiento` desde `main` actualizado; merge de `origin/etapa4-nucleo` (ya estaba: "Already up to date"); `npm install`; suite en verde; alcance guardado; Cal.diy y prototipo en `docs/referencia/`; PROGRESS y PENDIENTE de la Etapa 2 movidos a `docs/etapa2/`
  - [x] Tests de caracterización previos: cron de `automation_events` (7), arranque del motor sin canal (3), nodo `sendMessage` y `do_not_contact` (1), registro de jobs (2)

### FASE 1 — Calendarios, disponibilidad y eventos

- [ ] **Bloque 1 — Perfil y calendarios** (migración 00095)
  - [ ] F1 · Tablas de perfil y calendarios (+ `oauth_connections` provider `google_calendar` e índices parciales, `contacts.timezone`, bucket `avatars`)
  - [ ] F2 · Permisos del módulo (`can_see_booking` queda para la 00099, con `bookings`)
  - [ ] F3 · Perfil de agenda (Ajustes)
  - [ ] F4 · Conectar Google Calendar
  - [ ] F5 · Calendarios de cada cuenta
  - [ ] F6 · Cliente de Google Calendar
  - [ ] F7 · Estado de las conexiones
  - [ ] F8 · Menú "Agenda" y zona horaria de la interfaz — **hecho en el núcleo:** `formatInTz`, `rangeForFilter` (`lib/scheduling/time/tz.ts`). Falta: ítem del menú, engranaje, configuración con 5 secciones, `getViewerTimezone`
- [ ] **Bloque 2 — Disponibilidades** (migración 00096)
  - [ ] F9 · Tablas de disponibilidad — **hecho en el núcleo:** esquemas Zod y validación (`availability-schema.ts`). Falta: migración, RLS, acciones
  - [ ] F10 · Lista de horarios — **hecho en el núcleo:** `summarizeSchedule`. Falta: pantalla, marcar por defecto (RPC), duplicar, borrar con reemplazo, casos con base del test
  - [ ] F11 · Editor semanal — **hecho en el núcleo:** validación compartida. Falta: editor portado
  - [ ] F12 · Excepciones por fecha — **hecho en el núcleo:** `upsertOverrides`, `trimPastOverrides`, `upcomingOverrides`. Falta: modal multi-día, guardado, recorte a `audit_log`
  - [ ] F13 · Tiempo fuera — **hecho en el núcleo:** `outOfOfficeToUtc`. Falta: tabla, modal, `conflictingBookings`
  - [ ] F14 · Eventos que usan este horario
  - [ ] F15 · Vista previa del horario (nice-to-have) — el núcleo deja `freeWindows`
- [ ] **Bloque 3 — Categorías y tipos de evento** (migraciones 00097 y 00098)
  - [ ] F50 · Categorías de agenda
  - [ ] F51 · Categoría en eventos y agendas
  - [ ] F16 · Tablas de eventos
  - [ ] F17 · Lista de eventos — **hecho en el núcleo:** `slugify`, `nextCopySlug`, `suggestSlug`. Falta: pantalla, modal Nuevo evento, duplicar/borrar con base
  - [ ] F18 · Editor, Detalles y ubicación — **hecho en el núcleo:** `validateEventDetails`, `activationChecklist`, `canActivate`, `meetRequiresWritableGoogleCalendar`, `slugChangeNeedsConfirmation`. Falta: editor
  - [ ] F19 · Editor, Disponibilidad y calendarios
  - [ ] F20 · Formulario de reserva — **hecho en el núcleo:** `buildBookingSchema`, `validateBookingFields`, `phone-countries`. Falta: constructor portado
  - [ ] F21 · Límites y buffers — **hecho en el núcleo:** `lib/scheduling/limits/*`. Falta: sección del editor
  - [ ] F22 · Asignación del contacto
- [ ] **Bloque 4a — Motor en vivo, API pública y creación** (migración 00099)
  - [ ] F23 · Motor de horarios libres — **hecho en el núcleo** completo (`lib/scheduling/slots/*`). Falta: armar `SlotsInput` desde la base y Google
  - [ ] F24 · API pública de horarios
  - [ ] F26 · Crear la agenda (RPC `create_booking`, exclusión, job `booking_google_sync`)
  - [ ] F29 · Antispam y atribución
- [ ] **Bloque 4b — Booker, confirmación, cambios del invitado y mensajes**
  - [ ] F25 · Booker — **hecho en el núcleo:** `buildMonthView`, `formatSlotLabel`, `parseEmbedParams`. Falta: página y componentes portados
  - [ ] F27 · Página de confirmación — **hecho en el núcleo:** `buildIcs`, links de Google y Outlook. Falta: página, endpoint `.ics`
  - [ ] F28 · Cancelar y reagendar por el invitado
  - [ ] F58 · Mensajes cuando no se puede agendar — **hecho en el núcleo:** `resolveUnavailableMessage`, `buildCtaHref`, `fallbackPayload`, respaldo del embed. Falta: sección del editor, estados del booker
- [ ] **Fase 1 lista:** suite completa en 0

### FASE 2 — Reservas, embed, automatizaciones y agentes

- [ ] **Bloque 5 — Pantalla de agendas** (sin migración)
  - [ ] F32 · Estados y lógica común — **hecho en el núcleo:** catálogo, `canTransition`, `needsOutcome`, `groupForKanban`, `allowedDrops`. Falta: `filterBookings`, test CHECK vs `BOOKING_STATUS_KEYS`
  - [ ] F33 · Vista lista
  - [ ] F34 · Vista kanban — **hecho en el núcleo:** reglas de arrastre (`kanban.ts`). Falta: componente
  - [ ] F35 · Vista calendario — **hecho en el núcleo:** `placeInCalendar`. Falta: componente
  - [ ] F36 · Detalle y acciones del anfitrión
  - [ ] F37 · Agendar manualmente
  - [ ] F38 · Agendas en la ficha del contacto y notificaciones
- [ ] **Bloque 6 — Embed** (sin migración)
  - [ ] F39 · Script de embed — **hecho en el núcleo:** runtime (`embed-source.ts`, `entry.ts`), `buildEmbedIframeUrl`. Falta: compilar a `public/embed/embed.js` en el build, lado iframe
  - [ ] F40 · Generador de código — **hecho en el núcleo:** `generateEmbedCode`. Falta: modal y sección con vista previa
  - [ ] F41 · Eventos hacia la página — **hecho en el núcleo:** `serializeEmbedEvent`, `embedMessage`, `isTrustedOrigin`. Falta: emitirlos desde el booker
  - [ ] F42 · Dominio propio (nice-to-have)
- [ ] **Bloque 7a — Motor de automatizaciones de agenda** (migración 00100)
  - [ ] F43 · Eventos de agenda y triggers inmediatos
  - [ ] F44 · Triggers relativos al tiempo
  - [ ] F45 · Condiciones de agenda
  - [ ] F46 · Acciones: `send_email` y acciones de agenda
  - [ ] F47 · Variables de agenda — **hecho en el núcleo:** `bookingVariables`, `schedulingLinkVariables`. Falta: meterlas en el contexto del flow y en el selector
- [ ] **Bloque 7b — Flujos por evento, plantillas y editor lineal**
  - [ ] F48 · Sección "Flujos" en el evento
  - [ ] F49 · Flujos precreados
  - [ ] F57 · Editor de flujo del evento
- [ ] **Bloque 8 — Habilidad de agendamiento para agentes** (sin migración)
  - [ ] F52 · Habilidad `scheduling` en el tool registry
  - [ ] F53 · Instrucciones para el modelo
  - [ ] F54 · Herramientas de consulta
  - [ ] F55 · Herramientas de acción
  - [ ] F56 · Comportamiento de punta a punta
- [ ] **Fase 2 lista y cierre de la etapa:** suite completa en 0, docs, PR

## Migraciones creadas

| # | Qué crea | Aplicada |
|---|---|---|
| 00095 | (B1) perfiles, calendarios, `oauth_connections`, `contacts.timezone`, bucket `avatars` | — |
| 00096 | (B2) `availability_schedules`, `out_of_office` | — |
| 00097 | (B3) `booking_categories` + precarga | — |
| 00098 | (B3) `event_types`, `flows.*`, `workspaces.*` | — |
| 00099 | (B4a) `btree_gist`, `bookings`, `rate_limits`, `can_see_booking`, `audit_log`, `scheduled_jobs`, RPC `create_booking` | — |
| 00100 | (B7a) `triggers_type_check` + 9 tipos, `flow_sessions.channel_id` nullable | — |

Ninguna borra ni modifica datos existentes. `list_migrations` inmediatamente antes de aplicar cada una; `node scripts/build-all-migrations.mjs` después.

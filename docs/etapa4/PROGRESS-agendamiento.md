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

**Base** (`<project-ref>`): última migración aplicada `00101_bg_task_dedupe`. **No queda ninguna sin aplicar** (la `00072` se aplicó el 28/9/2026). **La Etapa 4 empieza en `00095`** (la banda `00121` era para correr en paralelo con la Etapa 2, que ya está mergeada entera). `btree_gist` disponible, no instalada.

**Datos al arrancar:** 1 workspace, 1 Owner (sin Members), `oauth_connections` vacía, `automation_events` solo `contact_created`, agentes `chat` y `copywriter` con `tools_config = {}`.

**Referencias:** Cal.diy en `docs/referencia/cal-diy` (MIT, commit `54343aa` del 20/9/2026). Prototipo en `docs/referencia/prototipo/agenda.html` (el artifact "SSA BAIOS Prototipo", más nuevo que la copia local `dashboards-de-chat.html`). Se leen, nunca se importan; se borran al cerrar.

**Diferencias con el plano** encontradas en la exploración (36, gana el código): en el plan de la corrida y, las que dejan deuda, en [PENDIENTE.md](PENDIENTE.md). Las que más pesan: el núcleo ya estaba en `main`; migraciones desde `00095`; el guardado de conexiones OAuth de la Etapa 2 fallaba contra la base real (42P10) y se arregla; hoy no hay encabezados de seguridad (se agregan); no hay bucket de avatares (se crea `avatars`); el menú filtra por rol, no por permiso; los triggers de evento del editor nunca se guardaban; un flow no arrancaba sin conversación; la pantalla de Herramientas borraba claves de `tools_config` que no fueran herramientas.

## Bloques

- [x] **Bloque 0 — Arranque:** rama `etapa4-agendamiento` desde `main` actualizado; merge de `origin/etapa4-nucleo` (ya estaba: "Already up to date"); `npm install`; suite en verde; alcance guardado; Cal.diy y prototipo en `docs/referencia/`; PROGRESS y PENDIENTE de la Etapa 2 movidos a `docs/etapa2/`
  - [x] Tests de caracterización previos: cron de `automation_events` (7), arranque del motor sin canal (3), nodo `sendMessage` y `do_not_contact` (1), registro de jobs (2)

### FASE 1 — Calendarios, disponibilidad y eventos

- [x] **Bloque 1 — Perfil y calendarios** (migración **00095 aplicada** el 27/9/2026)
  - [x] F1 · Tablas de perfil y calendarios: `scheduling_profiles`, `calendars`, `scheduling_can_manage`, `oauth_connections` con provider `google_calendar`, dos índices parciales (workspace / persona+cuenta) y lectura propia, `contacts.timezone`, bucket `avatars`; tipos a mano en `database.ts`; `verify-scheduling.mjs` (30 chequeos) y `verify-rls` (+8) en verde
  - [x] F2 · Permisos: módulo `scheduling` con las 6 claves, alcance `bookings` en `SCOPED_MODULES`/`parsePermissions`/pantalla de roles; el Member de sistema suma `scheduling.use`, `bookings.view` y `bookings.manage` con `own`. **`can_see_booking` va en la 00099** (necesita `bookings`, B4a)
  - [x] F3 · Perfil de agenda (Ajustes): usuario con reservadas y sugerencia, confirmación al romper links (`lib/scheduling/profile.ts`), foto al bucket `avatars`, selector de persona con `manage_others`. **El "Horario normal" inicial se crea en B2** (la tabla llega en la 00096)
  - [x] F4 · Conectar Google Calendar: adaptador `google_calendar` (por persona, `openid email` + userinfo, `login_hint`), guard por adaptador en start/callback (Member 403 en google/linkedin/threads), `saveConnection` sin `upsert` (buscar → actualizar o insertar), tokens en Vault con el id de la conexión; 4 casos de F4 + 4 del guard
  - [x] F5 · Calendarios: `planCalendarSync` puro (sistema fuera, primario revisa conflictos, inactivos), `syncCalendars`, pantalla con tarjeta por cuenta, switch de conflictos, destino por defecto (solo owner/writer), Reconectar / Actualizar / Desconectar con aviso
  - [x] F6 · Cliente `lib/google-calendar/{errors,auth,client}.ts`: freebusy en tramos de 90 días, Meet con `conferenceDataVersion=1` + `sendUpdates=all`, `deleteEvent` 404/410 = ok, `getAccessToken` con caché a 1 min, `invalid_grant` → `revoked` + aviso a la persona; clasificación según la documentación (403 de cuota = temporal). 20 tests
  - [x] F7 · Estado de las conexiones: `calendarConnectionStatus`, `isUserBookable` (`calendar_disconnected` solo si un calendario de la cuenta caída está en uso), aviso fijo "Reconectá tu Google Calendar" en Agenda; el cron semanal de tokens excluye `google_calendar`
  - [x] F8 · Menú "Agenda" (después de Contacts, visible con `scheduling.use` o `bookings.view`; el sidebar filtra por permiso), engranaje ⚙ con `canOpenConfig`, Configuración con 5 secciones y "‹ Agendas" (`ConfigShell`), `getViewerTimezone`; encabezados de seguridad (`lib/security-headers.ts` + `next.config`). **Hecho en el núcleo:** `formatInTz`, `rangeForFilter`
  - Verificación: vitest 254 archivos / 2974 tests, tsc 0, lint 0 errores / 44 warnings, build OK, `verify-scheduling` y `verify-rls` en verde. Pantallas: el navegador integrado tiene sesión, así que Agenda, Ajustes y Calendarios de Google se recorrieron a 1440 y 390 px en claro y oscuro (sin scroll horizontal; los botones de la barra se acortan en el celular); los encabezados se comprobaron con curl contra el dev server
- [x] **Bloque 2 — Disponibilidades** (migración **00096 aplicada** el 27/9/2026)
  - [x] F9 · Tablas `availability_schedules` (jsonb validado con Zod en cada Server Action) y `out_of_office`, único parcial de `is_default`, RLS dueña/`manage_others` sin DELETE, FK del perfil, purga a 30 días; RPC `set_default_schedule` (una transacción) y `ensure_default_schedule` ("Horario normal" al crear el perfil + backfill; test que compara el jsonb con `defaultWeeklyHours()`). **Hecho en el núcleo:** esquemas y validación
  - [x] F10 · Tarjetas con resumen, zona, badge y "Lo usan"; `?horario=` en la URL; Nuevo horario, Marcar por defecto, Duplicar (`copyName`), Borrar con reemplazo obligatorio (`decideDeleteSchedule`); selector de persona con `manage_others`. **Hecho en el núcleo:** `summarizeSchedule`
  - [x] F11 · Editor semanal portado de Cal.diy sin react-hook-form (switch por día, rangos cada 15 min, "+ Rango", "Copiar a…"), guardado explícito con aviso de cambios sin guardar; validación compartida marca el día con error
  - [x] F12 · Modal "Nueva excepción" (calendario multi-día, no disponible / horario distinto, resumen en vivo), una entrada por día en una sola actualización (`upsertOverrides`), recorte a 90 días con lo recortado en `audit_log`; las pasadas se ocultan. **Hecho en el núcleo:** `upsertOverrides`, `trimPastOverrides`, `upcomingOverrides`
  - [x] F13 · Tarjeta Tiempo fuera y modal (fechas, días completos o con hora, motivo en chips, nota), aviso de agendas en el período (`conflictingBookings`, vacío hasta B4a), CHECK `ends_at > starts_at`. **Hecho en el núcleo:** `outOfOfficeToUtc`
  - [x] F14 · "Eventos con este horario" (`eventsForSchedule`, `decideToggleEventSchedule` con el tooltip del caso "ya usa el por defecto"); se llena cuando exista `event_types` (B3)
  - [ ] F15 · Vista previa del horario (nice-to-have): no entró; el núcleo deja `freeWindows`
  - Verificación: vitest 256 archivos / 2982 tests, tsc 0, lint 0 errores, build OK, `verify-scheduling` (+21 chequeos: un solo por defecto, RPC en una transacción, RLS entre personas y workspaces, CHECKs de tiempo fuera, purga) en verde. Pantallas recorridas con sesión a 1440 y 390 px, claro y oscuro: horario, editor, copiar a otros días, excepción y tiempo fuera (con un horario `zz-test` creado y borrado por SQL)
- [x] **Bloque 3 — Categorías y tipos de evento** (migraciones **00097 y 00098 aplicadas** el 27/9/2026)
  - [x] F50 · `booking_categories` con dos niveles (trigger que impide el tercero), único por nivel sin distinguir mayúsculas entre las activas, precarga por workspace (trigger + backfill: 2 áreas y 5 tipos) y RLS (leen todos, escriben `scheduling.manage_categories` o admin, DELETE nadie). Pantalla con áreas, tipos, renombrar, reordenar, archivar y restaurar
  - [x] F51 · `event_types.category_id` obligatorio; `resolveCategory`, `categorySnapshot`, `categoryLabel`, `expandCategoryFilter` (filtrar por área incluye sus tipos); selector de área y tipo en el editor y en el modal
  - [x] F16 · `event_types` completa (§9.3), slug único por persona, `flows.event_type_id` y `template_key`, `workspaces.scheduling_auto_create_flows` y `scheduling_public_base_url`, purga que conserva los eventos con agendas
  - [x] F17 · Lista por área con link, copiar, vista previa, switch Activo/Inactivo, duplicar y borrar con confirmación; modal "+ Nuevo evento" que crea inactivo con el horario por defecto, los calendarios del perfil, el formulario base, la asignación por área y los 7 flujos sugeridos apagados
  - [x] F18 · Editor con navegación de 7 secciones, tarjeta "Listo para activar" (los tres obligatorios bloquean; formulario y flujos no), "Vista previa", guardado por sección y confirmación al cambiar el link
  - [x] F19 · Horario del evento, calendario destino (solo owner/writer) y conflictos propios o del perfil (`resolveEventCalendars`, con aviso si los elegidos quedaron inactivos)
  - [x] F20 · Constructor de formulario portado de Cal.diy: los tres del sistema arriba, preguntas propias de 4 tipos con identificador, ayuda, visibilidad y opciones; la regla "email o teléfono obligatorio" la valida el núcleo
  - [x] F21 · Buffers, aviso mínimo, intervalo, topes por día y semana, ventana futura con sus cuatro modos
  - [x] F22 · Asignación del contacto con el default por área (`defaultAssignmentForArea`: Ventas → vendedor si está vacío)
  - [x] F49 (adelantado) · Las 7 plantillas de flujo (`lib/scheduling/automation/templates.ts`) con sus textos en voseo; se crean apagadas con el evento y al duplicarlo
  - Verificación: vitest 260 archivos / 3002 tests, tsc 0, lint 0 errores, build OK, `verify-scheduling` (+23 chequeos de categorías y eventos) en verde. Pantallas recorridas con sesión: Categorías, Eventos, modal "Nuevo evento" (creó el evento con 7 flujos) y el editor en Detalles, Formulario y Límites

- [x] **Bloque 4a — Motor en vivo, API pública y creación** (migración **00099 aplicada** el 27/9/2026)
  - [x] F23 · Motor de horarios libres — hecho en el núcleo; se sumó `buildSlotsInput` (horario efectivo, tiempo fuera, agendas del anfitrión con los buffers de SU evento, conteos del evento y ocupado de Google con caché de 60 s). Si Google falla o la persona no puede recibir agendas, no se ofrece ningún horario
  - [x] F24 · API pública: `/api/public/scheduling/event`, `/slots` (rango máximo 45 días, zona validada) y `getPublicSlots`, la misma función que usará el agente. La respuesta no lleva ids internos, ni el email del calendario, ni los topes
  - [x] F26 · `create_booking`: contacto (dedup teléfono → email), asignación solo si está vacía, agenda, historial, evento de automatización y los dos jobs en UNA transacción, con lock por anfitrión. Doble reserva imposible por la restricción de exclusión: `verify-booking-concurrency` la prueba con 10 llamadas a la vez
  - [x] F26 · Jobs `booking_google_sync` (crear / mover / borrar, reintentos a 1, 5 y 15 minutos agendados por el handler, no por la cola) y `booking_ended`; al agotarse, la agenda queda fallida y la persona recibe un aviso
  - [x] F29 · Antispam: campo trampa, tope por IP con hash y sal (`RATE_LIMIT_SALT`), UTM, referente y origen; el tope no aplica al equipo ni al agente
- [x] **Bloque 4b — Booker, confirmación, cambios del invitado y mensajes**
  - [x] F25 · Booker en `/calendario/<usuario>/<evento>`: tres columnas en escritorio, una apilada en el celular, zona horaria del navegador, formulario con el MISMO esquema que el servidor y campo trampa. `/calendario/<usuario>` sin evento es 404 a propósito
  - [x] F27 · Página de la agenda con lo que quedó, botones de Google, Outlook y `.ics`, y espera de hasta 8 segundos por el link de Meet
  - [x] F28 · Cancelar y reagendar por el invitado, con el código de 22 caracteres como credencial. Reagendar mueve la misma fila (sube `reschedule_count`) y no vuelve a pedir el formulario; cancelar es definitivo
  - [x] F58 · Sección "Si no se puede agendar" en el editor, con vista previa en claro y oscuro que usa la misma función que el booker
- [x] **Fase 1 lista:** suite completa en 0 (ver la tabla de abajo)

### FASE 2 — Reservas, embed, automatizaciones y agentes

- [x] **Bloque 5 — Pantalla de agendas** (sin migración)
  - [x] F32 · Los once estados, con `filterBookings` (incluye el alcance propio) y el test que compara la lista con el CHECK y la columna calculada de la 00099
  - [x] F33 · Lista con pastillas y contadores, filtros de área, anfitrión y búsqueda en la URL, paginada de a 50. En el celular pasa a tarjetas
  - [x] F34 · Kanban con las once columnas, arrastre nativo validado ANTES de pedirlo al servidor, columnas contraíbles (las de cancelación empiezan contraídas)
  - [x] F35 · Calendario de día, semana y mes; las canceladas no se muestran. El rango vive en `lib/scheduling/calendar-range.ts` (puro) porque lo usa también la página
  - [x] F36 · Detalle lateral: cambiar estado con los motivos deshabilitados y explicados, cancelar con motivo, corregir categoría, ubicación y notas internas, reintentar la sincronización, historial en palabras
  - [x] F37 · Agendar a mano en cinco pasos, por la MISMA función que la página pública (contacto, asignación, historial, automatizaciones y jobs)
  - [x] F38 · Sección "Reuniones" en la ficha del contacto y los cuatro avisos al anfitrión (nunca a quien hizo la acción)
- [x] **Bloque 6 — Embed** (sin migración)
  - [x] F39 · `scripts/build-embed.mjs` compila `lib/embed/entry.ts` a `public/embed/embed.js` (IIFE, es2017, 13,6 KB) y corre antes del build. El archivo se commitea: en Railway el build va sin dependencias de desarrollo y esbuild no está
  - [x] F40 · Generador de código en la sección "Compartir y embed": tres modos, tema, color, ocultar detalles, HTML y React, con vista previa en el mismo iframe que verá el visitante
  - [x] F41 · `lib/embed/iframe-side.ts` con el lado de adentro: avisa que cargó, manda la altura con `ResizeObserver` y emite los cinco eventos. Sin origen declarado no manda nada, y un `ssa:ui` de otro origen se ignora
  - [ ] F42 · Dominio propio (nice-to-have, no entró)
- [x] **Bloque 7a — Motor de automatizaciones de agenda** (migración **00100 aplicada** el 27/9/2026)
  - [x] F43 · Los nueve triggers en el registro, con sus filtros (área, evento, anfitrión, origen, quién lo hizo, estado). El cron enruta por el registro: sumar un tipo ya no pide tocarlo
  - [x] F44 · Triggers relativos: `planRelativeJobs` (puro) y `syncRelativeJobs`, que anula los avisos viejos y agenda los nuevos. Reagendar cambia la clave, así el recordatorio se vuelve a mandar para la fecha nueva
  - [x] F45 · Cuatro condiciones de agenda. "Resultado de la última reunión" devuelve vacío mientras nadie lo cargó: decir "Agendada" haría que una comparación con "venta" diga que no sin haber preguntado
  - [x] F46 · Nodo `send_email` (respeta "no contactar" salvo en flujos de agenda, y no manda con la cuota agotada) y los nodos de cancelar y cambiar el estado de la reunión
  - [x] F47 · Las variables `booking.*` entran por `variables` de la sesión, que es lo único que sobrevive a un Delay. El interpolador admite guiones y ahora sí tiene el test de paridad con el simulador que su comentario prometía
  - [x] Arreglo colateral: los triggers que no son de mensaje (`new_contact`, `crm_event`, `inactivity`, `email_received`) ahora SÍ se guardan al publicar. Antes el editor los ofrecía y no se escribía ninguna fila
- [x] **Bloque 7b — Flujos por evento, plantillas y editor lineal**
  - [x] F48 · Sección "Flujos" en el evento: una fila por flujo con lo que hace en palabras y un interruptor. Prender un recordatorio relativo reprograma los avisos de las reuniones que ya están agendadas
  - [x] F49 · Los siete flujos sugeridos se crean con el evento, apagados. El interruptor del workspace está en Ajustes. Un test compara cada nodo de cada plantilla con el registro: una plantilla con el tipo mal escrito se guardaba igual y no hacía nada
  - [x] F57 · Editor lineal "Cuándo / Si / Entonces", con las variables a la vista, "Hoy alcanzaría a N" calculado con la misma función que agenda los avisos, "Enviarme una prueba" (solo a tu email, con datos de ejemplo) y "Abrir en el canvas". Un flujo con ramas queda en solo lectura: guardar desde una vista simplificada borraría la rama que no se ve
- [x] **Bloque 8 — Habilidad de agendamiento para agentes** (sin migración)
  - [x] F52 · Registro de habilidades: un grupo de herramientas que se prenden juntas con una configuración compartida. Con la habilidad apagada, el agente ve exactamente las mismas herramientas que antes (hay un test)
  - [x] F53 · El bloque de instrucciones cambia con la configuración: con permiso de agendar le dice que agende, sin permiso que pase el link. Siempre prohíbe inventar un horario
  - [x] F54 · Tres herramientas de consulta. `scheduling_get_slots` llama a la MISMA función que la página pública: si usara otra, el agente podría ofrecer un horario que el link no muestra
  - [x] F55 · Cuatro de acción, por las mismas funciones que la pantalla del equipo, con `performed_by_agent_id` en el historial. En borrador no se ofrecen: su efecto sale del sistema y no se deshace descartando el borrador
  - [x] F56 · Cinco guiones de punta a punta con la base en memoria: agendar, el horario que se ocupó, cambiar y cancelar, solo pasar el link, y que el código público de la reunión nunca llegue al modelo
  - [x] Arreglo: `normalizeToolsConfig` borraba toda clave que no fuera una herramienta. `tools_config.scheduling` desaparecía al primer guardado y la habilidad se apagaba sola
- [ ] **Fase 2 lista y cierre de la etapa:** suite completa en 0, docs, PR

## Cierre de la Fase 1 (27/9/2026)

| Comando | Resultado |
|---|---|
| `npx vitest run` | 267 archivos, **3088 tests, todo verde** (partimos de 2886) |
| `npm run build` | OK, "Compiled successfully"; las 4 páginas públicas y las 7 rutas de la API quedaron en el listado |
| `npm run lint` | **0 errores**, 44 warnings (la misma línea de partida) |
| `node scripts/verify-scheduling.mjs` | Todo verde (103 chequeos, limpieza OK) |
| `node scripts/verify-booking-concurrency.mjs` | Todo verde: 5 carreras, 10 llamadas a la vez y una sola gana |
| `node scripts/verify-rls.mjs` | Todo verde con la sección nueva de agenda |

Revisión visual de las pantallas públicas a 1440 y 390 px, en claro y en oscuro: booker, formulario, página de la agenda, reagendar y cancelar. El tema forzado con `?theme=` funciona dentro de un navegador con el tema contrario.

## Cierre de la etapa (27/9/2026)

| Comando | Resultado |
|---|---|
| `npx vitest run` | 277 archivos, **3233 tests, todo verde** (partimos de 2886) |
| `npm run build` | OK; el script de embed se compila antes que Next |
| `npm run lint` | **0 errores, 43 warnings** (partimos de 44) |
| `node scripts/verify-scheduling.mjs` | Todo verde |
| `node scripts/verify-booking-concurrency.mjs` | Todo verde |
| `node scripts/verify-rls.mjs` | Todo verde |
| Los otros 10 `verify-*` de la Etapa 2 | Todo verde |

`verify-knowledge` no se corrió (llama a un proveedor de IA real) y
`verify-webhook` tampoco (manda payloads a la app desplegada). Las dos
exclusiones venían de las reglas de la corrida.

## Migraciones creadas

| # | Qué crea | Aplicada |
|---|---|---|
| 00095 | (B1) perfiles, calendarios, `scheduling_can_manage`, `oauth_connections` (provider + índices parciales + policy propia), `contacts.timezone`, bucket `avatars` | ✅ aplicada y verificada (27/9/2026) |
| 00096 | (B2) `availability_schedules`, `out_of_office`, `set_default_schedule`, `ensure_default_schedule` + backfill, purga | ✅ aplicada y verificada (27/9/2026) |
| 00097 | (B3) `booking_categories`, trigger de dos niveles, precarga por workspace + backfill | ✅ aplicada y verificada (27/9/2026) |
| 00098 | (B3) `event_types`, `flows.event_type_id`/`template_key`, `workspaces.scheduling_*`, purga que conserva los eventos con agendas | ✅ aplicada y verificada (27/9/2026) |
| 00099 | (B4a) `btree_gist`, `bookings`, `rate_limits`, `can_see_booking`, `audit_log`, `scheduled_jobs`, RPC `create_booking` | ✅ aplicada y verificada (27/9/2026) |
| 00100 | (B7a) `triggers_type_check` + 9 tipos, `flow_sessions.channel_id` nullable, índice de `trigger_fires` | ✅ aplicada y verificada (27/9/2026) |

Ninguna borra ni modifica datos existentes. `list_migrations` inmediatamente antes de aplicar cada una; `node scripts/build-all-migrations.mjs` después.

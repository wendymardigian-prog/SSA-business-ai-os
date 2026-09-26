# Etapa 4 · Núcleo (Tanda A): qué quedó y cómo lo usa la Tanda B

Rama `etapa4-nucleo`, construida el 26/9/2026 en paralelo con la Etapa 2. Es **solo código puro con tests de Vitest**: sin base, sin pantallas, sin rutas, sin Server Actions. Plano: `docs/requerimientos-agendamiento.md` (v1.4), tabla "Tanda A" de §0.1.

**Estado al cierre:** 237 tests del módulo (29 archivos) dentro de una suite de 1495 en verde; `npx tsc --noEmit` y `npm run lint` en 0 errores (los 44 warnings preexistentes no cambian).

## Cómo arranca la Tanda B

1. Mergear `etapa4-nucleo` en `etapa4-agendamiento`. Si choca `package.json` o el lockfile, resolver con `npm install` (la única dependencia nueva es `dayjs` 1.11.23).
2. Marcar en `docs/PROGRESS.md` las partes de la tabla Tanda A como "hechas en el núcleo" y verificar que `npx vitest run lib/scheduling lib/embed` siga en verde.
3. **Migraciones desde `00121`** (la Etapa 2 usa `00081+`): verificar con `list_migrations` justo antes de aplicar. **No correr `scripts/verify-*` en simultáneo** con la sesión de la Etapa 2 (se pisan los datos `zz-test-`).
4. Si algo del núcleo no encaja con el código real (por ejemplo, un tipo de la Etapa 2), se corrige en su archivo **y en su test**. No se reescribe.
5. El código de referencia de Cal.diy está fuera del repo, en `~/Documents/SSA-referencia-etapa4/cal-diy` (MIT, commit `54343aa` del 20/9/2026). Cada archivo adaptado lo dice en su encabezado; `THIRD_PARTY_NOTICES.md` tiene la licencia completa. Se borra al final de la etapa.

## Mapa F → archivo

| F | Archivos | Tests |
|---|---|---|
| F8 | `lib/scheduling/time/{dayjs,tz}.ts` | `time/tz.test.ts` |
| F9, F11, F12 | `lib/scheduling/availability-schema.ts` | `rules-validation.test.ts`, `overrides.test.ts` |
| F10 | `lib/scheduling/schedules.ts` | `schedules.test.ts` |
| F13 | `lib/scheduling/out-of-office.ts` | `out-of-office.test.ts` |
| F17, F18 | `lib/scheduling/{slug,event-validation}.ts` | `event-types.test.ts`, `event-validation.test.ts` |
| F20 | `lib/scheduling/{booking-fields,phone-countries}.ts` | `booking-fields.test.ts` |
| F21 | `lib/scheduling/limits/{buffers,period,counts,validation}.ts` | `limits/*.test.ts` |
| F23 | `lib/scheduling/slots/{date-ranges,busy,slots,index}.ts` | `slots/{slots,split,date-ranges}.test.ts` |
| F25 | `lib/scheduling/booker/{month-view,format,embed-params}.ts` | `booker/*.test.ts` |
| F27 | `lib/scheduling/ics.ts` | `ics.test.ts` |
| F32, F34, F35 | `lib/scheduling/{booking-status,bookings-view,kanban,calendar-view}.ts` | sus `*.test.ts` |
| F39, F40, F41 | `lib/embed/{url,snippet,code,events,embed-source,entry}.ts` | `embed/{url,code,events,embed-source}.test.ts` |
| F47 | `lib/scheduling/automation/variables.ts` | `automation/variables.test.ts` |
| F58 | `lib/scheduling/booker/unavailable.ts`, `lib/embed/fallback.ts` | `booker/unavailable.test.ts`, `embed/fallback.test.ts` |
| — | `lib/scheduling/types.ts` (tipos del módulo, §9) | — |

## Convenciones del módulo

- **Todo instante en UTC** como string ISO (`2026-10-06T18:30:00.000Z`). Las reglas van en hora de pared (`"09:00"`) más la zona IANA del horario. Una fecha suelta es `"YYYY-MM-DD"`.
- **`lib/scheduling/types.ts`** define la forma que esperan las funciones (`EventType`, `Booking`, `AvailabilitySchedule`, `BookingField`, `UnavailableMessages`, etc.). Cuando la Tanda B genere `lib/types/database.ts`, la capa de datos adapta las filas a estos tipos; no hace falta que sean idénticos, solo compatibles en los campos que se usan.
- **dayjs** solo se importa desde `lib/scheduling/time/dayjs.ts` (ya trae `utc`, `timezone`, `isBetween`). El resto de la app sigue con Intl y date-fns.
- **La semana empieza el lunes** (Wendy, 26/9): `rangeForFilter('this_week')`, la clave semanal de los topes y la vista mensual.
- **Teléfonos siempre con país/prefijo** (Wendy, 26/9): `phone-countries.ts` es la constante del selector (no hay tabla en base) y el valor validado es siempre `+dígitos`.

## Funciones, por grupo

### 1. Tiempo y zonas (`lib/scheduling/time/tz.ts`)

| Función | Espera | Devuelve |
|---|---|---|
| `formatInTz(date, tz, format)` | instante, zona IANA, tokens de dayjs | texto |
| `dateInTz(date, tz)` / `weekdayInTz` / `minutesOfDayInTz` | instante, zona | `"YYYY-MM-DD"` / 0-6 (0 = domingo) / minutos |
| `wallClockToUtc(date, "HH:mm", tz)` | fecha, hora de pared (`"24:00"` = 00:00 del día siguiente), zona | `Date` |
| `startOfDayUtc(date, tz)` | fecha, zona | `Date` |
| `rangeForFilter('today' \| 'this_week' \| {from,to}, tz, now?)` | filtro de la pantalla de agendas | `{ fromUtc, toUtc }` (fin exclusivo; un rango al revés se da vuelta) |
| `addDays`, `eachDate`, `isValidDateString`, `isValidWallTime`, `wallTimeToMinutes`, `minutesToWallTime` | helpers | — |

**Tanda B:** `getViewerTimezone(user)` (perfil → navegador → workspace) va en la Tanda B y le pasa `tz` a estas funciones.

### 2. Horarios (`availability-schema.ts`, `schedules.ts`, `out-of-office.ts`)

- `validateWeeklyHours(rules)` / `validateOverrides(overrides)` → `{ ok: true } | { ok: false, errors: [{ day, message }] }`. La misma función en cliente y Server Action. `day` es el índice del día (`"1"`) o la fecha de la excepción.
- `parseWeeklyHours(rules)` / `parseOverrides(overrides)` → el valor normalizado listo para guardar (`"00:00"` como fin pasa a `"24:00"`) o `null`.
- `upsertOverrides(current, incoming)` → una entrada por fecha, ordenada (F12: "elegir 3 días" = 3 entradas nuevas en una sola actualización).
- `trimPastOverrides(overrides, today, keepDays = 90)` → `{ kept, removed }`. **Tanda B:** al guardar, escribir `kept` y mandar `removed` a `audit_log`.
- `upcomingOverrides(overrides, today)`, `defaultWeeklyHours()` ("Horario normal", lun–vie 9–17, F3).
- `summarizeSchedule(weeklyHours)` → `"Lun a Vie, 9:00–12:00 y 14:00–18:00"`; grupos distintos separados por `" · "`; vacío `"Sin horarios"`.
- `outOfOfficeToUtc({ from, to, allDay, fromTime?, toTime? }, tz)` → `{ ok: true, startsAt, endsAt } | { ok: false, error }`. Días completos: 00:00 del primero a 00:00 del día siguiente al último. **Tanda B:** `conflictingBookings` es una consulta (agendas activas que superponen con `overlapsUtc`).

### 3. Límites (`lib/scheduling/limits/*`)

- `periodBounds(config, now, tz)` → `{ fromUtc, toUtc }` (`Date | null`, fin exclusivo) para `rolling_calendar`, `rolling_business` (lun–vie), `range` y `unlimited`. El día N se incluye completo.
- `isOutOfBounds(slotStartUtc, { ...periodConfig, minimumNoticeMinutes }, now, tz)` → `{ out, reason: 'past' | 'minimum_notice' | 'before_range' | 'after_window' | null }`.
- `countBookings(bookings, tz)` → `BookingCounts { byDay, byWeek }` (clave semanal = lunes). `exceedsLimits(slotStartUtc, counts, { maxPerDay, maxPerWeek }, tz)` → `{ exceeded, reason }`.
- `expandWithBuffers(interval, before, after)`, `effectiveSlotInterval(duration, interval)`, `noticeToMinutes` / `minutesToNotice`, y las constantes `BUFFER_OPTIONS`, `SLOT_INTERVAL_OPTIONS`, `DEFAULT_MINIMUM_NOTICE_MINUTES` (120), `DEFAULT_PERIOD_DAYS` (60).
- `validateLimits(input, now?, tz?)` → `{ ok: true, warnings: ['no_slots_possible'?] } | { ok: false, errors }`. `LIMITS_WARNING_TEXT` tiene el texto "No va a haber horarios disponibles".

### 4. Motor de horarios (`lib/scheduling/slots/index.ts`)

```ts
getAvailableSlots(input: SlotsInput): SlotsByDate   // { "2026-10-06": [{ startUtc, endUtc }] } en la zona del invitado
availableSlots(input): Slot[]                       // lista plana, ya filtrada
freeWindows(input): Range[]                          // ventanas libres en ms (pasos 1 a 4), para F15 y para depurar
isSlotAvailable(input, startUtc): boolean            // F26: el servidor decide
```

`SlotsInput`:

| Campo | Qué es | Quién lo arma |
|---|---|---|
| `eventType` | duración, intervalo, buffers, aviso, ventana, topes (subset de `EventType`) | la fila del evento |
| `schedule` | `{ timezone, weekly_hours, date_overrides }` | el horario del evento, o el por defecto |
| `overrides?` | reemplaza `schedule.date_overrides` si se pasa | opcional |
| `outOfOffice?` | `[{ starts_at, ends_at }]` de la persona | tabla `out_of_office` |
| `busy?` | `[{ startUtc, endUtc }]` de Google (freebusy de los calendarios de conflicto) | `lib/google-calendar` (Tanda B), con cache de 60 s |
| `bookings?` | agendas **activas** del anfitrión (de cualquier evento) con `before/after_buffer_minutes` de su evento | consulta `bookings` en el rango + margen de buffers. Al reagendar, excluir la propia |
| `bookingCounts?` | `countBookings(agendas activas de ESTE evento, schedule.timezone)` | consulta |
| `now` | el reloj | `new Date()` |
| `range` | `{ from, to }` ISO UTC, fin exclusivo (máximo 45 días, F24) | la API pública |
| `inviteeTz` | zona del invitado | `?tz=` o `Intl` del navegador |
| `ignoreMinimumNotice?` | F37, solo equipo | agendar manual |

Reglas que ya aplica el motor: excepción reemplaza la regla del día; ventanas que se tocan se fusionan (disponibilidad pasada la medianoche); Google se agranda con los buffers del evento nuevo; las agendas del sistema con los buffers de ambos; los horarios arrancan alineados a la hora local (unidad = la más grande de 60/30/20/15/10/5 que divide al intervalo); nunca se ofrece el pasado.

### 5. Formulario (`booking-fields.ts`, `phone-countries.ts`)

- `defaultBookingFields()` → nombre (obligatorio), email (obligatorio), teléfono (opcional).
- `validateBookingFields(input)` → `{ ok, fields } | { ok: false, errors }`. Rechaza: nombre no obligatorio, email y teléfono ambos no obligatorios (`EMAIL_OR_PHONE_REQUIRED`), identificadores repetidos o inválidos, opciones fuera de 2–50 o repetidas, sistema fuera de orden.
- `identifierFromLabel(label)`, `uniqueIdentifier(base, existing)`, `visibleFields(fields)`, `FIELD_TYPE_LABELS`.
- `buildBookingSchema(fields, { defaultCountry })` → Zod de las respuestas del invitado, claves = `identifier`. Ocultos no se piden; claves desconocidas se descartan; multiselect acepta un solo string; opcionales vacíos salen `undefined`. **El teléfono acepta `"+506…"` o `{ country: "CR", number: "8888-1234" }` y sale siempre `+dígitos`.**
- `contactDataFromResponses(responses)` → `{ name, email, phone }` para `find_or_link_contact`.
- `PHONE_COUNTRIES`, `DEFAULT_PHONE_COUNTRY` ("CR"), `findPhoneCountry`, `normalizePhoneWithCountry(input, defaultCountry)`, `isE164`. **Tanda B:** el selector de país se arma con `PHONE_COUNTRIES` y `defaultCountry` sale del workspace.

### 6. Evento (`slug.ts`, `event-validation.ts`)

- `slugify(text, forDisplayingInput?)`, `isValidSlug(value, min, max)`, `nextCopySlug(slug, existing)` (`-copia`, `-copia-2`…), `suggestSlug(title)`.
- `validateEventDetails(input)` → `{ ok, data } | { ok: false, errors }` (título, slug, duración 5–480, color de `EVENT_COLORS`, ubicación manual con texto, `success_redirect_url` solo `https://`). `isSafeRedirectUrl(url)`.
- `activationChecklist(eventType, ctx)` → 5 ítems (`details`, `schedule`, `calendar` obligatorios; `form`, `flows` recomendaciones), cada uno con `section` del editor y `reason`. `canActivate(list)` → `{ ok, blockers }`. `ctx` = `{ scheduleName, destinationCalendar: { name, provider: 'google', writable } | null, formValid, enabledFlows }`.
- `meetRequiresWritableGoogleCalendar(eventType, ctx)` → `null` o `MEET_NEEDS_GOOGLE_CALENDAR`.
- `slugChangeNeedsConfirmation({ currentSlug, nextSlug, futureBookings, confirm? })` y `deleteEventNeedsConfirmation(futureBookings, confirm?)` → `{ ok, needsConfirmation, message }`.
- `validateEventLimits` reexporta `validateLimits` para que la acción del editor valide las dos secciones desde un módulo.

### 7. Estados y vistas

- `booking-status.ts`: `BOOKING_STATUSES` (clave, etiqueta, color, orden, grupo), `BOOKING_STATUS_KEYS` (**comparar con el CHECK de `bookings.status` en un test**), `groupOf(status)` (**usar para el CASE de la columna calculada `status_group`**), `ACTIVE_STATUSES` (los únicos que entran en la exclusión), `canTransition(from, to, booking, now)`, `evaluateTransition` (con `reason`), `allowedTransitions(booking, now)` (menú del chip), `TRANSITION_REASON_TEXT`.
- `bookings-view.ts`: `needsOutcome(booking, now)`, `quickFilterOf` / `applyQuickFilter` / `quickFilterCounts` (pastillas Próximas · Sin resultado · Con resultado · Canceladas, con el orden de F33), `groupForKanban(bookings)` (siempre 11 columnas), `allowedDrops(booking, now)`. **Tanda B:** `filterBookings(params)` arma la consulta con el alcance (`own` → `host_user_id = viewer`).
- `kanban.ts`: `evaluateDrop(booking, toStatus, now)` → `{ ok, opensCancelModal } | { ok: false, reason }`, `isDraggable`, `needsCancelModal`, `DEFAULT_COLLAPSED_COLUMNS`, `HISTORY_COLUMN_DAYS` (30).
- `calendar-view.ts`: `placeInCalendar(bookings, tz, view, { includeCancelled?, range? })` → `{ items, byDate }` con `startMinutes`, `endMinutes` (puede pasar de 1440), `crossesMidnight`, colores de estado y evento.

### 8. Booker, `.ics` y variables

- `booker/month-view.ts`: `buildMonthView(slotsByDate, "YYYY-MM", tz, now?)` → semanas lunes–domingo con `available`, `slotCount`, `isToday`; `nextMonthWithSlots` / `prevMonthWithSlots`; `firstMonthWithSlots(slotsByDate)` (null = `no_slots`, F58). `addMonths`, `daysInMonth`.
- `booker/format.ts`: `formatSlotLabel(startUtc, tz, '12h' | '24h')`, `formatSlotSummary(start, end, tz, fmt)` ("Martes 6 de octubre, 14:00 – 14:30"), `formatDateLong`, `formatDateTimeWithZone` ("martes 6 de octubre, 14:00 (hora de Ciudad de México)"), `timezoneCityLabel`, `gmtOffsetLabel`, `normalizeSpaces` (para los tests: Intl mete U+00A0/U+202F).
- `booker/embed-params.ts`: `parseEmbedParams(searchParams | URLSearchParams)` → `{ embed, theme, color, hideEventTypeDetails, timezone, date, month, prefill: { name?, email?, phone?, answers }, utm, clickIds }`. `RESERVED_PARAMS`, `normalizeHexColor`.
- `ics.ts`: `buildIcs(booking, { domain, description?, url?, now? })` (UID = `ical_uid` o `uid@dominio`, plegado RFC 5545, `METHOD:CANCEL` si está cancelada), `googleCalendarLink(booking, description?)`, `outlookLink(booking, description?)`, `icsFilename`, `bookingLocationText`. **Tanda B:** el endpoint `/api/public/scheduling/bookings/[uid]/ics` sirve `buildIcs` con `Content-Type: text/calendar`.
- `automation/variables.ts`: `bookingVariables(booking, eventType, host, { baseUrl })` → objeto `booking.*` de F47 (con `answers.<identificador>`, multiselect unido por comas); `emptyBookingVariables()`; `schedulingLinkVariables(events, baseUrl)` → `{ scheduling: { link: { wendy: { llamada_de_triaje: url } } } }`. **Ojo:** los guiones del slug y del usuario pasan a `_` en la clave porque `interpolateVariables` solo lee `\w` y puntos dentro de `{{…}}`; el selector de variables del editor tiene que mostrar el token con guión bajo. `bookingManageUrl`, `bookingRescheduleUrl`, `eventPublicUrl`.

### 9. Embed y mensajes

- `booker/unavailable.ts`: `DEFAULT_UNAVAILABLE_MESSAGES`, `validateUnavailableMessages(input)`, `resolveUnavailableMessage(eventType, key, { event_title, host_name })` → `{ title, body, cta?, custom, showRetry }`, `buildCtaHref(cta, vars)` (`wa.me/…?text=`, `mailto:…?subject=`, o el link https), `fallbackPayload(eventType, vars)` (lo que va en `data-ssa-fallback`).
- `embed/url.ts`: `buildEmbedIframeUrl(calLink, config, parentUtm, origin?)`, `parentUtmFromSearch(search)`, `CAL_LINK_RE`.
- `embed/code.ts`: `generateEmbedCode('inline' | 'popup' | 'floating', options, baseUrl)` → `{ html, react }`. `options.fallback` es `fallbackPayload(...)` del evento; `baseUrl` = `workspaces.scheduling_public_base_url` o `NEXT_PUBLIC_APP_URL`.
- `embed/events.ts`: `EMBED_EVENTS` (los 5 públicos), `serializeEmbedEvent(name, booking, eventSlug)` (solo `uid, startTime, endTime, eventSlug, meetUrl?`), `embedMessage(type, payload, namespace)`, `parseEmbedMessage(data)`, `isTrustedOrigin(origin, allowed)`. **Tanda B, en el booker (adentro del iframe):** al montar, `parent.postMessage(embedMessage("ssa:loaded", {}), "*")`; al cambiar el alto, `ssa:height` con `{ height }`; al agendar, `serializeEmbedEvent(...)`. Los mensajes entrantes (`ssa:ui`) se validan con `isTrustedOrigin(event.origin, originConfigurado)`.
- `embed/fallback.ts`: `createLoadWatchdog({ timeoutMs?, onTimeout, timers? })`, `parseFallbackAttr(raw)`, `renderFallback(container, message, document, { theme, color, openUrl, onRetry })`. Todo por `textContent`, nunca `innerHTML`.
- `embed/snippet.ts`: `loaderSnippet(scriptUrl)`, `embedScriptUrl(baseUrl)`.
- `embed/embed-source.ts` + `embed/entry.ts`: el runtime (`SSA("init" | "inline" | "floatingButton" | "modal" | "ui" | "on" | "off" | "preload")`, popup por `data-ssa-link`, Escape cierra, respaldo a los 10 s) y su punto de entrada. **No está integrado al build.** **Tanda B:** compilar `lib/embed/entry.ts` con esbuild (formato `iife`, target `es2017`, minificado) a `public/embed/embed.js` en `npm run build`, y probar los tres modos con `docs/embed-test.html`. Los encabezados `frame-ancestors *` van solo en `/calendario/*` y `/embed/*`.

## Decisiones tomadas en el núcleo (para no rediscutirlas)

- **Semana lunes–domingo** y **teléfono con país obligatorio**: confirmadas por Wendy el 26/9/2026.
- **Ventana futura** (`rolling_*`): se corta en la zona del horario del anfitrión; el día N entra completo (como Cal.diy).
- **Alineación de horarios** a la hora local en la zona del anfitrión, con la unidad más grande de 60/30/20/15/10/5 que divide al intervalo. Sin el modo "optimized slots" de Cal.diy.
- **Tests portados de Cal.diy** se adaptaron a nuestro modelo (`weekly_hours` jsonb, sin travel schedules ni seats); no se copiaron los 2400 renglones tal cual.
- **Embed sin DOM real en los tests:** `EmbedRuntime` recibe `window`/`document` con una interfaz mínima que el DOM real cumple (`entry.ts` hace el cast). Así los 8 tests del runtime corren en `environment: node` sin sumar jsdom.
- **`scheduling.link.*`** con guión bajo en las claves (ver §8).

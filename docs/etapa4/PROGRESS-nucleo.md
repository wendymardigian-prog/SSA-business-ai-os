# Progreso — Etapa 4, Tanda A (núcleo)

Corrida autónoma en la rama `etapa4-nucleo`. Plano: `docs/requerimientos-agendamiento.md` (v1.4), tabla "Tanda A" de §0.1. Solo funciones puras con tests de Vitest: sin base, sin pantallas, sin rutas.

## Punto de partida (26/9/2026, worktree desde `main` @ `3706c23`)

| Comando | Resultado de hoy |
|---|---|
| `npx vitest run` | 117 archivos, **1258 tests en verde** |
| `npx tsc --noEmit` | exit 0, sin errores |
| `npm run lint` | 0 errores, **44 warnings preexistentes** (directivas `eslint-disable` sin uso) |
| `npm run build` | **Necesita `.env`**: compila TypeScript OK ("Compiled successfully") pero falla al prerenderizar `/register` porque el worktree no tiene `NEXT_PUBLIC_SUPABASE_URL` ni la key. No se crea `.env` (regla de Wendy); el build no es condición de esta tanda |

- Código de referencia: Cal.diy clonado fuera del repo en `~/Documents/SSA-referencia-etapa4/cal-diy` (MIT, commit `54343aa` del 20/9/2026). Se lee y adapta, nunca se importa.
- Dependencia nueva: `dayjs` 1.11.23 (plugins `utc`, `timezone`, `isBetween` incluidos en el paquete).
- Decisiones de Wendy (26/9): la semana empieza el lunes; los teléfonos siempre con selector de país/prefijo (constante en código, sin tablas nuevas en base); migraciones de la Etapa 4 desde `00121` (la Etapa 2 usa `00081+`); no correr `verify-*` en simultáneo con la sesión de la Etapa 2.

## Bloque 0 — Arranque
- [x] Rama renombrada a `etapa4-nucleo`
- [x] Plano guardado sin cambios en `docs/requerimientos-agendamiento.md`
- [x] Cal.diy clonado y verificado (MIT, posterior a abril de 2026)
- [x] `dayjs` sumado; `THIRD_PARTY_NOTICES.md` con la MIT completa
- [x] `PROGRESS-nucleo.md` y `PENDIENTE-nucleo.md`

## Tabla Tanda A (§0.1), fila por fila

| F | Qué entra | Archivos y tests | Estado |
|---|---|---|---|
| — | Atribución y dependencia | `THIRD_PARTY_NOTICES.md`, `dayjs` + plugins | [x] |
| F8 | `formatInTz`, `rangeForFilter` | `lib/scheduling/time/*`, `tz.test.ts` | [x] |
| F9, F11, F12 | Esquemas Zod de `weekly_hours` y `date_overrides` + validación compartida | `lib/scheduling/availability-schema.ts`, `rules-validation.test.ts`, `overrides.test.ts` | [x] |
| F10 | `summarizeSchedule` | `schedules.ts`, `schedules.test.ts` | [x] |
| F13 | Tiempo fuera de días completos a UTC | `out-of-office.ts`, `out-of-office.test.ts` (solo lo puro; `conflictingBookings` va en la Tanda B) | [x] |
| F17, F18 | `slugify` y validaciones puras del evento | `slug.ts`, `event-validation.ts`, `event-types.test.ts`, `event-validation.test.ts` (incluye los casos puros de F21) | [x] |
| F20 | `buildBookingSchema` y tipo de `booking_fields` | `lib/scheduling/booking-fields.ts`, `phone-countries.ts` (constante de países, decisión de Wendy), `booking-fields.test.ts` | [x] |
| F21 | Límites y buffers | `lib/scheduling/limits/{buffers,period,counts,validation}.ts` + tests | [x] |
| F23 | Motor de horarios completo | `lib/scheduling/slots/{date-ranges,busy,slots,index}.ts`, `slots.test.ts` (8 casos del plano + otros), `split.test.ts` y `date-ranges.test.ts` (portados de Cal.diy) | [x] |
| F25 | `buildMonthView`, `formatSlotLabel`, `parseEmbedParams` | `lib/scheduling/booker/{month-view,format,embed-params}.ts` + tests | [x] |
| F27 | `buildIcs` (+ links de Google y Outlook) | `ics.ts`, `ics.test.ts` | [x] |
| F32 | Estados, `canTransition`, `needsOutcome`, `groupForKanban`, `allowedDrops` | `booking-status.ts`, `bookings-view.ts`, `booking-status.test.ts`, `bookings-view.test.ts` (sin `filterBookings`, Tanda B; `BOOKING_STATUS_KEYS` exportada para comparar con el CHECK) | [x] |
| F34 | Reglas de arrastre | `kanban.ts`, `kanban.test.ts` | [x] |
| F35 | `placeInCalendar` | `calendar-view.ts`, `calendar-view.test.ts` | [x] |
| F39, F40, F41 | Fuente del embed, `buildEmbedIframeUrl`, `generateEmbedCode`, eventos | `lib/embed/*`, `url.test.ts`, `code.test.ts`, `events.test.ts` | [ ] |
| F47 | `bookingVariables`, `emptyBookingVariables`, `schedulingLinkVariables` | `automation/variables.ts`, `automation/variables.test.ts` | [x] |
| F58 | `resolveUnavailableMessage`, `buildCtaHref`, respaldo del embed | `unavailable.test.ts`, `fallback.test.ts` | [ ] |

## Grupos de ejecución
- [x] 1 · Tiempo y zonas horarias (F8) — `types.ts`, `time/dayjs.ts`, `time/tz.ts` (18 tests)
- [x] 2 · Esquemas de horarios (F9, F11, F12, F10, F13) — 29 tests
- [x] 3 · Límites (F21) — 22 tests
- [x] 4 · Motor (F23) — 42 tests; `getAvailableSlots`, `availableSlots`, `freeWindows`, `isSlotAvailable`
- [x] 5 · Formulario (F20) — 16 tests
- [x] 6 · Validaciones del evento (F17, F18) — 19 tests
- [x] 7 · Estados y vistas (F32, F34, F35) — 23 tests
- [x] 8 · Helpers del booker, `.ics` y variables (F25, F27, F47) — 26 tests
- [ ] 9 · Embed y mensajes (F39, F40, F41, F58)
- [x] Cierre · `docs/etapa4/nucleo.md` — 237 tests del módulo en 29 archivos; suite total 1495 en verde; tsc y lint en 0

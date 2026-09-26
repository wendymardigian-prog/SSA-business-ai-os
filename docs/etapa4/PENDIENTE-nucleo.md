# Pendientes — Etapa 4, Tanda A (núcleo)

Lo que quedó sin cerrar en la tanda A, para que lo retome la Tanda B o Wendy. Formato de cada entrada:

- **Qué quedó:** …
- **Por qué:** …
- **Qué se decidió en su lugar:** …

---

## Reglas para la Tanda B (de Wendy, 26/9/2026)
- **Qué quedó:** las migraciones de la Etapa 4 y los scripts `verify-*` no se escriben ni se corren en esta tanda.
- **Por qué:** la tanda A es solo código puro; y otra sesión construye la Etapa 2 sobre la misma base de Supabase.
- **Qué se decidió en su lugar:** la Etapa 4 toma la banda de migraciones **desde `00121`** (la Etapa 2 usa `00081+`); verificar con `list_migrations` justo antes de aplicar. Los scripts `verify-*` borran todos los datos `zz-test-` y se pisan entre sesiones: **no correrlos en simultáneo** con la sesión de la Etapa 2.

## `npm run build` en el worktree
- **Qué quedó:** el build no se pudo completar en esta rama.
- **Por qué:** el worktree no tiene `.env` (regla de Wendy: no crearlo) y `next build` falla al prerenderizar `/register` sin `NEXT_PUBLIC_SUPABASE_URL`. El TypeScript sí compila ("Compiled successfully") y `npx tsc --noEmit` está en 0.
- **Qué se decidió en su lugar:** no usar el build como condición de la tanda. La Tanda B lo corre en la carpeta principal, con `.env`.

## El script del embed no está en el build (F39)
- **Qué quedó:** `lib/embed/entry.ts` existe y está testeado, pero `npm run build` no genera `public/embed/embed.js`.
- **Por qué:** es alcance explícito de la Tanda B (§0.1: "sin integrar al build").
- **Qué se decidió en su lugar:** el runtime recibe `window`/`document` inyectados para poder testearlo en Node. La Tanda B agrega el paso de esbuild (iife, es2017, minificado) y `docs/embed-test.html`.

## Variables `scheduling.link.<usuario>.<slug>` con guión bajo (F47)
- **Qué quedó:** `schedulingLinkVariables` convierte los guiones del usuario y del slug a `_` en las claves (`llamada-de-triaje` → `llamada_de_triaje`).
- **Por qué:** `interpolateVariables` (`lib/flow-engine/interpolate.ts`) solo reconoce `\w` y puntos dentro de `{{…}}`, y el núcleo no toca archivos existentes.
- **Qué se decidió en su lugar:** el selector de variables del editor muestra el token con guión bajo. Si la Tanda B prefiere admitir guiones, extiende el regex del interpolador (y su copia en `simulator.ts`, cubierta por un test de paridad) y simplifica `schedulingLinkVariables`.

## Partes de los tests del plano que son de base o red
- **Qué quedó:** en `schedules.test.ts`, `out-of-office.test.ts`, `event-types.test.ts`, `event-validation.test.ts` y `booking-status.test.ts` están solo los casos puros. Faltan: marcar por defecto en la misma transacción, borrar el horario por defecto, mover eventos al borrar un horario, `conflictingBookings`, duplicar y borrar un evento con sus agendas, `filterBookings` con alcance `own`, y la comparación de `BOOKING_STATUS_KEYS` con el CHECK de `bookings.status`.
- **Por qué:** necesitan la base (Tanda B).
- **Qué se decidió en su lugar:** las funciones puras exponen lo necesario (`BOOKING_STATUS_KEYS`, `groupOf`, `overlapsUtc`, `deleteEventNeedsConfirmation`, `nextCopySlug`) y la Tanda B suma los casos en los mismos archivos.

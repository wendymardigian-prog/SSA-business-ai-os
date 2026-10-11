# Pendiente · Módulo Formularios

Formato: **qué quedó · por qué · qué se decidió**.

## Punto de partida

- **`verify-attribution.mjs` falla antes de empezar.** Un caso, "todos los contactos reales tienen first_touch" (732 de 791). Es una comprobación de datos del backfill de la 00115 sobre los contactos reales: los contactos creados después no lo tienen. No es del módulo; se anota y no puede empeorar. Los demás casos (toques, RLS, triggers de alta) pasan.
- **`node scripts/export-template.mjs` falla antes de empezar.** Su control de nombres encuentra 12 restos identificables en tests de Llamadas (`lib/calls/**/*.test.ts`, `lib/flow-engine/registry/call-triggers.test.ts`, `lib/knowledge/index-text.test.ts`). La definición de listo pide que el export deje el sitio por defecto, así que se arreglan esos 12 datos de ejemplo en F30 (un cambio de texto en los tests, sin tocar código de Llamadas).
- **`verify-knowledge.mjs` y `verify-webhook.mjs` no se corren en esta entrega.** El primero llama a Voyage de verdad (un proveedor de IA real, con costo); el segundo necesita la app corriendo en local. Formularios no toca Conocimiento ni los webhooks. Decidido con Wendy (11/10/2026).
- **`verify-rls`, `verify-roles`, `verify-audit-visibility` y `verify-workspace-isolation`** se corren con los flags `--despues-de-00143`, `--despues-de-00136` y `--despues-de-00147`, como dejó Llamadas.

## Diferencias entre el plano y el código real (gana el código)

| # | El plano supone | Lo real | Qué se hizo |
|---|---|---|---|
| D-1 | `lib/contacts/dedup.ts` busca teléfono → email | Hace una sola consulta `.or()` sin orden. Teléfono → email lo hacen `create_booking` y `find_or_link_contact` | `find_contact_by_phone_or_email` copia el criterio de `create_booking` (00129). `dedup.ts` no se toca |
| D-2 | `MEMBER_KEYS` y tabla del Member en `member-baseline.test.ts` | `MEMBER_KEYS` es interno; la lista escrita a mano está en `member-permissions-characterization.test.ts` | Se suma `forms.view` ahí, con comentario; `member-baseline.test.ts` suma páginas, acciones y nombre del menú |
| D-3 | Ítem de menú sin `adminOnly` | `NavItemMeta` exige `adminOnly`; los títulos salen de `PAGE_META` | `adminOnly: false` y entradas en `PAGE_META` |
| D-4 | Tipo `TouchEntry` | Es `TouchInput`; `RAW_KEYS` no se exporta | `formTouch` devuelve `TouchInput`; F33 solo suma claves |
| D-5 | El toque de la Agenda pasa por `sanitizeRaw` | Se arma en SQL y no pasa por `sanitizeRaw` | La caracterización fija la forma de su `raw` y las dos de Zernio |
| D-6 | `answerToText` en `booking-fields.ts` | Está en `lib/scheduling/automation/variables.ts` | Se importa de ahí |
| D-7 | Sección "Seguridad" en Integraciones | `ProviderSection` es `connections \| ai` | Se suma `security` |
| D-8 | Sumar archivos a `vault-boundary.test.ts` | Un `it` por destino | Se generaliza para que recorra todo `SERVER_ONLY` |
| D-9 | `crm-triggers.ts`; handlers en `lib/jobs/handlers/index` | No existe; los handlers se registran en `registerPublishing()` | `form-triggers.ts` copia `call-triggers.ts`; los jobs se registran en `lib/publishing/bootstrap.ts` |
| D-10 | `buildDesiredTriggers` copia la config entera | Copia clave por clave | Las claves de formulario no chocan con `NODE_ONLY_KEYS`; lo fija un test |
| D-11 | — | `linearToFlow` pierde `fixedEmail` | Arreglo aditivo en `linear-flow.ts` (F21) |
| D-12 | — | El cron trata como "booking" cualquier payload con `booking_id` y aplana el payload con `String(v)` | El payload de formulario son solo escalares y nunca lleva `booking_id` |
| D-13 | `TriggerPanel` agrupado | Array fijo y config escrita a mano | 3 entradas y un bloque `FORM_TRIGGERS` |
| D-14 | `robots.ts` "suma el sitemap" | Bloquea todo | Sigue bloqueando todo y permite solo las rutas de `lib/site/pages.ts` |
| D-15 | `/` con sesión | `app/page.tsx` redirige a `/login` | Se mueve a `app/(sitio)/page.tsx` |
| D-16 | `export-template.mjs` testeable | Ejecuta `main()` al importarse | Test por proceso; en F30 se extiende |
| D-17 | Tests de componentes | Vitest solo corre `**/*.test.ts` en node | No se portan los `.test.tsx` de prevxcrm; la lógica va a funciones puras |
| D-18 | shadcn | SSA no tiene shadcn, Radix, sonner, dnd-kit ni date-fns | Se traduce a los componentes de SSA; orden con flechas |
| D-19 | Buscador de contactos reutilizable | No hay | `searchContactsForForm`, mismo patrón que Llamadas |
| D-20 | `email-retry-utils` con tests | No tiene | Se portan y se escriben los tests |
| D-21 | `<Historial>` | Props `{entityType, entityId, names?, timeZone?, pageSize?}` | Se usa tal cual |
| D-22 | `{{contact.first_name}}` en el armador de links | Solo se resuelven `display_name`, `email` y `phone` | El armador ofrece solo esas tres; `first_name`/`last_name` queda como mejora transversal |

## Decisiones de la corrida

- **Turnstile, Resend e IA siempre simulados**, también en `verify-forms` (que corre el envío real contra la base con un `fetch` simulado).
- **`verify-forms` corre con `vite-node`** (como `verify-publishing`): ejecuta el código real de `lib/forms/submit.ts`.
- **Backup:** alcanza el backup diario de Supabase Pro (decidido con Wendy).
- **Validación de respuestas sin Zod:** `validateSubmission` (en `lib/forms/submission-schema.ts`) es una función que devuelve errores por clave, no un esquema Zod: la visibilidad encadenada hace que el esquema dependa de las propias respuestas. La misma función corre en el navegador y en el servidor. Zod valida la forma de la definición y de la config.
- **`renderSuccess` escapa por defecto** (como pide el plano); la API de envío lo llama con `escape: false` porque React ya escapa los nodos de texto.
- **`lib/attribution/collect.ts` trae su propio `safeUrl`** en lugar de importar `safeReferrer` de la Agenda: ese módulo importa `node:crypto` y la atribución tiene que poder ir en el bundle del embed. Un test verifica que ambos dan lo mismo.

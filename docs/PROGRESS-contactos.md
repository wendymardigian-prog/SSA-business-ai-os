# Progreso — Contactos: regla única "buscar o crear contacto"

Rama `fix/contactos-regla-unica` (creada desde `main` en `8a44b9d`, 13/10/2026). Plan aprobado por Wendy el 13/10/2026; abajo, tal cual.

## Checklist

- [ ] Punto de partida: `npm run build` y los `verify-*` (antes de tocar nada; resultados abajo)
- [ ] **C1** · La función central (`00200`, `lib/contacts/identity.ts`, `lib/contacts/find-or-create.ts`)
- [ ] **C2** · Todos los caminos la usan (caracterización primero; `00201`–`00204`; caminos TypeScript)
- [ ] **C3** · Que nadie pueda saltearla (`single-entry.test.ts`, `verify-contacts-single-entry.mjs`, concurrencia, `00205` ensayada)
- [ ] **C4** · Los duplicados que ya existen (lista en `docs/PENDIENTE-contactos.md`)
- [ ] Cierre: `CLAUDE.md` ("Contactos: regla única"), docs de deduplicación, PR sin mergear

## Punto de partida

| Comando | Resultado (13/10/2026) |
|---|---|
| `npx vitest run` | 812 archivos, 10.129 tests, todo verde |
| `npm run lint` | 0 errores, 36 warnings |
| `npm run build` | pendiente (primera tarea después del `/goal`) |
| `scripts/verify-*.mjs` | pendientes (primera tarea después del `/goal`); se excluyen `verify-knowledge` (Voyage real) y `verify-webhook` (app + token) |

Base: 843 contactos, 1 workspace, 0 borrados. Última migración registrada: `00199_task_trigger_types`.

## Migraciones

| Número | Nombre | Qué hace | Estado |
|---|---|---|---|
| `00200` | `find_or_create_contact` | `normalize_phone`, `private.contact_identity_lookup`, `find_or_create_contact` | sin escribir |
| `00201` | `contact_lookup_wrappers` | `find_contact_for_form` y `find_contact_by_phone_or_email` sobre el lookup compartido | sin escribir |
| `00202` | `find_or_link_contact_v3` | entrantes por canal sobre la central | sin escribir |
| `00203` | `create_booking_v3` | agenda sobre la central | sin escribir |
| `00204` | `submit_form_response_v6` | formularios sobre la central | sin escribir |
| `00205` | `contacts_unique_identity` | índices únicos de tel y email principal; se aplica DESPUÉS del despliegue | sin escribir |

La numeración se reconfirma con `list_migrations` antes de cada una.

---

## El plan aprobado


## Contexto

Hoy cada camino que crea un contacto tiene su propia búsqueda, con normalizaciones distintas, y `contacts` no tiene ningún índice único. Dos llegadas simultáneas de la misma persona crean dos contactos. **Ya pasó**: el único duplicado de la base (Instagram `fede.com.ia`) son dos contactos creados con 8 ms de diferencia el 10/10; uno quedó sin canal vinculado. El objetivo es que todo pase por una sola función con bloqueo por dato fuerte, sin perder un dato ni cambiar lo que se ve, salvo los casos que este plan lista.

Respuestas de Wendy ya incorporadas:
- Alta manual de un Member con un dato que es de un contacto que no ve: **se frena sin enlace ni nombre** ("Ya existe… pedile a un Admin que te lo asigne").
- Si un tel/email principal ya es de OTRO contacto: **se saltea ese dato y se anota el conflicto** (formulario, agenda, CSV, webhook); en la ficha, restaurar y fusionar, **error claro**.
- Agenda sin email ni teléfono: **se rechaza la reserva** con mensaje claro.

---

## 1. Inventario de caminos (verificado en código y base)

**Crean contactos**

| # | Dónde | Busca por | Si no encuentra | ¿Solo nombre? |
|---|---|---|---|---|
| 1 | `find_or_link_contact` (SQL, 00104) vía `lib/inbox-sync.ts:57` — la llaman los webhooks de Zernio (`app/api/webhooks/late/route.ts:299`), Evolution (`.../evolution/route.ts:242`), email entrante (`lib/email/inbound.ts:204`), `lib/comment-processor.ts:135` y el backfill (`inbox-sync.ts:225`) | canal → tel (`phone`/`whatsapp_phone`) → email (+secundario) → @ de la MISMA plataforma | inserta + `contact_channels` (`ON CONFLICT DO NOTHING`), deja `link_suggestions` si el @ está en otra red | No: siempre tiene el canal (dato fuerte). 254 contactos hoy son "canal sin otro dato" |
| 2 | `create_booking` (SQL, 00190) vía `lib/scheduling/booking/create.ts:136` (página pública, agenda manual, agente) | tel → email (`lower()` sin trim del lado guardado) | inserta sin chequear identidad | Sí, en teoría |
| 3 | `submit_form_response` v5 (SQL, 00176) vía `lib/forms/server-ports.ts:137` | `find_contact_for_form` con bloqueos `form-contact:` por dato | inserta si `create_or_link` y hay dato | No |
| 4 | `lib/actions/contacts.ts:66` `createContact` (cliente de la sesión) | `findDuplicateContact` (tel/wa, email/secundario, **sin @**) | inserta | **Sí** (nombre solo) |
| 5 | `lib/actions/sales.ts:150` `createContactForSale` (servicio) | `find_contact_by_phone_or_email`; **ignora el error del RPC** y **no normaliza el teléfono** | inserta | No |
| 6 | `lib/comments/attribution.ts:133` (servicio) | `.eq(columna, @)` **sin minúsculas ni sin "@"**; `maybeSingle` con 2 filas → crea otro | TikTok: inserta "Unknown commenter"; Instagram: no crea | No (tiene el @) |
| 7 | `lib/webhooks/upsert-contact.ts:239` `insertContact` (servicio) | `find_contact_for_form` (+ teléfono sin "+") | inserta; el manejo de `23505` es letra muerta (no hay índice) | No |
| 8 | `lib/actions/csv-import.ts:341` `insertNew` (cliente de la sesión) | `findDuplicateContact` | inserta; si existe, `updateExisting` completa vacíos | No |

**Solo buscan:** `find_contact_for_form` (00175), `find_contact_by_phone_or_email` (00156), `lib/contacts/dedup.ts`, `lib/actions/webhook-flow-editor.ts:127` (vista previa), `lib/comments/store.ts:204` (`.eq` sin normalizar), `lib/fathom/ingest.ts:97` (`email.ilike.<x>`: un `_` del email funciona como comodín — bug latente).

**No crean ni buscan por dato** (lo pediste verificar): el agente de IA (sus herramientas usan `ctx.contactId`; agenda pasando el contacto ya resuelto), `lib/inbound.ts` (solo `is_subscribed`), los nodos de flujo. Los `scripts/verify-*.mjs` insertan contactos `zz-test-` como datos de prueba. Seeds: solo precios.

**Fusión:** existe `linkContacts` (`lib/actions/contacts.ts:752`, Owner/Admin), pero solo se llega desde el banner de sugerencia (`components/contacts/link-suggestion-banner.tsx`), que aparece si el contacto tiene `metadata.link_suggestions`. No hay pantalla para fusionar un par cualquiera. Además rellena el principal ANTES de borrar el duplicado y no chequea errores (con índice único, el relleno fallaría en silencio).

## 2. Definiciones vigentes y normalización

Copiadas de la base (`pg_get_functiondef`), md5 hoy: `find_or_link_contact 861440d1…`, `create_booking 57b486fe…`, `submit_form_response 9d94bf45…`, `find_contact_for_form b5238c11…`, `find_contact_by_phone_or_email 0732f4d0…`, `record_contact_touch f364db18…` (no se toca). Las cinco son `SECURITY DEFINER`, `search_path=''`, EXECUTE solo `service_role`. Solo esas tres insertan en `contacts` (en ningún esquema hay otra).

| | Teléfono | Email | @ |
|---|---|---|---|
| `find_or_link_contact` | `btrim` | `normalize_email` (lower+btrim) en los dos lados | `normalize_handle` |
| `find_contact_for_form` / `_by_phone_or_email` | `btrim` | `normalize_email` en los dos lados | `lower(btrim(sin @))`; LinkedIn por `linkedin_slug` |
| `submit_form_response` | `btrim` | `normalize_email` | igual + validación de formato |
| `create_booking` | `btrim` | `btrim(lower(p))` vs `lower(columna)` **sin trim del lado guardado** | — |

**No existe normalizador de teléfono en SQL**: todos confían en que llega como `+<dígitos>` desde `lib/phone.ts` (`normalizePhone`: saca todo menos dígitos, "00"→"+", 8–15 dígitos). Ventas no lo llama.
**Gana `lib/phone.ts`**: es la regla que ya cumplen los 843 contactos (0 teléfonos fuera de `+<dígitos>`). Se crea su gemela SQL `public.normalize_phone` con casos compartidos. Para el email gana `normalize_email` en los dos lados (es un superconjunto de la de la agenda; hoy 0 emails sin normalizar, así que no cambia nada real).

## 3. Punto de partida (13/10/2026)

- Rama: **estamos en `main`**, no existe `fix/contactos-regla-unica` → se crea al empezar.
- `npx vitest run`: **812 archivos, 10.129 tests, todo verde.**
- `npm run lint`: **0 errores, 36 warnings.**
- `npm run build` y los `verify-*`: **no los corrí** porque el modo plan no permite escribir (el build genera `.next` y puede regenerar `embed.js`; los verify crean y borran datos en la base real). Son la **primera tarea de la ejecución, antes de tocar nada**, de a uno: `verify-rls --despues-de-00143`, `verify-roles --despues-de-00136`, `verify-workspace-isolation --despues-de-00143`, `verify-audit-visibility --despues-de-00168`, `verify-crm`, `verify-csv-import`, `verify-forms`, `verify-sales`, `verify-eod`, `verify-attribution`, `verify-ads-attribution`, `verify-inbound-webhooks` (parte de base; la de punta a punta necesita la app), `verify-scheduling`, `verify-booking-concurrency`, `verify-calls`, `verify-tasks`, `verify-enrichment`, `verify-optout`, `verify-message-persistence`, `verify-chat-media`, `verify-content`, `verify-dashboards`, `verify-inbox-filters`, `verify-publishing`. **Se excluyen** `verify-knowledge` (llama a Voyage de verdad) y `verify-webhook` (pega a la app y necesita token). Lo que ya falle se anota en PROGRESS y no puede empeorar.
- Base: última migración registrada `00199_task_trigger_types` → **la próxima libre es la `00200`** (se reconfirma con `list_migrations` antes de cada una).

## 4. Duplicados hoy (843 contactos, 1 workspace, 0 borrados)

Teléfono 0 · email 0 · tel↔WhatsApp cruzado 0 · email↔secundario cruzado 0 · TikTok 0 · X 0 · LinkedIn 0 · **Instagram 1**:
`7c8a2ad4-…0409` (10/10 12:33:00.290, sin canal, 1 conversación) y `f370f154-…3493` (10/10 12:33:00.298, con canal, 1 conversación), los dos `fede.com.ia`. → Se crean los dos índices únicos (tel y email principal).

---

## 5. Plan por requisito

### C1 · La función central (migración `00200_find_or_create_contact`)

- `public.normalize_phone(text)` — gemela exacta de `normalizePhone` (IMMUTABLE).
- `private.contact_identity_lookup(ws, identity_normalizada)` — STABLE, la búsqueda pura en orden: canal (`contact_channels`) → tel contra `phone`/`whatsapp_phone` (primero el `phone` recibido, después el `whatsapp_phone`) → email contra `email`/`secondary_email` → instagram → tiktok → x → linkedin (por slug) → facebook (solo si viene, ver diferencias). Solo no borrados del workspace, `ORDER BY created_at` como hoy, nunca por nombre. Devuelve ganador, `matched_by`, primer conflicto y la lista `conflicts` (como hoy `find_contact_for_form`).
- `public.find_or_create_contact(p_workspace_id, p_identity, p_defaults, p_mode, p_allow_without_identity boolean default false)` — VOLATILE, `SECURITY DEFINER`, `search_path=''`, EXECUTE solo `service_role`:
  1. normaliza (tel con `normalize_phone`, email con `normalize_email`, @ sin "@"/minúsculas/sin URL; LinkedIn a URL canónica);
  2. `pg_advisory_xact_lock(hashtextextended('contact-identity:'||ws||':'||tipo||':'||valor,0))` por cada dato, **ordenados por la clave** (tel y WhatsApp comparten tipo `phone`; email y secundario, `email`; el canal es `channel:<id>:<sender>`) — se toman también en `find_only`;
  3. busca con el lookup; sin dato fuerte → `no_identity` (salvo el flag);
  4. `create`: inserta con `p_defaults` (vía `jsonb_populate_record`, sin dejar pisar `id`, `workspace_id`, `deleted_at`, `created_at`, `updated_at` ni las columnas de identidad, que salen de `p_identity` normalizado); `link_channel`: además `contact_channels … ON CONFLICT DO NOTHING`.
  5. Devuelve `{contact_id, created, matched_by, conflict_contact_id, conflicts, status}`.
- Espejo puro `lib/contacts/identity.ts` (normalización, orden de búsqueda, claves de bloqueo ordenadas, sin datos) + `lib/contacts/identity.cases.json` que corre contra TS (vitest) y contra SQL (en el verify), mismo patrón que `meta-match.cases.json`.
- `lib/contacts/find-or-create.ts`: `findOrCreateContact(service, …)` y `findContact(service, …)` (= `find_only`). Siempre cliente de servicio; quien llama ya chequeó permiso y saca el workspace de la sesión. **Así llegan los caminos que hoy usan el cliente del usuario (alta manual, CSV) sin abrir permisos.**
- Tests: `identity.test.ts`, `find-or-create.test.ts` (RPC simulado), test de migración (grants, `search_path`, que sea la única con `INSERT INTO public.contacts` nueva).
- Verificación: aplicar con la CLI, registrar, `build-all-migrations`, casos SQL↔TS en verde, `vitest`.

### C2 · Todos los caminos la usan

**Primero, tests de caracterización** (antes de tocar): `createContact` con duplicado y solo nombre, CSV (vincula/crea/error), webhook (creado/actualizado/conflicto), Ventas, comentario TikTok/IG, y en el verify contra la base real: `find_or_link_contact` (canal/tel/email/@/nuevo + `suggested_contact_id`), `create_booking`, `submit_form_response` (`matched_by`, `conflict_contact_id`, `conflicts`, `no_contact`, `already_answered`) y la atribución (primer/último toque) idéntica antes y después.

Migraciones (cada una parte de `pg_get_functiondef` vivo, misma firma, encabezado "Cómo volver atrás" con la definición vieja completa y su md5):
- `00201_contact_lookup_wrappers` — `find_contact_for_form` y `find_contact_by_phone_or_email` pasan a llamar al lookup compartido (siguen STABLE, misma salida).
- `00202_find_or_link_contact_v3` — busca/crea con la central en `link_channel`; conserva lo de alrededor (actualizar nombre/foto/@, `link_suggestions`, `analytics_events`, `audit_log`) y traduce `matched_by` a sus valores de siempre (`channel|phone|email|username`).
- `00203_create_booking_v3` — busca/crea con la central; sin dato fuerte lanza una excepción con código propio que `createBooking` traduce a "Necesitamos un email o un teléfono para agendar"; al completar vacíos **no escribe un tel/email que es de otro contacto**.
- `00204_submit_form_response_v6` — reemplaza sus bloqueos `form-contact:` y las dos llamadas a `find_contact_for_form` por la central (`find_only` en el paso 1, `create` en el 3, mismo orden: "una vez por contacto" sigue sin crear contacto); el UPDATE también saltea tel/email en conflicto (antes solo las redes).
- Huellas: `scripts/verify-forms.impl.ts:252-266` (`find_or_link_contact`, `create_booking`) se actualiza en el mismo commit, con comentario. `record_contact_touch` sigue `f364db18…` (verify-forms y verify-ads-attribution lo siguen controlando). Los tests de diff que leen archivos (00164/00176, 00190) no cambian; se suman tests de diff iguales para 00202–00204.

TypeScript (todo por `lib/contacts/find-or-create.ts`):
- **Alta manual**: dedup ahora también por @; si existe y la persona lo ve → "Ya existe… Te llevo a su ficha" (como hoy); si no lo ve → mensaje sin enlace. Es el único con `allowWithoutIdentity`.
- **CSV**: misma regla por fila; `updateExisting` saltea tel/email en conflicto; el reporte suma "vinculadas a un contacto existente: N (tel X, email Y, @ Z)".
- **Ventas**: central `create`; un error del RPC ya no se toma como "no encontrado".
- **Comentarios** (`attribution.ts`, `store.ts`): central con el @ normalizado.
- **Fathom**: `findContact` por email en vez de `ilike`.
- **Webhook**: central; se borra el falso `23505`; `buildPatch` (completar/sobrescribir) igual, después.
- **Vista previa del editor de webhooks** y `dedup.ts`: pasan a `findContact` (`findDuplicateContact` queda como envoltorio o se borra con sus usos; su test se adapta).
- **Por el índice (respuesta 2)**: `updateContact`/edición en la ficha y `restoreContact` traducen el `23505` a "Ese teléfono/email ya es de otro contacto"; `linkContacts` borra el duplicado ANTES de rellenar el principal y chequea los errores.

### C3 · Que nadie pueda saltearla

- `lib/contacts/single-entry.test.ts` (patrón `table-boundary.test.ts`): recorre `lib`, `app`, `components`, `scripts` y falla con `.from("contacts").insert(` / `upsert` fuera de `find-or-create.ts`; lista explícita de excluidos (los `scripts/verify-*` que arman datos `zz-test-`; los `*.test.ts`), más un control de que el escaneo encuentra archivos.
- `scripts/verify-contacts-single-entry.mjs`: (a) ninguna función de la base salvo la central tiene `INSERT INTO public.contacts`; (b) casos SQL↔TS; (c) 10 llamadas en paralelo con el mismo teléfono y 10 con el mismo email en mayúsculas/minúsculas distintas → 1 contacto cada vez; (d) limpia lo que creó.
- `00205_contacts_unique_identity`: índices únicos parciales `(workspace_id, phone)` y `(workspace_id, normalize_email(email))` con `deleted_at IS NULL`, abortando si encontrara un duplicado. **Recomendación (diferencia con tu pedido):** escribirla, ensayarla en una transacción que se deshace sola, y **aplicarla después de desplegar este PR**: con el código de `main` en producción, la fusión perdería en silencio el relleno de tel/email. Queda en PENDIENTE con el paso exacto.

### C4 · Duplicados existentes

- Consulta (tel, email, cruces, cada @) guardada en `docs/PENDIENTE-contactos.md` con ids, dato y fechas: hoy solo el par de `fede.com.ia`.
- Nada se fusiona solo. `linkContacts` existe pero solo desde el banner de sugerencia; se anota como pendiente cómo llegar (o una pantalla de "fusionar con…").

---

## 6. Cambios de comportamiento visibles (para aprobar)

1. Alta manual: un @ de Instagram/TikTok/X/LinkedIn que ya existe ahora frena el alta (antes solo tel/email).
2. Alta manual de un Member: detecta duplicados que no ve (antes creaba el duplicado) y frena sin enlace.
3. Agenda sin email ni teléfono: se rechaza (antes creaba un contacto solo con nombre).
4. Un tel/email que es de otro contacto ya no se escribe al completar (formulario, agenda, CSV); en la ficha, restaurar y fusionar aparece un error claro.
5. Teléfono que no llega normalizado (Ventas): se normaliza; uno inválido (<8 dígitos) deja de contar como dato.
6. Formulario con tel + WhatsApp: antes, si el tel no estaba y el email sí, el WhatsApp ni se miraba; ahora se mira el WhatsApp antes que el email (gana el tel, el email queda como conflicto).
7. Comentarios: el @ se compara en minúsculas y sin "@" (menos duplicados de TikTok).
8. Fathom: el `_` del email deja de ser comodín; con dos contactos por email, gana el más viejo.
9. Dos llegadas simultáneas de la misma persona dan un contacto (antes, dos).

## 7. Diferencias con lo que pediste (gana el código)

- No hay normalizador de teléfono en SQL: se crea `normalize_phone` gemela de `lib/phone.ts`.
- Los envoltorios no llaman a la central sino a su lookup compartido: tienen que seguir STABLE (sus llamadores no cambian) y la central es VOLATILE porque inserta. La lógica es una sola.
- La central devuelve además `conflicts` (lista) y `status`, porque Formularios y el webhook ya usan la lista.
- `find_or_link_contact` busca también por `facebook_id` de la misma plataforma; se mantiene como dato opcional del canal (hoy no hay canales de Facebook).
- El agente, `lib/inbound.ts` y Fathom no crean contactos: no hay "creación solo con nombre" que apagar ahí.
- El índice único se aplica después del despliegue (ver C3).
- `create_booking` normalizaba el email distinto (sin trim del lado guardado): queda con `normalize_email`.

## 8. Riesgos y cómo volver atrás

- **Reescribir tres funciones vivas** (riesgo alto): cada encabezado trae la definición vieja completa; volver = pegarla (`CREATE OR REPLACE`). Se aplica de a una con su verify antes y después; si uno falla, **se para**, se anota en PENDIENTE y se vuelve atrás.
- **Bloqueos**: orden fijo por clave → sin interbloqueos; duran solo la transacción.
- **Índices**: volver = `DROP INDEX`.
- **Central**: volver = revertir 00201–00204 y `DROP FUNCTION` de las tres nuevas.
- **TS**: el PR no se mergea; revertir es cerrar el PR.

## 9. Primeras tareas de la ejecución

1. `git checkout -b fix/contactos-regla-unica`.
2. Crear `docs/PROGRESS-contactos.md` con este plan tal cual (C1–C4 como checklist, "Punto de partida" y "Migraciones" `00200`–`00205`) y `docs/PENDIENTE-contactos.md` (qué quedó / por qué / qué se decidió).
3. Commit `docs: plan de la regla unica de contactos` y push.
4. **Frenar y esperar tu `/goal`.** Recién ahí: build y los verify del punto de partida, y C1→C4 con `npx vitest run` después de cada requisito, commit `fix: contactos - Cn (nombre)` y push. Cierre: sección "Contactos: regla única" en `CLAUDE.md`, docs de deduplicación, PR con `gh pr create` (sin mergear).

## 10. Verificación de punta a punta

`npx vitest run` (incluye `single-entry`, `identity` y los de caracterización) · `node scripts/verify-contacts-single-entry.mjs` · `verify-forms`, `verify-crm`, `verify-csv-import`, `verify-sales`, `verify-scheduling`, `verify-booking-concurrency`, `verify-attribution`, `verify-ads-attribution` (huella de `record_contact_touch`), `verify-inbound-webhooks`, `verify-rls`, `verify-roles` · `npm run build` · `npm run lint`. Ninguno en simultáneo.

# Progreso: suscripción a emails e importador con suscripción (rama `feat/suscripcion-email`)

Este archivo es lo que sigue la construcción aunque la conversación se resuma. **Releerlo al empezar cada requisito.** Pendientes y decisiones: `docs/PENDIENTE-suscripcion-email.md`.

## Checklist

- [x] Paso 0 · Línea base y tests de caracterización (envíos A/B/C/F/G, importador, fusión)
- [x] M1 (`00270`) aplicada, registrada y verificada (29/10/2026, versión `20261029224458`)
- [x] E1 · Modelo de datos y función central (`00270` + `00271`)
- [x] M2 (`00271`) aplicada, registrada y verificada (29/10/2026, versión `20261029225041`)
- [x] E2 · Puerta de envío `canSendEmailTo`, categoría por envío y secuencias (`00272`)
- [x] M3 (`00272`) aplicada, registrada y verificada (29/10/2026, versión `20261029230043`)
- [ ] E3 · Link de baja, baja en un clic y página pública
- [ ] E4 · Rebotes y quejas desde Resend
- [ ] E5 · Panel (ficha, historial, lista)
- [ ] E6 · Importador con suscripción y prueba en seco
- [ ] E7 · Verificación (`verify-email-subscription.mjs` y tests)
- [ ] E8 · Remitentes (usuario + dominio verificado de Resend)
- [ ] Cierre: `CLAUDE.md` («Emails: suscripción y baja»), `docs/importar-contactos-con-suscripcion.md`, limpieza `zz-test-`, PR (sin mergear)

## Punto de partida (29/10/2026)

Rama `feat/suscripcion-email` sin cambios de código (base `782eb01`). Los `verify-*` se corrieron de a uno, desde el checkout principal (ahí está el `.env`), con el candado `/private/tmp/ssa-verify.lock`.

| Chequeo | Resultado de partida |
|---|---|
| `npx vitest run` (antes de instalar) | 1117/1118 archivos, 14.345 tests; falla solo `emoji-picker` (`frimousse` sin instalar en el worktree) |
| `npm install` | instaló 50 paquetes; **no cambió `package.json` ni `package-lock.json`** (`git status` limpio) |
| `npx vitest run` (después de instalar) | **1118/1118 archivos, 14.360 tests, verde** |
| `npm run lint` | 0 errores, 37 warnings (eslint-disable sin uso, previos) |
| `npm run build` | antes de instalar: falló por 4 paquetes sin instalar; **después: verde** |
| `verify-*.mjs` | ver «Línea base de los verify-*» más abajo |

### Medición de la base (solo lectura)

- 1.220 contactos vivos, 0 borrados, 2 workspaces. Con email: 6. Con email secundario: 0. Direcciones repetidas entre contactos: 0.
- `do_not_contact`: 0 (ninguno con email). `is_subscribed = false`: 0.
- Flujos: 26, todos en borrador (agenda 14 y sistema/cobranza 8, todos con nodo de email; formularios 1; manual 3, sin email). Secuencias: 1 en borrador, sin pasos de email. Inscripciones: 0.
- `email_log`: 3 filas, todas invitaciones de equipo (2 `failed`, 1 `skipped_not_configured`).
- Hoy no corre ningún flujo ni secuencia con email a contactos.

## Migraciones

| Nº | Contenido | Estado |
|---|---|---|
| `00270` | columnas de `contacts`, `workspaces.email_footer_address`, índices, backfill | **aplicada y registrada** (`20261029224458`) |
| `00271` | `email_address_status`, `email_address_send_state`, `set_email_status`, `set_email_status_by_address`, guardia, herencia y regla de la fusión (por trigger) | **aplicada y registrada** (`20261029225041`) |
| `00272` | CHECK de `email_log.status` (estados `skipped_*`) | **aplicada y registrada** (`20261029230043`) |

Última migración registrada al empezar: `00269` (`20261028233702`). Primera libre: `00270` (reconfirmar con `list_migrations`). Autorización de Wendy: aplicar `00270`–`00272` sin pedir OK cada vez si cada verificación pasa; si falla una, se para.

## E1 · Hecho (29/10/2026)

**Caracterización previa** (en verde antes de tocar nada): `lib/email/send-reply.characterization.test.ts` (camino B/C), `send-email.test.ts` suma la excepción de agenda y el freno a dirección fija por «no contactar» (camino A), `lib/actions/sales-contract.characterization.test.ts` (camino F, sin mirar «no contactar»), `lib/csv/map.characterization.test.ts` (encabezados reales del export). La copia firmada (G), el procesador de secuencias y la bandeja ya tenían tests; la fusión la cubre `verify-contact-merge`.

**Migraciones.** `00270` se ensayó en una transacción que se deshace sola (1.248 contactos `subscribed`, 0 `updated_at` cambiados, tokens únicos) y se aplicó. `00271` se ensayó con contactos de prueba en otra transacción deshecha (la baja alcanza a los que comparten la dirección, `system` no re-suscribe, idempotente con una sola entrada por contacto, herencia al insertar, rebote, persona sin poder volver desde un rebote, fusión con el peor estado) y se aplicó. Después de cada una: `verify-contact-merge`, `verify-contacts-single-entry`, `verify-optout`, `verify-csv-import`, `verify-crm` y `verify-contact-pipeline` en verde.

**Código.** `lib/email/subscription.ts` (gravedad, tabla de transiciones gemela de `private.email_status_decide` con `subscription-transitions.cases.json`, valores de importación, etiquetas, `canSendEmailTo`, `setEmailStatus`, `setEmailStatusByAddress`); `lib/email/subscription-single-entry.test.ts` (frontera); tipos en `lib/types/database.ts` (las columnas solo en `Row`: TypeScript tampoco deja escribirlas).

**Diferencias con el plan (adaptadas manteniendo el comportamiento):**
- **La fusión no reescribe `merge_contacts`**: un trigger `contacts_email_on_merge` (al borrar el duplicado con `merged_into`) le da al principal el peor estado. Es el mismo patrón que «Conocido» (00256) y «Cliente» (00268) y evita copiar 270 líneas de una función que funciona. `lib/contacts/merge.ts` no cambia: lista tablas con `contact_id`, no columnas del contacto.
- **`set_email_status` aplica a todos los contactos que comparten la dirección** (no solo al pedido): así las 10 llamadas en paralelo sobre dos contactos con la misma dirección terminan iguales, y una baja nunca queda a medias.
- **Los motivos de pausa se guardan como código** (`email_unsubscribed`, `email_bounced`, `email_complained`) y la pantalla los muestra en palabras (`EMAIL_PAUSE_LABELS`): así se distinguen de `opt_out` y se pueden filtrar.
- **`email_address_send_state`** (además de `email_address_status`): la puerta de envío necesita en una sola consulta el estado, si algún contacto vivo con esa dirección está en «no contactar» y el token del pie.
- **«No pude comprobar»**: si la base no contesta, un marketing no sale (`skipped_unverifiable`) y un transaccional sí.

## E2 · Hecho (29/10/2026)

**Migración.** `00272` (superconjunto del CHECK de `email_log.status`: `skipped_unsubscribed`, `skipped_bounced`, `skipped_complained`, `skipped_do_not_contact`, `skipped_unverifiable`) ensayada, aplicada y registrada; las 3 filas existentes intactas.

**La puerta.** `sendTransactionalEmail` (parámetro `category`, y `honorDoNotContact`) y `sendEmailReply` (parámetro `category` obligatorio, `contactId` y `log`) consultan `canSendEmailTo` con el cliente de servicio. Un salto no llama a Resend, devuelve `reason: "skipped"` y queda en `email_log` con su motivo.

**Por camino (cada uno con su test con espía):**
- A · nodo «Enviar email»: campo «Tipo de email» (marketing por defecto en el lienzo; transaccional en el editor de pasos de agenda, formularios y cobranza). Sin guardar, el motor usa el del flujo (`stepEmailCategory`: transaccional si tiene `event_type_id`, `form_id` o `template_key`, o arrancó por una reunión). Un salto es `node_skipped` + `onStepSkipped`, nunca `node_failed`. El salto por «no contactar» ahora queda en `email_log` (`skipped_do_not_contact`) y `node_skipped`.
- B · `sendChannelMessage` por email: marketing si nace de un flujo o de una secuencia, transaccional si es el agente (`channelEmailCategory`); los de flujos y secuencias quedan en `email_log` con el id de Resend.
- B4 · secuencias: «Tipo de email» por paso (jsonb, marketing por defecto). Respaldo del procesador antes de cada paso por email: pausa con `email_unsubscribed` / `email_bounced` / `email_complained`, saltea un transaccional a una dirección que rebota, reintenta si la base no contesta. `resumeEnrollment` no reanuda si la dirección sigue sin poder recibir marketing. La pantalla de la secuencia distingue y filtra las pausas por email.
- C · bandeja: transaccional; a una dirección dada de baja o con queja pregunta antes (409 `email_opt_out`, confirmación en la pantalla); una que rebota no sale.
- F y G · contratos: transaccionales; solo los frena un rebote (decisión de Wendy). Las copias al equipo no llevan categoría.
- D, E, H, I (pruebas del editor, avisos, invitaciones): van al equipo, sin categoría; `subscription-gate.test.ts` los lista con su motivo y falla si aparece otro llamador sin categoría.
- Plantillas: agenda, formularios y cobranza guardan `category: "transactional"`.

**Condiciones y segmentos.** Condición de flujo «Estado de email» (catálogo, registro, simulador y casos); filtro «Estado de email» y columna opcional en la lista de contactos; regla en segmentos. `is_subscribed` no cambió: su etiqueta pasa a «Recibe difusiones por chat» (condición, segmentos y la bandeja, que decía «Suscripto / Dado de baja»).

**Diferencias con el plan:**
- **El cambio 6 del plan no se aplicó**: el nodo «Enviar email» sigue frenando por «no contactar» del contacto del flujo también a una dirección fija o al anfitrión, como hasta hoy (un test de caracterización lo fija). Era el único cambio de comportamiento que no pedía la suscripción y el más fácil de romper.
- **«Cancelar envíos pendientes de marketing»**: no hay una cola propia de emails de marketing. Lo que quedaba pendiente (un flujo en un «Esperar», una secuencia) se frena igual: la secuencia se pausa en el momento y el flujo, al retomar, pasa por la puerta.

## Línea base de los verify-*

Corrida del 29/10/2026, de a uno, con el candado. **28 de 33 en verde; 5 fallan en la línea base y no tienen relación con email** (se anotan para que no empeoren). Limpieza comprobada después: 0 workspaces, contactos ni usuarios `zz-test-` en la base.

| Script (flags) | Resultado | Duración |
|---|---|---|
| `verify-rls --despues-de-00143` | verde | 130 s |
| `verify-roles` (`--despues-de-00136 -00208 -00211 -00212 -00249`) | verde | 105 s |
| `verify-workspace-isolation --despues-de-00143` | verde | 13 s |
| `verify-content --despues-de-00253` | verde | 32 s |
| `verify-crm` | verde | 15 s |
| `verify-inbox-filters` | verde | 16 s |
| `verify-dashboards` | verde | 22 s |
| `verify-attribution` | **1 falla** | 39 s |
| `verify-publishing` | **5 fallas** | 94 s |
| `verify-scheduling` | verde | 51 s |
| `verify-booking-concurrency` | verde | 25 s |
| `verify-optout` | verde | 10 s |
| `verify-csv-import` | verde | 12 s |
| `verify-contact-merge` | verde | 106 s |
| `verify-contacts-single-entry` | verde | 33 s |
| `verify-contact-pipeline` | verde | 17 s |
| `verify-enrichment` | verde | 8 s |
| `verify-knowledge` | verde | 5 s |
| `verify-message-persistence` | verde | 7 s |
| `verify-chat-awaiting` | verde | 41 s |
| `verify-chat-media` | verde | 21 s |
| `verify-forms` | **1 falla** | 300 s |
| `verify-eod` | verde | 93 s |
| `verify-tasks` | verde | 201 s |
| `verify-sales --despues-de-00168` | verde | 190 s |
| `verify-payment-methods` | verde | 66 s |
| `verify-expenses --despues-de-00233` | **1 falla** | 67 s |
| `verify-commissions --despues-de-00235` | verde | 101 s |
| `verify-organic-attribution --despues-de-00234` | verde | 78 s |
| `verify-ads-attribution` | **1 falla** | 151 s |
| `verify-inbound-webhooks` | verde | 65 s |
| `verify-calls` | verde | 129 s |
| `verify-permissions-matrix --despues-de-00212` | verde | 267 s |
| `verify-audit-visibility --despues-de-00147 -00168` | verde | 39 s |

No corridos: `verify-student-schema` (necesita base local o de referencia) y `verify-webhook` (necesita `--target` con una app corriendo).

**Las 5 fallas de partida (previas, no se tocan en esta rama):**
- `verify-attribution`: «todos los contactos reales tienen first_touch» da 1179 de 1246. Es un dato real de la base (contactos sin primer toque), no un defecto del script.
- `verify-publishing`: 5 fallas (la fila queda publicada; A13 pieza parcialmente publicada; A6 automatización «solo este post»; publicación sin aviso se pone al día; la pieza queda publicada). Todas del flujo de publicación con proveedores simulados.
- `verify-forms`: el `EXPLAIN` de la consulta de vistas usa `idx_analytics_workspace` en vez de `idx_analytics_forms` (con tan pocas filas el planificador elige otro índice). Todo lo demás del script pasa.
- `verify-expenses`: el script se cae con `TypeError: Cannot read properties of null (reading 'id')` en `verify-expenses.mjs:101`.
- `verify-ads-attribution`: el `EXPLAIN ANALYZE` tarda 702 ms (el umbral es 300 ms). La comprobación de que la lista de cada celda coincide con su número (40 celdas) pasa.

Regla para esta rama: al terminar, estos cinco pueden fallar igual, pero **no pueden fallar en más lugares ni aparecer otros**. Los scripts que tocan lo que cambiamos (`verify-contact-merge`, `verify-contacts-single-entry`, `verify-csv-import`, `verify-optout`, `verify-rls`, `verify-roles`, `verify-audit-visibility`) están todos en verde y tienen que seguir así.

---

# Plan aprobado (tal cual)

# Plan: suscripción a emails + importador con suscripción

Rama `feat/suscripcion-email` (worktree `suscripcion-email-setup-6f257a`). Plan de la etapa de diseño: no se escribió código ni se tocó la base (solo consultas de lectura).

## Contexto

Hoy ningún email a un contacto mira si la persona se dio de baja, ningún email lleva link de baja, los rebotes y quejas de Resend se ignoran y el importador CSV mete a todos como suscriptos (se perderían las bajas de wendymardigian.com). Se construye: estado de email por contacto con historial, una sola puerta de envío (`canSendEmailTo`), baja en un clic y página pública, webhook de rebotes/quejas, panel, importador con suscripción (con prueba en seco) y selector de remitente por dominio verificado de Resend.

## 1. Punto de partida (medido el 28-29/10/2026)

| Chequeo | Resultado |
|---|---|
| `npx vitest run` | 1117/1118 archivos, **14.345 tests pasan**. Falla solo `emoji-picker` por `frimousse` no instalado |
| `npm run lint` | 0 errores, 37 advertencias previas (eslint-disable sin uso) |
| `npm run build` | **Falla** por 4 paquetes declarados en `package.json` pero no instalados en este worktree: `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `frimousse`. No es de código. Paso 0: `npm install` (sin cambiar `package.json`) |
| `verify-*.mjs` | **Pendientes.** Aprobadas por Wendy para correr ahora, de a una, con el candado `/private/tmp/ssa-verify.lock`. No se corrieron todavía porque el modo plan no permite escribir en la base; son el primer paso al aprobar |

**Medición de la base (solo lectura):**
- 1.220 contactos vivos, 0 borrados, 2 workspaces.
- Con email: **6**. Con email secundario: 0. Direcciones repetidas entre contactos: **0**.
- `do_not_contact`: **0** (por lo tanto 0 con email: no hay nada que listar). `is_subscribed = false`: 0.
- Flujos: **26, todos en borrador**. Por origen: agenda 14 (los 14 con nodo de email), sistema/cobranza 8 (los 8 con email), formularios 1 (sin email), manual 3 (sin email). Secuencias: 1, en borrador, sin pasos de email. Inscripciones: 0.
- `email_log`: 3 filas, todas invitaciones de equipo (2 `failed`, 1 `skipped_not_configured`). Los 403 de `app@wendymardigian.com` son de invitaciones, no de contactos.
- Consecuencia: **hoy ningún flujo ni secuencia está corriendo**, así que ningún cambio de comportamiento afecta envíos reales existentes.

**Migraciones:** última registrada `00269` (`20261028233702`). Ninguna otra rama local tiene una posterior. Primera libre: **`00270`**. Se reconfirma con `list_migrations` antes de escribirla.

## 2. Inventario: caminos que mandan email

Solo hay **tres emisores de bajo nivel**: `sendViaResend` (`lib/email/resend-client.ts:53`, único `fetch` a Resend; ya acepta `headers`, falta `reply_to`), `sendTransactionalEmail` (`lib/email/send.ts:103`, lee `from_email`) y `sendEmailReply` (`lib/email/send-reply.ts:63`, sale desde `channels.email_address`). Los dos últimos son donde va la puerta.

| # | Camino (archivo) | Destinatario | Hoy mira | Categoría asignada |
|---|---|---|---|---|
| A | Nodo "Enviar email" `lib/flow-engine/nodes/send-email.ts:61` | contacto / host / fijo / equipo / variable | `do_not_contact` (con excepción `fromBooking`); el salto no deja rastro; no mira `deleted_at` ni `is_subscribed` | **Marketing** por defecto; **transaccional** en flujos de agenda/formularios/contratos/cobranza |
| B | `sendChannelMessage` rama Resend `lib/flow-engine/send.ts:158→245` (la usan `send-message`, `ai-response`, `send-asset`/`deliverAsset`, secuencias, agente) | email del contacto | `do_not_contact` vía `canReply`; no loguea en `email_log`, solo `messages` | Secuencias: el que diga el paso (default **marketing**). Flujos "Enviar mensaje"/recurso por email: **marketing**. Agente y respuestas en un hilo existente: **transaccional** |
| B4 | `lib/sequences/processor.ts:129,334` | contacto | `do_not_contact`, `deleted_at`, `is_known`, `is_customer` | Según el paso |
| C | Respuesta manual `app/api/v1/messages/route.ts:457→699` | último remitente del hilo (el `select` no trae `email`, así que siempre cae ahí) | `do_not_contact` (409 sin confirmar) | **Transaccional**; aviso en la UI si la dirección está dada de baja/queja |
| D, E | `forms/flows.ts:363`, `scheduling/event-flows.ts:215` | el propio editor (prueba) | n/a | Fuera de la regla (a un usuario del equipo) |
| F | `sales-contract.ts:204` (link de contrato) | contacto | **nada** | **Transaccional** |
| G | `forms/contract/email-run.ts:154` (copia firmada) | firmante + cc + Owners | **nada** | **Transaccional** |
| H, I | `notifications.ts:90`, `team.ts:69` | Owner/Admin, invitados | n/a | Fuera de la regla |

No mandan email: broadcasts (solo DMs por Zernio; son los únicos que filtran `is_subscribed`), tareas/EOD (campana), agente de IA por email (el receptor no agenda turnos), cobranza/MCP/Gmail (no hay emisores propios; todo llega por el nodo A). Eventos de agenda, formularios, ventas, tareas y webhooks llegan a email solo vía A.

## 3. Inventario de `contacts.is_subscribed` (no cambia)

- **Escribe:** palabras clave globales (`lib/inbound.ts:579/583`), nodos `subscribe`/`unsubscribe` (`lib/flow-engine/nodes/subscription.ts`), `apply_opt_out_check` (`00027`, lo apaga junto con `do_not_contact`).
- **Lee:** broadcasts (`.eq("is_subscribed", true)`), `GET /api/v1/contacts?subscribed=`, cron de inactividad, condición de flujo "Está suscripto" (`condition-fields.ts:82`, resolver, simulador, fixtures), segmentos (`segment-builder.tsx`), badge del panel de bandeja.
- **Confirmación:** ninguno de esos puntos se modifica. Solo cambia la etiqueta visible a "Recibe difusiones por chat". Quedan tests de caracterización antes de tocar.
- Dato clave: `merge_contacts` hoy **no** resuelve `do_not_contact` ni `is_subscribed` (el principal conserva el suyo).

## 4. Resend hoy y decisión para E4

- Webhook actual: `app/api/webhooks/resend-inbound/route.ts`, solo `email.received`. Firma Svix a mano (`lib/email/svix.ts`), secreto **por workspace** en Vault (`resend_inbound_webhook_secret`). El workspace se resuelve por la dirección de destino **antes** de verificar la firma. Idempotencia con `claimWebhookEvent("resend:"+svixId)`, respuesta inmediata y `after()`.
- **Decisión: extender la misma ruta, mismo secreto.** En el panel de Resend, un mismo webhook puede suscribirse a `email.received` + `email.bounced` + `email.complained`; no hace falta secreto nuevo (cumple "sin secretos nuevos").
- Resolución del workspace para rebote/queja (no hay dirección de canal en el evento): (1) por `data.email_id` contra `email_log.provider_message_id` / `messages.email_message_id`; (2) por el remitente `data.from` contra `integration_configs` (`from_email`/`marketing_from_email`) y `channels.email_address`; (3) si falta, se prueba la firma con el secreto de cada workspace para atribuirlo; si ninguna coincide, 401. Si el evento es válido pero no ubica la dirección en ningún contacto, se anota y se ignora (200).
- Rebote: `bounced` solo si `data.bounce.type` es permanente (se confirma el nombre exacto del campo contra la documentación de Resend al implementar); temporal se anota, no cambia estado.
- Para que el paso (1) funcione, **los emails que salen por el camino B hoy no guardan el id de Resend**: se va a escribir una fila en `email_log` para esos envíos (con `provider_message_id` y `contact_id`).

## 5. Diferencias entre lo pedido y el código real

1. **Las secuencias no tienen "pasos de email".** Los pasos son `message | delay | aiMessage | asset` y salen por el canal de la inscripción (`channel_id`). Un paso es "de email" cuando el canal de la inscripción es de proveedor Resend. Una inscripción tiene un solo canal, así que "una secuencia que mezcla chat y email" no existe: la pausa por baja aplica a inscripciones activas **sobre un canal de email** con algún paso pendiente de marketing. La categoría se guarda **por paso en el jsonb** `sequences.steps` (`emailCategory`, default marketing), sin migración. El editor de secuencias lo muestra solo si el canal es de email.
2. **No hay filtro de `do_not_contact` ni de `is_subscribed` en la lista de contactos.** El filtro "Estado de email" es nuevo; no hay uno previo que reemplazar. Los segmentos solo los usan los broadcasts: se suma la regla `email_status` al constructor.
3. **El historial de la ficha** ya carga `audit_log` con `entity_type='contact'`; hay que sumar `email_status` a las etiquetas de acción y de campo (`history-section.tsx`).
4. **El salto por `do_not_contact` en el nodo A hoy no deja rastro** (`console.warn`). Pasa a registrarse (ver sección 8).
5. **Camino C:** el `select` no trae el email del contacto, así que hoy siempre responde al último remitente. La puerta chequea esa dirección real. Se arregla el `select` solo si no cambia a quién se manda.
6. **Categoría de flujos existentes sin migración de datos:** el nodo guarda `category`; si falta, el valor por defecto en tiempo de ejecución es **transaccional si el flujo es de agenda/formularios/sistema** (por `flowOrigin`: `event_type_id`, `form_id`, `template_key`) y **marketing si es manual**. Los 22 flujos con email actuales son todos de agenda/sistema → transaccionales. Las plantillas nuevas lo guardan explícito.
7. **Rama `variable`/dirección fija del nodo A:** hoy chequea `do_not_contact` incluso si el destinatario es el host o el equipo. Pasa a valer solo si la dirección coincide con un contacto.
8. **Fusión:** se redefine `merge_contacts` (copia de la `00247`, más la regla del peor estado).
9. **Índice:** el único existente (`uq_contacts_workspace_email`) excluye borrados y no cubre `secondary_email`; se crea un índice nuevo **no único** que incluye borrados y ambas columnas.
10. **El token de baja viaja en la fila de `contacts`.** No se oculta por columna (hay `select("*")` sobre `contacts` por toda la app y un REVOKE lo rompería). El token solo permite darse de baja, no leer nada.
11. **Resend `testConnection` no prueba la key** (cae al `default`). El listado de dominios es la primera llamada real a la API; no se cambia "Probar y guardar" más allá de lo de E8.

## 6. Plan por requisito (orden de construcción)

Paso 0: `npm install`, correr las `verify-*` de línea base, tests de caracterización (envíos A/B/C/F/G, importador, fusión).

### E1 · Modelo y función central — `00270` + `00271`
- **`00270` (M1, aditiva):** `contacts.email_status` (CHECK 4 valores, NOT NULL default `subscribed`), `email_status_at`, `email_status_source`, `email_subscribed_at`, `email_unsubscribe_token uuid unique default gen_random_uuid()`; `workspaces.email_footer_address` (text, CHECK de largo); índice no único sobre `(workspace_id, normalize_email(email))` y sobre `secondary_email`, incluyendo borrados; backfill (`email_subscribed_at = created_at`, source `backfill`, sin `audit_log`). Grants de columnas no cambian (no hay tabla nueva).
- **`00271` (M2):** `email_address_status`, `set_email_status`, `set_email_status_by_address`, trigger de herencia al insertar/cambiar email o secundario, redefinición de `merge_contacts`, y un trigger-guardia `contacts_email_status_guard` (mismo patrón que `contacts_status_guard`): rechaza escrituras directas a las 5 columnas salvo desde las funciones centrales y la fusión (bandera `app.email_status_internal`). **Esto es un agregado mío**, más fuerte que el test de frontera.
- `set_email_status`: `SECURITY DEFINER`, `search_path=''`, `EXECUTE` solo `service_role`, `pg_advisory_xact_lock` por (workspace, dirección), tabla de transiciones por modo, idempotente, devuelve `{status, previous_status, changed, kept_existing}`, `occurred_at` nunca futuro. Pausa las inscripciones activas afectadas (ver E2) en la misma transacción y deja el conteo en `audit_log`.
- TypeScript: `lib/email/subscription.ts` (normalización, gravedad, transiciones, mapeo de importación, `canSendEmailTo`, wrappers de las RPC). `lib/email/subscription-single-entry.test.ts`. Fusión: columnas nuevas en `lib/contacts/merge.ts` y `findMergeDrift`.

### E2 · Puerta de envío y secuencias — `00272` (M3)
- **`00272`:** amplía el CHECK de `email_log.status` con `skipped_unsubscribed`, `skipped_bounced`, `skipped_complained`, `skipped_do_not_contact`; tipo `EmailLogStatus` y los 4 lugares que hardcodean los estados (`history.ts`, `readiness.ts`, conteo de cuota en el nodo A, `database.ts`).
- `canSendEmailTo` en `sendTransactionalEmail` (con `contactId` o dirección que coincide con un contacto) y en `sendEmailReply`. Parámetro `category` obligatorio. Contratos (F, G): solo frena `bounced` (decidido con Wendy), no `do_not_contact`.
- Nodo A: campo "Tipo de email" (`SendEmailPanel.tsx`, `step-card.tsx`), default marketing; salto con `email_log` + `node_skipped` + `onStepSkipped`, sin fallar el flujo. Camino B escribe `email_log` (necesario para E4). Procesador de secuencias: respaldo con `canSendEmailTo` antes de cada paso de marketing; pausa con motivo legible. `resumeEnrollment` ya existe: se agrega la regla "si la dirección sigue sin poder recibir marketing, avisa y no reanuda". Pausas por email distinguidas de `opt_out` (motivos `email_unsubscribed`, `email_bounced`, `email_complained`) y filtro en la pantalla de la secuencia (hoy no hay filtros). Cancelar jobs de marketing pendientes de esa dirección al darse de baja.
- Condición de flujo "Estado de email" en `condition-fields`, resolver, simulador y fixtures; filtro en contactos y segmentos.

### E3 · Link de baja, un clic y página pública
- `lib/email/unsubscribe.ts`: pie (HTML y texto) con `resolveBrand(workspace)` + `email_footer_address`; headers `List-Unsubscribe` / `List-Unsubscribe-Post`; `reply_to` en `ResendMessage`; variable `{{unsubscribe_url}}` (se resuelve **antes** de `sanitizeEmailHtml` y el pie va **después** de `finalizeEmailHtml`, porque el sanitizador descarta `style`). Chip en los 4 editores de variables. Sin duplicar el pie si la plantilla ya usa la variable. Transaccionales sin pie ni headers.
- `POST /api/email/baja/[token]` (ya cubierto por la excepción de `/api/*` en el middleware) y `/baja/[token]` (agregar `baja` a `RESERVED_ROUTES`; el middleware solo protege `/dashboard`). Rate limit con `checkLimit` + `hashIp` + `clientIp`, como `/l`. GET no cambia nada; dirección enmascarada; sin datos del contacto.

### E4 · Rebotes y quejas
Extiende `resend-inbound/route.ts` según la sección 4. Idempotencia por `resend:<svix-id>`, `after()`, modo `system`, source `resend_bounce`/`resend_complaint`. Tests: firma inválida, duplicado, hard vs soft, queja, workspace no ubicado. PENDIENTE: pasos exactos en el panel de Resend (activar los dos eventos en el mismo webhook).

### E5 · Panel
Badge + botón en la ficha (modo `admin`, motivo obligatorio para sacar rebote/queja, ambos estados si hay secundario distinto), entradas en el historial con actor legible, filtro y columna opcional en la lista. Permiso: `contacts.edit` (mismo que `setDoNotContact`; el server action nuevo es `setEmailStatus`). Campo de dirección postal en Ajustes → General → Marca (`settings.general`, `updateWorkspaceBrand` / `parseBrandSettings`).

### E6 · Importador
- `lib/csv/map.ts`: 4 campos nuevos con sugerencia automática; parseo de valores (sin acentos/mayúsculas); error de fila para valor vacío/desconocido. Consolidación **antes** de partir en tandas de 200 (gana el estado más grave, fecha de esa fila, `subscribed_at` más antiguo). Opción "Origen de la importación" (va al `source` y como tag `origen:<valor>`).
- `lib/actions/csv-import.ts`: `planImport` puro y compartido; `previewBatch` (solo lectura, usa `findContact` en `find_only`) vs `importBatch` (misma lógica, escribe). UI: botón "Revisar antes de importar" con los conteos pedidos y reporte final con los mismos. Nunca re-suscribe: usa `set_email_status` en modo `system` con la fecha original.
- **No disparar flujos:** los eventos salen de triggers de la base (verificado: la importación hoy **sí** emite `contact_created`, `tag_added`, `field_changed`, `assignment_changed`). Decidido con Wendy: al terminar cada tanda se marcan como procesados los eventos de esos contactos. Se anota en PENDIENTE la ventana de unos segundos por tanda y que, antes de importar con flujos activos, hay que cerrarla (transacción por tanda o chequeo de importación en los triggers). Test que lo cubre.
- Fixture `scripts/fixtures/import-wendymardigian-sample.csv` con los 11 casos pedidos.

### E7 · Verificación
`scripts/verify-email-subscription.mjs` (transiciones por modo, 10 llamadas paralelas, `email_address_status` con secundario/borrado/fusión, token un clic vs GET, ninguna función escribe las columnas salvo las centrales). Tests Vitest de `canSendEmailTo` por camino con espías, pie/headers, webhook, importador (conteos exactos) y que importar no dispara flujos.

### E8 · Remitentes
Dos remitentes (importante / marketing opcional) + "Responder a" en la card de Resend. Componente propio (el `CredentialsForm` genérico no sirve) con usuario + desplegable de dominios verificados desde `GET /domains` (acción de servidor con `createServiceClient` + `readSecret`, permiso `integrations.manage`, cache en memoria de unos minutos, botón "Actualizar"). Key sin permiso/API caída → aviso y campo de texto. Guarda `from_local`, `from_domain`, `from_email` compuesto (compatibilidad con `send.ts`, `readiness.ts`, `load.ts`) y los de marketing. Si el dominio actual no está verificado, aviso en rojo sin cambiarlo solo. Elección de remitente por categoría en `sendTransactionalEmail` y `sendEmailReply`. `readiness.ts` avisa antes del fallo usando la lista. La dirección de entrada (`inbound_address`) la dejo en PENDIENTE (vive en otro proveedor y otro permiso).

## 7. Migraciones

| Nº | Contenido | Aplicación |
|---|---|---|
| `00270` | columnas, índice, backfill (aditiva) | ANTES de desplegar el código |
| `00271` | funciones, trigger de herencia, guardia, `merge_contacts` | ANTES del código; la fusión se verifica con `verify-contact-merge` |
| `00272` | CHECK de `email_log.status` | ANTES del código |

Cada una idempotente, con "Cómo volver atrás" (la `00271` lleva completa la definición vieja de `merge_contacts`). Se aplican con `supabase db query --linked -f` desde la carpeta vinculada y se registran en `schema_migrations`; después `node scripts/build-all-migrations.mjs` y regenerar `lib/types/database.ts`.

**Autorización de Wendy (ajuste 1):** aplico `00270`, `00271` y `00272` en producción **sin pedir OK cada vez**, siempre que la verificación de cada una pase (el respaldo ya está hecho). Orden estricto: aplicar → registrar → verificar → recién entonces la siguiente. **Si una verificación falla, PARO**, lo anoto en `docs/PENDIENTE-suscripcion-email.md` (qué falló y cómo volver atrás) y no sigo. Esta autorización cubre solo esas tres migraciones; cualquier otra pide OK.

## 8. Cambios de comportamiento visibles

1. Un email de marketing a una dirección dada de baja/rebotada/con queja se saltea y queda anotado (antes se mandaba).
2. Un rebotado no recibe nada, ni transaccional (incluye contratos).
3. Los emails de marketing llevan pie de baja y los headers; los transaccionales siguen iguales.
4. El salto por "no contactar" del nodo A ahora deja `email_log` y `node_skipped` (antes, solo un `console.warn`).
5. La baja pausa inscripciones activas de secuencias de email al instante y no se reanudan solas.
6. Nodo "Enviar email" con destinatario host/fijo/equipo ya no se frena por el `do_not_contact` del contacto del flujo.
7. Camino B: los emails de flujos/secuencias pasan a registrarse también en `email_log`.
8. La importación deja de disparar flujos de "contacto nuevo".
9. "Está suscripto" pasa a llamarse "Recibe difusiones por chat" (misma lógica).
10. Contratos: link y copia firmada ahora se frenan solo por rebote.
11. Hoy no cambia el comportamiento de ningún envío real: todos los flujos y secuencias están en borrador.

## 9. Riesgos y vuelta atrás

- **Riesgo mayor:** el trigger de herencia en `contacts` (insert/update de email) corre en cada alta; va dentro de `EXCEPTION WHEN OTHERS` para no tumbar un alta. Es la pieza más delicada junto con la fusión.
- **Si el trigger de herencia falla, nunca en silencio (ajuste 3):** el bloque de excepción hace `RAISE WARNING` (queda en los logs de Postgres) **y** escribe una entrada en `audit_log` (`entity_type='contact'`, `action='email_status_inherit_failed'`, `metadata = { address, error, sqlstate }`, `performed_by` null); esa escritura va en un sub-bloque propio para que, si también falla, el alta igual no se caiga (queda el `RAISE WARNING`). Test que fuerza el error y comprueba las dos huellas. `verify-email-subscription` cuenta esas entradas: debe haber 0 en una corrida normal, y las que haya se anotan en PENDIENTE.
- **La puerta de envío NO depende de ese trigger (confirmado):** `canSendEmailTo` llama a `email_address_status(workspace, dirección)` **en el momento de enviar**, que calcula el peor estado entre **todos** los contactos del workspace que tienen esa dirección (email o secundario, vivos y borrados). No lee la columna cacheada del contacto como única fuente. El trigger solo copia ese estado a la fila de un contacto nuevo o con email cambiado, para que la ficha, los filtros y el historial lo muestren coherente. Si el trigger fallara, el envío igual se frena. `verify-email-subscription` lo prueba: deja un contacto sin heredar (trigger deshabilitado en la transacción de prueba) y comprueba que `canSendEmailTo` bloquea de todos modos.
- **Ventana del importador** (anotada en PENDIENTE).
- **Cuota de Resend / 403:** el dominio `app@wendymardigian.com` sigue sin verificar hasta que se elija otro en E8; no lo cambio solo.
- **Atrás:** cada migración tiene su reversa en la cabecera; las columnas nuevas no las lee ningún código viejo, y el código nuevo se puede revertir sin tocar la base. `is_subscribed`, `do_not_contact` y broadcasts no se modifican.

## 10. Primeras tareas al aprobar (y después FRENO)

1. `npm install` (restaura 4 paquetes), correr las `verify-*` de línea base de a una y con candado, registrar resultados. **Ajuste 2:** nunca commiteo cambios en `package.json` ni en `package-lock.json`. Antes de cada commit reviso `git status`; si el lock cambió lo dejo fuera (`git restore` solo de ese archivo en el área de preparación, no pierdo nada) y lo anoto en PENDIENTE.
2. Crear `docs/PROGRESS-suscripcion-email.md` con este plan tal cual (incluidos los cuatro ajustes), E1–E8 como checklist, "Punto de partida" y "Migraciones" (`00270`–`00272`).
3. Crear `docs/PENDIENTE-suscripcion-email.md` (qué quedó / por qué / qué se decidió), con: ventana del importador, `inbound_address` sin selector, pasos de Resend, dominio sin verificar, paquetes faltantes del worktree y el estado de `package-lock.json` tras `npm install`.
4. Commit `docs: plan de suscripcion a emails` y `git push origin feat/suscripcion-email`.
5. **Frenar y esperar tu `/goal`.**

**Cierre de la ejecución completa (ajuste 4):** al terminar E1–E8, sección nueva en `CLAUDE.md` ("Emails: suscripción y baja") y `docs/importar-contactos-con-suscripcion.md`, y después **PR de `feat/suscripcion-email` a `main` con `gh pr create`**, con el resumen de PROGRESS y PENDIENTE en la descripción. **No se mergea.**

## Verificación end-to-end (al ejecutar)

`npx vitest run` (sin empeorar la línea base), `npm run build`, `npm run lint`, `verify-email-subscription`, `verify-contact-merge`, `verify-contacts-single-entry`, `verify-csv-import`, `verify-optout`, `verify-rls --despues-de-00143`; prueba manual de `/baja/[token]` (GET sin efecto, POST de un clic) y de la prueba en seco con el CSV de muestra. Ningún email real: Resend simulado.

# Webhooks entrantes, atribución y anuncios (Extra L) — avance

Rama `feat/atribucion-webhooks` (12/10/2026). Plano: `claude/v9/requerimientos-atribucion-webhooks.md`.
Pendientes y decisiones: [PENDIENTE-atribucion.md](PENDIENTE-atribucion.md).

> Este archivo es lo que sigue la construcción, aunque la conversación se resuma: releerlo al empezar
> cada bloque. Donde el plano y el código no coinciden gana el código (sección "Diferencias").

## Checklist por bloque

### WH1 — Receptor e historial
- [x] F1 Tablas `webhook_endpoints` e `inbound_webhooks` (M1)
- [x] F2 Receptor `POST /api/hooks/[token]`
- [x] F3 Pantalla de endpoints
- [x] F4 Historial y detalle de un envío
- [x] F5 Escuchar el próximo envío, pegar un ejemplo, usar uno del historial
- [x] F6 Reprocesar
- [x] F7 Retención y limpieza
- [x] F8 Aviso de errores y secreto opcional (nice-to-have)

### WH2 — Disparador, variables y paso de contacto
- [x] F9 Disparador "Webhook recibido" (M2)
- [x] F10 Flujos sin contacto (reutilizando `subject`/`needsContact`/`member-flow.ts`)
- [x] F11 Variables del webhook y selector
- [x] F12 Paso "Crear o actualizar contacto": búsqueda y escritura
- [x] F13 El mapeo (lógica y pantalla)
- [x] F14 Atribución del webhook y el toque (M3)
- [x] F15 Resultado en el historial y cierre del procesamiento

### AT1 — Que no se pierda nada
- [x] F16 La agenda acepta todas las claves y usa la cookie
- [x] F17 `create_booking` pasa todo al toque (M5)
- [x] F18 El formulario no inventa `utm_content`
- [x] F19 Chat: mención en historia, anuncio y comentario en anuncio (M4)
- [ ] F20 Respaldo desde la conversación de Zernio (nice-to-have) — NO se hizo: anotada en PENDIENTE-atribucion.md
- [x] F21 La atribución legible en la ficha del contacto

### AT2 — Catálogo de Meta
- [x] F22 Tablas del catálogo (M6)
- [x] F23 Sync de entidades y estado (incluye «Sincronizar ahora»)
- [x] F24 Miniaturas propias
- [x] F25 Enlace con Contenido (automático; el manual queda en PENDIENTE)

### AT3 — Vínculo de cada toque con su campaña, conjunto y anuncio
- [ ] F26 `resolve_meta_match` y el trigger (M7)
- [ ] F27 `contact_touch_json` y la atribución del contacto
- [ ] F28 Re-vincular después de cada sync, y el backfill (M8)
- [ ] F29 "Sin vincular"

### AT4 — Tabla Meta vs CRM
- [ ] F30 Función `ads_crm_metrics` (M9)
- [ ] F31 La tabla en el dashboard de Ads
- [ ] F32 Permiso de la pantalla
- [ ] F33 Exportar CSV y abrir la lista (nice-to-have)

#### Notas de WH1 (hecho)

- M1 aplicada dos veces sin error (idempotente), registrada, y `verify-inbound-webhooks.mjs` + `verify-rls.mjs` en verde.
- Receptor probado de punta a punta con la app local (`verify-inbound-webhooks.mjs` con la app en `localhost:3000`):
  404/200/duplicado/413/JSON roto/pausado/escucha/secreto, y el `after()` deja el envío en `processed`.
- Código: `lib/webhooks/{paths,receive,read-body,server-ports,process,reaper,sweep,result,run-flows,endpoints,listen,retention,alerts,diff,history-view,payload-tree,queries}.ts`,
  `app/api/hooks/[token]/route.ts`, `lib/actions/webhook-endpoints.ts`, `components/webhooks/*`, páginas
  `integrations/webhooks` y `integrations/webhooks/[endpointId]`, tarjeta en Integraciones, `requireAnyPermission`.
- El reaper cuelga de `/api/cron/jobs` y la retención de `/api/cron/content-media-cleanup` (diario).
- Aviso de errores (`webhook_errors`) a quien creó el endpoint y a Owner/Admin.
- Revisión visual hecha con la sesión ya abierta en la app local: 1440 px oscuro (estado vacío, hoja de
  creación, detalle, historial y cajón del envío), 390 px oscuro y claro (sin scroll horizontal de la página).
  Se creó un endpoint `zz-test visual` para verlo y se borró del todo al terminar.

#### Notas de WH2 (hecho)

- M2 y M3 aplicadas dos veces sin error, registradas y verificadas. Consulta de control de M2: 0 sesiones sin
  contacto/persona/envío, CHECK de 3 vías, 32 tipos de disparador; huellas de `record_contact_touch` y
  `find_contact_for_form` iguales; `verify-eod`, `verify-rls` y `verify-inbound-webhooks` en verde.
- **Motor:** `FlowExecutionContext` suma `inboundWebhookId`, `onStepSkipped` y `onContactStep`; la sesión se crea con
  `inbound_webhook_id`; el motor ya salteaba los pasos con `needsContact` sin contacto y ahora además avisa cuál
  (para el historial). `contact-requirement.ts` hace el análisis «en todos los caminos» (con ciclos); la regla
  frena la **publicación** (la ruta `publish`), no el guardado a medias; EOD y los flujos con contacto no cambian.
- **Registro:** `webhook_received` (sujeto `webhook`, sin `eventTypes`: el cron nunca lo levanta), campo de
  condición `webhook.*`, nodo `upsert_contact`, variables `contact_result` y `contact_fail_reason`.
- **Código:** `lib/webhooks/{trigger-config,run-flows,mapping,attribution,upsert-config,upsert-contact,payload-tree}.ts`,
  `lib/flow-engine/{contact-requirement,nodes/upsert-contact,registry/webhook-triggers}.ts`,
  `lib/actions/webhook-flow-editor.ts`, `components/flow-builder/panels/{WebhookTriggerPanel,UpsertContactPanel}.tsx`,
  `components/flow-builder/nodes/upsert-contact-node.tsx`.
- **Tests nuevos:** mapeo (24), atribución (17), núcleo del paso (23), integración del disparo con el motor real (13),
  análisis por camino (19), publicar (4), migraciones, retención. Se ajustaron sumando el nuevo (no aflojando):
  `consistency.test.ts`, `registry.test.ts` (28 → 29 nodos), `triggers-characterization.test.ts` (+1),
  `crm-triggers.test.ts` (+1), `taxonomy.test.ts` (+`webhook`).
- **`verify-inbound-webhooks.mjs`** corre de punta a punta con la app local: un flujo real crea el contacto, anota
  el toque `webhook`, no duplica con otro envío de la misma persona, respeta «solo completar lo vacío» y sale por
  «No se pudo» sin identificador. `verify-attribution.mjs` suma los casos de `origin = webhook`.
- Revisión visual hecha con la sesión abierta (1440 px, oscuro): el nodo con sus dos salidas, la paleta, el panel
  del disparador (selector, URL, ejemplo) y el panel del paso (sugerir campos, atribución detectada, «Probar con el
  ejemplo»). Datos de prueba `zz-test` borrados al terminar.

### Cierre
- [ ] `docs/webhooks.md`, `docs/atribucion.md`, `docs/flow-registry.md`, `docs/dashboards.md`
- [ ] Sección "Webhooks, atribución y anuncios" en `CLAUDE.md`
- [ ] Verificación final, revisión visual, PR

## Punto de partida
Medido el 12/10/2026, antes de tocar nada. Base: proyecto `knrxjnmxnmjavivyuwew`, última migración
aplicada y registrada **00185** (`00185_eod_reminder_cron`); archivos locales hasta la 00185; **primera libre: 00186**.

| Chequeo | Resultado |
|---|---|
| `npx vitest run` | 739 archivos, **9289 tests, todo verde** |
| `npm run lint` | **0 errores, 36 avisos** (los avisos no pueden crecer) |
| `npm run build` | compila (exit 0); `public/embed/embed.js` no cambió |
| `verify-rls` (`--despues-de-00143 --despues-de-00136 --despues-de-00147`) | verde |
| `verify-roles` (`--despues-de-00136`) | verde |
| `verify-workspace-isolation` (`--despues-de-00143`) | verde |
| `verify-audit-visibility` (`--despues-de-00168 --despues-de-00147`) | verde |
| `verify-crm`, `verify-scheduling`, `verify-booking-concurrency`, `verify-forms`, `verify-eod`, `verify-dashboards` | verdes |
| `verify-calls`, `verify-chat-media`, `verify-content`, `verify-csv-import`, `verify-enrichment`, `verify-inbox-filters`, `verify-optout`, `verify-publishing` | verdes |
| `verify-message-persistence` | exit 0 ("No hay un canal de Zernio en este workspace. No hay nada que verificar") |
| **`verify-attribution`** | **ya falla**: 1 caso de datos, "todos los contactos reales tienen first_touch" (775 de 834). Es del backfill de la 00115 (los contactos nuevos no tienen toque); lo anotó Formularios. No es de este módulo y no puede empeorar. |
| **`verify-sales`** | **ya falla**: 1 caso, "con todas las reglas en manual, crear un contacto NO encola nada" (00161). No es de este módulo y no puede empeorar. |
| `verify-knowledge` | no se corre: llama a Voyage de verdad (con costo) |
| `verify-webhook` | no se corre: necesita la app corriendo en local |

Datos de la base: 783 toques (773 dm, 6 comment, 4 booking), **0 con datos de anuncio**; 1 cuenta de Meta con
1055 filas de métricas; 0 sesiones de flujo sin contacto; `triggers.type` con 31 valores.

Huellas (md5 de `pg_get_functiondef`) que **no pueden cambiar**:

| Función | md5 |
|---|---|
| `record_contact_touch` | `f364db1862cc0f90291ca14ef855a214` |
| `find_or_link_contact` | `861440d10e8519b67606d78c53ca663b` |
| `find_contact_for_form` | `b5238c113b5a69192d8735ddb04355aa` |
| `submit_form_response` | `9d94bf451c21443911d74972bfa399ee` |

`create_booking` cambia a propósito en M5: hoy `b81db84edb30ee7853efa2d42385593a` (solo la compara
`scripts/verify-forms.impl.ts`). `contact_touch_json` cambia en M7: hoy `a77bf4dbcc46766f93248bca1f03029e`.

Tests de caracterización agregados antes de tocar código (todos verdes):
`lib/flow-engine/engine-contact-characterization.test.ts` (flujo con contacto, flujo de persona del equipo con
paso salteado, `memberFlowProblems`), `lib/attribution-webhooks-characterization.test.ts` (`formTouch`,
`readAttribution`, `pickUtm`, `groupByObject`). El orden "mensaje, después toque" y que un fallo del toque no
frene el webhook ya estaban cubiertos en `app/api/webhooks/{late,evolution}/route.test.ts`.

## Migraciones

| M | Número real | Qué | Bloque | Estado |
|---|---|---|---|---|
| M1 | `00186_webhook_endpoints` | `webhook_endpoints` + `inbound_webhooks`, RLS, GRANT por columna | WH1 | **aplicada y registrada** (`20261013050050`), verificada |
| M2 | `00187_webhook_sessions` | `flow_sessions.inbound_webhook_id` + CHECK recreado; `triggers.type` 31 + `webhook_received` | WH2 | **aplicada y registrada** (`20261013052548`), verificada |
| M3 | `00188_touch_origin_webhook` | CHECK de `contact_touches.origin` + `webhook` | WH2 | **aplicada y registrada** (`20261013053503`), verificada |
| M4 | `00189_messages_origin_context` | `messages.origin_context jsonb` | AT1 | **aplicada y registrada** (`20261013061922`), verificada |
| M5 | `00190_create_booking_ad_ids` | `create_booking` pasa ad/adset/campaign y extras al toque | AT1 | **aplicada y registrada** (`20261013062612`), verificada |
| M6 | `00191_meta_catalog` | catálogo de Meta, `meta_name_key`, bucket `ad-creatives` | AT2 | **aplicada y registrada** (`20261013064536`), verificada |
| M7 | `00192_meta_touch_match` | vínculo con Meta (columnas, funciones, trigger) | AT3 | pendiente |
| M8 | `00193_meta_touch_backfill` | backfill del vínculo | AT3 | pendiente |
| M9 | `00194_ads_crm_metrics` | `ads_crm_metrics` + índices | AT4 | pendiente |

En el plano figuraban como 00178–00186; la base ya tenía hasta la 00185 (EOD). Donde el plano dice
"00179", "00182", etc., leer "M2", "M5"… Confirmar con `list_migrations` antes de escribir cada una.

---

# Plan completo (tal cual se presentó y aprobó)

## Plan — Extra L: webhooks entrantes, atribución completa y anuncios de Meta

Plano: `claude/v9/requerimientos-atribucion-webhooks.md` (v1.0). Contexto: `claude/v9/alcance-v9.md`.
Donde el plano y el código no coinciden, gana el código (lista completa en "Diferencias"). Donde el
prompt de arranque corrige al plano, gana el prompt.

### Contexto

Hoy cada lead que llega desde un anuncio pierde el dato de qué campaña, conjunto y anuncio lo trajo
(la agenda solo guarda 5 UTMs, el chat tira la mención en historia y el comentario en anuncio, y nada
vincula un toque con el catálogo de Meta). Además, los formularios externos (Typeform, Tally, Framer…)
no tienen por dónde entrar. Este cambio suma:
- **L1:** un receptor de webhooks por URL con historial, un disparador "Webhook recibido" y un paso
  "Crear o actualizar contacto" (flujos que arrancan sin contacto).
- **L2:** que ningún punto de contacto pierda la atribución, el catálogo de Meta, el vínculo automático
  de cada toque con su anuncio y la tabla "Meta vs CRM" en el dashboard de Ads.

### Primeras tareas de la ejecución (antes de WH1)

1. `git checkout -b feat/atribucion-webhooks` (la rama **no existe**: hoy estoy en `main`, limpio).
2. Punto de partida que no pude correr en modo plan (escriben archivos o la base): `npm run build`
   (ojo: regenera `public/embed/embed.js`; si cambia, se descarta con `git checkout --` y se anota) y
   cada `scripts/verify-*.mjs` de a uno. Se anota cómo está cada uno; lo que ya falla no puede empeorar.
   No se corren: `verify-knowledge.mjs` (llama a Voyage de verdad) ni `verify-webhook.mjs` (necesita la
   app local); se anota, igual que hizo Formularios.
3. Crear `docs/PROGRESS-atribucion.md` con este plan tal cual, los bloques con sus F como checklist,
   "Punto de partida" y "Migraciones" (tabla M → número real).
4. Crear `docs/PENDIENTE-atribucion.md` (formato: qué quedó, por qué, qué se decidió).
5. Commit `docs: plan de webhooks, atribucion y anuncios` + `git push origin feat/atribucion-webhooks`.
6. **FRENAR y esperar el `/goal`.** No empezar WH1.

### Punto de partida (medido el 12/10/2026, solo lectura)

- `npx vitest run`: **739 archivos, 9289 tests, todo verde**.
- `npm run lint`: **0 errores, 36 avisos** (los avisos no pueden crecer).
- `npm run build` y `verify-*`: se corren en el paso 2 de arriba.
- Base (proyecto `knrxjnmxnmjavivyuwew`): última migración **00185** (`00185_eod_reminder_cron`,
  registrada). Archivos locales hasta `00185`. **Primera libre: 00186.**
- 783 toques (773 dm, 6 comment, 4 booking), **0 con datos de anuncio**. 1 cuenta de Meta, 1055 filas
  de métricas. 0 sesiones de flujo sin contacto.
- Huellas vigentes (md5 de `pg_get_functiondef`):
  `record_contact_touch f364db18…`, `find_or_link_contact 861440d1…`, `find_contact_for_form b5238c11…`,
  `submit_form_response 9d94bf45…`, `create_booking b81db84e…`, `contact_touch_json a77bf4db…`.
- Formularios dejó anotado que `verify-attribution.mjs` ya fallaba un caso de datos ("todos los
  contactos reales tienen first_touch"). Se confirma en el paso 2.

### Migraciones (M → número real)

| M | Número real | Qué | Bloque | Riesgo |
|---|---|---|---|---|
| M1 | `00186_webhook_endpoints` | `webhook_endpoints` + `inbound_webhooks`, índices, RLS, GRANT por columna | WH1 | Bajo |
| M2 | `00187_webhook_sessions` | `flow_sessions.inbound_webhook_id` + recrea `flow_sessions_contact_or_member`; CHECK de `triggers.type` = 31 vivos + `webhook_received` | WH2 | Alto |
| M3 | `00188_touch_origin_webhook` | CHECK de `contact_touches.origin` + `webhook` | WH2 | Bajo |
| M4 | `00189_messages_origin_context` | `messages.origin_context jsonb` | AT1 | Bajo |
| M5 | `00190_create_booking_ad_ids` | `create_booking` pasa ad/adset/campaign y extras al toque | AT1 | Alto |
| M6 | `00191_meta_catalog` | `meta_campaigns/adsets/ads`, `meta_name_key`, bucket `ad-creatives`, política ADICIONAL de lectura en `meta_ads_insights_daily` | AT2 | Bajo |
| M7 | `00192_meta_touch_match` | columnas `meta_*`, `resolve_meta_match`, trigger BEFORE INSERT, `contact_touch_json`, `refresh_contact_attribution`, `rematch_meta_touches` | AT3 | Alto |
| M8 | `00193_meta_touch_backfill` | corre `rematch_meta_touches` con `-infinity` | AT3 | Medio |
| M9 | `00194_ads_crm_metrics` | `ads_crm_metrics` (INVOKER) + índices | AT4 | Bajo |

Se confirma con `list_migrations` y `ls supabase/migrations` antes de escribir cada una. Las nueve son
compatibles con el código viejo.

### Decisiones tomadas con Wendy (12/10/2026)

- **#254 → "solo el último".** Como `record_contact_touch` no se toca, se resuelve en el paso: si el
  contacto **ya existía** y **no tenía ningún toque**, antes del toque del webhook se anota un toque
  ancla `manualTouch` (origen `manual`, fuente `manual`, `dedupe manual:<contactId>`, `occurredAt =
  contacts.created_at`). Resultado: primer toque = "ya existía (manual)", último = webhook, y se mantiene
  aunque lleguen toques nuevos. Un contacto **creado** por el paso recibe el webhook como primero y último.
- **"Asistió"** = `bookings.status_group = 'outcome'` (seguimiento tibio, frío, venta, no calificado).
- **Ventas no canceladas** = excluye `cancelled` y `refunded`.
- **#260** reprocesar vuelve a mandar mensajes, con aviso y confirmación (como el plano).
- **#270, #271**: confirmadas por el arranque de la corrida y el plano.

### Diferencias entre el plano y el código real (gana el código)

1. **Numeración:** M1–M9 = 00186–00194 (no 00178–00186). Rama `feat/atribucion-webhooks` no existe: se crea.
2. **Flujos sin contacto ya existen (EOD, 00182).** `contact_id` ya es nullable, hay `member_user_id` y
   el CHECK `flow_sessions_contact_or_member`. M2 solo suma `inbound_webhook_id` y recrea el CHECK como
   `contact_id IS NOT NULL OR member_user_id IS NOT NULL OR inbound_webhook_id IS NOT NULL` (definición
   vieja leída con `pg_get_constraintdef` en la cabecera). Hoy una sesión sin contacto ni persona **falla
   el insert y `executeFlow` corta en silencio** (`if (!session) return`): M2 va antes del código.
3. **`triggers.type` tiene 31 tipos** (no 30). M2 los lee de la base viva y suma `webhook_received` (32).
4. **No existe `requiresContact`:** se usa `needsContact` (nodos) y `subject` (disparadores). Se suma el
   sujeto `"webhook"` a `TriggerSubject`. `upsert_contact` es `needsContact: false`.
5. **El motor ya saltea** un paso con `needsContact` sin contacto (anota `node_skipped`, sigue por la
   arista por defecto). No se corta la sesión con error (corrección del prompt). El resultado del envío
   dice "paso salteado: no había contacto".
6. **Cambiar de contacto a mitad de sesión no tiene precedente.** El contexto es un objeto mutable que
   pasa por referencia (`traverseNodes`, `goToFlow` lo copia con spread), así que `upsert_contact` escribe
   `context.contactId` y `flow_sessions.contact_id` (el tipo `Update` de `flow_sessions` no tiene
   `contact_id`: se amplía). Un "Esperar" toma el `contactId` del contexto **al momento de esperar**
   (payload del job `resume_flow`): si el paso de contacto va antes, el contacto sobrevive a la espera.
   `findWaitingSession` ya devuelve null sin contacto. `completeSession` lee `session.contact_id` (queda
   bien porque el paso lo actualiza).
7. **`runEmailTriggers` NO usa `trigger_fires`.** El patrón de reclamo a copiar es el de
   `processMemberEvent` (`lib/flow-engine/automation-events.ts`): insert en `trigger_fires` con
   `contact_id null`, `23505` = ya disparó.
8. **La validación de publicar vive en rutas de API** (`app/api/v1/flows/[flowId]/route.ts` y
   `.../publish/route.ts`, vía `checkMemberFlow`), no en una Server Action. La regla nueva entra por
   `member-flow.ts`: para el sujeto `webhook`, un paso con `needsContact` se permite solo si en **todos
   los caminos** desde el disparador lo precede la salida "Listo" de un `upsert_contact`. EOD no cambia.
9. **Selector de variables:** `getFlowVariables` (`NodeConfigSidebar.tsx`) está escrito a mano y no usa
   `variableSchema`. Se extiende ahí con el árbol del `sample_payload`. El catálogo de condiciones sí usa
   `variableSchema` (vía `getConditionCatalogInputs`).
10. **`webhook.*` en condiciones:** el resolvedor se registra en un archivo nuevo
    (`registry/webhook-conditions.ts`, por el registro) **sin tocar** `conditions.ts`, `branch.ts` ni
    `condition-eval.ts`. Un `branch` que lee `contact.*` cuenta como "necesita contacto" en el validador
    (chequeo puro sobre los datos del nodo).
11. **`find_contact_for_form` no tiene ningún llamador en TS** (solo la usa `submit_form_response`). Se
    llama con el cliente de servicio. Formularios **no** anota el conflicto en el historial del contacto:
    lo guarda en `form_submissions.dedupe` y lo muestra con `describeConflicts`. Se reutiliza eso: el
    conflicto va a `inbound_webhooks.result` y a la metadata del `audit_log`, mostrado con `describeConflicts`.
12. **El evento de contacto nuevo lo emite la base** (trigger `contacts_emit_created` al insertar). El
    paso no emite nada a mano: con insertar alcanza (una sola vez).
13. **Teléfonos:** `normalizePhone` / `normalizePhoneWithCountry` (`lib/phone.ts`,
    `lib/scheduling/phone-countries.ts`). El workspace **no tiene país**: se usa
    `countryFromTimezone(workspace.timezone)` como Formularios. En SQL la comparación es exacta y los
    teléfonos guardados están como `+dígitos`, así que el paso normaliza a `+dígitos`.
14. **`content_label` lo leen más lugares** que la ficha: `contact_touch_json` (→ `attribution.content`),
    `sale_attribution_from_touch` (Ventas), `lib/sales/assignment/context.ts` (reglas de asignación por
    `content`), `verify-forms.impl.ts` (afirma `content_label === nombre del formulario`). F18 actualiza esa
    afirmación con un comentario, y antes revisa si alguna regla de asignación real usa `content` con el
    nombre de un formulario (consulta de solo lectura; si hay, se anota y se pregunta).
15. **La huella de `create_booking` solo la compara `verify-forms.impl.ts`** (no `verify-sales`). Se
    actualiza ahí. Además `create_booking` pone siempre `medium = 'booking'`: no se cambia (fuera del plano).
16. **`{{message}}` es un texto**, así que `{{message.ad_id}}` no puede existir sin romperlo. Las variables
    nuevas del mensaje van como `{{message_origin.ad_id}}`, `{{message_origin.ad_title}}` y
    `{{message_origin.is_story_mention}}`. Ningún disparador de mensaje tiene `variablesFor`: se siembran
    en el camino del mensaje (`runInboundAutomation`).
17. **SDK de Zernio 0.2.519:** `isStoryMention` y `comment.ad {id,title,promotionStatus}` existen;
    `referral` trae `ads_context_data {ad_title, post_id, …}`. Los tipos locales del receptor no los tienen.
18. **Permisos en SQL:** `has_permission` devuelve **false para el Member de sistema** (sus claves viven
    solo en TS) y el Member tiene `flows.edit`. Por eso las pantallas de webhooks leen con el **cliente de
    servicio después de chequear en TS** (filtrando por el workspace de la sesión); la RLS con
    `has_permission` queda como segunda barrera. El `token` se oculta con el patrón de GRANT por columna
    (00060 `agents`, 00180 `eod_reports`).
19. **`meta_ads_insights_daily` solo la ve Owner/Admin por RLS** (`is_workspace_admin`). Para que F32 sirva
    a un rol con `dashboards.ads.view`, M6 suma una política **adicional** de SELECT con `has_permission`.
20. **Ads:** `persistInsights` no pide ni escribe estado; `readUsage` existe sin uso; `ads-leads.ts` sin uso
    (se deja). La pantalla usa `requireWorkspaceAdmin` en `ads/page.tsx` y en
    `lib/dashboards/ads-detail-page.ts` (detalle). `unified/page.tsx` queda igual (fuera del plano).
    `member-baseline.test.ts` cuenta 12 páginas de Admin: `ads/page.tsx` pasa a `PERMISSION_PAGES`.
21. **Integraciones** está detrás de `requireWorkspaceAdmin`; la pantalla nueva necesita
    `flows.edit` **o** `integrations.manage` → se suma `requireAnyPermission` en `lib/auth/guards.ts`, con test.
22. **Ventas:** fecha de cierre = `sales.sale_date` (date); montos en **dólares** `numeric(12,2)` →
    centavos con `round(x*100)`; pagos: `paid_on` (fecha local), `amount` (reembolso = fila negativa `paid`).
23. **`unaccent` no está instalada:** `meta_name_key` usa `translate` (como `normalize_for_grouping`, 00076).
24. **Retención:** borrar un `inbound_webhooks` con `ON DELETE SET NULL` en `flow_sessions` dejaría una
    sesión sin contacto ni webhook y **violaría el CHECK**. La limpieza a 12 meses borra antes las sesiones
    terminadas sin contacto de ese envío y nunca borra un envío con una sesión activa.
25. **Embed:** `agenda-url-characterization.test.ts` fija las URLs de la agenda. El `attr` se agrega al
    iframe de la agenda **solo si hay atribución guardada**: con almacenamiento vacío la URL queda igual.
    Al importar `TOUCH_KEYS`, claves como `gbraid` dejan de precargarse como respuesta (cambio menor, se anota).
26. **Período del dashboard:** la página resuelve el período con la zona del usuario; `ads_crm_metrics`
    interpreta las fechas en `workspaces.timezone` (decisión #272). Se pasan fechas civiles.

### Reglas para toda la corrida

- **Migraciones:** cada una en su bloque, antes del código que la usa. Aplicar con
  `supabase db query --linked -f <archivo>` y registrar con `INSERT` en
  `supabase_migrations.schema_migrations` (versión = timestamp UTC, `statements` = el SQL). Después:
  su verificación y `node scripts/build-all-migrations.mjs`. Si falla una verificación: **PARAR**, anotar en
  `PENDIENTE-atribucion.md` qué falló y cómo volver atrás, y no seguir con el bloque siguiente.
- M2, M5 y M7 copian en su cabecera la definición vieja completa (`pg_get_constraintdef` /
  `pg_get_functiondef` de la base viva, no de archivos viejos).
- El trigger de M7 nunca hace fallar un insert: se prueba forzando un error.
- Huellas: `record_contact_touch`, `find_or_link_contact`, `find_contact_for_form` y
  `submit_form_response` no cambian. `create_booking` sí (M5): se actualiza su referencia en
  `verify-forms.impl.ts` en el mismo commit, con comentario, y se busca cualquier otro script o test que la compare.
- Si un bloque se traba tras un intento serio: anotarlo y seguir solo con lo que no depende de él
  (WH2←WH1, AT3←AT2, AT4←AT3; AT1 y AT2 independientes).
- Nunca debilitar un chequeo de permisos, un test existente ni una política de RLS. Ajustar un test que
  cuenta tipos o lista nodos (sumar el nuevo) no es debilitarlo; se explica en el commit.
- Ningún secreto ni token se muestra, se loguea ni se commitea. No cambiar Railway, variables de
  producción ni los webhooks registrados en Zernio o Evolution.
- Nada externo de verdad: `vi.stubGlobal("fetch", …)` con respuestas armadas según `@zernio/node`
  0.2.519 y Graph v21. Los `verify-*` tocan solo la base. El receptor se prueba con `fetch` local solo si
  la app está corriendo; si no, se anota. `verify-*` de a uno, nunca dos a la vez.
- Lógica en funciones puras con Vitest; sin dependencias de testing nuevas.
- Ritmo: `npx vitest run` después de cada funcionalidad; al cerrar cada bloque, marcar el PROGRESS,
  commit `feat: atribucion - bloque XXn (nombre)` (con rutas explícitas, nunca `git add -A`) y
  `git push origin feat/atribucion-webhooks`.
- Si se toca `lib/embed/*`: `npm run build:embed`, commitear `public/embed/embed.js` (< 60 KB).
- Revisión visual de cada bloque con pantallas: navegador propio, 1440 y 390 px, claro y oscuro. Si pide
  login y no hay sesión, se anota; nunca se escriben credenciales.
- Fuera de lo que pide el plano, no se tocan módulos anteriores (§12.2).
- `"use server"` exporta solo funciones asincrónicas; nada de servidor llega a un Client Component
  (`vault-boundary.test.ts`).

### Tests de caracterización (primero, antes de tocar; §12.5)

Archivo por tema, todos tienen que pasar antes y después:
- `lib/flow-engine/engine-contact-characterization.test.ts`: un flujo disparado por un mensaje, con
  contacto, corre igual (sesión, eventos, payload del "Esperar" con `contactId`).
- Mismo archivo: un flujo EOD (`member`) corre igual y `memberFlowProblems` rechaza lo mismo que hoy; y
  `executeFlow` con `contactId: null` saltea el paso con `node_skipped` (hoy sin test).
- `app/api/webhooks/late/route-characterization.test.ts` y `evolution/...`: un mensaje simulado se guarda
  y después se anota su toque, en ese orden.
- `formTouch`, `contact_touch_json`/`readAttribution` (forma de `attribution` con claves extra ignoradas),
  `pickUtm` y `groupByObject`: casos que fijan la salida actual (`*-characterization.test.ts`).

### Bloque WH1 — Receptor e historial (F1–F8)

Orden: F1 → F2 → F7 → F3 → F4 → F5 → F6 → F8.
- **Migración M1 (00186):** tablas del §8.1; `webhook_endpoints.name` único por workspace entre los no
  borrados; único parcial `(endpoint_id, external_event_id)`; índices `(endpoint_id, received_at desc)` y
  `(endpoint_id, body_hash, received_at)`. RLS: endpoints SELECT con `has_permission(flows.edit)` o
  `integrations.manage`, escritura `flows.edit`; `REVOKE SELECT` + GRANT por columna sin `token`;
  `inbound_webhooks` SELECT con `flows.edit`, sin INSERT/UPDATE/DELETE para `authenticated`.
  Verificación: aplicar dos veces sin error + casos de RLS en `verify-inbound-webhooks.mjs` + `verify-rls.mjs`.
- **Archivos nuevos:** `app/api/hooks/[token]/route.ts` (envoltorio delgado);
  `lib/webhooks/receive.ts` (forma del token, parseo JSON/urlencoded/multipart/`_raw`, IP truncada,
  hash canónico, orden de validaciones, todo con puertos inyectables); `lib/webhooks/process.ts`
  (`processInbound` con claim `received → processing`; en WH1 deja "ningún flujo escucha");
  `lib/webhooks/reaper.ts` (en `/api/cron/jobs`, como `reapStuckTranscriptions`);
  `lib/webhooks/retention.ts` (`retentionAction`, colgado del cron diario `content-media-cleanup`);
  `lib/webhooks/listen.ts` (`isListening`), `history-view.ts`, `diff.ts`, `alerts.ts` (`shouldAlert`,
  `createNotificationOnce`), `endpoints.ts` (token `randomBytes(16)` base64url = 22);
  `lib/actions/webhook-endpoints.ts` (crear, editar, pausar, regenerar, borrar suave, escuchar, pegar
  ejemplo, usar del historial, reprocesar con claim sobre `reprocess_count`, leer historial — servicio
  después de `getPermissionAction`, `audit_log` en cada cambio); `lib/secret-names.ts` suma el nombre del
  secreto del header (F8b, Vault con `storeSecret`/`readSecret` y `timingSafeEqual`);
  `lib/auth/guards.ts` suma `requireAnyPermission`.
- **Pantallas:** `app/(dashboard)/dashboard/settings/integrations/webhooks/page.tsx` (+ historial
  `[endpointId]/page.tsx`), tarjeta en la grilla de Integraciones, `components/webhooks/json-tree.tsx`,
  lista, drawer de detalle (Datos / Resultado), selección + "Reprocesar (N)".
- **Tests:** `receive.test.ts` (incluye espía de que el token mal formado no consulta la base y de
  `console.*` sin token ni secreto), `endpoints.test.ts`, `history-view.test.ts` (6 estados, 4 resultados,
  aviso de retención), `diff.test.ts`, `listen.test.ts`, `retention.test.ts` (89/90/365/366 días),
  `alerts.test.ts`, test del reaper (procesa una vez), guard de `requireAnyPermission`,
  `scripts/verify-inbound-webhooks.mjs` (nuevo: RLS, token oculto, único, otro workspace, limpieza
  `zz-test-`; `fetch` a la app local si está corriendo).
- **Listo:** F1–F7 cumplen, vitest completo 0, `verify-inbound-webhooks` y `verify-rls` 0, lint (sin
  errores nuevos) y build pasan.
- **Riesgos:** que la ruta estática `integrations/webhooks` choque con `[providerId]` (Next prioriza la
  estática; test de ruta); el Member de sistema con `flows.edit` ve payloads (decisión #258, se documenta).

### Bloque WH2 — Disparador, variables y paso de contacto (F9–F15)

Orden: caracterización → M2 → F10 (motor y validador) → F9 → F11 → M3 → F13 → F12 → F14 → F15.
- **M2 (00187):** `flow_sessions.inbound_webhook_id uuid REFERENCES inbound_webhooks ON DELETE SET NULL`,
  índice, CHECK recreado (3 vías), CHECK de `triggers.type` con los 31 vivos + `webhook_received`.
  `automation_events` no se toca. Verificación: consulta de control (0 filas sin contacto, persona ni
  webhook), `verify-eod.mjs`, `verify-rls.mjs`; tests de migraciones existentes en verde y uno nuevo
  `lib/webhooks/migrations.test.ts` que lee M2 y compara contra la lista de la 00183 + el nuevo.
- **M3 (00188):** CHECK de `origin` + `webhook`. Verificación: `verify-attribution.mjs`.
- **Motor y registro (F9/F10):** `TriggerSubject` suma `"webhook"`; `FlowExecutionContext` suma
  `inboundWebhookId?`; la sesión se crea con `inbound_webhook_id`; `upsert_contact` actualiza
  `context.contactId` y `flow_sessions.contact_id`; `lib/flow-engine/contact-requirement.ts`
  (`pathsMissingContact(graph)`, puro); `member-flow.ts` usa esa regla para el sujeto `webhook` (EOD
  igual); la paleta no se filtra para flujos de webhook; `contact-free.ts` suma `upsert_contact`.
  `registry/webhook-triggers.ts` (`webhook_received`, `scope: event`, `subject: webhook`, sin
  `eventTypes` — se verifica que el cron de `automation_events` nunca lo levante), `variableSchema` desde
  el `sample_payload`; `registry/webhook-conditions.ts` (campos `webhook.payload.*` / `webhook.query.*`).
  Disparo directo desde `processInbound`: triggers activos con ese `endpointId` de flujos publicados →
  "Solo si…" con `condition-eval` → claim en `trigger_fires` (`webhook:<inbound>:<flow>:<reprocess_count>`)
  → `executeFlow(contactId null, inboundWebhookId, variables.webhook)`.
- **Paso (F12–F14):** `lib/flow-engine/nodes/upsert-contact.ts` (salidas `handle:ok` / `handle:fail`,
  `outputs` `contact_result` y `contact_fail_reason`); `lib/webhooks/mapping.ts` (`applyContactMapping`,
  nunca lanza; destinos = `FIXED_TARGETS` + `contact.custom.<slug>` reusando `lib/forms/contact-config.ts`
  sin cambiar su comportamiento); `lib/webhooks/attribution.ts` (detección query → raíz → contenedores,
  limpieza); `find_contact_for_form` con el servicio (teléfono normalizado); escribir con servicio limitado
  al workspace del endpoint; toque ancla de #254; `recordTouch` con `origin: webhook`,
  `dedupeKey webhook:<inbound>:<nodo>` (nunca tumba el paso); `auditAsWebhook`; `ORIGINS` suma `webhook`;
  `RAW_KEYS` suma `endpoint_id`, `endpoint_name`. "Probar con el ejemplo" = Server Action de solo lectura.
- **F15:** `lib/webhooks/result.ts` (`summarizeResult`), estado final del envío, `last_received_at`.
- **Pantallas:** `components/flow-builder/panels/WebhookTriggerPanel.tsx` (en `TriggerPanel`, el bloque
  `triggerTypes` suma el tipo), `UpsertContactPanel.tsx` (en `NodeConfigSidebar`), paleta y
  `simulator.ts` suman el nodo, selector de variables con el árbol, marca de validación en el editor.
- **Tests:** `webhook-triggers.test.ts`, `contact-requirement.test.ts`, `payload-tree.test.ts`,
  `mapping.test.ts` (≥ 8 casos del plano), `attribution.test.ts`, `upsert-contact.test.ts` (base
  simulada: email/teléfono existentes, `no_identifier`, `not_found`, `fill_empty`/`overwrite`, Instagram
  vinculado no se pisa, conflicto, reproceso sin duplicar, ancla de #254), `result.test.ts`, test de
  integración del motor con `{{webhook.payload.data.name}}`, rechazo de publicar (ruta de publish).
  Se ajustan sumando el nuevo: `consistency.test.ts` (lista de nodos sin contacto),
  `registry.test.ts` (28 → 29 nodos), `triggers-characterization.test.ts` (+1). `verify-inbound-webhooks`
  suma los casos de punta a punta; `verify-attribution` suma `origin=webhook`.
- **Listo:** F9–F15 cumplen, vitest completo 0 (motor, Formularios y EOD incluidos),
  `verify-inbound-webhooks`, `verify-attribution`, `verify-forms`, `verify-eod` y `verify-rls` 0, lint y build.
- **Riesgos:** cambiar de contacto a mitad de sesión (cubierto por test con "Esperar" antes y después del
  paso); que un flujo viejo de webhook llegue a un paso con contacto (el motor lo saltea y lo anota).

### Bloque AT1 — Que no se pierda nada (F16–F21)

Orden: F18 → M4 → F19 → M5 → F17 → F16 → F21 → F20 (si sobra tiempo).
- **M4 (00189):** `messages.origin_context jsonb`. Verificación: `verify-message-persistence.mjs`.
- **M5 (00190):** `create_booking` copiado letra por letra de la base viva (25 parámetros, misma firma);
  solo cambia el toque: suma `ad_id`, `adset_id`, `campaign_id` y en `raw` `utm_id`, `placement`, `fbp`,
  `fbc`, `ga_client_id`, `first_visit`. Antes y después: `verify-scheduling`, `verify-booking-concurrency`;
  después `verify-forms` (huella nueva) y `verify-sales`.
- **F16:** `embed-params.ts` importa `TOUCH_KEYS` (+ `fbp`/`fbc`); se actualiza el comentario de `keys.ts`;
  función pura `lib/scheduling/booker/attribution.ts` (URL + cookie `ssa_attr` con `effectiveAttribution`,
  o `attr` del embed); `booker.tsx` la usa; `pickUtm` acepta `ATTRIBUTION_KEYS` + `first_visit` saneados y
  completa `fbp`/`fbc` desde las cookies; `lib/embed/url.ts` pasa `attr` a la agenda; `npm run build:embed`.
- **F18:** `formTouch` sin `?? input.formName`; se ajustan `touch-entry.test.ts` y la afirmación de
  `verify-forms.impl.ts` (con comentario); la ficha muestra el nombre del formulario desde `raw.source_id`.
- **F19:** tipos locales del receptor de Zernio (`isStoryMention`, `referral` completo, `comment.ad`);
  `lib/messages/origin-context.ts` (puro); se escribe en Zernio y Evolution sin poder tumbar el webhook;
  `inboundTouchReason` suma `story_mention`; `MEDIUMS` suma `story_mention` ("Mención en historia");
  `RAW_KEYS` suma `referral_type`; comentario en anuncio → toque con `adId` y `paid_social` (solo si ya
  genera toque); filtros "Solo si vino de un anuncio" y "Solo menciones en historias"; variables
  `message_origin.*`.
- **F21:** `attribution-view.ts` + `attribution-section.tsx` (ids crudos hasta AT3).
- **Tests:** `origin-context.test.ts`, `touch-inbound.test.ts`, `embed-params.test.ts`,
  `antispam.test.ts`, `booker/attribution.test.ts`, `attribution-view.test.ts`, `keys.test.ts`,
  `build.test.ts` (< 60 KB), receptores de Zernio/Evolution y `e2e-zernio.test.ts` en verde, `taxonomy.test.ts`
  (suma `story_mention` y `webhook`).
- **Listo:** como el plano (+ `verify-message-persistence`).
- **Riesgos:** romper la creación de agendas (copia exacta + verificaciones antes y después); el tamaño
  del embed; reglas de asignación que lean `content`.

### Bloque AT2 — Catálogo de Meta (F22–F25)

- **M6 (00191):** tablas del §8.1 (únicos por cuenta e id, índices por `campaign_id`/`adset_id`),
  `meta_name_key` con `translate`, RLS de lectura con `has_permission(dashboards.ads.view)` (Owner/Admin
  incluidos), escritura solo servicio; bucket privado `ad-creatives` (2 MB, jpeg/png/webp, política por
  primer segmento como `chat-media` + permiso); política ADICIONAL de SELECT en `meta_ads_insights_daily`.
  Verificación: `verify-ads-attribution.mjs` (catálogo), `verify-dashboards`, `verify-rls`.
- **Archivos:** `lib/meta/entities.ts` (campos, `filtering`, `updated_since`, paginación con tope 50 y
  `last_error`, `readUsage` > 90 % corta), cambios en `meta-ads-sync.ts` (entidades antes de métricas,
  independientes; `persistInsights` escribe estado desde el catálogo; encola miniaturas),
  `lib/meta/thumbnails.ts` + handler `meta-ad-thumbnails` (`sniffMime`, reintentos 1/5/15 con
  `scheduleJob`, no lanza), `lib/meta/content-link.ts` (automático, no pisa manual), botón "Sincronizar
  ahora" (`settings.manage`, dedupe por bloque de 10 min).
- **Tests:** `entities.test.ts`, `meta-ads-sync.test.ts` (nuevo), `thumbnails.test.ts`,
  `content-link.test.ts`, `bootstrap-characterization.test.ts` suma el handler.
- **Riesgos:** cuota de la API (se corta y reintenta); `DELETED` en el filtro (si Graph lo rechaza, se saca y se anota).

### Bloque AT3 — Vínculo (F26–F29)

- **M7 (00192):** columnas `meta_*` con CHECK; `resolve_meta_match` (STABLE, DEFINER, `search_path=''`,
  solo service_role); trigger `BEFORE INSERT` envuelto en `EXCEPTION WHEN OTHERS` (deja `none` +
  `RAISE WARNING`); `contact_touch_json` reescrita sumando campos (vieja en la cabecera);
  `private.refresh_contact_attribution` (mismo orden que `record_contact_touch`);
  `rematch_meta_touches` (lotes de 500, nunca `manual`/`ignored`). Verificación: huella de
  `record_contact_touch` igual, `verify-attribution`, `verify-crm`, un mensaje simulado se sigue guardando
  con su toque, prueba que fuerza un error en el trigger y el insert pasa.
- **M8 (00193):** `rematch_meta_touches(ws, '-infinity')` por workspace, `RAISE NOTICE` con el conteo
  (hoy se espera 0). Respaldo previo: las columnas son nuevas, no hay dato que respaldar.
- **Archivos:** `lib/attribution/meta-match.ts` + `meta-match.cases.json` (paridad SQL ↔ TS),
  `meta-match-reasons.ts`, `lib/actions/meta-match.ts` (vincular, ignorar, quitar; `settings.manage`, toque
  del workspace de la sesión y contacto visible), llamada a `rematch` al final del sync (90 días),
  pantalla `/dashboard/dashboards/ads/sin-vincular` (RLS de quien mira), F21 con nombres y miniatura.
- **Tests:** `meta-match.test.ts` (corre el `.json`), `meta-match-reasons.test.ts`,
  `lib/actions/meta-match.test.ts`; `verify-ads-attribution.mjs` (paridad, re-vínculo, manual/ignored/
  100 días intactos, `refresh` = `record_contact_touch`).
- **Riesgos:** el trigger corre en cada toque de cada canal: envuelto, probado con error forzado y medido.

### Bloque AT4 — Tabla Meta vs CRM (F30–F33)

- **M9 (00194):** `ads_crm_metrics(p_level, p_since, p_until, p_ad_account_id)` SECURITY INVOKER, STABLE,
  fechas en `workspaces.timezone`; asistidas = `status_group='outcome'`; ventas excluyen
  `cancelled`/`refunded`, por `sale_date`, revenue = `final_amount*100`; cash = pagos `paid` por `paid_on`
  (reembolsos restan); agendas sin "liberar espacio"; herencia del último toque con anuncio anterior a la
  agenda. Índices del §8.2 y `EXPLAIN` < 300 ms con 10.000 toques.
- **Archivos:** `lib/dashboards/ads-crm.ts` (fórmulas, "—"), `ads-crm-columns.ts` (textos),
  `ads-columns.ts` (selector en `localStorage` con `try/catch`), cambios en `hierarchy-tables.tsx`
  (grupos de color con tokens, pills de estado, total, miniatura firmada, "N sin vincular",
  "Sincronizar ahora", aviso de alcance con `scope("leads")`), F32: `requirePermission("dashboards.ads.view")`
  en `ads/page.tsx` y `ads-detail-page.ts`; `member-baseline.test.ts` mueve la página a `PERMISSION_PAGES`.
  F33 (CSV y clic en números) si alcanza; si no, se anota.
- **Tests:** `ads-crm.test.ts`, `ads-columns.test.ts`, filtro "Pausados" con `CAMPAIGN_PAUSED`;
  `verify-ads-attribution.mjs` (los nueve casos del plano, incluido el Member `own`), `verify-roles`,
  `verify-dashboards`, `verify-rls`.
- **Riesgos:** que la suma de anuncios no cuadre con la campaña (caso explícito en el verify); performance.

### Cierre

- `docs/webhooks.md` nuevo; actualizar `docs/atribucion.md` (vínculo con Meta, toques de webhook y de
  mención, guía de parámetros de URL de los anuncios), `docs/flow-registry.md` (disparador, paso, sujeto
  `webhook`, regla por camino), `docs/dashboards.md` (tabla Meta vs CRM).
- `CLAUDE.md`: sección "Webhooks, atribución y anuncios" con "Lo que no se puede romper" y la próxima
  migración libre (00195 si no aparece otra).
- No mergear. `gh pr create` de `feat/atribucion-webhooks` a `main` con el resumen de PROGRESS y PENDIENTE.

### Verificación de punta a punta

- Al final: `npx vitest run` completo, `npm run lint`, `npm run build`, y de a uno: `verify-rls`,
  `verify-roles`, `verify-workspace-isolation`, `verify-crm`, `verify-attribution`, `verify-scheduling`,
  `verify-booking-concurrency`, `verify-forms`, `verify-sales`, `verify-eod`, `verify-dashboards`,
  `verify-message-persistence`, `verify-inbound-webhooks`, `verify-ads-attribution` (con los flags que
  dejaron los módulos anteriores donde corresponda).
- Huellas de `record_contact_touch`, `find_or_link_contact`, `find_contact_for_form` y
  `submit_form_response` iguales a las del punto de partida; M1–M9 aplicadas y registradas.
- Receptor con `curl`/`fetch` contra la app local si está corriendo; revisión visual de las siete
  pantallas a 1440 y 390 px, claro y oscuro (o anotada si pide login).
- La verificación en vivo con cuentas reales (§11 del plano) queda para Wendy, en `PENDIENTE-atribucion.md`.


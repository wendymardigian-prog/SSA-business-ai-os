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
- [x] F26 `resolve_meta_match` y el trigger (M7)
- [x] F27 `contact_touch_json` y la atribución del contacto
- [x] F28 Re-vincular después de cada sync, y el backfill (M8)
- [x] F29 "Sin vincular"

### AT4 — Tabla Meta vs CRM
- [x] F30 Función `ads_crm_metrics` (M9)
- [x] F31 La tabla en el dashboard de Ads
- [x] F32 Permiso de la pantalla
- [x] F33 Exportar CSV y abrir la lista (nice-to-have)

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
- [x] `docs/webhooks.md`, `docs/atribucion.md`, `docs/flow-registry.md`, `docs/dashboards.md`
- [x] Sección "Webhooks, atribución y anuncios" en `CLAUDE.md`
- [x] Verificación final (13/10/2026): vitest 779 archivos / 9770 tests verdes; lint 0 errores y 36 avisos (igual que antes); build ok; todos los `verify-*` en verde salvo `verify-attribution` (el caso de datos que ya fallaba: 776 de 835); huellas intactas; 00186–00195 registradas
- [x] Revisión visual (WH1, WH2, AT2, AT3, AT4; ver las notas de cada bloque)
- [x] PR abierto, sin mergear

## Correcciones (Tirón 2)

Rama `fix/atribucion-webhooks-flujos` (desde `main` en `2738c16`). Planificado el 14/10/2026, **sin código ni base tocados todavía**.
Se arranca con el `/goal` de Wendy. Regla de oro: los flujos con contacto se comportan exactamente igual (caracterización del
motor y del cron ANTES de tocar). Decisiones de Wendy: Leads Meta se corrige y se recalcula; el vínculo anuncio↔pieza pide
`content.create` + `dashboards.ads.view`; B4 se mide con datos sintéticos; las columnas duplicadas se unifican.

### Checklist por bloque
Orden de ejecución: D1–D2 y C primero (son la base), después E1, B, E2–E4, A y D3–D5. Cada tramo: `npx vitest run` en verde,
esta lista marcada, commit `fix: atribucion - bloque X (nombre)` y push.

- [x] **Paso 1**: `npm run build` y cada `scripts/verify-*.mjs` de a uno (con candado), para fijar el punto de partida (ver «Punto de partida»)
- [x] **Paso 2**: tests de caracterización ANTES de tocar (`lib/flow-engine/resume-characterization.test.ts` es nuevo; el resto ya existía: motor, EOD, webhook, tabla Meta vs CRM, pieza)
- [ ] **D · Flujos sin contacto: el origen**
  - [x] D1 · `source_type`/`source_id` en `flow_sessions` y `automation_events`, CHECK superconjunto, `subject: system`, motor y cron (`resume_flow` desde la sesión)
  - [x] D2 · tabla de pasos y contacto en `docs/flow-registry.md`; mensaje del validador de agenda y ventas
- [ ] **C · Webhooks**
  - [x] C1 · `occurredAt = received_at` en el toque
  - [x] C2 · recepción con `pg_advisory_xact_lock`; clave `(envío, flujo)` sin `reprocess_count`; casilla "Volver a correr…"; "una sola vez por contacto"
  - [x] C3 · error visible si falla guardar el contacto en el flujo; el historial del webhook se entera de lo que pasa después de un "Esperar"
  - [x] C4 · purga de las copias del payload (`flow_sessions.variables` y jobs `resume_flow`)
- [ ] **E · Anuncios: el catálogo (E1)**
  - [ ] Ponerse al día si se perdió la corrida de las 3 a. m.; un lote que falla deja el catálogo incompleto; sin token se anota
  - [ ] Respaldo desde los insights cuando falta el catálogo; aviso "Ningún contacto de este período trae datos de anuncio…"
  - [ ] Leads Meta sin duplicados (`lead` canónico) + recálculo del historial (00220, después del deploy)
- [ ] **B · Tabla Meta vs CRM**
  - [ ] B1 · Leads nuevos / Leads totales / CPL nuevo / CPL total, con tooltips
  - [ ] B2 · clic en los números, panel lateral y detalle (`ads_crm_cell_detail`)
  - [ ] B3 · fila Total sin contar dos veces (`ads_crm_metrics_v2`)
  - [ ] B4 · medición con `EXPLAIN ANALYZE` y decisión
- [ ] **E · Anuncios: columnas (E2–E4)**
  - [ ] E2 · columnas nuevas (ocultas) + fila Total
  - [ ] E3 · columnas visibles por defecto
  - [ ] E4 · selector con buscador, subtítulos, arrastrar, migración de preferencias, CSV, celular
- [ ] **A · Anuncios y contenido**
  - [ ] A1 · recuperar el anuncio desde la conversación de Zernio (solo Instagram)
  - [ ] A2 · vínculo manual anuncio ↔ pieza en menús "⋯", sección "Publicidad", indicador y filtro "Pautadas"
- [ ] **D · Envíos sin contacto (D3–D5)**
  - [ ] D3 · paso "Enviar WhatsApp a un número"
  - [ ] D4 · "Enviar email" a una dirección de una variable
  - [ ] D5 · validar al guardar un flujo publicado
- [ ] **Cierre**: docs (`webhooks`, `atribucion` con la lista de columnas, `flow-registry`, `PENDIENTE-atribucion`), `CLAUDE.md`, revisión visual (1440/390 px, claro/oscuro), PR sin mergear

### Punto de partida (Tirón 2)
Medido el 14/10/2026, antes de tocar nada (modo solo lectura).
- `npx vitest run`: **874 archivos, 10.998 tests, todos en verde**.
- `npm run lint`: **0 errores, 36 avisos** (directivas `eslint-disable` sin usar).
- `npm run build` y los `scripts/verify-*.mjs`: **pendientes** (el paso 1 de la ejecución). Se postergaron porque `build` regenera
  `public/embed/embed.js` y los `verify-*` escriben en la base real, y Supabase tenía un incidente el 14/10 (pooler bloqueado y crons con
  "job startup timeout").
- Conocido de antes: `verify-attribution` (caso de datos, 776 de 835), `verify-forms` y `verify-publishing` a veces fallan.
- Base `knrxjnmxnmjavivyuwew` y repo coinciden en la `00215`. **Primera libre: `00216`** (confirmar con `list_migrations`).
- CHECK vigentes (`pg_get_constraintdef`, 14/10):
  - `flow_sessions_contact_or_member`: `CHECK (((contact_id IS NOT NULL) OR (member_user_id IS NOT NULL) OR (inbound_webhook_id IS NOT NULL)))`
  - `automation_events_contact_or_member`: `CHECK (((contact_id IS NOT NULL) OR ((event_type = ANY (ARRAY['eod_submitted'::text, 'task_completed'::text, 'task_overdue'::text])) AND (member_user_id IS NOT NULL))))`
- Catálogo de Meta: `meta_campaigns`/`meta_adsets`/`meta_ads` con 0 filas; `meta_ads_insights_daily` con 1.067 filas (13/07 a 13/10). Causa: el cron de las 09:30 UTC
  del 13/10 corrió con el código viejo (sin catálogo) y el del 14/10 falló por el incidente de Supabase.
- "Leads Meta" inflado: se guardan 2.337 leads y Meta reporta 468 (se suman variantes del mismo lead).
- Los 804 toques tienen `meta_match_status = 'none'`.

### Migraciones (Tirón 2)
Todas aditivas e idempotentes, con "Cómo volver atrás" en la cabecera. Aplicar con la CLI, registrar en `schema_migrations`, y después
`node scripts/build-all-migrations.mjs`. Números a confirmar con `list_migrations`.

| # | Qué | Se aplica | Estado |
|---|---|---|---|
| 00216 | `receive_inbound_webhook` con lock (C2) | antes del deploy | **aplicada y registrada** (14/10) |
| 00217 | claves nuevas de `trigger_fires` para webhooks (C2) | antes | **aplicada y registrada** (14/10) |
| 00218 | `source_type`/`source_id`, trigger, backfill y CHECK superconjunto (D1) | antes | **aplicada y registrada** (14/10; ver «Notas de la corrida») |
| 00219 | `ads_crm_items`, `ads_crm_metrics_v2` y `ads_crm_cell_detail` (B2, B3) | antes | **aplicada y registrada** (14/10; el código que la usa va en el bloque B) |
| 00220 | recalcular `leads`/`purchases` de Meta (decisión 1) | **después del deploy**, con respaldo | pendiente |
| 00221 | `enrich_touch_ad_origin` (A1) | antes | pendiente |
| 00222 | `flow_send_claims` (D3) | antes | pendiente |

No cambian (sus huellas quedan iguales a las del Tirón 1): `record_contact_touch`, `find_or_link_contact`, `find_contact_for_form`,
`submit_form_response`, `create_booking` y `find_or_create_contact`.

### Notas de la corrida (Tirón 2)

**Punto de partida real** (14/10, sobre una copia limpia de `origin/main` en `2738c16`; lo que importa código de la app —`forms`, `tasks`, `eod`, `sales`, `publishing`, `contact-merge`— se midió así para que mis cambios no lo contaminaran):
- `npx vitest run`: 874 archivos, 10.998 tests, verdes. `npm run build`: salida 0. `npm run lint`: 0 errores, 36 avisos.
- Todos los `verify-*` dan 0 salvo cuatro que ya fallaban **antes de tocar nada**:
  - `verify-tasks`: 1 fallo, «las fechas de las dependientes ajenas se corrigieron (B al 14, C al 15)»: un test de fechas que depende del día.
  - `verify-forms`: 1 fallo, «el EXPLAIN de la consulta de vistas usa idx_analytics_forms» (el plan de ejecución de una consulta; a veces pasa).
  - `verify-ads-attribution`: 1 fallo, «EXPLAIN ANALYZE: 344 ms (el plano pide < 300 ms)» sobre `ads_crm_metrics`.
  - `verify-attribution`: el caso de datos de siempre («todos los contactos reales tienen first_touch», 793 de 852).
- `verify-webhook` y `verify-inbound-webhooks` corrieron con la app en local (`npm run dev`, puerto 3000).

**Orden**: el plan decía D1 antes que C; se hizo C primero para que las migraciones salgan con los números del plan sin saltear ninguno (C usa la 00216 y la 00217, D1 la 00218). C no depende de D1.

**C2 · reprocesar**: sin la casilla, un flujo que ya corrió **no se repite**, pero el contacto **se vuelve a mapear** si el flujo tiene UN solo paso «Crear o actualizar contacto» (con varios, en ramas distintas, no se sabe cuál corrió: no se toca). Un flujo que **falló** libera su clave y se reintenta. El `result` del envío se **fusiona** con lo anterior (antes lo pisaba entero, y un reproceso que corre solo algunos flujos habría borrado el historial de los demás).

**C3**: además de lanzar si falla el guardado en la sesión, el historial del webhook ahora se entera de lo que pasa **después de un «Esperar»** (`settleResumedSession`): terminar, volver a esperar o fallar. Antes quedaba «en curso» para siempre.

**C4**: la purga de las copias del payload es de TypeScript (sin migración): filtra del lado de la base lo que ya está vacío para no releer todo cada día.

**D1 · el CHECK de `automation_events`**: la primera versión de la 00218 lo aflojaba de más (cualquier evento con persona pasaba). Dos verificaciones lo atajaron (`verify-eod`, `verify-tasks`: «un evento de contacto sin contacto se sigue rechazando»). Se corrigió **la misma 00218** (se reaplicó, es idempotente, y se actualizó lo registrado): un evento de contacto sin contacto sigue rechazado aunque traiga persona; lo nuevo es un evento sin contacto **ni persona** con origen declarado.
- Una prueba **vieja** de `verify-inbound-webhooks` se cambió a propósito: «borrar un envío que sostiene una sesión sin contacto lo frena el CHECK». Con el origen, la sesión sigue siendo válida y el borrado ya no se frena (queda con el envío en NULL y su origen `webhook`).
- Un evento de Tareas **sin contacto ni persona** sigue sin correr (el test `automation-events-routing` lo fija y no se tocó): hoy no se emite. Habilitarlo es un cambio de una línea, a decidir cuando Tareas lo necesite.
- No hay todavía ningún disparador `system`: el camino está probado con uno de prueba. El **simulador no cambia**: solo simula disparadores de mensaje (los de evento, persona, webhook y sistema responden «No coincide»).
- D2: los pasos de agenda y ventas ahora dicen «actúa sobre la reunión (o la venta) que dispara el flujo» en lugar de mandar a poner «Crear o actualizar contacto» (`TRIGGER_ENTITY_NODES`).

**Verificación después de aplicar 00216–00219** (con el código nuevo): `verify-inbound-webhooks` 0 (129 pruebas, incluye diez entregas simultáneas por el receptor real: una procesable y nueve ignoradas), `verify-eod` 0, `verify-forms` 0, `verify-webhook` 0, `verify-tasks` el mismo único fallo de fechas de antes.

### Plan completo (Tirón 2, tal cual se presentó y aprobó)

### Plan — Correcciones del Extra L (Tirón 2): webhooks, atribución, anuncios y flujos sin contacto

#### Contexto

El Extra L (PR #47, mergeado el 13/10) dejó funcionando webhooks entrantes, atribución y la tabla Meta vs CRM, pero tiene huecos:
- Un envío puede disparar dos veces el mismo flujo.
- Un flujo sin contacto se rompe después de un "Esperar".
- El catálogo de Meta está vacío, así que la tabla de anuncios casi no muestra datos.
- La fila Total cuenta dos veces.
- No hay vínculo manual entre anuncios y piezas de contenido.

Además, la regla de flujos sin contacto solo sirve para EOD y webhooks, y traba cualquier disparador nuevo, como los de Tareas. Esta corrida corrige todo eso **sin cambiar el comportamiento de los flujos con contacto**. Rama: `fix/atribucion-webhooks-flujos`.

Decisiones de Wendy (14/10):
1. **Leads Meta: corregir y recalcular.** Se cuenta solo la acción `lead` y se recalcula el historial desde el `actions` ya guardado, con respaldo previo.
2. **Permiso del vínculo anuncio ↔ pieza:** `content.create` + `dashboards.ads.view`.
3. **B4 se mide con datos sintéticos.** Se usan los 10.000 toques de `verify-ads-attribution`. Se usa la alternativa simple si el costo extra pasa los 300 ms o duplica la consulta actual.
4. **Unificar columnas duplicadas.** CAC, Costo por cierre y Costo por nuevo deal pasan a una sola: "Costo por nuevo deal". Leads CRM pasa a Leads totales y Agendas CRM pasa a Agendas.

---

#### 1. Verificación contra el código real: diferencias con el pedido

| # | Lo que dice el pedido | Lo que hay en el código | Cómo lo adapto |
|---|---|---|---|
| 1 | `receive.ts` hace SELECT por `body_hash` y después INSERT | Es así cuando el envío no trae id propio (`hasRecentSameBody`, ventana de 10 min, `server-ports.ts:47-56`). Con `event_id_path` configurado ya hay un índice único `uq_inbound_webhooks_event`. | La función SQL con lock cubre los dos casos. El índice único se queda. |
| 2 | La clave de `trigger_fires` incluye `reprocess_count` | Confirmado: `webhook:<inbound>:<flow>:<n>` (`trigger-config.ts:90`, `run-flows.ts:109`). | Se cambia, y se migran las claves viejas (ver C2). |
| 3 | Reprocesar corre solo lo que no corrió | La clave se toma ANTES de correr el flujo, así que un flujo que **falló** también queda marcado como "ya corrió". | Si el flujo falla, se libera la clave (se borra esa fila de `trigger_fires`). Así "Reprocesar" reintenta lo que falló y no repite lo que salió bien. |
| 4 | `upsert-contact.ts` (webhooks) no pasa `occurredAt` | Confirmado (`upsert-contact.ts:304`). `buildWebhookTouch` ya acepta `occurredAt`. | Se pasa `received_at`. |
| 5 | Error al guardar el contacto en el flujo | Confirmado: el update de `flow_sessions` en `nodes/upsert-contact.ts:101-104` ignora el error. **Además**, si el flujo falla o termina después de un "Esperar", el historial del webhook nunca se entera: queda en "pendiente" para siempre. | Se lanza el error. También se agrega que la reanudación actualice el resultado del envío (ver D1). |
| 6 | `resume_flow` no pasa `inboundWebhookId` | Confirmado (`cron/jobs/route.ts:695-708`). Además, toma `contactId` del job y no de la sesión. | El origen se lee de la SESIÓN (ver D1). |
| 7 | CHECK de `automation_events`: "salvo `eod_submitted`" | La definición vigente admite `eod_submitted`, `task_completed` y `task_overdue` (la 00199 sumó Tareas). | Se copia tal cual en la cabecera. |
| 8 | `flows/[flowId]` PUT llama a `checkMemberFlow` sin `edges` | Confirmado (`route.ts:64-68`). La firma ya acepta `edges` y `{publishing}` (`member-flow-db.ts:10`). | D5 tal cual. |
| 9 | "Correr una sola vez por contacto" | No existe en flujos. Solo hay `oncePerContact` en encuestas, y `new_contact` ya es de por vida. | Se agrega al disparador "Webhook recibido" (ver C2). |
| 10 | "Tope por hora del canal" | Solo existe para Instagram y Facebook (`claim_automated_send`, 200 por hora, `send.ts:177-193`). **WhatsApp no tiene tope.** | El paso nuevo de D3 usa el mismo `claim_automated_send` con 200 por hora. `sendMessage` no cambia. |
| 11 | WhatsApp por Evolution | Confirmado. Pero `sendViaEvolution` exige que el contacto tenga un número de WhatsApp vinculado (`contact_channels.platform_sender_id`). | D3 manda directo al número con el cliente de Evolution, sin pasar por el contacto. |
| 12 | `send_email` "a fija o al equipo" sin contacto | Modos reales: `contact`, `host`, `fixed`, `member` y `users`. **Bug existente:** si el contacto tiene "No contactar", también se cancelan los correos a una dirección fija o al equipo (`send-email.ts:66-80`). | No lo toco: cambiaría el comportamiento de los flujos con contacto. Queda en el PENDIENTE. D4 suma `variable`. |
| 13 | A1: el campo de Zernio | `messages.getInboxConversation` devuelve `metadata.meta_ad_id`, `meta_ad_title`, `meta_ad_post_id`, etc. Solo existe para Instagram y Messenger: el `ctwa_*` de WhatsApp sale únicamente del listado. | En este sistema WhatsApp va por Evolution, así que **A1 aplica solo a Instagram**. |
| 14 | A1: "guardarlo en el toque" | El trigger de vínculo con Meta es `BEFORE INSERT` y no corre al actualizar. El toque del mensaje ya existe (`msg:<id>`). | Hace falta una función nueva que enriquezca ese toque (00221). `record_contact_touch` no se toca. |
| 15 | A2: permiso de edición | No existe `content.edit`. Las claves son `content.create` ("Crear y editar piezas"), `approve`, `publish` y `ai`. Vincular toques usa `settings.general` (`settings.manage` ya no existe desde la 00211). | Decisión 2. |
| 16 | A2: la pieza "con el período elegido" | El detalle de la pieza no tiene selector de período: mide por edad. | La sección "Publicidad" trae su propio selector chico (`PERIOD_PRESETS`), con "Histórico" por defecto. |
| 17 | A2: no hay menú "⋯" | No existe ni en el detalle del anuncio (`ads-detail-view.tsx`, página completa) ni en el de la pieza. | Se suma con `PopoverMenu` (`components/automations/popover-menu.tsx`) y el buscador estilo `LinkPicker` (`components/dashboards/ads/unlinked-list.tsx:191`). |
| 18 | A2: filtro "Pautadas" en la lista | La lista carga todas las piezas y filtra en el cliente (`lib/content/filters.ts`). El filtro es barato. | **Se hace el filtro.** Ojo: `meta_ads` se lee con la RLS `dashboards.ads.view`, así que quien no ve anuncios no ve el indicador. Eso es correcto. |
| 19 | B: agendas y ventas en el Total | Cada agenda y cada venta cae en UN solo objeto por nivel (subconsulta con `LIMIT 1` y un único `attribution_touch_id`). | **Suma simple, que es exacta.** Solo "Leads totales" necesita contar distintos. |
| 20 | B1: "KPIs que usan leads de anuncios" | Las tarjetas y KPIs del dashboard de Ads (Leads, CPL, comparación, embudo, tabla diaria, análisis IA, dashboard unificado) usan **Leads de Meta**, no del CRM. Solo la tabla Meta vs CRM usa el CRM. | Leads nuevos y Leads totales con sus dos CPL van en la tabla, y en una tarjeta nueva "Leads CRM" en la fila de KPIs del dashboard de Ads. Los KPIs de Meta conservan su nombre "Leads Meta" y corrigen su número (decisión 1). El unificado también corrige su número. |
| 21 | E1: estado desde `effective_status` del insight | **Ninguna fila de insights tiene estado** (0 de 1.067). La API de insights de Meta no lo da: hoy se copiaba del catálogo. | Sin catálogo, el estado queda "Sin estado", con una nota que dice que llega con el catálogo. El arreglo real del estado es el sync (ver punto 2). Nombre, padre y campaña sí se resuelven desde los insights. |
| 22 | E1: `ads_crm_metrics` con el filtro de cuenta | Con el catálogo vacío, el filtro por cuenta (`x.ad_account_id = $6` sobre el catálogo) **descarta todas las filas del CRM**. | La v2 toma como objetos de la cuenta el catálogo más los `object_id` de los insights de esa cuenta. |
| 23 | E2: columnas | Ver el punto 3. Algunas no tienen datos hoy en esta cuenta: se muestran como "—", nunca como 0. | — |
| 24 | E4: preferencias guardadas | Ya existe `parsePrefs`: descarta lo desconocido y suma las columnas nuevas ocultas. **Falta reemplazar una columna vieja por su equivalente.** | Se agrega un mapa de equivalencias y la versión del default. |
| 25 | Exportar CSV | Usa las columnas visibles en el orden elegido (`ads-crm-csv.ts:20`). | Solo se suman las columnas nuevas. |
| 26 | Celular: primera columna fija | Ya está fija (`sticky left-0`). | Se verifica en la revisión visual. |
| 27 | Detalles a los que lleva el panel | Contacto `/dashboard/contacts/<id>`, agenda `/dashboard/agenda?agenda=<id>`, venta `/dashboard/ventas/<id>`. | Se reusan. |
| 28 | UF cash | No hay columna "primer pago", pero se deduce: es el primer pago `paid` positivo de cada venta, por `paid_at`. | Va en la v2. |

**CHECK vigentes** (leídos con `pg_get_constraintdef` el 14/10):
- `flow_sessions_contact_or_member`: `CHECK (((contact_id IS NOT NULL) OR (member_user_id IS NOT NULL) OR (inbound_webhook_id IS NOT NULL)))`
- `automation_events_contact_or_member`: `CHECK (((contact_id IS NOT NULL) OR ((event_type = ANY (ARRAY['eod_submitted'::text, 'task_completed'::text, 'task_overdue'::text])) AND (member_user_id IS NOT NULL))))`

#### 2. Diagnóstico del catálogo vacío (E1)

**La causa no es un bug del código: el código del catálogo nunca llegó a correr.**
- El job `meta_ads_sync` se encola solo a las 3 a. m. de la zona del workspace. En Costa Rica eso es 09:30 UTC.
- **13/10:** corrió a las 09:30 UTC. El Extra L se mergeó ese día a las 14:45 UTC, así que esa corrida fue con el código viejo, que no tenía catálogo. Por eso la cuenta no tiene `catalog_synced_at`.
- **14/10:** el cron `metrics-sync` de las 09:30 UTC **falló con "job startup timeout"**, igual que el de las 10:30, 14:30, 15:32, 16:30 y 17:30. Es el incidente de Supabase de hoy. Volvió a andar a las 18:30, pero ya fuera de la hora 3.
- Resultado: ninguna corrida con catálogo. "Sincronizar ahora" habría alcanzado, pero nadie lo apretó.

**Arreglos, para que no se repita y para que no falle en silencio:**
1. **Ponerse al día.** `metrics-sync` encola también fuera de las 3 a. m. si `last_synced_at` tiene más de 26 h, o si la cuenta nunca completó el catálogo (`catalog_synced_at` vacío). Es una regla pura en `lib/metrics/rules.ts` con test.
2. **Un lote del catálogo que no se pudo guardar cuenta como incompleto.** Hoy `upsertChunks` (`catalog-store.ts:21-32`) solo lo loguea y `catalog_synced_at` avanza igual, así que el siguiente sync es incremental y esas filas no vuelven nunca. Pasa a devolver `{written, failed}`, `failed > 0` deja `complete=false` y se anota en `last_error`.
3. **Sin token:** hoy el handler vuelve sin anotar nada (`meta-ads-sync.ts:196-200`). Pasa a dejar `last_error = "Falta el token de Meta"`.
4. Test con Meta simulado: catálogo vacío más un lote que falla da incompleto y una nota. Un cron perdido hace que la regla de ponerse al día encole.
5. Al aplicar, Wendy (o yo con su OK) aprieta "Sincronizar ahora" para llenar el catálogo hoy mismo.

#### 3. `actions` en `meta_ads_insights_daily` y qué columnas de E2 se pueden calcular

Tipos presentes (filas / total): `post_engagement`, `page_engagement`, `link_click` (998 / 116k), `onsite_conversion.messaging_conversation_started_7d` (888 / 6.188), `messaging_first_reply`, `total_messaging_connection`, `post_reaction`, `lead` (616 / 1.872), `offsite_search_add_meta_leads`, `offsite_complete_registration_add_meta_leads`, `onsite_conversion.lead_grouped` y `offsite_content_view_add_meta_leads` (613 / 1.860 cada una, **duplicados de `lead`**), `landing_page_view`, `omni_landing_page_view`, `video_view` (399 / 573k), `post_save`, `like`, `comment`, `offsite_conversion.fb_pixel_lead` (12), `onsite_web_lead` (12), y algunas más menores. **No hay `purchase`, `schedule`, `submit_application` ni `view_content`.**

Columnas propias con dato: `reach`, `link_clicks` y `outbound_clicks` en casi todas las filas; `video_p25`…`p100` y `thruplays` en unas 100 filas de anuncio; `video_avg_time_seconds` solo en 5; rankings en las 416 de anuncio; `purchases` y `purchase_value` en 0; `effective_status` en 0.

| Columna E2 | ¿Se puede hoy? | Fuente |
|---|---|---|
| Alcance, Frecuencia, CPM, CPC | Sí (ya existen) | columnas |
| Clics en el enlace, CTR del enlace, CPC del enlace | Sí | `link_clicks` |
| Reproducciones de 3 s, costo, hook rate | Sí | `actions.video_view` |
| ThruPlays, hold rate | Sí, con poco dato | `thruplays` |
| Retención al 25/50/75/100 % | Sí, con poco dato | `video_pXX ÷ video_view` |
| Tiempo promedio visto | Sí, casi sin dato (5 filas) | `video_avg_time_seconds`, promedio ponderado por `video_view` en el Total |
| Vistas de contenido y costo | Calculable; hoy "—" | `view_content` / `omni_view_content` / `offsite_conversion.fb_pixel_view_content`. **No** `offsite_content_view_add_meta_leads`, que es un lead. |
| Aplicaciones y costo | Calculable; hoy "—" | `submit_application` / `offsite_conversion.fb_pixel_submit_application` |
| Agendas Meta y costo | Calculable; hoy "—" | regla `/schedule/i` (ya existe) |
| Compras Meta, costo, valor, ROAS Meta | Calculable; hoy "—" | `purchases` / `purchase_value` (con la misma regla anti-duplicado que leads) |
| Ranking de calidad, interacción y conversión | Sí (solo anuncio) | el valor del último día con dato; "—" en el Total |
| Asistidas y costo; UF cash; UF ROAS; Costo por nuevo deal | Sí | `ads_crm_metrics_v2` |
| Campaña, Conjunto, Estado, Publicación, Objetivo, # anuncios | Nombres sí, con los insights como respaldo. Estado, Publicación y Objetivo solo con catálogo. | catálogo + insights |

No hace falta sumar campos a `FIELDS` de `lib/meta/insights.ts`: todo lo de E2 ya se pide. **Sugerencia para el PENDIENTE, no se construye:** una columna "Conversaciones iniciadas" (`messaging_conversation_started_7d`), que es la conversión principal de esta cuenta.

#### 4. Punto de partida (14/10, sin tocar nada)

| Comando | Resultado |
|---|---|
| `npx vitest run` | **874 archivos, 10.998 tests, todos en verde** (40 s) |
| `npm run lint` | **0 errores, 36 avisos** (directivas `eslint-disable` sin usar) |
| `npm run build` | **No se corrió en el modo plan**: regenera `public/embed/embed.js`, un archivo que se commitea. Va en el paso 1 de la ejecución. |
| `scripts/verify-*.mjs` | **No se corrieron en el modo plan**: escriben en la base de producción, y Supabase está con incidente (pooler bloqueado y crons con "job startup timeout"). Van en el paso 1, de a uno, con el candado `/private/tmp/ssa-verify.lock`, cuando Supabase esté estable. |

Flags a usar: `verify-rls --despues-de-00143`, `verify-roles --despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212`, `verify-permissions-matrix --despues-de-00212`, `verify-workspace-isolation --despues-de-00143`, `verify-audit-visibility --despues-de-00168`, `verify-sales`, `verify-tasks` y el resto sin flags. Lo que ya falle se anota en "Punto de partida" y no puede empeorar. Lo que ya se sabe del PENDIENTE de atribución:
- `verify-forms` y `verify-publishing` a veces fallan;
- `verify-attribution` tiene un caso de datos (776 de 835).

Migraciones: repo y base **coinciden en `00215`**. **La primera libre es la `00216`**; se confirma otra vez con `list_migrations` antes de escribir.

#### 5. Lecturas que asumen contacto o persona (D1) y cómo queda cada una

| Lugar | Hoy | Después |
|---|---|---|
| `engine.ts:135-150`, insert de sesión | `member_user_id` solo sin contacto; `inbound_webhook_id` si viene | Guarda además `source_type` y `source_id` desde `context.source`. Con contacto: `contact`. |
| `engine.ts:35-60`, `findWaitingSession` | Exige contacto y canal | **Igual.** "Esperar respuesta" necesita contacto. |
| `engine.ts:157-163, 326-332, 449-470`, eventos `flow_started`, `node_executed`, `flow_completed` | Usa `contactId`, que es null sin contacto | Igual con contacto. Sin contacto, se guardan con `metadata.source`. |
| `nodes/delay.ts:20-54`, job `resume_flow` | Payload sin `inboundWebhookId` ni origen | Suma `source` e `inboundWebhookId` en el payload, solo como respaldo. |
| `cron/jobs/route.ts:622-739`, `resume_flow` | `contactId` del payload; sin webhook; sin los ganchos `onStepSkipped` | Lee `contact_id`, `member_user_id`, `inbound_webhook_id` y el origen **de la sesión** (el payload solo como respaldo); vuelve a enganchar los ganchos; al terminar o fallar una sesión de webhook actualiza el envío (C3). |
| `nodes/go-to-flow.ts:29-52` | Hereda contacto, persona y webhook | Hereda también el origen. Un destino sin contacto funciona desde cualquier flujo. Uno que necesita contacto y no lo tiene se saltea y queda anotado (como hoy). |
| `lib/flow-engine/automation-events.ts:35-46, 187-271` | Rama contacto / persona; un evento de contacto sin contacto lanza | La rama de contacto **no cambia**. Sin contacto, rama por `source_type`: `member` (la de hoy) o `system`/`task` (la nueva genérica). `switch` explícito, sin `else`. |
| `app/api/cron/automation-events/route.ts:38-73` | Lee `contact_id` y `member_user_id` | Lee además `source_type` y `source_id`. |
| `registry.ts:213-230`, `eventSubject` y `eventAllowsNoContact` | Solo devuelven `contact` o `member` | Suman `system`; cada disparador declara `sourceType`. |
| `lib/inbound.ts:583-603` y `lib/agent/runner.ts:252,891`, reanudar al recibir un mensaje | Por contacto y canal | **Igual** (solo aplica con contacto). |
| `lib/contacts/history.ts` y la ficha | `analytics_events` por `contact_id` | **Igual**: una sesión sin contacto no aparece en ninguna ficha, y está bien. |
| `lib/flow-engine/simulator.ts:323-331` | Supone contacto | Modela el salteo de los pasos `needsContact` cuando el sujeto no es `contact`, con el mismo `contact-requirement`. |
| `contact-requirement.ts`, `member-flow.ts` y `contact-free.ts` (validador del editor) | Sujetos `webhook` y `member` | Suman `system`; `goToFlow` a un destino `system` no pide contacto; D3 y D4 entran a la lista de pasos que no necesitan contacto. |
| `lib/webhooks/sweep.ts:32` | Borra las sesiones de webhook sin contacto ni persona antes de borrar los envíos (por el CHECK) | Igual (sigue haciendo falta). |
| `lib/contacts/merge.ts`, `lib/tasks/automation/emit.ts`, `tasks-due-sweep.ts` y `submit_eod_report` (SQL) | Por contacto o persona | El trigger de la base completa el origen solo; los que emiten código nuevo lo pasan explícito. |
| Scripts `verify-inbound-webhooks`, `verify-webhook`, `verify-eod` y `verify-tasks` | Insertan sesiones y eventos | Siguen pasando: el CHECK nuevo acepta todo lo que acepta el viejo. |

---

#### 6. Plan por bloque (orden de ejecución)

**Paso 0 (pedido por Wendy):**
1. En `docs/PROGRESS-atribucion.md`, nueva sección `## Correcciones (Tirón 2)` antes de `## Punto de partida`, con este plan, los bloques A–E como checklist, "Punto de partida" y "Migraciones" con números reales.
2. Commit `docs: plan de correcciones del Extra L` y push.
3. **FRENO y espero el `/goal`.**

**Paso 1:** `npm run build` y cada `verify-*` de a uno, para fijar el punto de partida.

**Paso 2:** tests de caracterización ANTES de tocar nada:
- el motor y el cron con contacto: `resume_flow`, `goToFlow`, `delay`;
- EOD sin contacto;
- el webhook actual: recepción, `run-flows` y reproceso;
- la tabla Meta vs CRM actual: `buildCrmRows`, `totalRow` y el CSV;
- el detalle de una pieza sin anuncio.

Commits por tramo, en este orden (cada uno con `npx vitest run` en verde y PROGRESS marcado):
- `fix: atribucion - bloque D (origen de las automatizaciones)` (D1–D2)
- `bloque C`
- `bloque E (catalogo)` (E1)
- `bloque B`
- `bloque E (columnas)` (E2–E4)
- `bloque A`
- `bloque D (envios sin contacto)` (D3–D5)

##### D1–D2 · El origen de cada automatización (primero)
- **Migración `00218_automation_source`** (aditiva). Cada paso:
  - `source_type text` y `source_id text` en `flow_sessions` y `automation_events`.
  - CHECK de valores: `contact|member|webhook|task|form|booking|sale|call|system`.
  - Backfill: `inbound_webhook_id` da `webhook`, `member_user_id` da `member`, `contact_id` da `contact`.
  - Trigger `BEFORE INSERT` que completa el origen si viene vacío, para que el código viejo siga andando mientras se despliega.
  - CHECK nuevo, que es un **superconjunto** del viejo: lo viejo `OR source_type IS NOT NULL`. Se crea con `NOT VALID` y se hace `VALIDATE`.
  - Se borra el CHECK viejo.
  - La cabecera lleva las dos definiciones viejas, letra por letra. `member_user_id` e `inbound_webhook_id` quedan.
- **Registro** (`registry/types.ts`):
  - `subject` admite `system`.
  - Cada disparador declara `sourceType`.
  - `consistency.test.ts` exige que todos lo declaren.
  - `registry-characterization` y `triggers-characterization` se actualizan solo con lo nuevo.
- **Motor y cron**:
  - `context.source` en `ExecutionContext`.
  - Insert de sesión, `delay.ts`, `go-to-flow.ts`, `resume_flow` (lee de la sesión) y `automation-events.ts` (rama `system`).
- **Test pedido:** webhook sin contacto → Esperar → Ir a otro flujo → el destino arranca y corre sus pasos sin contacto.
- **Test de caracterización:** los flujos con contacto dan exactamente el mismo resultado.
- **D2:** en `docs/flow-registry.md`, una tabla con cada paso, si necesita contacto y por qué. Los pasos de agenda y ventas (`cancel_booking`, `set_booking_status`, `mark_payment_paid`, `reschedule_payment`, `set_sale_status`) se verifican: hoy dicen `needsContact:true`, pero lo que necesitan es la agenda o la venta del disparador. Se ajusta el **mensaje** del validador para que lo diga ("necesita la reunión del disparador"), sin aflojar la regla.

##### C · Webhooks
- **C1:** `occurredAt = received_at` en `lib/webhooks/upsert-contact.ts:304`. Test: un reproceso viejo conserva su fecha.
- **C2, recepción. Migración `00216_inbound_receive_lock`:**
  - `public.receive_inbound_webhook(...)`, SECURITY INVOKER (la llama el cliente de servicio), `SET search_path=''`, `EXECUTE` solo para `service_role`.
  - Hace `pg_advisory_xact_lock(hashtextextended(endpoint_id || coalesce(external_event_id, body_hash), 0))`, verifica (el id propio o el mismo cuerpo en 10 min), inserta como `received` o `ignored` y devuelve `{id, status, duplicate}`.
  - `server-ports.ts` la usa en lugar de SELECT + INSERT. El orden de validaciones de `receive.ts` no cambia.
  - Test en `verify-inbound-webhooks.mjs`: dos inserciones en paralelo dan una `received` y una `ignored`.
- **C2, reproceso:**
  - Clave nueva: `webhook:<inbound>:<flow>`, sin el contador.
  - **Migración `00217_webhook_fire_keys`:** inserta la clave nueva por cada clave vieja (`ON CONFLICT DO NOTHING`), para que lo que ya corrió no vuelva a correr al desplegar.
  - Si un flujo falla, se libera su clave.
  - `reprocessInbound(..., {rerunCompleted})`: con la casilla, borra antes las claves de ese envío y lo audita con `logAudit`, con quién lo pidió y `rerun_completed: true`.
  - UI: casilla "Volver a correr también los flujos que ya corrieron", apagada por defecto, con la advertencia "puede mandar mensajes repetidos", en `inbound-drawer.tsx` y en el reproceso masivo de `endpoint-detail.tsx`.
  - Tests:
    - reprocesar dos veces corre el flujo una sola vez;
    - con la casilla vuelve a correr y queda auditado;
    - dos procesamientos simultáneos del mismo envío corren el flujo una vez (el `processInbound` ya toma el envío de forma condicional, y la clave única lo cierra).
- **C2, "una sola vez por contacto":**
  - Opción `oncePerContact` en `WebhookTriggerPanel`, apagada por defecto.
  - Como el contacto recién se conoce en "Crear o actualizar contacto", ahí se toma `trigger_fires(trigger, 'webhook-contact:<flow>:<contact>')`. Si ya existía, la sesión termina anotada como "ya pasó por este flujo". Sin migración.
  - Si el flujo tiene un paso que manda un mensaje, el panel muestra una sugerencia corta.
- **C3:**
  - El update de `flow_sessions` en `nodes/upsert-contact.ts` lanza si falla.
  - `run-flows` ya lo convierte en `error` con el motivo.
  - Nuevo `lib/webhooks/session-result.ts`: al terminar o fallar una sesión de webhook reanudada, recalcula `inbound_webhooks.result` y `status`.
  - Test.
- **C4:** en `lib/webhooks/retention.ts`, una función pura `stripWebhookCopies(variables)`.
  - `sweep.ts` vacía `variables.webhook.payload` y `.query` de las sesiones terminadas hace más de 90 días, y el `payload.variables.webhook` de los jobs `resume_flow` terminados de esa antigüedad.
  - Sin migración. Test de la función pura y del barrido con datos simulados.

##### E1 · Catálogo (ver el punto 2)
- Arreglos 1 a 4 del punto 2.
- **Respaldo cuando falta una fila del catálogo:** función pura `resolveRowInfo(catalog, insights)` en `lib/dashboards/ads-crm.ts`.
  - Nombre y padre salen de `object_name` y `parent_name`.
  - La campaña y el conjunto salen de los insights de esos niveles, usando `campaign_id` y `adset_id`.
  - Sin estado, "Sin estado".
  - Tests: con catálogo, sin catálogo y mezclado.
- **Aviso** "Ningún contacto de este período trae datos de anuncio…": aparece cuando hay gasto en el período y 0 toques vinculados. Enlaza a `docs/atribucion.md#guia-parametros-de-url-para-los-anuncios`.
- **Leads Meta (decisión 1):**
  - `countLeads` y `countPurchases` en `lib/meta/insights.ts` cuentan solo el canónico: `lead`; si no está, `onsite_conversion.lead_grouped`; si no, `offsite_conversion.fb_pixel_lead`. Para compras: `omni_purchase`, si no `purchase`.
  - Los casos van en `lib/meta/action-counts.cases.json`, compartidos con la gemela SQL.
  - Se corrige el test que hoy espera la suma de duplicados (`insights.test.ts:30-35`).
  - **Migración `00220_meta_leads_recount`:** antes, un respaldo en `docs/atribucion/respaldo-leads-meta.json` (id, `leads`, `purchases`). Después, un `UPDATE` con la misma regla desde `actions`.
  - **Se aplica DESPUÉS de desplegar el código**: si no, el próximo sync con el código viejo vuelve a escribir los días recientes inflados. Queda escrita y ensayada, sin aplicar, anotada en el PENDIENTE.

##### B · Tabla Meta vs CRM
- **Migración `00219_ads_crm_metrics_v2`** (aditiva; la v1 queda para volver atrás):
  - `ads_crm_metrics_v2(...)`, SECURITY INVOKER y STABLE, con los mismos filtros.
  - Suma `is_total boolean`: una fila extra con `leads_total = count(DISTINCT contact_id)` de todo el período y filtro, en la misma consulta.
  - Suma `uf_cash_cents`: el primer pago `paid` positivo de cada venta, por `paid_at`.
  - Los objetos de la cuenta salen del catálogo más los insights (punto 1, fila 22).
- **Función hermana `ads_crm_cell_detail(p_level, p_object_id | null=Total, p_metric 'leads_new'|'leads_total'|'bookings'|'sales', fechas, cuenta, workspace, p_limit=50, p_offset)`:**
  - INVOKER, misma lógica de filtros.
  - Devuelve id, nombre, fecha del toque, origen, fecha de la reunión o monto, y `total_count`.
  - **Test en `verify-ads-attribution`:** `total_count` es igual al número de la celda, para cada métrica y el Total.
- **B1:** columnas "Leads nuevos" (`leads_first`), "Leads totales", "CPL nuevo" y "CPL total", cada una con su tooltip.
  - Reemplazan a Leads CRM, Leads 1er toque, Leads totales y CPL real.
  - Las cuentas van en `lib/dashboards/ads-crm.ts`.
  - Tarjeta nueva en la fila de KPIs del dashboard de Ads: "Leads CRM: N nuevos · M totales", con "CPL USD X nuevo · USD Y total".
- **B2:**
  - `components/dashboards/ads/crm-cell-panel.tsx` sobre `Sheet`: vacío, cargando y error; en el celular, pantalla completa.
  - Server action `loadCrmCell`, con el cliente del usuario. Los datos se piden solo al abrir el panel.
  - Lo que se muestra va en `lib/dashboards/ads-crm-detail.ts` (puro): los enlaces a la ficha, la agenda y la venta.
- **B3:**
  - Fila Total: Leads nuevos y agendas/ventas por suma; Leads totales desde la fila `is_total`.
  - CPL total y Lead→Agenda calculados sobre esos totales.
  - Test: 1 contacto, 2 anuncios y gasto 100 dan Total de Leads totales = 1 y CPL total = 100.
  - Nota al pie nueva (movida a `lib`).
- **B4:**
  - `EXPLAIN ANALYZE` sobre los datos reales (se anota, aunque hoy no dice nada) y sobre los 10.000 toques sintéticos.
  - Si el costo extra pasa los 300 ms o duplica la consulta actual: suma simple con el tooltip "puede contar dos veces a quien tocó varios anuncios".
  - Se anota en el PENDIENTE.

##### E2–E4 · Columnas y selector
- **Catálogo** (`ads-crm-columns.ts`): grupos `info`, `meta` (con subgrupos Entrega, Clics, Video, Conversiones, Calidad), `metaVsCrm` y `crm`.
  - Cada columna lleva su tooltip y una lista de niveles donde aplica (`levels`): la miniatura solo en anuncio, Objetivo solo en campaña, Calidad solo en anuncio, # anuncios en campaña y conjunto.
  - Las columnas de E2 van ocultas.
  - El default es el de E3.
  - Las duplicadas se unifican (decisión 4).
  - Las cuentas van en `lib/dashboards/ads-crm.ts` y en `lib/dashboards/ads-meta-metrics.ts` (nuevo, puro).
  - El Total recalcula los cocientes desde los totales. Alcance y frecuencia van en "—" con su tooltip.
- **Carga:** `ads-crm-load.ts` agrega los campos de video, link y rankings desde `ads-load.ts` (ya los selecciona). El catálogo suma `objective`, `instagram_media_id` y `object_story_id`.
- **Preferencias** (`ads-columns.ts`):
  - `DEFAULT_VERSION` y el mapa `REPLACED_COLUMNS`: `cplReal` pasa a `cplNew` y `cplTotal`; `leadsCrm` y `leadsFirst` pasan a `leadsTotal` y `leadsNew`; `bookingsCrm` pasa a `bookings`; `cac` y `costPerClose` pasan a `costPerNewDeal`.
  - Quien nunca tocó nada ve el default nuevo.
  - Quien eligió sus columnas conserva su elección; las nuevas le aparecen ocultas y las viejas se reemplazan.
  - Test de las tres situaciones.
- **Selector** (`columns-menu.tsx`): buscador arriba, subtítulos dentro de Meta y "Restablecer" al default de E3.
  - Las flechas se quedan.
  - Arrastrar para reordenar con HTML5 drag and drop nativo, sin dependencias; las flechas siguen andando con teclado.
  - La lógica del filtro de búsqueda y del orden es pura y tiene test.
- **CSV:** visibles y en orden (ya lo hace); se suman las nuevas.

##### A · Anuncios y contenido
- **A1:**
  - En el `after()` de `app/api/webhooks/late/route.ts`, si un mensaje de Instagram no trae una referral usable, se encola el job `zernio_ad_origin` con clave `zernio-ad-origin:<conversationId>` (una vez por conversación). Hay que verificar si la clave de `scheduled_jobs` es permanente. Si no lo es, se suma la marca en la conversación sin migración: `conversations` ya tiene un jsonb de metadatos (a verificar; si no, va en la 00221).
  - El handler llama a `getInboxConversation`. Si trae `meta_ad_id`, hace merge en `messages.origin_context` del primer mensaje entrante y llama a la **migración `00221_touch_ad_origin`**.
  - `public.enrich_touch_ad_origin(p_workspace_id, p_dedupe_key, p_ad_id, p_title, p_post_id)`, `service_role`, SECURITY DEFINER con `search_path=''`:
    - completa el anuncio en el toque solo si no tenía uno y no es `manual` ni `ignored`;
    - resuelve el vínculo con `resolve_meta_match`;
    - recalcula con `private.refresh_contact_attribution`.
  - Nunca lanza. Si Zernio no trae nada, no hace nada. Zernio simulado en los tests, inyectado como en `inbox-sync.test.ts`.
- **A2:**
  - Acciones en `lib/actions/content-ad-link.ts`: `linkAdToPiece`, `unlinkAd`, `searchPiecesForAd` y `searchAdsForPiece`.
    - Piden `content.create` + `dashboards.ads.view` y escriben con el cliente de servicio filtrando por el workspace de la sesión.
    - Desvincular vacía los ids y pone `content_link_manual=false`.
    - Todo queda en `logAudit` (se suma `meta_ad` a `AuditEntityType`).
  - Menú "⋯" (`PopoverMenu`) en `ads-detail-view.tsx`, solo en el nivel anuncio, y en el encabezado de `piece-drawer.tsx`. El buscador va en un `Sheet` con título, fecha y miniatura.
  - Sección "Publicidad" (`components/content/drawer/piece-ads-section.tsx`):
    - aparece solo con al menos un anuncio vinculado;
    - los números salen de `ads_crm_metrics_v2` (nivel anuncio) más el gasto, las impresiones y los clics de los insights;
    - la lógica va en `lib/meta/content-ad-summary.ts` (puro; tests con 0, 1 y varios anuncios);
    - test: sin anuncio, el detalle queda idéntico.
  - Lista de Contenido: indicador "Pautada" y filtro `?pautada=si|no` en `lib/content/filters.ts`.
- `lib/meta/content-link.ts` no cambia.

##### D3–D5 · Envíos sin contacto
- **D3: paso NUEVO "Enviar WhatsApp a un número"** (`send_whatsapp_number`, `needsContact:false`). Se elige un paso aparte, y no una opción adentro de "Enviar mensaje", porque deja `sendMessage` intacto, con riesgo cero para los flujos que ya existen.
  - Destino: un número fijo (normalizado con `normalizePhone` de `lib/phone.ts`) o una variable.
  - Canal: el editor obliga a elegir uno de WhatsApp; si no hay, muestra "Conectá un WhatsApp en Canales para usar este paso".
  - Texto con variables y archivo opcional.
  - `findContact` (modo `find_only`):
    - número de un contacto con "No contactar": no se manda y queda anotado;
    - número de un contacto con conversación en ese canal: el mensaje se guarda ahí;
    - número sin contacto (o contacto sin conversación en ese canal): se manda igual y queda en el historial del flujo, con número, texto y resultado, sin crear nada.
  - Se manda con el cliente de Evolution (`lib/evolution-message.ts`), con el tope `claim_automated_send` de 200 por hora.
  - "Nunca dos veces": **migración `00222_flow_send_claims`**, una tabla chica `(session_id, node_id, target)` con unique, RLS activada y sin policies (solo el servidor).
  - Tests con Evolution simulado: número fijo, variable vacía, número de un contacto con "No contactar", número desconocido, sin canal y tope por hora.
- **D4:** `send_email` suma `to: "variable"` con `toVariable`.
  - Se valida en ejecución; si la dirección no es válida, se saltea con el motivo.
  - Si la dirección es de un contacto con "No contactar", no se manda.
  - Con ese destino, `needsContact` sigue en false.
  - Se suma al editor.
- **D5:** en el PUT de `flows/[flowId]`, si el flujo está publicado se valida con `edges` y `{publishing:true}`. Si no pasa, 422 con el motivo. Test.

#### 7. Migraciones (números reales, a confirmar con `list_migrations`)

| # | Qué | Cuándo se aplica | Cómo volver atrás |
|---|---|---|---|
| 00216 | `receive_inbound_webhook` con lock | Antes del deploy (aditiva) | `DROP FUNCTION` |
| 00217 | Claves nuevas de `trigger_fires` para webhooks | Antes (solo inserta) | `DELETE` de las claves sin `:n` |
| 00218 | `source_type`/`source_id`, trigger, backfill, CHECK superconjunto | Antes (el código viejo sigue andando) | Recrear los CHECK viejos de la cabecera, `DROP TRIGGER`, `DROP COLUMN` |
| 00219 | `ads_crm_metrics_v2` + `ads_crm_cell_detail` | Antes | `DROP FUNCTION` (la v1 queda) |
| 00220 | Recalcular `leads`/`purchases` de Meta | **Después del deploy**, con respaldo | `UPDATE` desde `respaldo-leads-meta.json` |
| 00221 | `enrich_touch_ad_origin` | Antes | `DROP FUNCTION` |
| 00222 | `flow_send_claims` | Antes | `DROP TABLE` |

Para todas:
- Idempotentes, con "Cómo volver atrás" en la cabecera.
- Se aplican con `supabase db query --linked -f` y se registran en `schema_migrations`.
- Después, `node scripts/build-all-migrations.mjs`.
- `verify-*` con las huellas de `record_contact_touch`, `find_or_link_contact`, `find_contact_for_form`, `submit_form_response`, `create_booking` y `find_or_create_contact` iguales a las del Tirón 1.
- Si una verificación falla: PARO y lo anoto en `docs/PENDIENTE-atribucion.md`.

#### 8. Riesgos

- **Cambiar el CHECK de tablas en producción (00218):** se mitiga porque el CHECK nuevo es un superconjunto del viejo, el trigger completa el origen, se crea con `NOT VALID` + `VALIDATE`, y hay caracterización del motor antes de tocar.
- **Clave de webhooks:** sin la 00217, un reproceso después del deploy correría de nuevo lo que ya corrió.
- **Recalcular leads (00220):** cambia números que la gente ya vio; los nuevos son los correctos. Tiene respaldo y se aplica después del deploy.
- **Supabase inestable hoy:** los `verify-*` y las migraciones esperan a que esté estable. Si el pooler sigue bloqueado, PARO y aviso.
- **Revisión visual:** necesita sesión en el navegador integrado. Si pide login, lo anoto y no escribo credenciales.

#### 9. Verificación

- `npx vitest run` después de cada requisito.
- `npm run build` y `npm run lint` al cerrar cada bloque.
- `verify-inbound-webhooks` (lock, reproceso, una vez por contacto), `verify-ads-attribution` (v2, detalle = celda, medición B4, huellas), `verify-eod`, `verify-tasks`, `verify-forms`, `verify-sales`, `verify-rls`, `verify-roles` y `verify-permissions-matrix`, de a uno y con candado.
- **Revisión visual** a 1440 y 390 px, en tema claro y oscuro:
  - la tabla con los dos CPL, el panel y el detalle;
  - las columnas por defecto, el selector con buscador y una columna nueva;
  - el dashboard de Ads;
  - la pieza con y sin anuncio;
  - los menús "⋯";
  - el reproceso con la casilla;
  - el paso de WhatsApp;
  - "Enviar email" con variable.
- **Cierre:**
  - actualizar `docs/webhooks.md`, `docs/atribucion.md` (con la lista de columnas), `docs/flow-registry.md` (tabla D2) y `docs/PENDIENTE-atribucion.md` (tachar lo resuelto);
  - en el `CLAUDE.md`: la regla de origen, "un envío nunca dispara dos veces el mismo flujo" y la próxima migración libre (00223);
  - `gh pr create` sin mergear.

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
| M7 | `00192_meta_touch_match` | vínculo con Meta (columnas, funciones, trigger) | AT3 | **aplicada y registrada** (`20261013070616`), verificada |
| M8 | `00193_meta_touch_backfill` | backfill del vínculo | AT3 | **aplicada y registrada** (`20261013071034`), verificada |
| M7b | `00194_meta_match_signal` | **corrección de la 00192** (no estaba en el plano): solo cuentan como datos de Meta los toques que pueden traer UTMs de verdad | AT3 | **aplicada y registrada** (`20261013071154`), verificada |
| M9 | `00195_ads_crm_metrics` | `ads_crm_metrics` + índices (corre un número: la 00194 se usó para corregir la 00192) | AT4 | **aplicada y registrada** (`20261013073102`), verificada |

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
| M9 | `00195_ads_crm_metrics` | `ads_crm_metrics` (INVOKER) + índices | AT4 | Bajo |

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

- **M9 (00195, antes 00194):** `ads_crm_metrics(p_level, p_since, p_until, p_ad_account_id)` SECURITY INVOKER, STABLE,
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
  migración libre (00196 si no aparece otra).
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


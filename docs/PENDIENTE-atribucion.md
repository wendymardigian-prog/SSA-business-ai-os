# Pendiente · Webhooks entrantes, atribución y anuncios (Extra L)

Formato de cada entrada: **qué quedó**, **por qué**, **qué se decidió**.
Avance: [PROGRESS-atribucion.md](PROGRESS-atribucion.md).

## Punto de partida

- **`verify-attribution.mjs` falla antes de empezar.** Un caso, "todos los contactos reales tienen
  first_touch" (775 de 834). Es una comprobación de datos del backfill de la 00115 sobre contactos reales:
  los contactos creados después no tienen toque. Ya lo había anotado Formularios. **Decidido:** se anota y
  no puede empeorar; los demás casos pasan. El conteo sube solo con cada contacto nuevo sin toque.
- **`verify-sales.mjs` falla antes de empezar.** Un caso, "con todas las reglas en manual, crear un
  contacto NO encola nada" (00161). **Decidido:** no es de este módulo; se anota y no puede empeorar.
- **`verify-knowledge.mjs` no se corre** (llama a Voyage de verdad, con costo) y **`verify-webhook.mjs`
  tampoco** (necesita la app corriendo en local). Mismo criterio que Formularios.
- **`verify-rls`, `verify-roles` y `verify-workspace-isolation`** se corren con los flags
  `--despues-de-00143`, `--despues-de-00136` y `--despues-de-00147`, como dejó Llamadas. Ojo con zsh: una
  variable con varios flags sin comillas llega como UN solo argumento; pasarlos escritos a mano.

## Decisiones tomadas con Wendy (12/10/2026)

- **#254 → "solo el último".** Un contacto que ya existía y no tenía toques recibe antes un toque ancla
  `manual` (fecha de creación del contacto) y después el toque del webhook, así `record_contact_touch` no
  se toca.
- **"Asistió"** = `status_group = 'outcome'` de la agenda (el estado "asistió" no existe).
- **Ventas "no canceladas"** = se excluyen `cancelled` y `refunded`.
- **#260** reprocesar vuelve a mandar mensajes, con aviso y confirmación.

## Verificación en vivo (la hace Wendy, §11 del plano)

Pendiente hasta el final de la corrida; se completa con el resultado de cada punto.

- Formulario externo real (Framer, Typeform o Tally) → webhook → contacto con UTMs; repetir el envío no duplica.
- Respuesta a una historia, mención en una historia, anuncio de mensaje a Instagram (**pendiente desde la
  Fase 3**), anuncio de clic a WhatsApp, comentario en un anuncio.
- Agenda desde una landing con `?utm_content={{ad.id}}`; la misma persona navegando a la agenda sin
  parámetros usa la cookie.
- Parámetros de URL de los anuncios en Meta (`utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`).
- Revisión visual en la app con sesión, si no se pudo hacer en la corrida.

## Entradas de la corrida

### WH1 — decisiones que se apartan del plano (qué quedó, por qué, qué se decidió)

- **Las dos tablas de webhooks no tienen policies de INSERT, UPDATE ni DELETE para `authenticated`.** El plano
  decía "INSERT, UPDATE y DELETE con `flows.edit`". **Por qué:** el token se genera en el servidor y no tiene que
  pasar por el navegador, y `has_permission` devuelve false para el Member de sistema (sus claves viven en
  `lib/auth/permissions.ts`) aunque tenga `flows.edit`. **Decidido:** escribe solo el servidor (Server Actions con
  `getPermissionAction("flows.edit")`), la lectura de la pantalla también va por el servidor después de chequear
  el permiso en TypeScript, y la RLS (`has_permission`) queda como segunda barrera más estricta. Lo prueba
  `verify-inbound-webhooks.mjs`.
- **No hay columna `rejected_count_24h`.** El plano dejaba elegir entre esa columna y el limitador. **Decidido:** los
  rechazos por tope los cuenta `bump_rate_limit` (clave `hooks:<endpoint>`, 600 por hora); no se guardan.
- **`webhook_endpoints` suma `last_error_alert_at`** (el último aviso de errores, para avisar una vez por hora) e
  **`inbound_webhooks` suma `processing_started_at`** (el reaper rescata los `processing` colgados: los marca `error`
  para que una persona los reprocese, no los vuelve a correr solos porque ya pudieron mandar mensajes).
- **La retención a 12 meses (borrar la fila) necesita, desde M2, borrar antes las sesiones de flujo terminadas sin
  contacto de ese envío** (su FK es `ON DELETE SET NULL` y dejaría una sesión que viola el CHECK). Hoy no hay
  ninguna; se agrega en WH2 junto con M2.
- **Revisión visual a 1440 px solo en tema oscuro**; el tema claro se miró a 390 px. Los componentes usan solo
  tokens de color (`bg-card`, `border-border`, `text-muted-foreground`…), sin `dark:`.
- **Reprocesar usa `confirm()` del navegador**, como otras confirmaciones simples del sistema.


### WH2 — decisiones y cosas que quedan (qué quedó, por qué, qué se decidió)

- **`verify-forms.mjs` es intermitente** (pasa al reintentar): el job que genera el PDF de un contrato lo toma el cron
  de producción en paralelo y el script ve «already». No es de este módulo y no se tocó; en el punto de partida pasó
  a la primera por suerte. Al cierre se corre hasta que pase y se muestra la salida.
- **Los pasos con contacto después de «Crear o actualizar contacto» toman la conversación MÁS RECIENTE del contacto**
  (igual que un flujo de agenda o del CRM). Un contacto recién creado no tiene ninguna: «Enviar mensaje» se saltea
  con motivo hasta que haya una conversación. Es lo que hace el motor hoy para esos casos; no se inventó otro canal.
- **Los tags «desde el payload» solo suman tags que ya existen** (comparación sin mayúsculas); el resto se ignora y
  queda anotado como nota (`tag_inexistente:<nombre>`). No se crean tags desde datos de afuera. Los tags fijos son
  ids de tags del negocio.
- **El conflicto de identidad** (teléfono de uno, email de otro): se usa el contacto del teléfono, no se fusiona, el
  dato en conflicto no se escribe, y queda en el resultado del envío y en el historial del contacto (`contact.linked`
  si no cambió nada, `contact.updated` si sí).
- **La sesión de un flujo y el aviso de «Esperar» llevan una copia del payload** (`flow_sessions.variables` y el payload
  del job `resume_flow`). La retención de 90 días vacía el envío, no esas copias: si hace falta, sumarlas a la purga.
- **El resultado de un flujo en «Esperar» queda como «En curso»**; lo que pase después de la espera (la reanudación la
  hace el cron de jobs) no se vuelca al historial del envío.
- **El panel del disparador queda abajo de la lista de tipos** (mismo patrón que Formularios y Ventas): conviene un
  rediseño del selector de disparadores en otra pasada.
- **Teléfono sin país conocido:** si la zona horaria del negocio no da un país, un número sin prefijo queda «solo
  dígitos» (como pide el plano). El negocio no tiene un campo de país por defecto.
- **Flujos `zz-test` viejos:** al limpiar los datos de la revisión visual se borraron 7 flujos con el prefijo
  `zz-test` que ya estaban en la base real (datos de pruebas de módulos anteriores).


### AT1 — decisiones y cosas que quedan (qué quedó, por qué, qué se decidió)

- **F20 (respaldo desde la conversación de Zernio) no se construyó.** Es nice-to-have y para probarla de verdad
  hace falta leer una conversación real de Zernio, cosa que esta corrida no puede hacer (nada externo real). Queda
  para una pasada con una cuenta conectada. El toque del mensaje ya guarda `origin_context`, así que no se pierde
  el dato desde ahora: lo que falta es recuperar el de mensajes viejos.
- **`verify-attribution.mjs` sigue con el mismo caso de datos** ("todos los contactos reales tienen first_touch",
  776 de 835; en el punto de partida eran 775 de 834). El contador crece solo porque entra un contacto nuevo sin
  toque; no es un cambio de código. El resto de sus casos pasa.
- **`verify-message-persistence.mjs` no verifica nada acá**: dice «No hay un canal de Zernio en este workspace». La
  columna `messages.origin_context` y el reintento sin ella (si la base no la tuviera) se cubren con los tests de
  `lib/inbound.test.ts`.
- **`buildDesiredTriggers` nunca persistió `storyReply`** (es anterior a este módulo). Solo se persisten los dos
  filtros nuevos (`fromAdOnly`, `storyMentionOnly`) y `storyReply` quedó como estaba. Conviene revisarlo aparte.
- **La ficha del contacto muestra ids crudos** (campaña, conjunto y anuncio) hasta que AT2 y AT3 traigan el
  catálogo de Meta: ahí pasan a ser nombres y miniatura.
- **Clic en la agenda con `gbraid`/`wbraid` y otras claves**: la agenda ahora acepta todas las claves de
  `TOUCH_KEYS`, así que dejan de precargarse como respuesta del formulario (cambio menor, previsto en el plan).
- **`create_booking` sigue poniendo `medium = 'booking'`** siempre; no se tocó (fuera del plano).


### AT2 — decisiones y cosas que quedan (qué quedó, por qué, qué se decidió)

- **F25 manual («Vincular con una pieza») no se construyó.** Era nice-to-have y el detalle del anuncio
  (`/dashboard/dashboards/ads/ads/[id]`) se toca en AT4. La columna `content_link_manual` y la regla «el automático
  no pisa uno manual» ya están y tienen test; falta solo la pantalla con el buscador de piezas.
- **El enlace con Contenido solo cubre Instagram.** `social_posts` no tiene Facebook (`SocialPlatform` son
  instagram, tiktok, youtube, linkedin, threads), así que `object_story_id` se guarda pero no enlaza nada. Si se
  suman publicaciones de Facebook, `matchPost` ya mira los dos ids.
- **Miniaturas: 3 intentos y esperas de 1 y 5 minutos** (no 1, 5 y 15). Con `thumbnail_attempts < 3` como tope,
  el tercer fallo ya no reintenta. Un sync posterior NO reinicia los intentos: un anuncio que agotó los tres queda
  sin miniatura hasta que alguien ponga `thumbnail_attempts = 0`. Si en la práctica la URL vence seguido, conviene
  reiniciarlos cuando cambie `thumbnail_source_url`.
- **El job de miniaturas se llama `meta_ad_thumbnails`** (con guion bajo, como el resto de los tipos del registro);
  el plano lo escribía con guiones.
- **`DELETED` en el filtro:** si el grafo lo rechaza con código 100 en la primera página, se lee sin él y queda en el
  log (no en `last_error`, porque no es un error de la cuenta). No se pudo comprobar contra el grafo real: la
  verificación en vivo (§11 del plano) tiene que mirar que los anuncios borrados aparezcan.
- **El catálogo incompleto se avisa en `last_error` de la cuenta** (tope de 50 páginas, límite de uso o error de
  Meta) y no avanza `catalog_synced_at`: el próximo sync pide desde la última vez completa.
- **«Sincronizar ahora» no se probó con un clic real**: encola un sync que llama a Meta de verdad. Está probado con
  tests (permiso, cuenta activada, dedupe por bloque de 10 minutos) y se vio el botón en el panel de la cuenta.
- **`verify-rls.mjs` necesita `--despues-de-00143`** (la 00143 ya está aplicada); sin la bandera falla un caso que
  describe el estado anterior a esa migración.


### AT3 — decisiones y cosas que quedan (qué quedó, por qué, qué se decidió)

- **La 00194 corrige la 00192 (no estaba en el plano).** El primer toque real que vio el backfill fue un comentario
  orgánico cuyo `content_label` es el TÍTULO de la publicación, no un UTM: la regla del plano («cualquier UTM con valor
  cuenta») lo dejaba «sin vincular / name_not_found», y lo mismo pasaría con todo comentario y DM orgánico. Ahora los
  ids y el `fbclid` siempre cuentan; `campaign`, `content_label` y `term` cuentan como UTMs solo si el toque puede
  traerlos (origen booking, form, webhook, import o manual) o ya trae un id de anuncio (un DM de un anuncio: el título
  del anuncio sirve para el nombre). Está en SQL (`private.meta_touch_has_data`, `resolve_meta_match_for_touch`) y en TS
  (`touchMetaInput`), con tests y casos en `verify-ads-attribution.mjs`. La 00194 también devolvió a `none` los toques que
  la 00193 había dejado `unmatched` sin tener datos de Meta (era 1) y recalculó la atribución de su contacto.
  Por eso **la migración de la tabla Meta vs CRM pasa de 00194 a 00195**.
- **`set_touch_meta_match` es una función pública más** (el plano pedía las acciones sobre `private.refresh_contact_attribution`,
  pero la API solo expone `public`): actualiza el toque y recalcula la atribución en la misma transacción, y devuelve el
  antes y el después para el historial. Solo `service_role`; el permiso y la visibilidad del contacto los chequea la
  Server Action con la sesión.
- **Reglas de resolución donde el plano no decía** (todas con caso en `meta-match.cases.json`, 29 casos que corren contra
  la función SQL y su gemela en TS):
  - la coherencia (`inconsistent_campaign`) aplica también cuando la campaña se halló por `utm_campaign` igual a un id;
  - el conjunto sigue el orden literal (`adset_id`, `utm_term`, el del anuncio) y NO se corrige contra el anuncio;
  - el `reason` de un toque `matched` puede traer avisos (`ambiguous_ad_name`, `id_not_in_catalog`, `inconsistent_campaign`);
  - `utm_campaign`, `utm_content` y `utm_term` se decodifican igual (`%XX` y `+`), no solo el contenido;
  - una campaña «existe» solo si está en `meta_campaigns` (no se infiere de un anuncio que la nombre).
- **El re-vínculo también retoma toques `matched` sin anuncio** que traen `ad_id` o `utm_content` (ampliación chica del
  plano): si el anuncio llega al catálogo después de la campaña, se completa. Nunca toca `manual` ni `ignored`.
- **`meta_match_status` solo se escribe en `contacts.attribution` cuando no es `none`** (si no, cada toque llevaría un
  `none` que no dice nada). El lector (`readAttribution`) ahora conoce las claves `meta_*`; el test de caracterización que
  fijaba lo contrario se actualizó con comentario.
- **Los toques UTM-only de fuentes que no son de Meta** (por ejemplo Google o email con `utm_campaign`) quedan
  `unmatched / name_not_found` y aparecen en «Sin vincular»: la función no recibe la fuente (el plano fija su firma).
  Si en la práctica hace ruido, conviene filtrar por fuente en el trigger (`source` de la fila) en vez de en la pantalla.
- **«Sin vincular» y la ficha usan la sesión de quien mira**: la lista respeta `can_see_contact` (RLS de `contact_touches`);
  los nombres y la miniatura salen del catálogo con la RLS de `dashboards.ads.view`, así que sin ese permiso la ficha
  muestra los ids. El buscador de «Vincular» usa el cliente de servicio después de `settings.manage` (el valor del
  usuario va como parámetro de un filtro, nunca dentro de una cadena de filtros).
- **El catálogo de producción todavía está vacío** (el sync nuevo corre cuando se despliega): la revisión visual de la
  ficha con NOMBRES y miniatura no se pudo hacer con datos reales; está cubierta con tests (`attribution-view.test.ts`,
  `meta-names.test.ts`). Para la revisión visual se cargaron cuatro toques `zz-test` sobre contactos existentes (sin crear
  contactos, para no disparar automatizaciones) y se borraron; la atribución de ese contacto se recalculó y quedó como antes.
- **Sobran workspaces «zz-test eod-… Workspace»** de corridas anteriores de `verify-eod` (su nombre usa un espacio, no el
  guion que barre `test-cleanup.mjs`): no son de este módulo y no se tocaron. Conviene ampliar el barrido.


### AT4 — decisiones y cosas que quedan (qué quedó, por qué, qué se decidió)

- **`ads_crm_metrics` es SECURITY INVOKER y bajo RLS tarda ~0,9 s con 10.000 toques en 90 días** (78 ms como superusuario).
  El plano pedía las dos cosas (INVOKER y < 300 ms) y no se pueden: cada fila de `contact_touches` evalúa la política
  `contact_touches_select` → `can_see_contact` (~35 µs por fila). Se eligió INVOKER (la RLS de quien mira decide qué cuenta;
  nunca se debilitó una política). Con los volúmenes reales (cientos de toques) son milisegundos. Si hiciera falta bajarlo,
  la salida es una política de lectura más barata para Owner/Admin en `contact_touches` (por ejemplo,
  `is_workspace_admin(workspace_id) OR EXISTS (...)`); no se tocó porque es una política de RLS y necesita tu aprobación.
  `verify-ads-attribution.mjs` mide las dos cosas (EXPLAIN ANALYZE como superusuario < 300 ms; punta a punta con RLS < 4 s).
- **`p_workspace_id` es un parámetro más** (quinto, opcional) de `ads_crm_metrics`: la función no puede adivinar el workspace de
  quien llama; sin él devuelve vacío. La pantalla siempre lo pasa.
- **Las fechas de la tabla**: la pantalla las resuelve con la zona de QUIEN MIRA y la función las interpreta en la zona del
  WORKSPACE (decisión #272). Si las dos zonas difieren, el borde del período puede correrse unas horas. Hoy coinciden.
- **`leads_total` no es aditivo**: un contacto que tocó dos anuncios cuenta en cada uno (y una vez en la campaña). Por eso la
  fila de Total de la tabla suma las filas y lo dice en una nota; el criterio «la suma de los anuncios = la campaña» vale para
  `leads_first`, agendas, ventas, revenue y cash (está probado) pero no para `leads_total`.
- **CAC y Costo por cierre dan lo mismo** (Gasto ÷ Ventas), como dice la tabla de definiciones del alcance (§4.3).
- **Agendas Meta** sale del evento `schedule` de `actions` (cualquier tipo que contenga «schedule»); si Meta no manda ese
  evento, la columna dice «—».
- **El estado de las pills sale del catálogo** (`effective_status`). Mientras el catálogo de producción esté vacío (hasta el
  primer sync con el código nuevo) las campañas muestran «—» y «Activos · 0». Se corrige solo con el primer sync.
- **F33, clic en un número del grupo CRM para abrir Contactos / Agenda / Ventas filtrados por el objeto y el período: NO se
  hizo.** Las pantallas de Contactos, Agenda y Ventas no filtran por anuncio (`meta_ad_id`) hoy; haría falta sumarles ese filtro.
  El CSV sí está (columnas visibles, con el período en el nombre, protegido contra inyección de fórmulas).
- **El selector de columnas se guarda en `localStorage`** (`ssa:ads-columns:<nivel>`) con `try/catch`; si el navegador lo
  bloquea, la elección vive en memoria mientras dura la página. Reordenar es con flechas dentro del grupo (no arrastrando).
- **F32 (permiso):** el dashboard de Ads y su detalle pasan de «Admin» a `dashboards.ads.view`. Las cuentas publicitarias
  (`integration_configs`, que solo lee un Admin) se leen con el cliente de servicio filtrado por el workspace de la sesión.
  `member-baseline.test.ts` se ajustó como dice el plano (la página sale de `ADMIN_PAGES`, entra en `PERMISSION_PAGES`; de
  doce a once). El Member de sistema no tiene `dashboards.ads.view` en el catálogo: sigue sin verla. «Analizar con IA» y
  «Sincronizar ahora» siguen con sus propios permisos (`settings.manage` para el segundo).
- **Revisión visual hecha** a 800 px (claro) y a 390 px (por medidas: la tabla scrollea dentro de su tarjeta, 1085 px de
  contenido en 322 px, la página no scrollea de costado y la primera columna queda fija); el modo oscuro de «Sin vincular»
  también. La tabla con datos CRM reales no se pudo ver (producción todavía no tiene toques vinculados): está cubierta por
  `verify-ads-attribution.mjs` (datos `zz-test`) y por los tests de las cuentas y las columnas.

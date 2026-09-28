# Pendientes — Etapa 4 (Agendamiento)

Lo que quedó sin cerrar, para retomar con Wendy. Formato de cada entrada:

- **Qué quedó:** …
- **Por qué:** …
- **Qué se decidió en su lugar:** …

---

## Etapa 4

### Redirect URI nueva en Google Cloud (F4)
- **Qué quedó:** el adaptador `google_calendar` vuelve por `/api/oauth/google_calendar/callback`, una dirección que el cliente OAuth de Google Cloud todavía no tiene autorizada.
- **Por qué:** el adaptador `google` de la Etapa 2 exige un canal de YouTube para identificar la cuenta, así que Calendar no puede compartir su callback. La regla de la corrida prohíbe tocar Google Cloud.
- **Qué se decidió en su lugar:** proveedor propio. En la verificación en vivo (§18 del plano) se agrega la redirect URI y se habilita la Calendar API, junto con los permisos de Calendar en la pantalla de consentimiento.

### Google Calendar: lo que dice la documentación (consultada el 27/9/2026)
- **Qué quedó:** dos precisiones sobre el plano, mantenida la interfaz de `lib/google-calendar/*`.
- **Por qué:** gana la documentación.
- **Qué se decidió en su lugar:** (1) un 403 con `reason` `rateLimitExceeded` o `userRateLimitExceeded` es `temporary` (backoff), no `permanent`; los otros 403 (`insufficientPermissions`, `forbiddenForNonOrganizer`) sí son `permanent`. (2) `invalid_grant` es del endpoint de token de OAuth, no de Calendar: se trata como `permanent` y marca la conexión `revoked`. Confirmado: `calendar.events.freebusy` alcanza para `freeBusy.query`, `calendar.calendarlist.readonly` para `calendarList.list` (pagina con `nextPageToken`, hasta 250 por página) y `calendar.events` para insertar, modificar y borrar con `conferenceDataVersion=1` y `sendUpdates=all`. La identidad (`sub`, email) sale de `openid email` + `userinfo`.

### F56 · El e2e del agente no pasa por el modelo
- **Qué quedó:** los cinco guiones de F56 llaman a las herramientas en el orden en que el modelo las llamaría, contra una base en memoria, pero no hay un test que haga que un modelo simulado emita las llamadas a herramienta y recorra el bucle del runner.
- **Por qué:** el repo no tiene ningún test que simule llamadas a herramienta desde el modelo, así que habría que construir esa plomería primero, y eso es trabajo del runner y no de esta etapa.
- **Qué se decidió en su lugar:** los guiones prueban lo que el modelo no puede arreglar (que el horario exista, que no se agende dos veces, que sin permiso la herramienta no esté, que el código público no llegue al modelo). Lo que falta es que el modelo elija bien, que se verifica con el agente prendido.

### F42 · Dominio propio para los links públicos (nice-to-have)
- **Qué quedó:** `workspaces.scheduling_public_base_url` existe y `publicBaseUrl` ya la prefiere, pero no hay pantalla para cargarla ni resolución por host en el middleware.
- **Por qué:** es nice-to-have y hacerlo bien pide tocar DNS y certificados, que esta corrida no toca.
- **Qué se decidió en su lugar:** los links salen de `NEXT_PUBLIC_APP_URL`. El día que se quiera un dominio propio, alcanza con escribir esa columna y sumar la resolución por host: el resto del código ya la respeta.

### F15 · Vista previa del horario (nice-to-have)
- **Qué quedó:** el calendario de las próximas 2 semanas con los horarios libres de un evento de 30 minutos, sin contar Google.
- **Por qué:** es nice-to-have y el bloque ya cubrió todo lo must.
- **Qué se decidió en su lugar:** el núcleo deja `freeWindows(input)` (pasos 1 a 4 del motor); la vista es armar ese input con `busy = []` y dibujarlo. Se puede sumar después sin tocar nada.

## Hallazgos de la exploración (previos a esta etapa)

### ~~El guardado de conexiones OAuth de la Etapa 2 fallaba contra la base real~~ — RESUELTO en B1
- **Qué quedó:** `saveConnection` hacía `upsert(onConflict: "workspace_id,provider,user_id")`, pero el índice único era de expresión (`coalesce(user_id, …)`). Verificado con `EXPLAIN` contra la base: Postgres responde 42P10. Conectar YouTube, LinkedIn o Threads de verdad habría terminado en `save_failed`. Nunca se vio porque `oauth_connections` estaba vacía y el test usa un mock.
- **Por qué:** un `ON CONFLICT (columnas)` solo encuentra índices de columnas, no de expresiones.
- **Qué se decidió en su lugar:** (decisión de Wendy, 27/9) se reescribe como buscar → actualizar o insertar, para todos los proveedores, y los índices pasan a ser dos parciales sin expresiones (una conexión de workspace por proveedor; varias cuentas por persona). Queda en B1.

### ~~Hoy la app no manda ningún encabezado de seguridad~~ — RESUELTO en B1
- **Qué quedó:** el plano (§15) suponía `X-Frame-Options: DENY` "como hoy". No existe: `next.config.ts` no define `headers()` y el middleware solo refresca la sesión.
- **Qué se decidió en su lugar:** (decisión de Wendy, 27/9) se agrega `securityHeadersFor(path)`: `frame-ancestors *` en `/calendario/*` y `/embed/*`, `frame-ancestors 'none'` + `X-Frame-Options: DENY` en el resto. Queda en B1.

### Los triggers de evento del editor nunca se guardaban
- **Qué quedó:** al publicar un flow, `buildDesiredTriggers` descartaba todo tipo que no fuera de mensaje o comentario. `new_contact`, `crm_event`, `inactivity` y `email_received` elegidos en el canvas no se escribían en `triggers`.
- **Por qué:** `BUILDER_TRIGGER_TYPES` se escribió cuando esos cuatro no existían y nadie lo amplió.
- **Qué se decidió en su lugar:** en B7a la persistencia pasa a ser genérica (todo tipo registrado con scope `event` o `scheduled`), que es lo que el editor promete. De paso empiezan a guardarse los cuatro viejos. Si Wendy prefiere que no cambie, es un filtro de una línea.

### Un flow no arrancaba si el contacto no tenía conversación
- **Qué quedó:** el cron de `automation_events` manda `channelId: ""` y `flow_sessions.channel_id` es NOT NULL: el insert de la sesión fallaba en silencio y el flow no corría. Un lead que agenda desde la página pública no tiene conversación.
- **Qué se decidió en su lugar:** en B7a `flow_sessions.channel_id` pasa a admitir null (migración aditiva) y el motor tolera un flow sin canal: los nodos de envío por canal se saltean con motivo; `send_email` no necesita canal.

### `sendMessage` por WhatsApp e Instagram no mira `do_not_contact`
- **Qué quedó:** el plano dice que "los demás nodos de envío respetan `do_not_contact`". Solo lo hacen el canal de email, `enroll_sequence`, las secuencias y el cron de inactividad. El nodo `sendMessage` por Zernio o Evolution manda igual.
- **Por qué:** es comportamiento de la Etapa 1, fuera del alcance de esta etapa.
- **Qué se decidió en su lugar:** `send_email` (nuevo) sí lo respeta, salvo cuando el flow arrancó por un trigger de agenda. El nodo viejo queda como está y se anota acá.

### El test de paridad interpolador/simulador no existía
- **Qué quedó:** el comentario de `lib/flow-engine/interpolate.ts` afirma que hay un test que compara su regex con la copia de `simulator.ts`. No lo había.
- **Qué se decidió en su lugar:** se escribe en B7a, junto con la extensión del regex para admitir guiones dentro de `{{…}}` (para `scheduling.link.<usuario>.<slug>`).

### Tailwind: `dark:` no sigue a la clase `.dark`
- **Qué quedó:** `app/globals.css` no declara `@custom-variant dark`, así que en Tailwind 4 las utilidades `dark:*` siguen a `prefers-color-scheme` y no al conmutador de tema del perfil; los tokens (`bg-background`, etc.) sí siguen a la clase.
- **Por qué:** viene de la Etapa 1.
- **Qué se decidió en su lugar:** el booker público usa `data-theme` y tokens propios, sin `dark:`, así el tema forzado por `?theme=` funciona. El resto no se toca; se anota para revisarlo aparte.

### La pantalla de Herramientas borraba las claves de `tools_config` que no fueran herramientas
- **Qué quedó:** `normalizeToolsConfig` descartaba cualquier clave que no fuera un nombre de herramienta del registro. Una habilidad guardada como `tools_config.scheduling` desaparecía al primer guardado.
- **Qué se decidió en su lugar:** en B8 se suma un registro de habilidades y `normalizeToolsConfig` conserva sus claves.

## Clasificador de mensajes en segundo plano (28/9/2026)

El handler de `bg_task` clasifica de verdad y el despacho dejó de re-encolar.
El detalle está en [agente-ia.md](agente-ia.md). Lo que quedó pendiente a
propósito:

### La API de lote real de Anthropic

- **Qué quedó:** el clasificador manda lotes de 200 por llamadas sincrónicas.
  La API de lote de Anthropic cuesta la mitad y tolera pedidos grandes, pero es
  asincrónica y necesita el recolector.
- **Por qué:** el histórico entero (543 textos) sale ~US$ 0,06. El descuento del
  50% sobre seis centavos no paga el pipeline asincrónico ni el estado en vuelo.
- **Qué se decidió:** se retoma si el volumen diario crece un orden de magnitud.

### `bg-collect` sigue sin hacer trabajo

- **Qué quedó:** `app/api/cron/bg-collect/route.ts` es un `TODO(bloque 5)`.
- **Por qué:** con llamadas sincrónicas no hay lotes en vuelo que recolectar. La
  ruta existe y está autorizada; ya no promete algo que no pasa.

### `conversation_summary` y `close_classification` por lote

- **Qué quedó:** no tienen implementación por lote. Las dos están en modo
  Inmediato por defecto, así que hoy nadie las encola.
- **Qué se decidió:** el handler **falla con el motivo** si alguna se pone en
  Económico, en vez de completar en silencio. El silencio es lo que dejó este
  handler vacío durante semanas sin que nadie se enterara.

### Los resultados se miran por SQL

- **Qué quedó:** la pantalla de calidad del clasificador y la revisión rápida de
  20 son del Bloque 5 y no se construyeron. Cuántos quedaron clasificados, qué
  categorías nuevas se crearon y cuántos tienen confianza baja se consultan a
  mano.

### Dos desvíos de F20, conscientes

- **Modo siembra:** mientras una dirección tenga menos de 8 categorías propias,
  el tope de categorías nuevas por corrida es 12 y no 3. Las 5 categorías que
  trae la 00079 son de sistema: con tope 3, la primera corrida dejaba ~540
  textos en "Otro" y ningún lote los volvía a mirar.
- **El sobrante del tope no se escribe:** queda pendiente para la corrida
  siguiente en vez de ir a "Otro". F20 dice lo contrario, pero mandarlo a "Otro"
  lo clasifica para siempre por una categoría que todavía no existía.

### El documento de requerimientos dice `normalize_message_text`

- **Qué quedó:** §12.1 y §12.2 de `requerimientos-fase3-bloques-2e-3.md` nombran
  `normalize_message_text` donde el código usa `normalize_for_grouping`.
- **Por qué:** la primera es la del opt-out (00027) y redefinirla movería la
  detección de "no contactar". Ya registrado en `BITACORA.md`.
- **Qué se decidió:** no se toca el documento de requerimientos, que es
  histórico.

## Heredado de la Etapa 2

No son parte de esta corrida. El detalle de cada uno está en [docs/etapa2/PENDIENTE.md](etapa2/PENDIENTE.md) con su "qué quedó / por qué / qué se decidió". Ninguno bloquea la Etapa 4.

- Las pantallas del Bloque 1 de la Etapa 2 (y en general las internas) no se recorrieron a ojo: la app pide login.
- "Migrar a Vault" de Zernio construido y no apretado (la 00090 ya se aplicó el 26/9).
- La documentación de Postproxy no coincide con el plano (sin webhooks; el estado se consulta con un job).
- 20 vulnerabilidades de npm previas a la Etapa 2.
- Heredado de la Fase 3: UI de calidad del clasificador, tendencias con 4 pestañas, "qué le responden", `declarar_intencion` opt-in, migración 00072 sin aplicar, deuda del agente (ver `agente-ia.md`), `generate-reply` sin topes de gasto, `serverActions.bodySizeLimit`, broadcasts solo por Zernio. (El **handler de `bg_task` y el re-encolado cada 15 minutos dejaron de estar pendientes** el 28/9: ver abajo.)
- La prueba de subida directa a YouTube no se corrió; el receptor de Postproxy está sobre un formato supuesto; LinkedIn publica solo texto y no da métricas ni comentarios; Zernio sin `delta` ni cursor; historial inicial de seguidores por red; tres cifras vacías en Social; historias activas sin mostrar; tarjetas de desglose del detalle de anuncios; el análisis con IA no guarda los anteriores.
- `has_permission` no conoce los permisos del Member de sistema (por eso `can_see_booking` cae al chequeo de anfitrión para ese rol).
- Correcciones: Postproxy se queda en el despachador (D9), "Agregar a la cola" de Zernio sin hacer (D8), la ventana de idempotencia de Zernio son ~5 minutos (A15/D7), el SDK de Zernio lanza en vez de devolver el error, la vista semanal del calendario de contenido sin hacer (C14).

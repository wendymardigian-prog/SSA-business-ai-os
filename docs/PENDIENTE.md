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

### ~~Tailwind: `dark:` no sigue a la clase `.dark`~~ — RESUELTO el 28/9/2026
- **Qué quedó:** `app/globals.css` no declaraba `@custom-variant dark`, así que en Tailwind 4 las utilidades `dark:*` seguían a `prefers-color-scheme` y no al conmutador de tema del perfil; los tokens (`bg-background`, etc.) sí seguían a la clase. Alguien con el sistema en claro y la app en oscuro veía texto oscuro sobre fondo oscuro en todo lo escrito con `dark:`.
- **Qué se hizo:** `@custom-variant dark (&:where(.dark, .dark *));` al final de `globals.css`. En el CSS de producción ya no queda ninguna aparición de `prefers-color-scheme`. El booker público no se tocó: usa `data-theme` y tokens propios, sin `dark:`.

### La pantalla de Herramientas borraba las claves de `tools_config` que no fueran herramientas
- **Qué quedó:** `normalizeToolsConfig` descartaba cualquier clave que no fuera un nombre de herramienta del registro. Una habilidad guardada como `tools_config.scheduling` desaparecía al primer guardado.
- **Qué se decidió en su lugar:** en B8 se suma un registro de habilidades y `normalizeToolsConfig` conserva sus claves.

## Clasificador de mensajes en segundo plano (28/9/2026)

### La API key de Anthropic en Vault es invalida — BLOQUEA la primera corrida

- **Qué quedó:** la migración 00101 está aplicada y el código desplegado. El
  cron de las 18:00 UTC encoló **un** job (la idempotencia funciona en
  producción), el runner lo tomó, abrió el run y el proveedor respondió
  `API key is invalid.`. Tres intentos, job en `failed`, **543 textos siguen sin
  clasificar**.
- **Por qué importa más allá de esto:** el run del agente de chat de las 17:08
  del mismo día falló igual (`provider_unavailable`, `AI_APICallError`). No es
  del clasificador: es la clave. Y `integration_configs` muestra la card en
  verde (`is_active = true`, sin `last_error`) — exactamente el escenario que
  advierte el CLAUDE.md: *"una clave revocada guardada deja la card en verde"*.
- **Qué hay que hacer:** cargar una key válida en Ajustes → Integraciones, y
  después **borrar el job `bg_task` en `failed`** para liberar la ventana de
  hoy:
  ```sql
  delete from scheduled_jobs where type='bg_task' and status='failed';
  ```
  Sin eso, el índice único de la 00101 impide reencolar esa ventana y el
  backlog espera al cron de mañana a las 03:00. Es el comportamiento buscado
  (una ventana se despacha una sola vez), no un defecto.



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

### ~~Los resultados se miran por SQL~~ — RESUELTO el 28/9/2026

- **Qué quedó:** la pantalla de calidad del clasificador y la revisión rápida de
  20 eran del Bloque 5 y no se habían construido.
- **Qué se hizo:** Settings → Tareas en segundo plano tiene los cuatro
  indicadores, la precisión por semana, las categorías más corregidas, la
  calibración de la confianza y la revisión rápida. Lo único que sigue pendiente
  de F25 son las versiones del clasificador (ver más abajo).

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

## Pantalla de Chat completada (28/9/2026, rama `feature/chat-completar`)

### ~~Dos migraciones escritas y sin aplicar~~ — APLICADAS el 28/9/2026

- **Qué se hizo:** se aplicaron la **00110** y después la **00111** (en ese orden:
  la 00111 usa `chat_origin_group`, que crea la 00110). Las 19 funciones existen,
  con **una sola sobrecarga cada una** (dos dejarían a PostgREST sin poder
  elegir), todas `SECURITY INVOKER`, con `EXECUTE` para `authenticated` y sin
  acceso para `anon`. Se llamaron las 19 contra los datos reales y responden.
- **No se renumeran al mergear.** Ya están aplicadas: el número es parte del
  registro. Quedan los huecos 00102–00109, que la sesión de multimedia usa en
  parte; es a propósito, era la banda reservada para correr en paralelo.
- `node scripts/verify-dashboards.mjs` y `node scripts/verify-rls.mjs` salen
  **Todo verde** (se corrieron de a uno, sin nada de la otra sesión en curso, y
  la base quedó sin datos `zz-test-`).

### El set fijo de `verify-dashboards.mjs` creció a 7 conversaciones

- **Qué pasó:** se le sumó una conversación con los tres orígenes de
  automatización (flow, sequence, broadcast). Es la que fija que sean **una** fila
  en "Quién responde" y no tres, que era el bug que dejaba el dashboard en blanco.
- **Qué hay que saber:** §11.8 del plano describe el set de 6 y sus valores
  esperados. Los del script son los del set real, que es el que vale. Cinco
  expectativas escritas a mano cambiaron con la conversación nueva (7
  conversaciones, 7 recibidos, 8 enviados, mediana 45 s) y están recalculadas con
  el motivo al lado.
- **Tres cosas que el script dejó claras y conviene no olvidar:** el segundo
  episodio de una conversación aparece solo cuando pasan más de 12 h sin
  mensajes (y si nadie lo contesta cuenta como "sin respuesta"); los días de las
  tendencias se cortan en la zona del negocio, así que un rango que arranca a las
  00:00 UTC empieza el día anterior; y un Member ve los episodios de sus
  conversaciones, no las conversaciones.

### `knownButtonExtra` no está conectado en el runner

- **Qué quedó:** `buttonTextsFromRows` (`lib/agent/rules/button-texts.ts`) está
  escrita y probada, pero nadie la llama: la condición `inbound.is_known_button`
  sigue usando solo los 12 textos de la constante.
- **Por qué:** conectarla es una línea en `lib/agent/runner.ts`, y ese archivo lo
  estaba tocando la sesión de multimedia en paralelo.
- **Qué hay que hacer después de mergear multimedia:** en `runner.ts`, leer los
  textos de botón (`BUTTON_TEXTS_QUERY` dice qué consultar) y pasarlos como
  `knownButtonExtra` a `buildPreRuleContext`. Los 12 de la constante siguen
  valiendo: las dos fuentes se suman.

### Versiones del clasificador: solo lectura

- **Qué quedó:** la pantalla de Tareas muestra la versión activa y el tamaño del
  set de control, pero no se puede crear una versión, activarla, volver a la
  anterior ni "reclasificar los dudosos" (F25).
- **Por qué:** la versión vive en una constante del código
  (`PROMPT_VERSION` en `lib/patterns/classify-run.ts`) y no en la base, así que no
  hay nada que activar; y evaluar una versión contra el set de control necesita
  llamar al proveedor de IA, que esta corrida no podía hacer.
- **Qué se decidió:** la pantalla lo dice con esas palabras, en vez de mostrar
  botones que no hacen nada.

### `close_classification` no tiene corridas propias

- **Qué quedó:** la columna "Última corrida" de esa tarea dice "Sin corridas
  propias todavía".
- **Por qué:** no deja un run con `source` propio en `agent_runs`, así que no hay
  de dónde leer la fecha.
- **Qué se decidió:** decirlo. Mostrar la fecha de otra tarea sería peor que no
  mostrar nada.

### "Por qué derivó" agrupa texto libre

- **Qué quedó:** el motivo de una derivación por herramienta lo escribe el modelo
  en una frase libre. Se agrupa por el texto normalizado y se muestra la última
  redacción, con top 6 + "Otros motivos".
- **Por qué:** dos frases que dicen lo mismo con otras palabras cuentan como dos
  motivos distintos. Los de guardarraíl sí tienen clave estable y se traducen.
- **Qué conviene después:** que `escalateToHuman` guarde también un código de
  motivo además de la frase.

### ~~Los `verify-*.mjs` no se corrieron~~ — RESUELTO el 28/9/2026

- **Qué se hizo:** `verify-dashboards.mjs` se extendió con las funciones nuevas
  (el grupo de autor, la fila única de automatizaciones, las dos medianas que
  antes eran la misma, quién respondió primero, la aprobación de respuestas, las
  tendencias densas, los patrones con su `text_id`, el estado de la clasificación
  y el scope de un Member en todo eso) y sale **Todo verde**, igual que
  `verify-rls.mjs`. Se corrieron de a uno.

### Las 15 funciones se probaron contra la base real, sin aplicar nada

- **Qué se hizo:** el cuerpo de cada función nueva se corrió como un `SELECT` de
  solo lectura contra la base real (workspace de Wendy, 2.471 mensajes),
  sustituyendo los parámetros por literales y las funciones que todavía no
  existen por su definición en línea. Es lo que valida la **semántica** —nombres
  de columnas, joins, agregados, rutas de jsonb—, que el parser no puede ver.
  Las 15 corren.
- **Lo que encontró:** en `chat_dashboard_patterns`, "También: …" venía con un
  `null` y una cadena vacía adentro (un mensaje sin texto comparte el normalizado
  vacío con otros). Corregido en la migración.
- **Lo que hay que saber antes de abrir la pantalla:** hoy **los 1.597 mensajes
  salientes de la base tienen `origin = 'external'`** y los entrantes no tienen
  origen (es correcto: sólo los salientes lo llevan). Así que "Quién responde" va
  a mostrar **una sola fila, Fuera del sistema**, y la sección del agente va a
  decir que todavía no respondió ninguna conversación. No está roto: es que el
  agente estuvo apagado y todo se respondió desde ManyChat o la app de Instagram.
  El resto: 237 episodios, 3 borradores pendientes, mediana del agente 64 s, 558
  textos sin clasificar y la última corrida del clasificador en `error` (la API
  key revocada).

### ~~La revisión visual con la app~~ — HECHA el 28/9/2026, con Wendy logueada

- **Qué se hizo:** Wendy inició sesión en `localhost:3001` y se recorrió
  Dashboards › Chat (con datos reales, filtrando por "Fuera del sistema", tocando
  una categoría de Patrones), Settings › Tareas y la cola de borradores, a 1440 y
  a 390 px.
- **Lo que se probó de punta a punta, con clics reales (no solo mirado):**
  - Filtrar la tabla "Quién responde" por una fila cambia la URL a `?author=…` y
    oculta la sección del agente con el aviso, exactamente igual con "Fuera del
    sistema" que con Automatizaciones (F17).
  - Tocar una categoría de Patrones pide "Qué le responden" a la Server Action
    nueva, que llama a `chat_dashboard_replies` y muestra el "% no respondió".
  - El acceso a Borradores desde el sidebar y desde la barra ya llevan a
    `?quien=todos`, y la cola vacía en "míos" dice "Hay 5 de otras personas" con
    el botón "Ver todos (5)", que al tocarlo trae los 5 borradores reales.
  - A 390 px los filtros bajan a su franja propia y las tarjetas quedan en 2
    columnas, como el prototipo.
- **Ningún bug encontrado.** Lo único fuera de lo común son los datos: el agente
  actuó en 3 % de 187 conversaciones y "Quién responde" trae una sola fila
  ("Fuera del sistema", 62 %), porque el agente estuvo apagado — es el
  comportamiento correcto, no un error.
- **Un detalle cosmético, no un bug:** a 390 px el título "Conversaciones nuevas"
  se trunca a "Conversaciones …" en la tarjeta. El prototipo también trunca
  textos largos en mobile; no hace falta tocarlo.

## Heredado de la Etapa 2

No son parte de esta corrida. El detalle de cada uno está en [docs/etapa2/PENDIENTE.md](etapa2/PENDIENTE.md) con su "qué quedó / por qué / qué se decidió". Ninguno bloquea la Etapa 4.

- Las pantallas del Bloque 1 de la Etapa 2 (y en general las internas) no se recorrieron a ojo: la app pide login.
- "Migrar a Vault" de Zernio construido y no apretado (la 00090 ya se aplicó el 26/9).
- La documentación de Postproxy no coincide con el plano (sin webhooks; el estado se consulta con un job).
- 20 vulnerabilidades de npm previas a la Etapa 2.
- Heredado de la Fase 3: UI de calidad del clasificador, tendencias con 4 pestañas, "qué le responden", `declarar_intencion` opt-in, deuda del agente (ver `agente-ia.md`), `generate-reply` sin topes de gasto, `serverActions.bodySizeLimit`, broadcasts solo por Zernio. (El **handler de `bg_task` y el re-encolado cada 15 minutos dejaron de estar pendientes** el 28/9: ver abajo. La **migración 00072 se aplicó** el 28/9.)
- La prueba de subida directa a YouTube no se corrió; el receptor de Postproxy está sobre un formato supuesto; LinkedIn publica solo texto y no da métricas ni comentarios; Zernio sin `delta` ni cursor; historial inicial de seguidores por red; tres cifras vacías en Social; historias activas sin mostrar; tarjetas de desglose del detalle de anuncios; el análisis con IA no guarda los anteriores.
- `has_permission` no conoce los permisos del Member de sistema (por eso `can_see_booking` cae al chequeo de anfitrión para ese rol).
- Correcciones: Postproxy se queda en el despachador (D9), "Agregar a la cola" de Zernio sin hacer (D8), la ventana de idempotencia de Zernio son ~5 minutos (A15/D7), el SDK de Zernio lanza en vez de devolver el error, la vista semanal del calendario de contenido sin hacer (C14).

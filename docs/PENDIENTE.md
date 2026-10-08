# Pendientes

Lo que quedó sin cerrar, para retomar con Wendy. Una sección por corrida, la más
nueva al final. Formato de cada entrada:

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

---

## Mejoras de Chat (Bloques 1-3, 28/9/2026, rama `oneshot-chat-media-a`)

### ~~Migraciones escritas y SIN aplicar~~ — APLICADAS el 29/9/2026
- **Qué quedó:** nada. Las dos migraciones están aplicadas y verificadas contra la base.
- **Qué se hizo:** se pushearon a `main` y se aplicaron **mientras Railway compilaba**, así llegaron antes del swap del contenedor: **no hubo caída**. Primero `00102_chat_media` (bucket privado `chat-media`, `messages.media_description` e `interpretability`, `workspaces.persist_chat_media` y `chat_media_retention_days`), después `00103_transcripts_and_needs_human` (transcripción, escalado, el CHECK de `agent_runs.source` con sus dos valores nuevos, y las columnas de costo por hora de audio).
- **Verificado contra la base:** 7 de 7 columnas en `messages`, 3 de 3 en `conversations`, 3 de 3 en `workspaces`, `model_pricing.audio_per_hour`, `agent_runs.audio_seconds`, el bucket privado con **una sola** policy (la de SELECT) y ninguna de escritura. El seed de precios de transcripción también se cargó. El deploy quedó en SUCCESS y el contenedor nuevo arrancó sin un solo error.

### ~~Chequeos de RLS del bucket sin correr~~ — CORRIDOS el 29/9/2026, en verde
- **Qué quedó:** nada. `node scripts/verify-rls.mjs` sale **"Todo verde"**, con los seis chequeos nuevos del bucket: que sea privado, que suba el service role, que un miembro del workspace escuche el audio, que **otro workspace NO pueda escucharlo**, y que ni un Admin suba ni borre a mano.
- **Dos errores míos que aparecieron al correrlo de verdad**, ya arreglados en el script: el bloque no creaba su propio usuario de otro workspace (usaba una variable de otro bloque), y afirmaba que borrar sin permiso devuelve error. **No lo devuelve**: Storage sin policy de DELETE no falla, simplemente no borra nada. Ahora se afirma la propiedad que importa, que el archivo sigue ahí.

### La revisión visual de la bandeja real, sin hacer (pide sesión)
- **Qué quedó:** recorrer `/dashboard/inbox` con datos de verdad, a escritorio y a 390 px, para ver las burbujas nuevas dentro del hilo real.
- **Por qué:** el navegador integrado de esta corrida no tiene sesión y la app redirige a `/login`. La regla de la corrida prohíbe ingresar credenciales.
- **Qué se decidió en su lugar:** se verificó lo que no depende de la sesión, midiendo el CSS real que sirve el dev server a 390 px sobre un banco de prueba con la misma estructura que produce la burbuja. **Encontró dos cosas reales, que ya están arregladas:**

  1. **El reproductor desbordaba la burbuja.** Tenía `min-w-[210px]`, y en CSS `min-width` le gana a `max-width`: medido, 210 px dentro de un contenedor de 200 px da 210 px. Pasó a `min-w-[min(210px,100%)]`.
  2. **Los controles nativos se veían como una píldora blanca** sobre la burbuja oscura. Se les puso `color-scheme: dark`, con las dos variantes (`[.dark_&]:` y `dark:`), porque en este proyecto el tema lo maneja la clase `.dark` del `<html>` pero el `dark:` de Tailwind compila a `@media (prefers-color-scheme: dark)`: son dos señales distintas y no siempre coinciden.

  Lo medido a 390 px, con el CSS de producción: la tarjeta del audio, la del documento y el bloque de transcripción quedan en 279 px de ancho (la burbuja da 279), una foto vertical se corta a 288 px de alto, una captura panorámica a 279 px de ancho, y la página no tiene scroll horizontal. Las dos variantes de `color-scheme` compilan en el CSS de producción.

  **Lo que falta mirar con sesión**, que es lo que el banco de prueba no puede cubrir: que el badge y el filtro "Necesita humano" se vean en la lista real, que el hilo de Instagram muestre la media cruzada, y que el reproductor arranque al apretar ▶ contra un archivo de verdad.

### ~~Un error de lint preexistente~~ — RESUELTO por la otra corrida
- **Qué quedó:** nada. `npm run lint` sale en **0 errores y 41 warnings**, idéntico a `main`.
- **Qué pasó:** el error estaba en `components/scheduling/booker/use-embed-bridge.ts` y venía de antes de esta corrida. Lo arregló la rama `feature/chat-completar` mientras esto se construía. **Esta corrida no agregó ningún error ni warning nuevo** (se comprobó comparando el lint de las dos ramas).

### Las claves de IA que faltan para que esto funcione en vivo
- **Qué quedó:** el código está completo y probado, pero **en producción nada de esto va a transcribir ni a describir** hasta que se carguen dos claves.
- **Por qué:** el workspace tiene hoy sólo Anthropic (y la bitácora del 28/9 dice que esa clave está **inválida**) y Voyage. No hay Groq, y tampoco hay OpenAI, así que el respaldo de transcripción que el plano daba por existente **hoy no existe**.
- **Qué se decidió en su lugar:** construirlo igual, porque el comportamiento resultante es el correcto: sin clave, el audio se guarda y se reproduce, el mensaje queda como no interpretable, y **el agente escala a una persona en vez de responder a ciegas**. Que es exactamente lo que se quería arreglar.

  Para que funcione en vivo hacen falta, en este orden:

  1. **La clave de Groq** (console.groq.com → API Keys), en Ajustes → Integraciones. Sin esto no se transcribe ningún audio.
  2. **Una clave de visión válida** (OpenAI, Google, o reemplazar la de Anthropic que está vencida). Sin esto no se describe ninguna imagen, y una captura sin texto escala.
  3. ~~El seed de precios~~ — **ya cargado** el 29/9/2026 (Groq turbo a US$ 0,04/h, Groq large a 0,111 y OpenAI whisper-1 a 0,36).

  Una clave de OpenAI además habilita el respaldo: si Groq se cae o devuelve 429, la transcripción sigue por ahí sola.

### `sniffMime` todavía no conoce audio
- **Qué quedó:** `lib/content/media.ts` valida por magic bytes pero sólo conoce imagen, video y PDF, y clasifica cualquier `ftyp` como `video/mp4` (así que un M4A se leería como video).
- **Por qué:** la validación por magic bytes del audio es del **Bloque 5** (subir un audio grabado desde el navegador), que no entra en esta corrida. Para lo que sí se construyó no hace falta: la media entrante no pasa por `sniffMime`, y el bucket ya limita los MIME.
- **Qué se decidió en su lugar:** se deja como está y se anota para el Bloque 5, donde hay que extenderlo con ogg, webm, m4a/mp4, mp3 y wav, y distinguir el `ftyp` de audio del de video.

### Bloques 4, 5 y 6 — fuera de esta corrida
- **Qué quedó:** identidad visible (fotos de perfil estables y el @ de Instagram clickeable), grabar y enviar audios desde el composer, y la banca de audios reutilizables.
- **Por qué:** el pedido de esta corrida fue explícitamente Bloques 1 a 3 (F1 a F15).
- **Qué se decidió en su lugar:** nada de esos bloques se toca. El plano ya los tiene escritos y el B4 es independiente del resto, así que se puede correr en cualquier momento.

---

## Corrida B (1/10/2026) — Bloque 0, 4, 5 y 6

### FA7 · Los corazones de Instagram no tienen mapeo verificado
- **Qué quedó:** las reacciones de WhatsApp ya no generan adjunto (ya estaban en `BAILEYS_NOT_ATTACHMENTS`), pero no hay un mapeo para un corazón/reacción de Instagram en `ZERNIO_KINDS`.
- **Por qué:** no encontré en la base real ni en la documentación del SDK de Zernio un ejemplo del payload que manda una reacción de Instagram. Inventar la forma (`{type: "reaction", ...}` o lo que sea) sin un dato real es el tipo de cosa que el plano pide no hacer.
- **Qué se decidió en su lugar:** si en producción aparece una reacción de Instagram sin mapeo, hoy cae en `kind: "unsupported"` con `status: "pending"` (si trae URL) o se descarta (si no la trae) — no rompe nada, pero tampoco se etiqueta como `[Sticker]`. Cuando aparezca un ejemplo real, sumar su `type` a `ZERNIO_KINDS` (posiblemente apuntando a `sticker`, ya que `effectiveMessageText` ya trata stickers como no-escalables) es un cambio de una línea.

### `POST /message/sendMedia` de Evolution: el cuerpo no quedó verificado contra el código fuente
- **Qué quedó:** `lib/evolution-client.ts` suma `sendMedia`, usada para mandar imagen/video/documento por WhatsApp. A diferencia de `sendWhatsAppAudio`, `getBase64FromMediaMessage` y `fetchProfilePictureUrl` (los tres con su cuerpo exacto verificado contra el código fuente de la 2.3.7 en la §14c), el plano solo confirma "multipart o URL" para este endpoint — sin los nombres de campo.
- **Por qué:** la instrucción de esta corrida es no inventar ni "confirmar por mi cuenta" los contratos de la §14c, y este específicamente no estaba completo.
- **Qué se decidió en su lugar:** se implementó con el contrato público documentado de Evolution API v2 (`number`, `mediatype`, `media`, más `mimetype`/`caption`/`fileName` opcionales), que es razonable pero no está re-verificado contra el código de la 2.3.7 como el resto. Antes de la verificación en vivo (mandar una imagen por WhatsApp desde la bandeja), conviene confirmar estos nombres contra el código fuente o un ensayo real. Si algún campo no coincide, es un ajuste de nombres en `sendMedia`, no un cambio de diseño.

### ~~Migraciones escritas pero NO aplicadas (a pedido explícito)~~ — 00104 APLICADA el 1/10/2026, 00105 EN PAUSA por rediseño
- **00104_contact_avatar_refresh.sql** (Bloque 4): **aplicada y verificada** el 1/10/2026 (`verify-crm.mjs`, `verify-rls.mjs`, `verify-enrichment.mjs`, los tres en verde). Mergeada a `main` y desplegada en Railway sin errores.
- **00105_audio_assets.sql** (Bloque 6): **sigue sin aplicar, ahora por una razón distinta**. No es una pausa de seguridad: Wendy decidió (1/10/2026) unificar la banca de audios con `response_templates` en un solo banco de assets antes de llevarla a producción, así que el esquema de esta migración va a cambiar. El código del Bloque 6 **sí está en `main`** (se verificó que no rompe nada sin la tabla — toda consulta maneja `{data, error}` sin tirar excepción). Qué falta: diseñar el banco unificado (ver `CLAUDE.md`, sección "Bloque 6") y recién ahí escribir la migración definitiva — la 00105 actual puede servir de referencia para RLS e índices, pero probablemente no se aplique tal cual.

### F22 · Sin un multiselect nuevo de "qué audios puede usar el agente"
- **Qué quedó:** el plano original mencionaba sumar un `ToolOptionSource` nuevo (`"audio_assets"`) para que la pestaña Herramientas tenga un multiselect de qué audios habilitar por agente, igual que tags/members/contact_fields/event_types.
- **Por qué:** la banca de audios (F20) ya tiene su propio interruptor por audio, el toggle "Asistente" en `/dashboard/settings/audios`. Sumar un segundo control en la pestaña Herramientas sería dos lugares decidiendo lo mismo, y el workspace es single-tenant con un solo agente conversacional (el copywriter es otro agente, para otra cosa, no usa estas herramientas).
- **Qué se decidió en su lugar:** `listar_audios` y `enviar_audio` (`lib/agent/tools/audio.ts`) filtran directo por `audio_assets.agent_enabled = true`, sin `ToolOptionSource` ni config propia. Si en el futuro hace falta un agente conversacional nuevo con su propio subconjunto de audios, ahí sí tiene sentido sumar el multiselect; hoy sería control duplicado.

### F22 · `deferInDraft` no alcanzaba: se sumó `defersInDraftAsync` al framework de herramientas
- **Qué quedó:** `AgentToolDefinition.deferInDraft` es sincrónico (no puede leer la base), pero `enviar_audio` en modo borrador necesita saber si el audio sigue habilitado y traer su archivo antes de poder armar la sugerencia.
- **Por qué:** ninguna herramienta anterior (derivar, pausarse) necesitaba una consulta para decidir qué sugerir — los datos ya venían en el input o la config.
- **Qué se decidió en su lugar:** se agregó `defersInDraftAsync?: boolean` a `AgentToolDefinition` y `suggestion?: SuggestedAction` a `AgentToolResult` (`lib/agent/tools/types.ts`). Con `defersInDraftAsync: true`, `buildToolSet` (`lib/agent/tools/build.ts`) llama a `execute` igual en modo borrador (no a `deferInDraft`) y empuja `result.suggestion` a las sugerencias del borrador si está presente. Es aditivo: ninguna herramienta existente lo usa ni cambia de comportamiento. Vale la pena mirarlo con cuidado en la próxima revisión de código del agente, porque es el único punto donde `execute` corre en modo borrador sin que el framework se lo pida explícitamente vía `deferInDraft`.

### `scripts/verify-chat-media.mjs` — sección B salteada (no es una falla)
- **Qué quedó:** el script corre contra la base real y queda en **"Todo verde"**, pero la sección B (RLS de `audio_assets`) se SALTEA con un aviso porque la tabla no existe todavía (la 00105 está escrita, no aplicada). Las secciones A (bucket `chat-media`, scope por workspace para `library/`) y C (bucket `avatars`, público) corrieron de verdad y en verde.
- **Por qué:** correr la sección B hoy daría una falla de "tabla no existe", que no es una falla real del código: es la migración pendiente, a propósito.
- **Qué se decidió en su lugar:** el script detecta la tabla faltante (código `42P01`/`PGRST205` de Postgres/PostgREST) y lo dice explícito. Después de aplicar la 00105, correr `node scripts/verify-chat-media.mjs` de nuevo: la sección B tiene que pasar de "salteada" a "ok" en sus cuatro chequeos (lee, no lee de otro workspace, Member no edita, Admin sí crea).

### Revisión visual — hecha, con una limitación por las migraciones sin aplicar
- **Qué se revisó:** con un workspace y usuario `zz-test-` descartables (limpiados al final) y el dev server con el `.env` de la carpeta principal, se vieron en el navegador integrado: la pantalla de la banca de audios vacía y su modal "Nuevo audio" (nombre, atajo, descripción "para la IA", Grabar/Subir archivo) en escritorio y a 375px; el composer de la bandeja con el placeholder nuevo ("... o /a para un audio"), los botones de clip y micrófono, y el estado de error del grabador cuando el navegador no tiene permiso de micrófono (`Habilitá el micrófono para este sitio` — confirma que `microphoneErrorMessage` se pinta bien). Importante: este dev server apuntaba a la base de producción real (no hay base "local" separada), así que esto equivale a una revisión en vivo.
- **Qué NO se pudo ver:** el picker `/a` con audios de verdad adentro (la lista llega vacía porque `audio_assets` no existe sin la 00105 aplicada — comportamiento esperado, no un bug: `audioPickerOpen` exige `audios.length > 0`), la tabla de la banca con una fila real, y grabar un audio de punta a punta (el navegador integrado bloquea el micrófono real). Queda para la lista de verificación en vivo del §15, con Wendy logueada y micrófono real.
- **Después del deploy a `main`** (1/10/2026): se confirmó que `https://<tu-app>.up.railway.app/login` responde 200 y renderiza bien. No se repitió la creación de un workspace de prueba contra el dominio de Railway porque es la misma base de datos que ya se había revisado arriba.

### Banco de assets unificado (audios + templates) — por diseñar en la próxima sesión
- **Qué quedó:** Wendy pidió (1/10/2026) no aplicar la 00105 tal cual porque quiere un solo banco de assets que incluya audios Y templates de mensaje, en vez de dos tablas casi idénticas (`audio_assets` nueva y `response_templates` que ya existe desde la 00023).
- **Por qué:** no se discutió en esta sesión — quedó como decisión de Wendy para la sesión nueva.
- **Qué hay que decidir ahí:**
  - Si es una tabla sola con un `kind` (`text`/`audio`, quizás `image` a futuro) o dos tablas con una vista/tipo común para el picker y las herramientas del agente.
  - Qué pasa con lo ya construido que asume `audio_assets` como tabla propia: `lib/audio-library/*` (incluida la búsqueda que extendió `filterTemplates` con un criterio de contenido — eso puede seguir sirviendo), `lib/agent/tools/audio.ts` (`listar_audios`/`enviar_audio`), `/dashboard/settings/audios`, el picker `/a` (`components/inbox/audio-picker.tsx`), y si conviene unificarlo con `/` (templates) y `TemplatePicker` en un solo componente.
  - Si todavía hace falta `defersInDraftAsync` (la pieza que se sumó a `AgentToolDefinition`/`AgentToolResult` para que `enviar_audio` lea la base en modo borrador) con el diseño nuevo, o si el banco unificado permite resolverlo distinto.
  - La migración `00105_audio_assets.sql` actual (ya escrita, con su RLS e índices) puede servir de punto de partida para la tabla unificada, pero el `CREATE TABLE` en sí casi seguro cambia.
- **Mientras tanto:** el código del Bloque 6 queda en `main`, desplegado, pero efectivamente inerte (banca vacía, sin tabla) hasta que esto se resuelva. No hay apuro de romperlo: no afecta nada más del sistema.

## Banca de recursos unificada (1/10/2026) — resuelve el punto anterior

Rama `feature/banca-recursos-unificada`, sobre `oneshot-chat-media-b`. Resuelve
la decisión que había quedado pendiente al final de la Corrida B: una sola
tabla, con `kind`.

### La decisión de diseño

Una sola tabla (`response_assets`, `kind: 'text' | 'audio'`), no dos tablas
con una vista común. El motivo que inclinó la balanza: el atajo (`/precio`)
tiene que ser único **entre los dos tipos** — un texto y un audio no pueden
compartir uno — y con dos tablas separadas ningún índice único puede
garantizar eso; hay que resolverlo a mano en cada consulta. Con una tabla, el
mismo índice parcial de siempre (`idx_response_assets_shortcut`, sin `kind`
en las columnas) lo resuelve solo.

### Las dos migraciones

- **00105_response_assets.sql**: reescribe por completo la vieja
  `00105_audio_assets.sql` (nunca se había aplicado, así que no hay tabla
  muerta que dejar en el historial). Crea `response_assets` con 11 CHECKs
  nombrados (los de forma, `kind <> 'x' OR (...)`, para que el error diga qué
  tipo falló), 6 índices (incluido uno GIN para `tags`, nuevo: ninguna de las
  dos tablas viejas lo tenía), RLS idéntica a `response_templates` letra por
  letra, y **no toca `purge_soft_deleted`**.
- **00106_drop_response_templates.sql**: nueva. Aborta con `RAISE EXCEPTION`
  si `response_templates` tiene alguna fila (0 verificado, nunca las borra) y
  recién ahí la dropea. Redefine `purge_soft_deleted` en la misma transacción
  para que pase a purgar `response_assets`. Las dos cosas van en la 00106 y no
  antes: la función nombra cada tabla a mano, así que separarlas dejaría una
  ventana donde una tabla no se purga o la función apunta a una tabla
  inexistente.

Las dos están **escritas, sin aplicar**: se aplican antes de desplegar, 00105
primero.

### Lo que arregló de paso

Tres cosas que estaban mal en el código de la Corrida B y que la fusión tocó
de costado (ninguna estaba en el pedido original, se decidieron al encontrarlas
durante la exploración y se confirmaron con Wendy antes de construir):

1. **El agente se auto-destruía el recurso a los 180 días.**
   `lib/agent/send-audio.ts` (ahora `lib/agent/send-asset.ts`) le pasaba a
   `sendChannelMessage` el path de la BIBLIOTECA directo, y
   `planChatMediaCleanup` (`lib/chat-media/cleanup.ts`) barre todo adjunto
   `ready` sin `meta.bucket` a los 180 días. No eran archivos huérfanos: era
   el archivo del recurso, para todos los envíos futuros. Se resolvió con
   `lib/response-assets/send-copy.ts` (`copyAssetToChat`): copia el archivo a
   la conversación del lado del servidor ANTES de mandar, en los dos caminos
   (el picker de la bandeja y el agente).
2. **El picker re-subía el archivo en cada envío** (descarga + nueva subida),
   forzado por el guard de prefijo de `validateOutboundMedia`
   (`app/api/v1/messages/route.ts`), que exige `<ws>/<conversationId>/` y que
   un path de biblioteca no cumple. La misma copia server-side resuelve esto:
   el picker pasa a llamar `prepareAssetSend` y postear el resultado, sin
   bajar ni subir bytes por el navegador.
3. **Un audio por email**: `sendViaResendChannel` ignora `message.media` en
   silencio. La API ya lo rechazaba con un 400, pero el agente no. Se creó
   `lib/channels/media.ts` (`channelAcceptsMedia`), un solo lugar para la
   pregunta "este canal acepta media", consultado por el picker, la API y el
   agente.

### Lo que se decidió sobre lo que había quedado abierto

- **`defersInDraftAsync` se queda**, con una justificación más angosta: solo
  la rama de audio de `usar_recurso` la necesita (leer la base antes de
  armar la sugerencia). La rama de texto no difiere nada — devolver texto es
  una lectura.
- **`usar_recurso` con un texto no manda un mensaje aparte**: devuelve el
  contenido ya interpolado (con el contacto y el workspace reales, resueltos
  dentro de la herramienta) para que el modelo lo use como su propia
  respuesta. El requerimiento original decía "lo manda como mensaje", pero el
  agente ya emite su propia respuesta de texto en el mismo turno — mandarlo
  aparte también hubiera sido mandar dos mensajes. Confirmado con Wendy antes
  de construir.
- **`agent_enabled` gobierna los dos tipos**, no solo audio: un texto nuevo
  arranca apagado para el agente y se habilita a mano, igual que un audio.
  Confirmado con Wendy antes de construir.
- El `ToolOptionSource` nuevo que el plano original de F22 había descartado
  sigue descartado: `listar_recursos`/`usar_recurso` (`lib/agent/tools/assets.ts`)
  filtran directo por `agent_enabled = true`, igual que antes.

### El test de frontera

`lib/response-assets/table-boundary.test.ts`, mismo patrón que
`lib/ai/transcribe-boundary.test.ts`: recorre `lib`, `app`, `components` y
`scripts` (sumados estos dos últimos al patrón de `transcribe-boundary.test.ts`,
que solo escanea `lib`/`app`/`components`) y falla si `audio_assets` o
`response_templates` aparecen en código de aplicación, sin excepciones. Un
segundo chequeo confirma que los archivos que SÍ tienen que mencionar
`response_assets` (incluido `scripts/verify-chat-media.mjs`, que ningún test
de Vitest hubiera cubierto) lo siguen haciendo.

### Qué queda para la verificación en vivo (después de aplicar las migraciones)

- `/dashboard/settings/recursos` carga con el filtro Todos/Textos/Audios; las
  rutas viejas (`/templates`, `/audios`) redirigen.
- Crear un texto y un audio con el mismo atajo → el segundo falla con "Ya hay
  un recurso con ese atajo".
- En WhatsApp, `/` lista los dos tipos; un texto se inserta editable, un audio
  abre el preview (Enter no manda).
- En email, `/` lista solo textos.
- Grabar un audio, habilitar "Asistente", que el agente lo liste y lo mande;
  confirmar en Storage que el archivo de la biblioteca sigue ahí y el mensaje
  apunta a una copia.
- Borrar ese recurso: su archivo de biblioteca se va del bucket, y el mensaje
  ya enviado sigue reproduciéndose (apunta a la copia).
- `node scripts/verify-chat-media.mjs` — la sección B corre de verdad (ya no
  se saltea) e incluye el chequeo del atajo cruzado entre tipos.

## Bloque I — Bandeja (1/10/2026, rama `feat/bandeja-barra`)

### I7 · Nueva conversación saliente
- **Qué quedó:** no hay botón para empezar una conversación desde la Bandeja (no existía antes y no se agregó).
- **Por qué:** escribirle primero a alguien depende de la ventana de mensajería de cada canal: 24 h desde el último mensaje del contacto en WhatsApp, reglas distintas en Instagram, ninguna en email. Qué hacer fuera de esa ventana (plantilla aprobada, bloquear el botón, avisar) es una decisión de producto que el documento v2.0 no cubre.
- **Qué se decidió en su lugar:** nada en este bloque. Cuando se decida, el botón va en el `right` del `PageHeader` de la Bandeja, que quedó libre.

### Un link del dashboard de Chat manda un estado inválido
- **Qué quedó:** `components/dashboards/chat/kpi-cards.tsx:78` linkea a `/dashboard/inbox?estado=abiertas`. Los valores válidos son `all`, `open`, `closed`, `snoozed`.
- **Por qué:** `pickEnum` cae al default (`open`), así que la lista se ve bien de casualidad, pero la URL queda con un valor que no existe y la línea de resumen y las pastillas muestran "Abiertas" por el default, no por el link.
- **Qué se decidió en su lugar:** no se tocó: es del dashboard de Chat y no de la Bandeja. El arreglo es cambiar `abiertas` por `open`.

### Comentario viejo en `scripts/verify-inbox-filters.mjs`
- **Qué quedó:** el comentario de la línea 11 apunta a `app/(dashboard)/dashboard/inbox/page.tsx`; la página vive en `app/(dashboard)/dashboard/(comunicacion)/inbox/page.tsx` desde que existe el route group.
- **Por qué:** solo un comentario; la consulta que el script copia no cambió en este bloque.
- **Qué se decidió en su lugar:** se deja anotado.

### La búsqueda de la Bandeja es solo por nombre
- **Qué quedó:** el documento pedía el placeholder "Buscar por nombre, teléfono o texto del mensaje", pero el servidor busca solo por `contacts.display_name`.
- **Por qué:** ampliar la búsqueda cambia su semántica, y este bloque no la cambia.
- **Qué se decidió en su lugar (con Wendy):** el placeholder dice lo que hace, "Buscar por nombre". Buscar por teléfono o por texto del mensaje es una mejora aparte, que toca la consulta del servidor y `scripts/verify-inbox-filters.mjs`.

## Bloque G — Integraciones (2/10/2026, rama `feat/integraciones-dos-secciones`)

### WhatsApp (Evolution): no hay gestión de varias instancias
- **Qué quedó:** la pestaña Cuentas de `evolution` muestra el único número de WhatsApp del workspace (su `connection_status` y `last_error`, leídos de `channels`) y linkea a `/dashboard/channels` para el QR. No se construyó alta ni baja de instancias.
- **Por qué:** el modelo real del sistema es un número de WhatsApp por workspace (lo dice la propia descripción del proveedor en el catálogo); construir multi-instancia sería agregar una funcionalidad que el sistema no tiene en ningún otro lado.
- **Qué se decidió en su lugar:** se deja anotado para cuando el negocio necesite más de un número.

### La pestaña Actividad no audita conectar por OAuth ni renovar
- **Qué quedó:** `audit_log` hoy solo recibe dos acciones de una integración: guardar (`saveIntegration`) y desconectar (`disconnectIntegration`), siempre con `entity_type: "channel"` y `metadata.provider`. Autorizar una cuenta por OAuth, renovarla (el cron semanal o la renovación a demanda) y sus errores **no se auditan**. La pestaña Actividad del detalle (G5) muestra lo que hay en `audit_log` más el estado actual de la conexión (vencimiento, última renovación, scopes otorgados), para no dejarla vacía.
- **Por qué:** sumar `logAudit` al flujo de OAuth (`lib/oauth/flow.ts`, `lib/social/refresh-connection.ts`) es tocar ese flujo, que este bloque tiene prohibido tocar (regla del documento: "No se toca... el flujo de OAuth").
- **Qué se decidió en su lugar (con Wendy):** se deja para otro bloque. Cuando se haga, son dos `logAudit` nuevos: uno en `saveConnection` (`lib/oauth/flow.ts`) y otro en `refreshConnection` (`lib/social/refresh-connection.ts`), con `entity_type: "oauth_connection"` (ya existe en `AuditEntityType`) y `metadata.provider`.

### El `redirect_to` de OAuth siempre vuelve al listado, nunca al detalle
- **Qué quedó:** `ConnectWithProvider` (dentro de `credentials-form.tsx`) arma el link de autorizar con `redirect_to=/dashboard/settings/integrations` fijo. Autorizar una cuenta desde el detalle de `google`, `linkedin` o `threads` deja a la persona en el listado, no de vuelta en la pestaña Credenciales de donde salió.
- **Por qué:** `safeRedirect` (`lib/oauth/state.ts`) solo acepta una lista cerrada de rutas internas (un redirector abierto sería un agujero de seguridad), y sumarle la ruta del detalle es tocar el flujo de OAuth.
- **Qué se decidió en su lugar:** se deja igual. El arreglo es agregar `/dashboard/settings/integrations/[providerId]` (o un patrón) a `REDIRECT_ALLOWLIST` el día que se toque ese archivo por otro motivo.

## Bloques A+R — Observabilidad de IA (2/10/2026, rama `feat/observabilidad-ia`)

La instrumentación está mejor de lo esperado: diez fuentes registran corrida
por `lib/ai/run.ts` y no apareció consumo de IA sin registrar. Pero hay grietas
reales, y van acá para que nadie lea el mini dashboard como si fuera completo.
Este bloque **no las arregla**: solo las anota (§9.R5).

### R5.1 · Una transcripción que falla no deja corrida
- **Qué quedó:** en `lib/ai/transcribe.ts:374-375`, `recordUsage` se llama solo dentro de `if (attempt.ok)`. Un intento fallido (`:383-390`) no registra nada. Además `recordUsage` (`:402`) abre el run con `openAiRun` (`:409`) **después** de que el proveedor ya contestó (la llamada es la `:372`), al revés de lo que manda `run.ts`. Un audio que falló, o un proceso que se murió en el medio, no deja fila, y algunos proveedores cobran igual. De paso, `latency_ms` sale casi en cero, y si el proveedor no devuelve la duración el costo queda en `0` y no en `NULL` (no hay `addAudioUsage`, `:420`).
- **Por qué:** arreglarlo bien es cambiar el orden de apertura del run (abrir antes de llamar, cerrar con error si falla), y eso merece su propia corrida con sus tests.
- **Qué se decidió en su lugar:** no se tocó `transcribe.ts`. El dashboard puede subestimar el gasto de transcripción en los audios que fallan.

### R5.2 · El modo Económico todavía no mide
- **Qué quedó:** `app/api/cron/bg-collect/route.ts:7-13` dice en su propio comentario que el pipeline de lote está pendiente y que debería cerrar el run; la línea `:18` es un `TODO(bloque 5)`. Hoy no hay lotes en vuelo, así que no se pierde nada.
- **Por qué:** el pipeline no existe todavía.
- **Qué se decidió en su lugar:** cuando se encienda, cada lote tiene que abrir y cerrar su run con `openAiRun` antes de mandarse. Si no, va a haber consumo sin registrar.

### R5.3 · `message_classification_eval` está en el CHECK y nadie lo escribe
- **Qué quedó:** el valor está en `agent_runs_source_check` (`supabase/migrations/00103_transcripts_and_needs_human.sql:123`) y en el tipo `AgentRunSource` (`lib/types/database.ts:274`), pero ningún código lo escribe.
- **Por qué:** quedó reservado para una evaluación del clasificador que no se construyó.
- **Qué se decidió en su lugar:** `ai_spend_by_day` (00112) arma los orígenes **desde los datos del rango**, no desde el CHECK, así que el gráfico no muestra un segmento siempre vacío. El filtro de origen de Corridas tiene que hacer lo mismo.

### Observación extra · `missing_pricing` no cuenta los audios sin precio
- **Qué quedó:** `ai_cost_report` (`supabase/migrations/00071_draft_metrics.sql:75`), y por lo tanto `ai_spend_by_day`, que copia la definición, cuentan una corrida como "sin precio" solo si tiene tokens. Una transcripción con `cost_usd NULL` (modelo sin `audio_per_hour`) tiene `audio_seconds` pero no tokens, así que no aparece en el aviso.
- **Por qué:** `audio_seconds` llegó en la 00103, después de la definición.
- **Qué se decidió en su lugar:** se dejó igual en las dos para que la serie y el total coincidan. El arreglo es sumar `OR COALESCE(audio_seconds, 0) > 0` en las dos funciones, en una migración propia.

### Observación extra · El agente y el copywriter no avisan si no pueden leer los topes
- **Qué quedó:** `spendLimitsFor` (`lib/agent/runner.ts:1070-1075`) y el copywriter (`lib/agent/copywriter.ts:105-109`) leen los topes del workspace sin mirar el `error`. Si esa lectura falla, los topes globales se ignoran para ese turno. Es el mismo *fail-open* (dejar pasar ante el error) que tenía `workspace-budget.ts`, que en este bloque se cerró (R6.1).
- **Por qué:** cambiarlo en el runner es decidir qué hace un turno cuando no puede leer el workspace (error de turno o seguir sin topes), y no era parte de R6.
- **Qué se decidió en su lugar:** se deja anotado. La suma del gasto (`sum_ai_spend`) sí corta si falla, en los tres caminos.

## Corrida Contenido v3 (3/10/2026, rama `contenido-v3`)

### ~~La migración 00113 está escrita pero NO aplicada en la base~~ — APLICADA el 5/10/2026 con la CLI
- **Qué quedó:** `supabase/migrations/00113_comment_post_and_profile_rls.sql` agrega `social_post_comments.external_post_id`, `social_accounts.profile_sync_error` y reemplaza la lectura de métricas y comentarios por `has_permission` (social.view / dashboards.content.view). Es aditiva e idempotente. Se intentó aplicar por el MCP de Supabase y lo denegó el sistema de permisos de la sesión, dos veces. Después se aplicó con la CLI (`supabase db query --linked -f`), con OK explícito de Wendy. Verificado: columnas nuevas presentes, políticas `_select_permission` presentes, `_select_admin` de las tres tablas eliminadas, y `verify-rls` en verde (240 checks). **Nota:** `db query` no registra la migración en `schema_migrations`, así que `list_migrations` no la muestra.
- **Por qué:** el `/goal` autorizaba migraciones aditivas, pero la aplicación se bloqueó como "modificar recursos compartidos". No se intentó otra vía para lo mismo.
- **Qué se decidió en su lugar:** F75 se hizo sin escribir la columna de error (el código todavía no la escribe). F76 y el criterio de error de perfil quedan para el siguiente tramo.

### La 00118 queda para B12
- **Qué quedó:** la migración que borra `content_posts.copy` y `content_ideas.hook/angle/notes` todavía no está escrita. Se escribe con B12, sin aplicar.
- **Por qué:** B12 es el bloque que deja de usar esas columnas; escribirla antes no aporta.
- **Qué se decidió en su lugar:** se escribe junto con F90 y se anota aquí como pendiente de aplicación.

### `cambios-prototipo-contenido.md` no está en el disco
- **Qué quedó:** el segundo adjunto del pedido no llegó. Se buscó con `mdfind` y `find`.
- **Por qué:** no está en Downloads ni en el repo.
- **Qué se decidió en su lugar:** Wendy eligió seguir sin él. El plano v3 ya tradujo sus decisiones y el prototipo es la referencia visual.

### Diferencias del plano con el código (decididas con Wendy o por mí)
- **`analytics_events` no tiene `platform` ni `channel_id`:** están en `metadata`, y 171 de 636 eventos no tienen metadata. El backfill de F87 deduce el canal desde `conversations`.
- **`is_anonymous` es columna generada:** D8 se logra con `display_name = 'unknown commenter'` y sin otros identificadores.
- **`listAccounts` no trae bio:** F75 deja la bio sin tocar. Los seguidores por cuenta quedan para cuando se lean con `getFollowerStats`.
- **La configuración de Zernio se guarda como `channel` / `instagram_zernio`**, no como `publishing_service`: la sincronización lee la clave de Vault directamente, así que no depende de esa fila.
- **Comentarios de Instagram:** se vinculan solo si el contacto ya existe (decisión de Wendy).
- **Toques de DM:** solo los que suman información (decisión de Wendy).
- **Drawer de la pieza sin vista previa del teléfono:** como el prototipo v5 (decisión de Wendy).
- **Límite diario de TikTok:** el plano pide 15 videos + 15 fotos; el código tenía 30 en total. Se sigue el plano en F77.

### Pendientes de verificación en vivo (no se pueden probar sin cuentas reales)
- Que el plan de Zernio tenga Analytics (`hasAnalyticsAccess` ya se lee).
- Si Zernio registró el webhook con `post.platform.published` y `.failed` (el código ya lo pide).
- Si los DMs de anuncios traen datos de referencia (`referral` en el mensaje). No se verificó.
- Los crons de contenido respondiendo 200: no se verificó en esta corrida.

### ~~La 00113 no está registrada en el historial de migraciones~~ — REGISTRADA el 6/10/2026
- **Qué quedó:** la migración 00113 está aplicada y verificada (columnas, políticas y `verify-rls` con 253 checks), pero `supabase_migrations.schema_migrations` no tiene su fila: `list_migrations` no la muestra.
- **Por qué:** se aplicó con `supabase db query`, que no registra el historial, y el INSERT para registrarla lo denegó el sistema de permisos de la sesión (5/10/2026). No se intentó otra vía.
- **Resuelto el 6/10/2026** a pedido de Wendy: las seis (00113 a 00118) se registraron en `supabase_migrations.schema_migrations` con el mismo formato que las anteriores (versión = timestamp, nombre = el del archivo, `statements` = el SQL completo, `created_by` = Wendy). Las versiones son `20261006173244` a `20261006173249`, en orden: **son la fecha del registro, no la de aplicación** (la 00113 se aplicó el 5/10 y la 00118 el 6/10). `supabase migration list --linked` las muestra. El texto de abajo es lo que se pensó en su momento.
- **Lo que se había decidido:** nada rompe sin la fila (nada del código la lee). Si se quiere el historial al día: `insert into supabase_migrations.schema_migrations (version, name, statements) values ('<timestamp>', '00113_comment_post_and_profile_rls', array[$sql$<contenido del archivo>$sql$])`. Las migraciones siguientes (00114 en adelante) van a necesitar lo mismo.

### F79 · LinkedIn 202609: lo que no se verificó
- **Qué quedó:** `LINKEDIN_API_VERSION` pasó a `202609`. La documentación oficial de versionado la da como la última y dice que 202510 se da de baja el 15/10/2026. El changelog de LinkedIn (resumido, no leído entero) no muestra cambios entre 202510 y 202609 que afecten publicar texto como persona ni el userinfo.
- **Por qué:** la cuenta de LinkedIn no está conectada, así que no hay forma de probar una publicación real.
- **Qué se decidió en su lugar:** se verifica en vivo al conectar la cuenta (§9 del plano). Si LinkedIn rechaza la versión, el arreglo es esa constante. Revisar de nuevo antes de octubre de 2027.

### F75 · La bio de la cuenta queda vacía
- **Qué quedó:** `accounts.listAccounts` de Zernio no trae `bio` (el campo no existe en `SocialAccount`; solo en LinkedIn va dentro de `metadata`). La tarjeta de perfil de Social muestra foto, usuario, link y cifras, pero no la bio.
- **Por qué:** la otra fuente es `readProfile` de la Graph de Meta, que necesita el token de system user, que no está configurado.
- **Qué se decidió en su lugar:** `bio` queda en null (nunca un valor inventado). Se completa solo cuando haya token de Meta.

### Un test llegó a hacer pedidos reales a Zernio (corregido)
- **Qué pasó:** mientras armaba `lib/jobs/handlers/metrics-sync.test.ts`, una versión intermedia simulaba el lector de métricas pero no el cliente de comentarios, y el job hizo unos pedidos reales a la API de Zernio con una clave falsa (`key-simulada`). Zernio respondió "API key inválida". **No salió ninguna credencial real**, pero rompe la regla de no llamar a ningún proveedor.
- **Qué se hizo:** el test ahora simula `@/lib/zernio-client` y además hace que cualquier `fetch` real falle ruidoso. `e2e-zernio.test.ts` tiene la misma red de seguridad.
- **Resuelto el 6/10/2026:** `vitest.setup.ts` bloquea `fetch` en todos los tests (falla diciendo cuál era la URL); un test que lo necesita lo simula con `vi.stubGlobal`, y eso pisa el bloqueo solo mientras dura. Al agregarlo, los 418 archivos siguieron en verde: ninguno dependía de un `fetch` real. Hay un test del propio bloqueo (`lib/testing/fetch-block.test.ts`).

### ~~B11 · Hay que re-correr el backfill cuando el código nuevo se despliegue~~ — NO HIZO FALTA (6/10/2026)
- **Resuelto el 6/10/2026:** el despliegue de `main` (`e555e54`) terminó a las 08:07 UTC y se comprobó antes de decidir: los 650 contactos vivos tienen primer toque (0 sin toque, ni siquiera entre los no anónimos) y hay 650 toques. Los 3 contactos que entraron después del backfill ya los anotó el código nuevo. No se volvió a correr la 00115.
- **Lo que se había anotado:** la 00115 hizo el backfill de los 647 contactos que existían (todos de Instagram). Los receptores nuevos (F85 a F87) todavía no están en `main`, así que los contactos que entren entre la migración y el despliegue no van a tener toque.
- **Por qué:** la base ya está migrada y el código todavía no.
- **Qué se decidió en su lugar:** después del merge y del despliegue, volver a correr `supabase db query --linked -f supabase/migrations/00115_attribution_v2_and_backfill.sql`. Es idempotente (el backfill usa `ON CONFLICT DO NOTHING` y solo escribe donde la atribución está vacía; `create_booking` y los triggers son `CREATE OR REPLACE` con el mismo contenido).

### B11 · Lo que no se vio con datos reales
- **Panel de la bandeja:** no se abrió ninguna conversación real para verlo (abrirla la marca como leída). Usa el mismo modelo de vista que la ficha y tiene sus tests.
- **Ficha con varios toques** (las dos tarjetas y el camino plegado): hoy ningún contacto real tiene más de un toque, así que solo se vio el "Único toque". El modelo de vista lo cubre con tests y aparecerá con datos cuando un contacto interactúe de nuevo.
- **Datos de anuncio en un DM:** sigue sin verificarse que Zernio mande `referral` y que Evolution mande `externalAdReply` en un mensaje que venga de un anuncio. El código los lee de forma defensiva; se confirma en vivo (plano §9.7).
- **Carrera al crear un contacto de TikTok:** dos comentarios simultáneos de la misma persona nueva podrían crear dos contactos anónimos (se busca y después se inserta, sin un único en la base). Es poco probable y el costo es un contacto anónimo duplicado.

### ~~B11 · Las migraciones 00114 y 00115 tampoco están en el historial~~ — registradas el 6/10/2026 (ver arriba)
- **Qué quedó:** igual que la 00113: aplicadas con `supabase db query`, que no registra el historial, y el sistema de permisos denegó el INSERT en `supabase_migrations.schema_migrations`.
- **Qué se decidió en su lugar:** nada del código lee esa tabla. Queda anotado junto a la 00113.

### ~~B12 · La 00118 (destructiva) está escrita y NO se aplicó~~ — APLICADA el 6/10/2026
- **Aplicada el 6/10/2026** a pedido de Wendy, con la CLI. Antes se comprobó: el código nuevo ya estaba en producción (`e555e54`, SUCCESS desde las 08:07 UTC; el anterior quedó retirado), ningún archivo del código lee esas columnas (solo los tipos, que se limpiaron), las dos consultas de la cabecera dieron 0 (1 idea y 1 pieza, las dos vacías, y 0 ideas con pilar de texto) y se guardó un respaldo de las filas y de la definición de la función vieja. Después: 0 columnas viejas, 0 funciones viejas, `approve_content_idea_v2` presente, la app sigue leyendo y escribiendo el modelo nuevo. Los tipos `@deprecated` de `lib/types/database.ts` se borraron.
- **Qué es:** borra `content_ideas.hook/angle/notes/pillar`, `content_posts.copy` y la función `approve_content_idea` vieja.
- **Por qué no se aplicó:** borra datos. El código ya no lee ni escribe esas columnas, así que aplicarla no rompe nada, pero no tiene vuelta atrás.
- **Cuándo aplicarla:** después de ver la v3 funcionando en producción con piezas reales. Antes, correr las dos consultas de la cabecera de `supabase/migrations/00118_drop_legacy_content_columns.sql`: las dos tienen que dar 0. Con un backup (`supabase db dump`) o con tu confirmación.
- **Para tener en cuenta:** `supabase/migrations/ALL_MIGRATIONS.sql` la incluye (un test exige que el bundle tenga todas las migraciones), así que ese archivo es para una instalación NUEVA; no correrlo sobre producción. Al aplicarla hay que sacar de `lib/types/database.ts` las columnas marcadas `@deprecated`.

### ~~B12 · Las migraciones 00116 y 00117 tampoco están en el historial~~ — registradas el 6/10/2026 (ver arriba)
- Igual que la 00113 a la 00115: aplicadas con `supabase db query`, que no registra el historial. Nada del código lee esa tabla.

### B12 · Lo que no se vio con archivos reales
- **El selector de archivos de cada red y la biblioteca** no se vieron con archivos de verdad: la única pieza de producción no tiene redes ni archivos, y no quise subir nada al bucket real ni crear datos de prueba que no se puedan borrar. Quedan cubiertos por tests de render en el servidor (estructura, numeración, orden, ↑ ↓, verde y rojo, "Sin usar"). **Plan:** en la revisión visual de B13, armar una pieza `zz-test…` con archivos chicos, mirarla y borrarla.
- **La lectura de dimensiones y duración al subir** (`lib/content/media-probe.ts`) es código de navegador y no tiene test; si no puede leer un archivo, la subida sigue sin esos datos. Consecuencia buena y a vigilar: como ahora SÍ se guarda la duración, un Reel de más de 90 segundos recién se va a frenar en los archivos subidos desde ahora; los de antes no tienen el dato y siguen sin validarse.
- **`mediaType` en TikTok** (video o fotos, según el formato) es un campo nuevo en lo que se manda a Zernio. El tipo del SDK lo declara (`'video' | 'photo'`), pero no se probó contra la API real.

### B12 · Cosas chicas que conviene saber
- Las redes que crean `approve_content_idea_v2`, "Nuevo post" y "Agregar red" nacen **sin formato** (modelo anterior); la persona elige el formato en la fila.
- Las variantes con archivos propios del modelo anterior (`networks[].media`) siguen funcionando y no se migran: no hay ninguna en producción. Elegir un formato en esa red la pasa a la biblioteca.
- El detalle de solo lectura de una pieza (`/dashboard/content/[id]`) no muestra la clasificación nueva: B13 lo reemplaza por el drawer y lo redirige.

### B13 · El pie del drawer a 390 px
- **Qué quedó:** en el celular el pie de la pieza (el resumen y cuatro botones) se parte en tres filas y ocupa casi un quinto de la pantalla. Se usa, pero está apretado.
- **Por qué:** se priorizó que no hubiera scroll horizontal y que ningún botón desapareciera.
- **Qué se decidió en su lugar:** nada; si molesta, lo natural es dejar solo el botón principal a la vista y mandar "Guardar versión" y "Archivar" a un menú de tres puntos en el celular.

### B13 · Cosas que no se vieron con datos reales
- **El número de contactos por pieza con contactos de verdad:** hoy ningún contacto llegó por una pieza, así que solo se vio el caso "publicada con 0". La consulta se probó contra la base real (acepta la ruta JSON con alias y el filtro) y la regla tiene su test; falta verlo con un lead que haya comentado una pieza.
- **El historial con versiones y "Restaurar":** se vio vacío y con una versión; restaurar está cubierto por tests (`migrate-copy.test.ts`) pero no se apretó en vivo.
- **La aprobación de ideas en secuencia con varias ideas:** hay una sola idea real; la secuencia (siguiente/anterior, cerrar con aviso al terminar) está cubierta por `idea-gallery.test.ts` y no se vio con tres ideas.

### B13 · Cosas chicas que conviene saber
- ~~Los avisos de la campana y el link a la pieza desde la ficha de un contacto apuntaban a `/dashboard/content/<id>`~~ — **resuelto el 6/10/2026**: la campana, la ficha del contacto y el panel de análisis de un post abren directo `?piece=<id>` (con test). La ruta vieja sigue redirigiendo, por los links guardados.
- ~~La entrada `/dashboard/content/new` de `lib/nav/page-actions.ts` era de una pantalla que ya no existe~~ — **sacada el 6/10/2026**.
- El indicador "N" que aparece abajo a la izquierda en las capturas es la herramienta de desarrollo de Next, no algo de la app.
- **La CLI de Supabase dejó de iniciar sesión** un rato durante B13b (error 500 del lado de Supabase, "FGAAuthenticationError"); no había nada que aplicar en ese tramo, así que no frenó nada. Para sembrar y borrar los datos de prueba usé la clave de servicio del proyecto (como los scripts `verify-*`).

### B14 · Medir con métricas reales
- **Qué quedó:** el rendimiento por red del drawer y la tabla agrupada del dashboard se vieron con datos `zz-test` que sembré y borré (3 piezas, 9 publicaciones con sus fotos diarias, 3 contactos anónimos; después quedó 1 idea, 1 pieza, 0 cuentas, 0 publicaciones, 0 pilares y 0 ofertas). **No se vieron con métricas de verdad**: hoy no hay cuentas conectadas ni publicaciones reales.
- **Qué mirar cuando las haya:** que `engagement_d7` se congele solo a los 7 días (lo hace la lectura de métricas, no esto), que el índice salga con una base real de 3 o más publicaciones del mismo formato, y que los leads cuenten contactos reales (la consulta con ruta JSON `attribution->first_touch->>origin` se probó contra la base real con contactos sembrados).

### B14 · Decisiones donde el plano admitía dos lecturas
- **La ventana del índice termina el día de la publicación (90 días previos), no hoy.** El plano dice "los últimos 90 días". Con "hoy", el índice de una publicación cambiaría cada día y una de hace seis meses se compararía con lo que pasó hace un mes. Si se prefiere la otra lectura, el cambio es la condición de ventana de `publicationIndex` (`lib/dashboards/piece-index.ts`).
- **"En curso" solo dura 7 días.** Una publicación con más de 7 días y sin `engagement_d7` dice "Sin dato", no "En curso" para siempre (la red no dio alcance, o no se recolectó).
- **El filtro y la agrupación del dashboard tocan solo las publicaciones.** Los seguidores son de la cuenta, no de una pieza: no se filtran, y la pantalla lo dice.

### B14 · Cosas chicas que conviene saber
- ~~**Los nombres de red:** se veía "Youtube", "Linkedin" y "Tiktok"~~ — **resuelto el 6/10/2026**: `platformLabel` conoce TikTok, YouTube, LinkedIn y Threads (en las pantallas de antes también). Cambié a propósito el test que fijaba "Tiktok"; `isSupportedPlatform` y la lista que coincide con el CHECK de `channels.platform` no se tocaron.
- **La tabla agrupada del dashboard no se ordena por columna:** viene por cantidad de publicaciones, con "Sin asignar" al final. La tabla "Tus posts" de más abajo sí se ordena.
- **Tope de lectura de comparables:** el índice lee hasta 1.000 publicaciones comparables (PostgREST corta ahí sin avisar); si se llega, queda un aviso en el log. Con la cantidad de publicaciones que tiene un negocio como este no debería pasar.
- **Un hueco de tests que encontró la mutación y arreglé:** ningún test distinguía "el total de leads de la pieza" de "la suma de las filas" (la pieza cuenta una vez a quien llegó por una publicación ya borrada y las filas no). Con el test nuevo, los 14 mutantes de B14 quedan en rojo (tabla en `docs/PROGRESS-CV3.md`).
- **Los números del drawer se leen con el cliente de quien mira:** un Member ve solo los leads de sus contactos (alcance de leads), así que su columna "Leads" puede ser menor que la de un Admin. Es lo esperado.

## Cierre de la corrida Contenido v3 (actualizado el 6/10/2026)
- **La 00118 está aplicada** y las migraciones 00113 a 00118 están **registradas en el historial de Supabase**.
- **La 00115 no hizo falta volver a correrla** (los 650 contactos vivos tienen primer toque).
- **Lo que sigue abierto** (no se puede o no corresponde cerrar sin una decisión tuya o sin cuentas reales):
  - Verificar en vivo con cuentas conectadas: el índice con métricas reales, los datos de anuncio en un DM (`referral` de Zernio, `externalAdReply` de Evolution), el webhook de Zernio y la versión de la API de LinkedIn.
  - El pie del drawer a 390 px (ver "B13 · El pie del drawer a 390 px"): es una decisión de diseño.
  - La carrera de dos comentarios simultáneos de TikTok (ver "B11 · Lo que no se vio con datos reales"): arreglarla de verdad pide un único en la base, o sea una migración nueva (la 00119 ya se usó para el white label, ver más abajo; la próxima libre es la que corresponda en ese momento), y el costo del problema es un contacto anónimo duplicado.
  - Las cosas de otras corridas (bio de la cuenta, más de una instancia de Evolution, etc.), que siguen donde estaban.

## White label (corrida en `oneshot-white-label`, 7/10/2026)

Detalle completo en [docs/PROGRESS-white-label.md](PROGRESS-white-label.md).
Las migraciones 00119 a 00123 ya están aplicadas contra la base real y
verificadas; esto es lo que queda, no lo ya hecho.

- **Qué quedó:** apagar "Allow new users to sign up" en el Supabase alojado
  (Authentication → Sign In / Providers).
- **Por qué:** es un ajuste de seguridad del proyecto de Supabase, no algo
  que se pueda hacer por código ni por migración.
- **Qué hay que hacer:** entrar al panel de Supabase del proyecto
  `knrxjnmxnmjavivyuwew` y apagarlo a mano. El registro público del lado de
  la app (`/register`) ya no existe desde el código (Bloque A), así que esto
  es un cinturón de seguridad extra: alguien que llamara directo a la API de
  Supabase Auth con `signUp` todavía podría crear una cuenta hasta que se
  apague.

- **Qué quedó:** un segundo workspace, "Paula Diaz's Workspace", separado
  del workspace real de Wendy.
- **Por qué:** el `/register` público (ya borrado) y el trigger viejo de
  altas crearon un workspace propio para cualquiera que se registrara; esa
  persona no es miembro del workspace de Wendy.
- **Qué se decidió en su lugar:** no tocarlo. Si esa persona es alguien del
  equipo de Wendy, hay que invitarla de nuevo (ahora por invitación) al
  workspace real; si no, es una cuenta huérfana sin dato sensible del
  negocio adentro (vacía salvo lo que esa persona haya cargado ahí misma).

- **Qué quedó:** el mismo corte de día en UTC (`.slice(0,10)` sobre un ISO)
  que se arregló en los dashboards de contenido/ads/unified aparece tambien
  en `lib/dashboards/post-analysis.ts`, `lib/dashboards/follower-bump.ts` y
  `lib/dashboards/chat/trends.ts`.
- **Por qué:** no estaban en la lista original de archivos a arreglar de
  esta corrida, y agregarlos sin que nadie los pidiera era ampliar el
  alcance por cuenta propia.
- **Qué hay que hacer:** el mismo patrón ya aplicado en
  `lib/dashboards/content.ts`/`ads-load.ts`/`content-load.ts`: bucketear
  con `civilDate`/`isoToDateInput` en la zona que corresponda (de quien
  mira, si es un dashboard) en vez de `.slice(0,10)`.

- **Qué quedó:** el barrido de `"es-AR"` suelto en formateadores (~38
  archivos) hacia una variable `NEXT_PUBLIC_LOCALE`, y `DEFAULT_PHONE_COUNTRY
  = "CR"` hacia `NEXT_PUBLIC_DEFAULT_COUNTRY`.
- **Por qué:** son configurables por cliente en espíritu (un cliente en
  México preferiría `es-MX` y país `MX`), pero ninguno es un bug: hoy
  funcionan igual para cualquier cliente, solo que con formato y código de
  país argentino/costarricense fijos en vez de configurables. Se priorizó
  arreglar los bugs reales de zona horaria (horario del agente, topes de
  gasto, filtros con el default equivocado) antes que este pulido.
- **Qué se decidió en su lugar:** queda anotado para una corrida aparte. El
  patrón para hacerlo es el mismo que `lib/brand.ts`/`lib/ai/language-style.ts`:
  un módulo puro que lee la variable de entorno con un default.

## Contenido v4 (corrida del 7/10/2026)

- **Incidente durante la 00126 (backfill de formato), arreglado en el momento.**
  La primera versión de la función de la migración usaba
  `jsonb_set(entry, '{format}', to_jsonb(new_format), true)`. Cuando no se
  podía mapear un formato (`contentType='feed'` con 0 archivos) `new_format`
  era `NULL` de SQL, y `to_jsonb(NULL)` también es `NULL` de SQL: `jsonb_set`
  con un `new_value` que es `NULL` de SQL devuelve `NULL` para toda la fila,
  no el jsonb `null`. La única pieza de producción quedó con
  `"networks":[null]`, perdiendo también `cta`, `options` y `platform` de esa
  entrada.
  - **Se detectó al toque** (se leyó la fila después de aplicar, como pide
    el procedimiento) y se restauró con el valor exacto que se había leído
    antes de aplicar (capturado en la exploración inicial de esta misma
    corrida). Se verificó con una lectura posterior que coincide con el
    original.
  - **La función se corrigió** (`COALESCE(to_jsonb(new_format), 'null'::jsonb)`,
    que si convierte `NULL` de SQL en el jsonb `null`) y se probó la
    expresión sola, de forma aislada y de solo lectura, antes de volver a
    aplicar la migración sobre la base real.
  - **Ningún dato se perdió**: la restauración fue exacta y la segunda
    corrida de la migración, ya corregida, dejó la fila con `"format":null`
    (el resultado esperado: 0 archivos, no se adivina un formato) y el
    resto de la entrada intacto.
  - **Queda para la próxima vez que se escriba una migración así**: probar
    la expresión jsonb por separado (una `SELECT` de solo lectura, sin tocar
    la tabla) antes de aplicarla sobre una columna jsonb completa, en vez de
    confiar en que el camino "sin valor" de un `CASE` se comporta como el
    camino "con valor".

- **La pieza `425ac42a-2c7b-42ec-b047-5af199b64cc6`** (la única en
  producción) tiene su red de Instagram con `format: null` después de la
  00126: tenía `contentType: 'feed'` pero 0 archivos, y la regla del
  documento (§17) es no adivinar un formato sin archivos. En el drawer esa
  red va a aparecer con la verificación en rojo ("Elegí el formato") hasta
  que alguien lo complete a mano.

### Contenido v4 · La 00128 (destructiva) está escrita y NO se aplicó

- **Qué es:** borra `content_posts.material_status` y la clave
  `options.contentType` de adentro de cada entrada de `networks[]`
  (`supabase/migrations/00128_drop_material_and_content_type.sql`).
- **Por qué no se aplicó:** borra datos. El código ya no lee ni escribe
  ninguna de las dos (grep limpio en `lib/` y `app/`, salvo el comentario del
  tipo de la base y el campo propio que el *body* de Zernio le manda a
  Zernio, que se llama igual por casualidad), así que aplicarla no rompe
  nada funcionando — pero no tiene vuelta atrás.
- **Cuándo aplicarla:** después de ver la v4 funcionando en producción (ver
  §16 del documento, "Verificación en vivo"). Antes, correr la consulta C de
  la cabecera de la migración (tiene que dar 0) y guardar el respaldo de la
  consulta D (`material_status` y `networks` de toda `content_posts`).
- **Para tener en cuenta:** igual que la 00118 de Contenido v3,
  `supabase/migrations/ALL_MIGRATIONS.sql` la incluye (un test exige que el
  bundle tenga todas las migraciones) — ese archivo es para una instalación
  NUEVA, donde la base está vacía y no hay nada que perder. No correrlo sobre
  producción.

### Contenido v4 · Una red queda con `format: null` después de la 00126

- **Qué es:** la única pieza de producción tiene una red de Instagram con
  `options.contentType: 'feed'` pero **0 archivos**. La migración 00126
  (backfill de formato) no adivina un formato sin archivos (regla del
  documento, §17), así que esa red quedó con `format: null`.
- **Qué se ve:** en el drawer, esa tarjeta de red aparece con la
  verificación en rojo ("Elegí un formato") hasta que alguien lo complete a
  mano. No bloquea nada más de la pieza.
- **Qué hacer:** abrir la pieza, elegir el formato de esa red (y los
  archivos, si corresponde) la próxima vez que se trabaje con ella.

### Contenido v4 · Incidente durante la 00126, corregido en el momento (sin pérdida de datos)

Ver la sección "Contenido v4 (corrida del 7/10/2026)" más arriba en este
mismo archivo: el detalle completo del bug de `jsonb_set` con `NULL` de SQL,
cómo se detectó, cómo se restauró y cómo se corrigió antes de reaplicar.

### Contenido v4 · Revisión visual contra el prototipo — pendiente con Wendy

- **Qué quedó:** la comparación del drawer de la pieza, el de la idea, el
  kanban y el calendario contra la copia local del prototipo (v23), a 1440 y
  390 px, en claro y oscuro, no se hizo en esta corrida.
- **Por qué:** la app pide iniciar sesión y no hay una sesión abierta en
  este entorno; la regla del proyecto es no ingresar credenciales.
- **Qué hacer:** levantar `npm run dev`, iniciar sesión como Wendy, y
  recorrer las cuatro pantallas de la sección 11 del documento
  (`requerimientos-contenido-v4.md`) contra `docs/referencia/prototipo-ssa-baios.html`.

## Banca de recursos ampliada v2 (8/10/2026, rama `oneshot-recursos-v2`)

Seis tipos (texto, audio, video, imagen, archivo, enlace), Recursos en el menú
lateral, el widget del chat (botón, "/" y ⌘/Ctrl + /) y el agente con los seis
tipos. Avance completo en `docs/PROGRESS-recursos-v2.md`.

### ~~Migraciones~~ — APLICADAS y registradas el 8/10/2026
`00131_response_assets_six_kinds` y `00132_touch_response_asset` (el plano las
numeraba 00125/00126, que ya estaban ocupadas). Ensayadas antes en una
transacción que se deshace sola; verificadas con `verify-chat-media.mjs`
(sección D), `verify-rls.mjs` y `verify-roles.mjs`, los tres en verde. Se
aplicaron ANTES del deploy, como pide el plano: el código viejo funciona igual
contra la base nueva.

### La revisión visual, sin hacer (pide sesión)
No la pude hacer: entrar pasa por Supabase Auth en la nube y eso no lo hago
yo. Con alguien logueado en `localhost:3000`, revisar:
- `/dashboard/settings/recursos` como Admin: estado vacío con los seis botones;
  alta de cada tipo con un archivo chico real; la miniatura de un mp4, un webm y
  un .mov (en Chrome un .mov HEVC no saca miniatura y tiene que quedar el
  ícono); filtros por tipo y etiqueta; "Ver" de cada tipo; Reintentar.
- La misma pantalla como Member: lista completa, "Ver", copiar un texto, sin
  botones de alta ni edición. Y como un rol personalizado con
  `templates.manage`: con los botones.
- El ítem "Recursos" del menú lateral queda marcado, y la pestaña también.
- La bandeja: el botón de la biblioteca, "/" y ⌘/Ctrl + / abren el mismo
  widget; se abre con la banca vacía; Escape después de "/" devuelve la barra;
  en un email los cuatro tipos con archivo quedan deshabilitados con el motivo;
  en Instagram, el archivo. **Sin apretar Enviar en una conversación real.**

### Pruebas en vivo que solo se pueden hacer mandando de verdad
- **Media por WhatsApp**: en producción NUNCA salió un adjunto por Evolution
  (0 filas), y `lib/evolution-client.ts` dice que el body de
  `/message/sendMedia` no quedó verificado contra Evolution 2.3.7. Mandar una
  imagen, un video y un PDF a un número propio.
- **Video por Instagram**: los 3 videos que se mandaron por Instagram el
  2/10/2026 quedaron `failed`, sin motivo guardado. Wendy decidió ofrecerlo
  igual; la causa se investiga aparte (tarea abierta al cierre de esta corrida).
- **Transcripción de un video real** (mp4 con voz) contra Groq.

### Decisiones tomadas en la corrida (documentadas)
- **Archivos por Instagram no se ofrecen**: los tipos de `@zernio/node` aceptan
  `attachmentType: 'file'` para cualquier plataforma, pero nada confirma que
  Instagram entregue un PDF por DM. `channelAccepts` lo bloquea también en la
  API, así que el clip ya no manda documentos por Instagram (en producción hubo
  0 envíos de documentos).
- **HEIC se rechaza en la banca** con un mensaje que dice cómo resolverlo
  (convertir a JPG/PNG). Antes, `sniffMime` llamaba `video/mp4` a una foto HEIC.
- **txt y csv no entran como archivo**: no tienen firma en sus bytes. Se sacó
  `.txt` del clip, que lo ofrecía y después lo rechazaba.
- **La lista pagina en memoria** (de a 25, hasta 1000 recursos): mismo ranking
  que el widget y conteos exactos. A la escala de un workspace sobra.
- **Un video "sin voz"** (`transcript_status = 'none'`) lo usa el agente por su
  descripción. Un video con voz pasa por `none` el minuto que tarda la cola en
  reclamarlo: en esa ventana el agente podría ofrecerlo por su descripción. Es
  aceptable (la descripción es obligatoria y el interruptor del agente arranca
  apagado), pero queda anotado.
- **El caso del rol personalizado** se prueba en `verify-chat-media.mjs`
  (sección D) y no en `verify-roles.mjs`: es donde vive toda la cobertura de
  `response_assets`.

### Errores de lint que no son de esta fase
`npm run lint` da 4 errores en `components/agents/ai-dashboard/*` y
`components/settings/integrations/onboarding-banner.tsx`, que esta corrida no
tocó. El build pasa igual.

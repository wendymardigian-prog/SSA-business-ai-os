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

### Las pantallas internas no se recorrieron a ojo
- **Qué quedó:** Agenda, Configuración de agenda (Ajustes, Calendarios de Google y las secciones provisorias) no se vieron en el navegador ni a 1440 ni a 390 px.
- **Por qué:** la app pide login; el navegador integrado no tiene sesión y la regla de la corrida prohíbe escribir credenciales. `/dashboard/agenda` redirige a `/login`.
- **Qué se decidió en su lugar:** la lógica de cada pantalla va en funciones puras con tests (`config-sections`, `profile`, `calendars`, `bookable`, `viewer-timezone`), los guards y la RLS se prueban con `verify-scheduling` y `verify-rls`, y los encabezados de seguridad se comprobaron con `curl` contra el dev server. La recorrida visual queda para la verificación en vivo (§18). Las públicas (booker, embed) se revisan siempre (B4b, B6).

### El "Horario normal" inicial del perfil se crea en el Bloque 2
- **Qué quedó:** F3 pide que al crear el perfil exista un horario por defecto. En B1 el perfil se crea sin horario.
- **Por qué:** `availability_schedules` llega con la migración 00096 (B2); crear la fila en B1 sería referenciar una tabla que no existe.
- **Qué se decidió en su lugar:** en B2 la acción de crear/guardar el perfil crea "Horario normal" si la persona no tiene ninguno, y un backfill de la 00096 lo hace para los perfiles que ya existan.

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

## Heredado de la Etapa 2

No son parte de esta corrida. El detalle de cada uno está en [docs/etapa2/PENDIENTE.md](etapa2/PENDIENTE.md) con su "qué quedó / por qué / qué se decidió". Ninguno bloquea la Etapa 4.

- Las pantallas del Bloque 1 de la Etapa 2 (y en general las internas) no se recorrieron a ojo: la app pide login.
- "Migrar a Vault" de Zernio construido y no apretado (la 00090 ya se aplicó el 26/9).
- La documentación de Postproxy no coincide con el plano (sin webhooks; el estado se consulta con un job).
- 20 vulnerabilidades de npm previas a la Etapa 2.
- Heredado de la Fase 3: API por lote, handler de `bg_task` (se reencola cada 15 minutos), UI de calidad del clasificador, tendencias con 4 pestañas, "qué le responden", `declarar_intencion` opt-in, migración 00072 sin aplicar, deuda del agente (ver `agente-ia.md`), `generate-reply` sin topes de gasto, `serverActions.bodySizeLimit`, broadcasts solo por Zernio.
- La prueba de subida directa a YouTube no se corrió; el receptor de Postproxy está sobre un formato supuesto; LinkedIn publica solo texto y no da métricas ni comentarios; Zernio sin `delta` ni cursor; historial inicial de seguidores por red; tres cifras vacías en Social; historias activas sin mostrar; tarjetas de desglose del detalle de anuncios; el análisis con IA no guarda los anteriores.
- `has_permission` no conoce los permisos del Member de sistema (por eso `can_see_booking` cae al chequeo de anfitrión para ese rol).
- Correcciones: Postproxy se queda en el despachador (D9), "Agregar a la cola" de Zernio sin hacer (D8), la ventana de idempotencia de Zernio son ~5 minutos (A15/D7), el SDK de Zernio lanza en vez de devolver el error, la vista semanal del calendario de contenido sin hacer (C14).

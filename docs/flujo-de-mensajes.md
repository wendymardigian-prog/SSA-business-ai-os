# Flujo de mensajes y política de datos

Dónde vive cada mensaje, quién lo escribe y cuánto dura. Hasta la Fase 3 esto
estaba solo en comentarios sueltos y la respuesta cambiaba según el archivo que
abrieras.

## La regla corta

> **Se guardan los mensajes de todos los canales. La bandeja los sigue leyendo
> de donde los leía siempre.**

Son dos cosas distintas y conviene no mezclarlas: **dónde se escribe** cambió en
la Fase 3, **de dónde se lee** no.

## Qué se guarda

Cada mensaje que entra o sale deja una fila en `messages`, con:

- el texto,
- los metadatos (dirección, fecha, quién lo mandó),
- el **link** a la imagen, el video o el audio.

**El archivo nunca se guarda.** De la media queda la URL que da la plataforma y
nada más.

## Los dos ids de un mensaje

Un mensaje de Instagram tiene dos identificadores y se guardan los dos, en
columnas distintas, porque sirven para cosas distintas. Es la fuente de error
más fácil de cometer en esta parte del sistema.

| Columna | Qué guarda | Para qué |
|---|---|---|
| `platform_message_id` | El id de **Zernio** (webhook y `recordSend`) | Es la columna del índice único `(conversation_id, platform_message_id)`. La usan el envío, la lectura de la bandeja (`toInboxMessage`) y el backfill |
| `platform_native_message_id` | El id de **Meta** (el `mid` largo) | El handle para un pedido de borrado o un reclamo de soporte ante Meta. **Y la segunda clave de deduplicación del backfill** |

**Ojo: el endpoint de historial de Zernio devuelve en `id` el id nativo de
Meta, no el de Zernio.** Verificado contra la API real el 24 de septiembre de
2026: un mensaje guardado por webhook con `platform_message_id = 6ab5…` (24
hex, ObjectId de Zernio) y `platform_native_message_id = aWdf…` vuelve del
historial con `id = aWdf…` y sin otro campo de id. La versión anterior de este
documento afirmaba lo contrario, y con esa suposición el backfill habría
duplicado todos los mensajes entrados por webhook.

Por eso el backfill deduplica contra **las dos columnas** y, como red de
seguridad, contra dirección + fecha (al milisegundo) + texto. Sus filas llevan
el id del historial en `platform_message_id` (para que la segunda corrida lo
descarte por el índice) y, si tiene forma de id de Meta, también en
`platform_native_message_id`. El receptor de webhooks sigue guardando los dos
ids, cada uno en su columna.

## De dónde lee la bandeja

| Canal | Escribe | **Lee** |
|---|---|---|
| Instagram (Zernio) | el receptor, en `messages` | **la API de Zernio**, en vivo |
| WhatsApp (Evolution) | el receptor, en `messages` | `messages` |

Para Instagram es un **dual-write**: se guarda en paralelo y la lectura no
cambió. Es a propósito, hasta tener confianza en la data local. Moverla es un
cambio de una línea en `app/api/v1/messages/route.ts`, y tiene una consecuencia
a tener en cuenta: el hilo de Zernio trae los salientes mandados **desde
cualquier lado** (incluida la app de Instagram en el teléfono), mientras que la
tabla local solo tiene los que salieron por el sistema.

## El guardado es siempre (ya no hay interruptor)

Los entrantes de **todos los canales conectados** (Instagram por Zernio,
WhatsApp por Evolution y los que vengan) se guardan siempre en `messages`. Los
comentarios, también (`social_post_comments`). No hay nada que prender ni apagar
en Ajustes.

Hasta octubre de 2026 existía `workspaces.persist_zernio_inbound` (Ajustes →
Guardado de mensajes) para apagar el guardado de Instagram mientras se confirmaba
si persistir el contenido de los DMs entraba en los términos de Zernio y de Meta.
Se decidió guardar siempre: el agente lee el historial de esta tabla y los
dashboards cuentan sobre ella.

- La columna `persist_zernio_inbound` **sigue en la base y ya nadie la lee**. Se
  borra más adelante, con el orden de siempre (primero el código desplegado).
- `scripts/purge-zernio-inbound.mjs` sigue sirviendo para borrar a mano lo
  guardado de Zernio si algún día hiciera falta.
- La retención de 12 meses (`purge_old_messages`) vale para todos los canales.

## Retención

| Qué | Cuánto dura | Quién lo borra |
|---|---|---|
| Mensajes crudos | **12 meses** | `purge_old_messages`, cron diario a las 5:00 UTC |
| Mensajes de un contacto borrado | 30 días desde el soft delete | `purge_soft_deleted` los arrastra por las FK en cascada |
| Agregados de dashboards | indefinido | — (son conteos, sin texto ni datos personales) |

Dos aclaraciones que suelen sorprender:

- **"No contactar" no borra nada.** Esa marca dice que no le escribamos más, no
  que borremos lo que dijo. Sus mensajes siguen la retención normal.
- **No hay soft delete en `messages`.** El borrado es físico. Un `deleted_at`
  dejaría el texto del lead en la base aparentando estar borrado, que es lo
  contrario de lo que la política se compromete a cumplir.

## El historial de WhatsApp (revisión, 30/10/2026)

WhatsApp no tiene una API de historial: lo único que existe es lo que WhatsApp le
manda a Evolution **cuando se escanea el QR** (el historial reciente, salvo que la
instancia tenga `syncFullHistory`) y lo que Evolution recibe desde entonces. Evolution
lo guarda en su propia base si su `DATABASE_SAVE_DATA_HISTORIC` está prendido.

**La revisión** (Canales → la tarjeta del número → "Historial" → "Revisar historial")
lee esa base, sin escribir nada y sin hablar con WhatsApp, y dice cuántas
conversaciones con personas hay guardadas, cuántas no están en la bandeja, cuántos
mensajes y desde cuándo, y si hay mensajes de antes de conectar el número.

**La importación todavía no existe.** El plan, si la revisión muestra que vale la pena:
un trabajo de la cola por partes (como el de Instagram, con `channels.inbox_import`),
que crea contacto y conversación por `find_or_link_contact` con la misma identidad
del receptor (teléfono o `@lid`), guarda los mensajes como historia (sin no leídos,
automatizaciones, agente ni toques de atribución, deduplicados por
`platform_message_id`), deja **cerradas** las conversaciones sin movimiento hace más
de 7 días (para no llenar "Esperando respuesta") y saltea grupos. La media vieja puede
no estar más disponible en WhatsApp: el texto entra igual.

## WhatsApp sin teléfono (`@lid`, 30/10/2026)

WhatsApp ya no siempre comparte el número de la persona: a veces la identifica con
un `@lid` (`98765432101234@lid`), un id interno. Evolution 2.3.7 lo reemplaza por el
teléfono antes de mandarnos el webhook **solo cuando lo sabe** (`key.remoteJidAlt`;
otras versiones lo mandan en `senderPn`, `participantPn` o `participantAlt`). Si nos
llega un `@lid`, nadie sabe el número.

Hasta el 30/10/2026 el receptor descartaba esos mensajes y la conversación, que se
veía en el celular, no entraba nunca. Ahora:

- La identidad es el teléfono o, si no hay, el `@lid` (`lib/whatsapp-sender.ts`). El
  contacto nace con el nombre del perfil de WhatsApp (o "Contacto de WhatsApp") y sin
  teléfono, y se le responde al `@lid` (Evolution lo acepta como destino).
- Si esa persona después llega con su número, sigue en el mismo contacto y se le suma
  el teléfono. Si llega por otro lado sin pasar por el `@lid` (por ejemplo, alguien
  le carga el número a mano en otro contacto), pueden quedar dos: se juntan con la
  fusión de contactos.
- Grupos, estados, difusiones y canales de WhatsApp siguen afuera: no son un lead.

## Las conversaciones que entran (importación de Zernio, 00267)

Una conversación de Instagram entra a la tabla `conversations` por uno de estos
caminos. Ninguno dispara automatizaciones ni el agente salvo el primero:

1. **Un mensaje de la persona** (`message.received`): el de siempre.
2. **El eco del primer mensaje del negocio** (`message.sent`): si el negocio
   escribió primero (desde el celular, o una automatización de comentarios
   mandó el DM) y la persona todavía no contestó, `handleMessageSentEcho` crea
   el contacto y la conversación con la persona que Zernio manda en
   `conversation` (`ensureZernioConversation`, sin no leídos). Antes se
   descartaba con "conversación no encontrada".
3. **El aviso de conversación nueva** (`conversation.started`): lo mismo, sin
   mensaje. Es el cinturón de seguridad del 2. Una instalación que ya existía lo
   recibe recién después de tocar **"Sincronizar canales"** una vez (así Zernio
   suma el evento al webhook).
4. **La importación** (trabajo `inbox_import` de la cola): trae las
   conversaciones que la cuenta ya tenía. Recorre TODO lo que Zernio tenga,
   activas y archivadas, de a 100 por vuelta, sin tope. Arranca al guardar la
   clave de Zernio, al conectar una cuenta y con "Sincronizar canales", y se
   repite sola **a las 24 horas y a los 7 días** de la primera, porque Zernio
   sigue trayendo el historial viejo de Instagram un rato después de conectar y
   no avisa cuando termina. Ante un 429 o un 5xx espera 1, 5 y 15 minutos y
   vuelve a pedir la misma página; después queda "incompleta" con el motivo y
   un botón **Reintentar** en la tarjeta del canal. El avance vive en
   `channels.inbox_import` (lo lee y lo pinta `lib/channels/import-status.ts`);
   las reglas, puras, en `lib/inbox-import/state.ts`, y lo que habla con la base y
   con Zernio en `lib/inbox-import/run.ts`.

**Antes de la 00267 la importación se cortaba en 200 por cuenta** y corría una
sola vez: todo lo anterior a las 200 más recientes nunca entraba, y volver a
sincronizar miraba las mismas 200. Se vio en un cliente (dos cuentas con
exactamente 200 importadas) el 28/10/2026. Plan y diagnóstico en
`docs/instagram-importacion/PLAN.md`.

**El techo de Meta sigue:** de antes de conectar la cuenta, Zernio puede traer
hasta 500 conversaciones. Más atrás no existen por API. Y las conversaciones de
una cuenta donde OTRA app es la dueña del hilo (ManyChat como app principal)
no le llegan a Zernio: eso se cambia en Meta, no acá.

La importación trae la conversación, no sus mensajes viejos: en Instagram la
bandeja lee el hilo en vivo de Zernio, así que se ven igual. Copiarlos a
`messages` es el backfill de abajo.

## Backfill

`scripts/backfill-zernio-messages.mjs` trae lo que la API todavía tenga. El
techo es de Meta y no se puede mover: **500 conversaciones por cuenta y 500
mensajes por conversación**. Lo anterior no existe para nadie.

Se corre a mano desde la raíz del repo. Sin flags es una **simulación** (no
escribe nada); con `--apply` escribe; con `--limit=N` prueba con pocas
conversaciones.

```bash
node scripts/backfill-zernio-messages.mjs
```

**Hay que volver a correrlo unos días después de cada pasada.** El replay de
Meta hacia Zernio corre en segundo plano y puede terminar después del primer
barrido: el propio SDK recomienda no confiar en una sola pasada. Correrlo de
nuevo es gratis, la deduplicación descarta lo que ya está y solo suma lo que
apareció en el medio. La primera pasada en firme fue el 24 de septiembre de
2026 (ver `BITACORA.md`); **la segunda conviene hacerla en la semana del 1 de
octubre de 2026.** Mientras la ventana de 500 mensajes por conversación siga
corriéndose, lo que se cae del borde no lo recupera nadie.

Zernio limita la cantidad de llamadas seguidas ("Rate limit exceeded. Please
retry after N seconds"): el script espera lo que pide y reintenta hasta tres
veces por página, así que una corrida completa de ~580 conversaciones tarda
varios minutos. Es normal.

No trae los mensajes que el remitente borró (`isDeleted`), por la misma regla de
Meta que se honra en la retención.

## Quién escribió cada mensaje

`messages` distingue cuatro autores, todos nullables:

| Columna | Quién |
|---|---|
| `sent_by_user_id` | una persona del equipo |
| `sent_by_flow_id` | un flow del builder |
| `sent_by_node_id` | el nodo puntual — **declarado desde la 00001 y nunca escrito**. Deuda conocida |
| `sent_by_agent_id` | el agente de IA. FK a `agents` desde la 00058. El run que lo generó queda en `agent_run_id` (00059) |

## Qué pasa después de guardar un entrante

En `runInboundAutomation` (`lib/inbound.ts`), en este orden:

1. **Conversación tomada a mano** (`is_automation_paused`): los flows no corren.
2. **Palabra clave global** (STOP, START): consume el mensaje.
3. **Sesión de flow esperando respuesta** (un "Esperar respuesta"): se retoma con
   este mensaje, **matchee o no un trigger**.
4. **Triggers de flows**: el primero que matchee arranca su flow.
5. **Agente de IA**: `runInboundAutomation` devuelve quién reclamó el mensaje y,
   si nadie lo hizo, `maybeScheduleAgentTurn` agenda el turno del agente. Ver
   [agente-ia.md](agente-ia.md).

Desde la Fase 3 los envíos manuales desde la bandeja también se guardan en
`messages` (con `sent_by_user_id`), para Instagram y WhatsApp: el agente lee el
historial de la base y necesita ver lo que contestó una persona.

El paso 3 cambió en la Fase 3 (Bloque 2a). Antes el chequeo de la sesión en
espera vivía adentro de `executeFlow`, que solo se llamaba si algún trigger
reclamaba el mensaje: una conversación parada en "Esperar respuesta" quedaba
dormida si la respuesta del lead no matcheaba nada. Con el agente de IA eso
hubiera sido peor: el agente se habría llevado las respuestas que el flow estaba
esperando. Test de regresión: `lib/flow-engine/resume-on-inbound.test.ts`.

## Dónde mirar

| Archivo | Qué hace |
|---|---|
| `lib/inbound.ts` | `insertMessage` y `persistInboundMessage`: la puerta por la que pasan los entrantes |
| `app/api/webhooks/late/route.ts` | receptor de Zernio (HMAC, idempotencia, ack inmediato) |
| `app/api/webhooks/evolution/route.ts` | receptor de WhatsApp |
| `app/api/v1/messages/route.ts` | de dónde sale el hilo para la bandeja |
| `lib/zernio-message.ts` | traduce la respuesta de Zernio (tres trampas documentadas ahí) |
| `lib/backfill-messages.ts` | el backfill |
| `lib/inbox-import/` y `lib/inbox-sync.ts` | la importación de conversaciones de Zernio (00267) |
| `scripts/verify-message-persistence.mjs` | la verificación contra la base real |

## Los adjuntos (Mejoras de Chat)

Hasta esta fase `messages.attachments` era una columna `jsonb` libre y cada
origen escribía una forma distinta: el objeto de email, el array crudo de Zernio,
el nodo crudo de Baileys y lo que registraba un flow al enviar. Cuatro formas
quiere decir que la burbuja no podía decidir qué pintar.

Ahora se guarda **una sola forma**:

```ts
{ v: 2, items: ChatAttachment[] }
```

Cada item dice qué es (`kind`), dónde está el archivo (`storagePath`), de dónde
vino (`sourceUrl`, sólo como respaldo) y en qué estado está:

| `status` | Qué significa |
|---|---|
| `pending` | Se está bajando del proveedor |
| `ready` | Está en nuestro bucket, se puede reproducir |
| `failed` | No se pudo bajar; `error` dice por qué, en castellano |
| `none` | No hay archivo que bajar (una ubicación), o ya no está (media vieja, o purgada por retención) |

**Los cuatro formatos viejos se siguen leyendo.** `parseAttachments`
(`lib/messages/attachments.ts`) los adapta al vuelo: no hubo backfill y no hay
fecha de corte. Lo único que no vuelve es el archivo de los mensajes anteriores,
porque su URL ya venció: esos se ven como "ya no disponible".

### Y el archivo, ¿dónde vive?

En el bucket privado `chat-media`, en
`<workspace_id>/<conversation_id>/<message_id>-<n>.<ext>`. El primer segmento es
el workspace porque **es lo único que lee la policy**.

Se copia dentro del `after()` del webhook y no en la cola, por una razón
concreta: la URL que da Instagram es del CDN de Meta y vence, y WhatsApp borra la
media de su servidor pasado un tiempo. Si se esperara al cron del minuto, a veces
se llega tarde y después no hay nada que escuchar ni que transcribir.

Los adjuntos de **email no se movieron**: siguen en su bucket
`email-attachments`, con su ruta de descarga, y se ven igual que antes. El item
lleva `meta.bucket` para que la burbuja firme donde corresponde.

### Cuánto dura

El **archivo** se borra a los 180 días (configurable por workspace; `0` es no
borrar nunca), en el mismo cron diario que limpia la media publicada. El item
conserva todos sus metadatos y queda en `none`.

La **transcripción nunca se borra por retención**. Es texto, pesa nada, y es el
contexto con el que el agente entiende la conversación: borrarla sería ahorrar
bytes a cambio de que el agente se olvide de lo que le dijeron. Sigue la
retención de 12 meses de los mensajes, que no cambió.

## Lo que no está resuelto

**Tres sistemas reciben los mismos DMs de la misma cuenta de Instagram** (este
OS, WenOS y Agente Chat). No genera duplicados acá —cada sistema tiene su base—,
pero desde la Fase 3 este sistema **guarda el contenido** de esos DMs. Va junto
con la confirmación de los términos de Zernio y Meta, porque es la misma
conversación.

## Reacciones (00237, 16/10/2026)

Una reacción NO es un mensaje: vive en `message_reactions` (una por actor y mensaje; quitarla pone `removed_at`).
Se guarda por el id con el que el PROVEEDOR conoce el mensaje, porque el hilo de Instagram se lee en vivo de Zernio y
muchos mensajes no tienen fila propia. Los dos webhooks la atajan antes del camino de los mensajes. Enviar: Evolution
(`sendReaction`, v1 y v2) y Zernio (`addMessageReaction` / `removeMessageReaction`, probando el id nativo y el propio).

## Una cuenta nueva en Zernio (22/10/2026)

Un DM entra a la bandeja solo si su cuenta tiene **canal** (`channels.late_account_id`): si no, el receptor responde 404 y el mensaje se pierde. Antes los canales se creaban solo al guardar la clave de Zernio o con «Sincronizar canales», así que una segunda Instagram conectada en Zernio después no recibía nada hasta apretar el botón.

Ahora el sistema escucha `account.connected` y `account.disconnected` (`SUBSCRIBED_EVENTS`):

- **De qué negocio es el aviso.** La cuenta nueva no tiene canal, así que se prueba la firma contra el secreto del webhook de cada negocio (`findWorkspaceForSignedEvent`); el que valida es el dueño. Sin firma válida, 401. Idempotencia con `webhook_events`.
- **Qué hace.** En el `after()` vuelve a leer la lista **completa** de Zernio y pasa por el mismo camino que el botón (`syncZernioChannels`, `lib/channels/zernio-channels.ts`): crea el canal nuevo (con el aviso a Owner y Admin si un rol no lo ve), trae sus conversaciones anteriores y sincroniza las cuentas de Social. Si Zernio no responde, **no se desactiva ningún canal**. Nunca lanza.
- **Instalaciones que ya existían:** el webhook registrado en Zernio suma los dos eventos la próxima vez que se guarda la clave o se aprieta «Sincronizar canales» (`ensureWebhookRegistered` corrige los eventos que faltan). Hay que hacerlo **una vez** después del deploy.


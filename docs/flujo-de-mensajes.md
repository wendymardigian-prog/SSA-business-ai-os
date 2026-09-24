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

## El interruptor

`workspaces.persist_zernio_inbound` (Ajustes → Guardado de mensajes) prende y
apaga el guardado de los entrantes **de los canales de Zernio**.

Existe porque queda por confirmar si persistir el contenido de los DMs entra
dentro de los términos de Zernio y de Meta para este tipo de cuenta. Por eso es
una fila en la base y no una variable de entorno: apagarlo no puede depender de
un deploy.

- **Apagado**, el sistema se comporta exactamente como antes de la Fase 3.
- **No afecta a WhatsApp**: ahí `messages` es la única fuente del hilo, apagarlo
  vaciaría la bandeja.
- **Apagarlo no borra lo ya guardado.** Para eso está
  `scripts/purge-zernio-inbound.mjs`, que es la otra mitad del interruptor.

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
| `scripts/verify-message-persistence.mjs` | la verificación contra la base real |

## Lo que no está resuelto

**Tres sistemas reciben los mismos DMs de la misma cuenta de Instagram** (este
OS, WenOS y Agente Chat). No genera duplicados acá —cada sistema tiene su base—,
pero desde la Fase 3 este sistema **guarda el contenido** de esos DMs. Va junto
con la confirmación de los términos de Zernio y Meta, porque es la misma
conversación.

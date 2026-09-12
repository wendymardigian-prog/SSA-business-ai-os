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
| `platform_message_id` | El id de **Zernio** | Es el que **deduplica**. Lo usan el envío (`recordSend`), la lectura de la bandeja (`toInboxMessage`) y el backfill. El índice único `(conversation_id, platform_message_id)` cuelga de él |
| `platform_native_message_id` | El id de **Meta** | No lo usa nada del sistema. Es el handle para un pedido de borrado o un reclamo de soporte ante Meta |

**El que deduplica es el de Zernio, no el nativo.** Si el receptor guardara el
nativo, el backfill —que solo devuelve el de Zernio— insertaría una copia de
cada mensaje. El id nativo, en cambio, solo llega por webhook: el endpoint de
historial no lo devuelve, así que lo que no se guarde cuando el mensaje entra
no se recupera nunca. De ahí que se guarden los dos.

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

Se corre a mano, con `--dry-run` por defecto. Conviene correrlo **dos veces con
días de diferencia**: el replay de Meta corre en segundo plano y puede terminar
después del primer barrido. Correrlo de nuevo es gratis — el índice único
descarta lo que ya está.

No trae los mensajes que el remitente borró (`isDeleted`), por la misma regla de
Meta que se honra en la retención.

## Quién escribió cada mensaje

`messages` distingue cuatro autores, todos nullables:

| Columna | Quién |
|---|---|
| `sent_by_user_id` | una persona del equipo |
| `sent_by_flow_id` | un flow del builder |
| `sent_by_node_id` | el nodo puntual — **declarado desde la 00001 y nunca escrito**. Deuda conocida |
| `sent_by_agent_id` | el agente de IA. **Sin foreign key todavía**: la tabla `agents` se crea en el Bloque 2 de la Fase 3, que es donde hay que agregar la constraint |

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

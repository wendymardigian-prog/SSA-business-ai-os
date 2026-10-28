# Plan: traer TODAS las conversaciones de Instagram (y las que empieza el negocio)

28/10/2026. Rama propuesta: `fix/instagram-importar-todo`.

## Por que

Un cliente de Business Accelerator (Alma Expeditions) reporto que faltan muchas
conversaciones de Instagram en el sistema. Comprobado en su base (solo lectura):

| Cuenta | Conversaciones | Importadas al conectar | Entraron despues | Mensaje mas viejo |
|---|---|---|---|---|
| @arturobullard | 269 | **200** (15/10) | 69 | 29/9 |
| @alma_expeditions | 220 | **200** (16/10) | 20 | 28/9 |

En produccion pasa lo mismo: el 6/10 Zernio tenia mas de 2.000 conversaciones y la
base 650. No tiene nada que ver con ManyChat.

### Las causas, en el codigo de hoy

1. **La importacion se corta en 200 por cuenta.** `lib/inbox-sync.ts`,
   `MAX_PAGES_PER_CHANNEL = 4` x 50.
2. **Volver a sincronizar no trae nada nuevo.** La importacion siempre empieza por
   las mas recientes y vuelve a mirar las mismas 200, que ya estan.
3. **Corre una sola vez, y Zernio todavia no termino.** Al conectar una cuenta,
   Zernio le pide a Instagram hasta 500 conversaciones viejas EN SEGUNDO PLANO, sin
   mandar ningun aviso (webhook). Lo que termina de llegar despues de nuestra
   importacion no entra nunca. Lo dice la documentacion del propio SDK
   (`listInboxConversations`): "si copias este listado, volve a recorrerlo, no
   alcanza con una pasada".
4. **Falla en silencio.** Si Zernio pide esperar (error 429), la importacion de ese
   canal se corta y la pantalla igual dice que salio bien. Tampoco se lee
   `meta.failedAccounts`, donde Zernio avisa que una cuenta fallo.
5. **No mira las archivadas.** No se pide `status: archived`.
6. **Las conversaciones que empieza el negocio se descartan.** Si el negocio escribe
   primero desde el celular (o una automatizacion de comentarios manda el DM) y la
   persona todavia no contesto, llega un `message.sent` y `handleMessageSentEcho`
   (`lib/inbound.ts`) lo tira con "conversacion no encontrada". Tampoco estamos
   suscritos a `conversation.started`, el aviso de "conversacion nueva" de Zernio.

### El limite que no se puede saltar

Instagram le da a Zernio **hasta 500 conversaciones previas por cuenta** (las que
existian antes de conectarla). Mas atras no hay forma de traerlas: no existen por
API. De la conexion en adelante entran todas.

## Lo que va a quedar

- Cada cuenta de Instagram que se conecte trae **todas** las conversaciones que
  Zernio tenga (activas y archivadas), sin tope de 200.
- La importacion corre **en segundo plano** (en la cola de trabajos), por partes, y se
  ve su avance en Canales: "Importando… 340 conversaciones", "Listo: 487", o "Quedo
  incompleta: Zernio no respondio. Reintentar".
- Se repite sola **a las 24 horas y a los 7 dias** de conectar, para levantar lo que
  Zernio termino de traer tarde.
- **"Sincronizar canales" vuelve a recorrer todo** y trae lo que falte.
- **Una conversacion que empieza el negocio entra igual**, con su primer mensaje,
  aunque la persona todavia no haya contestado.

## Bloque 1 — La importacion completa, en segundo plano

### 1.1 Migracion `00267_channel_inbox_import` (aditiva)

Una columna nueva en `channels`: `inbox_import jsonb` (null = nunca se importo).
Guarda el avance de la importacion de ese canal:

```
{ status: "running" | "done" | "partial" | "error",
  pass: 1 | 2 | 3,            // 1 = al conectar, 2 = a las 24 h, 3 = a los 7 dias
  phase: "active" | "archived",
  cursor: string | null,      // por donde va
  scanned: number,            // cuantas miro
  imported: number,           // cuantas eran nuevas
  started_at, finished_at, last_error }
```

- Aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`). Se aplica ANTES de desplegar el
  codigo (el codigo la lee). Confirmar el numero con `list_migrations` contra
  produccion (por la CLI vinculada: el MCP de Supabase de la sesion apunta a la base de
  Alma, no a produccion).
- La escribe solo el servidor. `channels` ya tiene su RLS; la columna no lleva
  secretos.

### 1.2 El trabajo `inbox_import` (`lib/jobs/handlers/inbox-import.ts`)

La logica pura y la de Zernio van en `lib/inbox-sync.ts` (se reescribe), el handler
solo valida el payload (mismo patron que `zernio-ad-origin.ts`).

Cada vuelta del trabajo:

1. Lee el estado del canal. Si el canal ya no esta activo, termina.
2. Pide a Zernio **dos paginas** de 50 (`listInboxConversations` con `accountId`,
   `limit: 50`, `sortOrder: "desc"`, `status` de la fase, `cursor`).
3. Para cada conversacion, hace lo de hoy (`importConversation`): resolver el contacto
   con `upsertContactForSender` (que pasa por la regla unica de contactos) y crear la
   conversacion con `ignoreDuplicates` sobre `(channel_id, contact_id)`. Nada de esto
   dispara automatizaciones, el agente ni las reglas de asignacion (el historico no
   asigna, como hoy).
4. Guarda el avance (`cursor`, `scanned`, `imported`) en `channels.inbox_import`.
5. Si hay mas paginas, **se vuelve a encolar** enseguida con el cursor nuevo. Si se
   termino la fase `active`, arranca la fase `archived`. Si se terminaron las dos,
   marca `done` y agenda la pasada siguiente (2 a las 24 h, 3 a los 7 dias).

Por que por partes: una cuenta con 500 conversaciones son 500 contactos y 500 filas.
En una sola peticion tardaria minutos y la pantalla quedaria colgada; la cola corre
20 trabajos por minuto y cada uno tiene su tiempo.

Reglas del trabajo (las de siempre del proyecto):

- **No lanza por un fallo de Zernio.** Un 429 o un 5xx reagendan la MISMA pagina a 1,
  5 y 15 minutos; al cuarto fallo queda `partial` con el motivo. (Si lanzara, la cola
  reintentaria a los 10 segundos encima.) Los errores se clasifican con
  `lib/publishing/zernio-errors.ts` (el SDK lanza y expone `.statusCode`).
- **Lee `meta.failedAccounts`**: si Zernio dice que esa cuenta fallo, queda `partial`
  con su motivo en vez de dar por buena una lista vacia.
- **Guarda contra vueltas infinitas**: si un cursor se repite, o pasa de 200 paginas
  (10.000 conversaciones) en una fase, corta y deja `partial`.
- **Un solo trabajo por canal a la vez**: clave de dedupe
  `inbox_import:<channel_id>` en `scheduleJob`.
- **Ya no se cargan todos los ids conocidos al empezar**: por cada pagina se pregunta
  cuales de esos 50 ids ya estan (`.in("late_conversation_id", ids)`). Con miles de
  conversaciones, la lista completa seria pesada.
- Se mantiene el descarte de una segunda conversacion de Zernio de la misma persona
  (la tabla permite una por persona y canal).

### 1.3 Quien encola la importacion

Una sola funcion `startInboxImport(service, channel, { pass, motivo })` que reinicia
el estado y encola. La llaman:

- `app/api/v1/channels/test-key/route.ts` (guardar la clave de Zernio).
- `app/api/v1/channels/sync/route.ts` ("Sincronizar canales"): encola TODOS los canales
  de Zernio activos y ya no importa dentro de la peticion. La respuesta dice "la
  importacion sigue en segundo plano".
- `lib/channels/zernio-account-events.ts` (cuenta conectada desde Zernio).
- El boton "Traer conversaciones" de la bandeja vacia (`inbox-view.tsx`), que hoy
  llama al sync: sigue igual.

`backfillInboxConversations` deja de existir; los tres lugares que lo llaman pasan a
`startInboxImport`.

### 1.4 La pantalla

En la tarjeta de cada canal de Instagram (`components/channels/channels-panel.tsx`),
una linea chica con el estado, armada por una funcion pura
(`lib/channels/import-status.ts`, con su test):

- `running`: "Importando conversaciones… 340 hasta ahora"
- `done`: "487 conversaciones importadas · revisa de nuevo el 4/11" (si falta una pasada)
- `partial` / `error`: el motivo en simple + "Reintentar" (llama a `startInboxImport`)
- `null`: nada

Permiso: el mismo de "Sincronizar canales" (`channels.manage`).

## Bloque 2 — Las conversaciones que empieza el negocio

### 2.1 El eco `message.sent` crea la conversacion

En `handleMessageSentEcho` (`lib/inbound.ts`), cuando no encuentra la conversacion:

1. Si el payload trae `conversation.participantId` (el SDK lo manda en todos los
   webhooks de la bandeja: es la persona, no el negocio), resuelve el contacto con
   `upsertContactForSender` usando `participantId`, `participantName`,
   `participantUsername` y `participantPicture` de `conversation`.
2. Crea o encuentra la conversacion con `upsertConversation` (`incrementUnread:
   false`, `externalConversationId` = el id de Zernio). Asi tambien se cubre el caso
   de una conversacion que ya existia para esa persona sin el id de Zernio.
3. Guarda el mensaje como hoy (`origin: "external"`).

Sin `participantId`, sigue descartando como hoy (no hay a quien atarlo).

Lo que NO hace: no suma no leidos, no dispara automatizaciones ni el agente, no marca
"esperando respuesta" (lo calcula el trigger de mensajes: un saliente no espera
respuesta). Una conversacion nueva si pasa por las reglas de asignacion por cuenta,
igual que cualquier conversacion nueva.

### 2.2 Escuchar `conversation.started`

- Sumar `"conversation.started"` a `SUBSCRIBED_EVENTS` (`lib/zernio-webhook.ts`).
- En el receptor (`app/api/webhooks/late/route.ts`), un handler con el mismo esqueleto
  que los otros: canal por `account.id`, firma, `claimWebhookEvent`, 200 enseguida y
  el trabajo en `after()`. Crea contacto y conversacion sin mensaje (vacia hasta que
  llegue el primero).
- Es un cinturon de seguridad del 2.1: si alguno de los dos llega primero, el otro
  encuentra la conversacion hecha.
- **Una instalacion existente recibe este evento recien despues de tocar
  "Sincronizar canales" una vez** (`ensureWebhookRegistered` actualiza los eventos).

### 2.3 Lo que esto no arregla

Las conversaciones que maneja **otra app como duena del hilo** (el caso de ManyChat en
produccion) siguen sin entrar: Instagram no se las manda a Zernio. Eso se arregla
cambiando la app principal en Meta, no con codigo (ver la memoria del 23/10).

## Bloque 3 — Tests

Con Vitest y Zernio simulado (los tests no pueden hacer `fetch` real):

- **Importacion** (`lib/inbox-sync.test.ts`, se reescribe):
  - recorre todas las paginas, sin tope de 200 (con 7 paginas simuladas trae las 350);
  - hace la fase `archived` despues de la `active`;
  - un 429 reagenda la MISMA pagina a 1, 5 y 15 minutos y no lanza; al cuarto, `partial`;
  - `meta.failedAccounts` deja `partial`;
  - un cursor repetido corta y deja `partial`;
  - una conversacion ya importada no se duplica ni se cuenta;
  - dos conversaciones de Zernio de la misma persona dan una;
  - al terminar agenda la pasada 2 (24 h) y la 3 (7 dias), y la 3 no agenda otra;
  - un canal desactivado a mitad de camino corta sin error.
- **Estado en pantalla** (`lib/channels/import-status.test.ts`): cada estado da su texto.
- **Eco** (`app/api/webhooks/late/route.test.ts`, que ya cubre `handleMessageSentEcho`):
  - sin conversacion y con `participantId`: crea contacto, conversacion y mensaje, sin
    no leidos;
  - sin `participantId`: descarta como hoy;
  - con conversacion existente: igual que hoy (test de caracterizacion antes de tocar).
- **`conversation.started`**: firma invalida 401, evento repetido se saltea, crea la
  conversacion vacia, y si ya existe no la duplica.
- **`SUBSCRIBED_EVENTS`** incluye `conversation.started` y cada evento suscrito tiene
  su rama en el receptor (test nuevo: hoy nada fija esa lista, y un evento suscrito sin
  rama cae en "ignorado" sin avisar).
- `npx vitest run`, `npm run lint`, `npx tsc --noEmit` y `npm run build` en verde.

## Bloque 4 — Salida a produccion y a los clientes

1. **Produccion**: aplicar y registrar la `00267` con la CLI, desplegar, y tocar
   "Sincronizar canales". Ver en Canales que la importacion avanza y termina.
   Comprobar con un script de solo lectura (scratchpad) cuantas conversaciones tiene
   Zernio por cuenta y cuantas la base: la diferencia tiene que quedar en las
   duplicadas por persona y nada mas.
2. **Plantilla de Business Accelerator (Scaling-Systems/BAIOS)**: sincronizarla con
   la migracion incluida. Es publicar hacia afuera: se hace con tu OK. La de
   estudiantes (SSA-BAIOS) tiene su propio procedimiento (`docs/plantilla-estudiantes.md`).
3. **Cada cliente** (Alma primero): actualizar desde la plantilla, aplicar la `00267`,
   desplegar y tocar "Sincronizar canales" una vez. Esto trae lo que falta y suma
   `conversation.started` al webhook. En Alma se comprueba con la misma consulta de
   hoy: las dos cuentas tienen que pasar de 200 importadas a todas las que tenga Zernio.
4. Documentar en `docs/flujo-de-mensajes.md` (la importacion y sus limites) y en el
   `CLAUDE.md` (la regla: la importacion es un trabajo por partes, sin tope, con tres
   pasadas, y un eco sin conversacion la crea).

## Archivos que se tocan

- `supabase/migrations/00267_channel_inbox_import.sql` (nuevo) + `node scripts/build-all-migrations.mjs`
- `lib/inbox-sync.ts` (se reescribe) y `lib/inbox-sync.test.ts`
- `lib/jobs/handlers/inbox-import.ts` (nuevo) y su registro en la cola
- `lib/channels/import-status.ts` (nuevo) y su test
- `app/api/v1/channels/sync/route.ts`, `app/api/v1/channels/test-key/route.ts`,
  `lib/channels/zernio-account-events.ts`
- `components/channels/channels-panel.tsx`
- `lib/inbound.ts` (`handleMessageSentEcho`) y `app/api/webhooks/late/route.test.ts`
- `lib/zernio-webhook.ts` (`SUBSCRIBED_EVENTS`)
- `app/api/webhooks/late/route.ts` (handler de `conversation.started`)
- `lib/types/database.ts` (la columna nueva)
- `docs/flujo-de-mensajes.md`, `CLAUDE.md`

## Fuera de este plan

- **Los mensajes viejos de cada conversacion en nuestra tabla `messages`.** La bandeja
  de Instagram lee el hilo en vivo de Zernio, asi que se ven igual. Copiarlos a la base
  (para el agente y los dashboards) es `scripts/backfill-zernio-messages.mjs`, a mano.
- `scripts/enrich-instagram-contacts.mjs` lee la clave de Zernio con nombres de
  parametro viejos (`p_workspace_id`/`p_secret_name`) y hoy no la encuentra. Arreglo
  de una linea, aparte.

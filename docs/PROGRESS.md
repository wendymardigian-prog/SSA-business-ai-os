# Progreso — Mejoras de Chat, Bloques 1-3

Corrida autónoma en la rama `oneshot-chat-media-a`. Plano: [docs/requerimientos-chat-multimedia.md](requerimientos-chat-multimedia.md) (v1.0, 28/9/2026).
Este archivo es la memoria de la corrida: se actualiza por funcionalidad, no solo al cerrar cada bloque. Si el contexto se compacta, se retoma desde acá.

**Alcance de esta corrida: Bloques 1, 2 y 3 (F1 a F15).** Los bloques 4 (identidad visible), 5 (grabar y enviar audios) y 6 (banca de audios) **no se tocan**.

El progreso de la Etapa 4 quedó archivado en [docs/etapa4/PROGRESS-agendamiento.md](etapa4/PROGRESS-agendamiento.md) y [docs/etapa4/PENDIENTE-agendamiento.md](etapa4/PENDIENTE-agendamiento.md).

## El problema que arregla

Un lead manda una nota de voz por Instagram o WhatsApp. El mensaje entra con `text = null`, el agente lo filtra del historial, **pero el turno igual se agenda y el modelo responde** sin haber "escuchado" nada. Está contestando cosas que no tienen que ver. Además la media nunca se copia a nuestro Storage (los links de Meta vencen, los de Baileys están cifrados), la bandeja muestra "Adjunto" sin reproductor, y en WhatsApp **una imagen con caption pierde la media**.

## Punto de partida (28/9/2026, `main` = `eb0627c`, árbol limpio)

| Comando | Resultado de hoy |
|---|---|
| `npx vitest run` | 285 archivos, **3327 tests en verde** |
| `npm run build` | OK (exit 0) |
| `npm run lint` | **1 error y 41 warnings, los dos preexistentes** (ver PENDIENTE). El error está en `components/scheduling/booker/use-embed-bridge.ts:22`, que es de la Etapa 4 |
| Última migración | `00101_bg_task_dedupe`, en archivos y **aplicada** en la base (`list_migrations`). Las nuevas: **00102 y 00103** |
| Testing | Solo `vitest ^3.2.4`, `environment: node`, `include: **/*.test.ts`. **No se suman dependencias** |
| Evolution API (Railway) | **v2.3.7** en `evolution-api-production-8691c.up.railway.app` |
| Datos | 2471 mensajes, 88 con `attachments` (86 sin texto). 1 workspace. IA en `integration_configs`: **solo `anthropic` y `voyage`** |
| Buckets | `avatars` (público), `content-media`, `email-attachments`, `knowledge`. **No existe `chat-media`** |

## Diferencias entre el plano y el código (14; gana el código)

Las cuatro que más pesan, el resto en el plan de la corrida:

1. **Bug del caption: CONFIRMADO.** `app/api/webhooks/evolution/route.ts:274` es `attachments: text ? null : (data?.message ?? null)` y `extractText` devuelve `imageMessage.caption`.
2. **Los filtros por `text`: CONFIRMADOS** en `lib/agent/context.ts:108` y `lib/agent/prompt.ts:151`. También filtran `lib/agent/summary.ts:142` y `lib/ai/generate-reply.ts:103`. `extractBurst` **no** filtra: por eso el turno se agenda igual.
3. **La compuerta va en el runner, no en `dispatch.ts`:** el dispatch corre dentro del webhook, cuando la transcripción ni empezó. El lugar único es el inicio de `continueTurn` en `lib/agent/runner.ts`, que ya conoce el modo (envío / borrador / reglas).
4. **No hay cron `purge-deleted` en la app:** pg_cron corre `public.purge_soft_deleted(30)` como SQL directo, y SQL no puede borrar de Storage. La limpieza de `chat-media` se cuelga del cron **`content-media-cleanup`**, que ya es diario y ya borra de Storage.

## Decisiones tomadas con Wendy (28/9/2026)

- **Las migraciones 00102 y 00103 se aplican a producción durante la corrida** (son aditivas: solo agregan columnas con default y un bucket).
- **Transcripción: intento inmediato + cola de respaldo.** Al terminar la descarga en el `after()` del webhook se transcribe en el momento; si falla por algo transitorio, se encola. El claim condicional evita transcribir dos veces.
- **`chat_media_retention_days` default 180.**

## Bloques

- [x] **Bloque 0 — Arranque:** rama `oneshot-chat-media-a`; plano copiado a `docs/`; PROGRESS y PENDIENTE de la Etapa 4 movidos a `docs/etapa4/`
  - [x] Tests de caracterización previos: el parser de adjuntos de email (los 4 formatos que conviven) y el armado del historial del agente

### Bloque 1 — Traer la media adentro (migración **00102 escrita, sin aplicar**)

- [x] **F1 · Esquema normalizado de adjuntos** (`lib/messages/attachments.ts`, puro): `{v:2, items}` y un parser que además lee los cuatro formatos viejos, sin backfill ni fecha de corte. Las etiquetas de tipo pasan a tener una sola fuente: estaban duplicadas en `lib/evolution-message.ts` y decían otra cosa que la burbuja ("🎥 Video" contra "🎬 Video"). 39 + 5 tests
- [x] **F2 · Bucket `chat-media` y ruta firmada**: bucket privado con la policy de SELECT por workspace del primer segmento del path y **sin policies de escritura**; `/api/v1/chat-media` firma al hacer clic con el cliente del usuario y valida el path antes de tocar Storage; interruptor y retención en Ajustes. 16 + 6 tests
- [x] **F3 · Ingesta de Instagram**: `lib/inbound-media.ts` baja y sube, nunca lanza, escribe la columna una sola vez y corta por tamaño antes de subir. Se suman tres cosas que se descartaban: la respuesta a una historia, los links a posts en el texto, y la etiqueta en el preview. El eco de `message.sent` pasa por el mismo helper. 22 + 5 tests nuevos en el webhook
- [x] **F4 · Ingesta de WhatsApp + el bug del caption**: `getBase64FromMediaMessage` en el cliente de Evolution (verificado contra el servidor real, **v2.3.7**), y el arreglo de `attachments: text ? null : data.message`, que perdía la foto cuando venía con texto. 12 + 5 tests nuevos en el webhook
- [x] **F5 · Retención**: `planChatMediaCleanup` puro (10 tests) colgado del cron diario `content-media-cleanup` que ya existe, así no hay que tocar la allowlist de `private.call_app_cron`. Si el borrado del bucket falla, la fila **no** se marca. La transcripción nunca se borra

**Verificación del bloque:** `npx vitest run` **293 archivos / 3476 tests en verde**, `npm run build` compila, `npx tsc --noEmit` sin errores, lint sin errores ni warnings nuevos. `verify-rls.mjs` tiene los chequeos del bucket escritos y se saltean solos hasta que se aplique la 00102.

### Bloque 2 — El agente entiende o se calla (migración **00103 escrita, sin aplicar**)

Este es el bloque urgente: es el que hace que el agente deje de contestar a ciegas.

- [x] **F6 · Proveedor de transcripción** (`lib/ai/transcribe.ts`): única puerta, con un `switch` hermano de `buildModel`. Groq principal, OpenAI de respaldo con la clave que el workspace ya tiene, y solo se cae al respaldo por algo transitorio. El nombre del archivo se reconstruye desde el mime (el 400 clásico). El consumo se registra en **segundos de audio**, que es como cobra el proveedor: `model_pricing.audio_per_hour` y `agent_runs.audio_seconds`, con su seed. Un test de frontera impide que "groq" aparezca fuera de cuatro archivos. 19 + 2 + 6 tests
- [x] **F7 · Transcripción**: se intenta **en el momento** (en el `after()` del webhook) y la cola es el respaldo; el agente tiene 90 segundos y el cron corre cada minuto. El claim condicional evita transcribir y cobrar dos veces. El reaper corre también en el cron de jobs, porque si nadie encola un job el handler nunca corre y la fila quedaría colgada. 21 + 12 tests
- [x] **F8 · Descripción de imágenes**: se encola (no hay apuro y cuesta una llamada al modelo de visión). Usa el modelo que el workspace ya tiene; sin ninguno, el mensaje queda no interpretable y el agente escala. El prompt pide el texto que aparece en la imagen: la mayoría son capturas. 16 tests
- [x] **F9 · El agente lee lo que llegó**: `effectiveMessageText` (texto, o transcripción, o descripción), marcado y envuelto en `wrapUntrusted`. Con caption gana el caption. Lo que no tiene nada interpretable sigue afuera. También en el resumen al cerrar y en el nodo de IA de los flows. 15 tests
- [x] **F10 · La compuerta**: `assessInterpretability` puro (18 tests) enganchado al inicio de `continueTurn`, el único punto por el que pasan los tres modos. Responde, reagenda o escala. Va antes de los guardarrailes, porque `burstText` los alimentaba con texto vacío y ninguno frenaba una ráfaga que era solo un audio. Apagable por workspace
- [x] **F11 · Aviso al humano**: badge en la lista, pill y barra con "Ya lo vi" en el hilo, filtro nuevo en la bandeja, notificación al setter (una sola por escalado), y `applyManualReply` limpia la marca. 7 + 4 tests

**El test que prueba el arreglo:** [lib/agent/runner-unreadable.test.ts](../lib/agent/runner-unreadable.test.ts), con el turno completo y el modelo espiado. Con un audio sin transcribir: no se llama al modelo, no se inserta ningún saliente, la conversación queda `needs_human` y el escalado queda en `audit_log` y en la campana.

**Verificación del bloque:** `npx vitest run` **302 archivos / 3624 tests en verde**, `npm run build` compila, `tsc` sin errores, lint sin errores ni warnings nuevos.

### Bloque 3 — Ver y reproducir en la bandeja

- [x] **F12 · Renderer por tipo**: cada uno de los 14 tipos tiene visor, reproductor, tarjeta o etiqueta, y ninguno deja la burbuja vacía. El adjunto va arriba del texto. **La URL se firma al hacer clic o al reproducir, nunca al pintar el hilo**: por eso el audio y el video arrancan como una tarjeta con ▶. Un GIF de WhatsApp es un mp4, así que va como video. El archivo corrupto y el que no se puede recuperar no ofrecen reintento. 28 tests
- [x] **F13 · Transcripción visible**: debajo del reproductor y no en su lugar, con sus cuatro estados y su botón, y el botón sólo aparece si el archivo está. La ruta de reintento lee con el cliente del usuario (decide la RLS) y responde 404 y no 403. 15 + 8 tests
- [x] **F14 · El hilo de Instagram**: se sigue leyendo en vivo de Zernio (no se cambia de dónde se lee) y se cruza por `platform_message_id`. El id pasa a ser el local, que es el que entienden las rutas de reintento. 11 tests
- [x] **F15 · Preview con etiqueta**: ya resuelto en F3, F4 y F7 con `previewForMessage`, que es la única fuente. Con transcripción muestra lo que se dijo. 7 tests
- [x] **Revisión visual**: la bandeja real pide login y esta sesión del navegador no lo tiene, así que **no se ingresaron credenciales** (ver PENDIENTE). Se midió el CSS real a 390 px sobre un banco de prueba con la estructura de la burbuja, y **encontró dos cosas que ya se arreglaron**: el reproductor desbordaba (`min-width` le gana a `max-width` en CSS) y los controles nativos se veían blancos sobre la burbuja oscura

**Verificación del bloque:** `npx vitest run` **306 archivos / 3686 tests en verde**, `npm run build` compila, `tsc` sin errores, lint sin errores ni warnings nuevos.

---

## Cierre de la corrida

Mergeado a `main` y **desplegado** el 29/9/2026 (commit `5fdc4fb`).

| Comando | Al arrancar (28/9) | Al cerrar |
|---|---|---|
| `npx vitest run` | 285 archivos / 3327 tests | **322 archivos / 3888 tests, todo en verde** (incluye lo que trajo `feature/chat-completar`) |
| `npm run build` | OK | OK |
| `npx tsc --noEmit` | limpio | limpio |
| `npm run lint` | 1 error y 41 warnings | **0 errores y 41 warnings**, idéntico a `main` (el error lo arregló la otra corrida) |
| `node scripts/verify-rls.mjs` | no se podía (faltaba el bucket) | **Todo verde**, con los seis chequeos nuevos del bucket |

**Esta corrida sumó 21 archivos de test y 359 tests.** Ningún test previo quedó roto. Los cinco que cambiaron lo hicieron porque cambió a propósito lo que fijaban: el formato crudo del adjunto de WhatsApp, las etiquetas duplicadas, la lista de tipos de job, el resultado de `insertMessage` y las capacidades del catálogo de proveedores.

### El merge con la otra corrida

`main` había avanzado con `feature/chat-completar` (pantalla de Chat, Settings con pestañas, migraciones **00110 y 00111**). Sin choque de números con las 00102 y 00103. Seis archivos se pisaban y sólo dos dieron conflicto, ninguno de código: el bundle de migraciones (se regenera) y `docs/PENDIENTE.md` (se juntaron las dos secciones).

De paso, esa corrida **arregló la raíz** de algo que yo había esquivado: `globals.css` ahora declara `@custom-variant dark`, así que `dark:` sigue a la clase `.dark` y no a la preferencia del sistema. Se simplificó el arreglo del reproductor, que llevaba dos variantes por eso.

### El deploy

Railway despliega solo desde `main`, y el código lee columnas que no existían. Para que no hubiera caída: se pusheó primero y **las migraciones se aplicaron mientras el contenedor compilaba**, así llegaron antes del swap. El deploy quedó en SUCCESS, el contenedor nuevo arrancó en 380 ms y los crons siguen corriendo sin un solo error.

### Lo que queda

**Dos claves** para que esto funcione de verdad en vivo, y las dos las tiene que cargar Wendy: **Groq** (sin eso no se transcribe nada) y una de **visión** válida (sin eso no se describe ninguna imagen). Sin ellas el sistema no rompe: el agente escala a una persona, que es justo lo que se quería. El detalle está en [PENDIENTE.md](PENDIENTE.md).

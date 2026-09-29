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

### Bloque 2 — El agente entiende o se calla (migración 00103)

- [ ] F6 · Proveedor de transcripción (Groq con respaldo en OpenAI)
- [ ] F7 · Job de transcripción
- [ ] F8 · Descripción de imágenes
- [ ] F9 · El agente lee transcripciones y descripciones
- [ ] F10 · Compuerta de interpretabilidad y escalado a humano
- [ ] F11 · Aviso al humano

### Bloque 3 — Ver y reproducir en la bandeja

- [ ] F12 · Renderer de adjuntos por tipo
- [ ] F13 · Transcripción visible y reintento manual
- [ ] F14 · El hilo de Instagram muestra la media guardada
- [ ] F15 · Preview de la conversación con etiqueta
- [ ] Revisión visual con el navegador (escritorio y 390 px)

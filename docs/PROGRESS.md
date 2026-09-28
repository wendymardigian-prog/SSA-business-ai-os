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

### Bloque 1 — Traer la media adentro (migración 00102)

- [ ] F1 · Esquema normalizado de adjuntos (`lib/messages/attachments.ts`)
- [ ] F2 · Bucket `chat-media` y ruta de descarga firmada
- [ ] F3 · Ingesta de media de Instagram
- [ ] F4 · Ingesta de media de WhatsApp + arreglo del bug del caption
- [ ] F5 · Retención y limpieza de la media del chat

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

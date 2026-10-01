# Progreso — Mejoras de Chat, corrida B

Corrida autónoma en la rama `oneshot-chat-media-b`. Plano: [docs/requerimientos-chat-multimedia.md](requerimientos-chat-multimedia.md) (v1.1, 1/10/2026). Plan detallado aprobado: ver la sesión del 1/10/2026.

**Alcance de esta corrida: Bloque 0 (FA1-FA7) + Bloques 4, 5 y 6 (F16-F22).** Los Bloques 1-3 (F1-F15) ya están en `main`.

El progreso de la corrida A quedó archivado en [docs/chat-media/PROGRESS-a.md](chat-media/PROGRESS-a.md).

## Punto de partida (1/10/2026, `oneshot-chat-media-b` = `main` = `4fd0960`)

| Comando | Resultado |
|---|---|
| `npx vitest run` | 322 archivos, **3888 tests en verde** |
| `npm run build` | OK, pero **solo cargando el `.env` de la carpeta principal** (`set -a; source ../../../.env; set +a; npm run build`) — este worktree no tiene `.env` propio |
| `npm run lint` | 0 errores, 41 warnings preexistentes |
| Migraciones | Aplicadas hasta la 00103 + 00110/00111. Libres: 00104-00109. Esta corrida usa 00104 (avatar) y 00105 (banca de audios) |

## Checklist

### Bloque 0 — Arreglos (FA1-FA7) — ✅ LISTO (1/10/2026)
- [x] FA1 — reels y posts compartidos de Instagram (originalType, payload objeto, tarjeta). Datos reales: 27 reels en formato viejo (10 sin originalType), 5 ya guardados mal por el bug (se arreglan solos al pintarlos). Decisión con Wendy: tarjeta con link siempre, aunque el link de un post/historia (lookaside.fbsbx.com) pueda vencer.
- [x] FA2 — el agente lee el reel compartido (effectiveMessageText: `[Reel compartido] "título"`)
- [x] FA3 — adjuntos viejos (formato Zernio/Baileys): pending → none
- [x] FA4 — 429 no escala si hay un `transcribe_audio` pendiente/procesando en `scheduled_jobs`
- [x] FA5 — los 90s cuentan desde `media_wait_started_at` (cuando el turno empieza a esperar), no desde `created_at` del mensaje
- [x] FA6 — flows y secuencias con la compuerta de interpretabilidad (generateAiReply). Requirió describir imágenes EN EL MOMENTO (no solo encoladas), igual que el audio.
- [x] FA7 — stickers/GIFs no escalan ni gastan visión (`label_only`, no `unreadable`)
- [x] Alineación F4 — getBase64FromMediaMessage con el objeto `message` completo (§14c)

### Bloque 4 — Identidad visible (F16-F17) — ✅ LISTO (1/10/2026)
- [x] Migración 00104 (avatar_source, avatar_updated_at, find_or_link_contact) — **escrita, NO aplicada** a pedido explícito. Ver docs/PENDIENTE.md.
- [x] F16 — fotos de perfil estables (IG + WhatsApp + retención + fallback onError)
- [x] F17 — el @ de Instagram clickeable (panel, detalle, Canales vinculados)

### Bloque 5 — Grabar y enviar audios (F18-F19) — ✅ LISTO (1/10/2026)
- [x] Test de no-regresión del envío de texto sin media (app/api/v1/messages/route.test.ts)
- [x] sendChannelMessage: un solo camino (Evolution media + Zernio media). Arreglado el bug de mediaUrl descartado en Evolution.
- [x] Contrato del POST /api/v1/messages con media (validación por magic bytes + pertenencia al workspace/conversación)
- [x] Subida directa (Server Action + signed upload URL) — lib/actions/chat-upload.ts
- [x] sniffMime: formatos de audio (OggS, mp3, WAVE, WebM/EBML, M4A)
- [x] F18 — grabador en el composer (components/inbox/voice-recorder.tsx)
- [x] F19 — envío de audio y archivos por los dos canales (clip + composer wiring)

### Bloque 6 — Banca de audios (F20-F22) — ✅ LISTO (1/10/2026)
- [x] Migración 00105 (audio_assets) — **escrita, NO aplicada** a pedido explícito. Ver docs/PENDIENTE.md.
- [x] F20 — tabla, transcripción (mismo job que F7) y `/dashboard/settings/audios` (tabla + modal grabar/subir, descripción para la IA, toggle del agente)
- [x] F21 — picker `/a` en el composer: reutiliza `filterTemplates` (se le sumó un tercer criterio de búsqueda por contenido), preview con reproductor antes de mandar, mismo camino de envío del Bloque 5
- [x] F22 — `listar_audios` y `enviar_audio`. Sin ToolOptionSource nuevo (el toggle "Asistente" de la banca ya es el interruptor — ver nota en `lib/agent/tools/audio.ts`). `enviar_audio` deja el audio en `turn.memo` y el runner lo manda después del texto. Modo borrador: se sumó `defersInDraftAsync` al framework de herramientas porque `deferInDraft` es sincrónico y esta necesita leer la base.
- [x] `scripts/verify-chat-media.mjs` — corre contra la base real. Secciones A (bucket `chat-media`) y C (bucket `avatars`) en verde; sección B (RLS de `audio_assets`) se SALTEA con aviso porque la 00105 no está aplicada — no es una falla.

### Cierre
- [x] `npx vitest run` — **335 archivos, 4073 tests, todos en verde**
- [x] `npm run build` compila (con el `.env` de la carpeta principal)
- [x] `npm run lint` — 0 errores, 38 warnings preexistentes (no se sumó ninguno)
- [x] `verify-rls.mjs`, `verify-crm.mjs`, `verify-chat-media.mjs` — todos en verde contra la base real
- [ ] `verify-enrichment.mjs`, `verify-roles.mjs` — no se corrieron: dependen de código que ya estaba verde antes de esta corrida y no los tocó ningún cambio de este bloque; `verify-chat-media.mjs` es el que corresponde a lo nuevo
- [x] Revisión visual del composer y de la banca de audios (ver más abajo / docs/PENDIENTE.md)
- [x] docs/PENDIENTE.md actualizado con lo que quedó afuera

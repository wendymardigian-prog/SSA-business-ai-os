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

### Bloque 4 — Identidad visible (F16-F17)
- [ ] Migración 00104 (avatar_source, avatar_updated_at, find_or_link_contact)
- [ ] F16 — fotos de perfil estables (IG + WhatsApp + retención)
- [ ] F17 — el @ de Instagram clickeable

### Bloque 5 — Grabar y enviar audios (F18-F19)
- [ ] Test de no-regresión del envío de texto sin media
- [ ] sendChannelMessage: un solo camino (Evolution media + Zernio media)
- [ ] Contrato del POST /api/v1/messages con media
- [ ] Subida directa (Server Action + signed upload URL)
- [ ] sniffMime: formatos de audio
- [ ] F18 — grabador en el composer
- [ ] F19 — envío de audio y archivos por los dos canales

### Bloque 6 — Banca de audios (F20-F22)
- [ ] Migración 00105 (audio_assets)
- [ ] F20 — tabla y administración
- [ ] F21 — picker /a en el chat
- [ ] F22 — herramientas del agente (listar_audios, enviar_audio)
- [ ] scripts/verify-chat-media.mjs

### Cierre
- [ ] npx vitest run en 0
- [ ] npm run build compila
- [ ] npm run lint sin errores nuevos
- [ ] verify-crm, verify-rls, verify-enrichment (antes/después de 00104)
- [ ] verify-roles, verify-chat-media (Bloque 6)
- [ ] Revisión visual del composer y de la banca de audios
- [ ] docs/PENDIENTE.md actualizado con lo que haya quedado afuera

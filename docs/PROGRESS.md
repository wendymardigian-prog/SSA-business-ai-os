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
- [x] `verify-enrichment.mjs` — corrida después de aplicar la 00104 (ver abajo), en verde
- [ ] `verify-roles.mjs` — no se corrió: no lo toca ningún cambio de esta corrida
- [x] Revisión visual del composer y de la banca de audios (ver más abajo / docs/PENDIENTE.md)
- [x] docs/PENDIENTE.md actualizado con lo que quedó afuera

## Cierre de la corrida: merge a main y deploy (1/10/2026, tarde)

Después del cierre de arriba, Wendy pidió llevar todo a producción. Resumen
de lo que pasó, en orden:

1. **Rama respaldada**: `git push -u origin oneshot-chat-media-b` — ya estaba
   en GitHub antes de tocar nada más.
2. **`main` sincronizado**: no había avanzado (seguía en `4fd0960`), así que
   no hizo falta merge. Se re-corrió la suite completa + build + lint igual,
   todo en verde.
3. **Las dos migraciones, leídas y explicadas antes de aplicar**: el diff de
   `find_or_link_contact` contra la 00031 se verificó línea por línea (solo
   cambian las dos líneas del avatar) y el diff de `purge_soft_deleted`
   contra la 00098 (solo suma el `DELETE` de `audio_assets`).
4. **00104 aplicada** (fotos de perfil). `verify-crm.mjs`, `verify-rls.mjs` y
   `verify-enrichment.mjs` corridos uno por uno después, los tres en verde.
5. **00105 — NO aplicada, decisión de Wendy**: antes de aplicarla, pidió
   pausarla: va a unificarse con `response_templates` en un solo banco de
   assets (audios + plantillas) en una sesión nueva. Ver
   `docs/PENDIENTE.md` y la sección "Bloque 6" de `CLAUDE.md`.
6. **El bundle de migraciones ya estaba regenerado** (`ALL_MIGRATIONS.sql`
   incluye la 00104 y la 00105 desde que se escribieron; `node
   scripts/build-all-migrations.mjs` no encontró diferencias).
7. **Merge a `main`**: Wendy decidió llevar igual el código completo del
   Bloque 6 (sin su migración) — se verificó que no rompe nada porque toda
   consulta a `audio_assets` maneja `{data, error}` sin tirar excepción.
   `git push origin oneshot-chat-media-b:main` (fast-forward limpio,
   `4fd0960..b8a0b2f`).
8. **Deploy de Railway**: disparado automático por el push. **SUCCESS** en
   ~2.5 minutos (`7a541a8c...`, contenedor arriba en 329ms). Logs del
   contenedor nuevo revisados: sin ningún error de columna o tabla
   inexistente, sin nada relacionado a `audio_assets` ni `avatar_source`.
9. **Verificación en vivo**: `https://ssa-business-ai-os-production.up.railway.app/login`
   responde 200. El resto (bandeja cargando, banca de audios con su empty
   state, picker `/a` sin romper con la lista vacía) ya se había verificado
   en vivo contra la MISMA base de datos antes del deploy (no hay base
   "local" separada — el dev server de esta corrida apuntaba a la base de
   producción real), así que no se repitió con un usuario de prueba nuevo
   en el dominio de Railway.
10. **Documentación actualizada**: `CLAUDE.md` (sección Migraciones y
    "Mejoras de Chat", ahora con los Bloques 0-6 y el estado real de cada
    migración), este archivo, y `docs/PENDIENTE.md`.

**Estado final: `main` en producción con los Bloques 0, 4 y 5 completos (código
+ migración 00104 aplicada) y el Bloque 6 con el código desplegado pero la
migración en pausa**, a la espera del diseño del banco de assets unificado.

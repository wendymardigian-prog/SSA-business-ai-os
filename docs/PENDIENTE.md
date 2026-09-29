# Pendientes — Mejoras de Chat (Bloques 1-3)

Lo que quedó sin cerrar, para retomar con Wendy. Formato de cada entrada:

- **Qué quedó:** …
- **Por qué:** …
- **Qué se decidió en su lugar:** …

Los pendientes de la Etapa 4 están en [docs/etapa4/PENDIENTE-agendamiento.md](etapa4/PENDIENTE-agendamiento.md).

---

## Mejoras de Chat

### Migraciones escritas y SIN aplicar
- **Qué quedó:** las dos migraciones de esta corrida están escritas, son idempotentes y están en el bundle (`ALL_MIGRATIONS.sql`), pero **no se aplicaron a la base**.
- **Por qué:** así se pidió: escribirlas, no aplicarlas.
- **Qué se decidió en su lugar:** se aplican a mano, **en este orden**:

  1. `supabase/migrations/00102_chat_media.sql` — bucket privado `chat-media` con su policy de SELECT por workspace (sin policies de escritura), `messages.media_description`, `messages.interpretability`, `workspaces.persist_chat_media`, `workspaces.chat_media_retention_days`.
  2. `supabase/migrations/00103_transcripts_and_needs_human.sql` — columnas de transcripción en `messages`, columnas de escalado en `conversations`, `workspaces.agent_escalate_on_unreadable`, y el CHECK `agent_runs_source_check` ampliado con `audio_transcription` y `media_description`.

  Las dos son aditivas: agregan columnas con default y un bucket, no borran ni reescriben nada. Antes de cada una, `list_migrations`; después de las dos, nada (el bundle ya está regenerado).

  **Hasta que se apliquen, el sistema sigue funcionando como hoy** salvo un detalle: el código nuevo lee y escribe esas columnas, así que **la app no funciona contra la base vieja**. No desplegar esta rama antes de aplicarlas.

### Chequeos de RLS del bucket sin correr
- **Qué quedó:** `scripts/verify-rls.mjs` tiene los chequeos nuevos del bucket `chat-media` (que sea privado, que la policy de SELECT mire el workspace del primer segmento del path, que no haya policies de escritura), pero **no se corrieron**.
- **Por qué:** el bucket todavía no existe: la 00102 no está aplicada.
- **Qué se decidió en su lugar:** correr `node scripts/verify-rls.mjs` después de aplicar la 00102. Los chequeos ya están escritos y se saltean solos con un aviso si el bucket no existe, así que el script no falla mientras tanto.

### Un error de lint preexistente, en código de la Etapa 4
- **Qué quedó:** `npm run lint` devuelve **1 error** en `components/scheduling/booker/use-embed-bridge.ts:22` ("Cannot access refs during render", por `uiRef.current = onUi` en el cuerpo del componente) y 41 warnings.
- **Por qué:** ya está en `main` antes de esta corrida (se comprobó corriendo el lint en las dos ramas), y es código del embed de agendamiento, fuera de los Bloques 1 a 3. La regla de la corrida es no tocar nada fuera de esos bloques, y mover ese `ref` a un `useEffect` cambia cuándo se actualiza el callback del embed: no es un cambio de una línea sin consecuencias.
- **Qué se decidió en su lugar:** se deja como está y se anota. El arreglo correcto es `useEffect(() => { uiRef.current = onUi; })` sin lista de dependencias, en el mismo archivo, con una pasada por el embed para confirmar que el tema y el color de marca siguen llegando. **Esta corrida no agregó ningún error ni warning nuevo de lint**, que es lo que se controla en cada bloque.

### Bloques 4, 5 y 6 — fuera de esta corrida
- **Qué quedó:** identidad visible (fotos de perfil estables y el @ de Instagram clickeable), grabar y enviar audios desde el composer, y la banca de audios reutilizables.
- **Por qué:** el pedido de esta corrida fue explícitamente Bloques 1 a 3 (F1 a F15).
- **Qué se decidió en su lugar:** nada de esos bloques se toca. El plano ya los tiene escritos y el B4 es independiente del resto, así que se puede correr en cualquier momento.

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

### La revisión visual de la bandeja real, sin hacer (pide sesión)
- **Qué quedó:** recorrer `/dashboard/inbox` con datos de verdad, a escritorio y a 390 px, para ver las burbujas nuevas dentro del hilo real.
- **Por qué:** el navegador integrado de esta corrida no tiene sesión y la app redirige a `/login`. La regla de la corrida prohíbe ingresar credenciales.
- **Qué se decidió en su lugar:** se verificó lo que no depende de la sesión, midiendo el CSS real que sirve el dev server a 390 px sobre un banco de prueba con la misma estructura que produce la burbuja. **Encontró dos cosas reales, que ya están arregladas:**

  1. **El reproductor desbordaba la burbuja.** Tenía `min-w-[210px]`, y en CSS `min-width` le gana a `max-width`: medido, 210 px dentro de un contenedor de 200 px da 210 px. Pasó a `min-w-[min(210px,100%)]`.
  2. **Los controles nativos se veían como una píldora blanca** sobre la burbuja oscura. Se les puso `color-scheme: dark`, con las dos variantes (`[.dark_&]:` y `dark:`), porque en este proyecto el tema lo maneja la clase `.dark` del `<html>` pero el `dark:` de Tailwind compila a `@media (prefers-color-scheme: dark)`: son dos señales distintas y no siempre coinciden.

  Lo medido a 390 px, con el CSS de producción: la tarjeta del audio, la del documento y el bloque de transcripción quedan en 279 px de ancho (la burbuja da 279), una foto vertical se corta a 288 px de alto, una captura panorámica a 279 px de ancho, y la página no tiene scroll horizontal. Las dos variantes de `color-scheme` compilan en el CSS de producción.

  **Lo que falta mirar con sesión**, que es lo que el banco de prueba no puede cubrir: que el badge y el filtro "Necesita humano" se vean en la lista real, que el hilo de Instagram muestre la media cruzada, y que el reproductor arranque al apretar ▶ contra un archivo de verdad.

### Un error de lint preexistente, en código de la Etapa 4
- **Qué quedó:** `npm run lint` devuelve **1 error** en `components/scheduling/booker/use-embed-bridge.ts:22` ("Cannot access refs during render", por `uiRef.current = onUi` en el cuerpo del componente) y 41 warnings.
- **Por qué:** ya está en `main` antes de esta corrida (se comprobó corriendo el lint en las dos ramas), y es código del embed de agendamiento, fuera de los Bloques 1 a 3. La regla de la corrida es no tocar nada fuera de esos bloques, y mover ese `ref` a un `useEffect` cambia cuándo se actualiza el callback del embed: no es un cambio de una línea sin consecuencias.
- **Qué se decidió en su lugar:** se deja como está y se anota. El arreglo correcto es `useEffect(() => { uiRef.current = onUi; })` sin lista de dependencias, en el mismo archivo, con una pasada por el embed para confirmar que el tema y el color de marca siguen llegando. **Esta corrida no agregó ningún error ni warning nuevo de lint**, que es lo que se controla en cada bloque.

### Las claves de IA que faltan para que esto funcione en vivo
- **Qué quedó:** el código está completo y probado, pero **en producción nada de esto va a transcribir ni a describir** hasta que se carguen dos claves.
- **Por qué:** el workspace tiene hoy sólo Anthropic (y la bitácora del 28/9 dice que esa clave está **inválida**) y Voyage. No hay Groq, y tampoco hay OpenAI, así que el respaldo de transcripción que el plano daba por existente **hoy no existe**.
- **Qué se decidió en su lugar:** construirlo igual, porque el comportamiento resultante es el correcto: sin clave, el audio se guarda y se reproduce, el mensaje queda como no interpretable, y **el agente escala a una persona en vez de responder a ciegas**. Que es exactamente lo que se quería arreglar.

  Para que funcione en vivo hacen falta, en este orden:

  1. **La clave de Groq** (console.groq.com → API Keys), en Ajustes → Integraciones. Sin esto no se transcribe ningún audio.
  2. **Una clave de visión válida** (OpenAI, Google, o reemplazar la de Anthropic que está vencida). Sin esto no se describe ninguna imagen, y una captura sin texto escala.
  3. **El seed de precios** `supabase/seeds/01_transcription_pricing.sql`, a mano en el editor SQL. Sin esto la transcripción funciona igual, pero los runs quedan con el costo en `null`.

  Una clave de OpenAI además habilita el respaldo: si Groq se cae o devuelve 429, la transcripción sigue por ahí sola.

### `sniffMime` todavía no conoce audio
- **Qué quedó:** `lib/content/media.ts` valida por magic bytes pero sólo conoce imagen, video y PDF, y clasifica cualquier `ftyp` como `video/mp4` (así que un M4A se leería como video).
- **Por qué:** la validación por magic bytes del audio es del **Bloque 5** (subir un audio grabado desde el navegador), que no entra en esta corrida. Para lo que sí se construyó no hace falta: la media entrante no pasa por `sniffMime`, y el bucket ya limita los MIME.
- **Qué se decidió en su lugar:** se deja como está y se anota para el Bloque 5, donde hay que extenderlo con ogg, webm, m4a/mp4, mp3 y wav, y distinguir el `ftyp` de audio del de video.

### Bloques 4, 5 y 6 — fuera de esta corrida
- **Qué quedó:** identidad visible (fotos de perfil estables y el @ de Instagram clickeable), grabar y enviar audios desde el composer, y la banca de audios reutilizables.
- **Por qué:** el pedido de esta corrida fue explícitamente Bloques 1 a 3 (F1 a F15).
- **Qué se decidió en su lugar:** nada de esos bloques se toca. El plano ya los tiene escritos y el B4 es independiente del resto, así que se puede correr en cualquier momento.

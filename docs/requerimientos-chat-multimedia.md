# Requerimientos — Sistema Operativo de Negocio con IA (SSA)
## Mejoras de Chat — Fase 1: Multimedia, voz y guardas del agente

Versión: 1.0
Fecha: 28 de septiembre de 2026
Cliente: Wendy Mardigian / Scaling Systems
Tipo: **Brownfield** (cambio sobre sistema en producción)

---

## 0. El problema, en una frase

Hoy un lead manda una nota de voz por Instagram y el agente de IA le contesta igual, sin haberla escuchado. El mensaje entra a la base con el texto vacío, el agente lo filtra, y responde como si el lead no hubiera dicho nada. En la bandeja, quien quiera revisar ve la palabra "Adjunto" y un clip: tampoco puede escucharlo. Esta fase arregla eso y, de paso, cierra todo lo que falta para que el chat funcione como cualquier chat: ver fotos, videos, links y posts; grabar y mandar audios; y tener una banca de audios reutilizables.

---

## 1. Mapa de ruta

| Etapa | Estado |
|---|---|
| Etapa 1 — Sistema Operativo Base (Fases 1, 2 y 3) | ✅ Construida |
| Etapa 2 — Contenido, métricas, email, roles, Meta Ads | ✅ Construida (+ correcciones) |
| Etapa 4 — Agendamiento y ventas | ✅ Construida |
| **Mejoras de Chat — Fase 1 (este documento)** | 🔨 **Acá estamos** |
| Etapa 3 — Agente IA integral + Fathom + Conector MCP | ⏳ Pendiente |

### Qué NO se construye ahora pero SÍ queda contemplado en el diseño

- **Transcripción de video y de llamadas de Fathom.** El modelo de datos de la transcripción (`transcript`, `transcript_status`, `transcript_seconds`) no es exclusivo de audio: sirve igual para video cuando se sume.
- **Respuestas con imagen generada por el agente.** El envío saliente con media queda hecho; que el agente *genere* la imagen es Etapa 3.
- **Text-to-speech (que el agente hable con voz sintética).** La banca de audios es de audios grabados por personas. La tabla queda con `source` (`recorded` \| `uploaded` \| `synthesized`) para no migrar después.
- **Traducción de la transcripción.** Se guarda en el idioma original.

---

## 2. Objetivo de esta fase y mapa de bloques

**Objetivo:** que el chat muestre y reproduzca todo lo que llega, que el agente de IA entienda los audios e imágenes —y cuando no pueda, se calle y avise a una persona—, y que el equipo pueda grabar, mandar y reutilizar audios.

**Por qué en este orden:** el bloque 2 (que el agente no responda a ciegas) es lo urgente, pero no se puede hacer sin el bloque 1, porque para transcribir un audio primero hay que tenerlo. Los links de Meta y de WhatsApp vencen: si no copiamos el archivo cuando llega, después no hay nada que transcribir ni que reproducir. Por eso "traer la media adentro" va primero aunque no se vea.

### Bloques de ejecución

| Bloque | Día | Qué se construye | Contexto compartido |
|---|---|---|---|
| **B1: Traer la media adentro** | 1 | Esquema normalizado de adjuntos, bucket `chat-media`, ingesta desde Instagram y WhatsApp, retención | `messages.attachments`, `lib/inbound.ts`, los dos webhooks, migración 00102 |
| **B2: El agente entiende o se calla** | 2 | Transcripción de audio, descripción de imágenes, compuerta de interpretabilidad, alerta a humano | `lib/ai/transcribe.ts`, `lib/agent/*`, `scheduled_jobs`, migración 00103 |
| **B3: Ver y reproducir en la bandeja** | 3 | Reproductor y visor por tipo, transcripción visible, reintento, preview de la lista | `components/inbox/message-thread.tsx`, `app/api/v1/messages` |
| **B4: Identidad visible** | 4 | Fotos de perfil estables (IG y WhatsApp), @ de Instagram clickeable | `find_or_link_contact`, `contact-panel.tsx`, migración 00104 |
| **B5: Grabar y enviar audios** | 5 | Grabador en el composer, envío por WhatsApp e Instagram, adjuntar archivos | `app/api/v1/messages`, `lib/flow-engine/send.ts`, `lib/evolution-client.ts` |
| **B6: Banca de audios** | 6 | Tabla, pantalla de administración, picker en el chat, herramienta del agente | `audio_assets`, `settings/audios`, `lib/agent/tools`, migración 00105 |
| **Testing de fase** | 7-8 | Suite completa, scripts de verificación, verificación en vivo | — |

**B4 es independiente de todo lo demás.** Si querés un resultado visible rápido, se puede correr primero sin romper nada.

---

## 3. Usuarios y roles

No se crean roles nuevos. Se usan los que ya existen.

| Rol | Puede hacer | No puede hacer |
|---|---|---|
| **Owner / Admin** | Todo lo de Member. Administrar la banca de audios (crear, editar, dar de baja). Configurar el proveedor de transcripción. Ver el consumo de transcripción. Configurar qué audios puede usar el agente. Cambiar la retención de media. | — |
| **Member (setter / vendedor)** | Ver y reproducir la media de sus conversaciones. Ver transcripciones. Pedir un reintento de transcripción. Grabar y enviar audios. Usar la banca de audios desde el chat. Resolver una conversación escalada. | Administrar la banca. Cambiar configuración de transcripción o retención. |
| **Agente de IA** | Leer transcripciones y descripciones de imagen como parte del historial. Enviar audios de la banca que tenga habilitados. Escalar a humano. | Transcribir a demanda (lo hace el sistema). Enviar audios fuera de la banca. Responder cuando no pudo interpretar el mensaje. |

El scope de leads por RLS sigue igual: un Member sólo ve las conversaciones donde es setter, vendedor o agente asignado.

---

## 4. Alcance específico de esta fase

### 4.1 Media entrante persistida
- **Qué hace:** copia a nuestro Supabase Storage todo archivo que llega por Instagram y WhatsApp (audio, imagen, video, sticker, GIF, documento), y guarda sus metadatos normalizados en `messages.attachments`.
- **Hasta dónde llega:** los seis tipos con archivo. Ubicación, contacto, encuesta y reacción se guardan como etiqueta legible sin archivo (no tienen archivo que bajar).
- **Qué NO hace:** no genera miniaturas propias, no comprime, no convierte formatos al recibir, no hace OCR de imágenes.
- **Dónde va lo que queda afuera:** OCR y análisis profundo de imágenes, Etapa 3.

### 4.2 Transcripción de audio
- **Qué hace:** transcribe automáticamente todo audio entrante y saliente a texto en español, y lo deja disponible para el agente y para la bandeja.
- **Hasta dónde llega:** audio de hasta 25 MB y 10 minutos. Idioma español fijo. Un intento automático más reintento manual desde la bandeja.
- **Qué NO hace:** no separa hablantes (diarización), no pone marcas de tiempo, no transcribe el audio de los videos, no traduce.
- **Dónde va lo que queda afuera:** audio de video y diarización, fuera de esta fase; se evalúa en Etapa 3 con Fathom.

### 4.3 Descripción de imágenes para el agente
- **Qué hace:** cuando llega una imagen sin texto, el sistema le pide al modelo de visión ya configurado (BYOK) una descripción breve, para que el agente sepa qué le mandaron.
- **Hasta dónde llega:** una descripción de hasta 300 caracteres, en español, orientada a "qué se ve y qué dice el texto que aparece en la imagen" (mucho de lo que mandan los leads son capturas de pantalla).
- **Qué NO hace:** no analiza videos, no identifica personas, no hace OCR estructurado de facturas o formularios.

### 4.4 Compuerta de interpretabilidad del agente
- **Qué hace:** antes de que el agente genere una respuesta, el sistema verifica que entienda TODOS los mensajes de la ráfaga. Si hay alguno que no puede interpretar, el agente no responde: la conversación se marca como "Necesita humano" con el motivo, se apaga el agente en esa conversación y se avisa al responsable.
- **Hasta dónde llega:** cubre audio sin transcribir, imagen sin describir, video, documento, ubicación, contacto, encuesta y cualquier tipo desconocido.
- **Qué NO hace:** no reintenta indefinidamente ni retiene la conversación esperando. Si a los 90 segundos la transcripción no está lista, escala.
- **Regla dura:** ante la duda, escala. Es preferible que una persona conteste de más a que el bot conteste a ciegas.

### 4.5 Grabación y envío de audios
- **Qué hace:** botón de micrófono en el composer del chat, con contador y opción de escuchar antes de mandar. El audio se sube a nuestro Storage y se envía por el canal de la conversación.
- **Hasta dónde llega:** WhatsApp (como nota de voz) e Instagram (como adjunto de audio). También adjuntar archivos ya existentes desde el disco (imagen, video, audio, documento) hasta 16 MB.
- **Qué NO hace:** no hay pausa a mitad de la grabación, no hay recorte, no hay filtros ni normalización de volumen, no se envía audio por email.
- **Límite conocido:** Instagram **rechaza** ogg/opus y mp3; acepta AAC, M4A, WAV y MP4 hasta 25 MB. El navegador graba webm/opus en Chrome y mp4 en Safari. Ver la decisión de formato en §10.3.

### 4.6 Banca de audios
- **Qué hace:** una biblioteca de audios pregrabados por workspace, con nombre, atajo, descripción y transcripción, que los setters pueden mandar desde el chat con un clic y que el agente puede usar como herramienta.
- **Hasta dónde llega:** grabar o subir, escuchar, editar los datos, dar de baja (soft delete), y elegir cuáles puede usar el agente.
- **Qué NO hace:** no hay carpetas ni categorías, no hay versiones, no hay estadísticas de uso por audio, no hay variables interpoladas dentro del audio.
- **Dónde va lo que queda afuera:** estadísticas de uso, Etapa 3 junto con la auto-mejora del agente.

### 4.7 Identidad visible del contacto
- **Qué hace:** que la foto de perfil del lead se vea siempre (copiada a nuestro Storage, no linkeada al CDN de Meta que vence), que WhatsApp también traiga foto, y que el @ de Instagram sea un link al perfil.
- **Qué NO hace:** no sincroniza el perfil completo (bio, seguidores), no refresca la foto en cada mensaje (sólo cada 30 días o si falta).

---

## 5. Requerimiento de cambio sobre lo ya construido (brownfield)

### 5.1 Estado actual (as-is) — verificado contra el repo el 28/9/2026

| Pieza | Cómo funciona hoy | Archivo:línea |
|---|---|---|
| `messages.attachments` | Columna `jsonb` libre, **sin esquema**. Conviven cuatro formas incompatibles según el origen. | `00001_initial_schema.sql:193` |
| Instagram entrante | Guarda el array crudo de Zernio `[{type, url, payload?}]`. La `url` es del CDN de Meta y **vence**. No se descarga nada. | `app/api/webhooks/late/route.ts:305` |
| WhatsApp entrante | Guarda el objeto crudo de Baileys. Su `url` es un `.enc` cifrado que **no se puede abrir** sin `mediaKey`. Y si la imagen trae caption, `attachments` queda en `null`: **la media se pierde**. | `app/api/webhooks/evolution/route.ts:274` |
| Email entrante | **El único que funciona bien.** Baja el adjunto, lo sube al bucket privado `email-attachments`, guarda `{files:[{filename, contentType, storagePath, sizeBytes}]}` y firma el link al hacer clic. | `lib/email/inbound.ts:74-125`, `app/api/v1/email-attachments/route.ts` |
| Render en la burbuja | `MessageAttachments` sólo entiende el formato de email. Todo lo demás: un clip y la palabra "Adjunto". **No hay ningún `<audio>` ni `<video>` en todo el repo.** | `components/inbox/message-thread.tsx:682-715` |
| El agente y los adjuntos | Filtra los mensajes sin texto (`.filter((m) => m.text)` y `if (!m.text) continue;`). **Un audio no existe para el agente**, pero el turno igual se agenda y responde. | `lib/agent/context.ts:108`, `lib/agent/prompt.ts:151` |
| Lectura del hilo | Para WhatsApp y email lee de nuestra tabla `messages`. **Para Instagram lee en vivo de la API de Zernio**, no de la base. | `app/api/v1/messages/route.ts:82-123` |
| Envío saliente | Sólo texto. El contrato de `POST /api/v1/messages` exige `text` y no tiene campo de media. | `app/api/v1/messages/route.ts:139-147` |
| Envío por flows | `OutboundMessage` ya tiene `mediaUrl`/`mediaType`. Zernio los usa; **Evolution los descarta en silencio**. | `lib/flow-engine/send.ts:262-265` vs `:330-336` |
| Avatar del contacto | Instagram sí lo captura (`msg.sender.picture`), pero se guarda la URL externa cruda y **nunca se refresca** (`COALESCE`). WhatsApp manda `senderPicture: null` siempre. | `lib/inbox-sync.ts:85`, `00031:120,206,252`, `evolution/route.ts:236` |
| @ de Instagram | Texto plano, sin link. Y `find(ch => ch.username)` no filtra por plataforma: un contacto de WhatsApp muestra `@<teléfono>`. | `components/inbox/contact-panel.tsx:237-248` |
| Cola de trabajos | `scheduled_jobs` + `scheduleJob` + registro de handlers + cron cada minuto. Reintentos con backoff, máximo 3. | `lib/scheduler.ts:122`, `lib/jobs/registry.ts`, `app/api/cron/jobs/route.ts:873-880` |
| Proveedores de IA | BYOK con las claves en Supabase Vault, catálogo en `lib/integrations/providers.ts`, la clave se prueba contra el proveedor antes de guardarla. | `lib/ai/provider.ts`, `lib/secret-names.ts` |
| Última migración | `00101_bg_task_dedupe`. **Las nuevas van de la 00102 en adelante.** | `supabase/migrations/` |

### 5.2 Qué cambia y qué NO cambia

**Cambia:**
- `messages`: columnas nuevas (`transcript`, `transcript_status`, `transcript_error`, `transcript_seconds`, `media_description`, `interpretability`). El esquema de `attachments` pasa a ser normalizado (con lectura compatible hacia atrás).
- `conversations`: columnas nuevas para el escalado (`needs_human`, `needs_human_reason`, `needs_human_at`).
- `contacts`: `avatar_updated_at` y `avatar_source`.
- Los dos webhooks: suman la descarga de media y el encolado de transcripción.
- El composer del chat: suma micrófono, clip y picker de audios.
- La burbuja del mensaje: suma reproductor y visor.
- `lib/agent/context.ts` y `lib/agent/prompt.ts`: dejan de filtrar por `text` y pasan a usar el texto efectivo.
- `lib/agent/dispatch.ts`: suma la compuerta de interpretabilidad antes de agendar el turno.
- `lib/flow-engine/send.ts`: la rama de Evolution deja de descartar `mediaUrl`.
- `find_or_link_contact`: el avatar deja de ser sólo `COALESCE`.
- Tabla nueva `audio_assets`. Bucket nuevo `chat-media`.

**NO cambia (intocable):**
- El motor de flows y sus 17 nodos.
- La dedup cross-canal (`find_or_link_contact` sólo cambia en la rama del avatar; el resto de la función se conserva letra por letra).
- `apply_opt_out_check` y toda la lógica de "no contactar".
- El scope de leads por RLS en `contacts` y `conversations`.
- El email como canal: su ingesta, su bucket `email-attachments` y su ruta de descarga siguen exactamente igual. El renderer nuevo tiene que seguir mostrando los adjuntos de email como hoy.
- El interruptor de tres estados del agente por conversación (`agent_enabled` NULL = heredar del canal) y `resolveAgentState`.
- El modo borrador del agente y su ventana de 24 h.
- El agendamiento completo de la Etapa 4.
- La publicación de contenido y su bucket `content-media`.
- `channels.late_account_id` sigue NOT NULL.
- Los 7 scripts `verify-*.mjs` existentes tienen que seguir pasando.

### 5.3 Análisis de impacto

| Qué se toca | Quién depende | Riesgo | Mitigación |
|---|---|---|---|
| `messages.attachments` | La burbuja de email, el backfill, los flows que registran envíos | Romper la vista de los adjuntos de email, que hoy funciona | El parser nuevo detecta la forma vieja (`{files:[…]}`, array de Zernio, objeto de Baileys) y la adapta al vuelo. **No hay backfill destructivo.** Test de caracterización sobre los cuatro formatos antes de tocar nada |
| `lib/agent/context.ts` / `prompt.ts` | El agente de chat, el copywriter, las secuencias con paso de IA, el resumen al cerrar | Que el agente empiece a ver mensajes que antes ignoraba y cambie de comportamiento | El texto efectivo es `text ?? transcript ?? media_description ?? etiqueta`. Sale siempre marcado (`[Nota de voz] "…"`), nunca como si el lead lo hubiera escrito. Los mensajes sin nada interpretable siguen fuera del historial |
| `lib/agent/dispatch.ts` | Los dos webhooks | Que el agente deje de responder cuando debería | La compuerta se puede apagar por workspace (`agent_escalate_on_unreadable`, default `true`). El escalado queda en `audit_log` |
| `find_or_link_contact` | Los tres receptores y el dedup cross-canal | Romper la deduplicación, que es la regla de negocio central | La migración reescribe la función copiando la 00031 completa y cambiando **sólo** las tres líneas del avatar. `node scripts/verify-crm.mjs` y `verify-rls.mjs` tienen que pasar |
| `POST /api/v1/messages` | El composer, y es el único camino de envío manual | Romper el envío de texto | `text` pasa a ser opcional **sólo si** viene media. Test que cubre el caso actual sin media |
| `lib/flow-engine/send.ts` | Flows, secuencias, broadcasts y el agente | Que un flow empiece a mandar media que antes descartaba | Es el arreglo de un bug: hoy el flow registra en la base un adjunto que **nunca envió**. Se corrige y se cubre con test |
| Lectura del hilo de Instagram | La bandeja | Que la media guardada no se vea porque el hilo viene de Zernio | Se cruza el hilo de Zernio con nuestra tabla por `platform_message_id` y se enriquece cada mensaje con `attachments`, `transcript` y `media_description`. **No se cambia de dónde se lee** |

### 5.4 Migraciones sobre datos existentes

Todas idempotentes, numeradas desde la 00102, y después de cada una: `node scripts/build-all-migrations.mjs`.

| N° | Qué hace | Sobre datos existentes |
|---|---|---|
| **00102** | Bucket `chat-media` + policies. Columnas de media en `messages` (`media_description`, `interpretability`). Índices parciales. | Sólo agrega columnas con default. Las filas viejas quedan con `interpretability = 'unknown'` y no se reprocesan |
| **00103** | Columnas de transcripción en `messages`. Columnas de escalado en `conversations`. Nuevos valores en el CHECK de `agent_runs.source` (`audio_transcription`, `media_description`). Flag `agent_escalate_on_unreadable` en `workspaces` | Agrega columnas con default. El CHECK se **reemplaza** sumando valores, nunca quitando |
| **00104** | Reescribe `find_or_link_contact` (avatar refrescable). `contacts.avatar_updated_at`, `contacts.avatar_source` | Los contactos actuales quedan con `avatar_updated_at = null` y `avatar_source = 'external'`: el primer mensaje que reciban refresca la foto |
| **00105** | Tabla `audio_assets` + RLS + índice único parcial del atajo. Se suma a la función `purge_deleted` | Tabla nueva, sin impacto |

**No reversible:** la 00104 reescribe una función que usan los tres receptores. Antes de aplicarla, `node scripts/verify-crm.mjs`. Si falla, se vuelve con la definición de la 00031 (queda copiada en el comentario de cabecera de la 00104).

**Sin backfill de media vieja.** Los audios y fotos que ya llegaron tienen la URL vencida: no hay nada que recuperar. Las conversaciones viejas siguen mostrando "Adjunto". Es aceptable y hay que decirlo en la UI: el mensaje viejo muestra "Adjunto ya no disponible" en vez de un reproductor roto.

### 5.5 Compatibilidad y transición

- **Interruptor por workspace** para la ingesta de media (`persist_chat_media`, default `true`) siguiendo el patrón de `persist_zernio_inbound` que ya existe. Si el bucket se llena o Evolution empieza a fallar, se apaga desde Ajustes sin deploy.
- **La compuerta de interpretabilidad arranca prendida.** Es el arreglo urgente. Pero es apagable por workspace por si genera demasiado escalado los primeros días.
- **Convivencia de formatos de `attachments`:** el parser nuevo lee los cuatro formatos viejos. No hay fecha de corte ni migración de datos.
- **Si no hay clave de transcripción configurada,** el sistema no rompe: el audio se guarda y se reproduce, el mensaje queda como no interpretable, y el agente escala. Es exactamente el comportamiento deseado.

---

## 6. Funcionalidades y criterios de aceptación

Los criterios están escritos para que Claude Code pueda comprobarlos solo, con `npx vitest run` y `npm run build` (las herramientas que el repo ya tiene). **No se suman dependencias de testing.** La lógica de cada pantalla va en funciones puras testeables; los componentes sólo las componen.

---

### Bloque 1: Traer la media adentro

#### F1: Esquema normalizado de adjuntos
**Descripción:** un único contrato para `messages.attachments`, con un parser que además entiende los cuatro formatos viejos.

Forma nueva:
```ts
type ChatAttachment = {
  kind: "image" | "video" | "audio" | "voice" | "sticker" | "gif" | "document"
      | "location" | "contact" | "poll" | "share" | "link" | "story_reply" | "unsupported";
  storagePath: string | null;   // ruta en el bucket chat-media, null si no se pudo bajar
  sourceUrl: string | null;     // URL del proveedor, sólo como respaldo
  mime: string | null;
  filename: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  status: "pending" | "ready" | "failed" | "none";
  error: string | null;
  meta: Record<string, unknown> | null; // storyId, lat/lon, título del post compartido
};
// se guarda como { v: 2, items: ChatAttachment[] }
```

**Criterios de aceptación:**
- [ ] CUANDO `parseAttachments` recibe `{files:[{filename, contentType, storagePath, sizeBytes}]}` (formato de email), EL SISTEMA DEBE devolver un item con `kind:"document"`, el mismo `storagePath` y `status:"ready"`.
- [ ] CUANDO recibe `[{type:"image", url:"https://cdn/x.jpg"}]` (formato de Zernio), EL SISTEMA DEBE devolver `kind:"image"`, `sourceUrl` con esa URL y `storagePath: null`.
- [ ] CUANDO recibe `{audioMessage:{mimetype:"audio/ogg; codecs=opus", seconds:12, ptt:true}}` (formato de Baileys), EL SISTEMA DEBE devolver `kind:"voice"`, `durationSeconds:12` y `mime:"audio/ogg"`.
- [ ] CUANDO recibe `null`, `{}` o basura, EL SISTEMA DEBE devolver `[]` sin lanzar.
- [ ] El test `lib/messages/attachments.test.ts` cubre los cuatro formatos viejos más el nuevo y pasa. `npm run build` compila.

#### F2: Bucket `chat-media` y ruta de descarga firmada
**Descripción:** bucket privado para la media del chat, con el mismo patrón que `email-attachments`, y una ruta de descarga que firma al hacer clic y **parametriza el bucket** (hoy está fijo).

**Criterios de aceptación:**
- [ ] La migración 00102 crea el bucket `chat-media` con `public=false`, `file_size_limit` 26214400 (25 MB) y los MIME de imagen, video, audio y documento habituales (incluidos `audio/ogg`, `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/wav`).
- [ ] La policy de SELECT exige `public.is_workspace_member(((storage.foldername(name))[1])::uuid)`. **No hay policies de escritura**: sólo service role.
- [ ] El path es `<workspace_id>/<conversation_id>/<message_id>-<n>.<ext>`. El primer segmento es el workspace, que es lo que lee la policy.
- [ ] CUANDO se hace GET a `/api/v1/chat-media?path=<ruta>` con sesión válida y la RLS lo permite, EL SISTEMA DEBE responder 302 a una URL firmada de 15 minutos.
- [ ] CUANDO el `path` contiene `..` o arranca con `/`, EL SISTEMA DEBE responder 400 sin tocar Storage.
- [ ] CUANDO no hay sesión, EL SISTEMA DEBE responder 401.
- [ ] `GET /api/v1/email-attachments` sigue funcionando igual (test existente en verde).
- [ ] Test `app/api/v1/chat-media/route.test.ts` cubre los cuatro casos y pasa.

#### F3: Ingesta de media de Instagram
**Descripción:** cuando llega un mensaje de Instagram con adjunto, se descarga el archivo del CDN de Meta y se sube a `chat-media` antes de que la URL venza.

**Criterios de aceptación:**
- [ ] La descarga corre dentro del `after()` que ya usa el webhook. **El 200 se sigue respondiendo antes de descargar.**
- [ ] CUANDO el mensaje trae `attachments:[{type:"audio", url}]`, EL SISTEMA DEBE insertar la fila con `status:"pending"`, descargar, subir a `chat-media` y actualizar el item a `status:"ready"` con su `storagePath`.
- [ ] CUANDO la descarga falla, EL SISTEMA DEBE dejar el item en `status:"failed"` con el motivo en `error`, conservar el `sourceUrl`, y **no** hacer fallar el webhook.
- [ ] CUANDO el archivo supera los 25 MB, EL SISTEMA DEBE marcarlo `failed` con "El archivo supera el máximo de 25 MB" sin subirlo.
- [ ] CUANDO el mensaje trae `metadata.storyReply`, EL SISTEMA DEBE guardar un item `kind:"story_reply"` con `storyId` y `storyUrl` en `meta` (hoy se descartan).
- [ ] CUANDO el texto del mensaje contiene una URL de `instagram.com/p/`, `/reel/` o `/tv/`, EL SISTEMA DEBE agregar un item `kind:"share"` con esa URL en `meta.url`.
- [ ] El eco `message.sent` y el backfill pasan por el mismo helper (`storeInboundMedia`), no por copias.
- [ ] Test `lib/inbound-media.test.ts` con el cliente de Supabase y el `fetch` mockeados. Pasa. Ningún test de `app/api/webhooks/late/route.test.ts` se rompe.

#### F4: Ingesta de media de WhatsApp (+ arreglo del bug del caption)
**Descripción:** WhatsApp manda la media cifrada; hay que pedírsela a Evolution. Y hay que arreglar que hoy se pierda cuando el mensaje trae caption.

**Criterios de aceptación:**
- [ ] `lib/evolution-client.ts` suma `getBase64FromMediaMessage(config, instance, message)` que hace `POST /chat/getBase64FromMediaMessage/{instance}` con body `{ message, convertToMp4: false }`, con los mismos reintentos que `request`. **Se pasa el objeto `data.message` completo que ya trae el webhook, no sólo `{key:{id}}`**: con el objeto entero Evolution lo usa directo, con la clave sola hace una búsqueda en su propia base. Verificado en el código de la 2.3.7 (§14c).
- [ ] CUANDO llega un `imageMessage` **con** caption, EL SISTEMA DEBE guardar el texto del caption Y el item de media. (Hoy `attachments: text ? null : data.message` lo pierde: este es el arreglo).
- [ ] CUANDO llega un `audioMessage` con `ptt:true`, EL SISTEMA DEBE guardar `kind:"voice"` con `durationSeconds` sacado de `audioMessage.seconds` y `mime` de `audioMessage.mimetype`.
- [ ] CUANDO llega un `locationMessage`, `contactMessage`, `pollCreationMessage` o un nodo de protocolo, EL SISTEMA DEBE guardar la etiqueta legible **sin** intentar descargar nada (si no, el spinner queda girando para siempre).
- [ ] CUANDO Evolution devuelve error o no devuelve base64, EL SISTEMA DEBE marcar el item `failed` con el motivo y no romper el webhook.
- [ ] El webhook sigue respondiendo 200 en menos de 100 ms: la descarga va en `after()`.
- [ ] Test `lib/evolution-media.test.ts` cubre: caption + media, nota de voz, ubicación, error de Evolution. Pasa. `app/api/webhooks/evolution/route.test.ts` existente sigue en verde.

#### F5: Retención y limpieza de la media del chat
**Descripción:** la media no crece sin techo. Un cron diario borra del bucket lo que pasó la retención configurada.

**Criterios de aceptación:**
- [ ] `workspaces.chat_media_retention_days` con default 180. El valor `0` significa "no borrar nunca".
- [ ] El handler corre dentro del cron `purge-deleted` que ya existe (no se crea una ruta de cron nueva, así no hay que tocar la allowlist de `private.call_app_cron`).
- [ ] CUANDO un archivo supera la retención, EL SISTEMA DEBE borrarlo del bucket y poner `storagePath: null` con `status:"none"` en el item, **conservando** el resto de los metadatos y la transcripción.
- [ ] CUANDO el borrado del bucket falla, EL SISTEMA DEBE **no** marcar la fila, para que se reintente al día siguiente.
- [ ] La transcripción **nunca** se borra por retención. Es texto, pesa nada, y es el contexto del agente.
- [ ] Test `lib/chat-media-cleanup.test.ts` con reloj fijo. Pasa.

> **Bloque 1 listo cuando:** F1 a F5 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, `node scripts/verify-rls.mjs` pasa, y ningún test previo se rompió.

---

### Bloque 2: El agente entiende o se calla

Este es el bloque urgente. Hoy el agente contesta a ciegas.

#### F6: Proveedor de transcripción (Groq con respaldo en OpenAI)
**Descripción:** un módulo `lib/ai/transcribe.ts` que transcribe un archivo de audio a texto en español, con proveedor principal y respaldo, y que registra el consumo.

**Por qué Groq y no otro** (el detalle y las fuentes en §10.2): corre 100 % en el servidor, cuesta **US$ 0,04 la hora de audio** contra US$ 0,36 de OpenAI, y el código ya está probado en ScaleOS con estos mismos canales. El respaldo en OpenAI usa la clave que el workspace **ya tiene en el Vault**, así que no agrega costo fijo y evita que una caída de Groq deje al agente sordo — que es exactamente lo que pasó en septiembre con la clave de Anthropic vencida.

**Criterios de aceptación:**
- [ ] `lib/integrations/providers.ts` suma el proveedor `groq` con `capability: "transcription"`, y el tipo `ProviderCapability` suma ese valor. `isTextProvider` **sigue devolviendo lo mismo que hoy** para los proveedores existentes (test de caracterización).
- [ ] La clave de Groq se guarda en Vault con el nombre `groq_api_key` (agregado a `lib/secret-names.ts`, que sigue sin importar nada).
- [ ] La clave se prueba contra el proveedor **antes** de guardarla, igual que las demás (`lib/integrations/ai-key-check.ts`). Un 401/403 no se guarda; un 429/5xx sí.
- [ ] `transcribeAudio({ supabase, workspaceId, bytes, mime, filename })` devuelve `{ ok: true, text, durationSeconds, provider }` o `{ ok: false, code, message, retryable }`. **Nunca lanza.**
- [ ] **El resto del sistema no sabe quién transcribe.** `transcribeAudio` es la única puerta: ni el job, ni la bandeja, ni el agente mencionan a Groq. Adentro hay una función `buildTranscriber(provider, apiKey)` con un `switch`, hermana de `buildModel` en `lib/ai/provider.ts`. Sumar un proveedor —o un gateway el día de mañana— es un `case` más y una fila en el catálogo, no tocar nada de lo que lo usa.
- [ ] CUANDO se hace grep de `"groq"` fuera de `lib/ai/transcribe.ts`, `lib/integrations/providers.ts` y `lib/secret-names.ts`, EL SISTEMA NO DEBE tener coincidencias en código de aplicación. Hay un test que lo verifica, igual que `lib/vault-boundary.test.ts` verifica los imports al Vault.
- [ ] El nombre del archivo que se manda al proveedor se reconstruye desde el **mime**, no desde el filename original: `audio/ogg; codecs=opus` → `audio.ogg`, `audio/mp4` → `audio.m4a`, `audio/webm` → `audio.webm`, fallback `m4a`. (WhatsApp manda nombres inventados y el proveedor devuelve 400 si la extensión no coincide con los bytes.)
- [ ] CUANDO el audio supera 25 MB, EL SISTEMA DEBE devolver `code:"FILE_TOO_LARGE"` sin llamar al proveedor.
- [ ] CUANDO Groq responde 429 o 5xx y hay clave de OpenAI en el workspace, EL SISTEMA DEBE reintentar con OpenAI (`whisper-1`) y devolver `provider:"openai"`.
- [ ] CUANDO no hay ninguna clave configurada, EL SISTEMA DEBE devolver `code:"NO_PROVIDER"` con `retryable:false`.
- [ ] Cada transcripción exitosa registra un run con `source:"audio_transcription"`, el modelo, y los segundos en la unidad correspondiente. Un fallo al registrar **se loguea y se ignora**: nunca tira la transcripción.
- [ ] Test `lib/ai/transcribe.test.ts` mockea `fetch` y cubre: éxito con Groq, caída a OpenAI por 429, archivo grande, sin proveedor, extensión reconstruida desde el mime. Pasa.

#### F7: Job de transcripción
**Descripción:** transcribir no bloquea el webhook. Se encola un trabajo por mensaje, idempotente, con reintentos.

**Criterios de aceptación:**
- [ ] Tipo de job `transcribe_audio`, registrado con `registerJobHandler` (no un `case` nuevo en el `switch`), con `dedupeKey` = el id del mensaje.
- [ ] El claim es condicional en la base: `UPDATE messages SET transcript_status='pending' WHERE id=$1 AND transcript_status IN ('none','failed') RETURNING id`. Si no devuelve fila, el job termina como salteado sin llamar al proveedor.
- [ ] CUANDO el job corre y el audio está en `chat-media`, EL SISTEMA DEBE bajarlo con service role, transcribir y guardar `transcript`, `transcript_status='ready'`, `transcript_seconds`.
- [ ] CUANDO el error es transitorio (429, red, 5xx), EL SISTEMA DEBE lanzar para que la cola reintente con su backoff. CUANDO es permanente (sin clave, audio inválido, muy grande), EL SISTEMA DEBE guardar `transcript_status='failed'` con el motivo y **retornar normal**, sin gastar los 3 intentos.
- [ ] **Reaper:** un `transcript_status='pending'` con más de 10 minutos vuelve a `'failed'` con "La transcripción no terminó" y queda reintentable. (En ScaleOS este caso deja el "Transcribiendo…" girando para siempre; acá no.)
- [ ] Se encola para audio **entrante y saliente**, en los dos canales.
- [ ] Test `lib/jobs/handlers/transcribe-audio.test.ts` cubre: claim tomado, claim ya tomado, error transitorio que relanza, error permanente que no relanza, reaper. Pasa.

#### F8: Descripción de imágenes
**Descripción:** cuando llega una imagen sin texto, se le pide al modelo de visión del workspace una descripción breve para que el agente sepa qué le mandaron.

**Criterios de aceptación:**
- [ ] Job `describe_media`, mismo patrón que F7, con su propio claim sobre `media_description`.
- [ ] Usa `getWorkspaceModel` con el proveedor que tenga visión (OpenAI o Google). Si el workspace sólo tiene Anthropic, usa Anthropic (que también ve imágenes). Si no hay ninguno, deja el mensaje como no interpretable.
- [ ] El prompt pide: qué se ve, y **el texto que aparezca en la imagen**, en español, máximo 300 caracteres. (La mayoría de lo que mandan los leads son capturas.)
- [ ] El run se registra con `source:"media_description"`.
- [ ] CUANDO la imagen trae caption, EL SISTEMA DEBE describirla igual: el caption y la imagen dicen cosas distintas.
- [ ] Test `lib/jobs/handlers/describe-media.test.ts` con el modelo mockeado. Pasa.

#### F9: El agente lee transcripciones y descripciones
**Descripción:** el historial que se le pasa al modelo deja de ignorar los mensajes sin texto.

**Criterios de aceptación:**
- [ ] Función pura `effectiveMessageText(message)` que devuelve, en orden: `text`, `transcript` prefijado `[Nota de voz] "…"`, `media_description` prefijado `[Imagen] …`, o `null`.
- [ ] `loadRecentMessages` suma `transcript`, `media_description` y `attachments` al `select`. **Nunca `select("*")`** sobre tablas con columnas de costo.
- [ ] `toHistory` y `buildModelMessages` usan `effectiveMessageText` en lugar de `m.text`. Los mensajes que devuelven `null` siguen fuera.
- [ ] El texto derivado va **marcado**: el modelo tiene que saber que es una nota de voz transcripta, no algo que el lead escribió. Y sigue envuelto en `wrapUntrusted` como cualquier mensaje del lead.
- [ ] Lo mismo en `lib/ai/generate-reply.ts` (nodo AI de flows y secuencias) y en `lib/agent/summary.ts` (resumen al cerrar).
- [ ] CUANDO un mensaje tiene `text` y `transcript`, EL SISTEMA DEBE usar `text` (es el caption: lo que la persona escribió gana).
- [ ] Test `lib/agent/effective-text.test.ts` cubre las cuatro ramas y la precedencia. `lib/agent/context.test.ts` y `prompt.test.ts` existentes siguen en verde.

#### F10: Compuerta de interpretabilidad y escalado a humano
**Descripción:** **el arreglo urgente.** Antes de que el agente genere nada, el sistema verifica que entienda todos los mensajes de la ráfaga. Si no, no responde: escala.

**Criterios de aceptación:**
- [ ] Función pura `assessInterpretability(messages)` que devuelve `{ interpretable: boolean, reason: string | null, waiting: boolean }`.
- [ ] CUANDO todos los mensajes de la ráfaga tienen texto efectivo, EL SISTEMA DEBE devolver `interpretable: true`.
- [ ] CUANDO hay un audio con `transcript_status='pending'` y pasaron menos de 90 segundos desde que llegó, EL SISTEMA DEBE devolver `waiting: true` y el turno se **reagenda**, no se escala todavía.
- [ ] CUANDO hay un audio con `transcript_status='failed'`, o `pending` con más de 90 segundos, o un video, documento, ubicación, contacto, encuesta o tipo desconocido, EL SISTEMA DEBE devolver `interpretable: false` con el motivo en castellano ("Llegó una nota de voz que no se pudo transcribir", "Llegó un video, que el asistente no puede ver", etc.).
- [ ] CUANDO `interpretable` es `false`, EL SISTEMA DEBE, en una sola operación: poner `conversations.needs_human = true` con `needs_human_reason` y `needs_human_at`, apagar el agente en esa conversación (`agent_enabled = false`), **no** generar ninguna respuesta ni borrador, y dejar el evento en `audit_log`.
- [ ] CUANDO ya había un borrador pendiente para esa conversación, EL SISTEMA DEBE dejarlo como está: no se descarta trabajo hecho.
- [ ] El flag `workspaces.agent_escalate_on_unreadable` (default `true`) apaga la compuerta sin deploy.
- [ ] La compuerta vive en `lib/agent/dispatch.ts` / el runner, **un solo lugar**, y vale tanto para el modo envío como para el modo borrador.
- [ ] Test `lib/agent/interpretability.test.ts` cubre las siete ramas. Pasa.
- [ ] Test de integración con espía: `DADO una conversación con un audio sin transcribir, CUANDO corre el turno del agente, ENTONCES no se llama al modelo, no se inserta ningún mensaje saliente, y la conversación queda `needs_human = true`.`

#### F11: Aviso al humano
**Descripción:** que el escalado se vea. De nada sirve marcar la conversación si nadie mira.

**Criterios de aceptación:**
- [ ] La conversación escalada muestra un badge rojo "Necesita humano" en la lista y en el encabezado del hilo, con el motivo en el `title`.
- [ ] Filtro nuevo en la bandeja: "Necesita humano". Se suma al set de filtros que ya existe.
- [ ] Se manda una notificación por el mecanismo que ya existe (`lib/notifications.ts`) al setter asignado; si no hay setter, a los Owner/Admin. Una sola por conversación: reescalar no vuelve a notificar hasta que alguien la resuelva.
- [ ] CUANDO un humano responde en esa conversación, EL SISTEMA DEBE limpiar `needs_human` automáticamente (ya existe `applyManualReply`, se engancha ahí).
- [ ] Hay un botón "Ya lo vi" que limpia la marca sin responder.
- [ ] La lógica de cuándo se muestra el badge y qué dice está en una función pura testeada; el componente sólo la compone.
- [ ] Test `lib/inbox/needs-human.test.ts` pasa.

> **Bloque 2 listo cuando:** F6 a F11 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, y existe un test que prueba que **el agente no responde a un audio sin transcribir**.

---

### Bloque 3: Ver y reproducir en la bandeja

#### F12: Renderer de adjuntos por tipo
**Descripción:** reemplazar el clip con la palabra "Adjunto" por un visor y reproductor de verdad.

**Criterios de aceptación:**
- [ ] `kind:"image"` / `"sticker"`: miniatura con `loading="lazy"`, máximo 288 px de alto, clic abre a tamaño completo en pestaña nueva, más botón de descarga.
- [ ] `kind:"gif"`: si el mime es `video/*`, `<video autoPlay loop muted playsInline>` (WhatsApp manda los GIF como mp4 corto); si no, `<img>`. Badge "GIF".
- [ ] `kind:"video"`: `<video controls preload="metadata">` más descarga.
- [ ] `kind:"audio"` / `"voice"`: `<audio controls preload="metadata">`, la duración en texto, descarga, y la transcripción debajo.
- [ ] `kind:"document"`: tarjeta con ícono, nombre truncado, `EXT · tamaño` y descarga. **Los adjuntos de email siguen viéndose exactamente como hoy.**
- [ ] `kind:"location"` / `"contact"` / `"poll"`: etiqueta legible, sin reproductor ni spinner.
- [ ] `kind:"share"` / `"link"` / `"story_reply"`: tarjeta con la URL, el título si lo hay, y un link que abre en pestaña nueva.
- [ ] Estados: `pending` → "Descargando adjunto…" con spinner; `failed` → mensaje del motivo más botón de reintento si el error es reintentable; `none` con metadatos → "Adjunto ya no disponible" (media vieja o purgada por retención).
- [ ] **Detección de archivo corrupto:** si el mime no pertenece a la familia del `kind` (por ejemplo `text/html` en una imagen, que es lo que pasa cuando el proveedor devolvió una página de error), se muestra "El archivo no se pudo descargar correctamente" sin reintento.
- [ ] Las URLs se firman **al hacer clic o al reproducir**, no al pintar el hilo: firmar veinte links que nadie va a abrir es gastar y además vencen.
- [ ] Las decisiones (qué componente para qué `kind`, qué etiqueta, si es corrupto, si se ofrece reintento) están en funciones puras en `lib/inbox/media-render.ts`, testeadas. El componente sólo las compone.
- [ ] Test `lib/inbox/media-render.test.ts` cubre los 14 `kind` más los cuatro estados. Pasa.

#### F13: Transcripción visible y reintento manual
**Descripción:** la transcripción se ve debajo del audio, con sus cuatro estados.

**Criterios de aceptación:**
- [ ] `ready` con texto: el texto se muestra siempre, con una barra lateral que lo distingue del mensaje.
- [ ] `pending`: "Transcribiendo…" con spinner.
- [ ] `failed`: el motivo más un botón "Reintentar transcripción".
- [ ] `none`: un botón "Transcribir".
- [ ] CUANDO se hace POST a `/api/v1/messages/[id]/transcribe` con sesión válida y el mensaje es visible para ese usuario por RLS, EL SISTEMA DEBE encolar la transcripción y responder 200.
- [ ] CUANDO el mensaje no es visible por RLS, EL SISTEMA DEBE responder 404 (no 403: no se confirma que exista).
- [ ] CUANDO ya está transcribiendo, EL SISTEMA DEBE responder 200 con `{ status: "already_running" }`, no un error.
- [ ] La autorización usa el cliente **del usuario** para leer el mensaje (que decida la RLS) y recién después service role para encolar. Es el patrón de `chat-transcribe-retry` de ScaleOS.
- [ ] Test de la ruta cubre los tres casos. Pasa.

#### F14: El hilo de Instagram muestra la media guardada
**Descripción:** el hilo de Instagram se lee en vivo de Zernio, así que no trae la media que guardamos. Hay que cruzarlo.

**Criterios de aceptación:**
- [ ] `GET /api/v1/messages` para Instagram sigue leyendo de Zernio (**no se cambia de dónde se lee**), y después enriquece cada mensaje con los datos de nuestra tabla cruzando por `platform_message_id`.
- [ ] CUANDO un mensaje de Zernio tiene fila local con `attachments` normalizados, EL SISTEMA DEBE devolver esos `attachments`, más `transcript`, `transcript_status` y `media_description`.
- [ ] CUANDO no hay fila local (por ejemplo `persist_zernio_inbound` estaba apagado), EL SISTEMA DEBE devolver lo que trae Zernio, sin romper.
- [ ] La función de cruce es pura y está testeada con un hilo de Zernio y un set de filas locales.
- [ ] Test `lib/zernio-message-merge.test.ts` pasa. Los tests de `lib/zernio-message.test.ts` siguen en verde.

#### F15: Preview de la conversación con etiqueta
**Descripción:** hoy un mensaje de Instagram sin texto deja el preview vacío en la lista.

**Criterios de aceptación:**
- [ ] CUANDO el mensaje no tiene texto pero tiene adjunto, EL SISTEMA DEBE escribir en `last_message_preview` la etiqueta del tipo: "🎤 Nota de voz", "📷 Imagen", "🎬 Video", "📄 Documento", "📍 Ubicación", "👤 Contacto", "📊 Encuesta".
- [ ] Vale para los dos canales: hoy WhatsApp lo hace y Instagram no.
- [ ] CUANDO hay transcripción, la lista muestra la transcripción recortada en vez de la etiqueta.
- [ ] Test `lib/message-preview.test.ts` (existente) se extiende y pasa.

> **Bloque 3 listo cuando:** F12 a F15 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, y Claude Code recorrió la bandeja en escritorio y en 390 px de ancho sin scroll horizontal ni reproductores rotos.

---

### Bloque 0: Arreglos de lo construido (agregado el 1/10/2026)

Encontrados mirando la bandeja real y los datos de producción después de desplegar los Bloques 1-3. Van **antes** que todo lo demás en la corrida B.

#### FA1: Los reels compartidos de Instagram se tratan como archivo y fallan
**Descripción.** Cuando un lead comparte un reel o un post, Zernio manda `type: "video"` pero con `originalType: "ig_reel"` y una `url` que apunta a `instagram.com/reel/...` — o sea, una página, no un archivo. El sistema intenta descargarla, falla, y el mensaje queda en rojo. Es el caso más frecuente de la bandeja real.

El mapeo ya contempla `ig_reel`, pero **nunca lo alcanza**: `fromZernioAttachment` (`lib/messages/attachments.ts:~220`) lee `raw.type` y no `raw.originalType`.

**Criterios de aceptación:**
- [ ] CUANDO el adjunto trae `originalType`, EL SISTEMA DEBE usarlo para decidir el `kind`, y sólo caer a `type` si no viene. Un `{type:"video", originalType:"ig_reel"}` tiene que dar `kind: "share"` y `status: "none"`.
- [ ] CUANDO la `url` del adjunto apunta a `instagram.com/p/`, `/reel/` o `/tv/`, EL SISTEMA DEBE tratarlo como `share` aunque no venga `originalType`. Es el cinturón además de los tirantes: una página de Instagram nunca es un archivo que se baje.
- [ ] **El `payload` es un objeto, no un string.** Hoy se lee con `asString(raw.payload)`, que devuelve null y tira a la basura el contenido. Viene `{ url, title, reel_video_id }` y el `title` es el caption completo del reel. EL SISTEMA DEBE guardar `url` y `title` en `meta`.
- [ ] **La tarjeta.** No se reproduce el video en el chat: se muestra una tarjeta clicable con (a) un ícono de Instagram y la etiqueta del tipo — "Reel compartido", "Publicación compartida", "Historia compartida" según corresponda; (b) el título recortado a dos o tres renglones con puntos suspensivos; (c) la URL corta debajo, en gris. Toda la tarjeta es el área clicable, con `target="_blank"` y `rel="noopener noreferrer"`, y abre el reel en Instagram en una pestaña nueva.
- [ ] CUANDO el share no trae título, EL SISTEMA DEBE mostrar igual la tarjeta con la etiqueta y la URL. Nunca un spinner ni un mensaje de error: un link siempre se puede abrir.
- [ ] **Sin miniatura.** El payload de Zernio trae `url`, `title` y `reel_video_id`, pero **no una imagen de portada**, así que la tarjeta no lleva preview. Traerla pediría una llamada extra a Instagram (oEmbed) y queda fuera de alcance; si más adelante se quiere, el lugar es `meta`.
- [ ] Test con el payload real de un `ig_reel` (está en `docs/`): da `kind:"share"`, `status:"none"`, y `meta.title` con el caption.

#### FA2: El agente puede entender un reel compartido, y hoy escala
**Descripción.** El caption del reel llega como **texto** en `payload.title`. O sea que el agente tiene todo lo que necesita para saber qué le compartieron, y sin embargo hoy deriva a una persona. Es escalado innecesario, y es el que más se repite.

**Criterios de aceptación:**
- [ ] `effectiveMessageText` devuelve, para un `share` con título, `[Reel compartido] "<título recortado a 400 caracteres>"`.
- [ ] CUANDO la ráfaga sólo tiene un reel compartido con título, EL SISTEMA DEBE considerarla interpretable y responder.
- [ ] CUANDO el share no trae título, EL SISTEMA DEBE seguir escalando: un link sin contexto no se puede contestar.

#### FA3: Los adjuntos viejos muestran un spinner para siempre
**Descripción.** Los mensajes anteriores al despliegue tienen el formato viejo, con URLs del CDN de Meta **que ya vencieron**. El adaptador les pone `status: "pending"` porque tienen URL, y la burbuja muestra "Descargando adjunto…" eternamente: no hay ningún trabajo en cola que los vaya a bajar. Son 24 mensajes hoy.

**Importante — la mitad de esos mensajes se recupera entera.** Mirando los datos reales hay dos clases bien distintas entre los viejos:

- Los que tienen una URL de **`lookaside.fbsbx.com`** son archivos del CDN de Meta y **sí están perdidos**: esas URLs vencieron.
- Los que tienen una URL de **`instagram.com/reel/...`** son reels compartidos, y **esos links no vencen nunca**. Con el arreglo de FA1 aplicado también al adaptador de formato viejo, esos mensajes pasan de un spinner eterno a una tarjeta que funciona, con su título y todo. No hace falta backfill: se arregla al pintarlos.

**Criterios de aceptación:**
- [ ] El adaptador del formato viejo pasa por la **misma** lógica de FA1: si es un share o la URL es de `instagram.com`, da `kind:"share"` con su tarjeta.
- [ ] CUANDO un adjunto en formato viejo apunta a un archivo que ya no existe (`lookaside.fbsbx.com` y similares), EL SISTEMA DEBE darle `status: "none"`, no `"pending"`.
- [ ] La burbuja muestra "Adjunto ya no disponible" **sólo** para esos, sin spinner y sin botón de reintentar.
- [ ] Los adjuntos de email en formato viejo (`{files:[…]}`) **siguen descargándose igual**: ahí el archivo sí está en nuestro Storage. Test de no-regresión.

#### FA4: Una falla transitoria de transcripción quema la conversación
**Descripción.** Un 429 de Groq escribe `transcript_status = 'failed'` y encola un reintento. Pero la compuerta sólo espera cuando el estado es `pending`, `none` o `null` (`lib/agent/interpretability.ts:49-52`), así que ve `failed`, escala y **apaga el agente** — aunque la cola transcriba bien treinta segundos después. En el plan Free de Groq (20 requests por minuto) un 429 es perfectamente posible.

**Criterios de aceptación:**
- [ ] EL SISTEMA DEBE distinguir "falló definitivo" de "falló, con reintento en cola". Lo más simple: que la compuerta espere también cuando hay un job `transcribe_audio` pendiente para ese mensaje.
- [ ] CUANDO el fallo es definitivo (sin proveedor, audio inválido, muy grande), EL SISTEMA DEBE escalar como hasta ahora.
- [ ] Test: 429 con reintento encolado → espera; sin proveedor → escala.

#### FA5: La ventana de espera real son 30 segundos, no 90
**Descripción.** Los 90 segundos se cuentan desde que llegó el mensaje, pero el turno recién arranca al cerrar la ventana de silencio (~60 s). O sea que en la práctica se espera menos de la mitad de lo previsto, y eso hace que imágenes y audios normales escalen por carrera.

**Criterios de aceptación:**
- [ ] La espera se cuenta desde que **arranca el turno**, no desde `created_at` del mensaje.
- [ ] Test con reloj fijo que lo demuestra.

#### FA6: Los flows y las secuencias siguen contestando a ciegas
**Descripción.** El nodo "Respuesta con IA" y los pasos de IA de secuencias pasan por `generateAiReply` (`lib/ai/generate-reply.ts:117`), que no tiene compuerta: descarta lo ilegible y responde igual. Es el mismo bug de producción por otra puerta.

**Criterios de aceptación:**
- [ ] `generateAiReply` evalúa la misma compuerta antes de generar.
- [ ] CUANDO no es interpretable, EL SISTEMA DEBE no responder y marcar `needs_human`, igual que el agente.
- [ ] Test con espía: el modelo no se llama.

#### FA7: Los stickers y corazones de Instagram no deberían escalar
**Descripción.** Un sticker o un corazón sin texto se trata como imagen: dispara una llamada al modelo de visión y, si no se describe, escala. Es ruido operativo sobre algo que no dice nada.

**Criterios de aceptación:**
- [ ] CUANDO la ráfaga sólo tiene stickers, GIFs o reacciones, EL SISTEMA DEBE tratarla como interpretable con una etiqueta (`[Sticker]`) y dejar que el agente decida, en vez de escalar.
- [ ] No se gasta una llamada de visión en un sticker.

> **Bloque 0 listo cuando:** FA1 a FA7 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, y ningún test previo se rompió.

---

### Bloque 4: Identidad visible

Independiente del resto. Se puede correr en cualquier momento.

#### F16: Fotos de perfil estables
**Criterios de aceptación:**
- [ ] CUANDO llega un mensaje de Instagram con `sender.picture` y el contacto no tiene foto propia o la tiene con más de 30 días, EL SISTEMA DEBE descargarla y subirla al bucket `avatars` en `<workspace_id>/contacts/<contact_id>.jpg`, y guardar la URL pública en `contacts.avatar_url` con `avatar_source='storage'` y `avatar_updated_at = now()`.
- [ ] La migración 00104 reescribe `find_or_link_contact` copiando la 00031 **completa** y cambiando **sólo** las tres líneas del avatar, para que pueda refrescarse. El resto de la función (dedup por teléfono, email, usuario; las cinco ramas; `is_placeholder_name`) queda letra por letra.
- [ ] CUANDO el avatar actual tiene `avatar_source='manual'`, EL SISTEMA DEBE **no** pisarlo nunca.
- [ ] `lib/evolution-client.ts` suma `fetchProfilePictureUrl(config, instance, number)` (`POST /chat/fetchProfilePictureUrl/{instance}`). Se llama **sólo** cuando el contacto no tiene avatar o venció, nunca en cada mensaje.
- [ ] CUANDO Evolution devuelve `null` (pasa en algunas versiones de Baileys), EL SISTEMA DEBE seguir sin error y dejar la inicial.
- [ ] `lib/comment-processor.ts` deja de mandar `senderPicture: null`: el payload de comentarios **sí** trae `author.picture`.
- [ ] **Retención de las fotos.** El cron de limpieza borra del bucket la foto de todo contacto **sin mensajes en los últimos 6 meses**, y deja `avatar_url` en null: la burbuja cae a la inicial, que es lo que se ve hoy. Si esa persona vuelve a escribir, el primer mensaje la trae de nuevo. Una foto `manual` nunca se borra. El motivo no es el espacio —una foto pesa unos 30 KB y mil contactos son 30 MB sobre 100 GB de plan— sino no guardar indefinidamente la cara de gente con la que ya no hablás.
- [ ] Los cuatro `<img>` de avatar suman `onError` que cae a la inicial. Hoy una URL vencida deja un ícono de imagen rota.
- [ ] `node scripts/verify-crm.mjs` y `node scripts/verify-rls.mjs` pasan (protegen el dedup).
- [ ] Test `lib/contacts/avatar.test.ts` cubre: primera foto, refresco por vencimiento, no pisar una manual, Evolution devuelve null. Pasa.

#### F17: El @ de Instagram, clickeable
**Criterios de aceptación:**
- [ ] Función pura `platformHandles(contact, channels)` que devuelve el @ de Instagram y el teléfono de WhatsApp con su link, tomando **`contacts.instagram_username` como fuente canónica** y, si falta, el `platform_username` del canal cuya `platform` sea `"instagram"`.
- [ ] CUANDO el contacto es sólo de WhatsApp, EL SISTEMA DEBE **no** mostrar ningún @ de Instagram. (Hoy `find(ch => ch.username)` no filtra por plataforma y muestra `@<teléfono>`: este es el arreglo.)
- [ ] El @ se renderiza como `<a href="https://instagram.com/<usuario>" target="_blank" rel="noopener noreferrer">` con la clase `text-primary hover:underline` que ya usa el resto de la app.
- [ ] Aparece clickeable en los **tres** lugares: el panel del contacto en la bandeja, el encabezado del detalle del contacto (donde hoy ni se muestra) y la sección "Canales vinculados".
- [ ] El teléfono de WhatsApp también es link a `https://wa.me/<sólo dígitos>`, reutilizando la lógica de `getDmLink`, que se extrae de `channels-view.tsx` a `lib/contacts/links.ts` para no duplicarla.
- [ ] Test `lib/contacts/links.test.ts` cubre: contacto de IG, contacto de WhatsApp, contacto con los dos, usuario cargado a mano sin canal, teléfono con formato. Pasa.

> **Bloque 4 listo cuando:** F16 y F17 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, `verify-crm.mjs` y `verify-rls.mjs` pasan.

---

### Bloque 5: Grabar y enviar audios

#### F18: Grabador en el composer
**Criterios de aceptación:**
- [ ] Botón de micrófono en el composer, visible cuando no hay texto ni adjunto.
- [ ] Usa `MediaRecorder` con el mime elegido por `pickRecordingMime()`, que prueba en orden `audio/mp4`, `audio/webm;codecs=opus`, `audio/webm`. **`audio/mp4` va primero a propósito**: es el único que Instagram acepta.
- [ ] Mientras graba: punto rojo, contador `m:ss`, y tres botones: **Descartar**, **Escuchar** y **Enviar**.
- [ ] Corte automático a los 5 minutos con aviso.
- [ ] La duración se guarda desde el contador del cliente: el webm de Chrome no trae la duración en la cabecera y el reproductor muestra `Infinity`.
- [ ] Los errores de micrófono se traducen: permiso denegado → "Habilitá el micrófono para este sitio"; sin micrófono → "No encontramos ningún micrófono conectado"; ocupado → "Otra aplicación está usando el micrófono".
- [ ] Al terminar (por cualquier vía) se cortan los tracks del stream; si no, el indicador de micrófono del navegador queda prendido.
- [ ] Cancelar **no** envía: se usa una bandera por referencia, porque `onstop` no sabe por qué se detuvo.
- [ ] Una grabación vacía no se envía y avisa.
- [ ] La lógica pura (elección de mime, extensión, formato del contador, traducción de errores) vive en `lib/audio/recording.ts` y está testeada. El componente sólo la usa.
- [ ] Test `lib/audio/recording.test.ts` pasa.

#### F19: Envío de audio y archivos por los dos canales
**Criterios de aceptación:**
- [ ] El audio se sube **directo del navegador a Storage** con `createSignedUploadUrl` (patrón de `content-media`), no como base64 dentro de un JSON. Después se manda sólo el `path`.
- [ ] La validación del servidor es por **magic bytes**, no por extensión: `sniffMime` se extiende con ogg, webm, m4a/mp4, mp3 y wav.
- [ ] `POST /api/v1/messages` acepta `{ conversationId, text?, media?: { storagePath, kind, mime, filename, durationSeconds } }`. `text` pasa a ser opcional **sólo si** viene `media`. **El envío de texto sin media sigue funcionando igual** (test existente en verde).
- [ ] **WhatsApp:** `lib/evolution-client.ts` suma `sendWhatsAppAudio` (`POST /message/sendWhatsAppAudio/{instance}` con `{ number, audio, encoding: true }`) y `sendMedia` (`POST /message/sendMedia/{instance}`). `audio` puede ser una URL pública o base64. Con `encoding: true` es Evolution quien convierte a ogg/opus con su propio ffmpeg y lo manda como nota de voz: **no transcodificamos nosotros y no restringimos el formato de grabación**. (Verificado contra el código de la 2.3.7 — ver §14c.)
- [ ] **Instagram:** el audio se sube primero a Zernio con `uploadMediaDirect` (máximo 25 MB, devuelve una URL pública que hospeda Zernio) y **esa** URL se pasa como `attachmentUrl`, con `attachmentType: "audio"`. No se usa una URL firmada de Supabase: Zernio exige una URL pública sin autenticación ni redirects, y hospedarlo en Zernio elimina la duda. Seguir el patrón de `lib/publishing/zernio-media.ts`, que ya hace esto para publicar contenido.
- [ ] CUANDO el mime del audio es ogg/opus, webm o mp3 **y el canal es Instagram**, EL SISTEMA DEBE rechazar el envío antes de subir nada, con el mensaje "Instagram no acepta este formato de audio. Probá desde Safari o mandalo por WhatsApp." Por WhatsApp **no** se valida el formato: Evolution convierte cualquiera.
- [ ] `sendWhatsAppAudio` NO usa el parámetro `voiceNote` de Zernio: ese es sólo para WhatsApp **vía Zernio**, y nuestro WhatsApp va por Evolution.
- [ ] La lógica de envío vive en `sendChannelMessage` (`lib/flow-engine/send.ts`), **un solo lugar**, y la ruta de la bandeja la reutiliza. Hoy hay dos caminos duplicados y es lo que hizo que Evolution quedara sin media.
- [ ] **Arreglo:** `sendViaEvolution` en `lib/flow-engine/send.ts` deja de descartar `mediaUrl`. Hoy un flow con media por WhatsApp registra en la base un adjunto que **nunca se envió**.
- [ ] La rama por proveedor sigue siendo **explícita**, nunca un `else`.
- [ ] El chequeo de "no contactar" y el aviso de la ventana de 24 h de Instagram aplican igual al envío con media.
- [ ] El mensaje saliente se guarda con su `attachments` normalizado y se encola su transcripción.
- [ ] Clip para adjuntar archivos del disco: imagen, video, audio y documento, hasta 16 MB, con validación por magic bytes en el servidor.
- [ ] Test `lib/flow-engine/send-media.test.ts` cubre: audio por WhatsApp, audio por Instagram, ogg rechazado por Instagram, flow con media por Evolution (el bug arreglado), texto sin media (no-regresión). Pasa.

> **Bloque 5 listo cuando:** F18 y F19 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila, y el test de no-regresión del envío de texto pasa.

---

### Bloque 6: Banca de audios

#### F20: Tabla y administración
**Criterios de aceptación:**
- [ ] Tabla `audio_assets` (migración 00105) copiando el patrón de `response_templates`: `id`, `workspace_id`, `name`, `shortcut`, `description`, `storage_path`, `mime_type`, `duration_seconds`, `size_bytes`, `transcript`, `source` (`recorded`\|`uploaded`\|`synthesized`), `agent_enabled` (boolean), `is_active`, `created_by`, `created_at`, `updated_at`, `deleted_at`.
- [ ] Mismos CHECK que las plantillas: `shortcut` con formato `'^/[a-z0-9][a-z0-9_-]{0,29}$'`, `name` y `description` no vacíos. Índice único parcial `(workspace_id, shortcut) WHERE deleted_at IS NULL AND shortcut IS NOT NULL`.
- [ ] **`description` es obligatoria y es para la IA**: es lo que el agente lee para decidir cuándo usar ese audio. La UI lo dice con esas palabras.
- [ ] RLS: SELECT para cualquier miembro (`is_workspace_member` y `deleted_at IS NULL`); INSERT/UPDATE/DELETE sólo `is_workspace_admin`.
- [ ] La tabla se suma a la función `purge_deleted` (se reescribe la 00098 sumando el DELETE, sin tocar el resto).
- [ ] Pantalla `/dashboard/settings/audios`, copiando la estructura de `settings/templates` (Server Component que carga + client view con tabla y modal). Con reproductor en la lista, grabador integrado y subida de archivo.
- [ ] Tarjeta de acceso en `settings-view.tsx` y entrada en `lib/nav/page-actions.ts`.
- [ ] **Todo audio de la banca se transcribe.** Al crear uno (grabado o subido) se encola la transcripción con el mismo job `transcribe_audio` del Bloque 2, apuntando a `audio_assets` en vez de a `messages`. CUANDO se reemplaza el archivo de un audio existente, EL SISTEMA DEBE volver a transcribirlo y descartar la transcripción anterior.
- [ ] La transcripción de la banca sirve para tres cosas y las tres se verifican: **(a)** el buscador del picker `/a` filtra también por el texto del audio, no sólo por nombre y atajo; **(b)** la herramienta `listar_audios` le pasa al agente la descripción **y la transcripción**, para que sepa qué dice y no sólo cuándo usarlo; **(c)** cuando el agente manda un audio, la transcripción se guarda en el `text` del mensaje saliente, así queda en el historial y el agente no repite lo mismo dos veces.
- [ ] La fila muestra "Transcribiendo…" mientras corre, y el texto cuando termina, con opción de corregirlo a mano (un audio mal transcripto le miente al agente).
- [ ] CUANDO la transcripción de un audio de la banca falla, EL SISTEMA DEBE permitir guardarlo igual pero marcarlo y **no ofrecérselo al agente** hasta que tenga transcripción o alguien la escriba a mano.
- [ ] Todas las acciones quedan en `audit_log` (se suma el `entity_type` y las `AuditAction` correspondientes).
- [ ] CUANDO se intenta crear un audio con un atajo ya usado, EL SISTEMA DEBE responder con el mensaje en castellano "Ya hay un audio con ese atajo", no con el error crudo de Postgres.
- [ ] Test `lib/actions/audio-library.test.ts` cubre: crear, atajo duplicado, editar, baja lógica, y que un Member no pueda administrar. Pasa.

#### F21: Picker de audios en el chat
**Criterios de aceptación:**
- [ ] El prefijo `/a` en el composer abre el picker de audios (el `/` solo sigue abriendo las plantillas de texto, sin cambios).
- [ ] Reutiliza `filterTemplates` (el filtro sin acentos con ranking que ya existe) sobre nombre, atajo y transcripción.
- [ ] A diferencia de las plantillas, el audio **no se inserta en el textarea**: se muestra un preview con reproductor y un botón "Enviar".
- [ ] Teclado: flechas para navegar, Enter para elegir, Escape para cerrar. Mismo comportamiento que el picker de plantillas.
- [ ] El envío pasa por el mismo camino que F19.
- [ ] Test `lib/audio-library/search.test.ts` pasa.

#### F22: Herramienta del agente
**Criterios de aceptación:**
- [ ] Dos herramientas nuevas registradas con `registerAgentTool` en `lib/agent/tools/index.ts` (una línea de alta, como manda el patrón): `listar_audios` y `enviar_audio`.
- [ ] `listar_audios` devuelve los audios con `agent_enabled = true`, con su nombre y **descripción** (no el archivo).
- [ ] `enviar_audio` recibe el id y manda el audio por el canal de la conversación, por el mismo camino de F19.
- [ ] `configFields` permite elegir desde la pantalla del agente **cuáles** audios puede usar (multiselect con `optionSource` nuevo).
- [ ] La acción queda en `audit_log` con `performed_by_agent_id`, como el resto de las herramientas.
- [ ] En **modo borrador** el audio no se manda: queda propuesto en el borrador con su reproductor, y se manda recién cuando la persona aprueba (`deferInDraft`).
- [ ] Un audio enviado cuenta como respuesta a los efectos del tope de respuestas por conversación.
- [ ] CUANDO el agente pide un audio que no existe o no tiene habilitado, EL SISTEMA DEBE devolverle el error como **resultado de la herramienta**, nunca como excepción que mate la corrida.
- [ ] Test `lib/agent/tools/audio.test.ts` cubre: listar, enviar, audio no habilitado, modo borrador. Pasa.

> **Bloque 6 listo cuando:** F20 a F22 cumplen sus criterios, `npx vitest run` sale 0, `npm run build` compila.

### Definición de "listo" global de la fase

Todos los bloques listos, `npx vitest run` sale 0 con la suite completa, `npm run build` compila, los 7 scripts `verify-*.mjs` existentes pasan, el script nuevo `verify-chat-media.mjs` pasa, y los bloqueos anotados en `docs/PENDIENTE.md`.

### Funcionalidades de fases siguientes (no se construyen ahora)

- F-futura-1: Transcripción del audio de los videos — Etapa 3
- F-futura-2: OCR estructurado de imágenes (facturas, formularios) — Etapa 3
- F-futura-3: Text-to-speech, que el agente hable con voz sintética — Etapa 3
- F-futura-4: Estadísticas de uso por audio de la banca — Etapa 3 (con auto-mejora del agente)
- F-futura-5: Adjuntos en el email saliente — Extra independiente
- F-futura-6: Diarización (separar hablantes) — fuera del proyecto por ahora

---

## 7. Flujos principales

### Flujo A: llega una nota de voz por WhatsApp (el caso que hoy falla)

1. Evolution manda el evento `MESSAGES_UPSERT` con `audioMessage` y `ptt:true`.
2. El webhook valida el token, reclama el evento en `webhook_events` y **responde 200 en menos de 100 ms**.
3. En `after()`: resuelve el contacto con `find_or_link_contact`, actualiza la conversación con el preview "🎤 Nota de voz", e inserta el mensaje con `attachments` normalizado en `status:"pending"` y `transcript_status:"none"`.
4. Encola dos trabajos: bajar la media y, encadenado, transcribir.
5. La descarga pide el base64 a Evolution, lo sube a `chat-media`, y pasa el item a `status:"ready"`.
6. La transcripción reclama la fila (`none` → `pending`), baja el archivo, llama a Groq, y guarda el texto con `transcript_status:"ready"`.
7. En paralelo, el turno del agente estaba agendado con su ventana de ráfaga. Cuando corre, la compuerta de interpretabilidad mira la ráfaga:
   - **Si la transcripción ya está:** el agente la lee como `[Nota de voz] "hola, quería saber el precio"` y responde normal.
   - **Si todavía está `pending` y pasaron menos de 90 s:** el turno se reagenda.
   - **Si falló o pasaron más de 90 s:** el agente **no responde**. La conversación queda `needs_human` con el motivo, el agente se apaga en esa conversación, y se notifica al setter.
8. En la bandeja aparece el reproductor con la transcripción debajo (o el botón de reintentar).

**Resultado exitoso:** el lead recibe una respuesta que tiene en cuenta lo que dijo, o una persona recibe el aviso de que hay algo que atender.
**Casos de error:** Evolution no devuelve el audio → el item queda `failed`, la conversación escala. Groq devuelve 429 → se reintenta con OpenAI; si tampoco, la cola reintenta con backoff y, pasados los 90 s, escala.

### Flujo B: un setter manda una nota de voz

1. Aprieta el micrófono. El navegador pide permiso (una sola vez).
2. Graba. Ve el contador. Puede descartar, escuchar o enviar.
3. Al enviar, el navegador sube el archivo directo a `chat-media` con una URL de subida firmada.
4. El front manda `POST /api/v1/messages` con el `storagePath`, el mime y la duración.
5. El servidor valida por magic bytes, chequea "no contactar", y envía por el canal:
   - **WhatsApp:** `sendWhatsAppAudio` con `encoding: true`. Evolution convierte.
   - **Instagram:** `sendInboxMessage` con `attachmentUrl` firmada y `attachmentType: "audio"`. Si el mime es ogg o mp3, se rechaza antes de intentarlo con un mensaje claro.
6. Se guarda el mensaje saliente con su adjunto, se apaga el agente en esa conversación (responder a mano ya lo hace hoy) y se encola la transcripción del audio propio, para que el agente sepa qué se dijo.

### Flujo C: un setter manda un audio de la banca

1. Escribe `/a` en el composer. Se abre el picker.
2. Filtra escribiendo. Ve nombre, atajo y transcripción.
3. Elige uno: aparece el preview con reproductor.
4. Escucha, y aprieta Enviar. De acá en adelante es el paso 5 del flujo B.

### Flujo D: el agente manda un audio de la banca

1. El agente decide, según las descripciones, que corresponde mandar un audio.
2. Llama a `enviar_audio` con el id.
3. **En modo envío:** se manda y queda en `audit_log` con `performed_by_agent_id`.
4. **En modo borrador:** el borrador muestra el audio con su reproductor y no se manda hasta que alguien aprueba.

---

## 8. Modelo de datos

### Columnas nuevas

| Tabla | Campo | Tipo | Req. | Descripción |
|---|---|---|---|---|
| `messages` | `attachments` | `jsonb` | no | **Ya existe.** Pasa al formato `{v:2, items:ChatAttachment[]}`. Se leen los formatos viejos con adaptador |
| `messages` | `transcript` | `text` | no | Transcripción del audio |
| `messages` | `transcript_status` | `text` | sí | `none` \| `pending` \| `ready` \| `failed`. Default `none` |
| `messages` | `transcript_error` | `text` | no | Motivo del fallo, en castellano |
| `messages` | `transcript_seconds` | `numeric` | no | Segundos de audio que cobró el proveedor |
| `messages` | `transcript_started_at` | `timestamptz` | no | Para el reaper de los `pending` colgados |
| `messages` | `media_description` | `text` | no | Descripción de la imagen generada por el modelo de visión |
| `messages` | `interpretability` | `text` | sí | `text` \| `transcribed` \| `described` \| `label_only` \| `unreadable` \| `unknown`. Default `unknown` |
| `conversations` | `needs_human` | `boolean` | sí | Default `false` |
| `conversations` | `needs_human_reason` | `text` | no | Por qué escaló, en castellano |
| `conversations` | `needs_human_at` | `timestamptz` | no | Cuándo |
| `contacts` | `avatar_updated_at` | `timestamptz` | no | Para refrescar cada 30 días |
| `contacts` | `avatar_source` | `text` | no | `external` \| `storage` \| `manual`. Una foto `manual` no se pisa nunca |
| `workspaces` | `persist_chat_media` | `boolean` | sí | Default `true`. Apaga la ingesta sin deploy |
| `workspaces` | `chat_media_retention_days` | `integer` | sí | Default 180. `0` = no borrar |
| `workspaces` | `agent_escalate_on_unreadable` | `boolean` | sí | Default `true` |

### Tabla nueva: `audio_assets`

| Campo | Tipo | Req. | Descripción |
|---|---|---|---|
| `id` | `uuid` | sí | `gen_random_uuid()` |
| `workspace_id` | `uuid` | sí | FK a `workspaces`, `ON DELETE CASCADE` |
| `name` | `text` | sí | Nombre visible. No vacío |
| `shortcut` | `text` | no | `/precio`. CHECK de formato, único parcial por workspace |
| `description` | `text` | sí | **Para la IA.** Cuándo corresponde usar este audio |
| `storage_path` | `text` | sí | Ruta en `chat-media`, carpeta `<workspace_id>/library/` |
| `mime_type` | `text` | sí | |
| `duration_seconds` | `integer` | no | |
| `size_bytes` | `bigint` | no | |
| `transcript` | `text` | no | Qué dice el audio. Se llena solo al crearlo. Es lo que busca el picker y lo que lee el agente |
| `transcript_status` | `text` | sí | `none` \| `pending` \| `ready` \| `failed`. Default `none`. Un audio sin `ready` no se le ofrece al agente |
| `transcript_source` | `text` | sí | `auto` \| `manual`. Si alguien corrigió la transcripción a mano, un reintento automático no la pisa |
| `source` | `text` | sí | `recorded` \| `uploaded` \| `synthesized`. Default `recorded` |
| `agent_enabled` | `boolean` | sí | Default `false`. El agente arranca sin poder usar ninguno |
| `is_active` | `boolean` | sí | Default `true` |
| `created_by` | `uuid` | no | FK a `auth.users`, `ON DELETE SET NULL` |
| `created_at` / `updated_at` | `timestamptz` | sí | Trigger `set_updated_at` |
| `deleted_at` | `timestamptz` | no | Soft delete, purga a los 30 días |

### Notas de optimización

- **No se crea una tabla de adjuntos.** `messages.attachments` ya existe y un mensaje tiene pocos adjuntos: una tabla sería un JOIN en el camino más caliente del sistema a cambio de nada.
- **No se crea una tabla de transcripciones.** Es una relación 1 a 1 con el mensaje; columnas.
- **No se crea una tabla de escalados.** `conversations` con tres columnas alcanza, y el histórico ya queda en `audit_log`.
- **`source` en `audio_assets` se agrega ahora** aunque sólo se usen dos valores: cuando entre text-to-speech en Etapa 3, no hay que migrar.
- **`interpretability` se guarda aunque se pueda calcular.** Es lo que va a permitir después responder "¿cuántos mensajes no pudo entender el agente este mes?" sin recorrer los adjuntos de cada fila.

### Políticas de datos

- **Soft delete:** `audio_assets` con `deleted_at`, retención 30 días, purga por el cron que ya existe.
- **Auditoría:** alta, cambio y baja de audios de la banca. Cada escalado del agente. Cada envío de audio por el agente, con `performed_by_agent_id`.
- **Retención de media:** 180 días por default, configurable. **La transcripción nunca se borra.**
- **Retención de mensajes:** la de 12 meses que ya existe no cambia.

---

## 9. Arquitectura

```
Instagram (Zernio)  ─┐
                     ├─► /api/webhooks/{late,evolution}
WhatsApp (Evolution) ┘        │ 200 inmediato
                              ▼  after()
                     lib/inbound.ts ──► find_or_link_contact (dedup)
                              │
                              ├─► storeInboundMedia() ──► Supabase Storage (chat-media, privado)
                              │
                              ├─► scheduleJob("transcribe_audio")  ─┐
                              ├─► scheduleJob("describe_media")     ├─► /api/cron/jobs (cada minuto)
                              │                                     │      │
                              └─► maybeScheduleAgentTurn ──┐        │      ├─► Groq whisper-large-v3-turbo
                                                           │        │      └─► (respaldo) OpenAI whisper-1
                                                           ▼        │
                                          /api/cron/agent-bursts ◄──┘
                                                           │
                                            ┌──────────────┴──────────────┐
                                            ▼                             ▼
                                assessInterpretability()          [no interpretable]
                                            │                             │
                                     [interpretable]            conversations.needs_human = true
                                            │                    agent_enabled = false
                                            ▼                    notificación al setter
                                    el agente responde                    │
                                                                          ▼
                                                              Bandeja: badge "Necesita humano"
```

- **Frontend:** Next.js 16 App Router. Server Components por default; el grabador, el reproductor y los pickers son Client Components.
- **Backend:** API Routes para webhooks y descargas; Server Actions para las mutaciones de la banca.
- **Trabajos pesados:** la cola `scheduled_jobs` que ya existe, con el cron de cada minuto. **No se crea una ruta de cron nueva.**
- **Todo corre en el servidor (Railway).** Ni la transcripción ni la descripción de imágenes necesitan una computadora prendida: el agente responde solo, de noche y los fines de semana.

### 9.1 Storage

| Bucket | Estado | Público | Límite | Para qué |
|---|---|---|---|---|
| `knowledge` | existe | no | 25 MB | Base de conocimiento del agente |
| `content-media` | existe | no | 1 GB | Publicación de contenido |
| `email-attachments` | existe | no | 25 MB | Adjuntos de email |
| `avatars` | existe | **sí** | 2 MB | Perfiles de agenda. **Se suma la carpeta `contacts/`** |
| **`chat-media`** | **nuevo** | no | 25 MB | **Media del chat + banca de audios** |

- **Plan:** Supabase Pro, 100 GB. Con 200 mensajes con media por día a 400 KB promedio son ~24 GB al año; con la retención de 180 días se estabiliza en ~12 GB. Holgado.
- **Estructura de `chat-media`:** `<workspace_id>/<conversation_id>/<message_id>-<n>.<ext>` para los mensajes, `<workspace_id>/library/<audio_id>.<ext>` para la banca. El primer segmento siempre es el workspace, que es lo que lee la policy.
- **Validación server-side por magic bytes**, nunca por extensión.
- **Lectura:** URL firmada de 15 minutos, generada al hacer clic o al reproducir, **nunca al pintar el hilo**.
- **Descarga:** URL firmada aparte, de 5 minutos, con `{ download: filename }`. No se reutiliza la de reproducción, porque un link de descarga se comparte.
- **Sin CDN propio.** Es media privada de un solo workspace: no hay volumen que lo justifique.

---

## 10. Stack y decisiones técnicas

| Componente | Tecnología | Justificación |
|---|---|---|
| Transcripción (principal) | **Groq `whisper-large-v3-turbo`** | US$ 0,04/hora de audio, 9× más barato que OpenAI. Corre en el servidor. Código ya probado en ScaleOS con estos mismos canales |
| Transcripción (respaldo) | **OpenAI `whisper-1`** | US$ 0,36/hora. Usa la clave que el workspace **ya tiene**. Evita que una caída de Groq deje al agente sordo |
| Descripción de imágenes | El modelo de visión del workspace (BYOK) | No suma proveedor: OpenAI, Google y Anthropic ven imágenes |
| Grabación | `MediaRecorder` nativo | Sin dependencias. `audio/mp4` primero por la restricción de Instagram |
| Transcodificación | **Ninguna nuestra** | WhatsApp: lo hace Evolution con `encoding: true`. Instagram: se restringe el formato de grabación. Meter ffmpeg en Railway es el mayor riesgo técnico de la fase y no hace falta |
| Reproductor | `<audio controls>` / `<video controls>` nativos | Sin waveform ni librerías. ScaleOS lo usa así y funciona |
| Subida | Directo del navegador con URL firmada | Evita el límite de body de las Server Actions y no infla el payload un 33 % como el base64 |
| Cola | `scheduled_jobs` (existente) | Ya tiene claim, reintentos con backoff y recuperación de colgados |

### 10.1 Formatos de audio: la restricción que manda

| | Graba el navegador | Acepta WhatsApp | Acepta Instagram |
|---|---|---|---|
| `audio/mp4` (m4a) | Safari, y Chrome reciente | sí (Evolution convierte) | **sí** |
| `audio/webm;codecs=opus` | Chrome, Firefox | sí (Evolution convierte) | **no** |
| `audio/ogg;codecs=opus` | — | sí, nativo | **no** |
| `audio/mpeg` (mp3) | — | sí | **no** |

**La decisión:** grabar en `audio/mp4` cuando el navegador lo soporte, y caer a webm si no.

- **WhatsApp: da igual el formato.** Verificado en el código de Evolution 2.3.7: con `encoding: true` (el default) convierte con ffmpeg a ogg/opus y lo manda como nota de voz nativa. Mandamos lo que el navegador haya grabado.
- **Instagram: sí importa.** Acepta AAC, M4A, WAV y MP4; rechaza ogg/opus y mp3. Si el audio quedó en webm, se rechaza el envío con un mensaje claro en vez de mandar algo que Instagram va a tirar. Es una limitación real y visible, no un bug escondido.

En la práctica, Chrome reciente y Safari graban `audio/mp4`, así que el caso del rechazo es poco frecuente. El mensaje de error sugiere mandarlo por WhatsApp, que siempre funciona.

Para **recibir** no hay problema: Groq acepta flac, mp3, m4a, mpeg, mpga, ogg, wav y webm.

### 10.2 Por qué Groq — la comparación completa

| Proveedor | Modelo | Costo por hora de audio | Corre en el servidor | ¿Clave nueva? |
|---|---|---|---|---|
| **Groq** | whisper-large-v3-turbo | **US$ 0,04** | sí | sí, una |
| OpenAI | whisper-1 | US$ 0,36 | sí | **no, ya la tenés** |
| OpenAI | gpt-4o-transcribe | US$ 0,36 | sí | no |
| Google | Chirp / Speech-to-Text | US$ 0,36 | sí | requiere GCP, no es la misma clave del AI Studio |
| AssemblyAI | Best | US$ 0,75 | sí | sí |
| Whisper local | — | "gratis" | **necesita GPU** | — |

**Descartado Whisper local:** necesitaría una GPU en Railway corriendo todo el tiempo. Pagás el servidor aunque no llegue ningún audio, y el agente depende de que ese servicio esté vivo. Justo lo contrario de lo que pediste.

**Descartado ir sólo con OpenAI:** funciona y no suma proveedor, pero cuesta 9 veces más y perdés el código ya probado de ScaleOS. Igual queda como respaldo, que es donde mejor rinde.

**Con números reales:** si entran 100 notas de voz por día de 40 segundos promedio, son 1,1 horas de audio. Con Groq: **US$ 0,045 por día**, unos US$ 1,35 al mes. Con OpenAI: US$ 12 al mes. La diferencia no es dramática en plata, pero el código portado de ScaleOS sí ahorra tiempo de construcción.

**La clave va a Supabase Vault** con el nombre `groq_api_key`, se prueba contra el proveedor antes de guardarla, y aparece como una card más en Integraciones. Mismo patrón que todo lo demás.

### 10.2b Por qué NO un gateway único todavía (decisión tomada el 28/9/2026)

Con Groq pasás a cinco claves de IA: Anthropic, OpenAI, Google, Voyage y Groq. Se evaluó reemplazarlas por un gateway único —una sola clave, una sola factura, un solo lugar donde ver el consumo—. El candidato es **Vercel AI Gateway**: cubre todo lo que usa el sistema (texto, visión, transcripción, embeddings, reranking), no cobra markup sobre el precio de lista del proveedor, y hasta admite traer las claves propias por debajo.

**Se decidió no hacerlo ahora, por tres motivos:**

1. **Requiere el AI SDK v7.** El proyecto está en `ai ^6.0.85` y la transcripción por el Gateway pide 7.0.31 o superior. Ese salto de versión mayor toca el agente de chat, el motor de flows, las secuencias, el copywriter y el clasificador: es un proyecto aparte, y meterlo acá dejaría el arreglo urgente (que el agente no responda a ciegas) detrás de una migración grande.
2. **Choca con la arquitectura BYOK, que es parte del producto.** Que el usuario conecte sus propias claves desde Integraciones, guardadas en Vault y probadas antes de guardar, ya está construido y es lo que hace al sistema clonable como template. Un gateway con una sola clave convierte todo eso en código muerto y pone al dueño del sistema en el medio de la facturación de IA de sus clientes.
3. **Lo que más duele ya está resuelto.** De las tres razones para ir a un gateway —factura única, consumo en un solo lugar, respaldo automático—, las dos últimas ya existen: cada llamada pasa por `openAiRun` y deja el run con su costo congelado, y el respaldo se construye en esta fase. Queda la factura única, que es comodidad, no arquitectura.

**Cómo se deja preparado:** `lib/ai/transcribe.ts` se construye detrás de una interfaz (ver los criterios de F6). El día que se sume un gateway, entra como **un proveedor más del catálogo BYOK**, no como reemplazo: un `case` en `buildTranscriber` y una fila en `lib/integrations/providers.ts`.

**Cuándo revisar esta decisión** — cualquiera de estas tres alcanza:
- Que el sistema llegue a seis o más proveedores de IA.
- Que se encare el upgrade a AI SDK v7 por otro motivo (ahí el costo marginal de sumar el gateway es casi cero).
- Que el template se entregue a clientes que no quieran administrar cinco claves.

**Ojo con el nombre:** **Groq** (con Q) es la empresa que corre modelos abiertos en hardware propio, y es la que usamos. **Grok** (con K) es el modelo de xAI y no tiene nada que ver. En prompts, variables y documentación va siempre `groq`.

**Nota aparte, no la resuelve un gateway:** el 28/9 la clave de Anthropic estaba inválida y la card de la integración seguía en verde, así que el agente y el clasificador fallaron sin aviso. Eso se arregla con un chequeo periódico de salud de las claves, no con un intermediario. Queda anotado como candidato a una fase futura (ver §16).

### 10.3 Decisiones de riesgo que conviene saber

1. **La descarga de media va en `after()` del webhook, no en la cola.** Motivo: las URLs de Meta vencen y en WhatsApp la media se borra del servidor de la plataforma pasado un tiempo. Si esperamos al cron de un minuto, a veces llegamos tarde. El riesgo es que un `after()` largo se corte; por eso el item queda en `pending` y hay reintento manual desde la bandeja.
2. **La transcripción sí va en la cola.** No es urgente al segundo, y la cola da reintentos gratis.
3. **Los 90 segundos de espera antes de escalar** son un número elegido, no medido. Groq tarda 2-5 segundos para un audio de un minuto, así que 90 s es holgado y cubre una reintentada. Si en producción resulta corto o largo, es una constante, no un rediseño.
4. **La ventana de 24 h de Instagram** aplica igual al audio. El aviso que ya existe en la UI se mantiene.

---

## 11. Pantallas

### 11.1 Convenciones globales

No cambian. Se respeta lo que ya hay: Tailwind v4, la navegación actual, los estados estándar (vacío, cargando, error, éxito con toast), y el comportamiento responsive de la bandeja (en mobile la lista y el hilo son pantallas separadas).

**Convenciones nuevas de esta fase:**
- Un adjunto **nunca** deja la burbuja vacía: siempre hay reproductor, visor, tarjeta o etiqueta.
- La media **nunca** rompe el ancho de la burbuja: máximo 288 px de alto en imagen y video, y el audio ocupa el ancho disponible con un mínimo de 210 px.
- Los estados de la media (`pending`, `failed`, `none`) se muestran **dentro** de la burbuja, no como toast.
- Todo botón de acción táctil tiene al menos 44 px de lado en mobile.

### 11.2 Por bloque

#### Bloque 3 — Burbuja del mensaje (`/dashboard/inbox`)

- **Propósito:** mostrar y reproducir lo que llegó.
- **Layout:** el adjunto va **arriba** del texto dentro de la burbuja, como en WhatsApp. La transcripción va debajo del reproductor, con una barra lateral que la separa visualmente del mensaje.
- **Componentes:** reproductor de audio con duración y descarga; visor de imagen con clic a tamaño completo; reproductor de video; tarjeta de documento con ícono, nombre y peso; tarjeta de link o post compartido; etiqueta para ubicación, contacto y encuesta; bloque de transcripción con sus cuatro estados.
- **Estados:** descargando (spinner + "Descargando adjunto…"); fallido (motivo + reintento si aplica); no disponible ("Adjunto ya no disponible", para media vieja o purgada); corrupto ("El archivo no se pudo descargar correctamente", sin reintento).
- **Interacciones:** clic en imagen → pestaña nueva a tamaño completo. Clic en descargar → URL firmada de 5 minutos. Clic en "Transcribir" / "Reintentar transcripción" → encola y pasa a "Transcribiendo…".
- **Reglas:** la URL se firma al hacer clic, no al pintar. Un Member sólo ve la media de sus conversaciones (lo resuelve la RLS del bucket).
- **Responsive:** en 390 px la imagen y el video ocupan el ancho de la burbuja sin desbordar. El reproductor de audio no se corta. Sin scroll horizontal.

#### Bloque 3 — Lista de conversaciones

- Preview con etiqueta de tipo cuando no hay texto. Badge rojo "Necesita humano" con el motivo en el `title`. Filtro nuevo "Necesita humano" junto a los que ya existen.

#### Bloque 4 — Panel del contacto y detalle del contacto

- El @ de Instagram como link al perfil, con el ícono de la plataforma. El teléfono de WhatsApp como link a `wa.me`. La foto de perfil con fallback a la inicial si falla la carga. En el detalle del contacto, el @ se suma al encabezado (hoy sólo está dentro del formulario de edición).

#### Bloque 5 — Composer del chat

- **Estado normal:** textarea, clip (adjuntar), micrófono (sólo si el textarea está vacío y no hay adjunto), botón de enviar.
- **Estado grabando:** el composer se reemplaza por: punto rojo pulsante, "Grabando 0:14", y tres botones — Descartar, Escuchar, Enviar.
- **Estado con adjunto elegido:** chip con el nombre del archivo, su peso, un botón de quitar, y el textarea disponible para el caption.
- **Errores:** permiso de micrófono denegado, archivo muy grande, formato no aceptado por el canal → toast con el motivo en castellano y qué hacer.
- **Responsive:** en mobile los tres botones de grabación entran en una fila sin desbordar.

#### Bloque 6 — Banca de audios (`/dashboard/settings/audios`)

- **Propósito:** administrar los audios reutilizables.
- **Layout:** encabezado con el botón "Nuevo audio", tabla con nombre, atajo, duración, reproductor, si el agente lo puede usar, y acciones.
- **Modal de alta:** grabar o subir archivo, nombre, atajo (opcional), descripción (obligatoria, con el texto de ayuda "Escribí cuándo corresponde mandar este audio: esto es lo que lee la IA para decidir"), y un interruptor "El asistente puede usarlo".
- **Estados:** vacío → "Todavía no hay audios. Grabá el primero y tu equipo va a poder mandarlo con un clic." Transcribiendo → la fila muestra "Transcribiendo…".
- **Reglas:** sólo Owner/Admin entran. Un Member que llegue por URL ve el error de permisos que ya existe.

---

## 12. Guías de UI

Sin cambios: se respeta el sistema visual actual de la app. Los textos siguen la voz del producto — español rioplatense, directo, sin jerga. Un error dice qué pasó y qué hacer:

- ✅ "No pudimos transcribir la nota de voz. Probá con Reintentar."
- ❌ "TRANSCRIBE_FAILED: 429"
- ✅ "Instagram no acepta este formato de audio. Grabalo de nuevo desde Safari o mandalo por WhatsApp."
- ❌ "Unsupported media type"

---

## 13. Fuera del alcance de esta fase

### Para etapas futuras

| Funcionalidad | Etapa | Nota |
|---|---|---|
| Transcripción del audio de videos | 3 | El modelo de datos ya lo soporta |
| OCR estructurado de imágenes | 3 | La descripción simple sí entra ahora |
| Text-to-speech | 3 | `audio_assets.source` ya lo contempla |
| Estadísticas de uso de la banca | 3 | Junto con la auto-mejora del agente |
| Que el agente genere imágenes | 3 | El envío saliente con media ya queda hecho |

### Fuera del proyecto completo

| Funcionalidad | Motivo |
|---|---|
| Diarización (separar hablantes) | En DMs habla una sola persona |
| Marcas de tiempo en la transcripción | Los audios son cortos |
| Edición de audio (recortar, filtros) | No es un editor |
| Videollamadas | Otro producto |
| Traducción automática | Los leads escriben en español |

---

## 14. Decisiones transversales

| Decisión | Definición para esta fase |
|---|---|
| Historial y auditoría | Cada escalado, cada acción sobre la banca y cada audio que manda el agente van a `audit_log`. La transcripción no se audita (es derivada) |
| Soft delete | `audio_assets` con `deleted_at`, 30 días, purga por el cron existente |
| Deduplicación de contactos | **No cambia.** La 00104 toca sólo las tres líneas del avatar de `find_or_link_contact` |
| Estados y ciclo de vida | Adjunto: `pending → ready \| failed → none` (purgado). Transcripción: `none → pending → ready \| failed`. Conversación escalada: `needs_human=true → false` (al responder o al marcar "Ya lo vi") |
| Casos borde | Grabación vacía → no se envía, avisa. Se cierra la pestaña grabando → el stream se corta en el cleanup. Dos personas mandan el mismo audio a la vez → dos mensajes, correcto. Transcripción colgada en `pending` → el reaper la libera a los 10 minutos. Doble transcripción → el claim condicional lo evita y no se cobra dos veces |
| Zona horaria e idioma | UTC en la base. Transcripción en español fijo. Toda la UI en español rioplatense |
| Motor de automatización | Sin triggers nuevos. Un trigger "llegó una nota de voz" se evalúa en Etapa 3 |
| Modelo de asignación | El escalado notifica al setter asignado; si no hay, a Owner/Admin |
| Contacto cross-canal | **No cambia.** La foto de perfil se comparte entre canales, con `avatar_source` decidiendo si se pisa |
| BYOK | Groq se suma al catálogo con `capability:"transcription"`. Clave en Vault, probada antes de guardar. Sin clave → el audio se guarda igual y la conversación escala. **Se mantiene el modelo multi-proveedor con claves propias; no se adopta un gateway único todavía** (el porqué y cuándo revisarlo, en §10.2b). La transcripción va detrás de una interfaz para que ese cambio después cueste un `case` |
| Patrón de webhooks | **No cambia:** firma/token, ack inmediato, `after()`, idempotencia con `webhook_events`. La descarga de media va dentro del `after()` que ya existe |
| Broadcasts y rate limiting | Sin cambios. Los broadcasts siguen siendo sólo texto |

---

## 14b. Seguridad

| Área | Definición |
|---|---|
| Autenticación | Sin cambios |
| RLS | `audio_assets`: SELECT para miembros, escritura sólo admins. Storage `chat-media`: SELECT por `is_workspace_member` sobre el primer segmento del path; **sin policies de escritura** (sólo service role). La ruta de descarga usa el cliente **del usuario** para que decida la RLS, nunca service role |
| Validación | Mime real por magic bytes en el servidor, nunca por extensión. Tamaño validado antes de subir y antes de llamar al proveedor de transcripción. El `path` de descarga rechaza `..` y `/` inicial |
| Protección de API | Las tres rutas nuevas (`/api/v1/chat-media`, `/api/v1/messages/[id]/transcribe`, la de subida firmada) verifican sesión. Las Server Actions de la banca usan `getAdminContext()` |
| Datos sensibles | `groq_api_key` en Vault. La transcripción es contenido del lead: **no se loguea**. Las URLs firmadas no se loguean (son credenciales de tiempo limitado) |
| Ataques | La transcripción entra al prompt envuelta en `wrapUntrusted` como cualquier mensaje del lead: un audio que diga "ignorá tus instrucciones" no es distinto de un texto que lo diga. El nombre de archivo se sanea antes de usarlo como path |
| Comunicaciones | HTTPS. Evolution por su dominio público con `apikey`. Groq y OpenAI por HTTPS con Bearer |

### Checklist para la IA constructora

- [ ] RLS habilitado en `audio_assets` con sus cuatro policies
- [ ] Policy de SELECT del bucket `chat-media` acotada por workspace (**no** `bucket_id = 'chat-media'` a secas)
- [ ] Sin policies de escritura en `chat-media`: sólo service role
- [ ] Sesión verificada en las tres rutas nuevas
- [ ] Validación por magic bytes en el servidor
- [ ] `groq_api_key` en Vault, probada antes de guardar
- [ ] Logs sin transcripciones, sin URLs firmadas, sin claves
- [ ] La transcripción envuelta en `wrapUntrusted` antes de llegar al modelo
- [ ] `lib/vault-boundary.test.ts` sigue en verde (ningún Client Component nuevo llega al Vault)

---

## 14c. Base técnica heredada

Fork de ZernFlow. Next.js 16 App Router + React 19 + TypeScript 5 + Tailwind v4 + Vitest 3. 101 migraciones aplicadas; las nuevas van de la **00102**. Después de cada una, `node scripts/build-all-migrations.mjs`, y los tipos de `lib/types/database.ts` se actualizan **a mano** (no se generan solos).

**Lo que ya existe y se reutiliza, no se reescribe:**

| Necesidad | Qué usar | Dónde |
|---|---|---|
| Bajar un archivo y subirlo a un bucket privado | `storeAttachments` | `lib/email/inbound.ts:74-125` |
| Firmar una URL de descarga con la RLS del usuario | la ruta de adjuntos de email | `app/api/v1/email-attachments/route.ts` |
| Subida directa del navegador con validación por magic bytes | el pipeline de contenido | `lib/actions/content-media.ts`, `lib/content/media.ts`, `components/content/media-uploader.tsx` |
| Encolar un trabajo con reintentos | `scheduleJob` + `registerJobHandler` | `lib/scheduler.ts:122`, `lib/jobs/registry.ts` |
| Un job por elemento que llama a IA y registra costo | `index_document` | `lib/knowledge/index-document.ts` |
| Tabla + RLS + CRUD + pantalla de una biblioteca | `response_templates` | `00023:112-239`, `lib/actions/templates.ts`, `settings/templates/*` |
| Picker con `/` en el composer | `TemplatePicker` + `filterTemplates` | `components/inbox/template-picker.tsx`, `lib/templates/search.ts` |
| Sumar una herramienta al agente | `registerAgentTool` + `configFields` | `lib/agent/tools/index.ts`, `types.ts` |
| Envío saliente con rama por proveedor | `sendChannelMessage` | `lib/flow-engine/send.ts` |
| Link externo con el estilo de la app | `getDmLink` | `app/(dashboard)/dashboard/channels/channels-view.tsx:34-58` |

**Lo que se porta de ScaleOS (`wendymardigian-prog/wenos`)** — mismo par de canales, código probado en producción:

| Archivo en ScaleOS | Qué aporta |
|---|---|
| `supabase/functions/_shared/groq-transcribe.ts` | Constantes, mapeo de errores de Groq, parseo de `verbose_json` |
| `supabase/functions/_shared/chat-transcribe.ts` | El núcleo idempotente: claim condicional, `audioExtensionForTranscription` (la extensión reconstruida desde el mime, que evita el 400 clásico), `isTranscribableAudio` |
| `supabase/functions/_shared/chat-media.ts` | `describeWhatsappMessage`: la traducción completa del nodo de Baileys, con los mensajes envueltos, los nodos de protocolo y las encuestas ya resueltos |
| `supabase/functions/_shared/chat-media-download.ts` | El patrón de descarga desde Evolution |
| `src/lib/scaleos/audio-dictation.ts` | Elección de mime, extensión, contador, traducción de errores de micrófono |
| `src/components/admin/scaleos/ChatMediaAttachment.tsx` | El renderer por tipo, completo |
| `src/components/admin/scaleos/ChatAudioTranscript.tsx` | La máquina de cuatro estados de la transcripción |
| `src/components/admin/scaleos/chat-media-format.ts` | `formatBytes`, `formatDuration`, `isCorruptMedia`, `classifyMediaError` |

**Tres cosas que ScaleOS hace y acá NO hay que copiar:**
1. **La policy del bucket abierta a cualquier autenticado.** Acá va acotada por workspace.
2. **El base64 dentro de un JSON para subir.** Acá va subida directa con URL firmada.
3. **Sin reaper de los `pending` colgados.** Acá sí, con `transcript_started_at`.

### Contratos externos — VERIFICADOS el 28/9/2026

Estos eran supuestos. Se verificaron contra el despliegue real y contra el código fuente de la versión exacta que corre, así que el Bloque 5 ya no tiene incógnitas de API.

**Evolution API: versión `2.3.7`** (imagen `evoapicloud/evolution-api:v2.3.7`, proyecto Railway "Evo-Api", dominio público `evolution-api-production-8691c.up.railway.app`, endpoint de red privada `evolution-api`). Verificado leyendo el código fuente del tag `2.3.7`:

| Endpoint | Cuerpo | Notas verificadas |
|---|---|---|
| `POST /message/sendWhatsAppAudio/{instance}` | `{ number, audio, delay?, encoding? }` | `audio` acepta **URL pública, base64 o archivo multipart**. `encoding` es **`true` por defecto** |
| `POST /message/sendMedia/{instance}` | multipart o URL | Existe, para imagen/video/documento |
| `POST /chat/getBase64FromMediaMessage/{instance}` | `{ message, convertToMp4? }` | `message` puede ser el objeto completo **o** sólo `{ key: { id } }` |
| `POST /chat/fetchProfilePictureUrl/{instance}` | `{ number }` | Devuelve `{ wuid, profilePictureUrl }` |

**Dos hallazgos que simplifican el diseño:**

1. **La conversión de audio la hace Evolution, con ffmpeg incluido en su imagen.** Con `encoding: true` (el default), `processAudio` convierte lo que le mandes a `audio/ogg; codecs=opus` y lo envía con `ptt: true`, o sea como nota de voz nativa. El `Dockerfile` de la 2.3.7 instala `ffmpeg` en las dos etapas, y el workspace no tiene `AUDIO_CONVERTER` configurado, así que usa ese ffmpeg local. **Conclusión: para WhatsApp da igual en qué formato grabe el navegador.** No hay que transcodificar de nuestro lado ni restringir el formato.
2. **`getBase64FromMediaMessage` conviene llamarlo con el objeto `message` completo, no con `{key:{id}}`.** Con la clave sola hace una búsqueda en la base de Evolution; con el objeto entero la saltea. Nuestro webhook **ya recibe** ese objeto completo en `data.message`, así que pasarlo entero es gratis y evita depender de la persistencia de Evolution.

**Zernio: se resuelve el hospedaje del archivo con su propio endpoint.** El SDK expone `uploadMediaDirect` (`file: Blob | File`, máximo 25 MB, `contentType` opcional) y devuelve una **URL pública** que Zernio hospeda. Eso elimina la incógnita de si una URL firmada de Supabase serviría como `attachmentUrl`: no hace falta averiguarlo.

> **Decisión:** para Instagram, el audio se sube primero a Zernio con `uploadMediaDirect` y se pasa **esa** URL como `attachmentUrl`. Es el mismo patrón que ya usa `lib/publishing/zernio-media.ts` para publicar contenido, así que hay precedente en el repo.

El contrato de `sendInboxMessage` quedó confirmado en los tipos del SDK: `attachmentUrl` (debe ser públicamente accesible), `attachmentType: 'image' | 'video' | 'audio' | 'file'`, `attachmentName` (sólo WhatsApp, documentos) y `voiceNote` (**sólo WhatsApp**, exige ogg/opus). Como WhatsApp va por Evolution y no por Zernio, `voiceNote` no se usa en este proyecto.

**Lo único que queda sin verificar:** que `whisper-large-v3-turbo` en el plan de Groq contratado admita archivos de 25 MB (la doc menciona hasta 100 MB en tiers superiores). Es un límite, no un contrato: si resulta menor, el mensaje de error ya está contemplado en F6.

---

## 15. Verificación en vivo (después de construir)

Esto necesita cuentas reales y una persona. **No va en los criterios verificables por máquina.**

- [ ] Mandarse una nota de voz desde el WhatsApp propio y verificar que se escucha en la bandeja y se transcribe.
- [ ] Mandarse una nota de voz desde Instagram y lo mismo.
- [ ] Mandar una foto con caption por WhatsApp y verificar que se ven **las dos cosas** (es el bug que se arregla).
- [ ] Apagar la clave de Groq y verificar que la conversación escala en vez de que el agente responda.
- [ ] Verificar que llega la notificación del escalado.
- [ ] Grabar y mandar una nota de voz por WhatsApp desde la bandeja, y escucharla en el celular.
- [ ] Lo mismo por Instagram desde Chrome y desde Safari (el formato cambia).
- [ ] Verificar que la foto de perfil del lead se ve, y que sigue viéndose a los 7 días.
- [ ] Clic en el @ de Instagram y verificar que abre el perfil correcto.
- [ ] Crear un audio en la banca, mandarlo desde el chat, y habilitárselo al agente.

---

## 16. Notas y pendientes

### Divergencia con el alcance

**El alcance vigente (`alcance-v6-ventas.md` y `alcance-etapa1-v3.md`) no contempla nada de esta fase.** El inbox estaba especificado como texto: "burbujas diferenciadas, timestamps, status del mensaje". La media, la transcripción y los audios nunca entraron al alcance de ninguna etapa, y sin embargo hoy son un bloqueo de producción: el agente está respondiendo a ciegas a mensajes que no puede leer.

Te recomiendo actualizar el alcance para que lo refleje. Si querés, lo hago: agrego una sección "Mejoras de Chat" entre la Etapa 2 y la Etapa 3, con lo que entra acá y lo que se difiere.

### Decisiones tomadas en este documento que conviene registrar

1. **Groq como proveedor principal de transcripción, con OpenAI de respaldo.** Suma un proveedor nuevo al catálogo BYOK.
2. **Toda la media entrante se copia a nuestro Storage**, con retención de 180 días configurable.
3. **El agente no responde cuando no puede interpretar el mensaje**, y escala a humano. Es el cambio de comportamiento más grande de la fase.
4. **No transcodificamos audio.** Se acepta la limitación de formato de Instagram y se avisa en la UI.
5. **Sin backfill de media vieja.** Los adjuntos anteriores a esta fase quedan como "ya no disponible".
6. **Se sigue con BYOK multi-proveedor, sin gateway único.** El detalle y los tres disparadores para revisarlo están en §10.2b. La transcripción se construye detrás de una interfaz para que el cambio, cuando llegue, sea barato.

### Candidato para una fase futura

**Chequeo de salud de las claves de IA.** El 28/9 la clave de Anthropic estaba inválida, la card de Integraciones seguía en verde, y el agente y el clasificador fallaron sin que nadie se enterara hasta mirar los logs. Hoy la clave se prueba **al guardarla** pero nunca más. Un cron que la revalide cada tanto y ponga la card en rojo con aviso sería barato y evitaría repetirlo. No entra en esta fase para no inflarla, pero conviene que no se pierda.

### Pendiente de vos antes de construir

- **La clave de Groq** (console.groq.com → API Keys). Sin eso el Bloque 2 se construye igual pero no se puede verificar en vivo.
- **Confirmar la retención de 180 días.** Es el número que propongo; si preferís más o menos, es un default.
- **Un aviso:** la clave de Anthropic del Vault está inválida (lo dice la bitácora del 28/9). Eso también afecta la descripción de imágenes si el workspace no tiene otra con visión. Conviene resolverlo antes del Bloque 2.

---

## Fuentes consultadas

- [Whisper Large v3 Turbo — GroqDocs](https://console.groq.com/docs/model/whisper-large-v3-turbo)
- [Whisper API Pricing 2026: OpenAI vs Groq vs Google — TokenMix](https://tokenmix.ai/blog/whisper-api-pricing)
- [OpenAI Whisper API Pricing 2026](https://diyai.io/ai-tools/speech-to-text/openai-whisper-api-pricing-2026/)
- [GPT-4o Transcribe Model — OpenAI](https://developers.openai.com/api/docs/models/gpt-4o-transcribe)
- [Evolution API v2 — sendWhatsAppAudio](https://doc.evolution-api.com/v2/api-reference/message-controller/send-audio)
- [Zernio — DMs de Instagram, formatos de adjunto](https://docs.zernio.com/platforms/instagram)
- [Zernio — sendInboxMessage](https://docs.zernio.com/messages/send-inbox-message)

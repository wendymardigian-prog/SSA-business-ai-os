# Comunicacion

- Explica todo en lenguaje simple. Si usas un termino tecnico, agrega una explicacion breve entre parentesis.
- Cuando propongas algo, da tu recomendacion y explica por que. No listes opciones sin recomendar.
- Si algo sale mal, explica que paso, por que, y como lo vas a resolver. No tires el error tecnico solo.
- Antes de hacer cambios grandes (migraciones, borrar archivos, tocar auth), explica que vas a hacer y espera confirmacion.
- Usa espanol rioplatense (vos/tenes, no tu/tienes).

# Proyecto

Nombre: Sistema Operativo de Negocio con IA (para agencia de marketing digital)
Descripcion: Sistema operativo centralizado que unifica CRM, inbox multicanal con bot de IA, automatizaciones, contenido, ventas y finanzas en una sola plataforma, para que ningun lead quede sin respuesta y todo viva en una sola fuente de verdad.

Multi-tenancy: **Single-tenant** (un solo negocio, un solo workspace). ZernFlow trae workspaces, se conservan, pero no se construye gestion multi-negocio.

## Etapas
- Etapa 1: Sistema Operativo Base (Fase 1: Foundation, Canales y CRM. Fase 2: Comunicacion y Automatizaciones. Fase 3: Agente IA, Analytics y Pulido)
- Etapa 2: Publicacion de contenido + Metricas + Email bidireccional + Roles custom + Meta Ads (incluye TikTok, YouTube, LinkedIn como publicacion)
- Etapa 3: Agente IA integral + Fathom + Conector MCP
- Etapa 4 (opcional): Agendamiento + Ventas + Pipeline comercial
- Extras independientes: Tareas, Inbox Gmail multicuenta, Form Builder, Browser Automation, Creacion de Video, Analisis de video YouTube, Auto-mejora del agente, Finanzas (comisiones + gastos)

# Base del proyecto

Fork de: ZernFlow (https://github.com/zernio-dev/zernflow, licencia MIT)
Framework: Next.js 16 (App Router) + React 19 + TypeScript 5
Estilos: Tailwind CSS v4 (el codigo real usa v4, NO v3)
Flow builder: @xyflow/react 12
SDK de canales: @zernio/node 0.2.519 (Zernio, ex "Late")
IA: Vercel AI SDK (paquete `ai`) v6, soporta ToolLoopAgent
Data: @supabase/supabase-js 2.95 + @supabase/ssr 0.8
Testing: Vitest 3

Patterns a seguir (mantener consistencia con el fork, no reinventar):
- Auth: Supabase SSR con cookies httpOnly. Trigger `on_auth_user_created` crea el workspace automaticamente.
- State management: Server Components + React hooks. NO Redux, NO Zustand.
- API layer: webhooks en API Routes (`app/api/`), mutaciones de UI en Server Actions.
- Data access: `@supabase/supabase-js` con RLS del lado cliente; Service Role Key solo en server (cron jobs, webhooks).
- Styling: Tailwind v4 utility classes. Sin CSS modules ni styled-components.
- Flow engine: motor recursivo en `lib/flow-engine/engine.ts`, nodos en `lib/flow-engine/nodes/`, abstraccion de plataforma en `lib/flow-engine/platform-adapter.ts`.
- Migraciones en `supabase/migrations/`, numeradas `000NN_nombre.sql`.

NO reescribir (ya existe en ZernFlow, solo verificar/extender):
- Autenticacion con Supabase Auth + trigger de auto-creacion de workspace.
- Sistema de workspaces y team management con invitaciones (expiran en 7 dias, tabla `workspace_invites`).
- Roles Owner / Admin / Member (campo `workspace_members.role`).
- Flow builder visual con @xyflow/react (17 tipos de nodo, motor recursivo profundidad max 50, variable interpolation, flow stack).
- Inbox / bandeja con lista de conversaciones y panel de mensajes.
- CRM con tags, custom fields (6 tipos reales: text, number, boolean, date, url, email — NO existe 'list'), segmentos.
- Secuencias (drip) con auto-pausa cuando el contacto responde.
- Broadcasts (tablas y UI — se conservan, no se usan en Etapa 1).
- Webhook event ledger para idempotencia (tabla `webhook_events`).
- Flow versions (historial al publicar).
- Realtime en `conversations` y `messages`.
- Integracion base con Zernio para Instagram (DMs, comentarios, story replies).

# Stack

- Base de datos: Supabase (PostgreSQL), plan Pro
- Auth: Supabase Auth (email/password) + SSR
- Frontend: Next.js 16 (App Router) + React 19 + TypeScript 5
- Estilos: Tailwind CSS v4
- Hosting: Railway. La app Next.js y Evolution API estan en proyectos separados, asi que se comunican por el dominio publico de Evolution (la red privada de Railway es por proyecto)
- Canal Instagram: Zernio (Late API) — DMs, comentarios, story replies. Usa la 1ª de 2 cuentas free
- Canal WhatsApp: Evolution API (Baileys, por QR) self-hosted en Railway
- Email saliente: Resend (transaccional en Fase 1: invitaciones, notificaciones)
- IA: BYOK multi-proveedor (OpenAI / Anthropic / Google) con Vercel AI SDK
- Secrets: Supabase Vault (AES-256)
- Versionado: GitHub
- Testing: Vitest 3

Nota de canales: TikTok, YouTube y LinkedIn NO van en Etapa 1. TikTok no tiene API de DMs/comentarios (verificado en el SDK `@zernio/node`) — entra recien en Etapa 2 como publicacion de contenido y metricas. La 2ª cuenta free de Zernio se reserva para ese contenido de Etapa 2.

# Comandos

## Desarrollo
- Instalar dependencias: npm install
- Correr en desarrollo: npm run dev
- Build: npm run build
- Tests: npx vitest run
- Lint: npm run lint

## Git y GitHub
- Ver estado: git status
- Crear branch: git checkout -b feature/nombre-descriptivo
- Agregar cambios: git add .
- Commit: git commit -m "descripcion clara de que se hizo"
- Push: git push origin nombre-del-branch
- Pull: git pull origin main
- Ver historial: git log --oneline -20
- Volver atras un archivo: git checkout -- ruta/al/archivo
- Crear tag de version: git tag -a v1.0.0 -m "Fase 1 completada"

## Convenciones de commits
- Formato: tipo: descripcion breve
- Tipos: feat (funcionalidad nueva), fix (correccion de bug), refactor (reorganizar sin cambiar comportamiento), chore (mantenimiento, deps), docs (documentacion), style (formato), test (tests)
- Ejemplos:
  - feat: agregar deteccion cross-canal por telefono y email
  - fix: corregir RLS en tabla contact_notes
  - chore: actualizar .env.example con variables de Resend
- Commit despues de cada funcionalidad completa, no al final del dia. Cada commit deja el proyecto funcional (que compile y corra).

# Reglas de negocio

- Contacto como entidad central. Deduplicacion por telefono o email, nunca solo por nombre.
- Identificacion cross-canal: si el mismo telefono/email aparece por dos canales, se unifica en un contacto, pero cada conversacion se mantiene separada por canal.
- Doble asignacion: cada lead tiene setter (quien contacta) y vendedor/closer (quien cierra). Ambos campos opcionales e independientes.
- Scope de leads (Etapa 1, restriccion dura por RLS): un Member solo ve/edita contactos y conversaciones donde es setter, vendedor o agente asignado. Owner y Admin ven todo.
- Soft delete: nada se borra de verdad, se marca con `deleted_at`. Retencion 30 dias, luego purga por cron.
- Marca "no contactar": detectada automaticamente o manual; pausa secuencias del contacto.
- Snapshot de precio (Etapa 4): al registrar una venta se guarda el precio de ese momento.
- Secuencias: auto-pausa cuando el contacto responde; alerta de colision si hay mas de una activa en el mismo canal.

# Calidad de codigo (template-ready)

- Cada cambio de base de datos va en una migracion SQL separada, numerada secuencialmente, continuando la numeracion de ZernFlow (proximas desde 00017).
- Cada migracion es idempotente: CREATE TABLE IF NOT EXISTS, DO $$ ... END $$ para checks, IF NOT EXISTS en constraints y columnas.
- Mantener .env.example actualizado: cada variable nueva con comentario de que es y donde se obtiene.
- El sistema debe funcionar con base de datos vacia (empty states claros en todas las pantallas).
- No commitear .env con valores reales, solo .env.example.
- Datos de demo van en seeds separados de las migraciones de estructura.
- UUIDs con gen_random_uuid().

# Migraciones

ZernFlow trae 16 archivos de migracion (00001 a 00016) con 23 tablas. La migracion 16 agrega 'whatsapp' al CHECK constraint de `channels.platform`.
La Etapa 1 va de la 00017 a la 00080. La Etapa 2, de la **00081 a la 00090**, y las **correcciones de la Etapa 2 de la 00091 a la 00094**. Cada fase define sus migraciones en su documento de requerimientos: seguir esa numeracion y no saltear numeros.

La banda `00102`-`00109` era de la sesion de multimedia, que corria en
paralelo: ocupo la `00102_chat_media` y la `00103_transcripts_and_needs_human`
(29/9/2026). Despues van la `00110_chat_dashboard_v2` y la
`00111_message_patterns_v2` (28/9/2026, dashboard de Chat y patrones).

La `00104_contact_avatar_refresh` (fotos de perfil que se refrescan, F16) **se
aplico el 1/10/2026** y esta verificada (`verify-crm`, `verify-rls`,
`verify-enrichment`, los tres en verde). Reescribe `find_or_link_contact`
copiando la 00031 letra por letra, cambiando solo las dos lineas del
`avatar_url`; la definicion vieja queda completa en el comentario de cabecera
de la migracion por si hace falta volver atras.

La `00105_response_assets` (banca de recursos unificada, 1/10/2026)
**reescribe por completo** la vieja `00105_audio_assets` (nunca se habia
aplicado) para crear `response_assets`: una sola tabla con `kind` ('text' |
'audio') que reemplaza tanto a la banca de audios del Bloque 6 como a
`response_templates` (Fase 1, 0 filas en produccion). El atajo es unico ENTRE
LOS DOS TIPOS. La `00106_drop_response_templates` elimina `response_templates`
en la misma tanda, abortando con `RAISE EXCEPTION` si encontrara alguna fila
(no las hay) y redefiniendo `purge_soft_deleted` para purgar `response_assets`.
Las dos migraciones **estan escritas, sin aplicar todavia**: se aplican antes
de desplegar el codigo de `feature/banca-recursos-unificada`, primero la
00105 y despues la 00106 (ver el comentario de cabecera de cada una). El
codigo viejo del Bloque 6 (`lib/audio-library/`, `/dashboard/settings/audios`,
el picker `/a`, `listar_audios`/`enviar_audio`) **ya no existe**: la pantalla
unica es `/dashboard/settings/recursos`, el picker de la bandeja es un solo
"/" (`components/inbox/asset-picker.tsx`), y las herramientas del agente son
`listar_recursos`/`usar_recurso` (`lib/agent/tools/assets.ts`). Detalle
completo en `docs/PENDIENTE.md` (seccion "Banca de recursos unificada"). La
proxima migracion disponible es la **00107**.

La `00072_draft_window_alerts`, que arrastraba sin aplicar desde la Fase 3, se
aplico el 28/9/2026: su guarda `draft_alerts_since` hace que solo avise por
borradores creados DESPUES de aplicarla, asi que enchufarla con la cola vacia
—como estaba— es el momento mas seguro, no el mas riesgoso. El cron
`ssa-cron-draft-window-alerts` corre cada 5 minutos.

La `00090_drop_legacy_secret_columns` **si se aplico** (26/9/2026, commit `d988e32`): los secretos de Zernio se movieron a Vault comprobando por huella sha256 que la copia era identica, se vaciaron las columnas, se comprobo que el sistema seguia leyendo, y recien ahi se borraron. Hoy **no queda ninguna clave en columnas de la base**.

Despues de cada migracion: `node scripts/build-all-migrations.mjs`. Antes de aplicar cualquiera, `list_migrations`.

# Etapa 2 (construida)

Lo que se sumo, y donde esta lo importante de cada cosa. El detalle en `docs/`.

## Integraciones y secretos
Todos los secretos viven en **Supabase Vault**, nunca en el `.env` ni en el codigo. De un secreto guardado la pantalla solo sabe que EXISTE: el valor no vuelve del servidor.
- El catalogo de proveedores esta en `lib/integrations/providers.ts`; los nombres de los secretos, en `lib/secret-names.ts`, que **no importa nada** a proposito.
- `lib/vault-boundary.test.ts` recorre los imports reales desde cada Client Component y falla si alguno llega a `lib/vault.ts` o a `lib/supabase/server.ts`. Ya atajo dos fugas; si aparece un modulo nuevo que no puede ir al navegador, sumarlo ahi.
- "Probar y guardar" usa la clave contra el proveedor ANTES de escribirla. Una clave revocada guardada deja la card en verde.
- Doc: `docs/integraciones.md`.

## Contenido y publicacion
Ideas -> piezas -> publicaciones por red. Una pieza puede tener variante por red (otro caption, otra media, otro CTA) y **una fecha por red**.
- Las reglas puras estan en `lib/content/*.ts`, cada una con su test. La UI no decide nada.
- Publicar pasa por `lib/publishing/dispatcher.ts`, el unico lugar donde una fila de `social_posts` pasa a publicada. La guarda contra publicar dos veces es `UPDATE ... WHERE status='scheduled' RETURNING`: publicar dos veces no se deshace.
- Los reintentos los agenda el despachador (1, 5 y 15 minutos), NO la cola. Si lanzara, la cola reintentaria a los 10 segundos encima del reintento propio.
- Cinco publicadores detras de una interfaz comun (`lib/publishing/types.ts`). Sumar una red es un archivo y un registro.
- Docs: `docs/contenido.md`, `docs/publicacion.md`.

## Metricas
Cuatro tablas de solo lectura para la app; las escribe el servidor.
- **Un metric que la red no dio queda en `null` y no se escribe.** Un cero se lee despues como "ese dia no paso nada", que es una afirmacion distinta y falsa. Vale en todo el modulo.
- Los seguidores no se suman: son un total acumulado, y la semana es el ULTIMO dia.
- Frecuencia de recoleccion por antiguedad del post: diaria hasta 30 dias, semanal hasta 90, nunca despues.
- El alcance unico de un periodo NO es la suma de los diarios: se pide en vivo con cache de 15 minutos (`lib/meta/live.ts`).
- Doc: `docs/dashboards.md`.

## Email como canal
El email **no es un modulo aparte**: entra por `channels`, `conversations` y `messages`, con la bandeja adentro de la misma bandeja.
- `channels.late_account_id` sigue siendo NOT NULL: el canal de email guarda ahi `email:<direccion>`. Aflojarlo obligaria a revisar los 40+ lugares que lo leen.
- El receptor **no agenda turnos del agente**, y hay un test con espia que lo prueba. El agente esta hecho para chat.
- Responder arma el hilo con `In-Reply-To` y `References`. Sin eso la respuesta llega como un correo suelto.
- La rama por proveedor en los dos caminos de envio es **explicita**, nunca un `else`: un canal nuevo que caiga por default en Zernio manda el mensaje al lugar equivocado sin avisar.

## Roles personalizados
- El catalogo de claves esta en `lib/auth/permissions.ts`, y es **la fuente**: los permisos de Owner, Admin y Member salen de ahi, no de la base. La fila de un rol de sistema tiene los permisos vacios a proposito.
- `workspace_members.role` NO cambio: sigue siendo owner/admin/member y es lo que leen las policies que ya existian. Un rol personalizado es siempre un `member` con `role_id`.
- `requireWorkspaceAdmin` y `getAdminContext` conservan su comportamiento. Lo nuevo es `requirePermission` y `getPermissionAction`.
- `lib/auth/member-baseline.test.ts` fija lo que puede un Member recorriendo el codigo real. Si se cambia un guard sin querer, ese test lo dice.
- Doc: `docs/roles.md`.

## Scripts de verificacion
Corren contra la base real con usuarios de verdad, crean y limpian sus datos (prefijo `zz-test-`). Una limpieza que falla es una prueba que falla.

```
node scripts/verify-rls.mjs        # policies, scope de leads, Vault
node scripts/verify-roles.mjs      # roles personalizados y alcances
node scripts/verify-content.mjs    # pipeline de contenido y bucket
node scripts/verify-crm.mjs
node scripts/verify-inbox-filters.mjs
node scripts/verify-dashboards.mjs
node scripts/verify-publishing.mjs # publicar de punta a punta, proveedores simulados
```

No correr dos en simultaneo: comparten el prefijo `zz-test-` y se pisan la limpieza.

## Correcciones de la Etapa 2

La Etapa 2 quedo con la estructura entera y **sin publicar nada**. Lo que se
arreglo esta en `docs/correcciones-etapa2.md` y el avance en
`docs/etapa2/PROGRESS-correcciones.md`. Cuatro cosas que conviene tener presentes
porque no se ven mirando el codigo:

- **Instagram y TikTok se programan del lado de Zernio**, no con nuestra cola:
  se le pasa `scheduledFor` + `timezone` y publica el. Un post de Zernio POR
  RED. El despachador propio queda para YouTube, LinkedIn y Threads.
  Desprogramar borra el post ALLA antes de cancelar aca: si quedara agendado,
  Zernio lo publica igual.
- **El SDK de Zernio LANZA en vez de devolver `{ error }`**, y su clase expone
  `.statusCode`, no `.status`. Su README ademas esta desactualizado respecto de
  sus propios tipos. Los errores se clasifican en `lib/publishing/zernio-errors.ts`.
- **En un archivo `"use server"` todo lo exportado tiene que ser una funcion
  asincronica.** Un `export type { ... }` rompe la app entera en tiempo de
  ejecucion y ni el typecheck ni el build lo ven. Hay un test que lo atrapa en
  `lib/vault-boundary.test.ts`.
- **No usar `upsert` sobre `social_posts`**: su indice unico es parcial y
  PostgREST no le puede apuntar un `on_conflict`. Es buscar-y-escribir.

El **copywriter** es un agente propio (uno por workspace) que reemplaza la
generacion simple de F29: ver `docs/agente-ia.md`.

# Etapa 4 (construida)

Agendamiento completo: del link publico a la reunion en Google Calendar, con
sus automatizaciones y la habilidad del agente. El detalle en
[docs/agendamiento.md](docs/agendamiento.md).

## Lo que no se puede romper

- **Los horarios salen de una sola funcion** (`getPublicSlots`). La pagina
  publica, el agendar a mano y el agente la llaman. Si alguno usara otra,
  podria ofrecer un horario que los demas no muestran.
- **El servidor nunca confia en el horario del cliente**: antes de crear, se
  vuelve a preguntar con Google sin cache.
- **La doble reserva la evita la base**, con una restriccion de exclusion por
  anfitrion y rango. `scripts/verify-booking-concurrency.mjs` lo prueba con
  diez pedidos a la vez.
- **UTC en la base; las reglas de disponibilidad son hora de pared + zona
  IANA.** "Martes de 9 a 17 en Costa Rica" sigue siendo de 9 a 17 cuando
  cambia el horario de verano.
- **Cancelar es definitivo.** No hay vuelta a activa.
- **La categoria queda congelada** en cada reunion (`category_snapshot`):
  renombrar un area no cambia el significado de los informes viejos.
- **El codigo publico de una reunion (22 caracteres) es una credencial**: con
  el se cancela sin sesion. Nunca se le pasa al agente ni se muestra de mas.

## Google Calendar

La conexion es **por persona**, no por negocio, y por eso `oauth_connections`
tiene dos unicos parciales. El token se renueva a demanda (no con el cron
semanal de la Etapa 2) y un `invalid_grant` avisa a la PERSONA. La invitacion
la manda Google (`sendUpdates=all`). Los reintentos de sincronizacion los
agenda el handler (1, 5 y 15 minutos), NO la cola.

## Automatizaciones

Nueve tipos de trigger, seis por evento y tres relativos a la hora de la
reunion. Los relativos se AGENDAN (`syncRelativeJobs`) y su clave lleva el
numero de reagendas, asi mover una reunion vuelve a habilitar el recordatorio.
El cron de `automation_events` enruta por el registro: sumar un tipo es
declararlo con sus `eventTypes` y una migracion, sin tocar el cron.

`flow_sessions.channel_id` admite null desde la 00100: un lead que agenda
desde la pagina publica no tiene conversacion.

## El embed

`public/embed/embed.js` **se commitea**: en Railway el build corre sin
dependencias de desarrollo y esbuild no esta. `npm run build` lo regenera
cuando puede. Un test cuida que este y que no pase de 60 KB (un import mal
puesto lo habia dejado en 488).

## Scripts de verificacion

```
node scripts/verify-scheduling.mjs            # RLS, unicos, la RPC y la purga
node scripts/verify-booking-concurrency.mjs   # diez pedidos a la vez, una reunion
```

Valen las mismas reglas que los de la Etapa 2: crean y limpian sus datos
(prefijo `zz-test-`), y no se corren dos en simultaneo.

# Mejoras de Chat (Bloques 1-6)

Lo que arregla, en una frase: hasta ahora un lead mandaba una nota de voz y el
agente le contestaba igual, sin haberla escuchado.

Bloques 1-3 (adjuntos, transcripcion, que el agente entienda o se calle) en
`main` desde el 29/9/2026. Bloques 0 (arreglos sobre produccion), 4 (fotos de
perfil y el @ de Instagram clickeable) y 5 (grabar y mandar audio por el chat)
en `main` desde el 1/10/2026, con sus migraciones aplicadas. El Bloque 6
(banca de audios) se rediseño el mismo dia como parte de la banca de recursos
unificada (texto + audio, rama `feature/banca-recursos-unificada`): ver la
seccion "Migraciones" mas arriba y `docs/PENDIENTE.md`.

## Los adjuntos tienen UN solo contrato
`messages.attachments` es jsonb libre y cada origen escribia una forma distinta.
Ahora se guarda `{ v: 2, items: ChatAttachment[] }`, y `parseAttachments`
(`lib/messages/attachments.ts`) entiende ademas los cuatro formatos viejos: el de
email, el array de Zernio, el nodo de Baileys y el que registra un flow.
**No hay backfill ni fecha de corte**, y las etiquetas de tipo ("🎤 Nota de voz")
salen solo de ahi. Es un modulo PURO: lo importan los webhooks y la burbuja.

## La media se copia a nuestro Storage
Bucket privado `chat-media`, con la regla de siempre: el **primer segmento del
path es el workspace** y es lo unico que lee la policy. **Sin policies de
escritura**: sube el service role. La descarga (`/api/v1/chat-media`) firma al
hacer clic con el cliente del USUARIO, nunca al pintar el hilo.

- La descarga va en el `after()` del webhook y **no en la cola**: la URL de Meta
  vence y WhatsApp borra la media de su servidor.
- WhatsApp manda la media cifrada: hay que pedirsela a Evolution por el id del
  mensaje (`getBase64FromMediaMessage`, con `convertToMp4: false`, o un audio
  convertido pierde el `ptt`).
- Lo que no tiene archivo (ubicacion, contacto, encuesta, link) **no se intenta
  bajar**: si no, el spinner queda girando para siempre.
- Retencion de 180 dias colgada del cron `content-media-cleanup`, que ya existe.
  **La transcripcion nunca se borra.**

## El agente entiende, o se calla
- El historial usa `effectiveMessageText`: texto, o transcripcion, o descripcion
  de la imagen, **marcado** y envuelto en `wrapUntrusted`. Con caption gana el
  caption. Lo que no tiene nada interpretable sigue afuera.
- **La compuerta vive en el runner** (`lib/agent/runner.ts`, al inicio de
  `continueTurn`) y no en `dispatch.ts`: el dispatch corre en el webhook, cuando
  la transcripcion ni empezo. Es el unico punto por el que pasan los tres modos.
  Va **antes de los guardarrailes**, porque `burstText` los alimentaba con texto
  vacio y ninguno frenaba una rafaga que era solo un audio.
- Tres salidas: responde, reagenda (hasta 90 s), o `needs_human` con el motivo,
  el agente apagado ahi, la entrada en `audit_log` y el aviso en la campana. **Ante
  la duda, escala.** Apagable con `workspaces.agent_escalate_on_unreadable`.
- `lib/agent/runner-unreadable.test.ts` es el test que prueba el arreglo.

## La transcripcion
- `lib/ai/transcribe.ts` es la **unica puerta**: nadie mas sabe quien transcribe,
  y un test de frontera lo hace cumplir. Sumar un proveedor es un `case` y una
  fila en el catalogo.
- Se intenta **en el momento** (en el `after()`) y la cola es el respaldo: el
  agente tiene 90 s y el cron corre cada minuto.
- El **claim condicional** (`none|failed -> pending`) evita transcribir y cobrar
  dos veces. Un fallo transitorio vuelve a `failed`, no queda en `pending`.
- El **reaper** corre tambien en el cron de jobs: si nadie encola un job, el
  handler nunca corre y la fila quedaria colgada.
- El nombre del archivo se reconstruye **desde el mime**: WhatsApp manda nombres
  inventados y el proveedor devuelve 400 si la extension no coincide.
- Se cobra **por hora de audio**, no por tokens: `model_pricing.audio_per_hour` y
  `agent_runs.audio_seconds`, con su seed (`supabase/seeds/01_transcription_pricing.sql`).

## La bandeja
Las decisiones de que pintar viven en `lib/inbox/media-render.ts` y
`lib/inbox/transcript-state.ts`, puras y testeadas; los componentes solo las
componen. El hilo de Instagram **se sigue leyendo en vivo de Zernio** y se cruza
con nuestra tabla por `platform_message_id`.

**Ojo con dos cosas de CSS** que se midieron y costaron un arreglo: `min-width`
le gana a `max-width` (un minimo fijo desborda la burbuja), y el `dark:` de
Tailwind en este proyecto compila a `prefers-color-scheme`, mientras que el tema
lo maneja la clase `.dark` del `<html>`. Son dos señales distintas.

## Migraciones de los Bloques 1-3
`00102` (bucket y columnas de media) y `00103` (transcripcion, escalado, el CHECK
de `agent_runs.source` y las columnas de costo por audio). **Aplicadas y
verificadas** el 29/9/2026, junto con el seed de precios de transcripcion
(`supabase/seeds/01_transcription_pricing.sql`).

Ojo con el orden el dia que se clone el sistema: la app **no funciona contra una
base sin estas dos**, porque el historial del agente lee `transcript` y la bandeja
filtra por `needs_human`. Se aplican antes de desplegar.

El plano completo esta en
[docs/requerimientos-chat-multimedia.md](docs/requerimientos-chat-multimedia.md).

## Bloque 0 — Arreglos sobre produccion (FA1-FA7)
Siete bugs encontrados mirando la bandeja real, todos en modulos puros ya
existentes, sin migracion propia:

- **Reels y publicaciones compartidas de Instagram** se reconocen por
  `originalType` (con la URL de `instagram.com` como cinturon de seguridad) y
  se pintan como tarjeta con link, nunca como video roto.
- **El agente lee el titulo de un reel compartido** (`[Reel compartido]
  "titulo"`) en vez de escalar siempre por no poder interpretarlo.
- **Adjuntos viejos que quedaban en `pending` para siempre** (formato Zernio o
  Baileys sin mensaje nuevo) pasan a `none`: se corta el spinner eterno.
- **Un 429 del proveedor de transcripcion ya no quema el turno**: si hay un
  reintento en cola (`scheduled_jobs`), el agente espera en vez de escalar.
- **Los 90 segundos de espera por una transcripcion cuentan desde que el turno
  empieza a esperar** (`media_wait_started_at`), no desde que llego el
  mensaje: un mensaje nuevo en la misma rafaga reinicia el reloj.
- **Flows y secuencias usan la misma compuerta de interpretabilidad** que el
  chat: no generan un mensaje de "no te entendi" por un audio o imagen sin
  describir todavia.
- **Stickers y GIFs no escalan ni gastan una llamada de vision**: se leen como
  `[Sticker]`/`[GIF]`, no como "no pude entenderlo".

## Bloque 4 — Identidad visible (F16-F17)
- **La foto de perfil se refresca sola** cuando viene de Instagram/WhatsApp
  (`avatar_source = 'external'`): la 00104 reescribe `find_or_link_contact`
  para eso. Una foto subida a mano (`manual`) o ya copiada a nuestro Storage
  (`storage`, se refresca cada 30 dias desde TypeScript) nunca se pisa. Ver
  `lib/contacts/avatar.ts`.
- **El @ de Instagram es un link clickeable** en el panel, el detalle del
  contacto y "Canales vinculados" (`lib/contacts/links.ts`), en vez de un
  telefono crudo.

## Bloque 5 — Grabar y mandar audio por el chat (F18-F19)
- **Un solo camino de envio con media**: `sendChannelMessage`
  (`lib/flow-engine/send.ts`) ramifica por proveedor (Evolution/Zernio),
  nunca un `else`. Arreglo de un bug real: Evolution descartaba `mediaUrl`
  en silencio.
- **Grabador en el composer** (`components/inbox/voice-recorder.tsx`) y clip
  para adjuntar del disco, con validacion por magic bytes (nunca por
  extension declarada) y el tope de 16 MB del bucket `chat-media`.
- Instagram rechaza audio ogg/opus/webm/mp3 **antes de subir nada**
  (`instagramAcceptsAudio`); WhatsApp/Evolution convierte cualquier formato.

## Bloque 6 — Banca de recursos unificada (texto + audio)
Lo que antes eran dos cosas (las respuestas rapidas de texto, Fase 1, y la
banca de audios del Bloque 6) se unificaron en una sola: una tabla
`response_assets` con `kind` ('text' | 'audio'), una pantalla
(`/dashboard/settings/recursos`), un buscador en la bandeja (`/`, se elimino
el prefijo `/a`) y una herramienta del agente (`listar_recursos`/`usar_recurso`,
`lib/agent/tools/assets.ts`). Rama `feature/banca-recursos-unificada`
(1/10/2026), sobre `oneshot-chat-media-b`.

**Por que se hizo ahora y no antes de construir el Bloque 6**: `response_templates`
tenia 0 filas en produccion y la vieja `audio_assets` nunca se habia aplicado,
asi que unificar no migraba ni un dato. El atajo (`/precio`) es unico ENTRE
LOS DOS TIPOS: un texto y un audio no pueden compartir uno, cosa que con dos
tablas separadas ningun indice podia garantizar.

**Lo que se arreglo de paso** (bugs del Bloque 6 que la fusion dejo a la
vista):
- El agente mandaba un audio pasando el path de la BIBLIOTECA directo a
  `sendChannelMessage`. El barrido de retencion del chat (180 dias,
  `lib/chat-media/cleanup.ts`) se lo llevaba del bucket a los 180 dias de ese
  mensaje — no un archivo huerfano: el recurso entero, para todos los envios
  futuros. Ahora `lib/response-assets/send-copy.ts` (`copyAssetToChat`) copia
  el archivo a la conversacion ANTES de mandar, server-side, en los dos
  caminos (el picker de la bandeja y el agente, `lib/agent/send-asset.ts`).
- Un audio enviado por email quedaba posible de ofrecer (`sendViaResendChannel`
  ignora `message.media` en silencio): `lib/channels/media.ts`
  (`channelAcceptsMedia`) es el unico lugar que decide si un canal acepta
  media, y lo consultan el picker, la API de envio manual y el agente.
- Borrar o reemplazar un audio no borraba su archivo del bucket. Ahora
  `deleteAsset`/`updateAsset` (`lib/actions/response-assets.ts`) lo borran en
  el momento, y `lib/response-assets/cleanup.ts` (colgado del cron
  `content-media-cleanup`) es la red de seguridad a los 28 dias.

**`usar_recurso` con un texto no manda un mensaje aparte**: devuelve el
contenido ya interpolado (con el contacto y el workspace reales) para que el
modelo lo use como su propia respuesta — mandarlo tambien como mensaje
separado seria mandar dos. Con un audio sigue el camino de siempre: memo del
turno, maximo uno por respuesta, `defersInDraftAsync` para el modo borrador
(se quedo, la necesita solo la rama de audio).

**Test de frontera** (`lib/response-assets/table-boundary.test.ts`, mismo
patron que `lib/ai/transcribe-boundary.test.ts`): falla si `audio_assets` o
`response_templates` aparecen en el codigo de aplicacion (`lib`, `app`,
`components`, `scripts`) fuera de comentarios historicos sin el nombre
literal. Las migraciones SQL quedan exentas: tienen derecho a nombrar una
tabla vieja.

Detalle completo en `docs/PENDIENTE.md` (seccion "Banca de recursos
unificada").

# Seguridad

## Autenticacion y sesiones
- Supabase Auth con email/password. Sesiones por Supabase SSR con cookies httpOnly (access token 1h, refresh 7d).
- Rate limiting de login por defecto de Supabase. Recuperacion de contrasena con token de tiempo limitado.

## Row Level Security (RLS) — obligatorio
- TODAS las tablas tienen RLS habilitado. Aislamiento por workspace_id (funcion helper `is_workspace_member`).
- En Etapa 1 se agrega scope de leads: en `contacts` y `conversations`, un Member solo ve filas donde es setter/vendedor/asignado; Owner/Admin ven todo. Usar una funcion helper (ej: `can_see_contact`) reutilizable en las policies.
- Politicas explicitas para SELECT, INSERT, UPDATE, DELETE en cada tabla. El scope se evalua en la base, no solo en la UI.

## Validacion y datos sensibles
- Validacion en cliente Y en servidor. Sanitizar inputs (XSS, SQL injection).
- API keys de terceros en Supabase Vault (AES-256), nunca en env vars del frontend ni en codigo.
- **Las keys de IA se prueban contra el proveedor ANTES de guardarlas** (`lib/integrations/ai-key-check.ts`): listar modelos es gratis y devuelve 401 con una key mala. Un 401/403 no se guarda; un 429/5xx si, porque no dice nada sobre la key. De paso se guarda en `integration_configs.config.models` la lista de modelos que ve esa cuenta, y el selector del agente la suma al catalogo.
- Service Role Key solo en server-side.
- Logs sin tokens, contrasenas, API keys ni PII.
- .env nunca se commitea. Solo .env.example con placeholders.

## Webhooks entrantes
- Un solo receptor por canal, y los dos viven en la app (`app/api/webhooks/`), nunca en una Edge Function: el motor de flows, las secuencias y el agente de IA corren en Node y desde Deno no se pueden llamar.
  - `app/api/webhooks/late` -> Zernio (Instagram): valida firma HMAC. Sin secreto configurado, rechaza.
  - `app/api/webhooks/evolution` -> Evolution API (WhatsApp): valida el header `x-webhook-token` en tiempo constante. La URL es publica, asi que el token no es opcional.
- Lo que hacen los dos igual despues de entender el payload vive en `lib/inbound.ts`. Lo que tiene que valer para todos los canales vive en la base: `find_or_link_contact` (dedup) y `apply_opt_out_check` (no contactar).
- Ack inmediato (responder 200 antes de procesar, con `after()`). Procesamiento async. Idempotencia con `webhook_events`.
- **Los mensajes entrantes de todos los canales se guardan en `messages`** (Fase 3). Para Instagram es dual-write: se guarda en paralelo y la bandeja sigue leyendo el hilo de Zernio. Guardar nunca puede hacer fallar un webhook: si el insert falla, se loguea y la recepcion sigue. Se puede apagar desde Ajustes (`workspaces.persist_zernio_inbound`), sin deploy. Todo el detalle —los dos ids del mensaje, la retencion de 12 meses, el backfill y sus limites— en [docs/flujo-de-mensajes.md](docs/flujo-de-mensajes.md).
- La URL que se registra en cada proveedor la arma `lib/webhook-url.ts` desde `NEXT_PUBLIC_APP_URL`, y se niega a registrar una direccion local: un webhook apuntando a localhost no falla, simplemente no entra nada.
- **Agente de IA** (Fase 3): despues de guardar el mensaje y de las automatizaciones, los dos receptores llaman a `maybeScheduleAgentTurn` (`lib/agent/dispatch.ts`), el unico lugar que agenda un turno. La automatizacion tiene prioridad; el turno corre en `/api/cron/agent-bursts` (cada 15 s). Toda llamada a IA del sistema pasa por `openAiRun` (`lib/ai/run.ts`), que registra el run y congela el costo. Nunca `select("*")` sobre `agents` o `agent_runs` con el cliente de un usuario (privilegio de columna en los costos): usar `lib/agent/public.ts`; toda columna nueva de `agents` que lea la pantalla va al GRANT de la 00060. El interruptor por conversacion tiene **tres estados** (`agent_enabled` NULL = heredar del canal, el default): el estado efectivo se calcula solo en `resolveAgentState`. Las acciones del agente (herramientas y clasificacion al cierre) pasan por `lib/agent/tools/effects.ts` y quedan en `audit_log` con `performed_by_agent_id`; la pestaña Acciones y la reversion se arman sobre eso, sin tabla nueva. Detalle en [docs/agente-ia.md](docs/agente-ia.md).

## Checklist de seguridad (verificar en cada bloque)
- [ ] RLS habilitado en todas las tablas nuevas
- [ ] Politicas RLS escritas y testeadas (incluido el scope de leads)
- [ ] JWT verificado en todas las API Routes nuevas
- [ ] Validacion de inputs en servidor
- [ ] Secrets en Vault o env vars, no en codigo
- [ ] Logs sin datos sensibles
- [ ] Webhooks con firma validada (Zernio) e idempotencia

# Buenas practicas de desarrollo

## Estructura de codigo
- Seguir la estructura existente del fork. No inventar carpetas nuevas si ya hay una que sirve.
- Logica de negocio en Server Actions o lib/, no en componentes de UI.
- Un archivo por responsabilidad.

## Error handling
- Siempre manejar errores. Nunca un catch vacio.
- Mensajes de error claros al usuario (toast con accion sugerida). Loguear en servidor sin datos sensibles.
- Reintentos automaticos para operaciones de red (max 3, con backoff).

## Performance
- Server Components por defecto. Client Components solo donde se necesita interactividad.
- Paginacion en todas las listas. Indices en columnas de filtro/orden/busqueda.

## Testing y accesibilidad
- Tests para logica de negocio critica, sin depender de servicios externos (mockear APIs).
- Labels en inputs, contraste WCAG AA, navegacion por teclado, alt en imagenes.

# Estructura del proyecto

El proyecto se divide en etapas. Cada etapa en fases de 1-2 semanas. Cada fase en bloques de ejecucion (1 bloque = 1 sesion de Claude Code).
El documento de requerimientos de cada fase es el "plano" que define exactamente que construir. Siempre se adjunta como archivo en el primer prompt de cada bloque.

# Diseno para el futuro

El modelo de datos y la arquitectura se disenan pensando en todas las etapas, aunque se construya una fase a la vez:
- Campos preparados para etapas futuras se agregan desde ahora aunque queden vacios (ej: `ai_conversation_summary`, `next_followup_date`, atribucion, campos de venta/pago).
- Arquitectura extensible: el flow builder tiene registro de nodos/triggers para que modulos nuevos (ventas, agendamiento) sumen sus triggers/acciones sin tocar el core. El agente IA usa tool registry para sumar herramientas por etapa.
- La tabla `channels` abstrae la fuente de conexion (Zernio vs API directa) para que el inbox unificado no dependa de como se conecto cada canal.
- La tabla `integration_configs` es generica y extensible (canales, IA, email) — sumar un proveedor es un registro, no una tabla nueva.

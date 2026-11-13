# Como se trabaja aca (obligatorio)

Quien usa este proyecto puede no ser tecnico. **Antes de modificar archivos, la base de datos o la configuracion, hace falta un plan aprobado**: primero preguntas (una sola ronda, con tu recomendacion), despues un plan en dos partes (un resumen para la persona en lenguaje simple y el plan para Claude, con modelo y esfuerzo recomendados) y recien con el si se ejecuta, de corrido y sin interrumpir. Las preguntas y explicaciones se contestan directo. Cada pedido nuevo vuelve a empezar en modo plan. El protocolo completo, con la tabla de modelos, cuando SI frenar y la definicion de terminado, esta en `.claude/rules/00-protocolo-de-trabajo.md`; la plantilla del plan y los casos borde, en `/planificar`.

# Comunicacion

- Explica todo en lenguaje simple. Si usas un termino tecnico, agrega una explicacion breve entre parentesis.
- Cuando propongas algo, da tu recomendacion y explica por que. No listes opciones sin recomendar.
- Si algo sale mal, explica que paso, por que, y como lo vas a resolver. No tires el error tecnico solo.
- Antes de hacer cambios grandes (migraciones, borrar archivos, tocar auth), explica que vas a hacer y espera confirmacion.
- Usa espanol rioplatense (vos/tenes, no tu/tienes).

# Proyecto

Nombre: Sistema Operativo de Negocio con IA (para agencia de marketing digital)
Descripcion: Sistema operativo centralizado que unifica CRM, inbox multicanal con bot de IA, automatizaciones, contenido, ventas y finanzas en una sola plataforma, para que ningun lead quede sin respuesta y todo viva en una sola fuente de verdad.

Multi-tenancy: **una copia por cliente**. Desde el 25/10/2026 una instalacion puede tener **varios negocios del MISMO dueño** (por ejemplo dos marcas propias), cada uno un workspace con sus claves, canales, equipo y marca, y se cambia con el selector. No hay pantalla para crear workspaces: `scripts/create-workspace.mjs`. Guia y reglas en [docs/sumar-un-negocio.md](docs/sumar-un-negocio.md).

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
- Auth: Supabase SSR con cookies (NO son httpOnly: el cliente del navegador las lee; por eso un XSS se lleva la sesion). Trigger `on_auth_user_created` crea el workspace solo a la primera cuenta o a una creada por el servidor con `app_metadata.ssa_create_workspace` (00309).
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
- Broadcasts (tablas y UI del fork; desde el 3/11/2026 rehechos con canal, filtros de Contactos y cola de envíos: ver "Broadcasts y la cola de envíos").
- Webhook event ledger para idempotencia (tabla `webhook_events`).
- Flow versions (historial al publicar).
- Realtime en `conversations` (`messages` salio de la publicacion en la 00327: nadie la escuchaba; ver "Los cron y su guarda").
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

## White label

El sistema se duplica por cliente: cada clon es su propia copia, con su propia base.

- Marca por variables de entorno, nunca en el codigo: `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO_URL`, `NEXT_PUBLIC_BRAND_COLOR` (ver `lib/brand.ts`). Sin configurar, el sistema muestra un nombre generico. Es la marca de la INSTALACION (login, icono, sitio publico) y el respaldo de cada negocio: desde la 00266 cada workspace puede tener la suya (`workspaces.brand_*`, Ajustes → General → Marca) y todo lo que ve un lead y el panel usan `resolveBrand(workspace)`.
- **Legibilidad del color de marca (2/11/2026)**: lo que va ENCIMA del color (texto de botones, la inicial del monograma) sale de `readableTextOn` (claro u oscuro, el de mas contraste WCAG); `brandColorCss` pisa tambien `--primary-foreground`, asi que un color clarito nunca deja botones con letras blancas. El color usado COMO texto sobre blanco (links de un email) pasa por `readableInkOnWhite`. Los emails del sistema (invitacion, avisos al equipo, copia del contrato) usan el marco `brandedEmailHtml` (`lib/email/templates.ts`) con el logo o la inicial, la franja y el boton del negocio; los emails que arma una persona en un flujo NO se envuelven. La pagina `/invite/<id>` toma la marca del negocio que invita. **En el panel, el color de marca como LETRA es `text-primary-ink` y como BORDE o anillo es `border-primary-edge` / `ring-primary-edge`** (`brandInkColors`: 4,5 y 3 de contraste, uno por tema; sin marca valen lo mismo que `--primary`). `text-primary` / `border-primary` a secas solo cuando hace falta el color exacto: con un color clarito, una letra `text-primary` sobre blanco no se lee.
- Como habla el agente en espanol: `AI_LANGUAGE_STYLE` (ver `lib/ai/language-style.ts`). Sin configurar, "espanol neutro, directo y sin relleno". Un negocio con `workspaces.ai_language_style` usa el suyo (`aiLanguageStyle(propio)`; las tareas de IA lo reciben con `loadTaskInstructionsForRun`).
- Alta solo por invitacion: no hay registro publico. `scripts/create-owner.mjs` crea el primer Owner de un clon nuevo (cuenta + workspace + zona horaria del negocio).
- Zona horaria por USUARIO, no por workspace: se detecta del navegador en el primer ingreso y se guarda en `user_preferences` (00121); editable desde el menu de perfil. `workspaces.timezone` sigue existiendo aparte, para las reglas que no pueden depender de quien mira (horario de atencion del agente, topes de gasto, hora de las tareas programadas) — ver `lib/dates.ts` y `lib/user-timezone.ts`.
- Cada clon necesita `app_url` y `cron_secret` propios en Supabase Vault (`system:app_url` / `system:cron_secret`, desde la 00139): `select private.set_system_secret('cron_secret', '...')`, el mismo valor que `CRON_SECRET` en Railway. `private.system_secrets_status()` dice si estan cargados y cuantos cron dieron 200/401, sin mostrar el secreto. Detalle en el comentario de `CRON_SECRET` en `.env.example`.
- **Dominios (3/11/2026)**: el principal es `NEXT_PUBLIC_APP_URL` (`appUrl()`, la UNICA que lee la variable) y lo usan el equipo y los proveedores; los links que ve un lead salen de `publicBaseUrl(workspace)` (`lib/public-url.ts`): el dominio del negocio (`workspaces.scheduling_public_base_url`, Ajustes → General → «Dominio de tus links», se comprueba antes de guardar) o el principal. Nunca el host del pedido. El dominio de Railway redirige al principal salvo `/api/`, `/auth/`, `/embed/`, `?embed=1` y lo que no es GET. `lib/public-url.test.ts` falla si alguien lee la variable en otro lado o arma un link con `window.location.origin`. Checklist para pasar un clon a su dominio en [docs/dominios.md](docs/dominios.md).
- `scripts/export-template.mjs` corta una copia limpia del repo (sin docs internos, sin `.env`, con su propio `git init`) como punto de partida para un cliente nuevo.
- **Migraciones consolidadas en la plantilla de clientes (12/11/2026)**: a la copia de un cliente no le viajan las ~360 migraciones sino una foto de la base hasta la `00363` (24 archivos por área, `plantilla-clientes/supabase/migrations`, congelada) más las posteriores, tal cual; el proyecto sigue con todas las suyas. La genera `scripts/plantilla/generate-migrations.mjs --perfil=clientes` y la verifica `scripts/verify-template-schema.mjs --perfil=clientes` (0 diferencias contra las 360). **En la copia de un cliente que instaló antes, después de traer esa actualización y ANTES de `supabase db push`**: `node scripts/migraciones-compactadas.mjs` (mira y explica) y, con su OK, `--aplicar` (solo cambia el historial de migraciones, nunca una tabla). Detalle en docs/plantilla-clientes.md.
- `/setup` (`.claude/commands/setup.md`) guia en Claude Code el arranque obligatorio de un clon nuevo: Supabase y migraciones, Railway y variables, los secretos del cron, las URLs de Auth y el `.env` local. Nunca pide claves por chat.
- **Guias de conexiones (12/11/2026)**: `guias/conexiones.md` (viaja a cada clon; `docs/` no) explica Google, WhatsApp, Instagram, Resend, IA, render y el cambio de dominio, con datos de ejemplo. `/conectar` (`.claude/commands/conectar.md`) la arma con las direcciones de la instalacion en `Claude outputs/` y acompaña cada conexion. `lib/integrations/connection-guide.test.ts` falla si cambian los permisos o las rutas de retorno de Google y la guia no. Si cambia una pantalla o un campo de una tarjeta que la guia nombra, se actualiza la guia en el mismo cambio.

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
- Scope de leads (Etapa 1, restriccion dura por RLS): un Member solo ve/edita contactos y conversaciones donde es setter, vendedor o agente asignado. Owner y Admin ven todo. **Desde la 00136 el alcance sale del ROL** (no de interruptores del workspace): `own` (lo asignado), `own_unassigned` (lo asignado + lo que no tiene a nadie) o `all`; el Member de sistema es `own`.
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
Las dos **estan aplicadas** (comprobado el 6/10/2026, solo lectura:
`response_assets` existe y `response_templates` y `audio_assets` ya no). El
codigo viejo del Bloque 6 (`lib/audio-library/`, `/dashboard/settings/audios`,
el picker `/a`, `listar_audios`/`enviar_audio`) **ya no existe**: la pantalla
unica es `/dashboard/settings/recursos`, el picker de la bandeja es un solo
"/" (`components/inbox/asset-picker.tsx`), y las herramientas del agente son
`listar_recursos`/`usar_recurso` (`lib/agent/tools/assets.ts`). Detalle
completo en `docs/PENDIENTE.md` (seccion "Banca de recursos unificada").

La `00112_ai_spend_by_day` (gasto de IA por dia) esta aplicada. **Las `00107` a
`00109` quedaron sin usar** (eran de la banda de multimedia): no reutilizarlas.

**Contenido v3 (octubre 2026).** `00113` a `00118` estan **aplicadas** (con la
CLI de Supabase; de la `00114` a la `00117` se ensayaron antes en una
transaccion que se deshace sola) y verificadas: `00113` (comentarios con
publicacion y perfil), `00114` (`contact_touches`), `00115` (atribucion v2,
`create_booking` con el toque y backfill de 647 contactos solo donde la
atribucion estaba vacia), `00116` (pilares, ofertas, clasificacion y
`approve_content_idea_v2`), `00117` (texto unico) y `00118`, la unica que
borra: `hook`, `angle`, `notes`, `pillar` (texto) y `copy`, y la
`approve_content_idea` vieja. La `00118` se aplico el 6/10/2026, DESPUES de
comprobar que el codigo nuevo ya estaba en produccion y que las dos consultas
de su cabecera daban 0. **Todas estan registradas en el historial de Supabase**
(`supabase_migrations.schema_migrations`, versiones `20261006173244` a
`...49`: son la fecha del registro, no la de aplicacion).

**White label (7/10/2026).** `00119` a `00124` estan **aplicadas**: invitacion
sin workspace previo, cron jobs renombrados, `user_preferences` (zona horaria
por usuario), default de `workspaces.timezone` a UTC, el trigger compartido de
`user_preferences` y el ajuste de performance de su RLS.

**Contenido v4 (7/10/2026).** `00125` y `00126` y `00127` estan **aplicadas**
y registradas: `00125` (CHECK de `social_posts.origin` suma `'manual'`),
`00126` (backfill de `networks[].format` desde el `contentType` viejo —
tuvo un bug de `jsonb_set` con un valor `NULL`, corregido en el momento sin
perdida de datos antes de reaplicar; detalle en `docs/PENDIENTE.md`) y
`00127` (`content_post_versions` suma `updated_at` y el CHECK de `reason`
admite `edit`/`approve`). La `00128` (borra `material_status` y la clave
`options.contentType`) tambien esta **aplicada** (10/10/2026, version
`20261010201712`), con su respaldo en `docs/contenido-v4/respaldo-00128.json`;
el detalle del orden en `docs/PENDIENTE.md`.

**Agenda v2 (8/10/2026).** `00129` esta **aplicada** y registrada:
reescribe `create_booking` (ahora con 25 parametros, `p_landing_page` nuevo
al final con default) para que una reserva `manual` o `agent` NO deje un
toque de atribucion falso `web/booking` que pisaria el real, suma
`ttclid`/`li_fat_id`/`landing_page` al toque, dos indices sobre
`bookings.utm` y la funcion `booking_utm_options` (SECURITY INVOKER) para
las opciones del filtro de UTM de Agenda. La firma vieja (24 parametros, sin
`p_landing_page`) se borro en la misma migracion: no queda una sobrecarga
colgada.

`00130` (liberar espacio) tambien esta **aplicada**: `slot_released_at`/
`slot_released_by` en `bookings`, la exclusion `bookings_no_overlap` recreada
para que una agenda liberada no bloquee el horario, y
`google_host_connection_id`/`google_host_calendar_id` (sin usar todavia,
quedan listas para reasignar anfitrion). Verificado con
`verify-scheduling.mjs` y el caso nuevo de `verify-booking-concurrency.mjs`.

**Banca de recursos v2 (8/10/2026).** `00131` (seis tipos, seis columnas, las
reglas de forma y la escritura con `templates.manage`) y `00132`
(`touch_response_asset`) estan **aplicadas** y registradas. El plano las
numeraba 00125/00126, que ya estaban ocupadas. La cabecera de la 00131 tiene
los cuatro CHECK y las tres policies viejas letra por letra, para volver atras.
**Revision de octubre (9/10/2026): la proxima migracion disponible era la `00137`**
(ver "Revision de octubre" mas abajo; confirmar con `list_migrations`).

**Agentes IA, instrucciones versionadas (10/10/2026).** `00137` esta
**aplicada** y registrada: tabla `ai_task_prompt_versions` (historial
inmutable de instrucciones de tarea, mismo patron que `agent_prompt_versions`)
y `workspaces.ai_task_prompt_active jsonb default '{}'`. Aditiva: sin version
activa, cada tarea sigue usando el texto del sistema que ya tenia en el
codigo.

**Secretos del cron en Vault (10/10/2026).** `00139` y `00140` estan
**aplicadas** y registradas. `app_url` y `cron_secret` pasaron de
`private.system_config` (texto plano) a Vault (`system:app_url`,
`system:cron_secret`). Se cargan con `private.set_system_secret` y se
comprueban con `private.system_secrets_status()`, que nunca muestra el secreto.
`call_app_cron` lee de Vault; `lib/cron-config.test.ts` falla si la definicion
vigente vuelve a leer la tabla (pasa si un cron nuevo copia una version vieja
de la funcion). `system_config` queda solo con `draft_alerts_since`. La `00138`
(`ai_task_models`) tambien esta aplicada.

**Auditoria de velocidad y estandar de tareas (10/10/2026).** `00141`
(`workspace_member_profiles`: el equipo en una consulta, solo service_role) y
`00142` (CHECK de `ai_task_prompt_versions.task` suma `close_classification`)
estan **aplicadas** y registradas.

**`read_secret` solo para el servidor (10/10/2026, PR #38).** La `00143` le
saca a `authenticated` el permiso de ejecutar `read_secret`: **aplicada y
registrada** (version `20261010211554`), despues de desplegar el codigo que lee
las claves con el cliente de servicio (ver "Integraciones y secretos").
`verify-rls.mjs` y `verify-workspace-isolation.mjs` con `--despues-de-00143`
en verde.

**Llamadas (octubre 2026).** `00144` a `00149` estan **aplicadas** y registradas
(ver "Llamadas" mas abajo): `00144` (`audit_log.actor_type`/`actor_label`),
`00145` (la tabla `calls`, `can_see_call`, las columnas de Fathom y los candados
del refresh token), `00146` (el cron SQL `fathom-sync`), `00147` (la politica
ADICIONAL `audit_log_select_calls`), `00148` (CHECK de `agent_runs.source` y
`ai_task_prompt_versions.task`, `set_ai_background_task_settings`) y `00149`
(CHECK de `triggers.type` y `content_ideas.source`, `content_ideas.call_id`).
**Despues de Formularios, la `00159` abrio Ventas (hasta la `00171`), y las correcciones de Formularios del 12/10 usaron la `00172` a la `00177`: la proxima libre es la `00178`** (confirmar con `list_migrations`).

**Formularios (11/10/2026).** `00150` a `00158` estan **aplicadas** y registradas:
`00150` (tablas, `can_view_forms`, `can_see_form_submission`, RLS), `00151` (indice
de metricas), `00152` (`get_public_form`, `publish_form_version`,
`form_metrics_daily`, `submit_form_response` v1), `00153` (buckets privados),
`00154` (`captcha` en integraciones; **se sacó en la 00173**), `00155` (`flows.form_id` y tres tipos de
trigger), `00156` (`find_contact_by_phone_or_email` y `submit_form_response` v2),
`00157` (`contract_signatures`, `record_contract_signature` y la v3) y `00158`
(corrige "una vez por contacto"). La `00159` a la `00171` son de Ventas (ver "Ventas Fase 1").

**Correcciones de Formularios (12/10/2026).** `00172` a `00177`, **aplicadas** y registradas:
`00172` (`get_public_form` sin `turnstile_site_key`), `00173` (el CHECK de
`integration_configs.type` sin `captcha`; aborta si hubiera filas), `00174`
(`get_public_form` deja pasar `social`), `00175` (`find_contact_for_form`, `linkedin_slug`
e indices por red social), `00176` (`submit_form_response` v5: modo `none` y redes
sociales) y `00177` (candado en `form_versions`).

**Reporte de fin de dia (12/10/2026).** `00178` a `00185`, **aplicadas** y registradas
(ver "Formularios (construido)" → "Reporte de fin de dia"): `00178` (tipo `eod` y
`eod_config`), `00179` (`get_public_form` devuelve `unavailable` para un EOD), `00180`
(`eod_reports`, `can_view_eod_all`, RLS y `pending_edit` sin lectura), `00181`
(`save_eod_draft`, `submit_eod_report`), `00182` (flujos sin contacto: `contact_id`
nullable en `automation_events` y `flow_sessions`, con CHECK y `member_user_id`), `00183`
(trigger `eod_submitted`), `00184` (`submit_eod_report` v2 con el evento) y `00185` (cron
del recordatorio). **El Extra L (13/10/2026) uso la `00186` a la `00195`: la proxima libre es la `00196`** (confirmar con `list_migrations`).

**El `list_migrations` del MCP de Supabase es la fuente real**, no lo que
diga este archivo: la numeracion de acá se desactualiza cuando dos corridas
pasan en paralelo (pasó con esta sección, que decía `00119` cuando la base
ya tenía hasta la `00112` de una corrida de Contenido v3 en simultáneo).
Confirmar con `list_migrations` antes de escribir la siguiente.

**Una migracion que borra se aplica en este orden**: primero el codigo que ya
no la usa, desplegado y comprobado en el servicio; despues las consultas de
seguridad de su cabecera; un respaldo de lo que se va a borrar; y recien ahi la
migracion. Las aditivas pueden ir antes del codigo; las que borran, nunca.

**Aplicar y registrar con la CLI** (el MCP de Supabase puede negarse):
`supabase db query --linked -f <archivo>` aplica, y el registro es un
`INSERT` en `supabase_migrations.schema_migrations (version, name, statements,
created_by)` con version = timestamp UTC, name = nombre del archivo y
`statements` = `array[<el SQL completo>]`. `db query` NO registra solo.

La `00072_draft_window_alerts`, que arrastraba sin aplicar desde la Fase 3, se
aplico el 28/9/2026: su guarda `draft_alerts_since` hace que solo avise por
borradores creados DESPUES de aplicarla, asi que enchufarla con la cola vacia
—como estaba— es el momento mas seguro, no el mas riesgoso. El cron
`ssa-cron-draft-window-alerts` corre cada 5 minutos.

La `00090_drop_legacy_secret_columns` **si se aplico** (26/9/2026, commit `d988e32`): los secretos de Zernio se movieron a Vault comprobando por huella sha256 que la copia era identica, se vaciaron las columnas, se comprobo que el sistema seguia leyendo, y recien ahi se borraron. Hoy **no queda ninguna clave en columnas de la base**.

Despues de cada migracion: `node scripts/build-all-migrations.mjs`. Antes de aplicar cualquiera, `list_migrations`.

**Varios negocios en una instalacion (25/10/2026).** `00266_workspace_brand` (marca y tono por workspace, bucket publico `brand-assets`, usuario de agenda unico en toda la instalacion): **aplicada y registrada** el 25/10/2026 (version `20261025202218`), antes del deploy, con `verify-workspace-isolation --despues-de-00143` en verde. En un clon nuevo va ANTES de desplegar el codigo (el layout y los formularios leen sus columnas). Ver [docs/sumar-un-negocio.md](docs/sumar-un-negocio.md).

**Una sola clasificacion de grabaciones (6/11/2026).** `00300_calls_catalog_classification` (aditiva: `booking_categories.description/system_key`, area y tipo en `calls`, conversion de lo viejo) va **ANTES** de desplegar el codigo: **aplicada y registrada** el 6/11/2026 (version `20261106205222`), despues de ensayarla en una transaccion que se deshizo sola, con `verify-calls --despues-de-00300` y `verify-scheduling --despues-de-00290` en verde. **Alcance por area (6/11/2026).** `00301_calls_scope_by_area` (aditiva: `scope_rank` con `areas`, `can_see_call`, `can_grant_call_areas`, el trigger, `can_give_role` y la politica de crear) va **ANTES** de desplegar el codigo: **aplicada y registrada** el 6/11/2026 (version `20261106220002`), con `verify-calls --despues-de-00300 --despues-de-00301`, `verify-roles` (con todas sus banderas y `--despues-de-00301`), `verify-permissions-matrix` y `verify-rls --despues-de-00143 --despues-de-00208` en verde. **La proxima libre es la `00302`** (confirmar con `list_migrations` y las ramas locales: la `00299` la uso otra sesion).

**Un analizador por tipo de reunion (6/11/2026).** `00303_call_analysis_profiles` (aditiva: la tabla, `ai_task_prompt_versions.variant`, `calls.analysis_profile_id` y un analizador por cada tipo que un negocio ya analizaba) va **ANTES** de desplegar el codigo: **aplicada y registrada** el 6/11/2026 (version `20261107020340`), despues de ensayarla en una transaccion que se deshizo sola. `verify-calls --despues-de-00300 --despues-de-00301 --despues-de-00303`. La `00302` es de otra sesion. **Que importa cada conexion de Fathom (6/11/2026).** `00304_fathom_connection_settings` (aditiva: `oauth_connections.fathom_settings`) va **ANTES** de desplegar el codigo: **aplicada y registrada** el 6/11/2026 (version `20261107043710`), despues de ensayarla en una transaccion que se deshizo sola. `verify-calls --despues-de-00304`. La `00305` y la `00306` son de otra sesion. **La limpieza de Grabaciones (Etapa 5, 6/11/2026).** `00307_calls_classification_decider` (aditiva: `classification_rule`, `classification_confidence`) va **ANTES** de desplegar el codigo: **aplicada y registrada** el 7/11/2026 UTC (version `20261107060646`). `00308_drop_legacy_call_type` (BORRA `call_type`, `call_type_*`, `is_closer` y las claves viejas de la configuracion) va **DESPUES** de desplegar y comprobar el codigo: **aplicada y registrada** el 7/11/2026 UTC (version `20261107143946`). Su respaldo tiene datos del negocio y queda fuera del repo, en la carpeta local `Claude outputs/` de la instalacion. `verify-calls --despues-de-00307 --despues-de-00308`. **La proxima libre es la `00309`** (confirmar con `list_migrations` y las ramas locales).

**Importacion de conversaciones de Instagram (28/10/2026).** `00267_channel_inbox_import` (`channels.inbox_import`, el avance de la importacion): aditiva, **escrita y SIN aplicar todavia**. Va ANTES de desplegar el codigo (la cola y la pantalla de Canales la leen). Ver la seccion "Importacion de conversaciones de Zernio" mas abajo. **La proxima libre es la `00268`** (confirmar con `list_migrations`). La `00284_placeholder_name_ids` (un id o un @usuario como nombre es un relleno, y el backfill de los ~75 contactos con id como nombre y @usuario guardado) es aditiva y puede ir antes o despues del deploy.

**Extra I (15/10/2026).** `00224` a `00232` estan **aplicadas y registradas** (metodos de pago, gastos y finanzas, atribucion organica y comisiones); `00233`, `00234` y `00235` se aplicaron el **15/10/2026, despues del merge** y estan **aplicadas y registradas** (versiones `20261015232110`, `20261015232347` y `20261015232649`; ver las cuatro secciones del Extra I mas abajo). **La proxima libre es la `00236`.**

**Permisos de tablas en un proyecto nuevo (15/10/2026).** Desde el 30/5/2026 Supabase no le da acceso automatico a las tablas nuevas de `public` a `anon`, `authenticated` y `service_role` (el 30/10/2026 el cambio llega a los proyectos existentes, solo para objetos nuevos). Las migraciones viejas se escribieron con el comportamiento anterior (casi sin `GRANT`, con ~230 `REVOKE ALL`), asi que la **`00000_default_privileges`** restaura el acceso por defecto ANTES de crear ninguna tabla y deja los permisos como en produccion. Es la primera migracion; en una base que ya existe se marca con `supabase migration repair --status applied 00000`. **Desde la `00224`, cada migracion que crea una tabla declara sus `GRANT`** (a `service_role` siempre, y a `authenticated`/`anon` lo que corresponda): `lib/migrations-grants.test.ts` lo exige. Ese test tambien prohibe un tipo de extension sin esquema (`vector(N)` en vez de `extensions.vector(N)`): la CLI (`db push`) no tiene `extensions` en su `search_path` y el panel si; asi fallo la `00083` en el primer cliente de prueba. El `/setup` comprueba el acceso de la app a las tablas justo despues de aplicar las migraciones.

# Etapa 2 (construida)

Lo que se sumo, y donde esta lo importante de cada cosa. El detalle en `docs/`.

## Integraciones y secretos
Todos los secretos viven en **Supabase Vault**, nunca en el `.env` ni en el codigo. De un secreto guardado la pantalla solo sabe que EXISTE: el valor no vuelve del servidor.
- El catalogo de proveedores esta en `lib/integrations/providers.ts`; los nombres de los secretos, en `lib/secret-names.ts`, que **no importa nada** a proposito.
- `lib/vault-boundary.test.ts` recorre los imports reales desde cada Client Component y falla si alguno llega a `lib/vault.ts` o a `lib/supabase/server.ts`. Ya atajo dos fugas; si aparece un modulo nuevo que no puede ir al navegador, sumarlo ahi.
- "Probar y guardar" usa la clave contra el proveedor ANTES de escribirla. Una clave revocada guardada deja la card en verde.
- **`readSecret` siempre con el cliente de servicio** (`createServiceClient`). Desde la 00143 `read_secret` solo la ejecuta `service_role`: ni el Owner lee una clave desde el navegador. Quien puede USAR una clave lo decide el que llama (el guard de Admin, la RLS de la conversacion), y el workspace sale siempre de la sesion, nunca del pedido. La bandeja manda con el cliente del usuario y pasa el de servicio solo para las claves (`sendChannelMessage(..., { secrets })`). Guardar, borrar y listar siguen con la sesion (ninguna devuelve un valor).
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
- `requireWorkspaceAdmin` y `getAdminContext` conservan su comportamiento, pero ya casi no se usan. Lo nuevo es `requirePermission`, `requireAnyPermission`, `getPermissionAction` y `getAnyPermissionAction`.
- `lib/auth/member-baseline.test.ts` fija lo que puede un Member recorriendo el codigo real. Si se cambia un guard sin querer, ese test lo dice.
- Doc: `docs/roles.md`.

# Equipo, roles y permisos (construido, 14/10/2026)

78 claves, cada una con su guard en la pagina, en la accion y en la base. Invitar por email o por link, historial, roles con guardado automatico y reglas de seguridad de quien puede dar que. Resumen y "como sumar una clave en 5 pasos" en [docs/roles.md](docs/roles.md); plano en `docs/requerimientos-equipo-roles.md`; avance y decisiones en `docs/PROGRESS-equipo-roles.md` y `docs/PENDIENTE-equipo-roles.md`.

## Lo que no se puede romper

- **Cada clave del catalogo hace lo que dice, en las tres capas**: la pagina (`requirePermission`), la accion (`getPermissionAction`) y la tabla (`has_permission` en la politica). `lib/auth/catalog-usage.test.ts` falla si una clave no se usa en ningun lado. **`settings.manage` se retiro**: ya no existe ni en el catalogo ni en ninguna politica (sus sucesoras: `settings.general`, `sales.settings`, `products.manage`, `assignment.manage`).
- **La lista del Member vive en dos lugares que tienen que ser iguales**: `MEMBER_PERMISSION_KEYS` (TypeScript) y `private.member_permission_keys()` (SQL). Lo mismo con las claves solo-Owner (`private.owner_only_keys()`) y las que no viajan en ningun rol (`private.ungrantable_keys()`: solo-Owner mas reservadas). `lib/auth/member-sql-parity.test.ts` las compara. Cambiar una sin la otra rompe el test, y a proposito.
- **`has_permission` nunca devuelve NULL** y conserva su firma: Owner true; Admin true menos las solo-Owner; Member de sistema (o sin `role_id`) con su lista; rol personalizado con su jsonb. Quien no es miembro, false.
- **"No podes dar lo que no tenes"**: quien invita, asigna un rol o arma un rol no puede dar mas de lo que tiene. Tiene dos gemelas con los mismos casos (`lib/team/grant.cases.json`): `assertCanGrant` / `assertCanAssignRole` / `assertCanEditRole` (`lib/team/grant.ts`) y `public.can_grant_permissions` / `can_give_role` / `is_own_role` mas el trigger `workspace_roles_grant_check` (00212, `SECURITY DEFINER`). Una clave solo-Owner o reservada no entra en ningun rol; el rol Admin lo dan solo Owner o Admin; el Owner no se da; nadie se cambia su propio rol ni edita el rol que tiene asignado (salvo Owner y Admin); nadie toca al Owner. Al editar un rol solo hay que poder dar lo que se AGREGA.
- **Invitaciones**: el link sigue siendo `/invite/<id>`; `status` no cambio (pendiente / aceptada / anulada) y "vencida" se deriva (`inviteState`). Anular es un UPDATE, no un borrado. Reenviar: una vez por minuto y cinco en total. `delivery='link'` no manda correo (test con espia). Al aceptar se guardan `role` y `role_id`; si el rol personalizado ya no existe, entra como Member de sistema. Los logs no llevan emails ni links. La invitacion ya no se puede editar por la persona invitada (se cerro ese agujero en la 00212).
- **Roles con guardado automatico** (`patchRole`): una cola serial (`lib/roles/save-queue.ts`) y la auditoria agrupada por sesion de edicion de 10 minutos. Un cambio que falla vuelve a su valor y ofrece "Reintentar". Nada de `window.location.reload()`.
- **`workspaces` sigue siendo Admin en la base**: las acciones de Ajustes escriben con el cliente de servicio DESPUES de chequear su clave, filtrando por el workspace de la sesion. No se reescribe esa politica.
- **`audit_log_select` NO se toca**: el permiso `audit.view` es la politica ADICIONAL `audit_log_select_audit` (00213).
- **Las conexiones personales no cambian** (Google Calendar y Fathom, `lib/oauth/*`, `claim_oauth_refresh`): las ve y las conecta cada persona. `oauthRouteContext` tiene dos ramas: por persona, el permiso del adaptador (Google Calendar `scheduling.use`, Fathom `calls.view`); la del negocio pide `integrations.manage`.
- **El menu y las pestanas salen de funciones puras** (`visibleNavItems`, `visibleSettingsTabs`, `tabsForViewer`, `pageActions`, `integrationSections`, `generalSectionsFor`, `visibleChannels`, `canExport`): los componentes solo las componen. `adminOnly` ya no existe, es `permissions`.
- **Exportar CSV es `canExport`** (`lib/auth/export.ts`) en los cuatro lugares: el endpoint, la accion y el boton. Un Member no exporta (cambio aprobado M2).
- **La bandeja va por CUENTA conectada (00249)**: cada rol guarda en `permissions.channels` «todas las cuentas» (incluye las futuras) o una lista por cuenta, cada una con su alcance (solo asignadas / + sin asignar / todas) y «responde». Lo aplica la base (`can_see_conversation` decide por la cuenta; ver un chat deja ver la ficha del contacto) y la pantalla usa las mismas reglas (`lib/auth/channel-permissions.ts`, gemelas SQL con `channel-permissions.cases.json`): el menú de cuentas, el composer y los 403 de envío, borradores, reacciones, adjuntos y recursos. Las seis claves `inbox.<red>.*` y el alcance `conversations` se retiraron. Resumen en `docs/roles.md`, «La bandeja por cuenta».
- **Cambios del Member** (todos con test y el comentario "cambio aprobado"): M9 (Extra I) ve sus propias comisiones: `commissions.view` con alcance `own`, nada más (el Member ve «Finanzas» solo por eso); M1 no importa contactos, M2 no exporta, M3 no ve webhooks, M6 no ve Broadcasts, M7 lo que publica se dispara de verdad (la tabla `triggers` pide `flows.edit`), M8 entra a Integraciones por la URL y ve solo "Mis conexiones", M10 edita el contenido de su pieza (o la asignada) en cualquier estado, sin poder mover el estado fuera de Borrador / En producción / En revisión (00253), M12 ve y edita diseños del Diseñador IA (`designer.view` y `designer.edit`, 00319; no publica, no emite ni anula). Owner y Admin: ninguno. `lib/auth/access-matrix.characterization.test.ts` guarda la foto y falla si Owner o Admin cambian o el Member cambia fuera de esa lista.

## Migraciones (00208 a 00214, todas aplicadas y registradas)

`00208` (`has_permission` v2, `member_permission_keys`, `owner_only_keys`; las politicas de webhooks pasan a `webhooks.manage`), `00209` (diez columnas de `workspace_invites`), `00210` (backfill de `role_id`), `00211` (retiro de `settings.manage` y sucesoras en el jsonb de los roles), `00212` (RLS de equipo, `can_grant_permissions`, `can_give_role`, `is_own_role` y el trigger de roles), `00213` (RLS de Ajustes) y `00214` (RLS de modulos). **La proxima migracion disponible es la `00215`** (confirmar con `list_migrations`; ya paso que el numero de este archivo quedo viejo).

## La bandeja por cuenta (22/10/2026)

`00249` (aditiva: `permissions.channels`, backfill exacto desde las claves viejas, `can_see_conversation` por cuenta, `can_see_contact` + «ver un chat deja ver la ficha», `can_grant_channels` y el trigger `workspace_roles_channels_default`) y `00250` (la que BORRA las claves `inbox.*` y `scopes.conversations`, y saca esas claves de `private.member_permission_keys()`). **Las dos aplicadas y registradas el 22/10/2026** (versiones `20261022191356` y `20261022195239`): la 00249 antes del deploy y la 00250 despues, con su respaldo en `docs/roles/respaldo-inbox-keys.json`. **En un clon nuevo: la 00249 ANTES de desplegar el codigo y la 00250 DESPUES.** La `00251` y la `00252` son de Agentes IA (otra sesion). **La proxima libre es la `00253`** (confirmar con `list_migrations`).

## Verificacion de equipo y roles

```
node scripts/verify-roles.mjs --despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212
node scripts/verify-permissions-matrix.mjs     # cada tabla con permiso: Owner, Admin, Member, un rol con SOLO la clave y uno sin ella
```

Mismas reglas que los demas: crean y limpian sus datos (prefijo `zz-test-`). **Se corren de a uno y con el candado `/private/tmp/ssa-verify.lock`**: tomarlo con `mkdir`, soltarlo con `rmdir`, y no mantenerlo mientras no hay ninguna corriendo (otra sesion lo toma pasados 15 minutos).

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
node scripts/verify-attribution.mjs # toques, primer/ultimo toque, reserva (Contenido v3)
node scripts/verify-workspace-isolation.mjs # secretos e integraciones entre workspaces, alta por invitacion
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
- **Un evento se activa sin calendario** ("solo en el sistema", 20/10/2026):
  solo Google Meet lo exige. Conectar Google lo vincula solo (con aviso) y
  desconectar limpia sus referencias (`clearEventCalendarRefs`). Una conexion
  ROTA sigue cortando los horarios. Ver "Eventos sin calendario" en
  docs/agendamiento.md.
- **Una reunion la ve tambien el setter de su contacto** (00241, `can_see_booking`).
  Los flujos de un evento los toca solo quien puede editar ese evento.
- **Un espacio liberado se ofrece aunque Google lo marque ocupado**: `busyRanges` resta del ocupado de Google el rango de cada reunión liberada y de la que se reagenda (`freed`, `splitHostBookings`). Es la doble reserva a propósito; lo que excede ese rango sigue bloqueando.
- **El detalle de una reunión se pide aparte** (`loadBookingDetail`, `lib/actions/scheduling/booking-detail.ts`): abrir o cerrar el panel cambia `?agenda=` con la API del navegador y NO recarga la página. La página de Agenda carga en dos tandas en paralelo; los contadores de las pastillas salen de `listBookingStatuses` (tres columnas), nunca de traer reuniones completas.
- **Cambiar el anfitrion de un evento** (00290, editor → Detalles, pide
  `scheduling.manage_others`) solo cambia las reuniones NUEVAS: las ya agendadas
  conservan su `host_user_id`. Va por `change_event_type_host`, en una transaccion,
  y el link anterior sigue funcionando (`event_type_moved_links`, lo mira
  `findPublicEvent`; un evento real en ese link le gana). **Reagendar nunca busca el
  evento por el link**: sale de la reunion, porque su anfitrion puede no ser el dueño
  de hoy. La 00290 va ANTES de desplegar el codigo: **aplicada y registrada** el
  5/11/2026 UTC (version `20261105002339`), con `verify-scheduling --despues-de-00290`
  en verde. La `00289` es de otra rama, tambien aplicada. (Para la proxima libre, ver la ultima seccion que la nombra y confirmar con `list_migrations` y las ramas locales.)

- **La agenda reescribe el nombre del contacto, salvo que una persona lo haya editado a mano (00358, 10/11/2026)**: una reserva publica (`public_page` o `embed`, sin contacto dado) reemplaza `contacts.display_name` por el nombre que escribio la persona, a menos que `display_name_source = 'manual'` (lo escribe `updateContact` cuando alguien del equipo edita el nombre; `applyPatch` lo guarda sin que cuente como cambio del historial). Agendar a mano y el agente nunca lo pisan. `create_booking` cambio a proposito (huella nueva en `scripts/protected-functions.mjs`, diff fijado en `c2-migrations-diff.snapshot.json`). El nombre se edita desde el panel de la reunion (`InlineField`, `contacts.edit`); `bookings.booker_name` sigue siendo lo que escribio la persona. **La 00358 va ANTES de desplegar el codigo**: sin la columna, editar un nombre falla.
- **«Ultimo click» en la lista y el panel de Agenda (00359)**: los ultimos 3 toques del contacto, de cualquier canal, anteriores o iguales a la creacion de la reunion (`booking_last_touches`, solo `service_role`, mismo orden que `ads_crm_items`). El toque de la propia reunion cuenta si trae algo. Puro en `lib/attribution/last-touches.ts`, carga en `last-touches-load.ts` (nombres y miniaturas con la SESION: sin `dashboards.ads.view` no hay miniatura); un fallo deja «—». Kanban y calendario no cambian.

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

# Llamadas (Fathom + analizador de llamadas con IA)

Cada persona con `calls.view` conecta su Fathom y lo que grabo entra solo (en el menu, **Grabaciones**; ya no hay marca de closer): se vinculan
al contacto y a la agenda, se clasifican, se analizan con el SPSP del negocio, se
corrigen sin perder lo que dijo la IA, y lo aprendido vuelve al negocio. Plano en
`docs/requerimientos-llamadas.md`; el resumen del modulo, en
[docs/llamadas.md](docs/llamadas.md); avance y decisiones en
`docs/PROGRESS-llamadas.md` y `docs/PENDIENTE-llamadas.md`.

## Lo que no se puede romper

- **Entra lo que grabo quien conecto**, con los correos de `recorderEmailsFor` (`lib/fathom/recorder-emails.ts`). Conectar, sincronizar e importar piden `calls.view`; desconectarse, solo ser miembro. `closer_emails` son los otros correos que la persona carga en Mi Fathom. **`/users/me` no esta documentado por Fathom**: no depender de el.
- **Qué importa cada conexión (00304)**: `oauth_connections.fathom_settings`, reglas puras en `lib/fathom/settings.ts`; sin configurar, automático y sin área. Manual no consulta nada ni pide un token. Lo que no cumple las reglas no se guarda y se mira ANTES de pedir la transcripción. Salir de manual arranca en `auto_since`: lo anterior se trae con Importar. El área por defecto es el paso `connection` de la cascada. La propia con `calls.view`; la de otra persona con `calls.configure`. Detalle en docs/llamadas.md.
- **Importar el historial** (`lib/fathom/history-import.ts`, job `fathom_history_import`, Mi Fathom): por partes, llega hasta la marca de agua (lo posterior es de la consulta de cada 10 minutos) y lo importado es historia (`calls.imported_from_history`): `emitCallEvent` no emite nada y no se analiza sola. No gasta IA al clasificarse salvo que la persona lo pida («Clasificar con IA», apagado por defecto). Detalle en docs/llamadas.md.
- **Una sola clasificacion (00300)**: agenda y grabaciones usan `booking_categories`. Decide lo elegido a mano, despues la reunion vinculada, una regla y la IA (`lib/calls/classify-cascade.ts`); un paso que solo da el area no deja que otro la cambie. **La clave vieja de tipo ya no se guarda: se deriva** (`legacyCallTypeFor` y `derivedCallType`, por `system_key`, nunca por el nombre); de ella salen qué no se resume, qué nunca va a Conocimiento y los filtros de los flujos viejos. `no_show` es una marca, no un tipo. Cambiar la reunion vuelve a clasificar (`reclassifyCall`, nunca lanza) y lo analizado conserva su analisis. Detalle en docs/llamadas.md.
- **`access-matrix.baseline.json` NO se regenera con `UPDATE_ACCESS_BASELINE`**: es la foto vieja a proposito y se reescribiria entera. Una entrada que se borra de verdad se saca a mano.
- **Una sola tabla nueva: `calls`.** Escribe solo el servidor; la ven Owner y
  Admin, quien la grabo, quien ve su contacto (`can_see_contact`) y un rol con
  `calls.view` de alcance `all` o, con `areas`, de una de sus areas (`can_see_call`).
- **Un analizador por tipo (00303)**: `call_analysis_profiles`, una fila viva por tipo o area; escribe solo el servidor con `calls.configure`. **Sin analizador no se analiza ni se gasta IA** (`no_profile`). Lo decide `statusAfterClassification`; lo importado nunca corre solo y uno nuevo arranca en manual. Dos formatos (`sales`, `general`), no uno libre. `ai_task_prompt_versions.variant` es el analizador: **toda consulta de las instrucciones generales lleva `.is("variant", null)`**. Los puntajes no se promedian entre tipos (`withoutMixedScores`). Detalle en docs/llamadas.md.
- **Alcance por area (00301)**: `scopes.calls = 'areas'` + `permissions.call_areas`. Sin clasificar no entra por el area. Gemelas `lib/auth/call-areas.ts` y `private.role_sees_call_area` / `private.call_areas_exceed`, con `call-areas.cases.json`. **Dar un area se mira area por area**, no solo por el alcance: `assertCanGrant` y, en la base, la politica al crear, el trigger al editar y `can_give_role`. Un alcance nuevo tiene que entrar en `private.scope_rank` y en `SCOPE_RANK`: lo que no conocen vale lo mas bajo y se podria dar sin tenerlo. Detalle en docs/llamadas.md.
- **Dos copias del analisis.** `analysis_ai` (lo que dijo la IA) solo cambia con
  una corrida nueva (otro `analysis_run_id`: lo exige el trigger
  `calls_protect_analysis_ai`); `analysis` es lo que se muestra y se corrige, y un
  cambio recalcula los puntajes con `rubric_snapshot`, no con la rubrica vigente.
- **Los puntajes salen del codigo** (`lib/calls/scoring.ts`), nunca del modelo, y
  una cita que no esta en la transcripcion no cuenta.
- **`audit_log_select` NO se reescribe.** El acceso al historial de un modulo nuevo
  es una politica ADICIONAL: `audit_log_select_<modulo>` (la de Llamadas es la
  00147). Las politicas de SELECT se suman. `scripts/verify-audit-visibility.mjs`
  compara la visibilidad completa antes y despues.
- **`private.call_app_cron` no se toca.** El cron de Fathom es de SQL directo
  (`private.enqueue_fathom_sync`, 00146).
- **El refresh token de Fathom es de UN SOLO USO**: dos procesos renovando a la vez
  dejan la conexion muerta, y por eso el candado vive en la base
  (`claim_oauth_refresh`).
- **Los jobs de Llamadas no lanzan por un fallo de un proveedor** (Fathom, IA,
  Voyage): la cola reintentaria a los 10 s encima de la espera propia. Reagendan
  a 1, 5 y 15 minutos o dejan la llamada en un estado que una persona ve. Un 429
  o un 5xx de Fathom NUNCA marcan la conexion como `error`.
- **La configuracion de las tareas vive en `workspaces.ai_background_settings`**
  (claves `call_classification` y `call_analysis`, esquema en
  `lib/calls/task-settings.ts`) y se escribe SOLO con
  `set_ai_background_task_settings` (cambia UNA clave) via `saveCallTaskSettings`
  (`calls.configure`). Guardar una tarea en segundo plano conserva esas claves
  (`mergeBackgroundSettings`).
- **Lo que escribe una persona como pedido** (corregir con IA, el contexto al
  regenerar) viaja SIEMPRE como dato en el mensaje del usuario, nunca en el system
  prompt. El texto editable de las instrucciones se versiona; la parte tecnica
  (anti-inyeccion, rubrica, categorias) es fija.
- **El documento de Conocimiento de una llamada es SIEMPRE interno**
  (`internal_only = true`) y nunca de una reunion de equipo.
- **La memoria del contacto se escribe con control de concurrencia**
  (`lib/calls/memory.ts`): condicional sobre `ai_summary_updated_at`, un reintento
  y despues `memory_status = 'conflict'`.
- **Los eventos de automatizacion nunca tumban lo que los emite**, y una llamada
  sin contacto no emite nada.

## Variables de entorno

Llamadas **no suma ninguna variable de entorno**: la app OAuth de Fathom (Client ID
y Secret) y los tokens viven en Supabase Vault, y el cron usa los secretos que ya
estan en el Vault.

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
  la duda, escala.** Se apaga desde la configuración del agente (`guardrails.escalation.onUnreadable`, pestaña Configuración → Escalamiento); los flows y las secuencias, que no tienen agente, leen `workspaces.agent_escalate_on_unreadable`.
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
le gana a `max-width` (un minimo fijo desborda la burbuja), y el tema lo maneja
la clase `.dark` del `<html>`, no `prefers-color-scheme`. Desde d72265a el
`dark:` de Tailwind sigue a esa clase (`@custom-variant dark` en
`app/globals.css`).

**Desplegables (22/10/2026).** `.dark` declara `color-scheme: dark` (y `:root`
`light`): sin eso la lista de un `<select>` nativo salia con fondo claro y texto
blanco. La flecha y el padding derecho de TODOS los `<select>` salen de una
regla de `app/globals.css` fuera de `@layer` (le gana a `px-*`); las opciones
usan `--popover`. Un desplegable que dibuja su propia flecha lleva la clase
`select-bare`. `lib/ui/theme-css.test.ts` lo cuida.

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

# Banca de recursos v2 (seis tipos)

La banca pasa de texto y audio a seis tipos: texto, audio, video, imagen,
archivo y enlace, en la MISMA tabla `response_assets`. Avance y decisiones en
`docs/PROGRESS-recursos-v2.md` y `docs/PENDIENTE.md`.

## Lo que no se puede romper

- **Que exige cada tipo lo dice `lib/response-assets/shape.ts`** (`KIND_SHAPE`),
  y lo llaman el formulario Y las Server Actions. Es la misma regla que los
  CHECK de la 00131: la base rechaza una forma invalida aunque alguien se
  saltee la pantalla.
- **`channelAccepts(provider, kind, mime)` (`lib/channels/media.ts`) es el
  UNICO lugar que decide que manda cada canal.** Lo consultan el widget, la API
  de envio y el agente. Email: texto y enlace. WhatsApp: todo. Instagram: todo
  menos archivos (no verificado en el SDK) y segun el formato del audio. Rama
  explicita por proveedor, nunca un `else`.
- **Todo lo que tiene archivo pasa por `copyAssetToChat` antes de mandarse**,
  por cualquier camino. Nunca se manda el path de `library/`.
- **Un solo widget** (`components/inbox/asset-picker.tsx`) para "/", el boton
  y ⌘/Ctrl + /. Se abre siempre (tambien vacio). Enter nunca manda: inserta un
  texto o enlace, o abre el preview. Estado y teclado en `lib/inbox/asset-widget.ts`.
- **El preview reusa `MediaAttachment`** (via `lib/response-assets/preview.ts`):
  no hay visor propio. Las miniaturas cargan lazy; los reproductores firman al
  apretar play.
- **Administrar es `templates.manage`, no el cargo.** Ver la pantalla y usar
  los recursos, cualquier miembro. La RLS de la 00131 usa `has_permission`.
- **El contador (`usage_count`, `last_used_at`) solo lo escribe
  `touch_response_asset`**, despues de mandar, y nunca frena un envio.
- **El agente**: un audio o un video con voz necesita la transcripcion lista;
  un video sin voz (`transcript_status = 'none'`), una imagen, un archivo o un
  enlace alcanzan con su descripcion (`agentUsable`, `lib/response-assets/list.ts`).
- **Un video se transcribe por la misma puerta** (`lib/ai/transcribe.ts`):
  mp4 y webm si; un .mov o un .3gp quedan en `failed` sin llamar al proveedor
  (`assetTranscriptionSupport`). `isTranscribableMime` NO cambio: los videos
  que manda un lead no se transcriben.
- **`sniffUploadMime`** (`lib/content/media.ts`) refina a `sniffMime` para las
  subidas (Office por su contenedor + lo declarado, HEIC, 3GP, WebM de video).
  `sniffMime` queda igual porque la usa tambien el pipeline de contenido.

# Contenido v3 (B10-B14, F73-F105)

Cinco bloques sobre la rama `contenido-v3`: desatascar publicar, atribucion, el
modelo nuevo de la pieza, los drawers y medir. Plano en
`docs/requerimientos-contenido-v3.md`, avance en `docs/PROGRESS-CV3.md`, detalle
en `docs/contenido.md`, `docs/publicacion.md` y `docs/atribucion.md`.

## Lo que no se puede romper

- **La atribucion y la sincronizacion de cuentas NUNCA tumban nada.** `recordTouch`
  y `lib/social/sync-hook.ts` no lanzan; el toque de un mensaje va siempre
  DESPUES de guardarlo y dentro de un `try/catch`. Un guardado de integracion no
  puede fallar porque no se pudo sincronizar.
- **No se tocan** `find_or_link_contact`, el CHECK de `channels.platform` ni
  `processComment`: la atribucion se engancha antes y despues, no adentro.
- **`contacts.attribution` es una copia derivada** de `contact_touches` (la
  recalcula `record_contact_touch` desde la tabla). Hay tres formas guardadas
  (canonica, clicks, plana) y `readAttribution` devuelve siempre la canonica. Las
  viejas no se borran.
- **Instagram no crea contactos por comentar; TikTok si, anonimos.** Solo se
  cuenta como lead por comentario el contacto cuyo PRIMER toque fue ese
  comentario, una vez por pieza. Nada de atribuir desde un DM por palabra clave.
- **Pilares y ofertas no se borran, se archivan** (la tabla no tiene policy de
  DELETE; una prueba falla si aparece un `.delete()`).
- **Lo que se programa se valida en el servidor con la misma funcion que el
  editor** (`resolveNetworkContent` + `validateNetwork`). Tope diario de TikTok:
  15 videos y 15 fotos.
- **Sin clave de Zernio, sus cuentas quedan "no disponibles"**, no se usan los
  canales como respaldo. Una falla de Vault al leer la clave NO cuenta como
  desconectado (`getZernioKeyState`: present / absent / unknown).
- **`lib/publishing/e2e-zernio.test.ts` es la red de seguridad** de los
  disparadores de sincronizacion: si alguien quita uno, se pone en rojo.

## El modelo de la pieza

- La idea tiene un solo texto (`content`); la pieza, `script` y
  `recording_notes`. `approve_content_idea_v2` hereda clasificacion y redes, pero
  el guion y las notas arrancan vacios. Lo viejo (`copy`, `hook`, `angle`, `notes`,
  `pillar`) solo se lee dentro de versiones viejas (`lib/content/legacy.ts`).
- `media` es la biblioteca de la pieza (cada archivo con `id`); cada red guarda su
  `format` y sus `files` en orden. Una red sin formato sigue el modelo anterior.
- Los permisos mandan, no el cargo: `content.approve`, `content.publish`,
  `content.ai`, `social.view`, `dashboards.content.view`, `settings.manage`.
- **Los drawers viven en la URL** (`?idea=` y `?piece=`); las rutas viejas
  `/dashboard/content/<id>` y `/edit` redirigen. El borrador con cambios sin
  guardar nunca se pisa con lo que llega del servidor.

## Medir una pieza

- **Se compara por edad, nunca por fecha de calendario.** Y **nunca se inventa un
  cero**: lo que la red no da es un guion; LinkedIn muestra su aviso.
- **El indice** (`lib/dashboards/piece-index.ts`) es el engagement a 7 dias contra
  la MEDIANA de la misma red y el mismo formato de los 90 dias anteriores
  (`social_posts.media_type`); minimo 3 comparables (si no, "base insuficiente");
  verde desde 1,5x, rojo por debajo de 0,8x. Una publicacion sin `engagement_d7`
  esta "en curso" y queda fuera del promedio de la pieza.
- **El total de leads de la pieza no es la suma de sus filas** (una persona que
  comento dos publicaciones cuenta una vez).
- El dashboard de contenido agrupa y filtra por pieza, oferta, pilar, etapa del
  embudo, red y formato (`?agrupar=`, `?oferta=`, `?pilar=`, `?embudo=`,
  `?formato=`, `?pieza=`). **Nada se pierde:** lo que no tiene valor va a "Sin
  asignar" y la suma de las filas es el total.

## Cosas conocidas

- `LINKEDIN_API_VERSION` es `202609`; LinkedIn retira cada version a los ~12
  meses: revisarla antes de septiembre de 2027.

# Revision de octubre (9/10/2026, rama `feat/revision-octubre`)

Quince puntos de una revision de punta a punta. Plan en
`docs/revision-octubre/PLAN.md`, pendientes en `docs/PENDIENTE.md`
("Revision de octubre").

- **Migraciones `00133` a `00136`.** `00133` (topes de gasto de IA con accion y
  aviso previo), `00134` (precio y estado de los productos) y `00135`
  (`email_log.contact_id`) estan **aplicadas y registradas**. La **`00136`**
  (alcance de leads por rol: reescribe `can_see_contact`, copia de la 00089 con
  la definicion vieja completa en su cabecera) tambien esta **aplicada y
  registrada** (10/10/2026, version `20261010195152`, con el codigo ya
  desplegado), con `verify-rls.mjs` y `verify-roles.mjs --despues-de-00136` en
  verde. No cambio ningun dato: el unico rol personalizado ya estaba en `all`.
- **Productos = `content_offers`.** La tabla no se renombro: la pantalla dice
  "Productos" (`/dashboard/settings/productos`), con precio en USD (siempre USD)
  y estado activo / inactivo / discontinuado, que se guarda en `archived_at` +
  `status` (la base rechaza combinaciones incoherentes). Los pilares viven en
  Contenido (engranaje).
- **El guardado de mensajes es siempre.** No hay interruptor; el escalado por
  mensaje sin entender es una opcion de CADA agente (`escalation.onUnreadable`).
- **Topes de gasto de IA** en Agentes (`lib/ai/spend.ts`, `spend-limits-card`):
  cada tope elige cortar o solo avisar, y hay un aviso previo al X %.
- **Recursos en automatizaciones.** Un solo camino de envio (`deliverAsset`,
  `lib/response-assets/deliver.ts`) para el nodo "Enviar recurso" de los flows y
  el paso "Recurso" de las secuencias; "Insertar recurso" mete texto o enlace en
  emails y mensajes, y sus variables (`{{contact.*}}`, `{{workspace.name}}`) se
  resuelven al enviar (`lib/response-assets/bank-variables.ts`).
- **El historial del contacto** (`lib/contacts/history.ts`) muestra lo
  automatico (automatizaciones, secuencias, emails) y no los mensajes del chat.
- **Dashboard de Agenda** (`/dashboard/dashboards/agenda`, permiso
  `dashboards.agenda.view`): cuentas puras en `lib/dashboards/agenda.ts`, lee con
  el cliente del usuario (la RLS decide que ve cada quien). "Gasto de IA" ya no
  esta en el selector.
- **Ficha del contacto**: los datos se editan en el lugar (`InlineField`); el
  orden es Notas, datos por seccion, Seguimiento, Tags, Acciones rapidas.

# Formularios (construido)

Formularios personalizados, encuestas con NPS y contratos firmados: se arman con un
editor, se publican con un link, se embeben en cualquier web o se ponen en una pagina del
propio proyecto. Cada respuesta crea o vincula el contacto correcto con su atribucion
completa y puede disparar automatizaciones. El resumen del modulo esta en
[docs/formularios.md](docs/formularios.md); avance y decisiones en
`docs/PROGRESS-formularios.md` y `docs/PENDIENTE-formularios.md`.

## Lo que no se puede romper

- **La definicion publica sale SOLO por `get_public_form`** (lista blanca en la base). Nunca
  un `select` sobre `forms` con el cliente de servicio para armar lo que ve el publico. Nunca
  salen: el valor de un oculto `fixed`, la configuracion de exito, el mapeo ni los avisos.
- **La huella de un contrato es sobre el texto GUARDADO** (`form_versions.contract_text`), la
  calcula la base y la RPC la vuelve a verificar al firmar. Nada de lo que manda el navegador
  entra. Publicar una version nueva no toca las firmas de la anterior. La evidencia de una
  firma no se puede cambiar (trigger, tambien para el service role).
- **El interruptor "Vincular las respuestas con contactos"** es `contact_config.mode = 'none'`:
  la base (`submit_form_response` v5) no resuelve, crea ni actualiza ningun contacto, tampoco
  con un link firmado, aunque el servidor mande datos. Apagarlo no borra el mapeo. Una encuesta
  "una vez por contacto" necesita el vinculo prendido.
- **Un contacto se crea o se vincula por telefono, email, WhatsApp o un usuario de Instagram,
  TikTok, X o LinkedIn**, en ese orden de busqueda (`find_contact_for_form`, 00175); Facebook y
  YouTube solo se guardan. `find_contact_by_phone_or_email` NO se toca (la usa Ventas). Los
  usuarios se normalizan en UN solo lugar (`lib/contacts/social.ts`), igual a como estan
  guardados los contactos (sin "@" y en minusculas; LinkedIn como URL). El `instagram_username`
  de un contacto con canal de Instagram vinculado NUNCA se pisa desde un formulario.
- **El mapeo al contacto se guarda JUNTO con el borrador** (`saveFormDraft` recibe
  `contactConfig` y saca lo que ya no encaja) y se arma solo al agregar un campo
  (`autoMapOnFieldAdded`, nunca pisa uno elegido a mano).
- **Una version publicada no se puede cambiar** (trigger `form_versions_protect`, 00177,
  tambien para el service role; `published_by` solo puede pasar a NULL por el ON DELETE SET NULL).
- **El envio no usa captcha**; ver la regla de abajo.
- **La idempotencia es un indice unico** `(form_id, idempotency_key)`, no una comprobacion
  previa. "Una vez por contacto" es `(form_id, once_key)` y la clave guardada es `contact:<id>`.
- **La proteccion anti-spam es honeypot + tope por IP + idempotencia.** No hay captcha:
  publicar un formulario no depende de ninguna configuracion externa. Turnstile esta
  documentado para retomarlo en `docs/pendientes/turnstile-captcha.md`.
- **Las claves de atribucion estan en UN solo lugar: `lib/attribution/keys.ts`.** Es un
  superconjunto de la lista de la Agenda (que no se toca). Sumar una clave es sumarla ahi.
- **`service_id` y `sale_id` solo viajan dentro de un link firmado valido** (`signed-link.ts`);
  uno suelto en la URL o en el cuerpo se ignora.
- **Los eventos de automatizacion llevan solo escalares y nunca `booking_id`** (el cron trata
  como "reserva" cualquier payload con `booking_id` y se saltearia "no contactar").
- **El toque, el aviso y el correo van DESPUES del commit y en `try/catch`**: nada de eso
  tumba un envio. Los jobs de contratos no lanzan por un fallo de un proveedor: reagendan a
  +5, +15 y +30 minutos con `scheduleJob` (la cola reintentaria a los 10 s encima).
- **`find_or_link_contact`, `create_booking` y `record_contact_touch` no se modificaron.**
  `verify-forms.mjs` compara su `md5(pg_get_functiondef(...))` con el del punto de partida.
- **En un archivo `"use server"` todo lo exportado es una funcion asincronica** (los tipos
  van en otro archivo). Hay un test que lo atrapa.
- **`flows` no tiene `deleted_at`**: una consulta que lo filtre falla y la pantalla queda
  vacia o da 404.

## Reporte de fin de dia (EOD)

Un cuarto tipo de formulario (`eod`): cada persona del equipo completa al final del dia lo
que hizo; el de setters tiene canales y se usa todo el dia como contador. Resumen en
[docs/eod.md](docs/eod.md); avance en `docs/PROGRESS-eod.md`.

- **La persona que reporta sale SIEMPRE de la sesion** (`ctx.user.id` en la accion), nunca
  de un selector ni del navegador. Un EOD no tiene pagina publica (`get_public_form` y
  `loadPublishedForm` lo descartan).
- **La unicidad la da un indice** `(form_id, user_id, report_date)` y la revision (`rev`):
  `save_eod_draft` hace `UPDATE … WHERE rev = $rev` y devuelve `conflict` con lo vigente;
  doble clic o dos pestanas enviando = un solo reporte. No hay "select previo".
- **El borrador nunca se pierde**: servidor + `localStorage` en cada cambio, guardado al
  ocultar o cerrar la pestana (`/api/v1/eod/draft` con `keepalive`), reintentos y fusion de
  los "+1" por diferencia (`lib/eod/draft.ts`, con los cinco casos de E7 en su test). El
  reporte nunca cambia de fecha solo a medianoche.
- **Los borradores ajenos no los ve nadie** (RLS). Owner, Admin y `eod.view_all` ven los
  ENVIADOS de todos. La correccion en curso vive en `pending_edit`, que `authenticated` no
  puede leer: **nunca `select("*")` sobre `eod_reports`** con la sesion (falla).
- **El dia es el de la persona** (`user_preferences`), no el del workspace.
- **Todo se valida en el servidor** contra la version vigente con `validateSubmission`; lo de
  un canal no elegido no se guarda ni suma en `metrics`.
- **Flujos sin contacto.** Cada disparador declara `subject` (`contact` por defecto) y cada
  nodo `needsContact` (`registry/consistency.test.ts` lo exige; la lista del navegador es
  `lib/flow-engine/contact-free.ts`). `eod_submitted` es el unico `member`. El unico cambio
  en `engine.ts` es saltear (y anotar `node_skipped`) un paso que necesita contacto en un
  flujo que no tiene. El cron ramifica por sujeto con un `switch` (la rama de contacto no
  cambio; vive en `lib/flow-engine/automation-events.ts`). Guardar o publicar un flujo sin
  contacto con un paso que necesita uno se rechaza (`member-flow.ts`). Sin contacto,
  "no contactar" no aplica y el email va a la persona, al equipo o a una direccion fija.

## Scripts de verificacion

```
node scripts/verify-forms.mjs   # RLS, huella, la RPC, el envio real (Resend simulado), el PDF y la atribucion
node scripts/verify-eod.mjs     # EOD: RLS, unicidad, concurrencia, audiencia, revision, el evento, el flujo y el recordatorio
```

Crea y limpia sus datos (prefijo `zz-test-`); no se corre en simultaneo con los otros `verify-*`.

# Menu lateral y Formularios UI (construido, 13/10/2026)

Menu con la seccion **Herramientas** colapsable, Formularios rediseñado (lista de tarjetas, editor con lienzo y panel) y la **URL de entrada completa** en la atribucion. Plano en `requerimientos-formularios-ui-menu.md`, avance y decisiones en `docs/PROGRESS-formularios-ui.md` y `docs/PENDIENTE-formularios-ui.md`, detalle en [docs/formularios.md](docs/formularios.md) y [docs/atribucion.md](docs/atribucion.md).

## Lo que no se puede romper

- **El menu es `lib/nav/items.ts`**: grupos `inicio`, `adquisicion`, `ventas`, `servicio` y `herramientas` (Tareas, Automatizaciones, Formularios, Agentes IA, Ajustes; Tareas se mudo ahi desde los sueltos de arriba el 14/10/2026). Conocimiento ya no es un item: es un boton de la pantalla de Agentes IA (`lib/nav/page-actions.ts`). Recursos e Integraciones se llegan desde Ajustes. Ajustes aparece para quien pueda ver al menos una pestaña (`visibleSettingsTabs`, `lib/settings/tabs.ts`): un Member lo ve y lo lleva a Recursos.
- **El colapso de las secciones no pasa por React** (todas las que tienen título desde el 9/11/2026): clase `nav-open-<grupo>` en `<html>` + la misma clave en `localStorage` (siempre en `try/catch`) + el script del `<head>` (`sectionsOpenHeadScript`, `lib/nav/sections-open.ts`; sigue leyendo la vieja `nav-tools-open` para Herramientas). Al entrar a una pantalla, su sección se abre y queda guardada abierta; se cierra solo con su flechita, y abrir una nunca cierra otra (pueden quedar todas abiertas). Hasta hidratar, el servidor dibuja abierta la de la pantalla activa. **Una sección nueva suma su `@custom-variant open-<grupo>` en `app/globals.css` y su línea en `SECTION_HIDDEN_CLASS`** (`sections-open.test.ts` lo controla).
- **Pantalla favorita por sección** (00357, `user_preferences.nav_favorites`, por persona): el encabezado tiene dos zonas: **la flechita solo abre o cierra, nunca navega**; el resto del título, con favorita, es un link a ella y deja la sección abierta (`sectionTitleTarget`); sin favorita, o con una que la persona no ve, el título también solo abre o cierra. Lista blanca en `parseNavFavorites` / `isFavoriteCandidate` (un href de un ítem de ESA sección, nunca una URL libre); guarda `setNavFavorite` (`lib/actions/nav-favorites.ts`), la persona sale de la sesión. El menú lateral y el panel del teléfono comparten el estado (`components/nav-favorites-store.ts`).
- **«Servicio al cliente»** (grupo `servicio`, 9/11/2026): Clientes, Portal y Afiliados, entre Ventas y Herramientas. Sin el módulo de Servicios prendido muestra solo Afiliados.
- **El editor de un formulario es lienzo + panel** (`components/forms/builder/`, pestaña Campos). Las reglas son puras y viven en `lib/forms/` (`builder-ops`, `contact-map`, `publish-issues`, `canvas-view`, `editor-bar`, `list`, `form-card`); los componentes solo las componen. **Ni un `<details>` en `components/forms/editor` ni en `components/forms/builder`** (`components/forms/no-details.test.ts`). Escribir en una pregunta no puede redibujar las otras ni perder el foco (las tarjetas son `React.memo` y reciben acciones estables).
- **"Se guarda en el contacto" y la tabla de la pestaña Contacto son el mismo dato** (`contactConfig.map`, `setFieldMapping`): un dato del contacto lo usa una sola pregunta.
- **La pestaña del editor vive en `?tab=`** y se cambia con `window.history.pushState(null, ...)` (sin pedirle la pagina al servidor).
- **El formulario publico ya no muestra el logo** (`design.showLogo` queda guardado, nadie lo usa).
- **`entry_url`**: la direccion completa por la que entro la persona, con todos sus parametros menos los sensibles (`lib/attribution/sensitive-params.ts`), los internos y el `#`; tope de 2000. Se arma y se vuelve a sanear en UN solo lugar (`lib/attribution/entry-url.ts`), viaja en `form_submissions.attribution.entry_url` y en `contact_touches.entry_url`, y se ve en el detalle de una respuesta y en las visitas del contacto. **Nunca se loguea.** `landing_page` y `page_url` siguen filtradas, la lista de claves de `lib/attribution/keys.ts` no cambio y `contacts.attribution` (copia derivada) no la incluye.
- **Las columnas de la tabla de respuestas salen de `lib/forms/response-columns.ts`**, encima del catálogo común de `lib/attribution/columns.ts` (preguntas + atribución, con menú «Columnas»; lo elegido se guarda por tabla en `localStorage`, como diferencia con lo normal). La URL que se muestra es `bestEntryUrl`: `entry_url` o, si la web externa no la mandó, `landing_page` saneada.
- **`record_contact_touch` cambio A PROPOSITO en la 00215** y solo para escribir `entry_url` (misma firma, mismo comportamiento): su huella ahora es `2f51ddbf060e31528b89ce7481b38e3d` (la vieja era `f364db1862cc0f90291ca14ef855a214`; la definicion completa esta en la cabecera de la migracion y `lib/contacts/record-touch-00215-diff.test.ts` fija el diff). `create_booking` NO se toco: la Agenda manda la URL dentro de `p_utm` y llega por `raw.utm`.
- **El `embed.js` se regenera** cuando se toca `lib/attribution/` o `lib/embed/` (`npm run build:embed`, se commitea, tope 60 KB). El `attr` del embed admite hasta 4096 bytes.

## Migraciones

`00215` (`contact_touches.entry_url` y `record_contact_touch`), **aplicada y registrada** (14/10/2026 UTC). `00357_user_nav_favorites` (aditiva: `user_preferences.nav_favorites`, las favoritas del menú) puede ir antes o después del deploy: sin ella el menú anda igual, sin favoritas (la lectura cae a `{}`). **Aplicada y registrada** el 9/11/2026 UTC (versión `20261109074540`), después de ensayarla en una transacción que se deshizo sola. **La próxima libre es la `00358`** (confirmar con `list_migrations` y las ramas locales). **La proxima libre es la `00216`** (confirmar con `list_migrations`: la sesion de Equipo y roles uso la `00208` a la `00214`).

# Ventas Fase 1 (construido)

Catalogo de productos con precio versionado, atribucion y asignacion automatica de cada lead, alta de venta en tres pasos, pagos, mora, historial y triggers por cambio de estado. El resumen esta en [docs/ventas.md](docs/ventas.md); avance y decisiones en `docs/PROGRESS-ventas.md` y `docs/PENDIENTE-ventas.md`; triggers y nodos en [docs/flow-registry.md](docs/flow-registry.md).

## Lo que no se puede romper

- **`sales` y `payments` los escribe SOLO el servidor** (Server Actions con el cliente de servicio, despues de `getPermissionAction`); la app lee con la RLS (`can_see_sale`). Los tipos Update/Insert son `Record<string, never>`: se escribe con `as never`.
- **La plata va en centimos** (`lib/shared/money.ts`, `Number(x) || 0`). Siempre USD. La comision de **Whop esta en 0 %** hasta que Wendy confirme el porcentaje real.
- **El precio vive en la VARIANTE** (`product_variants.price`, USD, 0 = sin precio: no se vende). No hay tabla de versiones (se borro en la 00169): la venta guarda el snapshot congelado del producto y su precio, y el historial de cambios de precio vive en `audit_log`. `create_sale` compara el precio de la variante con el que mostro el asistente (`price_changed`). `products` reemplazo a `content_offers`, que se **borro en la 00171** (12/10/2026, despues de desplegar; respaldo en `docs/ventas/respaldo-content-offers.json`): ya no existe ni su puente.
- **El estado de la venta se deriva igual en SQL y en TypeScript** (`derive_sale_status` / `deriveSaleStatus`, mismos casos en `lib/sales/sale-status.cases.json`). Cuatro estados se escriben y ganan; un incobrable nunca deja llegar a `paid`.
- **Un cambio = un evento = una ejecucion por flow.** Los triggers de base emiten con un `change_id` y `pickCanonicalTrigger` (dentro de `eventMatches`) elige un trigger ganador. Los eventos llevan solo escalares y nunca `booking_id`.
- **Los pagos se tocan por un solo nucleo** (`lib/sales/payments-core.ts`, actor usuario o sistema), usado por las Server Actions y por los nodos de flow. Reembolso = fila NUEVA negativa `paid`.
- **La mora corre por SQL directo** (`private.enqueue_payments_overdue_sweep`, 00167), **no** por `call_app_cron`; solo encola si hay pagos candidatos. Los jobs de Ventas no lanzan por un fallo de proveedor: reagendan.
- **`audit_log_select` NO se reescribe**: el historial de Ventas es la politica ADICIONAL `audit_log_select_sales` (00168).
- **`submit_form_response` valida el `sale_id`** del link firmado (00164): uno suelto en la URL o el cuerpo se ignora. `find_or_link_contact`, `create_booking` y `record_contact_touch` no se tocaron.
- **El historial de `products` y `product_variants` lo escribe la BASE** (trigger `catalog_audit`, 00170): alta, estado, archivado, precio (`variant.price_changed` con `changes.price = {old, new}`) y el resto de los campos, venga el cambio de donde venga. `lib/actions/products.ts` NO llama a `logAudit` (`products-audit.test.ts` lo exige: duplicaria cada fila). Actor: `auth.uid()`, si no `updated_by`/`created_by`, si no `system`.
- **Los flujos de cobranza precreados** (cuatro, en borrador) se crean al abrir Ventas por primera vez (Owner/Admin), al prender la opcion y al crear un workspace; nunca con un backfill.

- **Tipos de producto (00263/00264, 24/10/2026)**: Programa, Mentoría / Consultoría / Asesoría, Curso, Evento, Servicio y Producto (`PRODUCT_TYPES`); «otro» paso a «producto». Lo que pide cada variante sale de `variantTiming` (`lib/catalog/products.ts`): duracion sin fecha (empieza el dia que compra cada cliente), evento con `product_variants.event_date` fija + duracion (nunca «de por vida»), producto sin duracion. Lo valida el SERVIDOR con el tipo del producto (`parseVariantInput(input, productType)`). La garantia ya no existe (la 00264 borro sus columnas). El inicio del servicio de una venta nueva es la fecha de la venta, o la del evento (`lib/sales/wizard/service-start.ts`).

## Migraciones

`00159` a `00171`, todas aplicadas y registradas: catalogo (00159, 00160), asignacion (00161), ventas y pagos (00162), FK de `sale_id` (00163), `submit_form_response` v4 (00164), bucket de comprobantes (00165), CHECK de `triggers.type` (00166), cron de mora (00167) politica de historial (00168), precio en la variante y baja de `product_versions` (00169) el historial del catalogo por trigger (00170) y el borrado de `content_offers` (00171). **La proxima migracion disponible es la `00172`** (confirmar con `list_migrations`).

## Scripts de verificacion

```
node scripts/verify-sales.mjs                          # bloques 1 a 4; --block N corre uno
node scripts/verify-audit-visibility.mjs --despues-de-00168
```

Mismas reglas que los demas: crean y limpian sus datos (prefijo `zz-test-`) y no se corren dos en simultaneo.

# Automatizaciones con condiciones (construido, 12/10/2026)

El nodo `branch` ("Condiciones") reparte un flujo por caminos según un dato, y el editor
de pasos (Cuándo / Solo si… / Pasos) lo arma desde Formularios y la Agenda sin pasar por
el canvas. Detalle en [docs/flow-registry.md](docs/flow-registry.md) (el nodo, los
operadores, `variableSchema`, `outputs`) y [docs/formularios.md](docs/formularios.md)
(cómo se arma, "Probar condiciones", la plantilla). Avance en
`docs/PROGRESS-automatizaciones-condiciones.md`, pendientes en `docs/PENDIENTE.md`.

## Lo que no se puede romper

- **El motor no se tocó.** `engine.ts`, `interpolate.ts`, `nodes/condition.ts` y el cron
  de `automation_events` siguen igual; todo entró por el registro. Sin migraciones.
- **Los caminos son handles**: `handle:<id del camino>` y `handle:else` ("Si no", que no
  se guarda y es siempre el último). El id es `p_xxxxxx`, no cambia nunca aunque se
  renombre o reordene el camino, y no puede ser `else`/`true`/`false`/`yes`/`no`.
- **Va por el primer camino que se cumple**, en el orden en que están; si ninguno, "Si no".
  Los de abajo ni se miran. Un campo que no se puede leer es "no se cumple", nunca un
  error: el nodo no lanza.
- **Ida y vuelta exacta árbol ↔ grafo** (`lib/automations/step-tree.ts`): `flowToTree` y
  `treeToFlow` conservan ids, tipos y datos de cada nodo (una sesión pausada en un
  "Esperar" no se pierde al guardar). Lo que no es árbol (fusión, ciclo, A/B, más de 3
  niveles) devuelve `null` y se edita solo en el canvas; el editor nunca guarda sobre eso.
- **Un solo evaluador**: `lib/flow-engine/condition-eval.ts`, puro, lo usan el nodo, el
  simulador, el panel y "Probar condiciones". Nadie arma su propia comparación. Se compara
  por tipo con el valor real; los seis operadores viejos del `condition` se evalúan con su
  semántica de siempre (`legacy-operators.ts`).
- **El `condition` viejo no se toca.** "Convertir a Condiciones" crea un `branch` nuevo
  (`conditionToBranch`); el original sigue funcionando igual.
- **`branch_taken` no guarda valores**: solo el camino y, por condición, qué campo y si se
  cumplió (pueden ser datos personales). Y un fallo al anotarlo nunca frena el flujo.
- **En Formularios el disparador es fijo.** Al guardar, el servidor lo toma de la base y
  solo acepta cambios en `answer_conditions` ("Solo si…", mismo formato de siempre,
  validado con `parseFormTriggerConfig`). Un paso que el editor no ofrece en esa pantalla
  solo se acepta si ya estaba guardado, igual. Todo pasa por `prepareTreeSave`: un árbol
  que viene de afuera (una plantilla, por ejemplo) se valida ahí.
- **Guardar un "Si" sin salida declarada ahora escribe `true`.** El motor nunca seguía
  esa arista (el flujo se cortaba en la condición); es el único caso donde guardar desde
  el editor nuevo cambia el comportamiento de un flujo, y está fijado en un test.
- **"Probar condiciones" no escribe nada**: la acción solo hace `select` con el cliente
  del usuario (la RLS decide qué respuestas ve) y la cuenta (`explainPaths`) usa el mismo
  `pickPath` que el nodo. Hay un test de paridad con el motor y otro con espías.
- Una condición sobre `answer.*` lee la respuesta con la definición **de la versión con la
  que se respondió**: una pregunta que ya no está = "ya no existe" (no se cumple), distinto
  de "no respondida" (vacía).

# Tareas (construido, 13/10/2026)

Tareas del equipo: responsable, seguidores, proyecto como texto, fechas y dependencias; tabla y tablero, edicion en la celda y drawer, avisos en la campana, y creacion desde la ficha del contacto, la bandeja, los flujos y el agente. Resumen en [docs/tareas.md](docs/tareas.md); plan y avance en `docs/PROGRESS-tareas.md`, pendientes en `docs/PENDIENTE-tareas.md`, triggers y nodo en [docs/flow-registry.md](docs/flow-registry.md).

## Lo que no se puede romper

- **Una sola tabla nueva: `tasks`.** El proyecto es texto (`project` + `project_key` normalizada), no una tabla. Se borra con `delete_task` (borrado logico): no hay DELETE directo ni policy de DELETE.
- **`can_see_task` devuelve siempre true o false, nunca NULL** (un NULL deja pasar un `NOT (...)` en plpgsql: ya paso y se arreglo con COALESCE). Lo ve quien es miembro Y (Owner/Admin, la creo, la tiene a cargo, la sigue, o tiene `tasks.view` con alcance `all`).
- **`has_permission()` es siempre falso para el Member de sistema**: las policies de escritura usan el patron de la 00150 (`role_id IS NULL OR system_role = 'member' OR ...`). Un Member crea y edita (`tasks.view` + `tasks.edit`, alcance `own`); no borra.
- **El cliente no escribe `workspace_id`, `source`, `source_ref`, `blocked_by`, `deleted_at` ni `created_by` al actualizar** (privilegios por columna). `blocked_by` solo cambia por `set_task_blockers`.
- **La regla de fechas es una funcion pura** (`lib/tasks/date-rules.ts`, `computeDateShifts`): solo atrasa, nunca adelanta, y propaga en orden topologico. La RPC `complete_task_with_shifts` **no recalcula**: valida y aplica en una transaccion, y devuelve `stale` si cambio algo desde la vista previa. El plan se arma solo con las tareas que la persona ve.
- **La logica de pantalla vive en `lib/tasks/*`** (modelo de tabla, edicion de celdas, URL, tablero, filtros). Los componentes la componen; el nucleo de las acciones es `lib/tasks/core.ts` (recibe los clientes, lo prueba `verify-tasks`). En `lib/actions/tasks.ts` (`"use server"`) todo lo exportado es una funcion asincronica.
- **Avisos**: `recipient_id` siempre concreto y **nunca quien hizo el cambio**; `task_changed` con `createNotificationOnce` (10 min por persona); todo en try/catch, un aviso nunca tumba una tarea. `can_see_notification` no se toco.
- **El barrido de vencimientos corre por SQL directo** (`private.enqueue_tasks_due_sweep`, 00198), **no** por `call_app_cron`; encola un job por workspace y dia local, desde las 08:00 locales y solo si hay candidatas. El handler avisa **una vez por tarea y fecha de vencimiento** (`metadata.due_date`): es idempotente. Los jobs de Tareas no lanzan por un fallo de un proveedor.
- **`audit_log_select` NO se reescribe**: el historial es la politica ADICIONAL `audit_log_select_tasks` (00197).
- **Todo lo automatico entra por `createTaskFromAutomation`** (`lib/tasks/create-from-automation.ts`): captura sus errores y nunca frena lo que lo origina. Una tarea abierta por `source` + `source_ref` (indice unico parcial).
- **El agente tiene `crear_tarea`, y NO se toco `programar_seguimiento` ni `contacts.next_followup_date`**: el seguimiento es volver a escribirle al lead; una tarea es trabajo de una persona.
- **«Crear una tarea al derivar a una persona» esta APAGADO por defecto** (`guardrails.escalation.createTaskOnEscalate`). Con el interruptor apagado `escalateToHuman` hace exactamente lo de siempre (`escalate-characterization.test.ts`).
- **Los triggers `task_completed` / `task_overdue` funcionan con y sin contacto** (`contactOptional`): con contacto, el camino de siempre; sin contacto, el evento viaja con la persona a cargo (responsable, si no el creador, si no quien actuo) y el flujo corre sin contacto. Si no hay ninguna persona, no se emite. Los eventos llevan solo escalares y nunca `booking_id`; emitir nunca rompe lo que lo origina.
- **`processEvent` decide por la FILA solo para los tipos que lo declaran** (`eventAllowsNoContact`): cualquier otro evento sigue por `eventSubject`. `automation-events-routing.test.ts` lo fija.
- **No se tocaron** `find_or_link_contact`, `record_contact_touch`, `create_booking` ni `linkContacts` (la fusion de contactos no reapunta las tareas: ver `docs/PENDIENTE-tareas.md`).
- **La unica dependencia nueva es `@tanstack/react-table` en la linea 8** (8.21.3): un `npm i` sin version trae la 9, que tiene otra API.

## Migraciones

`00196` (tabla, RLS, `can_see_task`), `00197` (RPC y politica del historial), `00198` (cron) y `00199` (CHECK de `triggers.type` + eventos sin contacto), todas **aplicadas y registradas**. La `00199` lleva en su cabecera las dos definiciones viejas de las restricciones, leidas de la base. **La proxima migracion disponible es la `00200`** (confirmar con `list_migrations`).

## Scripts de verificacion

```
node scripts/verify-tasks.mjs                  # RLS, privilegios, ciclos, atomicidad, nucleo, cron, avisos y disparadores (--hasta N corre hasta esa migracion)
node scripts/verify-audit-visibility.mjs --despues-de-00168
```

Mismas reglas que los demas: crean y limpian sus datos (prefijo `zz-test-`) y no se corren dos en simultaneo.

# Contactos: regla unica (construido, 13/10/2026)

Todo contacto nuevo nace en UN solo lugar, con bloqueo por dato: dos llegadas simultaneas de la misma persona dan un contacto. Resumen en [docs/contactos.md](docs/contactos.md); plan y avance en `docs/PROGRESS-contactos.md`, pendientes en `docs/PENDIENTE-contactos.md`.

## Lo que no se puede romper

- **Un dato fuerte** es lo que identifica a una persona: el canal con el id del remitente, el telefono, el WhatsApp, el email (y el secundario) y los usuarios de Instagram, TikTok, X, LinkedIn y Facebook. **Nunca el nombre.** Se normalizan siempre igual (`lib/contacts/identity.ts` y su gemela SQL, con los casos compartidos de `identity.cases.json`).
- **Todo pasa por `find_or_create_contact` (00200) / `lib/contacts/find-or-create.ts`** (`findOrCreateContact`; `findContact` para solo buscar), siempre con el cliente de servicio: quien llama ya chequeo el permiso y saca el workspace de la sesion. Los mensajes entrantes, la agenda y los formularios la usan desde la base (`find_or_link_contact` v3, `create_booking` v3, `submit_form_response` v6); los buscadores (`find_contact_for_form`, `find_contact_by_phone_or_email`) comparten su busqueda y no crean.
- **Ningun archivo de la app inserta en `contacts`.** `lib/contacts/single-entry.test.ts` falla si aparece un `.from("contacts").insert/upsert`, y `scripts/verify-contacts-single-entry.mjs` comprueba contra la base que ninguna funcion salvo la central inserta en `contacts`, que las cuentas SQL y TS coinciden y que 10 llamadas simultaneas dan un contacto.
- **Un error de la base nunca se toma como "no encontrado"** (eso crearia un duplicado): `findOrCreateContact` lanza y quien llama decide.
- **Solo el alta manual** puede crear un contacto con el nombre solo (`allowWithoutIdentity`). La agenda sin email ni telefono se rechaza (`CB001`).
- **Un telefono o email que ya es de OTRO contacto no se escribe** al completar (formulario, agenda, CSV, webhook, mensaje entrante); se anota el conflicto. En la ficha, al restaurar y al fusionar, error claro (`lib/contacts/unique-errors.ts`). `linkContacts` borra al duplicado ANTES de rellenar el principal.
- **El alta manual de un Member** con un dato que es de un contacto que no ve responde sin enlace ni nombre ("Pedile a un Admin que te lo asigne").
- **Funciones reescritas a proposito**: `find_or_link_contact` (00202), `create_booking` (00203) y `submit_form_response` (00204), cada una con la definicion vieja completa en la cabecera y `lib/contacts/c2-migrations-diff.test.ts` fijando el diff. `record_contact_touch` NO se toco (`verify-forms` y `verify-ads-attribution` controlan su huella).
- **Indices unicos del telefono y el email principal** (`00205`, `uq_contacts_workspace_phone` / `_email`, solo contactos vivos): **aplicados y registrados** (version `20261013235958`; comprobado en la base el 21/10/2026).

## Migraciones

`00200` (la central y `normalize_phone`), `00201` (los buscadores sobre la busqueda compartida), `00202` (`find_or_link_contact` v3), `00203` (`create_booking` v3) y `00204` (`submit_form_response` v6), **aplicadas y registradas**. La `00205` (indices unicos) tambien esta **aplicada y registrada** (version `20261013235958`). La `00206` y la `00207` son de Tareas. **La proxima migracion disponible es la `00208`** (confirmar con `list_migrations`).

# Tareas × CRM (construido, 13/10/2026)

Las tareas se conectan con el CRM y la Agenda: seccion «Tareas» en la ficha y la bandeja, «Proximo seguimiento» con «Crear tarea», cobranza automatica,
hora y duracion, tareas en el calendario, arrastre de agendas y fusion real de contactos. Resumen en [docs/tareas.md](docs/tareas.md) y
[docs/contactos-fusion.md](docs/contactos-fusion.md); nodos en [docs/flow-registry.md](docs/flow-registry.md); avance y decisiones en
`docs/PROGRESS-tareas-crm.md` y `docs/PENDIENTE-tareas-crm.md`.

## Lo que no se puede romper

- **La fusion de contactos es `merge_contacts` (00207), una sola transaccion, solo `service_role`.** Cubre las 25 relaciones de `CONTACT_MERGE_TABLES` (la 00247 suma `contact_status_changes`)
  (`lib/contacts/merge.ts`). **Una tabla nueva con `contact_id` se suma a la funcion y a esa lista en el mismo cambio**: `verify-contact-merge.mjs`
  lee el catalogo y falla si falta una. `linkContacts` sigue siendo Owner/Admin y delega con el cliente de servicio. Despues de fusionar se va a la ficha
  del principal (el duplicado queda borrado), con el resultado como cuentas en la URL.
- **La regla de fechas es del SISTEMA, no de lo que la persona ve.** Completar un bloqueante corrige a TODAS sus dependientes transitivas
  (`task_shift_context`); los permisos no cambian (hay que poder editar y ver ESE bloqueante). Lo que la persona no ve se resume sin titulo, y sus
  dueños reciben `task_date_moved`. `complete_task_with_shifts` rechaza todo corrimiento fuera del arbol de dependientes.
- **La identidad de una tarea automatica es su `source_ref`**: `followup:AAAA-MM-DD` (indice unico `uq_tasks_followup`, incluye completadas) y
  `payment:<id>` (clave del nodo). El dia del seguimiento se decodifica con la zona del **workspace**. `contacts.next_followup_date` y
  `programar_seguimiento` no se tocan; cambiar o quitar la fecha no toca ninguna tarea.
- **El interruptor «Crear una tarea cuando un pago vence» no tiene columna**: el estado es si el flujo `task_payment_overdue` esta publicado.
  `ensureTaskPaymentFlows` es idempotente y no pisa un grafo editado. Los flujos no estan en `SALES_TEMPLATE_KEYS`.
- **`complete_task` solo cierra tareas con `source_ref` igual a su clave** y no mueve fechas. `create_task` con `sourceKey` descarta la clave si
  una variable no se resuelve.
- **Hora y duracion son opcionales** (`due_time`, `duration_minutes`); las reglas siguen siendo POR DIA, nunca por hora. Borrar la fecha borra la hora.
- **Las tareas se arrastran SIN confirmar (con «Deshacer»); las agendas SIEMPRE con el modal.** `rescheduleBooking` y `rescheduleAsHost` no se
  tocaron. Con el interruptor «Tareas» apagado el calendario no consulta nada de tareas y es identico al de antes.
- **`FollowupField` sin las props nuevas se ve igual** (`followup-field.characterization.test.ts`).
- **Sin dependencias nuevas** en esta tanda.

## Migraciones

`00206` (hora, duracion, indice unico del seguimiento) y `00207` (`merge_contacts`, `task_shift_context`, `complete_task_with_shifts` nueva), **aplicadas y
registradas**. Las `00200` a `00205` son de la sesion de contactos (regla unica). **La proxima libre es la `00208`** (confirmar con `list_migrations`).

## Scripts de verificacion

```
node scripts/verify-contacts-single-entry.mjs   # la regla unica: base, SQL↔TS, concurrencia, buscadores, 00205
node scripts/verify-tasks.mjs           # incluye los bloques de 00206, la cobranza de punta a punta y 00207
node scripts/verify-contact-merge.mjs   # fusion real, atomicidad, guardia de deriva
```

Mismas reglas que los demas: crean y limpian sus datos (prefijo `zz-test-`) y no se corren dos en simultaneo.

# Tablas del sistema: DataTable y vistas guardadas (10/11/2026)

Toda tabla con columnas se arma con `DataTable` (`components/ui/data-table/`): columnas que se prenden, apagan, reordenan, fijan y ensanchan, totales al pie sobre todo el filtro y **vistas guardadas** por persona (privadas, para el equipo o para personas elegidas; una predeterminada, que Owner y Admin pueden dejar a otras personas). Estrenado en Ventas y Pagos; el resto se migra por tandas. Cómo armar una: [docs/tablas.md](docs/tablas.md).

## Lo que no se puede romper

- **Una tabla nueva no se arma con `<table>` a mano**: `lib/ui/data-table/no-raw-table.test.ts` falla si aparece (la lista `LEGACY` son las que faltan migrar; al migrar una, se saca).
- **Las preferencias de columnas se guardan como diferencia con lo normal** (`lib/ui/data-table/prefs.ts`): una columna nueva aparece sola, lo desconocido se ignora y **nunca se renombra la `key` de una columna**.
- **Los totales son de TODO el filtro, no de la página**, en céntimos, brutos, y un dato que no existe es «—». PostgREST corta cada respuesta en 1.000 filas: siempre `fetchAllPages`.
- **Las vistas las escribe SOLO la base por funciones** (`save_table_view`, `delete_table_view`, `set_table_view_default`, migración 00360, SECURITY DEFINER): compartir y asignar predeterminadas a otras personas es de Owner y Admin **por su rol** (sin clave en el catálogo de permisos). La app lee con la RLS: un Admin no ve las privadas de otra persona. `scripts/verify-table-views.mjs` lo prueba.
- **La vista activa vive en la URL** (`?vista=<id>`, `?vista=base` = la del sistema); sus filtros se aplican al elegirla o cuando la URL llega pelada. Todo link de la pantalla preserva `?vista=` (`withViewParam`).
- **Lo que se ajusta sin guardar** vive en `localStorage` (`ssa:table:<tabla>:<vista>`, siempre en `try/catch`) hasta que la persona lo guarda en una vista.

## Migración

`00360_table_views` (aditiva: tres tablas y tres funciones) va **ANTES** de desplegar el código (las pantallas leen las tablas; sin ellas la tabla anda con las columnas del sistema y guardar una vista falla): **aplicada y registrada** el 11/11/2026 (versión `20261111185016`), después de ensayarla en una transacción que se deshizo sola, con `verify-table-views` en verde. **La próxima libre es la `00361`** (desde A2 de Servicios, la `00364`; confirmar con `list_migrations` y las ramas locales).

# Sitio publico

Las paginas publicas del propio proyecto viven en `app/(sitio)/` y se arman **a pedido con
Claude Code** (no hay editor visual). Guia completa en [docs/sitio.md](docs/sitio.md).

- La home (`app/(sitio)/page.tsx`) **por defecto redirige a `/login`**. Cada clon la reemplaza
  por la suya.
- Las paginas son **estaticas o con cache: no leen la sesion**. No pueden llamarse como una ruta
  reservada: `dashboard`, `login`, `auth`, `invite`, `api`, `calendario`, `f`, `embed`, `l`, `baja`, `recuperar`, `restablecer`.
- Cada pagina nueva se suma a `lib/site/pages.ts` (sitemap y `robots`). `robots.txt` **sigue
  bloqueando todo** salvo esas paginas y lo que necesitan los lectores de vista previa (`lib/og/robots.ts`).
- Un formulario se pone con `<Formulario slug="…" />`: muestra siempre la version publicada
  (cache por etiqueta `form:<slug>`; publicar, pausar, archivar o cambiar el link la invalidan).
- **Son de cada clon**: `scripts/export-template.mjs` no copia `app/(sitio)/` ni `public/sitio/`;
  copia la version por defecto de `scripts/template-files/sitio/`.
- La atribucion viaja entre paginas: cookie `ssa_attr` en el sitio y `localStorage` en una web
  externa con el mismo `embed.js` (modo `data-agenda-track`).

# La tarjeta al compartir un link (6/11/2026, sin migracion)

Un link de agenda (`/calendario/<usuario>/<evento>`) o de formulario (`/f/<slug>`) muestra titulo, descripcion e imagen con la marca del negocio que lo comparte. La imagen se genera sola: 1200 x 630, con logo o inicial, titulo y color. Detalle en [docs/agendamiento.md](docs/agendamiento.md) y [docs/formularios.md](docs/formularios.md).

- **La marca sale del workspace del evento o del formulario** (`resolveBrand`). Si no se puede leer, no hay tarjeta: mejor eso que el logo de otro negocio. Nada de marca escrita en el codigo.
- **Lo comun vive en `lib/og/`**, no en `lib/forms`: la plantilla de estudiantes no tiene Formularios. Cada modulo arma lo suyo en su `share-preview.ts`.
- **La imagen es `<pagina>/preview.png`**: publica, con tope por IP y 404 igual que su pagina. La terminacion `.png` evita el middleware de sesion. Su URL lleva `?v=`, un hash de lo que se dibuja: si cambia el dibujo de `lib/og/image.tsx`, subir `IMAGE_REVISION`.
- **El logo siempre se convierte a PNG con `sharp`.** Uno que no se puede bajar o leer deja la inicial, y uno claro con transparencia va sobre fondo oscuro (`logoPlate`).
- **`htmlLimitedBots: /.*/` en `next.config.ts` no se saca**: sin eso Next manda las etiquetas al final a quien no esta en su lista, y no se sabe con que identificador preguntan Evolution o WhatsApp Web.
- **`robots.txt` tiene un grupo para los lectores de vista previa** (`lib/og/robots.ts`): pueden leer `/calendario/`, `/f/` y `/l/`, nunca `/calendario/agenda/` (ahi la URL es una credencial). Las paginas siguen con `noindex` y el resto de los robots sigue bloqueado.
- **Una tarjeta nunca cambia por `?c=` ni `?preview=1`**: un link firmado no personaliza nada y un borrador no tiene tarjeta.

# Respuestas de formularios: país, buscar, filtrar y agrupar (7/11/2026, sin migración)

Barra en una fila (buscar, fecha, Filtros, Agrupar por, Columnas, Exportar), columna «País» del teléfono y resumen por país, fuente, medio, campaña o contenido. Detalle en [docs/formularios.md](docs/formularios.md) («Respuestas: país, buscar, filtrar y agrupar»).

- **El país de un teléfono sale de `countryFromPhone`** (`lib/phone-country.ts`): prefijo más largo, +1 por código de área, +7 por 76/77. `lib/scheduling/phone-countries.ts` es otra cosa (la lista del selector).
- **Tabla y CSV van por `loadFormResponses`**: estado, contacto y fecha en la consulta (RLS de quien mira); búsqueda, país y UTM en `filterIndex`. Si se cambia un filtro, se cambia ahí y los dos lo ven igual.
- **Respuestas arranca en el Histórico** (`RESPONSES_DEFAULT_PERIOD`). `readDashboardPeriod` / `applyPeriodToParams` / `DashboardPeriodControl` aceptan `defaultPreset`; sin pasarlo, siguen en 30 días.
- **Agrupar: la suma de los grupos es el total** (lo vacío va a `__none`).

# Webhooks, atribucion y anuncios (Extra L, construido el 13/10/2026)

Webhooks entrantes con flujos que arrancan sin contacto, atribucion que no pierde nada, catalogo de Meta, el vinculo de cada toque con su
campaña, conjunto y anuncio, y la tabla Meta vs CRM. Resumen en [docs/webhooks.md](docs/webhooks.md), [docs/atribucion.md](docs/atribucion.md),
[docs/flow-registry.md](docs/flow-registry.md) y [docs/dashboards.md](docs/dashboards.md); avance y decisiones en `docs/PROGRESS-atribucion.md` y
`docs/PENDIENTE-atribucion.md`.

## Migraciones (`00186` a `00195`, todas aplicadas y registradas)

`00186` (`webhook_endpoints` e `inbound_webhooks`), `00187` (`flow_sessions.inbound_webhook_id`, CHECK de tres vias, `triggers.type` + `webhook_received`),
`00188` (`contact_touches.origin` + `webhook`), `00189` (`messages.origin_context`), `00190` (`create_booking` pasa el anuncio y los extras al toque),
`00191` (catalogo de Meta, `meta_name_key`, bucket `ad-creatives`), `00192` (vinculo toque ↔ anuncio: columnas, `resolve_meta_match`, trigger,
`contact_touch_json`, `refresh_contact_attribution`, `rematch_meta_touches`, `set_touch_meta_match`), `00193` (backfill), **`00194` (corrige la 00192: solo
cuentan los toques que pueden traer datos de anuncio)** y `00195` (`ads_crm_metrics`). **La proxima libre es la `00196`.** Las huellas de
`record_contact_touch`, `find_or_link_contact`, `find_contact_for_form` y `submit_form_response` no cambiaron (`verify-ads-attribution.mjs` compara la primera).

## Lo que no se puede romper

- **El receptor guarda ANTES de procesar y nunca loguea el token, el secreto ni el payload.** El orden de las validaciones es parte del contrato
  (`lib/webhooks/receive.ts`): forma del token sin tocar la base → endpoint → secreto → tope → tamaño → parseo → idempotencia → guardar → responder.
- **El token de un endpoint es una credencial**: `authenticated` no puede leer `webhook_endpoints.token` (privilegio por columna). **Nunca `select("*")`
  sobre `webhook_endpoints` con la sesion.** Las pantallas leen con el cliente de servicio DESPUES de chequear el permiso en TypeScript
  (`has_permission` en SQL es false para el Member de sistema).
- **Un flujo de webhook arranca sin contacto** (`subject: "webhook"`, `contact_id` null con `inbound_webhook_id`). Un paso con `needsContact` solo
  puede ir DESPUES de «Crear o actualizar contacto», en TODOS los caminos; se valida al **publicar** (`contact-requirement.ts`). El motor saltea
  (no corta) un paso sin contacto y lo anota. `webhook_received` no tiene `eventTypes`: el cron de `automation_events` nunca lo levanta.
- **«Crear o actualizar contacto» escribe sobre el workspace del ENDPOINT, nunca el del payload**, busca por telefono/email/redes (jamas por nombre),
  no pisa el @ de Instagram de un contacto con canal vinculado y no fusiona contactos. El toque va en `try/catch`.
- **La atribucion nunca tumba nada**: `recordTouch`, el trigger `contact_touches_meta_match` y el sync de catalogo no pueden hacer fallar el insert de un
  toque, un mensaje o un sync de metricas. El trigger esta envuelto en `EXCEPTION WHEN OTHERS` (deja `none` y un `RAISE WARNING`).
- **`resolve_meta_match` (SQL) y `resolveMetaMatch` (TS) son gemelas**: los casos de `lib/attribution/meta-match.cases.json` corren contra las dos. Si se
  cambia una regla, se cambia en las dos y se suma el caso. **Solo cuentan como datos de Meta** los ids, el `fbclid` y, si el toque puede traer UTMs
  de verdad (agenda, formulario, webhook, import, manual) o ya trae un id de anuncio, `campaign`/`content_label`/`term`: en un comentario o DM
  organico `content_label` es el titulo de la publicacion (00194, `touchMetaInput`).
- **El vinculo automatico NUNCA pisa un `manual` ni un `ignored`** (ni el trigger, ni `rematch_meta_touches`, ni el sync). Vincular, ignorar y quitar van
  por `set_touch_meta_match` (atomica: actualiza el toque y recalcula `contacts.attribution`) desde `lib/actions/meta-match.ts`, que exige
  `settings.manage`, que el toque sea del workspace de la SESION y que quien vincula pueda ver el contacto; queda en `audit_log`.
- **`contacts.attribution` es una copia derivada**: `private.refresh_contact_attribution` usa el mismo orden que `record_contact_touch`
  (`occurred_at`, `created_at`, `id`). `meta_match_status` solo se escribe ahi cuando no es `none`.
- **El catalogo de Meta nunca se borra** y el sync de entidades es independiente del de metricas (un fallo de uno no frena al otro). Un tope de paginas o el
  limite de uso cortan el sync y lo anotan en `integration_configs.config.ad_accounts[].last_error` (**no en silencio**); `catalog_synced_at` solo avanza
  con un catalogo completo. El upsert de anuncios NO manda `social_post_id`, `content_post_id`, `content_link_manual`, `thumbnail_path` ni
  `thumbnail_attempts` (no pisa un enlace manual ni una miniatura bajada). Los jobs de miniaturas no lanzan: reagendan a 1 y 5 minutos.
- **`ads_crm_metrics` es SECURITY INVOKER**: la RLS de quien mira decide que cuenta. No se la pasa a DEFINER para ganar velocidad (a 10.000 toques en
  90 dias tarda ~0,9 s bajo RLS; la salida es una politica de lectura mas barata, con aprobacion). Una division por cero es «—» (null), nunca 0; la plata
  del CRM va en centavos y se pasa con `fromCents`; el Total calcula los cocientes sobre los totales.
- **La pantalla Anuncios (`/dashboard/anuncios`, menú → Adquisición) es la misma tabla del dashboard**, con el mismo permiso y la misma consulta (`loadCrmForRows`): si se cambia una, cambian las dos.
- **El desglose de anuncios es siempre la tabla de `crm-table.tsx`** (dashboard, detalles y Anuncios), con las columnas por nivel. Lo que devuelve el CRM es de toda la cuenta: un detalle la filtra con `scope` (`filterByParent`), y entonces «Leads totales» del total se pide para lo que se ve (igual con cualquier filtro). El dashboard y los detalles usan `CrmLevelTable`; **Anuncios arma la misma tabla con `useCrmLevelTable` + `CrmLevelBody` y lleva pestañas, buscador, estado, Filtros, Columnas y Exportar a la barra superior**, todo en la URL (`lib/dashboards/ads-table-filters.ts`, `ads-drill.ts`). En Anuncios un clic en una fila abre un menú y baja de nivel sin salir; en el resto lleva al detalle. En las tres, el encabezado ordena y fija columnas (`ads-table-view.ts`, fijas en `localStorage`) y las métricas de eficiencia se pintan contra la mediana de lo que se ve (`ads-tone.ts`, ±20 %, nunca volúmenes ni el Total). Detalle en docs/dashboards.md («La barra superior», «Ordenar, fijar columnas y el semáforo»).
- **El funnel de un detalle sigue la optimización del AdSet** (`lib/dashboards/ads-funnel.ts`): cambian solo los pasos de Meta; los leads (Meta y CRM contra el mismo paso), agendas y ventas son iguales en todos, y desde los leads se calcula sobre el CRM. Las visitas al perfil solo vienen en `results` de Meta y se guardan en `actions` como `result:<indicador>`.
- **Los tooltips de los gráficos usan `TOOLTIP_TEXT`** (`ads-charts.tsx`): sin `itemStyle`, recharts pinta de negro lo que no trae color y no se lee en el tema oscuro.
- **Alcance y Frec. de cada fila los da Meta en vivo, los dos de la misma respuesta** (`fetchObjectReach`), y solo se piden si esas columnas están a la vista (`loadCrmObjectReach`). No calcular la frecuencia con las impresiones guardadas: lo guardado llega hasta el último sync y daría menos de 1. Lo que Meta no dio es la suma de los días y se ve con «≈» (`CrmRow.reachIsSum`). **El valor de compras usa un solo nombre, igual que el conteo** (`purchaseValueOf`); lo guardado antes del 6/11/2026 no se puede recontar sin releer de Meta (pasos en docs/dashboards.md).
- **La Frecuencia de las tarjetas también es la de Meta** (`fetchUniqueReach`, tercer parámetro de `computeTotals`): con alcance en vivo nunca se divide lo guardado, y si Meta no la dio es «—». La variación del período anterior pasa por `computePreviousTotals` en el dashboard y los detalles: alcance en vivo contra sumado no se compara.
- **Un solo selector de fechas en los dashboards** (`PeriodPopover`). Meta Ads, sus detalles, Anuncios, Contenido y Unificado leen el período con `lib/dashboards/period-filter.ts` y lo dibujan con `DashboardPeriodControl`: `range`, `from` y `to`; `periodo` se sigue leyendo solo por links viejos. Un link entre pantallas de anuncios lleva `periodQuery`, o el rango a medida se pierde sin avisar. **`loadAdsInsights` lee de a páginas**: PostgREST corta en 1.000 filas sin avisar.
- **El dashboard de Anuncios pide `dashboards.ads.view`, no el cargo.** Las cuentas publicitarias (`integration_configs`) se leen con el cliente de servicio
  filtrado por el workspace de la sesion. `meta_ads_insights_daily` tiene una politica ADICIONAL de lectura por permiso (00191); la de Owner/Admin no se toco.
- **`localStorage` siempre en `try/catch`** (el selector de columnas): sin el, las columnas por defecto.
- **La atribucion en el navegador sigue siendo una sola lista de claves** (`lib/attribution/keys.ts`); la agenda las manda todas y completa `fbp`/`fbc` desde las cookies.
  Si se toca `lib/embed/*` hay que regenerar y commitear `public/embed/embed.js` (< 60 KB).

## Scripts de verificacion

```
node scripts/verify-inbound-webhooks.mjs   # RLS, token oculto, unicos, y el receptor de punta a punta si la app corre en local
node scripts/verify-ads-attribution.mjs    # catalogo, RLS, paridad SQL↔TS (29 casos), trigger con error forzado, re-vinculo, ads_crm_metrics y su costo
```

`verify-rls.mjs --despues-de-00143` y `verify-roles.mjs --despues-de-00136` son los que corresponden hoy. Mismas reglas que los demas: crean y limpian sus datos
(prefijo `zz-test-`) y no se corren dos en simultaneo.

# Vínculo con Meta: siempre por id (6/11/2026)

Reuniones y respuestas muestran su atribución y su vínculo con campaña, conjunto y anuncio, y se pueden vincular a mano desde donde se las mira. Detalle en [docs/atribucion.md](docs/atribucion.md) («Vínculo con Meta: siempre por id»).

## Lo que no se puede romper

- **Un nombre solo vincula si es único** (desde la 00318, ver «Conciliación de anuncios»). Dos campañas o anuncios pueden llamarse igual. Un anuncio por nombre, solo si es único dentro del conjunto o la campaña ya hallados. Si el conjunto tiene un solo anuncio, ese (`adset_single_ad`), salvo que haya llegado un id de anuncio que no está en el catálogo. Gemelas `resolve_meta_match` y `resolveMetaMatch`, con `meta-match.cases.json`.
- **Un toque sin ids cuya fuente no es de Meta y con UTMs de texto queda `none`**: no ensucia «Sin vincular». `utm_id` numérico cuenta como id de campaña (`raw.utm_id` en un formulario, `raw.utm.utm_id` en una reunión).
- **El toque es la ÚNICA fuente del vínculo.** Ni `form_submissions` ni `bookings` tienen columnas de Meta; se unen por `dedupe_key` (`form:<id>`, `booking:<id>`, `lib/attribution/source-touches.ts`), con el cliente de servicio y solo para filas que la persona ya leyó con su sesión: quien atiende una reunión puede no ver el contacto.
- **Una reunión sin vínculo propio muestra el último toque con vínculo del contacto anterior a ella**, aclarándolo, igual que `ads_crm_items`. Vincularla no cambia ese toque viejo: le crea el suyo (`linkBookingToMeta`).
- **`rematch_meta_touches` nunca empeora un `matched`**, y sigue sin tocar `manual` ni `ignored`.
- **Lo común vive en `lib/attribution` y `components/attribution`**, no en `lib/forms`: la plantilla de estudiantes no tiene Formularios y sí Agenda.
- **Todo lo que la Agenda guarda de más va dentro de `bookings.utm`** (`bookingUtmPayload`): `create_booking` no cambió.

## Migración

`00299_meta_match_ids_only`: cambia a propósito la huella de `resolve_meta_match`. Se puede aplicar antes o después del código. Lo existente se vincula con el próximo sync o con `select public.rematch_meta_touches(<workspace>, '-infinity')`. **La próxima libre es la `00300`** (confirmar con `list_migrations` y las ramas locales).

# A qué anuncio cuenta una venta (6/11/2026)

En la tabla Meta vs CRM, una venta sin anuncio en su toque cuenta para el último toque con anuncio anterior a ella. Detalle en [docs/dashboards.md](docs/dashboards.md) («A qué anuncio cuenta una venta»).

## Lo que no se puede romper

- **Una venta `manual` nunca hereda**: es la decisión de una persona. Hereda solo `last_touch` o `none`.
- **Solo la tabla decide al leer** (`ads_crm_items`, `v_sale_touch`): `sales.attribution`, `attribution_touch_id`, `create_sale`, la ficha y las comisiones no cambiaron.
- **Ventas, UF cash y Cash salen de la misma búsqueda**: el Cash ya no tiene cruce propio en `ads_crm_metrics_v2`. `cash` es una métrica interna de `ads_crm_items`: `ads_crm_cell_detail` la rechaza.

## Migración

`00302_ads_crm_sales_fallback` (misma firma, ninguna tabla; la definición vieja en su cabecera) puede ir antes o después del deploy: **aplicada y registrada** el 6/11/2026 (versión `20261107011534`), con `verify-ads-attribution` en verde. La `00300` y la `00301` son de Grabaciones. **La próxima libre es la `00303`** (la `00291` sigue reservada para `automation_runs`; confirmar con `list_migrations` y las ramas locales).

# Conciliación de anuncios (00318, 7/11/2026)

«Sin vincular» se vacía sola: lo que no es un anuncio sale, lo que se parece se vincula y queda para revisar, y lo que decide una persona queda como regla. Detalle en [docs/atribucion.md](docs/atribucion.md) («Conciliación: reglas, nombre exacto y parecido»).

## Lo que no se puede romper

- **Orden de `resolve_meta_match`**: ids → regla → nombre exacto (en lo hallado por id) → campaña por nombre único o parecido → anuncio por nombre exacto o parecido → único anuncio del conjunto. Gemelas con `meta-match.cases.json`; la huella cambió a propósito (`scripts/protected-functions.mjs`).
- **El parecido nunca corre contra el catálogo entero** y con dos candidatos no elige. Lo que sale por parecido (`REVIEW_METHODS`) cuenta igual en Anuncios, agendas y ventas, y va a «Para revisar».
- **El fbclid solo no es un anuncio**, un `utm_medium` orgánico gana, e `ig`/`instagram` necesitan un medium pago. `private.meta_touch_utm_counts` / `utmCounts` son gemelas.
- **Una regla (`meta_match_rules`) es por la combinación EXACTA de UTMs normalizados** (`private.meta_rule_key` / `metaRuleKey`), nunca contradice un id ni pisa un `manual`/`ignored` de una persona. Escribe solo el servidor; no hay columna en el toque: el toque dice `method = 'rule'` y la regla se encuentra por sus claves.
- **La IA (`ads_matching`) solo propone**: lee los grupos en el servidor, descarta ids que no están en el catálogo (`parseAiMatchResponse`) y no ve datos de contacto. Confirmar es `applyMetaRule`.
- **El canal de un formulario o una reunión usa el `utm_medium` que llegó** (`private.touch_effective_medium`); `touch_channel` no cambió.

## Migración

`00318_meta_match_rules_similar` (aditiva: la tabla, las funciones, los CHECK de la tarea de IA y, al final, el re-vínculo y el canal de lo existente) va **ANTES** de desplegar el código: **aplicada y registrada** el 7/11/2026 (versión `20261107215432`), después de ensayarla en una transacción que se deshizo sola. Resultado: «Sin vincular» quedó en 0, 87 toques de anuncios en «Para revisar» y 37 orgánicos fuera de la lista. **La próxima libre es la `00319`** (confirmar con `list_migrations` y las ramas locales).

# API de Conversiones de Meta (00328, 8/11/2026)

SSA le manda a Meta, desde el servidor, los leads, las reuniones y los pagos cobrados con los datos de la persona juntos; si la web mandó el mismo evento por Pixel con el mismo código, Meta lo cuenta una vez. Tarjeta **Ajustes → Integraciones → «Meta: API de Conversiones»** (Pixel + token, aparte de la de lectura); leads y reuniones con el paso **«Enviar evento a Meta»** (editor de pasos de Formularios y Agenda, y el lienzo); compras con el interruptor de la tarjeta. Detalle en [docs/meta-capi.md](docs/meta-capi.md).

## Lo que no se puede romper

- **Un evento se manda una sola vez**: índice único `(workspace_id, event_name, event_id)` en `meta_capi_events`. El código sale de `capiEventId` (el `meta_event_id` de la web, `form.<id>`, `booking.<id>`, `payment.<id>` o `flow.<ejecución>.<paso>`): siempre el mismo para lo mismo. Una reunión nunca usa su código público (es una credencial).
- **Nada tumba lo que lo origina**: el paso solo anota y encola (`enqueueCapiEvent`), el trigger de `payments` va en `EXCEPTION WHEN OTHERS` y guardar la IP nunca lanza. El job `meta_capi_send` no lanza por Meta: reagenda a 1, 5 y 15 minutos y después queda `failed`.
- **Los datos de la persona se leen al mandar y nunca se guardan ni se loguean**: `meta_capi_events` no tiene `contact_id` (así `merge_contacts` no cambia), ni hashes ni IP. El token va en el cuerpo, nunca en la URL.
- **La IP y el navegador** (`meta_capi_request_context`) solo se guardan si el negocio configuró la API, solo `service_role`, y se borran a los 8 días (cron `meta-capi-cleanup`).
- **La hora es la de lo que pasó**, nunca la de cuando corre el flujo; más de 7 días se saltea (Meta rechazaría el lote).
- **Purchase no se ofrece en el paso**: lo manda cada pago cobrado, así no hay dos caminos para la misma plata.
- **`lib/meta/capi/events.ts` es lo único que importa el navegador**; `normalize.ts` usa `node:crypto`. La versión de la Graph API es propia (`CAPI_GRAPH_VERSION`).

## Migración

`00328_meta_capi` (aditiva: las dos tablas, el trigger de `payments` y la limpieza diaria). Puede ir antes o después del código: hasta que alguien configure la tarjeta, el trigger no encola nada. **Aplicada y registrada** el 8/11/2026 UTC (versión `20261108060946`), después de ensayarla en una transacción que se deshizo sola, con `verify-meta-capi` en verde. **La próxima libre es la `00329`** (la `00327` es de los crons con guarda) (confirmar con `list_migrations` y las ramas locales).

# Correcciones del Extra L (Tiron 2, 14/10/2026, rama `fix/atribucion-webhooks-flujos`)

Webhooks que no repiten, flujos sin contacto con origen, leads de Meta sin duplicados, la tabla Meta vs CRM con detalle, el anuncio de origen y el vinculo
anuncio ↔ pieza. Avance y decisiones en `docs/PROGRESS-atribucion.md` ("Correcciones (Tiron 2)") y `docs/PENDIENTE-atribucion.md`; producto en
[docs/webhooks.md](docs/webhooks.md), [docs/atribucion.md](docs/atribucion.md) y [docs/flow-registry.md](docs/flow-registry.md).

## Migraciones (`00216` a `00222`)

`00216` (`receive_inbound_webhook` con lock), `00217` (claves nuevas de `trigger_fires`), `00218` (`source_type`/`source_id`), `00219` (`ads_crm_items`,
`ads_crm_metrics_v2`, `ads_crm_cell_detail`), `00221` (`enrich_touch_ad_origin`) y `00222` (`flow_send_claims`): **aplicadas y registradas**. **La `00220`
(recalcula `leads`/`purchases` de Meta) tambien esta aplicada y registrada** (version `20261015011619`, despues de desplegar el codigo que cuenta el
evento canonico; comprobado en la base el 21/10/2026); su respaldo esta en `docs/atribucion/respaldo-leads-meta.json`. **La proxima libre es la `00223`** (confirmar con `list_migrations`). No cambiaron las huellas de
`record_contact_touch`, `find_or_link_contact`, `find_contact_for_form`, `submit_form_response`, `create_booking` y `find_or_create_contact`.

## Lo que no se puede romper

- **Un envio de webhook nunca dispara dos veces el mismo flujo.** Dos entregas iguales a la vez dan un `received` y un `ignored`
  (`receive_inbound_webhook`, `pg_advisory_xact_lock`). La clave de `trigger_fires` es `webhook:<envio>:<flujo>` SIN contador de reproceso: reprocesar
  corre solo lo que no corrio; un flujo que FALLO libera su clave y se reintenta. Volver a correr uno que ya corrio exige la casilla del reproceso
  (apagada por defecto, con advertencia) y queda en `audit_log`. La opcion «una sola vez por contacto» de «Webhook recibido» toma su clave en
  «Crear o actualizar contacto». Los webhooks guardan el toque con la fecha de recepcion (`received_at`), no la del reproceso.
- **Toda sesion y todo evento de automatizacion lleva su origen** (`source_type`: `contact|member|webhook|task|form|booking|sale|call|system`, y
  `source_id`). El CHECK pide contacto u origen y es un superconjunto del viejo; **un evento de CONTACTO sin contacto se sigue rechazando aunque traiga
  una persona** (`verify-eod` y `verify-tasks` lo atajaron). Una reanudacion (`resume_flow`) lee el origen y el contacto de la SESION, no del job: un
  «Esperar» en un flujo sin contacto ya no lo pierde. Cada disparador declara su `sourceType` (`registry/consistency.test.ts` lo exige); el sujeto
  `system` existe pero todavia no hay disparadores de ese tipo.
- **Leads de Meta: un solo evento canonico por nombre** (`lib/meta/action-counts.ts`; la gemela SQL esta en la cabecera de la 00220 y comparten los casos
  de `action-counts.cases.json`). Sumar variantes del mismo lead inflaba el numero (se guardaban 2.337 y Meta reportaba 468).
- **Leads nuevos ≠ leads totales.** Nuevos: personas cuyo primer toque es ese anuncio (una persona cuenta una sola vez en la vida). Totales: personas con
  algun toque en el periodo. Siempre los dos CPL. **El Total cuenta personas DISTINTAS** (`is_total` de `ads_crm_metrics_v2`, dentro de la misma
  consulta); agendas y ventas se suman (cada una cae en un solo objeto por nivel). La lista que abre un numero sale de la MISMA consulta
  (`ads_crm_items`): su cantidad es igual al numero de la celda (`verify-ads-attribution` lo comprueba en 40 celdas). `ads_crm_metrics` (v1) queda para volver atras.
- **Las columnas de la tabla de anuncios son un catalogo** (`lib/dashboards/ads-crm-columns.ts`): las nuevas nacen ocultas, las preferencias guardadas
  se migran por `REPLACED_COLUMNS` (lo que la persona eligio se conserva), y un dato que Meta no dio es «—», nunca 0.
- **El anuncio de origen se recupera de la conversacion de Zernio UNA vez** (solo Instagram, solo con el primer mensaje sin anuncio): job
  `zernio_ad_origin` con reintentos a 1, 5 y 15 minutos, nunca bloquea el webhook y `enrich_touch_ad_origin` nunca pisa un anuncio ni un vinculo `manual`/`ignored`.
- **El vinculo anuncio ↔ pieza a mano vive solo en dos menus «⋯»** (detalle del anuncio y de la pieza), con `content.create` Y `dashboards.ads.view`, y
  queda en `audit_log` (entidad `meta_ad`). El automatico (`lib/meta/content-link.ts`) no cambio y no pisa un manual. La seccion «Publicidad» de la
  pieza solo existe con un anuncio vinculado; «Pautada» y `?pautada=si|no` solo los ve quien puede ver anuncios.
- **«Enviar WhatsApp a un numero» no necesita contacto y no crea ninguno**: busca el numero con `find_only`; «no contactar» frena; nunca manda dos veces
  el mismo (sesion, paso, numero) (`flow_send_claims`); respeta los 200 mensajes por hora del canal. «Enviar email» suma el destino «la direccion de una
  variable» (validada al correr). `PUT /api/v1/flows/:id` valida un flujo publicado como al publicar.
- **El lienzo guarda DIRECTO en `flows`** (no por la API): la validacion de `PUT` no lo alcanza (ver `docs/PENDIENTE-atribucion.md`).
- **`verify-ads-attribution` corre `ANALYZE` antes de medir** los 10.000 toques: sin estadisticas del planificador la misma consulta daba 150 o 350 ms segun el
  momento del autoanalisis. El umbral de 300 ms no se toco.

# Métodos de pago (Extra I, bloque MP, 15/10/2026)

Los métodos de pago pasaron de una lista fija a `workspaces.payment_methods` (jsonb), con la comisión del procesador de cada uno. Resumen en [docs/ventas.md](docs/ventas.md); avance y decisiones en `docs/PROGRESS-extra-i.md` y `docs/PENDIENTE-extra-i.md`.

## Lo que no se puede romper

- **Un solo lector:** todo el código obtiene los métodos con `workspaceMethods(workspace)` (`lib/sales/workspace-methods.ts`). `enabled_payment_methods` quedó sin leerse y un test de frontera (`enabled-methods-boundary.test.ts`) falla si algo lo vuelve a leer. Los métodos no se borran: se desactivan (un pago viejo conserva el suyo).
- **El pago congela la comisión al cobrar:** `provider_fee_percent`, `provider_fee_fixed` y `provider_fee_amount`; la reversión de un cobro los limpia, el reembolso los deja en null. Cambiar la comisión de un método no toca lo ya cobrado. Whop arranca en 0 % hasta que se cargue el real.
- **La base valida el método** (`payments_validate_method`, `PM001`) y un trigger copia % y fijo del snapshot de la opción de pago cuando el pago nace cobrado, porque `create_sale` (protegida) no los inserta.
- `lib/sales/payments-fee-characterization.test.ts` fija el cálculo con fee distinto de cero; sus aserciones no se tocan.

## Migración

`00224` (aplicada y registrada).

# Gastos y Finanzas (Extra I, bloques G1 a G3, 15/10/2026)

Gastos, proveedores, gastos que se repiten, gastos automáticos (comisiones de procesadores y pauta de Meta) y el Resumen. Resumen en [docs/finanzas.md](docs/finanzas.md).

## Lo que no se puede romper

- **Tres tablas y una columna:** `expenses`, `recurring_expenses`, `vendors` y `workspaces.finance_settings` (categorías y configuración de lo automático). Nada se borra (se anula, se pausa, se archiva); no hay política de DELETE. `expenses_guard` impide que una persona dé de alta algo que no sea `manual`/`adjustment`, que cambie el origen, que edite un anulado o un pagado, o el monto de un automático no pagado o de una liquidación de comisiones.
- **Plata en céntimos enteros, USD, fechas civiles en la zona del negocio.** Un dato que no existe es «—», nunca 0.
- **El trabajo diario es el job `finance_daily`** (`private.enqueue_finance_daily`, 00228; sin `app/api/cron` ni `call_app_cron`). Cinco pasos, cada uno en su `try`; si alguno falla el job lanza al final. **El `cron.schedule` es la 00233, que se aplica DESPUÉS del merge.** «Calcular ahora» encola uno a mano.
- **Idempotencia por índice único** (`(recurring_expense_id, scheduled_date)` y `(workspace_id, auto_key)`); un automático se recalcula entero (nunca «se le suma lo nuevo»). Su decisión vive en la base (`upsert_auto_expense`) y en `decideAutoExpenseAction`, con los mismos casos (`auto-expenses.cases.json`).
- **Un automático ya pagado cuyo total cambia no se toca:** se marca la diferencia y la persona elige crear un ajuste o ignorarla.
- **El Resumen** lee pagos y ventas en el servidor (después de `expenses.view`) y al navegador solo viajan agregados. No usa `recharts`.
- **El historial de Finanzas** es la política adicional `audit_log_select_finance` (00227); `audit_log_select` no se reescribe.

## Migraciones

`00225` a `00229` aplicadas y registradas. `00233` (el cron `finance-daily`, `7 * * * *`): **aplicada y registrada** el 15/10/2026, despues del merge.

# Atribución orgánica (Extra I, bloques AO1 a AO3, 15/10/2026)

Qué contenido trajo a cada persona y por qué canal, con links que se miden. Resumen en [docs/atribucion.md](docs/atribucion.md) (sección «Atribución orgánica»).

## Lo que no se puede romper

- **El canal de un toque** (`organic|paid|referral|direct`) lo calcula un trigger con `public.touch_channel`, gemela de `lib/attribution/channel.ts`; los 54 casos de `channel.cases.json` corren contra las dos. `record_contact_touch` NO escribe el canal (está protegida): sale siempre del `medium` y los ids del toque. `fbclid` solo no alcanza para pauta.
- **Los dos triggers nuevos de `contact_touches` (`contact_touches_content_code`, `contact_touches_zz_channel`) nunca pueden costar un toque:** `EXCEPTION WHEN OTHERS` (probado forzando el error). Corren en el orden `content_code` < `meta_match` < `zz_channel`.
- **`content_posts.attribution_code`** (único por workspace, lo completa un trigger) en el `utm_content` vincula el toque a la pieza. El responsable de la pieza es el `assigned_to` que ya existía (00223): ese trigger no se tocó.
- **Comentarios que crean contactos:** Instagram apagado por defecto, TikTok prendido (Ajustes > General > Atribución, `settings.general`). El vínculo retroactivo de comentarios es el job `comment_backfill`; **su trigger es la 00234, después del merge** (la función ya está en la 00230).
- **Links de los mensajes:** el nodo «Enviar mensaje» suma `attribution: { append, trackClicks }`. Apagado, el mensaje es **idéntico** al de siempre (`send-message-characterization.test.ts`, escrito antes del cambio). `/l/[token]` es público: el destino sale SOLO del token firmado (HMAC, secreto `attribution_link_secret` en Vault, vence a 180 días), un token alterado cae a la app sin error, los previsualizadores no registran, tope de 120 pedidos por minuto y por IP, nunca 500, y `l` es una ruta reservada del sitio. `lib/attribution/{tracked-link,link-secret,outgoing-links}.ts` son solo de servidor (`vault-boundary.test.ts`).
- **La atribución nunca tumba nada:** `recordTouch`, la herencia de pieza, la resolución de la historia y las variables de pieza capturan sus errores. La herencia de pieza y la pieza de la historia se resuelven ANTES de guardar el mensaje, para que `origin_context` quede completo en el mismo insert.
- **La atribución de la venta:** «Cargar a mano» crea un toque `manual` y llama a `create_sale` en modo `touch` (que no se tocó); el doble clic deja un solo toque.
- **Funciones protegidas:** las huellas md5 de `record_contact_touch`, `find_or_link_contact`, `find_contact_for_form`, `find_or_create_contact`, `submit_form_response`, `create_booking`, `create_sale` y `resolve_meta_match` no cambian (`scripts/protected-functions.mjs`).

## Migraciones

`00230` aplicada y registrada. `00234` (el trigger del vínculo de comentarios y el barrido inicial): **aplicada y registrada** el 15/10/2026, despues del merge.

# Comisiones (Extra I, bloques CM1 a CM3, 15/10/2026)

Roles, reglas, comisiones por cada pago cobrado y su liquidación en gastos. Resumen en [docs/comisiones.md](docs/comisiones.md).

## Lo que no se puede romper

- **El motor tiene gemelas SQL y TypeScript** (`lib/commissions/rules.ts` y las funciones `commission_*`): los 113 casos de `rules.cases.json` y los de `content-owner.cases.json` corren contra las dos (`verify-commissions.mjs`). Si se cambia una regla, se cambia en las dos y se suma el caso.
- **Solo el servidor escribe** `commissions` y `commission_rules`; `commissions_guard` impide cambiar monto, pago, regla o tipo (se anula y se genera de nuevo). La bandera de transacción `app.commissions_internal` solo la pone `expenses_release_commissions`.
- **Idempotencia:** único `(payment_id, role)` entre las ganadas vivas. Un cobro revertido anula las comisiones libres; las que ya están en un gasto NO se tocan y se avisa a Owner/Admin.
- **`expenses_release_commissions` es la excepción** a «lo automático nunca tumba lo que lo origina»: si falla, la anulación del gasto falla. Lo demás (el trigger de pagos, los avisos, la herencia) nunca tumba nada.
- **Roles de comisión** en `workspaces.commission_settings`: no se borran, no cambian de `key` ni de `payee`, los precargados siguen siéndolo (`CM002`); una regla necesita un rol existente y activo (`CM001`).
- **Permisos:** `commissions.view` (alcance `own` o `all`) y `commissions.manage`; el Member de sistema tiene SOLO `commissions.view` con alcance `own` (**M9, cambio aprobado**). El estado de pago de una comisión se lee del gasto, nunca se copia. `can_see_commission` devuelve siempre true o false.
- **El historial** es la política adicional `audit_log_select_commissions` (00232).

## Migraciones

`00231` y `00232` aplicadas y registradas (la 00231 se corrigió el mismo día; el SQL registrado es el corregido). `00235` (el trigger de `payments` que encola las comisiones): **aplicada y registrada** el 15/10/2026, despues del merge.

## Después del merge (ya hecho el 15/10/2026)

`00233` (cron de Finanzas), `00234` (trigger del vínculo de comentarios) y `00235` (trigger de comisiones); después `verify-expenses --despues-de-00233`, `verify-organic-attribution --despues-de-00234`, `verify-commissions --despues-de-00235` y `verify-contacts-single-entry`. **La próxima migración disponible es la `00236`** (confirmar con `list_migrations`).

# Mejoras de Chat, Agentes IA y Automatizaciones (16/10/2026)

Emojis, editor de email con formato, el agente dentro del chat, reacciones, chat más limpio en mobile, agentes sin conexión de IA, documentos pendientes de indexar, acciones bloqueadas en automatizaciones, Integraciones más liviana, Social en mobile y áreas Equipo/Otros en la agenda. Resumen y decisiones en `docs/PROGRESS-mejoras-chat-agentes.md`; lo abierto en `docs/PENDIENTE-mejoras-chat-agentes.md`. **Contratos (H e I1) no se hicieron.**

## Lo que no se puede romper

- **Una reacción NO es un mensaje.** Evolution la manda como un `messages.upsert` común; los dos webhooks (`evolution` y `late`) la atajan ANTES del camino de los mensajes (`lib/messages/reactions-inbound.ts`) y la guardan en `message_reactions`. Si siguiera el camino normal entraría como un entrante vacío (no leído, flows, agente). Los tests lo fijan con espías. Qué admite cada canal lo decide UN solo módulo (`lib/channels/reactions.ts`, rama explícita por proveedor): WhatsApp cualquier emoji, Instagram solo ❤️, email ninguna.
- **El HTML de un email se limpia DESPUÉS de pegar los valores.** `lib/email/html.ts`: si el cuerpo es HTML se decide mirando la PLANTILLA (nunca el texto ya interpolado), las variables se pegan escapadas (`interpolateHtml`, `escapeHtmlValues` en `resolveBankVariables`) y lo que sale pasa por una lista blanca (`sanitizeEmailHtml`) con estilos en línea. El editor (`components/editor/rich-text-editor.tsx`) no es la defensa.
- **"Sugerir respuesta" es la segunda puerta que agenda un turno** (`lib/agent/drafts/suggest.ts`; la primera sigue siendo `maybeScheduleAgentTurn`). El flag `suggest` del payload es volátil, siempre deja un BORRADOR (nunca envía), no espera la ventana ni se retira porque alguien ya respondió, y se permite con el agente apagado en la conversación (no si no hay agente para el canal). Una sugerencia descartada a mano se recupera con `loadLastDiscardedDraft`; no cambia de estado al recuperarla.
- **"Qué hizo el agente" se arma, no se guarda** (`lib/inbox/message-activity.ts`, puro): corridas (`source = 'agent'`, ancladas por `inbound_at`), borradores y acciones. Una sugerencia nunca se confunde con una respuesta enviada (`outcome`: suggested / executed / failed / skipped / pending). `agent_runs` NO tiene `message_id`: no se agregó.
- **Una sola regla de disponibilidad del agente** (`lib/agent/availability.ts`): interruptor + modelo + IAs conectadas. La usan Agentes IA, `setAgentEnabled`, `channelAgentInfo`, `maybeScheduleAgentTurn`, la cabecera de la bandeja y el dashboard del chat. **Desconectar una IA no apaga ni borra ningún agente**: cambia el estado efectivo (`blocked`), el despacho no agenda turnos que fallarían (antes cada mensaje escalaba a una persona) y Owner/Admin reciben un aviso. La sección "El agente" del dashboard se oculta / invita / avisa (`lib/dashboards/chat/agent-visibility.ts`) y ni consulta sus datos si no se ve.
- **Una acción sin su conexión se ve bloqueada, no oculta, y NO se puede publicar ni prender un flujo con ella** (`lib/flow-engine/node-requirements.ts`; `requires` en cada nodo del registro; `registry/consistency.test.ts` exige que ambas listas digan lo mismo). Una sola función (`connectionProblemsForGraph`) frena `publishFlow`, el prender de Formularios y el de la Agenda; apagar siempre se puede y un paso suelto que no se alcanza desde el disparador no frena nada. El estado se calcula al abrir la pantalla (`loadAutomationCapabilities`), nunca se guarda en el flujo. Un flujo ya publicado al que se le desconecta algo NO se despublica: se avisa en el lienzo y en la lista.
- **Subir un documento sin Voyage lo deja `pending`, no `error`** (00239). Se retoma al conectar Voyage (`saveIntegration` → `enqueuePendingDocuments`) o con "Indexar pendientes": cada documento se reclama (`pending → processing`) antes de encolar y el job lleva clave de dedupe por documento. **La 00239 se aplica ANTES de desplegar el código.**
- **Las áreas de sistema de la agenda son cuatro** (Ventas, Servicio, Equipo, Otros): `SYSTEM_AREAS` y el SQL de la 00240 dicen lo mismo (`lib/scheduling/categories-seed.test.ts`). La migración respeta un área con el mismo nombre que el negocio ya tuviera y no cambia ninguna reunión ni `category_snapshot`.
- **Los datos de emoji salen de `public/emoji/es`** (copia de `emojibase-data`, sin CDN). Si se sube la versión de `frimousse` o `emojibase-data`, volver a copiar `es/data.json` y `es/messages.json`.

## Migraciones (00237 a 00240)

`00237` (`message_reactions`), `00238` (el copywriter nace apagado), `00239` (estado `pending` de Conocimiento) y `00240` (áreas Equipo y Otros): **aplicadas y registradas** (comprobado el 21/10/2026 en `supabase_migrations.schema_migrations`). La `00241` es de la Agenda (el setter ve las reuniones de sus contactos, 20/10/2026), también aplicada.

# Contratos: dos modos, firma de ambas partes y fechas (21/10/2026)

Contratos en dos modos (**Aceptación de términos**, el de siempre, y **Contrato**: primero los datos, después el texto con esos datos), **Firma de ambas partes**, editor con formato, PDF con certificado, copia al Owner, «Descargar contrato» y la pestaña **Diseño** (Campos + Contrato). Además, **un clic en cualquier parte de cualquier campo de fecha abre el calendario** en todo el sistema. Resumen en [docs/formularios.md](docs/formularios.md) («Contrato y su huella»).

## Lo que no se puede romper

- **El texto del contrato se guarda en Markdown acotado**, aunque se escriba con el editor con formato (`lib/forms/contract/editor-markdown.ts` es la ida y vuelta; su test prueba 5000 combinaciones al azar). La huella, la página y el PDF leen ese texto con `renderContractMarkdown`. Links solo `http`, `https`, `mailto` y `tel` (`safeHref`).
- **El texto que se firma en modo Contrato lo arma el SERVIDOR** (`buildContractRender` en `lib/forms/submit.ts`) con la plantilla congelada de la versión y las respuestas ya validadas, y viaja en `meta.contract_render`. Nunca se toma un texto del navegador. La base lo comprueba con `contract_render_matches` (gemela de `renderMatchesTemplate`, casos en `lib/forms/contract/render-match.cases.json`): si se cambia una regla, se cambia en las dos y se suma el caso.
- **`record_contract_signature` v2 tiene la MISMA firma**: así `submit_form_response` (protegida) no se toca. Sin `contract_render` y sin variables hace exactamente lo de antes; una plantilla con variables sin texto armado se rechaza.
- **La evidencia nueva (`rendered_text`, `rendered_sha256`, `business_signer`) tampoco se puede cambiar** (trigger `contract_signatures_protect_evidence`).
- **La firma del negocio** se sube con `uploadBusinessSignature` (PNG o JPG por sus bytes, ≤ 500 KB) a una ruta NUEVA por imagen (`<workspace>/<form>/business-signer/<id>`), nunca se pisa, y `saveContractConfig` solo acepta una ruta de ese formulario (`isBusinessSignaturePath`). La página pública recibe un link temporal, nunca la ruta.
- **«Descargar contrato»**: link firmado de 24 h con la clave de Vault de los formularios (`lib/forms/contract/copy-link.ts`), para una respuesta de un formulario. Solo lo recibe el navegador que acaba de firmar.
- **El calendario de las fechas** lo abre un único escuchador en `app/layout.tsx` (`DatePickerOpener`, regla en `lib/ui/date-picker-click.ts`): no hace falta tocar cada campo, y un navegador sin `showPicker` sigue funcionando como antes.
- **La pestaña Diseño** conserva la clave `campos` en la URL; `?tab=contrato` abre Diseño (`parseEditorTab`).

## Migraciones (00242 y 00243, aplicadas y registradas)

`00242` (columnas nuevas de `contract_signatures`, `contract_render_matches`, el trigger de evidencia y `record_contract_signature` v2, con las dos definiciones viejas completas en la cabecera) y `00243` (`get_public_form` suma `mode` y `business_signer`, con la vieja en la cabecera). Se ensayaron contra la base real en una transacción que se deshace sola (los 17 casos dan igual que en TypeScript) y se **aplicaron y registraron el 21/10/2026** (versiones `20261021144057` y `20261021144115`), después del merge del PR #74. `verify-forms` (347 ok, con un bloque nuevo del modo Contrato) y las huellas de las 8 funciones protegidas, en verde. **La próxima libre es la `00244`** (confirmar con `list_migrations`).

Ojo: el MCP de Supabase de esta sesión apuntaba a OTRO proyecto (`rutledxu…`), no al de producción (`knrxjnmx…`, el del `.env` y el vinculado con la CLI). Para la base real, `supabase db query --linked` desde una carpeta vinculada.

# Pipeline de contactos (construido, 21/10/2026)

Estado de setter y de vendedor con su historial, producto de interés y campos personalizados confiables. Resumen en
[docs/pipeline-contactos.md](docs/pipeline-contactos.md); importación y atribución en [docs/atribucion.md](docs/atribucion.md).

## Lo que no se puede romper

- **Un estado solo cambia por `set_contact_status`** (00245, solo `service_role`; núcleo `applyContactStatus`, `lib/contacts/status-core.ts`).
  La guardia `contacts_status_guard` rechaza (`CS001`) cualquier otro cambio a las columnas de estado, también del service role; solo pasan
  esa función y `merge_contacts` con la marca `app.contact_status_internal`. Así ningún estado queda sin su fila en `contact_status_changes`.
- **El último estado es el más reciente de los dos** (empatados, el del vendedor): `deriveLastStatus` (TS) y la función SQL dicen lo mismo.
- **Las listas viven en `workspaces.contact_status_settings`**: la `key` no cambia nunca, un estado se archiva (no se borra), y el default de
  la columna es `DEFAULT_CONTACT_STATUSES` (`statuses.test.ts` los compara). Editarlas pide `contact_statuses.manage` y se escriben con el
  cliente de servicio después del guard; cambiar el estado de un contacto pide `contacts.edit` y que la persona lo vea.
- **El historial de estados lo ve quien ve el contacto** (`can_see_contact`), no solo quien lo cambió. Nadie lo escribe a mano.
- **El agente solo mueve el estado de SETTER** (`cambiar_estado_setter`, apagada por defecto, lista blanca, no pisa a una persona salvo que
  se le permita). Sin la herramienta, el prompt de la clasificación al cierre es idéntico al de antes. Lo que hace se revierte desde Acciones.
- **Un valor de campo personalizado se valida por tipo en UN lugar** (`normalizeCustomValue`, `lib/custom-fields.ts`): ficha, "Definir
  campo", importación y webhook. `value_number` / `value_date` (00244) los llena un trigger que nunca lanza; comparar números o fechas va
  contra esas columnas, nunca contra el texto.
- **Producto de interés** (00246): el trigger `contacts_interest_check` exige variante del mismo producto y del mismo workspace. Los FK son
  NO ACTION a propósito (borrar un workspace entero no choca en el medio de la cascada).
- **Importación:** un contacto nuevo nace con el toque de origen `import` (con la atribución de la planilla si la trae); uno que ya existía
  no recibe toque, solo una entrada en su historial.

## Migraciones (`00244` a `00248`, todas aplicadas y registradas el 21/10/2026)

`00244` (valores tipados), `00245` (estados, historial, función y guardia), `00246` (producto de interés), `00247` (`merge_contacts`
con estados y producto; la definición vieja completa en su cabecera) y `00248` (corrige la 00245: el DEFAULT de
`contact_status_settings` pasa a ser un literal; llamar a una función sin permisos desde un DEFAULT rompía el alta de un workspace).
**Un DEFAULT de columna se evalúa con los permisos de quien inserta: nunca una función de `private`.** **La próxima libre era la `00249`; desde el 22/10/2026 están ocupadas hasta la `00252` (ver "Agentes IA" más abajo): la próxima libre es la `00253`**
(confirmar con `list_migrations`).

La `00249` a la `00252` son de otras sesiones (bandeja por cuenta y agentes IA); la `00253` es de Contenido (una pieza se edita en
cualquier estado), **aplicada y registrada** el 22/10/2026 (version `20261022202705`), con `verify-content.mjs --despues-de-00253` en verde. **La próxima libre es la `00254`** (confirmar con `list_migrations` y las ramas locales).

## Verificación

```
node scripts/verify-contact-pipeline.mjs   # 00244-00246: valores tipados, estados, guardia, RLS del historial, producto de interés
node scripts/verify-contact-merge.mjs      # la fusión, con estados y producto de interés
```

# Nivel de calificación del lead (00329, 8/11/2026)

Un número del 1 al 5 por contacto (o «Sin calificar»), con el nombre y la rúbrica de cada nivel configurables en **Ajustes → Estados**. Convive con la temperatura. Se cambia a mano (ficha, bandeja, Kanban), con el paso «Calificar lead» (fijar, sumar/restar o «según reglas»), lo pone el agente (`calificar_lead` y la clasificación al cierre) o entra por CSV. Detalle en [docs/pipeline-contactos.md](docs/pipeline-contactos.md) («Nivel de calificación»), [docs/flow-registry.md](docs/flow-registry.md) y [docs/agente-ia.md](docs/agente-ia.md).

## Lo que no se puede romper

- **Una sola puerta**: `set_contact_qualification` (solo `service_role`) y desde el código solo `lib/contacts/qualification-core.ts`. La guardia `contacts_qualification_guard` (QL001) rechaza cualquier otra escritura de `qualification_level`, `qualification_at` y `qualification_by_agent`, también del service role; `lib/contacts/qualification-single-entry.test.ts` lo exige en el código.
- **La regla de recorte tiene gemelas**: `private.qualification_next_level` y `nextQualificationLevel`, con `lib/contacts/qualification.cases.json` (vitest y `verify-contact-qualification`). Desde «Sin calificar» se cuenta desde 0; nunca pasa de 5 ni baja de 1.
- **Los niveles son fijos (1-5); se edita el nombre y la descripción** (`workspaces.qualification_settings`, DEFAULT literal = `DEFAULT_QUALIFICATION_SETTINGS`). Guardar pide `contact_statuses.manage`.
- **Cada cambio deja su fila en `contact_qualification_changes`** (lo lee quien ve el contacto) y emite `qualification_changed`, que es una opción de «Evento del CRM» (`qualificationEventMatches`: `up`, `down`, `eq:N`, `gte:N`, `lt:N`).
- **«Según reglas» mira TODAS las reglas** (no la primera, como «Condiciones») con el mismo evaluador, y aplica un solo cambio. El motivo nombra las reglas, nunca los valores.
- **El agente solo sube y no pisa a una persona** salvo que se le permita, y lo decide la base bajo el bloqueo (`p_only_raise`, `p_respect_human`). Sin la herramienta, el prompt del cierre no cambia ni un carácter.
- **La fusión no reescribió `merge_contacts`**: el trigger `contacts_qualification_on_merge` mueve el historial y deja el nivel más alto (la tabla está en `CONTACT_MERGE_EXCLUSIONS`).
- La columna nueva de la lista nace oculta.

## Migración

`00329_contact_qualification` (aditiva: columnas, ajustes, historial, función, guardia, trigger de fusión, la siembra frío = 2 / tibio = 3 / caliente = 4 y `calificar_lead` en los agentes que tenían `cambiar_temperatura`) va **ANTES** de desplegar el código: **aplicada y registrada** el 8/11/2026 UTC (versión `20261108071521`), después de ensayarla en una transacción que se deshizo sola (sembró 71 contactos: 17 en nivel 2 y 54 en nivel 3, sin emitir eventos; 1 agente con `calificar_lead`), con `verify-contact-qualification` y `verify-contact-pipeline` en verde y la guardia de la fusión cubriendo las 28 relaciones con `contacts`. **La próxima libre es la `00330`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-contact-qualification.mjs   # después de aplicar: regla SQL = TS, función, guardia, RLS, 10 a la vez, fusión
```

# Automatizaciones: auditoría (construido, 23/10/2026)

Auditoría del motor, los disparadores, los pasos y la pantalla, con lista con buscador y categorías, borrador para lo publicado, el disparador primero, buscador de pasos, adjuntos en el email y todo en español. Resumen en [docs/flow-registry.md](docs/flow-registry.md) («Auditoría de automatizaciones»); avance en `docs/PROGRESS-automatizaciones-auditoria.md`, pendientes en `docs/PENDIENTE-automatizaciones-auditoria.md`.

## Lo que no se puede romper

- **Arrancar un flujo NO retoma una sesión en espera** (`executeFlow`): solo el receptor de mensajes retoma (`lib/inbound.ts`). Retomar «Esperar respuesta» es un reclamo sobre `waiting_for_input`; un flujo despublicado cancela la sesión al retomar.
- **Una automatización publicada guarda en `draft_nodes`/`draft_edges`** (00254, `saveFlowDraft`); lo que corre es `nodes` hasta «Publicar cambios». El lienzo ya NO escribe `flows` desde el navegador. Los editores de pasos de Formularios, Agenda, EOD y Cobranza siguen escribiendo `nodes` (publican al guardar).
- **Un solo disparador, elegido**: `triggerType: null` = sin elegir (así nace una automatización); un nodo viejo sin la clave es palabra clave. Publicar lo exige (`lib/flow-engine/publish-rules.ts`). El disparador no se borra; se cambia con el selector.
- **Republicar reconcilia todas las filas del lienzo** (sin canal, o con `config.origin = "canvas"`) de los tipos que arma el editor (`persistableTriggerTypes`) y no toca ni reactiva las reglas viejas de Growth (con canal y sin la marca).
- **Tres catálogos, una sola lista cada uno**: disparadores (`trigger-catalog.ts`, comparado con el registro y el CHECK de la base), sus valores por defecto (`trigger-defaults.ts`) y las variables por disparador (`variable-catalog.ts`). El motor siembra `contact.*` y `workspace.*` en todos los pasos.
- **Categorías**: `flows.categories` (text[], hasta 10, normalizadas en `lib/flows/categories.ts`); las sugerencias salen de las que usan las demás automatizaciones. La lista filtra por URL (`?q=&estado=&origen=&categoria=`, `lib/flows/list.ts`).
- **Llamada HTTP solo por `lib/net/safe-fetch.ts`** (sin direcciones internas, 10 s, 256 KB). Un test que la use simula el DNS (`vi.mock("node:dns/promises")`).
- **Adjuntos del email = recursos de la banca** (`attachments: [{ assetId }]`), hasta 10 y 25 MB; se bajan una vez por paso; un recurso que falta no frena el email y avisa en la campana.
- **«Agregar/Quitar etiqueta» decide por el tipo del paso**, nunca por `data.action` (el lienzo no lo guarda).

## Migraciones

`00254_flows_categories_drafts` (aditiva), **aplicada y registrada** el 23/10/2026 (versión `20261023130139`). **La próxima libre es la `00255`** (confirmar con `list_migrations`).

# Esperando respuesta y tiempo de respuesta (23/10/2026)

"Esperando respuesta ahora" separa lo que se puede responder de lo que tiene la ventana vencida y de lo que no necesita respuesta; "Tiempo de respuesta" (de personas, en todas las esperas) reemplaza a "Primera respuesta"; los borradores cuya ventana se cerró pasan a `expired`. Detalle en [docs/dashboards.md](docs/dashboards.md) y [docs/agente-ia.md](docs/agente-ia.md).

## Lo que no se puede romper

- **El estado de espera vive en `conversations` y lo mantiene SOLO el trigger de `messages`** (`messages_zz_refresh_awaiting`, `private.refresh_conversation_awaiting`, 00259): `awaiting_reply_since` (primer mensaje del lead sin responder), `awaiting_last_inbound_at`, `reply_window_until` (+ la ventana del canal) y la marca `no_reply_needed_*`. "Responder" es cualquier saliente que no falló. El trigger va en `EXCEPTION WHEN OTHERS`: **nunca puede tumbar el insert de un mensaje**. Toma el lock de la conversación antes de leer (dos mensajes a la vez se recalculan en orden).
- **La tarjeta y el filtro de la bandeja usan el mismo criterio**: `chat_waiting_now_v2` (SQL) y `lib/inbox/awaiting.ts` + la consulta de `inbox/page.tsx` (`?esperando=responder|vencida`). Abierta, sin "no contactar", sin etiqueta que apague al agente, último mensaje del lead hace más de 1 h, sin la marca. Si se cambia uno, se cambian los dos.
- **"No necesita respuesta" tiene tres fuentes** (`no_reply_needed_reason`): `rule` (la pone el trigger), `agent` (`no_hace_falta_responder`) y `manual` (menú "⋯"). Las dos últimas pasan por `set_conversation_no_reply` (solo `service_role`; al marcar exige que el lead no haya vuelto a escribir). Se borra sola con un mensaje nuevo o una respuesta.
- **La regla de cierre tiene gemelas**: `public.chat_is_closure_message` y `lib/messages/closure.ts`, con `closure.cases.json` (corren en vitest y en `scripts/verify-chat-awaiting.mjs`). Conservadora: un "?" pide respuesta; nada cierra después de una pregunta o una PROMESA nuestra ("dame un momento", "ya te lo paso"). Una palabra fuera de la lista alcanza para que pida respuesta.
- **El agente solo puede no responder si la tanda pasa `canSkipReply`** (`lib/agent/no-reply.ts`): sin "?", sin adjuntos salvo stickers y GIFs, sin pregunta o promesa nuestra pendiente. `no_hace_falta_responder` es obligatoria y no se ofrece cuando una persona pidió la respuesta (sugerir, regenerar).
- **"Respuesta humana" tiene gemelas**: `public.chat_reply_is_human` y `isHumanReply` (`lib/messages/reply-time.ts`, `reply-time.cases.json`). Persona o borrador aprobado = humana; agente directo, flows, secuencias y broadcasts = automática; desde fuera del sistema, automática si sale en menos de 15 s. La espera se cuenta desde el PRIMER mensaje sin responder; la bandeja (`replyTimesByMessage`) y el dashboard (`chat_response_turns`) hacen el mismo cálculo.
- **Un borrador vencido es `expired`, no `discarded`** (00260): lo pone el barrido; la métrica "Ventana perdida" sigue saliendo de `window_missed_at`. La bandeja lo muestra (`loadLastExpiredDraft`) solo mientras no entró ni salió ningún mensaje después.

## Migraciones

`00259` (columnas, regla, trigger, `set_conversation_no_reply`, `chat_waiting_now_v2` y el backfill), `00260` (`expired`, el barrido y los 62 que ya estaban vencidos) y `00261` (tiempo de respuesta): **aplicadas y registradas** el 23/10/2026 (versiones `20261023211644`, `...211658` y `...211651`). La regla de cierre de la 00259 se corrigió el mismo día (promesas pendientes) y el SQL registrado es el corregido. La `00255` a la `00258` son de la sesión de WhatsApp (stickers y llamadas). La `00262` es de «El último mensaje de la conversación» (abajo): **la próxima libre es la `00263`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-chat-awaiting.mjs   # gemelas SQL<->TS, el trigger, la marca, el contador, el tiempo humano y el barrido
```
# El último mensaje de la conversación, envíos fallidos y la espera tras ManyChat (23/10/2026)

## Lo que no se puede romper

- **La lista muestra el ÚLTIMO mensaje de la conversación**, sea del contacto o nuestro: `last_message_at`, `last_message_preview` y `last_message_direction` los mantiene el trigger `messages_zz_last_message` (00262) con cualquier entrante y cualquier saliente que salió (ni `failed` ni `pending`; un mensaje más viejo que el último no la mueve). Va en `EXCEPTION WHEN OTHERS`: nunca tumba el insert de un mensaje. Las etiquetas de adjuntos de `private.attachment_preview_label` son las de `LABELS` (`lib/inbox/last-message-sql.test.ts`). El «Vos: » lo pone la pantalla (`conversationListPreview`), no se guarda.
- **Un envío fallido guarda lo que se quiso mandar en `text` y el motivo en `messages.send_error`** (antes el motivo pisaba el texto). La bandeja muestra el motivo, «Reintentar» y «Copiar texto». Reintentar (`retryOf` en `POST /api/v1/messages`) reclama la MISMA fila con `failed -> pending` antes de mandar: doble clic = un envío. Una fila vieja (sin `send_error`) no se reintenta: su texto es el motivo. En Instagram el hilo se lee de Zernio, así que los fallidos se suman desde la tabla (`withLocalFailedSends`).
- **Un envío fallido no es una respuesta para el agente** (`loadRecentMessages` los excluye).
- **Un mensaje nuestro que sale reabre la conversación cerrada** (00354, trigger `messages_zzz_reopen_conversation`), venga de donde venga: solo si salió, es reciente (menos de 10 minutos: lo importado no reabre) y la conversación se cerró antes de ese mensaje (responder y cerrar la deja cerrada). Una pospuesta no se toca. Detalle en docs/flujo-de-mensajes.md («Cuándo se reabre una conversación»). La `00354` es aditiva (una función y dos triggers, más reabrir las conversaciones de broadcasts ya enviados) y puede ir antes o después del deploy: **aplicada y registrada** el 8/11/2026 UTC (versión `20261108190520`), después de ensayarla en una transacción que se deshizo sola; reabrió las 27 conversaciones de broadcasts enviados, con `verify-chat-awaiting --despues-de-00354` en verde. La `00348` a la `00353` son de otras sesiones: **la próxima libre es la `00355`** (confirmar con `list_migrations` y las ramas locales).
- **La espera tras ManyChat (`external_reply_cooldown_minutes`) se mide contra AHORA** (`externalCooldownEnd`): el turno se reagenda para cuando termina (`external_cooldown_wait`, con `blocked_retry`) y, si nadie respondió, el agente sigue. Antes se abstenía para siempre.

- **El trigger mira cuál es DE VERDAD el último mensaje** (00265), no `last_message_at`: un entrante pasa por `increment_unread` (hora de ahora) ANTES de guardarse con la hora del proveedor, unos segundos más vieja. Dirección y preview salen siempre de ese último mensaje.
- **El «no leído» se apaga en la base** (00265): si el último mensaje es una respuesta nuestra (misma regla que `outboundCountsAsAnswered`: una persona en la app o desde afuera, como ManyChat), `unread_count` queda en 0, aunque el mensaje del contacto llegue después que el eco.
- **Las fechas de la bandeja van por día de calendario** de quien mira (`lib/inbox/day-label.ts`): «Hoy», «Ayer», no «hace menos de 24 h».

`00262` (aditiva): **aplicada y registrada** el 23/10/2026 (versión `20261024032027`), con `verify-chat-awaiting.mjs` en verde. `00265` corrige su trigger y suma el no leído: **aplicada y registrada** el 24/10/2026 (versión `20261024162422`), con `verify-chat-awaiting.mjs` en verde (la `00263` y la `00264` son de tipos de producto). **La próxima libre es la `00266`** (confirmar con `list_migrations` y las ramas locales).

# Bandeja: asignación, Conocido, stickers y llamadas de WhatsApp (construido, 23/10/2026)

Responsable de cada conversación (a mano y con reglas por cuenta), la marca «Conocido», stickers de WhatsApp y el registro de llamadas. Lo que Evolution puede y no puede está en `docs/pendientes/wavoip-llamadas.md`.

## Lo que no se puede romper

- **El responsable del chat es `conversations.assigned_to`** (ya lo usaba la RLS: te asignan un chat → el contacto es «tuyo», `contact_is_mine`). Se cambia con `setConversationAssignee` (`lib/actions/conversation-assign.ts`): con `contacts.assign` a cualquiera; sin la clave, solo «Tomar» uno sin responsable en una cuenta donde respondés (`canChangeConversationAssignee`, `lib/inbox/assignee.ts`). Escribe con el cliente de servicio después de leer con el del usuario. El aviso `conversation_assigned` nunca va a quien asignó.
- **Reglas por cuenta (00255)**: `conversation_assignment_rules`, gana la primera activa que coincide (`position`); `assign_new_conversation` corre SOLO en una conversación nueva (`upsertConversation`, y en el upsert de comentarios), nunca pisa un responsable y no toca `assignment_locked_at` (Ventas saltea un setter «lleno»). `conversation_rule_pick` y `pickRuleMember` son gemelas con `lib/inbox/assignment-rules.cases.json`. El import histórico no asigna.
- **El filtro «Asignación → persona» usa `conversation_people`** (responsable + setter + vendedor, campo calculado de la 00255); «Asignadas a mí» es `?asignado=mias`.
- **Conocido es una marca del contacto (00256), no una etiqueta**: `is_known`, quién y cuándo. Al marcar, la BASE (trigger) asigna cada chat a la persona de su cuenta (`workspaces.known_contacts_settings`, si no el Owner; `private.known_assignee`) y apaga el agente con `agent_disabled_by_known` (mismo patrón que la etiqueta con efecto de la 00073). Al quitar, se prende solo lo que apagó la marca y el responsable queda. `assign_new_conversation` mira la marca antes que las reglas. La fusión la conserva (trigger al borrar el duplicado, sin reescribir `merge_contacts`).
- **Secuencias y conocidos**: se pausan al marcar (motivo `known`), el procesador los saltea y no se inscribe ni reanuda mientras siga marcado. Los flujos siguen corriendo (decisión de producto).
- **El aviso al abrir** (`knownGate`): quien no lo marcó ni lo tiene a cargo ve «Es un conocido de…» y el chat no se carga ni se marca como leído hasta «Abrir igual».
- **Stickers (00257)**: `lib/channels/stickers.ts` es el ÚNICO que decide qué canal los manda (solo Evolution; rama explícita). WhatsApp no deja leer los stickers guardados en el celular: la biblioteca se arma sola con los que se mandan (también desde el teléfono, `fromMe`), los recibidos se guardan con un botón y se suben PNG/JPG/WEBP/GIF (`sharp`, webp 512×512; un GIF queda animado porque Evolution fuerza `gifPlayback=false` en `sendMedia`). El archivo vive en `chat-media/<ws>/stickers/<sha>.webp` y se COPIA a la conversación antes de mandarse (la retención solo borra lo que referencia un mensaje). `sharp` está fijado en la 0.34.5.
- **Llamadas (00258)**: Evolution 2.3.7 NO hace ni atiende llamadas (`offerCall` está comentado); solo avisa con el evento `CALL`. `record_whatsapp_call` hace la transición en una sentencia; la llamada es una línea del hilo, **no un mensaje** (no la ve el agente ni dispara flujos). Una perdida suma un no leído y avisa (`whatsapp_call_missed`, una vez cada 10 minutos por chat). Rechazar solas y el mensaje viven en Evolution (`/settings`), y guardar re-registra el webhook con `CALL`: **un número conectado antes de esta versión no recibe llamadas hasta reconectarlo o guardar «Llamadas» una vez**. `whatsapp_calls` no tiene `contact_id` a propósito (la fusión no la tiene que tocar). No confundir con `calls` (Fathom).

## Migraciones

`00255` (reglas y `conversation_people`), `00256` (Conocido; redefine `assign_new_conversation` con la de la 00255 en su archivo), `00257` (stickers) y `00258` (llamadas). Las cuatro son aditivas y se aplican ANTES de desplegar: **aplicadas y registradas** el 23/10/2026 (versiones `20261023210235` a `...38`), con `verify-contact-merge` y `verify-rls --despues-de-00143 --despues-de-00208` en verde. La `00259` a la `00261` son de «Esperando respuesta» (ver esa sección): **la próxima libre es la `00262`** (confirmar con `list_migrations`).

# Bandeja: la barra de la lista (6/11/2026)

Todo lo que filtra la lista vive arriba de ella (`components/inbox/inbox-list-header.tsx`): la cantidad, el boton **Filtros** (`InboxFiltersMenu`), el icono de buscar y los borradores.

- **Un solo menu de filtros, en este orden**: Canal, Asignacion, Estado, Chats y grupos (solo si hay grupos activados), Respuesta, Tags, Conocidos y clientes, Quien es, Agente de IA, Ultimo mensaje. El contador del boton cuenta todo menos la busqueda (`countMenuFilters`); "Abiertas" es el estado de siempre y no cuenta.
- **El buscador se despliega desde el icono** y arranca abierto solo si la URL trae `?q=`. La `×` (o Esc) borra lo buscado y lo cierra. `SectionSearch` con `onClose` es ese modo; Broadcasts, Secuencias y Growth lo siguen usando en la barra de arriba.
- **Limpiar filtros conserva lo abierto** (`?c=` y `?g=`).

# Mensajes borrados para todos (00356, 8/11/2026)

Un mensaje de WhatsApp borrado «para todos» (por el contacto, el teléfono del negocio, la API o el botón de la bandeja) se ve como «Mensaje eliminado» y el equipo puede ver lo que decía. Detalle en [docs/flujo-de-mensajes.md](docs/flujo-de-mensajes.md) («Mensajes borrados para todos»).

- **Un borrado no es un mensaje**: llega por `MESSAGES_DELETE` y `MESSAGES_EDITED` (Evolution 2.3.7) y el receptor lo ataja antes del camino de los mensajes (`lib/messages/revoke.ts`). Ningún `protocolMessage` entra como mensaje. Por la API, el id bueno es `data.key.id`, no `data.id`.
- **La fila no se borra**: `deleted_for_everyone_at/_source/_by`, escritas SOLO por `mark_message_deleted_for_everyone` (solo `service_role`; la guardia `messages_guard_deleted_for_everyone` las cierra a la sesión de una persona). Idempotente.
- **La vista previa** sale de `private.message_list_preview` y el trigger recalcula al marcar; la etiqueta es `DELETED_MESSAGE_LABEL` (un test la compara con el SQL).
- **El agente y el resumen no leen lo borrado** (`withoutDeletedMessages`).
- **«Eliminar para todos»** solo en WhatsApp, saliente, salido, con id y de menos de 2 días (`canDeleteForEveryone`, la misma regla en el botón y en la acción).
- **Un número viejo necesita volver a registrar el webhook** para recibir los avisos de borrado.

`00356_messages_deleted_for_everyone` (aditiva) va **ANTES** de desplegar el código. La `00351` a la `00353` son de Servicios, la `00354` de «un saliente reabre la conversación» y la `00355` de reabrir un broadcast sin enviar. **La próxima libre es la `00357`** (confirmar con `list_migrations` y las ramas locales).

# Links clicables y vista previa (6/11/2026)

Los links de los mensajes se ven clicables en la bandeja, los chats llevan una tarjeta de vista previa (también mientras se escribe) y los emails salen con links de verdad. Sin migración. Detalle por canal en [docs/flujo-de-mensajes.md](docs/flujo-de-mensajes.md) («Links y vista previa»).

## Lo que no se puede romper

- **El envío por WhatsApp e Instagram no cambió, y la tarjeta de la bandeja NO es la que ve la otra persona.** En WhatsApp la arma Evolution 2.3.7 sola, salvo `linkPreview: false`; solo sigue redirecciones dentro del mismo dominio, así que un link con «Registrar el clic» o un acortador llegan sin tarjeta. En Instagram decide la red: el SDK de Zernio no tiene opción para mensajes.
- **Un solo detector: `splitTextLinks` (`lib/messages/text-links.ts`, puro)**, con `http(s)://` y `www.`. Solo produce `http` y `https`, y unir los pedazos da el texto original. `URL_IN_TEXT` de `link-params.ts` no cambió: la atribución lo usa.
- **Un link medido se abre directo al destino solo en un mensaje SALIENTE** (`trackedLinkDestination`), para que el equipo no le invente un clic al lead. **Nunca en un entrante**: un lead podría falsificar el token y mostrar otro destino. Un test compara el formato con el firmado de verdad, porque `tracked-link.ts` usa `node:crypto` y no se puede importar acá.
- **Pedir una página pasa por `lib/link-preview/fetch.ts`**, porque el link lo puede haber mandado cualquier desconocido: `safeFetch`, 5 s, solo puertos 80 y 443, nunca `/auth/` ni `/api/` (pueden gastar un link de un solo uso), también en cada redirección. **Nunca se loguea la URL**: por eso la ruta es POST y un catch ahí no loguea. Su `LINK_PREVIEW_USER_AGENT` está en `LINK_PREVIEW_BOT_TOKENS`, o abrir un mensaje contaría como un clic.
- **Qué canal lleva tarjeta lo decide `lib/channels/link-preview.ts`** (rama explícita por proveedor; un desconocido, sin tarjeta). Email no lleva. A qué mensaje le toca, `messageLinkCardUrl`: ni fallidos, ni emails, ni los que ya traen tarjeta (`share`, `link`, `story_reply`).
- **Un email sin links sale byte por byte igual** (`textToHtml`, `plainTextToHtml`, con test). Primero se separan los links y después se escapa. El texto visible es igual al `href`: una variable no puede disfrazar un link.
- **`renderEmail` de los broadcasts protege `{{unsubscribe_url}}`** antes de limpiar el HTML: sin eso, un `href` con la variable se descartaba y el link de baja se perdía.
- **El hilo se queda abajo con `useStickToBottom`** cuando llega tarde una tarjeta o crece el composer. Si la persona subió a leer, no la mueve.

**Pendiente:** el DNS rebinding en `safeFetch` (detalle en `docs/PENDIENTE.md`).

# Contactos: Kanban, columnas y filtros (3/11/2026)

Tabla y Kanban (`?vista=kanban`) con los MISMOS filtros: un solo planificador (`lib/contacts/list-query.ts`) y un catálogo de filtros (`lib/contacts/filters/catalog.ts` + las áreas de `lib/contacts/related/*`, registradas en `lib/contacts/list-modules.ts`). Panel de filtros y menú de columnas con buscador, chips de filtros puestos. Resumen en [docs/contactos.md](docs/contactos.md) («Lista: vistas, columnas y filtros»).

- **Todo filtro pasa por `parseContactListFilters` / `contactListPlan`**: así aplica igual a la tabla, al Kanban y a "Cargar más". Cada valor de la URL pasa por el `accepts` de su filtro; un texto libre solo por `.in()` (`isSafeText`), nunca adentro de un `or` armado a mano.
- **Registros relacionados**: las "tiene" de una tabla van en UN join `!inner`; cada "no tiene" es su anti-join. Respetan la RLS de cada tabla. Las columnas relacionadas se cargan solo para la página visible y solo si están visibles (`loadContactColumnCells`).
- **Las áreas de Ventas, Formularios, Tareas y Llamadas** son archivos propios (en el perfil de estudiantes) y su línea en `list-modules.ts` lleva la marca.
- **`00283_contacts_list_filters`** (aditiva: `contact_attribution_options` SECURITY INVOKER + índices): **aplicada y registrada** el 3/11/2026 (versión `20261103154823`), antes del merge. En un clon nuevo puede ir antes o después del deploy; sin ella, los filtros de campaña, contenido y término no tienen opciones. **La próxima libre es la `00284`** (confirmar con `list_migrations` y las ramas locales).

# Historial de WhatsApp: revisar e importar (30/10 y 5/11/2026)

La tarjeta de cada numero en Canales tiene "Historial": **Revisar historial** (`reviewWhatsappHistory`) dice que hay, e **Importar** (`startWhatsappHistoryImport`, con confirmacion) lo trae. Las dos piden `channels.manage`. Detalle en `docs/flujo-de-mensajes.md` ("Importar el historial de WhatsApp").

- **Solo lee la base del propio Evolution, sin hablar con WhatsApp** (`POST /chat/findChats`, `POST /chat/findMessages`): no hay riesgo de bloqueo del numero. Evolution guarda lo que WhatsApp le mando al escanear el QR (si su `DATABASE_SAVE_DATA_HISTORIC` esta prendido) y lo que recibio despues.
- **El historial completo se pide al crear el numero** (`syncFullHistory` en `createInstance`); un numero viejo lo pide al reconectar (`ensureFullHistory`). Despues de escanear ya es tarde, y cuanto manda lo decide WhatsApp.
- **Lo importado es historia** (`lib/whatsapp-history/run-import.ts`, cola `whatsapp_history_import`, por partes): sin no leidos, automatizaciones, agente, asignacion ni toques. Crear un contacto emite `contact_created` y encola `sales_contact_eval`: se apagan contacto por contacto. Una conversacion que ya existe no se toca; las nuevas sin movimiento hace mas de 7 dias nacen cerradas.
- **El avance vive en `channels.inbox_import`** con `kind: "whatsapp_history"`: la misma columna que Zernio, con otra forma, y cada parser descarta la del otro (`import-state.test.ts`).
- **La identidad sale del chat entero, no de cada mensaje** (`planChatImport`), y los chats se recorren por su id, nunca por fecha, para no saltear ninguno. Volver a importar no duplica (indice unico por conversacion y `platform_message_id`, que es parcial: no sirve un `upsert`, por eso `insertHistoricMessages` reintenta de a uno ante un 23505).
- **Los archivos no se traen**: el adjunto queda en `none`, nunca en `pending` (dejaria el spinner girando para siempre).
- **Es un boton y no algo automatico a proposito**: cada chat pasa a ser un contacto, tambien los personales, y puede entrar en un broadcast por WhatsApp.

# WhatsApp sin telefono (@lid) y el buscador (30/10/2026)

WhatsApp a veces identifica a la persona con un `@lid` (un id interno) en vez de su numero. Evolution 2.3.7 lo cambia por el telefono antes de avisarnos SOLO cuando lo sabe (`key.remoteJidAlt`), asi que un `@lid` nos llega cuando nadie sabe el numero. Hasta esta fecha el receptor lo descartaba ("sin telefono utilizable") y esa conversacion nunca entraba. Detalle en [docs/flujo-de-mensajes.md](docs/flujo-de-mensajes.md).

## Lo que no se puede romper

- **La identidad de WhatsApp es el telefono o, si no hay, el `@lid`** (`resolveWhatsappSender`, `lib/whatsapp-sender.ts`, puro): va en `contact_channels.platform_sender_id`, y es tambien a donde se contesta. Grupos, estados (`status@broadcast`), difusiones y canales (`@newsletter`) no son una persona y se ignoran.
- **Un `@lid` se manda ENTERO a Evolution** (`toEvolutionNumber`): Evolution lo acepta como destino (`createJid` no lo toca). Convertirlo a digitos lo mandaria a un numero que no existe. `getDmLink` no arma `wa.me` con un `@lid`.
- **Un contacto que entro SOLO con su `@lid` y despues llega con los dos sigue siendo el mismo** (`withKnownLid` en el receptor: si el `@lid` ya esta vinculado en el canal, se usa como identidad y `find_or_link_contact` le suma el telefono). No se toco ninguna funcion protegida de contactos: un `@lid` entra por la identidad del canal.
- **El id de WhatsApp se ve de solo lectura** en "Redes" de la ficha y en "Datos" del panel de la bandeja (`whatsappLidOf`, `channelIdentity` en `lib/contacts/links.ts`). Evolution no manda ningun @usuario de WhatsApp: solo el nombre del perfil (`pushName`).
- **La bandeja y Contactos buscan con la MISMA regla** (`contactSearchFilter`, `lib/contacts/search.ts`): nombre, emails, telefonos (tambien escritos con espacios o guiones), los @ de Instagram, TikTok y X (con o sin la arroba) y el `@lid` (que vive en `contact_channels` y se busca aparte con `contactIdsByWhatsappLid`, con el cliente del usuario). En la bandeja el filtro va sobre la tabla embebida (`or(..., { referencedTable: "contacts" })`).

# Grupos de WhatsApp (construido, 3/11/2026)

Un numero puede ACTIVAR grupos para verlos y escribir en la bandeja (en la misma lista que los chats, `?g=` abre uno y `?tipo=chats|grupos` filtra), guardar como contacto a quien se une (toque «Grupo de WhatsApp», organico) y disparar automatizaciones cuando alguien se une, reacciona o vota en una encuesta. Resumen en [docs/whatsapp-grupos.md](docs/whatsapp-grupos.md).

## Lo que no se puede romper

- **Un grupo NO es una conversacion**: vive en `whatsapp_groups`, `whatsapp_group_members`, `whatsapp_group_messages`, `whatsapp_group_reactions` y `whatsapp_poll_votes` (00280). No pasa por el agente, los flujos de mensajes, «Esperando respuesta» ni los no leidos de la bandeja privada. Un grupo NO activado se sigue ignorando en el receptor.
- **Sin `contact_id` a proposito**: cada participante es su identidad de WhatsApp (`participant_id`, telefono o `@lid`, como `contact_channels.platform_sender_id`) y el contacto se busca por `contact_channels`. Por eso `merge_contacts` y `CONTACT_MERGE_TABLES` no cambiaron.
- **Quien ve / escribe**: `can_see_whatsapp_group` / `can_write_whatsapp_group` (alcance `all` u `own_unassigned` en esa cuenta; escribir pide «responde»; Owner/Admin siempre), gemelas de `canSeeWhatsappGroup` / `canWriteWhatsappGroup` con `lib/auth/whatsapp-group-access.cases.json`. Escribe solo el servidor.
- **Contactos solo si el grupo guarda contactos** (o «Importar miembros», job `whatsapp_group_import`, que NO dispara automatizaciones), por `find_or_link_contact`. Toque `origin = whatsapp_group` (00281, `touch_channel` lo cuenta organico), una vez por persona y grupo (`wa-group:<grupo>:<contacto>`).
- **Un voto de encuesta NO es un mensaje** (`parseBaileysPollVote`): en privado se ignora (antes entraba vacio y despertaba al agente). Evolution solo descifra votos de encuestas que salieron de nuestro numero.
- **Los disparadores** (`whatsapp_group_joined|reaction|poll_vote`, 00282) son de contacto, por la cola; declaran `conversationFor` (hook nuevo: el flujo escribe por privado en el numero del grupo) y saltean «no contactar». Filtros puros en `lib/whatsapp-groups/automation/trigger-config.ts`. Nodo `send_poll` («Enviar encuesta», sin contacto).
- **Un solo envio a un grupo** (`lib/whatsapp-groups/send.ts`): bandeja y paso «Enviar encuesta». El eco se junta por `(group_id, platform_message_id)` (indice NO parcial, para el `on_conflict`).
- **Chats y grupos son una sola lista, sin tocar la base** (`lib/inbox/unified-list.ts`, puro): las conversaciones se paginan como siempre (se pide una fila de mas) y cada grupo cae en LA pagina que le toca por la fecha de su ultimo mensaje; no cuenta para el tamaño de la pagina. Un grupo no tiene estado, etiquetas, responsable ni agente: con esos filtros puestos no entra (`groupsCanMatch`). Se considera abierto. `?vista=grupos` (el link viejo) sigue queriendo decir `?tipo=grupos`.
- **`participantsData` de Evolution 2.3.7 viene roto**: se lee `participants[]` (objetos `{id, phoneNumber, lid}`).

## Migraciones

`00280` (tablas, permisos, realtime), `00281` (origen `whatsapp_group` + `touch_channel`; la definicion vieja en la cabecera) y `00282` (CHECK de `triggers.type`). Aditivas, van ANTES de desplegar el codigo. **Aplicadas y registradas** el 3/11/2026 (versiones `20261103093659`, `...093703` y `...093707`), despues de ensayarlas en una transaccion que se deshizo sola, con `verify-whatsapp-groups`, `verify-contact-merge` y `verify-organic-attribution --despues-de-00234` en verde. **La proxima libre es la `00283`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-whatsapp-groups.mjs   # permisos SQL<->TS, RLS, unicos, toque organico, disparadores, cascada
```

# Comunidades de WhatsApp y configurar grupos (00344, 8/11/2026)

Una comunidad es una comunidad madre (sin mensajes), un grupo de Avisos (mismo nombre que la comunidad) y sus grupos. La lista de Grupos, la bandeja y los pasos los agrupan por comunidad; los grupos se configuran y se crean desde el sistema; y hay dos pasos nuevos: «Enviar al grupo» e «Invitar a un grupo». Detalle en [docs/whatsapp-grupos.md](docs/whatsapp-grupos.md) («Comunidades», «Configurar y crear grupos»).

## Lo que no se puede romper

- **La comunidad madre nunca se guarda** (`kind IN ('group','announce')`): no tiene mensajes. Cada grupo lleva `parent_group_jid` y una copia del nombre (`community_subject`). `fetchAllGroups` devuelve las madres marcadas (`isCommunity`) y `mergeGroupLists` las saca de la lista.
- **Evolution no tiene rutas de comunidades** (ni la 2.3.7 ni la última): crear una comunidad o vincular un grupo se hace desde el celular. Tampoco ve grupos donde el número no está.
- **`number_is_admin` null = no se sabe**, y nunca pisa uno conocido (`liveGroupColumns`). Solo se frena escribir cuando se SABE que no es admin y solo escriben admins (`cannotWriteReason`).
- **Todos los grupos del número van solos a la bandeja** (decisión del 8/11/2026): `syncChannelGroups` al abrir la lista de Grupos, `ensureInboxGroup` cuando llega un mensaje, un aviso de miembros o `GROUPS_UPSERT` de un grupo que no estaba. La comunidad madre nunca. Lo único que se elige por grupo es «Guardar como contacto a quien se une», en Ajustes o desde el chat (Configurar → Contactos).
- **Configurar y crear piden `channels.manage`** (`lib/actions/whatsapp-group-manage.ts`), escriben con el cliente de servicio filtrando por el workspace de la sesión y quedan en `audit_log` (`section: whatsapp_group_manage`). El link por privado a quien no se pudo agregar respeta «no contactar».
- **Un número nuevo se crea con `groupsIgnore: false`**; abrir la lista de Grupos se lo pide de nuevo a uno viejo.
- **`?comunidad=<jid>` es «solo grupos»**: la página pone `listType: "grupos"` para que el Realtime de chats no meta ninguno.
- **Los pasos de grupos saltean con `skipGroupStep`** y usan `flow_send_claims` y el tope de WhatsApp como «Enviar encuesta».

## Migración

`00344_whatsapp_communities` (aditiva: seis columnas en `whatsapp_groups`, sus CHECK y un índice) va **ANTES** de desplegar el código: la bandeja y la lista de Grupos leen sus columnas. Ensayada en una transacción que se deshizo sola y **aplicada y registrada** el 8/11/2026 UTC (versión `20261108170116`), con `verify-whatsapp-groups --despues-de-00344` en verde. La `00340`, `00341` y `00343` son de otras sesiones y la `00342` parece reservada. **La próxima libre es la `00349`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-whatsapp-groups.mjs --despues-de-00344
```

# Gráfico diario de un número de WhatsApp (00348, 8/11/2026)

En la sección Historial de la tarjeta del número: los últimos 30 días (en la zona de quien mira), con los **enviados** apilados por origen (automatización, broadcast, agente IA directo, borrador del agente aprobado, escrito por una persona, fuera del sistema), lo **programado** para los próximos 7 días como barra punteada sin relleno, y los **recibidos** en un gráfico aparte. Pasar el mouse por un día abre un recuadro con todos sus números. Lo que más importa vigilar es lo que sale: es lo que mira WhatsApp para bloquear un número.

- **Cuenta la base**: `whatsapp_channel_daily_messages` (solo `service_role`), llamada por `loadWhatsappDailyMessages` (`lib/actions/whatsapp-stats.ts`) después de `channels.manage` y con el workspace de la sesión. Devuelve solo cuentas por día.
- **Quién mandó cada mensaje** sigue el criterio de `chat_reply_is_human` (00261): `agent` con `sent_by_user_id` es un borrador aprobado; sin persona, envío directo; `flow`/`sequence`/`broadcast` es automatización; `external` o sin origen, fuera del sistema. Un envío fallido o pendiente no cuenta.
- **Lo que sale a un grupo cuenta como enviado**; los recibidos son solo de chats privados (un grupo grande taparía el resto).
- **Lo programado es una estimación** (`lib/whatsapp-stats/projection.ts`, puro; lo lee `projection-load.ts`): los broadcasts `scheduled`/`sending` con destinatarios `pending` se reparten simulando el carril con el ritmo del número (el mismo cálculo que `estimateFinish`, en la zona del negocio), uno detrás de otro; los pasos de secuencias activas por su `next_step_at` (uno vencido cuenta hoy); y las automatizaciones «En una fecha y hora» publicadas, un mensaje por paso a un grupo de este número y por vez. Un broadcast pausado no se proyecta. Nunca lanza.
- **Dos gráficos, dos escalas** (nunca dos medidas en un eje). Los colores son fijos por origen (paleta validada para daltonismo, claro y oscuro) y hay una tabla oculta para lectores de pantalla. La serie y los totales son puros (`lib/whatsapp-stats/daily.ts`).
- `00348` (aditiva, una función de lectura): **aplicada y registrada** el 8/11/2026 UTC (versión `20261108180129`). `00349` la recrea con la columna `broadcast` (separada de `automation`, que queda para flujos y secuencias); va **ANTES** del deploy: **aplicada y registrada** el 8/11/2026 UTC (versión `20261108181945`), después de ensayarla en una transacción que se deshizo sola. La `00345` a la `00347` son de otras sesiones. **La próxima libre es la `00351`** (la `00350` es de los cron; confirmar con `list_migrations` y las ramas locales).

# Importacion de conversaciones de Zernio (28/10/2026)

Traer TODAS las conversaciones de cada cuenta de Instagram, y las que empieza el negocio. Diagnostico y plan en `docs/instagram-importacion/PLAN.md`; como entra cada conversacion, en [docs/flujo-de-mensajes.md](docs/flujo-de-mensajes.md).

## Lo que no se puede romper

- **La importacion es un trabajo de la cola, por partes y sin tope** (`inbox_import`, de a 100 por vuelta, activas y despues archivadas). Nunca vuelve a correr dentro de una peticion: con miles de conversaciones tarda minutos. Antes se cortaba en 200 y volver a sincronizar miraba las mismas 200.
- **Una corrida a la vez por canal.** Cada corrida tiene su `run_id` y cada vuelta su `step`; el avance se guarda con un UPDATE condicional sobre los dos (`writeStateIfCurrent`). Una vuelta vieja o repetida por la cola no escribe ni encola. `startInboxImport` no arma otra mientras una corre (salvo que lleve media hora sin novedades).
- **No lanza por un fallo de Zernio**: un 429, un 5xx, la red, Vault sin responder o `meta.failedAccounts` esperan 1, 5 y 15 minutos y vuelven a pedir la MISMA pagina; despues queda `partial` con el motivo y "Reintentar". Un 401/403 o la falta de clave cortan enseguida.
- **Tres pasadas**: al conectar (o el primer "Sincronizar"), a las 24 horas y a los 7 dias (`inbox_import_pass`). Zernio trae el historial viejo en segundo plano sin avisar; una sola pasada no alcanza. "Sincronizar" en un canal ya importado es una pasada suelta, sin repeticiones.
- **Lo importado es historia**: no dispara automatizaciones, el agente ni las reglas de asignacion; no pisa una conversacion que ya mantiene el webhook (`ignoreDuplicates` sobre `(channel_id, contact_id)`). Escribe el cliente de servicio, con el workspace del CANAL (que se busca con el de la sesion de quien la arranco).
- **Una conversacion que empieza el negocio entra igual**: el eco `message.sent` sin conversacion la crea con la persona de `payload.conversation` (`ensureZernioConversation`, regla unica de contactos, sin no leidos, sin sellar `last_interaction_at`); `conversation.started` hace lo mismo sin mensaje. Sin `participantId`, se descarta como antes.
- **`upsertConversation` no pierde un mensaje por una carrera**: si el insert choca (23505) porque otra llegada creo la conversacion en el mismo instante, usa la que gano.
- **Despues del deploy, cada instalacion toca "Sincronizar canales" una vez**: arranca la importacion completa y suma `conversation.started` al webhook de Zernio.
- **Un contacto sin nombre nace con "@usuario" y, si tampoco hay usuario, con el id de la plataforma** (`fallbackContactName`, `lib/contacts/anonymous.ts`), en los cuatro caminos de Instagram (mensaje, eco/`conversation.started`, importacion y comentarios). Los dos son **rellenos** desde la `00284`: `is_placeholder_name` (y su gemela `isPlaceholderName`) reconoce un nombre de solo digitos (8+, "+" opcional: id o telefono) y uno que es un solo `@usuario`, asi que el nombre real los reemplaza cuando la persona escribe. Antes un id quedaba como nombre para siempre (325 de 1505 conversaciones). La importacion tambien completa el nombre de una conversacion YA conocida cuyo contacto tiene un relleno. La variable `commenter_name` de los flujos NO cambio (sin "@"). Desde la `00296`, un id como nombre sin ningun dato cuenta como anonimo si la persona nunca escribio (ver "Contactos sin identificar").

# Contactos sin identificar (6/11/2026)

ManyChat le escribe a cada seguidor nuevo; Instagram no da el nombre ni el usuario hasta que la persona interactua. El contacto **se guarda igual pero queda oculto** hasta saber quien es. Detalle en [docs/flujo-de-mensajes.md](docs/flujo-de-mensajes.md) («El contacto sin identificar»).

- **`is_anonymous` (columna generada, 00296 y 00298) suma un nombre de solo digitos (8+) sin ningun dato, solo si la persona nunca escribio (`contacts.first_inbound_at`).** Quien escribio y solo tiene un id, como un `@lid` de WhatsApp, sigue visible: WhatsApp nunca lo va a completar. Lo saca de Contactos y de la asignacion, y `contact_created` recien se emite al identificarse. La misma expresion vive en `isAnonymousContact` y un test las compara. Un id SOLO no identifica: nunca crear otra tabla para esto, los toques ya estan en el contacto y no hay nada que mover.
- **La bandeja oculta lo mismo por defecto**: `conversation_is_silent_outreach` (campo calculado, misma razon que `conversation_people`) = la persona nunca escribio (`contact_wrote_at` null) y el contacto es anonimo. `contact_wrote_at` lo mantiene el trigger `messages_zz_contact_wrote` (tambien al mover un mensaje, por la fusion) y no depende de la retencion. Se ven con `?sin-identificar=1` y la linea de arriba de la lista; un link `?c=` abre igual.
- **Un comentario completa al contacto** con su @ y su nombre (`completeProfileFromComment`): no pisa lo escrito por una persona ni escribe un @ que ya es de otro contacto. Va en `try/catch`.
- **Un webhook de ManyChat con solo nombre y @ crearia una persona duplicada**: el contacto oculto solo tiene el id de Instagram. Antes de armarlo, comprobar que ManyChat manda ese mismo id y sumarlo a «Crear o actualizar contacto» (hoy no lo acepta).

`00296_unidentified_contacts` y `00298_anonymous_only_if_never_wrote` van ANTES de desplegar el codigo (la bandeja lee el campo calculado). `node scripts/verify-unidentified-contacts.mjs`. **La proxima libre es la `00299`** (la `00297` es de Grabaciones, la `00295` quedo sin usar y la `00291` sigue reservada para `automation_runs`; confirmar con `list_migrations` y las ramas locales).

# Conocido, Cliente y agenda en un paso (28/10/2026)

- **«Cliente» es la marca hermana de «Conocido»** (00268, `contacts.is_customer`): mismos efectos (agente apagado con `agent_disabled_by_customer`, secuencias pausadas con motivo `customer`, aviso antes de abrir el chat) y se marca sola al cobrar un pago positivo de una venta (`payments_mark_customer`, que nunca tumba el pago; en la plantilla de estudiantes se poda). Sus chats van a `workspaces.customer_contacts_settings`; **sin nadie configurado, el responsable NO cambia** (un conocido va al Owner). Reglas puras en `lib/inbox/marks.ts`, cómo se ve cada marca en `components/contacts/mark-badge.tsx`, y cada fila de la lista de chats tiene un menú «⋯» (`lib/inbox/row-actions.ts`).
- La 00268 redefine `tag_effect_release`, `contacts_known_effects` y `assign_new_conversation` (copias con el bloque «00268» marcado): sacar una etiqueta o la marca de conocido ya no prende el agente si sigue otra marca.
- **El nombre y los datos del contacto se editan con un lápiz siempre visible** (`InlineField`), en la ficha y en el panel de la bandeja (sección «Datos»).
- **Agendar a mano es un solo modal** (00269, `event_types.is_internal`): ver «Agendar a mano en un solo paso» en [docs/agendamiento.md](docs/agendamiento.md).
- **Ubicación y Google Meet al agendar a mano (3/11/2026, sin migración)**: el botón de Meet aparece solo si quien atiende puede crearlo (`meetAvailableFor`, una sola regla) y el servidor lo vuelve a comprobar; el link se ve al rato en el panel («Unirse a Meet») y en el calendario. Ver «Ubicación y Google Meet» en [docs/agendamiento.md](docs/agendamiento.md).
- **00268 y 00269 son aditivas y van ANTES de desplegar el código** (la bandeja y la Agenda leen sus columnas): **aplicadas y registradas** el 28/10/2026 (versiones `20261028233701` y `20261028233702`), después de ensayarlas en una transacción que se deshizo sola. **La próxima libre es la `00270`** (confirmar con `list_migrations` y las ramas locales).

# Emails: suscripción y baja (construido, 29/10/2026)

Quién puede recibir emails de marketing, link de baja en un clic, rebotes y quejas de Resend, panel e importador que conserva la suscripción de otro sistema. Plan y avance en `docs/PROGRESS-suscripcion-email.md`, pendientes en `docs/PENDIENTE-suscripcion-email.md`, guía de importación en [docs/importar-contactos-con-suscripcion.md](docs/importar-contactos-con-suscripcion.md).

## Los cinco estados

`contacts.email_status`: `subscribed` (Suscripto), `not_subscribed` (Sin suscribir, 00278: nunca aceptó marketing en un formulario), `unsubscribed` (Dado de baja), `bounced` (Rebota) y `complained` (Marcó spam), con `email_status_at`, `email_status_source`, `email_subscribed_at` y `email_unsubscribe_token`. Vale para las dos direcciones del contacto. **El estado de una DIRECCIÓN es el peor entre todos los contactos del workspace que la tienen, incluidos los borrados** (`email_address_status`): borrar un contacto o pasar el email a otro no "borra" una baja. `is_subscribed` es OTRA cosa: solo las difusiones por chat (etiqueta «Recibe difusiones por chat»), y no cambió.

## Lo que no se puede romper

- **Todo cambio de estado pasa por `set_email_status` / `set_email_status_by_address` (00271)**, y desde el código solo por `lib/email/subscription.ts` (`setEmailStatus`, `setEmailStatusByAddress`). La guardia `contacts_email_status_guard` (EM003) rechaza cualquier otra escritura de las cinco columnas, también del service role; `subscription-single-entry.test.ts` lo exige en el código y `verify-email-subscription` en la base. Cada cambio deja una entrada `email_status` en `audit_log` (con origen, modo, motivo, fecha real del hecho y cuántas inscripciones pausó), en la misma transacción y con `pg_advisory_xact_lock` por (workspace, dirección). Idempotente: el mismo estado no escribe nada.
- **La baja gana.** Modo `system` (importación, webhooks, herencia, fusión) solo empeora y NUNCA re-suscribe (`kept_existing`). `person` (la persona desde el link) va y vuelve entre suscripto y dado de baja, nunca desde un rebote o una queja. `admin` (el equipo, con `contacts.edit`) puede todo, pero sacar un rebote o una queja exige motivo (EM002). La tabla tiene gemelas: `private.email_status_decide` y `decideEmailStatus`, con `subscription-transitions.cases.json`.
- **Todo email a un contacto pasa por `canSendEmailTo`**, dentro de `sendTransactionalEmail` (parámetro `category`) y `sendEmailReply` (parámetro `category` obligatorio). Mira la dirección en todos los contactos EN EL MOMENTO de enviar (`email_address_send_state`, con el cliente de servicio): no depende de la columna cacheada ni del trigger de herencia. Rebota → no sale nada, ni transaccional. Dado de baja o spam → no sale marketing; transaccional sí. Si la base no contesta: marketing no sale (`skipped_unverifiable`), transaccional sí. Un salto queda en `email_log` (`skipped_*`, 00272), nunca es un fallo y nunca frena un flujo ni una secuencia. Los emails al equipo (invitaciones, avisos, pruebas del editor) no llevan categoría; `subscription-gate.test.ts` los lista uno por uno y falla si aparece otro llamador sin categoría.
- **Marketing vs transaccional.** Nodo «Enviar email»: lo que elija el paso («Tipo de email»); sin elegir, transaccional si el flujo es de agenda, formularios o del sistema (o arrancó por una reunión) y marketing si lo armó una persona (`stepEmailCategory`). Por `sendChannelMessage`: marketing si nace de un flujo o una secuencia, transaccional el agente (`channelEmailCategory`). Secuencias: por paso (`emailCategory`, marketing por defecto). Bandeja y contratos: transaccionales (los contratos solo los frena un rebote; la bandeja pregunta antes si la persona se dio de baja).
- **Todo email de marketing lleva el pie y las cabeceras** `List-Unsubscribe` (solo https, el endpoint de un clic) y `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; ningún transaccional (`lib/email/unsubscribe.ts`, `withUnsubscribe`). `{{unsubscribe_url}}` se protege con un marcador https ANTES de limpiar el HTML y la puerta pone el link real; si la plantilla ya lo usa, no se duplica el pie.
- **La baja pública**: `/baja/<token>` NO da de baja al abrirse; el botón sí (`person`, `unsubscribe_page`). `POST /api/email/baja/<token>` es el clic del cliente de correo (`one_click`): 200 si el token existe, 404 si no, sin datos. Solo se muestra la dirección enmascarada. Tope por IP. `baja` es una ruta reservada del sitio.
- **La baja pausa en el momento** las inscripciones activas sobre un canal de email con algún paso de marketing pendiente (`email_unsubscribed` / `email_bounced` / `email_complained`), y **no se reanudan solas**. `resumeEnrollment` no reanuda mientras la dirección siga sin poder recibir marketing. El procesador vuelve a mirar antes de cada paso (respaldo).
- **Herencia y fusión**: poner una dirección dada de baja (aunque sea de un borrado) la hereda (`contacts_email_inherit`); si ese trigger falla, NUNCA en silencio: `RAISE WARNING` + `email_status_inherit_failed` en `audit_log`, y el alta no se cae. Al fusionar, el principal se lleva el peor estado (`contacts_email_on_merge`, mismo patrón que Conocido/Cliente): `merge_contacts` no se reescribió.
- **Rebotes y quejas de Resend**: el MISMO receptor (`/api/webhooks/resend-inbound`) y el mismo secreto; el workspace sale del id del email, del remitente o probando la firma de cada negocio. Solo un rebote `Permanent` deja «Rebota». Los pasos para activar los eventos en Resend están en el PENDIENTE.
- **Importador**: cuatro columnas de suscripción con sugerencia automática; las filas del mismo email se consolidan antes de escribir (gana lo más grave); todo por `set_email_status` en modo `system` con la fecha original y `import:<origen>`; «Revisar antes de importar» corre la MISMA lógica sin escribir. La importación ya no dispara automatizaciones (los eventos de la tanda quedan procesados; ver la ventana en el PENDIENTE).
- **Remitentes de Resend**: importantes (obligatorio) y marketing (opcional), usuario + dominio verificado de la lista de Resend (la key se lee en el servidor y nunca sale); se guarda también `from_email` compuesto. El formulario genérico ya no dibuja el remitente y guardar la key no lo pisa. Un remitente con dominio sin verificar se avisa en rojo y no se cambia solo.

## Migraciones

`00270` (columnas, índices, backfill sin tocar `updated_at`), `00271` (funciones, guardia, herencia, fusión) y `00272` (estados `skipped_*` de `email_log`): **aplicadas y registradas** el 29/10/2026 (versiones `20261029224458`, `20261029225041` y `20261029230043`). En un clon nuevo van ANTES de desplegar el código. **La próxima libre es la `00273`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-email-subscription.mjs   # transiciones (SQL↔TS), 10 llamadas en paralelo, direcciones, token, guardia, herencia (y su fallo forzado), secuencias, funciones
```

# La web de un cliente: formularios desde otro dominio (2/11/2026)

La web propia de un negocio (otro dominio, sin servidor) manda sus formularios desde el navegador y pide links de baja nuevos. Pantalla: **Ajustes → Integraciones → Tu sitio web**; guía que viaja a los clientes: `/conectar-web` (`.claude/commands/conectar-web.md`); detalle en [docs/formularios.md](docs/formularios.md) («La web propia de un negocio»).

## Lo que no se puede romper

- **Nada de un negocio en el código**: los dominios son de cada workspace (`workspaces.website_settings`, 00277), se cargan en la pantalla (`integrations.manage`) y se validan en `lib/settings/website.ts` (https exacto, sin ruta; `http://localhost` solo de desarrollo). Sirve igual con un despliegue por cliente o varios negocios en uno: el negocio sale del recurso (el slug del formulario o el del workspace), nunca de una variable global.
- **CORS en un solo lugar** (`lib/http/cors.ts`): el origen exacto, nunca `*`, sin credenciales, `Vary: Origin` siempre. Lo usan el envío, el beacon y el link de baja.
- **El servidor rechaza un origen ajeno** (403 `origin_not_allowed`, sin guardar): un envío con FormData no tiene preflight y CORS solo esconde la respuesta. Sin `Origin` (curl) o de la propia app (`/f/`, embed, dominio propio apuntado a la app: `selfOrigins`) pasa como siempre. Ante un error leyendo los orígenes, la lista queda VACÍA (nunca se abre de más).
- **El tope del cuerpo va antes de leerlo** (`readBytesCapped`): 413 por `Content-Length` o cortando la lectura. 35 MB con archivos o firma, 64 KB solo texto (`bodyLimitBytes`).
- **`version_id` es opcional solo con `origin: "site"`**; para el resto sigue siendo obligatorio.
- **`meta_event_id` va a `form_submissions.meta`**, no a la lista de atribución (`lib/attribution/keys.ts` no cambió).
- **El link de baja nuevo** (`/api/public/email/unsubscribe-link?workspace=<slug>`) responde siempre `{ ok: true }`, manda después de responder (`after()`), nunca loguea el email y toma el token con `email_address_send_state`.
- **«Sin suscribir» (`not_subscribed`, 00278)**: quinto estado de email. No recibe marketing; lo transaccional sí. Lo pone la casilla de marketing de un formulario SIN marcar y solo con contacto NUEVO; el modo `consent` (casilla marcada) solo saca de ahí, nunca levanta una baja, un rebote ni una queja. Gravedad: complained 5 > bounced 4 > unsubscribed 3 > not_subscribed 2 > subscribed 1. Gemelas SQL↔TS con `subscription-transitions.cases.json`.

## Migraciones

`00277` (`workspaces.website_settings`, aditiva) y `00278` (`not_subscribed`, el modo `consent`; reescribe `email_status_rank`, `email_status_decide`, `email_status_apply` y `email_pause_enrollments` con las definiciones viejas en la cabecera). Las dos van ANTES de desplegar el código. **La próxima libre es la `00279`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-forms.mjs                 # incluye «La web de un cliente» (dos negocios, dos pasos, Sin suscribir, link de baja)
node scripts/verify-email-subscription.mjs    # incluye el bloque 10 (Sin suscribir y el modo consent)
```

# Resend: una sola tarjeta, webhook en un clic y recepción por dominio (construido, 2/11/2026)

Toda la configuración de Resend vive en **Ajustes → Integraciones → Resend**, en este orden: Estado (✓/✗ y «Probar», que solo lee), Conexión (API key), Remitentes (E8), Webhook y Recepción de emails. «Resend (email entrante)» (`resend_inbound`) quedó **oculta** y su URL redirige. Guía en [docs/integraciones.md](docs/integraciones.md) («Email: la tarjeta Resend»); avance y decisiones en `docs/PROGRESS-resend-conexion.md` y `docs/PENDIENTE-resend-conexion.md`.

## Lo que no se puede romper

- **La configuración está en `integration_configs.config` de la fila `email_provider/resend`**, en claves planas de texto (`RESEND_CONNECTION_CONFIG_KEYS`, `lib/email/resend-config.ts`: `access`, `webhook_*`, `receiving_*`, `daily_quota`). Están en `DISCOVERED_CONFIG_KEYS`: volver a guardar la key no las pisa. Sin tabla nueva.
- **SSA solo administra SU webhook** (`lib/email/resend-webhook.ts`, `ownershipOf`): el que apunta exactamente al receptor, sin query o con `?w=` de ESTE negocio. Uno sin `?w=` (creado a mano) se adopta: se le pone el `?w=` y se le suman los eventos sin sacarle ninguno. Uno con `?w=` de otro negocio, otra ruta u otro dominio no se toca nunca. El módulo no sabe borrar. Un test lo fija con espías.
- **Los eventos están en UN lugar** (`lib/email/resend-events.ts`): `email.received`, `email.bounced`, `email.complained`. Sumar uno es agregarlo ahí («Actualizar webhook» lo sincroniza) y enseñarle al receptor qué hacer.
- **Un webhook por negocio con `?w=<workspace>`** (`resendWebhookUrl`, `lib/webhook-url.ts`, que rechaza una URL local). En el receptor, el parámetro solo elige con qué secreto verificar: la firma sigue siendo obligatoria, y un `w` que no es UUID da 401 sin leer ningún secreto. **Sin `?w=` funciona como antes** (compatibilidad).
- **El secreto del webhook no depende de la recepción**: rebotes y quejas se validan con él aunque la recepción esté apagada. En Vault sigue llamándose `resend_inbound_webhook_secret` (en TypeScript `SECRET_NAMES.resendWebhookSecret`). Se guarda al conectar (Resend lo devuelve al crear y en `GET /webhooks/{id}`) o se pega a mano (plan B, `whsec_…`). Desconectar Resend borra solo la API key.
- **«Probar y guardar» prueba la key** (`GET /domains`): 200 = `access: full`; 401 `restricted_api_key` = `access: sending` (se guarda; webhook y dominios a mano); otro 400/401/403 no se guarda; red o 5xx se guarda. Con acceso completo, `saveIntegration` conecta el webhook solo, best-effort (un fallo vuelve como aviso, nunca tumba el guardado).
- **Recepción por dominio**: el canal de email sigue siendo UNO por negocio y su `email_address` es la **principal** (`<usuario>@<dominio>`, default `hola`). El receptor ubica el canal por dirección EXACTA primero y después por DOMINIO (`resolveInboundChannel`, `lib/email/inbound-address.ts`, mira `to`, `cc` y `received_for`). Dos negocios con el mismo dominio y sin `?w=`: 401 y una línea en el log, no se adivina. Apagar la recepción desactiva el canal.
- **La respuesta sale desde la dirección a la que escribió la persona** (`replyFromAddress` en `sendEmailReply`), solo si es del dominio del canal; si no, desde la principal. Nunca desde un dominio ajeno. La bandeja muestra «para: …» en los entrantes.
- **Configurar Resend (también la recepción) pide `integrations.manage`.** Antes la tarjeta entrante pedía `channels.manage`: es más estricto, no más laxo. La política de la 00213 no se tocó.
- **«Último aviso recibido»** = `integration_configs.last_event_at` (00279). Lo escribe el receptor después de una firma válida, solo esa columna, a lo sumo una vez por minuto, en `after()` y en `try/catch`.
- **La API de Resend se simula en todos los tests** (`fetchImpl` inyectado). SSA nunca crea, edita ni borra un webhook real fuera de la acción que dispara una persona desde la tarjeta.

## Migraciones

`00279_resend_unified` (aditiva: `integration_configs.last_event_at` y la copia de cada `resend_inbound` a la fila `resend` del mismo negocio, sin pisar nada; en producción no copió nada). **Aplicada y registrada** el 3/11/2026 (versión `20261103010606`); puede ir antes del deploy. **La próxima libre es la `00280`** (confirmar con `list_migrations` y las ramas locales).

# Mi cuenta: perfil y notificaciones (construido, 30/10/2026)

Cada persona del equipo tiene su página (`/dashboard/cuenta`, pestañas Perfil y Notificaciones), abierta desde el menú de usuario del pie («Mi perfil» y «Notificaciones»). Resumen en [docs/cuenta-y-notificaciones.md](docs/cuenta-y-notificaciones.md); pendientes en `docs/PENDIENTE-cuenta.md`.

## Lo que no se puede romper

- **Todo sale de la sesión**: ninguna acción de Mi cuenta (`lib/actions/account.ts`) recibe un usuario del navegador, y la página no pide permisos. El nombre sigue en `user_metadata.full_name` (se cambia con `updateUser` y se renueva la sesión: el panel lo lee del token).
- **`user_profiles` (00273)**: solo la fila propia (RLS), sin DELETE. El teléfono se guarda normalizado (`+<dígitos>`, CHECK) y la foto siempre en la carpeta de su persona (CHECK). **El bucket `user-avatars` es público y NO tiene policies de escritura**: sube y borra el servidor después de validar los bytes (`parseAvatarDataUrl`). La pantalla recorta la foto a 384 px (una Server Action acepta 1 MB).
- **Las fotos del equipo viajan una vez**: el layout carga `id → URL` (`workspace_member_profiles` devuelve `avatar_path` desde la 00274) y `MemberAvatarsProvider` las reparte; `Avatar` con `userId` la busca ahí. **Sin foto, `Avatar` dibuja exactamente el mismo HTML de antes** (`member-avatars.test.ts`).
- **Un solo catálogo de avisos para las preferencias**: `lib/notifications/preferences.ts` (eventos que agrupan tipos, sección, a quién le puede llegar y defaults). Cada tipo de `NOTIFICATION_TYPES` está en UN evento (`preferences.test.ts`): **un tipo de aviso nuevo se suma a un evento en el mismo cambio**. Lo guardado es solo lo que difiere del default (`withPref`).
- **La campana muestra lo propio y lo general**, sin lo silenciado (`lib/notifications/bell-filter.ts`, en `listNotifications`, `countUnreadNotifications` y `markAllNotificationsRead`). `can_see_notification` y la RLS de `notifications` NO cambiaron.
- **Email y WhatsApp los manda SOLO el job `notification_deliver`** (`lib/notifications/deliver.ts`), que encola el trigger de la 00275 en cada aviso (en `EXCEPTION`: nunca tumba el insert). Nunca lanza por un proveedor (reagenda a 1, 5 y 15 min), anota cada envío en `metadata.delivered` (un reintento no repite), tope de uno por persona, evento y cosa cada 10 minutos, y no manda avisos de más de 24 h. `notifyWorkspaceAdmins` ya no manda email propio.
- **El WhatsApp al equipo sale del canal elegido en Ajustes → General** (`workspaces.team_alerts_settings`, `settings.general`) por `sendTeamWhatsApp` → `sendEvolutionDirect`: no crea contactos ni conversaciones. **Cuenta en el tope único del número** (`claim_automated_send` con `WHATSAPP_HOURLY_LIMIT`, `lib/channels/whatsapp-limits.ts`): en el tope devuelve `rate_limited` y el job lo reagenda para la hora siguiente sin gastar intento (7/11/2026). El email al equipo va sin `category` (está en la lista de `subscription-gate.test.ts`).
- **Olvidé mi contraseña**: `/recuperar` responde siempre lo mismo (no revela cuentas; tope por IP y por email), el link vuelve por `/auth/callback` o `/auth/confirm` (token_hash, la plantilla en español) y `/restablecer` pone la nueva. `recuperar` y `restablecer` son rutas reservadas del sitio y `/auth/confirm` pasa el middleware como el callback.
- **La pestaña de Mi cuenta sale de la URL** (`useSearchParams` + `history.pushState`): el menú de usuario y el «atrás» la cambian. Mi cuenta no marca ningún ítem del menú lateral (`PROFILE_MENU_ROUTES`).

## Migraciones

`00273` (tabla y bucket) y `00274` (preferencias, `team_alerts_settings`, `workspace_member_profiles` con la foto —la definición vieja completa en su cabecera— y la función que encola) son aditivas y van **ANTES** del deploy; `00275` (el trigger) va **DESPUÉS**. La `00273` y la `00274` están **aplicadas y registradas** (30/10/2026, versiones `20261030183536` y `20261030183537`), con `verify-account` y `verify-workspace-isolation --despues-de-00143` en verde; la `00275` se aplicó y registró **después del deploy** (30/10/2026, versión `20261030211848`), con `verify-account --despues-de-00275` en verde. **La próxima libre es la `00276`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-account.mjs                    # RLS, bucket, preferencias, team_alerts_settings, workspace_member_profiles
node scripts/verify-account.mjs --despues-de-00275 # además, que cada aviso encole su entrega
```

**SECURITY DEFINER cerradas para anon (2/11/2026).** `00276_security_definer_not_callable_by_anon`: a `can_give_role`, `can_grant_permissions` e `is_own_role` se les saca PUBLIC y anon (authenticated se queda: lo necesitan las policies de equipo), y a diez trigger functions de Agenda, Ventas, mensajes y roles se les saca PUBLIC, anon y authenticated (como la 00048). **Aplicada y registrada** el 2/11/2026 (versión `20261102230245`), con `verify-roles --despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212 --despues-de-00249` en verde antes y después. En el linter, «Public Can Execute SECURITY DEFINER Function» queda solo con `get_public_form` (pública a propósito: `/f/[slug]`). Toda SECURITY DEFINER nueva lleva su `REVOKE ALL ... FROM PUBLIC, anon` (y `GRANT` explícito): la `00000` le da EXECUTE a anon por defecto. **La próxima libre es la `00277`** (confirmar con `list_migrations` y las ramas locales).

# Broadcasts y la cola de envíos (3/11/2026)

Un mensaje a muchos contactos por WhatsApp (Evolution) o email (Resend), con los MISMOS filtros de Contactos, variables con respaldo, hasta 5 variantes y una **cola de envíos** con ritmo por número. Resumen en [docs/broadcasts.md](docs/broadcasts.md).

## Lo que no se puede romper

- **La audiencia son los parámetros de URL de Contactos** (`broadcasts.audience_params`) y se re-planifica con `prepareContactList` + `applyListClauses`, con el cliente de la PERSONA (la RLS decide a quién ve). Se congela al confirmar (`queueBroadcast`); antes de cada envío se vuelve a mirar borrado, no contactar, baja y, si el filtro lleva etiquetas, que siga teniendo alguna (`left_audience`).
- **A quién se le manda lo decide UNA función** (`classifyRecipient`, `lib/broadcasts/audience.ts`), la misma para contar y para poner en cola. WhatsApp: solo quien ya escribió a ESE número, salvo la casilla «solo tienen teléfono». Email: marketing (`decideSend`). Instagram queda afuera.
- **El mensaje se arma en UN lugar** (`lib/broadcasts/render.ts`, puro): `{{contact.*}}`, `{{workspace.name}}`, `{{custom.<slug>}}`, respaldo `{{x|y}}`, un nombre de relleno cuenta como vacío, la variante es estable por destinatario. En email el HTML lo decide la plantilla y se limpia (`finalizeEmailHtml`).
- **El ritmo es del CARRIL (el canal)** y es puro (`lib/send-queue/pace.ts`): espera al azar entre mínimo y máximo, topes por minuto/hora/día, horario en la zona del negocio, pausa tras fallos seguidos. El techo es `channels.send_policy` (Canales, `channels.manage`); un broadcast solo puede ir más lento (`combinePolicies`).
- **El despachador** (`lib/send-queue/dispatch.ts`, `/api/cron/send-queue` cada 15 s) toma el carril con `claim_lane_slot` (gana uno solo) y el destinatario con `claim_broadcast_recipient` (SKIP LOCKED), y manda SOLO por `sendChannelMessage` (WhatsApp, con el tope de 200/h) o `sendTransactionalEmail` con `category: "marketing"`. Nunca lanza por un proveedor: reintenta a 1, 5 y 15 min. Un `sending` colgado pasa a `failed` sin reintento. Los contadores salen de los destinatarios (`refresh_broadcast_counts`).
- **Antes del primer mensaje a un número que nunca escribió, se pregunta si tiene WhatsApp** (`resolveWhatsappTarget`, `lib/send-queue/whatsapp-number.ts`; `dispatch.ts` sigue sin hablar con Evolution). Sin WhatsApp se saltea (`no_whatsapp`), sin vínculo ni conversación y sin contar para la pausa. Con WhatsApp se vincula con la forma que devuelve WhatsApp. Un error o una respuesta rara es un fallo con reintento, nunca un salteado.
- **Escribe solo el servidor** (00285): `broadcasts` y `broadcast_recipients` se leen con `broadcasts.manage` y no tienen políticas de escritura.
- **Eliminar = nunca salió nada** (00347, `delete_unsent_broadcast`, solo `service_role`): ningún destinatario `sending`/`sent`/`failed` y no se está enviando. Lo decide la base bloqueando el broadcast y las filas abiertas; se va con su cola (cascada). Lo que mandó algo queda como historia. La lista filtra por `?estado=` en la consulta y ordena siempre por creación (`lib/broadcasts/list.ts`).
- **Editar** (00355, `reopen_unsent_broadcast`, solo `service_role`): un programado o pausado que nunca mandó nada vuelve a borrador (misma regla y bloqueos que eliminar; la cola se vacía y la audiencia se arma de nuevo al reprogramar). Con envíos, solo «Editar mensaje» (`saveBroadcastMessage`, condicional a programado o pausado): el texto se arma al mandar, así que lo cambiado le llega a los que faltan. Los campos del mensaje son un solo componente (`components/broadcasts/message-fields.tsx`). La `00355` es aditiva: **aplicada y registrada** el 8/11/2026 UTC (versión `20261108194823`), después de ensayarla en una transacción que se deshizo sola; la `00356` es de otra sesión (mensajes de WhatsApp borrados): **la próxima libre es la `00357`** (confirmar con `list_migrations` y las ramas locales).
- **La cola le hace lugar a lo que sale en el momento** (7/11/2026, sin migración): todo WhatsApp que sale fuera de la cola (avisos, bandeja, grupos, agente, flujos, secuencias) corre `channel_send_lanes.next_send_at` a ahora + la espera mínima del número, nunca para adelante. Un solo lugar, `makeRoomForLiveSend` (`lib/send-queue/live-send.ts`), lo llaman `sendEvolutionDirect` (parámetro `lane` obligatorio; `null` solo para la cola misma, `origin: "broadcast"`) y `sendToGroup`. Nunca tumba un envío. El tope de WhatsApp es UNO: `WHATSAPP_HOURLY_LIMIT`, no se duplica. El envío viejo (`send_broadcast` en `/api/cron/jobs`, siempre por Zernio) y el `SegmentBuilder` ya no existen.

## Migraciones

`00285_broadcast_send_queue` (aditiva) va **ANTES** de desplegar: **aplicada y registrada** el 3/11/2026 (versión `20261103235025`), después de ensayarla en una transacción que se deshizo sola, con `verify-broadcasts` y `verify-rls --despues-de-00143 --despues-de-00208` en verde. `00286_send_queue_cron` (reescribe `call_app_cron` + el cron cada 15 s) va **DESPUÉS** del deploy: **aplicada y registrada** (versión `20261104044906`). La `00287` y la `00288` son de la guardia de entrega (ver «Automatizaciones de email y envíos programados»): **la próxima libre es la `00289`**. `00347_delete_unsent_broadcast` (aditiva, puede ir antes o después del deploy; la `00340` a la `00346` son de Servicios, afiliados y comunidades): **aplicada y registrada** el 8/11/2026 UTC (versión `20261108180049`), después de ensayarla en una transacción que se deshizo sola, con `verify-broadcasts --despues-de-00347` en verde. La `00348` es de otra sesión: **la próxima libre es la `00349`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-broadcasts.mjs   # RLS, índice único, claim_lane_slot y claim_broadcast_recipient a la vez, contadores
```

# Automatizaciones de email y envíos programados (Fase 1a, 4/11/2026)

Una **guardia única de entrega** para todo el email de marketing (broadcasts, automatizaciones y secuencias): un máximo por día, calentamiento del dominio, freno automático por rebotes o quejas, primero los contactos más activos, y los resultados de cada envío (entregados, abiertos, clics, rebotes, quejas, bajas). Guía para mandar en [docs/envios-programados-email.md](docs/envios-programados-email.md); avance y decisiones en `docs/PROGRESS-automatizaciones-email.md`, pendientes en `docs/PENDIENTE-automatizaciones-email.md`. La Fase 1b (el disparador «En una fecha y hora» con audiencia, en una tabla `automation_runs`) y la Fase 2 (diseños, vista previa, prueba) van en otras ramas.

## Lo que no se puede romper

- **Una sola guardia**: `reserve_email_send` (00287, solo `service_role`) y su gemela `decideEmailSend` (`lib/email/delivery-guard.ts`), con los casos de `delivery-guard.cases.json` corriendo contra las dos (`verify-email-subscription` bloque 11). Si se cambia una regla, se cambia en las dos y se suma el caso. **El tope viejo de 100 del nodo «Enviar email» ya no existe** (`delivery-guard-boundary.test.ts` falla si vuelve): no conviven dos.
- **El tope del día = el más bajo** entre «Máximo de emails de marketing por día» (`marketing_daily_cap`, default 100) y el escalón del calentamiento (100 → 200 → 400 → 800 → terminado). Se cuenta en el **día del negocio** (`workspaces.timezone`), solo marketing que salió o está saliendo. La cuota del plan de Resend (`daily_quota`) aplica solo si está cargada, y cuenta todos los emails. El calentamiento sube un escalón el primer envío de un día nuevo si el día anterior salió algo y el freno no saltó. Arranca prendido si el negocio mandó menos de 500 de marketing, y la base guarda la decisión la primera vez.
- **Lo transaccional nunca espera ni cuenta** para el tope de marketing, y el freno no lo frena.
- **La reserva es atómica**: candado por negocio (`pg_advisory_xact_lock`) e inserta la fila de `email_log` en `reserved`. El envío la CIERRA en `sent`/`failed` (`settleReservedEmail`) y no inserta otra. Así, 10 envíos a la vez con tope 5 dejan pasar 5. Una reserva colgada cuenta como usada ese día. Si la base no contesta, el marketing espera 15 minutos (nunca sale a ciegas).
- **Lo que excede el tope no falla ni se pierde**: `sendTransactionalEmail` devuelve `{ reason: "deferred", retryAt }` (el inicio del día siguiente del negocio, o una hora más si está pausado), `sendEmailReply` devuelve `deferred`, y cada llamador lo reagenda sin gastar intento ni dejar un mensaje fallido:
  - **broadcasts**: el destinatario vuelve a `pending` con `next_attempt_at`, y el carril de email consulta el cupo (`email_send_capacity`) ANTES de reclamar;
  - **flujos**: `deferFlowNode` (`lib/flow-engine/defer-node.ts`) agenda un `resume_flow` con `rerunNode: true` y `resumeSession(..., { rerunNode })` vuelve a correr ESE paso, sin repetir a quien ya le mandó. Lo usan «Enviar email», «Enviar mensaje», «Enviar recurso» y «Respuesta con IA» por email;
  - **secuencias**: el paso queda para `retryAt`.
- **La zona del día del negocio sale de `private.email_guard_time_zone`** (00337): misma regla que estar en `pg_timezone_names`, pero un nombre IANA (`Zona/Ciudad`) se prueba con `AT TIME ZONE` sin leer el catálogo (leerlo costaba ~337 ms por email, dentro del candado). Lo demás (abreviaturas, POSIX, minúsculas) sigue yendo al catálogo y cae a UTC. **Nunca `pg_timezone_names` en algo que corre seguido**: lee ~1.200 archivos del disco cada vez. La `00337` está **aplicada y registrada** (8/11/2026 UTC, versión `20261108145052`); la `00338` (purga de avisos sin leer a 60 días) espera el OK. La `00330` a la `00336` son de Servicios y la `00339` de «En una fecha y hora»: **la próxima libre es la `00340`** (confirmar con `list_migrations` y las ramas locales).
- **Primero los más activos**: `broadcast_recipients.sort_key` (00288) = `contact_last_activity` al poner en cola (último mensaje o último toque; si no hay, el alta), y `claim_broadcast_recipient` ordena por ahí después de los reintentos.
- **El freno** (`lib/email/marketing-brake.ts`): con al menos 50 de marketing en 24 h, pasar el límite de rebotes (duros) o de quejas pausa TODO el marketing del negocio (`marketing_paused_at` en la config de Resend), avisa (`email_marketing_paused`) y queda en `audit_log`. Se evalúa al llegar un rebote o una queja de un email de marketing. Se reanuda solo a mano (`resumeMarketingAction`, `integrations.manage`, con confirmación). **Los límites son de cada negocio** (`lib/email/brake-limits.ts`, claves `marketing_brake_bounce_pct` y `marketing_brake_complaint_pct`, se cambian en «Entrega de marketing», quedan en `audit_log`): sin guardar, o con un valor inválido, 2 % y 0,05 %. Rebotes entre 0,5 y 10 %, quejas entre 0,01 y 1 %: un freno que nunca salta deja de cuidar el dominio.
- **Preheader** (la línea que la bandeja muestra al lado del asunto): `broadcasts.email_preheader` (00294) y `data.preheader` en el paso «Enviar email», con variables. `withPreheader` (`lib/email/html.ts`) lo pone DESPUÉS de limpiar el HTML, porque la lista blanca descarta el `div` oculto y dejaría el texto a la vista. Sin preheader, el email sale byte por byte igual.
- **Saludo con respaldo vacío**: `Hola, {{contact.first_name|}}.` da «Hola, Ana.» o «Hola.» en emails (`dropDanglingComma`, solo mira una plantilla con un respaldo vacío). `interpolateVariables` y el chat no cambian. **`contact.first_name` queda vacío si la primera palabra del nombre no sirve para saludar** («F», «Prof.», un email, un id, un @usuario; `firstNameOf`, `lib/flow-engine/variable-catalog.ts`), en flujos y en broadcasts. `contact.name` y `contact.display_name` no cambian.
- **Los eventos de Resend van a SU fila de `email_log`** por `provider_message_id` (`record_email_delivery_event`): `delivered_at`, `opened_at` + `open_count` (aproximado), `clicked_at` + `click_count` + `last_clicked_url`, `bounced_at` (solo duro), `complained_at`. `email.delivered`, `email.opened` y `email.clicked` están en `RESEND_WEBHOOK_EVENTS_LIST`, pero solo `received`, `bounced` y `complained` son imprescindibles (`RESEND_REQUIRED_EVENTS`): faltar uno de resultados no pone el webhook en rojo.
- **Bajas atribuidas a un email**: el link y el header de baja de marketing llevan `?e=<id de la reserva>`. La baja (página y un clic) marca `unsubscribed_at` en esa fila solo si es del mismo contacto y negocio. Un `e` inválido se ignora y la baja sale igual.
- **La config de la guardia vive en la fila `resend` de `integration_configs`** (claves planas en `RESEND_CONNECTION_CONFIG_KEYS`: guardar la key no las pisa). Se escribe SOLO con `patch_resend_config` (mezcla en la base: un valor null borra la clave), nunca leyendo y pisando el jsonb.
- **El aviso rojo del webhook** (`brakeWebhookProblem`, `EmailDeliveryNotice`): webhook desactivado o sin rebotes/quejas → «el freno automático no puede funcionar», en la tarjeta de Resend, el editor de broadcasts (canal email) y el paso «Enviar email». Avisa, no bloquea.
- **Resultados de un broadcast** (`lib/broadcasts/email-results*.ts`): se leen con el cliente de servicio DESPUÉS de `broadcasts.manage` (la RLS de `email_log` es de Owner/Admin), filtrando por el workspace de la sesión y el broadcast. Un porcentaje sin base es «—».
- **Hoy el email de un broadcast no queda como mensaje en la conversación** (solo en `email_log` y en el historial de la ficha); ver `docs/PENDIENTE-automatizaciones-email.md`.

## Migraciones

`00287_email_delivery_guard` (columnas de `email_log`, estados `reserved` / `skipped_no_email`, la guardia, la capacidad, `patch_resend_config`, los eventos y `contact_last_activity`) y `00288_broadcast_activity_order` (`sort_key` y `claim_broadcast_recipient`): aditivas, van **ANTES** del deploy, **aplicadas y registradas** el 4/11/2026 (versiones `20261104191636` y `20261104191646`). `00294_broadcast_email_preheader` (aditiva) va **ANTES** del deploy, porque el editor de broadcasts guarda esa columna con cada borrador: **aplicada y registrada** el 5/11/2026 UTC (versión `20261105022740`). La `00296` es de Contactos sin identificar y la `00297` de Importar el historial de Fathom (aditiva, va **ANTES** del deploy). **La próxima libre es la `00298`** (la `00291` queda para `automation_runs`; confirmar con `list_migrations` y las ramas locales). La `00289` la ocupó «Reuniones sin evento», así que `automation_runs` (Fase 1b) pasa a la **`00291`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-email-subscription.mjs   # bloque 11: la guardia (SQL = TS, 10 en paralelo con tope 5, freno, calentamiento, eventos)
node scripts/verify-broadcasts.mjs           # bloque 4b: primero los más activos
```

# Historial de ejecuciones de las automatizaciones (4/11/2026)

Cada automatización tiene su pantalla de ejecuciones (`/dashboard/flows/[flowId]/ejecuciones`): quién pasó, cuándo, cómo terminó y qué pasó en cada paso. «Exportar» salió del editor y queda en la tarjeta de la lista. Detalle en [docs/flow-registry.md](docs/flow-registry.md) («Historial de ejecuciones»).

## Lo que no se puede romper

- **Anotar nunca frena un flujo.** `lib/flow-engine/run-log.ts` no lanza y escribe aparte de los cambios de `status`: sin la migración, los flujos corren igual, solo que sin historial.
- **Un paso que falla o se saltea sin lanzar avisa** con `context.noteStep`, o queda como «Salió bien». `run-history-boundary.test.ts` lo controla para los nodos que anotan en `analytics_events`; una salida silenciosa nueva también tiene que avisar.
- **`reason` y `error_message` pasan por `sanitizeRunText`**: sin emails, teléfonos, ni el camino o los parámetros de una URL.
- **Quién ve qué lo decide la base** (`can_see_flow_session`: `flows.view` y poder ver el contacto). **`flow_sessions.variables` no se lee con la sesión: nunca `select("*")` sobre `flow_sessions` con la sesión.** Una columna nueva para la pantalla se suma al `GRANT` de la migración.
- **`flow_session_steps` no lleva `contact_id`**, a propósito: `merge_contacts` no la tiene que tocar.
- **Los pasos se borran a los 12 meses; la fila de `flow_sessions` nunca por retención**: «Una sola vez por contacto» la mira.

## Migración

`00292_flow_run_history` (aditiva): va **ANTES** de desplegar el código. **Aplicada y registrada** el 5/11/2026 UTC (versión `20261105010903`), después de ensayarla en una transacción que se deshizo sola, con `verify-flow-runs`, `verify-rls --despues-de-00143 --despues-de-00208`, `verify-contact-merge`, `verify-inbound-webhooks`, `verify-eod` y `verify-tasks` en verde. Reemplaza la política de lectura de `flow_sessions`, con la vieja en su cabecera. Un Member pasa a ver solo las ejecuciones de sus contactos. La `00291` queda para `automation_runs`. La `00293` es de las citas de un email. **La próxima libre es la `00294`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-flow-runs.mjs   # quién ve qué, variables, el trigger, el motor, la consulta y la limpieza
```

# Esperar hasta y una sola vez por contacto (4/11/2026, sin migración)

Lo que hizo falta para los recordatorios de una clase con fecha fija. Detalle en [docs/flow-registry.md](docs/flow-registry.md).

- **«Esperar hasta» se guarda en la hora del negocio** (`waitUntilLocal`, sin zona; la pone `workspaces.timezone`, nunca el navegador). **Con la fecha ya pasada se saltea el paso siguiente** y el flujo sigue con el que viene (`SKIP_NEXT_STEP`, `node_skipped` con `date_passed`). Las esperas por duración no cambian (`clase-flow-characterization.test.ts`).
- **`oncePerContact` en un disparador de contacto** (apagado por defecto): quien ya tuvo una sesión de ese flujo, salvo cancelada, no vuelve a entrar. Se mira `flow_sessions` porque publicar borra `trigger_fires`.

# Citas de un email, respaldo y fechas en los flujos (4/11/2026)

- **`messages.text` de un email entrante guarda solo lo que escribió la persona; la cita va a `email_quoted_text`** (`splitQuotedReply`, `lib/email/quoted-reply.ts`, conservadora: corta solo si todo lo que sigue es cita). **La regla de baja nunca lee una cita** (`withoutQuotedLines`): una respuesta que citaba el pie «Darme de baja» marcaba «no contactar». La burbuja deja la cita cerrada y separa las filas viejas al dibujarlas.
- **La bandeja no ofrece micrófono ni clip en email** (`canAttachFiles` en `planComposerActions`). «Enviar email» ofrece imagen y archivo (`EMAIL_PICKABLE_KINDS`).
- **Un flujo entiende `{{x|respaldo}}` y `{{answer.x}}` muestra las fechas para leer** (`{{answer_raw.x}}` conserva lo guardado). Detalle en [docs/flow-registry.md](docs/flow-registry.md).
- **`00293_messages_email_quoted`** (aditiva) va **ANTES** del deploy: **aplicada y registrada** el 4/11/2026. **La próxima libre es la `00294`** (la `00289` y la `00290` son de otras sesiones y la `00292` está en otra rama; confirmar con `list_migrations` y las ramas locales).

# Zonas horarias y confirmaciones de agenda (4/11/2026)

Cada persona ve TODAS las fechas y horas en su zona. Detalle en [docs/agendamiento.md](docs/agendamiento.md) («Zonas horarias», «Reuniones sin evento») y [docs/tareas.md](docs/tareas.md).

## Lo que no se puede romper

- **Se guarda en UTC y se muestra en la zona de quien mira.** En cliente, `useViewerTimezone()`; en servidor, `resolveViewerTimezone()`. `formatDateTime`, `formatRelative` y las fechas de la bandeja piden la zona como parametro obligatorio. **`lib/timezone-boundary.test.ts` falla si aparece una fecha sin `timeZone`.** Lo que se pasa explicito por ser otra cosa: fechas civiles (`date`, con `"UTC"`) y reglas del negocio (`workspaces.timezone`: horario del agente, topes de gasto, crons, ritmo de envios, tope diario por red, «Esperar hasta» de los flujos).
- **Un solo selector de zona** (`components/ui/timezone-select.tsx`): incluye siempre el valor actual y arma el catalogo recien en el navegador. `listTimeZones` une el catalogo con la lista de respaldo: `Intl.supportedValuesOf` no trae UTC ni el nombre que detecta el navegador para Buenos Aires.
- **Agendar a mano separa dos zonas**: `timezone` (en la que se escribio la hora) e `inviteeTimezone` (va a `p_timezone`, con ella salen sus emails). `create_booking` no se toco; elegir otra zona a proposito la guarda en el contacto despues de crear la reunion.
- **Todo lo que se programa en la hora del NEGOCIO lleva `BusinessTimeNote`** (`components/ui/business-time-note.tsx`, reglas puras en `lib/business-time.ts`): dice en que zona se programa (con nombre, no el id IANA) y, si quien mira esta en otra, a que hora le cae a el. Hoy: «En una fecha y hora», «Esperar hasta», los recordatorios de pagos, «Crear tarea» en dias, el horario del agente, la hora de las tareas de IA y el horario de envios de WhatsApp. Nunca escribir el nombre de una zona en el codigo (el horario del agente decia «Costa Rica»).
- **`scheduling_profiles.timezone` es la del horario de atencion**, nunca para ver.
- **Tareas con hora**: lo guardado sigue en la zona del negocio y se convierte al leer y al escribir (`lib/tasks/due-view.ts`). Una tarea sin hora es una fecha civil y no se convierte. Reglas de fechas, SQL y barrido siguen sobre lo guardado.
- **Mover una reunion conserva SU duracion**, no la del evento.
- **Reuniones sin evento**: flujos con `event_type_id` null y `template_key` `no_event_*`, filtro `no_event` contra `bookings.metadata.without_event`, permiso `settings.general`. Prendidos, un flujo de evento y uno sin evento nunca corren para la misma reunion.

## Migracion

`00289_flows_no_event_templates` (aditiva, va ANTES del deploy): **aplicada y registrada** el 4/11/2026 (versión `20261105001801`), después de ensayarla en una transacción que se deshizo sola. **La `00290` es de Cambiar el anfitrion de un evento: la proxima libre es la `00291`** (confirmar con `list_migrations` y las ramas locales).

# Dashboard de Chat: que no se corte (6/11/2026)

Se cortaba por el `statement_timeout` de 8 s con solo 6.361 mensajes: la RLS de `messages` chequea permisos por cada mensaje y cada bloque repasaba toda la historia. Detalle en [docs/dashboards.md](docs/dashboards.md) («Por qué no se corta»).

## Lo que no se puede romper

- **`chat_dashboard_core`, `chat_dashboard_patterns_v2` y `chat_visible_messages` son `SECURITY DEFINER`** y aplican la regla a mano: `me.member` corta todo a quien no es miembro (también categorías y textos en Patrones) y cada lectura sale de `vis`, con `can_see_conversation`. **`chat_dashboard_team_v2` sigue INVOKER**: lo que lee de `audit_log` depende del rol (`audit.view`). `lib/dashboards/chat/core-migration.test.ts` fija esas protecciones. Un `CASE`, no un `OR`, para que un admin no corra el permiso por cada conversación.
- **Las funciones viejas no se tocan**: son la referencia de `scripts/verify-chat-core.mjs`, que compara cada número como Owner, Admin, dos Member, un rol de una sola cuenta y alguien de otro negocio. Si se cambia una regla en `core`, se cambia en la vieja (o se saca de la comparación con su motivo). Borrarlas va en otra migración, cuando `core` lleve un tiempo andando.
- **Un mensaje sabe de qué episodio es por ventana, sin unir mensajes con episodios por rango**: esa unión crece al cuadrado (la prueba `--carga` la atrapó con 2.000 conversaciones).
- **`chatRpc` (`lib/dashboards/chat/rpc.ts`) es el único camino a la base**: cola de 4, un reintento ante 57014 y texto claro. `rpc-boundary.test.ts` falla si aparece un `.rpc(` afuera. La espera del reintento va afuera de la cola.
- **La cache (`block-cache.ts`) lleva al usuario en la clave**, usa el rango resuelto y nunca el período anterior (con un rango abierto cambia a cada milisegundo). Solo guarda lo que anduvo. `drafts` no se guarda. La invalidan las cookies de `generation.ts`, y toda acción que corrija lo que ve Patrones tiene que llamar a `bumpChatPatternsGeneration`.
- **Cada `Block` lleva un `key` con los filtros y `generation`**: un `Suspense` nuevo muestra su skeleton también en una transición. El aviso de demora va por CSS (`.chat-slow-hint`): un fallback que llega en streaming no se hidrata.
- **Los bloques que salen de `core` se mapean adentro de `blockResult`**: un `.then(map)` suelto que lanzara rompe `use()`.

## Migración

`00305_chat_dashboard_core` (aditiva, va **ANTES** de desplegar el código): **aplicada y registrada** el 7/11/2026 UTC (versión `20261107042726`), con `verify-chat-core --carga=2000` en verde. El mismo día se corrigió `chat_dashboard_team_v2`; el SQL registrado es el corregido. **La próxima libre es la `00306`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-chat-core.mjs             # cada número nuevo contra el viejo, por rol y filtro
node scripts/verify-chat-core.mjs --carga     # además, tiempos con 2.000 conversaciones
```

# Comentarios en el lienzo, métricas por paso y reintentar (7/11/2026)

El 6/11 una respuesta privada a un comentario «clase» falló con un texto genérico: ManyChat había contestado 3 s antes y Instagram deja una sola. Detalle en [docs/flow-registry.md](docs/flow-registry.md) («Responder por privado», «Todo en el lienzo», «Métricas por paso», «Reintentar desde un paso»).

## Lo que no se puede romper

- **Todo se arma en el lienzo.** Growth pasó a **Comentarios** (`/dashboard/comentarios`, solo lectura; `/dashboard/growth` redirige). La cuenta y las publicaciones de «Palabra clave en un comentario» viven en el nodo (`channelId`, `postIds`) y publicar arma la fila con `config.origin = "canvas"`. El lienzo es el dueño de sus filas (`CANVAS_TRIGGER_ROWS_FILTER`); una regla vieja de Growth se muestra como tal y no se toca. `completePostIds` escribe también el nodo.
- **Un fallo de Instagram queda con su clave** (`describeSendError` → `flow_session_steps.error_kind`): `already_replied`, `buttons_not_allowed`, `not_thread_owner`... Solo lo pasajero (`canAutoRetry`: `rate_limited`, `temporary`) se reintenta solo, a 1, 5 y 15 min (`provider-retry.ts`). Un error desconocido NO: puede gastar la única respuesta privada.
- **La respuesta pública al comentario va después del flujo** y solo si el privado salió (`shouldPostPublicReply`); `comment_logs.dm_sent` es el mensaje enviado de verdad.
- **Métricas por paso:** `flow_node_stats` (SECURITY INVOKER) + `buildNodeMetrics`; viven en un contexto, **nunca en `node.data`**. `flow_link_clicks` no lleva `contact_id` (la persona sale de la ejecución): `merge_contacts` no cambia. Los clics solo existen con «Registrar el clic»: el token lleva `n` (paso), `b` (link) y `r` (ejecución), opcionales; sin paso, firma igual que siempre.
- **Reintentar** (`retryFlowStep`, `flows.edit`): solo el último paso fallido de una ejecución terminada, nunca con un motivo de `NOT_RETRYABLE_KINDS` ni una respuesta privada de más de 7 días (`canRetryStep`). Reclamo condicional y `resume_flow` con `rerunNode`.
- **Los íconos del panel y del lienzo son los mismos** (`components/flow-builder/node-icons.test.ts`).

## Migración

`00317_flow_step_metrics` (aditiva: `error_kind`, `exit_handle`, `flow_link_clicks`, `flow_node_stats`, índices y el paso de las reglas de Growth al lienzo) va **ANTES** de desplegar el código. Sin aplicar, el motor anota los pasos sin las columnas nuevas, pero las métricas y el reintento no andan. Las `00309` a `00316` son de las ramas de seguridad. **La próxima libre es la `00318`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-flow-metrics.mjs   # flow_node_stats por rol, un deferred cuenta una vez, 24 h de respuesta, clics, restricciones
```

# Auditoria de seguridad (7/11/2026)

Auditoria completa en cuatro lotes (PRs #171 dependencias, #168 Altas, #172 Medias, #170 Bajas). Migraciones `00309` a `00316`, todas aditivas (pueden ir antes o despues del deploy), **aplicadas y registradas el 7/11/2026**. La `00316` corrige la `00309`: la API de admin escribe `app_metadata` en un UPDATE despues del alta, asi que el trigger tambien corre al llegar la marca. **La proxima libre es la `00317`** (confirmar con `list_migrations` y las ramas locales).

## Lo que no se puede romper

- **El registro publico de Supabase va APAGADO** ("Allow new users to sign up", panel de cada proyecto; `/setup` lo pide). Ademas `handle_new_user` (00309) solo arma un workspace a la primera cuenta de una instalacion vacia o a una creada por el servidor con `app_metadata.ssa_create_workspace = true`: **todo script que crea un usuario que necesita negocio pasa esa marca** (`create-owner` y los `verify-*` ya la pasan; la marca llega en un UPDATE y la atrapa el trigger `on_auth_user_workspace_flag`, 00316). `app_metadata` no lo puede escribir un registro publico.
- **Un adjunto escrito con la sesion de un usuario** es v2, sin `sourceUrl` y con `storagePath` de su propio workspace (trigger `messages_guard_client_attachments`, 00311). Una URL que viene de un payload o de una fila se baja SOLO con `safeFetch` / `safeFetchResponse` (`lib/net/safe-fetch.ts`): IPs publicas en cada salto y tope de tiempo. Nunca un `fetch` suelto a una direccion que no escribimos nosotros.
- **Una redireccion que se guarda y se usa en el navegador** se valida en la base (CHECK https, 00310), al leerla y antes de `window.location`. React no protege `location.href`.
- **Las invitaciones las lee solo `team.invite`** (00312): su `id` es el link. Aceptar reclama la invitacion (`pending -> accepted` condicional) antes de sumar a la persona.
- **Un id que llega del navegador se filtra por el workspace de la sesion**, tambien cuando despues se escribe con el cliente de servicio o se pasa a una funcion `SECURITY DEFINER` (`createBooking` valida el contacto contra el negocio del evento).
- **Los archivos de `chat-media` y `email-attachments` respetan el alcance de leads** (`can_read_chat_media`, `can_read_email_attachment`, 00313): una ruta nueva en esos buckets tiene que encajar en esas funciones (`<ws>/<conversacion>/...`, `<ws>/groups/<grupo>/...`, `<ws>/library|stickers/...`) o ningun Member la lee.
- **Conocimiento interno solo con `knowledge.edit`** (`can_read_knowledge`, 00314); la busqueda con lo interno, solo el servidor.
- **La IP de los topes sale de `requestIp`** (`lib/antispam/client-ip.ts`): `X-Real-IP` primero (Railway la pisa). Nunca el primer valor de `X-Forwarded-For`, que lo elige el cliente. Si un clon pone un CDN adelante, ese CDN tiene que mandar `X-Real-IP`.
- **`anon` y `authenticated` no tienen TRUNCATE, TRIGGER ni REFERENCES** (00315, y `lib/migrations-grants.test.ts` lo exige en cada migracion).
- **"No contactar" frena los envios de los flujos** (mensaje, recurso, respuesta con IA), salvo los que arrancan por la agenda.
- **El optimizador de imagenes esta apagado** (`images.unoptimized`): nunca `remotePatterns` con `"**"`.
- **Un error al leer permisos, bloqueos o disparadores nunca abre**: niega, no manda o reintenta.

## Pendiente
- Apagar el registro publico y prender "Secure password change" en el Supabase de produccion y de cada clon (es de panel).
- `eslint-config-next` sigue en 16.1.6 (la 16.4.5 trae react-hooks 7.1 con 18 errores nuevos).
- El agente, el copywriter, Grabaciones y el clasificador todavia no pasan el modelo al chequeo de "modelo sin precio con tope".
- DNS rebinding en `safeFetch` (fijar la IP validada con undici).
- No hay CSP de scripts (solo `frame-ancestors`).

# Diseñador IA (construido, 8/11/2026)

Diseñar piezas visuales con IA o a mano (carruseles, historias, presentaciones, PDF, certificados, páginas web), publicarlas con un link `/d/<código>` o exportarlas, y generar piezas desde **plantillas** (a mano, para varios o desde una automatización), conectado con Contenido. En el código es `designer` / `design_*` y `/dashboard/disenos`; en lo visible, **Diseñador IA**. Resumen en [docs/designer.md](docs/designer.md); avance, pruebas y auditorías en `docs/PROGRESS-designer.md`; decisiones en `docs/PENDIENTE-designer.md`; contratos en `docs/designer/contratos.md`; el servicio de render en Railway, en `docs/designer/puesta-en-marcha.md`.

## Lo que no se puede romper

- **Un solo render: `renderPageHTML`** (`lib/designer/render/page-html.ts`) para el lienzo, la vista previa, el link, la exportación y las generaciones. Nunca produce `<script>` ni `on*`. El HTML de una página cargada se muestra siempre en un iframe `srcdoc` con `sandbox` sin `allow-scripts`; en el lienzo del editor, además `allow-same-origin` (para ubicar cada texto y editarlo a mano) y `EDIT_CSP` en el render de edición, nunca en el link público. Todo documento que se guarda pasa por `sanitizeDocHtml` (`lib/designer/import/edit.ts`), lo escriba una persona, la IA o un archivo.
- **Publicar es la única puerta al link público.** Guardar (a mano, la IA, restaurar) no cambia lo que ve el público: `design_public_get` devuelve la última versión `publish` (00325) y el render de publicar se arma con esa versión (`latestPublishedDoc`; si no se puede leer, reagenda, nunca usa el borrador). El editor avisa «Hay cambios sin publicar». Un Member (`designer.edit` sin `designer.publish`) no puede cambiar el link.
- **Una generación (fila de `designs` con `template_id`) es una copia congelada**: no se edita ni por la IA (`saveDocCore`, `restoreVersionCore`, `loadTarget`, `saveDocWithRev`). Se vuelve a generar desde la plantilla.
- **El link público sale SOLO de `design_public_get`** (anon la ejecuta a propósito; nunca devuelve el negocio, emails, teléfonos ni ids de la persona). **Sin pie «Hecho con…»** (white label). Una generación se muestra solo `ready` o `void`; tope de 120/min por IP; `noindex` salvo una web con «Permitir buscadores».
- **Todo link que ve alguien de afuera** con `publicBaseUrl` / `loadDesignLinks` (`lib/designer/public-links.ts`): nunca `appUrl()` ni el dominio del navegador.
- **Verificación solo en plantillas de formato impreso**, apagada por defecto, con tipo de documento; textos y botones de `lib/designer/verification.ts`. Gemelas con los CHECK de la base (`verification.cases.json`).
- **Archivos validados por bytes** (PNG/JPG/WebP; un SVG se rechaza; fuentes por firma; zips sin `..`, sin enlaces simbólicos, hasta 300 archivos y 50 MB). El tope de las Server Actions es 51 MB (`next.config.ts`) y cada acción vuelve a validar.
- **Un solo juego de archivos por diseño propio** (F48b) y **sin miniaturas renderizadas** (la lista dibuja en vivo; guardar no encola renders). La limpieza diaria (`design_cleanup`, cron por SQL directo) nunca borra la versión actual ni la última publicada, ni archivos de una generación.
- **Los jobs** (`design_render`, `design_generate_many`, `design_content_sync`, `design_ai_generate`, `design_cleanup`) nunca lanzan por un proveedor: reagendan a 1, 5 y 15 minutos. Sin `RENDER_SERVICE_URL`/`RENDER_SERVICE_SECRET`: «Falta conectar el servicio de render». En tests y verify, siempre `DESIGNER_FAKE_RENDER=1`.
- **La IA**: el pedido viaja como dato; tope de gasto antes de llamar (`source: "designer"` en `openAiRun`); máximo 2 pasadas de corrección; en un HTML cargado cambia solo textos (`updateText`), no el CSS.
- **Las variables usan las claves del catálogo de Automatizaciones** (`contact.*`, `workspace.name`): no se inventan otras; `lib/designer/variables/catalog.test.ts` falla si se separan. Otro módulo suma las suyas con `registerDesignVariables` (`lib/designer/extensions.ts`, el punto de extensión de Servicios; hoy vacío).
- **La IA nunca escribe directo en la base**: devuelve un documento o un parche que se valida (Zod), se aplica sobre la versión en la que se pidió, se limpia y recién ahí se guarda con `rev`.
- **Conversaciones en `ai_threads` / `ai_messages`** (genéricas de BAIOS), RLS por canal: `designer` → `designer.view`; `assistant` → `user_id = auth.uid()` y miembro; `portal` → ninguna todavía. La fusión de contactos reapunta `designs.subject_contact_id` y `ai_threads.contact_id` por trigger (`contacts_designs_on_merge`); `merge_contacts` no se tocó.
- **Automatizaciones**: el paso «Generar desde plantilla» (`designGenerate`) usa `createGeneration` (`lib/designer/generate-core.ts`) y nunca lanza (corta el camino con `handle:design_stopped` y el motivo). Deja `design.id`, `design.link`, `design.pdf_url`, `design.code`, `design.status` y `design.doc_type`. Sin plantilla, o con un disparador de formulario sin formulario elegido, no se publica. «Enviar email» adjunta el PDF de la generación de ESA corrida. Detalle en `docs/flow-registry.md`.
- **Contenido**: los archivos de un diseño vinculado llegan con id estable (`design-<id>-<n>`); una red publicada nunca se toca, una programada (o fallida) solo avisa. Publicar, programar, el borrado a 30 días y los permisos de Contenido no cambiaron. Detalle en `docs/contenido.md`.

## Migraciones

`00319` (ajustes, permisos del Member M12, buckets privados), `00320` (tablas, RLS, códigos, `design_public_get`, fusión, limpieza diaria), `00321` (CHECK de `agent_runs.source` + `designer`), `00322` (corrige el trigger del documento), `00324` (el bucket `design-renders` acepta `error.json`), `00325` (`design_public_get` devuelve lo publicado) y `00326` (el CHECK de `agent_runs.source` con `ads_matching` Y `designer`: la 00321 había pisado el `ads_matching` de la 00318), todas **aplicadas y registradas** el 7 y 8/11/2026 UTC. La `00318` y la `00323` son de otras sesiones. **Una migración que redefine un CHECK parte del que está EN LA BASE (`pg_get_constraintdef`), no de un archivo viejo**: si no, borra lo que sumó otra sesión en el medio. **La próxima libre es la `00327`** (confirmar con `list_migrations` y las ramas locales). En un clon nuevo van ANTES de desplegar el código.

## Verificación

```
node scripts/verify-designer.mjs                 # bloques ds0, ds2, ds5, ds6, ds7, ds8 (render simulado)
node scripts/verify-designer.mjs --bloque ds5    # uno solo
```

Mismas reglas que los demás: crean y limpian sus datos (`zz-test-`), de a uno y con el candado `/private/tmp/ssa-verify.lock`.

# Servicios, portal y afiliados (Corrida A1, construido el 8/11/2026)

Lo que pasa con cada cliente **después** de la venta (servicio, camino, semáforo, accesos al portal), todo lo del portal configurado desde SSA (programa, evaluaciones, calendario, certificados, comunidad, tutor) y los afiliados con los links de cada producto. El módulo de Servicios **se prende por negocio** (`app_servicio.set_module_enabled`, solo servidor; nace apagado) y vive en sus esquemas `app_servicio` (expuesto en la API, RLS de solo lectura) y `app_servicio_portal` (cerrado). Afiliados es de BAIOS y sigue a Ventas. Resumen en [docs/servicios.md](docs/servicios.md), [docs/portal-admin.md](docs/portal-admin.md) y [docs/afiliados.md](docs/afiliados.md); plano en `claude/v12/requerimientos-v12-servicios.md`; avance y decisiones en `docs/PROGRESS-servicios.md` y `docs/PENDIENTE-servicios.md`.

## Lo que no se puede romper

- **`svc_create_service` es la única entrada a `services`.** Una venta, un servicio; una fase en curso por servicio; el avance de fase con candado. Completar un paso es por **id**, nunca por nombre. `progress_pct` y el semáforo los calcula la base. Los cambios de plantilla (el camino de la variante) no tocan servicios que ya existen.
- **Los triggers del módulo sobre tablas de BAIOS** (`payments`, `sales`, `form_submissions`, `contract_signatures`, `bookings`, `tasks`, `workspace_members`, `contact_touches`, `booking_categories`, `service_phases`) **nunca hacen fallar lo que los dispara** (`EXCEPTION WHEN OTHERS` + `svc.hook_failed`) y **con el módulo apagado no hacen nada** (`module_on`). `verify-servicios-migracion` lo comprueba trigger por trigger. Excepciones a propósito: las guardias SV003 (configuración y tutor), que frenan a la sesión.
- **`public` es BAIOS: ninguna tabla nueva.** Los datos del módulo viven en sus esquemas; su configuración, en columnas de `workspaces`, `products` y `product_variants` que **solo escriben sus funciones** (guardia `SV003`). `app_servicio_portal` no se expone nunca: SSA lee por funciones de `app_servicio`.
- **La pantalla no decide:** cada regla vive en la base con su gemela en TypeScript y un `*.cases.json` que corre contra las dos. Si se cambia una, se cambian las dos y se suma el caso.
- **Las funciones protegidas no se tocan** y `get_public_form` no se reescribe: cada `verify-*` del módulo llama a `checkProtectedFunctions`. `merge_contacts` cambió **una sola vez** (00353, copiada de la base): al final llama a `app_servicio.merge_contacts_hook` si existe. Una tabla nueva del módulo con una columna que apunta a `contacts` se suma al gancho y a las exclusiones de `lib/contacts/merge.ts` en el mismo cambio.
- **Un estudiante no es un usuario de SSA** (cuenta del portal propia). Las funciones del contrato con el portal **solo se agregan**.
- **Apagar el portal de una variante o sacarle una sección no corta a los servicios que ya existen.**
- **Lo automático de tiempo lo hace el barrido diario** (`svc_daily_run`, job `svc_daily`, cron `svc-daily` por SQL directo, no `call_app_cron`): cada paso en su bloque, y dos veces el mismo día no duplica nada.
- **Certificados = Diseñador IA:** una generación con el servicio como sujeto (`subjectRef.module = "service"`, el grupo registrado). El módulo se engancha por `registerDesignVariables` y `onDesignGenerated`, cargados en los puntos de entrada del servidor (`lib/designer/module-extensions.ts`), nunca al importar el Diseñador.
- **El tutor:** un agente `student_tutor` por programa (`products.tutor_agent_id`, único, SV003); para un estudiante busca solo en las clases que tiene abiertas; nunca evaluaciones, documentos internos ni lo excluido. Los montos de gasto, solo con `ai_costs.view`.
- **El botón de un paso vive en `ref.button`** (y «ver su respuesta» en `ref.show_response`): sin columnas. Los pasos con formulario o agenda no aceptan un link pegado, porque rompería que se completen solos. `svc_item` solo viaja si es un uuid (`pickUtm`), dentro de `bookings.utm`. Gemelas `refProblems` / `journey_item_ref_problems` (00363) con `journey-template.cases.json`.
- **Afiliados:** la asignación sale **solo del link** (`?ref=`, trigger sobre el toque que nunca lo tumba) o de un administrador con permiso; el comprador nunca es su propio afiliado. La comisión se genera **por pago cobrado** y lo ya cobrado no cambia por una baja ni por una regla nueva. Una comisión editada a mano no la pisa ningún recálculo.
- **Permisos:** 34 claves `services`/portal y las de afiliados, en las tres capas. Cambio aprobado **M11**: el Member suma `services.view`, `services.items`, `portal.view_as` (alcance `own`) y `affiliates.use`.

## Migraciones (`00330` a `00346` y `00351` a `00353`, todas aplicadas y registradas el 8/11/2026)

`00330` (esquema, `services`, permisos, interruptor), `00331` (fases y pasos; sin claves foráneas en `form_submissions`/`contract_signatures`, el trigger valida), `00332` (configuración y validadores), `00333` (motor), `00334` (cobros y ventas), `00335` (completado automático), `00336` (historial y CHECK de `triggers.type`), `00340` y `00341` (cuentas y accesos del portal), `00342` (programa), `00343` (afiliados, BAIOS), `00345` (evaluaciones y actividades), `00346` (calendario y asistencia), `00351` (comunidad), `00352` (tutor) y `00353` (fusión, barrido diario, emisión automática del certificado, límite propio del asistente y métricas de las cards). La `00337`, `00338`, `00339`, `00344`, `00347` a `00350` y `00354` son de otras sesiones. **La próxima libre es la `00355`** (confirmar con `list_migrations` y las ramas locales). En un clon nuevo van en orden numérico y **antes** de desplegar el código.

## Corrida A2 (12/11/2026): la app del equipo de servicio

Barra superior única, Clientes con tabla y tablero, fichas en modal, responsive, listas en vez de claves, el botón de cada paso, el campo Link y los avisos de Servicios. Avance en `docs/PROGRESS-servicios.md` («Corrida A2»), decisiones en `docs/PENDIENTE-servicios.md` («A2»).

- **Toda pantalla del módulo pone sus controles en `PageHeader`**, con los lugares fijos `view`, `quickFilter`, `filters`, `search`, `group`, `more` y `primary` (en ese orden). En el teléfono, `primary` queda arriba y lo demás va a la franja. Ninguna deja pestañas ni barras de herramientas dentro del contenido: `lib/ui/topbar-placement.test.ts`. Un botón de la barra que abre algo del contenido manda una orden por la URL (`intentHref` de `lib/ui/url-intent.ts` + `useUrlIntent`).
- **Una página del servidor nunca llama una función de un archivo `"use client"`** (solo dibuja sus componentes): se cae entera y ni el build lo ve. `lib/ui/client-boundary.test.ts`.
- **Las fichas son modales por la URL** (`?cliente=` / `?servicio=` sobre `/dashboard/clientes` y `/lista`) y los links salen solo de `serviceHref` / `clientHref`. Los links viejos `/clientes/c/<id>` y `/s/<id>` redirigen. Lo del portal se ve solo si el producto tiene portal.
- **Las cifras de la ficha son funciones puras** (`record-figures.ts`): si un dato no existe, la cifra no se muestra.
- **Editar fechas y plazo es `svc_set_dates`** (`services.extend`, motivo obligatorio), con su gemela `datesEditPlan` y `set-dates.cases.json`.
- **En Automatizaciones nada se elige escribiendo una clave** (`servicePickerOptions`); una clave que ya no existe avisa y no deja publicar (`serviceKeyProblems`, en `publishFlow`). `lib/services/no-typed-keys.test.ts`.
- **El campo Link** (`link`) valida `https://`, sin espacios, hasta 2000 caracteres; la base no cambió.
- **Los avisos `svc_*` están en el catálogo** con solo campana por defecto; `lib/notifications/service-types.test.ts` falla si una migración suma uno que no está.
- **`scripts/verify-responsive.mjs`**: 390, 768, 1100 y 1440 px, claro y oscuro, sin dependencias (maneja el Chrome instalado). Toma el candado de los verify-*.

Migraciones `00361_svc_record_reads` (lecturas de la ficha: classroom, asistencia y resumen del portal, mirando el permiso adentro), `00362_svc_set_dates` y `00363_journey_item_button` (el botón de cada paso; la definición vieja en la cabecera). Las tres aditivas, ensayadas en una transacción que se deshizo sola, **aplicadas y registradas** el 12/11/2026 UTC (versiones `20261112051326`, `20261112051935` y `20261112054433`). Van **antes** de desplegar el código. **La próxima libre es la `00364`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-servicios-migracion.mjs --todas
node scripts/verify-services.mjs          # sv1, sv2, prd, ac, a2
node scripts/verify-program.mjs           # pr, ev, ca, ce, co, ia, x
node scripts/verify-affiliates.mjs
node scripts/verify-portal-schema.mjs
```

## Corrida A4 (12/11/2026): reuniones, propuestas, camino, tareas y automatizaciones

Comentarios con @menciones, Slack como canal de avisos, reuniones unidas a su servicio, propuestas del analizador que se aprueban, pasos bloqueados o que piden evidencia, checklist, topes de cartera, tareas con servicio y reunión, y disparadores relativos. Avance en `docs/PROGRESS-servicios.md` («Corrida A4»), decisiones en `docs/PENDIENTE-servicios.md` («A4»), punto de partida en `docs/servicios/punto-de-partida-a4.json`. Detalle en [docs/servicios.md](docs/servicios.md), [docs/llamadas.md](docs/llamadas.md), [docs/tareas.md](docs/tareas.md), [docs/flow-registry.md](docs/flow-registry.md) y [docs/cuenta-y-notificaciones.md](docs/cuenta-y-notificaciones.md).

- **Comentarios (`public.comments`, 00364)**: se leen con la visibilidad de su entidad (`can_see_comment_entity`, en `public` porque la política corre con quien lee) y se escriben SOLO por `post_comment` / `edit_comment` / `delete_comment` (CM001 no ve la entidad, CM002 no es suyo). Una mención a quien no ve la entidad se descarta sin avisar. Los del equipo viven en `lib/team-comments/` (`lib/comments/` es Instagram).
- **Slack**: el token del bot en Vault (`SECRET_NAMES.slackBotToken`), el ID de cada persona en `user_profiles.slack_user_id` (U… o W…). La columna Slack de Notificaciones solo aparece con Slack conectado y nace apagada. Sin dependencias: `fetch` con `fetchImpl` inyectable; los tests nunca llaman a Slack.
- **Reunión ↔ servicio**: `calls.service_id` (sin clave foránea, regla del 8/11) + `service_link`. Lo decide `svc_call_link_apply` (gemela `callLinkPlan`, `call-link.cases.json`); `manual` no lo pisa nada; con dudas, `review` y un aviso. El enganche sobre `calls` sale con el módulo apagado y nunca tumba la ingesta de Fathom.
- **Propuestas del analizador**: nada se ejecuta solo. `call_proposal_claim` (pending|failed → executing con la fila bloqueada) para que dos personas no aprueben lo mismo; `call_proposal_patch` cambia una sola. El mensaje aprobado sale por el envío de la bandeja, de a uno, sin cola. Menos de 600 caracteres de transcripción: no se propone.
- **Bloqueo y evidencia del paso** (en `ref`, 00369): SV033 (bloqueado) y SV034 (falta evidencia), gemelas `lockPlan` / `svc_lock_plan`. `svc_item_lock_state`, `svc_item_evidence_missing` y `svc_assert_completable` son SOLO del servidor. La evidencia la escriben `svc_add_evidence` / `svc_remove_evidence` con la sesión; el archivo va al bucket privado `service-evidence` (validado por bytes) y se abre con un link de 10 minutos.
- **La guardia de tareas (`app_servicio.task_guard`, 00370) es la ÚNICA excepción** a «los enganches nunca frenan lo que los disparan»: frena completar la tarea de un paso bloqueado o sin evidencia, solo con el módulo prendido, el paso pendiente y el servicio activo o pausado. Cualquier otro error del módulo NO frena la tarea. Cancelar, terminar o renovar un servicio cierra sus tareas abiertas del camino con un comentario de sistema; los pasos no cambian.
- **Tareas**: `service_id`, `call_id` y `checklist` los escribe SOLO el servidor (00368 no da escritura a la sesión); antes, la sesión reescribe un campo sin cambiarlo para que la RLS diga si puede editar. «Reunión» es un origen (`source = 'call'`).
- **Topes de cartera** (`workspaces.service_team_settings`, 00371): el reparto saltea a quien llegó a su tope; sin topes elige igual que antes (los casos viejos de `owner-pick.cases.json` no cambian). Asignar a mano no se frena.
- **Disparadores relativos y periódicos** (00372): los emite `svc_daily_run` una vez por disparador, servicio y día, con `trigger_id`; `serviceEventMatches` solo deja pasar el de ese disparador. «Termina en N días» ahora filtra (`days_before`).
- **«El responsable del servicio»** en «Crear tarea» y «Avisar en la campana» exige un plan B al publicar. **«Enviar a Slack»** (`send_slack`, requisito `slack`) no necesita contacto.
- **Con el módulo apagado, Grabaciones, Tareas y Automatizaciones andan como antes** (probado en `verify-services --bloque a4`).

Migraciones `00364` a `00372`, **aplicadas y registradas** el 12/11/2026 UTC, cada una ensayada antes en una transacción que se deshizo sola (la 00367 se corrigió el mismo día; el SQL registrado es el corregido). En un clon nuevo van en orden y **antes** de desplegar el código. **La próxima libre es la `00373`** (confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-comments.mjs
node scripts/verify-services.mjs --bloque a4
node scripts/verify-servicios-migracion.mjs --a4 M1   # M1 a M9 (o --todas)
node scripts/backfill-call-services.mjs --dry-run     # vincular las reuniones viejas (--aplicar para escribir)
```

# Seguridad

## Autenticacion y sesiones
- Supabase Auth con email/password. Sesiones por Supabase SSR con cookies que el navegador puede leer (`@supabase/ssr` las deja sin httpOnly; access token 1h, refresh 7d).
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
  - `app/api/webhooks/resend-inbound` -> Resend (emails entrantes, rebotes y quejas): valida la firma Svix con el secreto del webhook del negocio (`?w=` elige cual). Sin secreto o con firma invalida, 401. Ver "Resend: una sola tarjeta".
- Lo que hacen los dos igual despues de entender el payload vive en `lib/inbound.ts`. Lo que tiene que valer para todos los canales vive en la base: `find_or_link_contact` (dedup) y `apply_opt_out_check` (no contactar).
- Ack inmediato (responder 200 antes de procesar, con `after()`). Procesamiento async. Idempotencia con `webhook_events`.
- **Los mensajes entrantes de todos los canales se guardan en `messages`** (Fase 3). Para Instagram es dual-write: se guarda en paralelo y la bandeja sigue leyendo el hilo de Zernio. Guardar nunca puede hacer fallar un webhook: si el insert falla, se loguea y la recepcion sigue. **Se guardan siempre**: ya no hay interruptor en Ajustes (`workspaces.persist_zernio_inbound` quedó sin leerse). Todo el detalle —los dos ids del mensaje, la retencion de 12 meses, el backfill y sus limites— en [docs/flujo-de-mensajes.md](docs/flujo-de-mensajes.md).
- **Una cuenta conectada o desconectada en Zernio** (`account.connected` / `account.disconnected`, 22/10/2026) se identifica por la FIRMA (no tiene canal todavia: se prueba el secreto de cada negocio) y en el `after()` relee la lista completa de Zernio por el mismo camino que «Sincronizar canales» (`syncZernioChannels`) y sincroniza Social. Si Zernio no responde no se desactiva ningun canal. Una instalacion vieja suma esos eventos al guardar la clave o sincronizar canales una vez. Detalle en `docs/flujo-de-mensajes.md`.
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

# Contenido v4 (B15-B18, C1-C10)

Correccion sobre Contenido v3, en `docs/requerimientos-contenido-v4.md`.
Pasa el modulo de "publicar automatico" a "planificar, se publique solo o
no". Detalle en `docs/contenido.md`, `docs/publicacion.md` y el avance
completo en `docs/PROGRESS-CV4.md`.

## Lo que no se puede romper

- **Una red sin cuenta conectada nunca esta "Programada".** Cualquiera de
  las cinco redes se agrega a una idea o a una pieza este conectada o no
  (chip "a mano"); su fecha queda siempre tentativa hasta que alguien la
  programa de verdad o la marca como publicada.
- **"Conectada" = cuenta activa CON publicador usable**, no solo
  `is_active` (`lib/content/connection.ts`). Desconectar Zernio deja la
  cuenta activa pero sin publicador: no cuenta como conectada.
- **Marcar como publicado crea una fila REAL** en `social_posts` con
  `origin = 'manual'`, nunca un flag cosmetico: es lo que la hace contar en
  el calendario, en Social y en el rendimiento de la pieza. La
  sincronizacion la adopta despues por el link o por fecha unica en
  ±24 h; con mas de una candidata, no adivina ninguna
  (`lib/metrics/adopt-manual.ts`).
- **`networks[].format` es el UNICO campo de formato.** `options.contentType`
  se elimino (C9); el publicador de Instagram lee `format` directo. El test
  de caracterizacion (`lib/publishing/zernio.test.ts`) fija el body exacto
  que recibe Zernio: sus aserciones no se tocan nunca.
- **El estado de la pieza se deriva de TODAS sus redes**, tengan fila o no
  (`derivePieceStatus`, reemplaza a `aggregatePostStatus` en los dos
  lugares que escriben el estado). "Estado del material" ya no existe: el
  avance Borrador → En produccion lo hace la persona con el dropdown.
- **Una version no es por cada cambio, es por sesion de edicion.** El
  primer cambio despues de 10 minutos abre una version con
  `reason='edit'`; los siguientes de la misma persona actualizan esa misma
  fila. Cambiar el estado, aprobar, generar con IA y restaurar siempre
  cortan la sesion con la suya.
- **`networks[].publisher` no se escribe mas**: el publicador efectivo es
  siempre el `default_publisher` de la cuenta (F13), nunca algo elegido por
  pieza.
- **Una pieza se edita en cualquier estado** (M10, 22/10/2026, migracion
  `00253`, aplicada y registrada): la politica `content_posts_update` ya no mira el estado; el
  trigger `content_posts_status_guard` conserva que un Member no mueve el
  ESTADO fuera de los tres de autor. Lo agendado en Zernio se reenvia al
  guardar, agregar o sacar un archivo (`lib/publishing/content-resync.ts`,
  validado antes de escribir); lo publicado solo lleva un aviso
  (`editNotices`).
- **"Publicado…" en el dropdown de estado** es un atajo, no un estado que se
  elige: abre la ventanita que marca varias redes a la vez
  (`markPiecePublished` → `runMarkPublished`, las mismas filas `manual`).
  Soltar en la columna Publicado abre la pieza con `?marcar=1`.

## Responsable de la pieza (15/10/2026)

Cada pieza de contenido tiene un **responsable** (`content_posts.assigned_to`, migracion `00223`, **aplicada y registrada**), distinto de quien la creo (`created_by`, que no cambia nunca).

- **Por defecto es quien la crea**: lo pone un trigger (`content_posts_assignee`), asi que cubre `createPost`, aprobar una idea y el agente sin tocar sus funciones. Tiene que ser miembro del workspace (el mismo trigger lo exige). Las piezas que ya existian se rellenaron con su autor.
- **Quien edita**: Owner y Admin todo; un Member lo que creo **o lo que tiene asignado**, solo hasta revision (politica `content_posts_update`, con la definicion vieja en la cabecera de la 00223). `lib/content/assignee.ts` (`isAuthorOrAssignee`) es la misma regla en TypeScript.
- **Quien reasigna**: un administrador o quien la creo (`canReassign`). El responsable edita pero no la pasa a otra persona. `savePostDraft` lo dice con un mensaje claro y manda `assigned_to` solo si cambio (`draftPayload` con `savedAssignee`), para no pisar un cambio de otra persona.
- **El tablero muestra un circulo con las iniciales** (`AssigneeAvatar`, el mismo de Tareas: el sistema no guarda fotos del equipo). La tarjeta ya no lleva la cabecera de color con el formato, y muestra la fecha con hora: una sola si todas las redes salen juntas, o la de cada red (`lib/content/card-dates.ts`).
- Verificado con `scripts/verify-content.mjs` (seccion "Responsable de la pieza"). **La proxima migracion disponible es la `00224`** (confirmar con `list_migrations`).

# Agentes IA (Bloque Agentes IA, 10/10/2026)

El menu "Agentes" paso a llamarse **Agentes IA** y junta en una sola pantalla
los agentes y las tareas de IA del sistema (antes repartidas en Ajustes →
Tareas, que ahora solo redirige). Rama `feat/agentes-ia-tareas`.

## Lo que no se puede romper

- **El catalogo unico de tareas es `lib/ai-tasks/catalog.ts`.** Seis tareas:
  las cuatro de `BACKGROUND_TASKS` (clasificacion de mensajes, resumen,
  clasificacion al cierre, indexacion) mas transcripcion de audio y
  descripcion de imagenes, que gastan IA pero nunca tuvieron pantalla propia.
  Sumar una tarea es una entrada ahi, no una pantalla nueva.
- **"Clasificacion al cierre" no tiene `agent_runs.source` propio**: corre
  adentro del run de `conversation_summary`. El filtro de Origen de Corridas
  la ofrece como un pseudo-valor que `applyOrigenFilter`
  (`lib/agent/runs-query.ts`) traduce a `source=conversation_summary` +
  `status_detail LIKE '%classified%'`, y solo si esa tarea hermana tuvo
  corridas en el periodo.
- **Solo se versiona la parte EDITABLE del prompt de una tarea**, nunca la
  tecnica (anti-inyeccion, el formato de salida que el codigo despues
  parsea). `lib/ai-tasks/instructions.ts` las separa; con el texto por
  defecto, el prompt final es byte a byte el mismo de siempre
  (`instructions.test.ts` lo fija). **Sin version activa, la tarea usa el
  texto del sistema** (migracion `00137`): no aplicar ninguna version nunca
  frena una tarea (`loadTaskInstructions`, `lib/ai-tasks/store.ts`, cae al
  texto del sistema ante cualquier error).
- **La pestaña Runs de un agente o de una tarea ya NO redirige** a la
  pantalla global de Corridas (D8, revertida): embebe `<RunsScreen>` con el
  agente o la tarea como filtro por defecto (`currentAgentId`/`currentOrigen`
  en `countActiveRunFilters`/`parseRunFilters`) — default, no candado: se
  puede cambiar desde el mismo menu de Filtros.
- **El orden de Corridas (`orden` en la URL) reemplaza al viejo `masCaras`.**
  El atajo "Mas caras" ahora pone `orden=caras`; el link viejo `caras=1`
  se sigue leyendo (compatibilidad).
- **"Topes y avisos" arranca colapsada**, en una linea ("Sin topes" o un
  resumen chico). Mismo componente en Agentes IA y en la pestaña Costos de
  un agente.
- **Las siete tareas tienen las mismas cinco pestañas** (Cómo funciona,
  Configuración, Instrucciones, Corridas, Costos; `lib/ai-tasks/tabs.ts`). Lo
  propio de cada una lo declara el catálogo (`control`, `instructions`,
  `modelSource`); "Cómo funciona" lee los topes de las constantes reales
  (`lib/ai-tasks/about.ts`). Resumen y Clasificación al cierre se controlan
  desde cada agente: NO tienen modo propio. Clasificación al cierre tiene
  criterios editables (00142) que viajan en la misma llamada que el resumen.
- **Catálogo, `DEFAULT_TEXT` y el CHECK de `ai_task_prompt_versions.task`
  listan las mismas tareas** (`store.test.ts` lo fija): sumar instrucciones a
  una tarea es tocar los tres, con su migración.

## Sin IA, configuración inicial y pestañas (22/10/2026)

Detalle en [docs/agente-ia.md](docs/agente-ia.md) ("Sin IA conectada y la configuración inicial") y [docs/dashboards.md](docs/dashboards.md) ("Cuándo existe la sección El agente").

- **Sin ninguna IA conectada y sin haberla usado nunca, Agentes IA es solo el empty state** (`ConnectFirstAi`) y el agente, las tareas y las corridas redirigen a la lista. Si se desconectan las IAs después de usarlas, la pantalla sigue entera con el aviso. Regla pura: `agentsPageMode` (`lib/agent/page-mode.ts`); "uso previo" = alguna fila en `agent_runs`, leída con el cliente de servicio (`lib/agent/usage.ts`).
- **Los agentes nacen configurados con `ensure_default_agents` (00252, solo `service_role`)**, llamada desde `ensureDefaultAgents` (`lib/agent/defaults.ts`) al guardar una IA y al abrir Agentes IA. Idempotente, con candado por workspace: crea el agente de chat apagado si el negocio NUNCA tuvo uno, completa el modelo donde no hay ninguno y las instrucciones del copywriter (`DEFAULT_COPYWRITER_INSTRUCTIONS`) si nunca se escribieron. **Nunca pisa algo elegido por una persona y nunca prende nada.** Los textos viven en el código, no en la migración.
- **La sección "El agente" del dashboard de Chat existe solo si el agente actuó alguna vez** (`agent_runs.source = 'agent'`) **o hay uno encendido con canales**. Ya no hay modo "invitación".
- **Las pestañas del detalle (agente y tarea) no esperan los datos**: el armazón responde con el permiso y la zona horaria (pedida en paralelo), la pestaña se marca en el clic (`DetailTabs`) y el contenido va en `<Suspense key={tab}>`. Nada pesado (el reporte de costos del mes, el chequeo de IA) va antes de responder.
- **`AGENT_RUN_SOURCES` (`lib/agent/runs-query.ts`) lista todos los `source`**; no compila si falta uno del tipo. Los orígenes con corridas salen de una consulta `limit 1` por origen sobre el índice de la 00251.
- Migraciones `00251` (índice de `agent_runs` por origen) y `00252` (`ensure_default_agents`), **aplicadas y registradas** el 22/10/2026. La `00249` y la `00250` son de la sesión de permisos de la bandeja por canal.

# Cierre por inactividad y resumen al cierre (7/11/2026)

Dos cosas que se pisaban: el barrido que cierra las conversaciones inactivas y el resumen con IA que corre al cerrar. Diagnostico con datos reales de produccion en la sesion del 6/11/2026.

## Lo que no se puede romper

- **El resumen y la clasificacion al cierre no gastan IA si el lead no dijo nada** (`isLowSignalConversation`, `lib/agent/low-signal.ts`, aplicada en `summarizeConversationOnClose`, asi que cubre el cierre manual y el barrido): el lead nunca escribio, o escribio hasta 2 mensajes que son solo afirmaciones y agradecimientos ("Si enviamelo!", "ok", "Gracias"). **Ante cualquier senal, sigue al modelo**: una pregunta, un audio o una foto (un sticker o GIF no cuentan), mas de 2 mensajes o cualquier palabra que no sea un si, un gracias o un saludo. **No se mide por largo**: en los datos reales, entre 20 y 59 caracteres hay consultas de verdad ("no me llego nada" tiene 16). Las palabras de la lista son genericas a proposito: nada de un negocio en el codigo. El motivo `low_signal` no abre corrida ni toca la memoria del contacto.
- **Que conversaciones cierra el barrido lo decide UNA consulta en la base**, `closable_inactive_conversations` (00306, solo `service_role`), y `sweepInactiveConversations` hace un pedido por agente. Antes tomaba las 50 inactivas mas viejas y preguntaba a `agent_runs` y `agent_drafts` de a una: eran siempre las mismas (de septiembre, sin corridas del agente), unos 3.000 pedidos por hora a la base, y las conversaciones que si se podian cerrar nunca llegaban a la lista. **Una condicion nueva del barrido va en la funcion SQL, no en un `continue` del codigo**: lo que se descarta en codigo vuelve a ser primero de la lista y traba a las demas. `lib/agent/closing.test.ts` simula la funcion en memoria (`closableRpc`): si se cambia el SQL, se cambia ahi.
- **Piso de fecha: `SWEEP_MAX_AGE_DAYS` = 14.** Una conversacion sin actividad hace mas que eso es backlog y no se cierra sola: cerrarla y resumirla de golpe son cientos de llamadas a la IA y cientos de chats que cambian de estado en la bandeja del equipo. Esas se cierran a mano.
- **`agent_enabled = false` y `agent_paused_until` estan en la funcion SQL**, repetidos de `resolveAgentState`, que sigue llamandose como red de seguridad.
- **"El agente ya participo" sigue siendo cualquier corrida `source = 'agent'`**, tambien las que no hicieron nada (`already_answered`, `skipped` por la espera tras ManyChat, `no_reply_needed`): solo ~1 de cada 3 de esas conversaciones tiene un borrador real. Cambiarlo es una decision de producto, no un arreglo.

## Migracion

`00306_closable_inactive_conversations` (aditiva, una funcion de lectura) va **ANTES** de desplegar el codigo: **aplicada y registrada** el 7/11/2026 UTC (version `20261107060614`), con los permisos comprobados (solo `service_role`) y la funcion devolviendo las mismas 165 conversaciones que un conteo independiente. La `00307` y la `00308` son de Grabaciones (Etapa 5). **La proxima libre es la `00309`** (confirmar con `list_migrations` y las ramas locales).

# Los cron y su guarda (8/11/2026)

El 8/11/2026 la base quedo "Unhealthy": pg_cron llamaba a la app ~16.500 veces por dia aunque no hubiera nada que hacer (`agent-bursts` y `send-queue` cada 15 s, `jobs`, `sequences` y `automation-events` cada minuto). Desde la 00327 cada cron pasa antes por una guarda en SQL. Detalle, la tabla de que mira cada una y la medicion en [docs/crons.md](docs/crons.md).

## Lo que no se puede romper

- **La guarda copia el `WHERE` del handler**: `private.cron_work_<ruta>` mira lo mismo que `app/api/cron/<ruta>`. **Si un handler cambia, cambia su guarda** en una migracion nueva: `lib/cron/guards.test.ts` ata cada umbral a la constante del codigo y tiene una "alarma" con lo que llama cada handler (un barrido nuevo lo hace fallar). Lo que la guarda no mira a proposito lo cubre la llamada de seguridad y se anota en `coveredBySafetyCall` (`lib/cron/guards.json`).
- **Ante la duda, llama**: un error de la guarda o una ruta sin guarda llaman a la app. Y cada cron llama igual una vez cada tanto (10 min los rapidos; 1 h, 2 h o 1 dia los lentos): si la guarda se equivoca, se pierde ese rato, nunca el trabajo. Mira 5 s hacia adelante en los limites de arriba.
- **`private.call_app_cron` no se reescribe**: la envuelve `private.call_app_cron_if_work`. Un cron nuevo que llama a la app va con guarda o en `UNGUARDED_CRONS` con el motivo (el test lo exige). `bg-dispatch` y `metrics-sync` quedan sin guarda a proposito (deciden por la hora de cada negocio en TypeScript).
- **`private.cron_guard_state` es UNLOGGED**: no escribe WAL y vacia es valida (se llama). Tiene los contadores de llamadas y salteadas.
- **La decision tiene gemelas**: `private.cron_guard_decide` y `shouldCallCron`, con `lib/cron/guard-decide.cases.json`.
- **Realtime publica exactamente `lib/realtime/tables.ts`** (las tablas que escucha la interfaz; lo compara `lib/realtime/tables.test.ts`). Una tabla publicada que nadie escucha le cuesta a la base en cada cambio.
- **Purgas**: `scheduled_jobs` completados y cancelados a los 30 dias, fallidos a los 90, pendientes nunca (`purge-scheduled-jobs`); `cron.job_run_details` a 1 dia.
- En la plantilla de estudiantes, la poda deja `private.cron_work_jobs_extra` en `false` (no tiene webhooks propios).
- **Un trabajo de pg_cron por frecuencia (00350)**: cada corrida abre una conexion y escribe tres veces en `cron.job_run_details`, haga algo o no. `every-15-seconds` (agent-bursts + send-queue), `every-minute` (automation-events + jobs + sequences) y `every-5-minutes` (`3-59/5`: sweep_agent_drafts + alert_draft_windows + drafts-refresh + whatsapp-health) corren `private.cron_tick_*`, con **cada parte en su propio bloque `BEGIN ... EXCEPTION`** (una que falla no frena a las otras) y `lock_timeout` de 10 s. **El error de una parte NO aparece en `cron.job_run_details`** (la corrida dice "succeeded"): queda en `private.cron_tick_errors` (UNLOGGED) y lo muestra `measure-cron-load`. Un cron nuevo de una frecuencia que ya tiene trabajo es una parte mas (`lib/cron/ticks.json` + una migracion que redefine la funcion), no un trabajo aparte; `guards.test.ts` lo controla.

## Migracion

`00327_cron_guards` (aditiva: el codigo no cambia; puede ir antes o despues de un deploy): **aplicada y registrada** el 8/11/2026 UTC (version `20261108050809`), despues de ensayarla en una transaccion que se deshizo sola, con `verify-cron-guards` en verde. En los primeros 10 minutos todas las corridas salieron bien y, por ejemplo, `agent-bursts` corrio 41 veces y llamo a la app 2.

`00350_cron_ticks` (aditiva, va encima de la 00327; el codigo no cambia): **aplicada y registrada** el 8/11/2026 UTC (version `20261108181854`), con `verify-cron-guards --despues-de-00350` en verde y las primeras 26 corridas sin fallas. Lee `cron.job` y aborta si alguno de los nueve cron no tiene el comando que dejo la 00327 o esta apagado. Ensayada contra produccion en una transaccion que se deshizo (dos pasadas seguidas: idempotente; 35 trabajos pasan a 29; los tres juntos tardan 39 ms; una parte forzada a fallar no frena a las otras). Ahorra 9.504 corridas y conexiones por dia (de ~18.000 a ~8.500). **La proxima libre es la `00351`** (la `00349` es de Comunidades de WhatsApp; confirmar con `list_migrations` y las ramas locales).

```
node scripts/verify-cron-guards.mjs                     # decision SQL = TS, comandos, permisos, Realtime y cada guarda con y sin el dato justo
node scripts/verify-cron-guards.mjs --despues-de-00350  # ademas: los tres trabajos agrupados y la falla forzada de una parte
node scripts/measure-cron-load.mjs                      # antes y despues (solo lee)
```

# «En una fecha y hora» (00339, 8/11/2026)

Disparador de SISTEMA (`scheduled_time`, sin contacto ni persona): una automatizacion que arranca sola una vez, todos los dias, ciertos dias de la semana o un dia del mes, en la hora del NEGOCIO. Sirve, por ejemplo, para mandar una encuesta a un grupo de WhatsApp con «Enviar encuesta». Detalle en [docs/flow-registry.md](docs/flow-registry.md) («En una fecha y hora»).

## Lo que no se puede romper

- **No suma ningun cron**: publicar anula la vez pendiente y agenda la proxima en la cola (`flow_scheduled_run`, `lib/scheduled-flows/jobs.ts`); el trabajo corre el flujo y agenda la siguiente ANTES de correrlo. Las reglas de fechas son puras (`lib/scheduled-flows/schedule.ts`) y la zona es siempre `workspaces.timezone`.
- **Nunca corre algo viejo ni dos veces**: version publicada en el trabajo, `isOccurrenceOf` contra la config vigente y el reclamo en `trigger_fires` (`schedule:<vez>`). Mas de 2 h tarde, se saltea esa vez.
- **«Ya paso» se mira en `publishFlow`** (necesita la zona del negocio), no en `triggerProblems`. Si la version anterior era programada, su vez se anula aunque la nueva no lo sea (se mira ANTES de pisar `nodes`).
- **Es el unico disparador `subject: "system"`** (`SYSTEM_TRIGGER_TYPES`): el lienzo ofrece solo pasos sin contacto y publicar rechaza los que lo necesitan.

## Migracion

`00339_scheduled_time_trigger` (aditiva: el CHECK de `triggers.type` suma `scheduled_time`) va **ANTES** de desplegar el codigo: **aplicada y registrada** el 8/11/2026 UTC (version `20261108163107`), despues de ensayarla en una transaccion que se deshizo sola. En produccion conservo los 29 tipos de Servicios (67 en total). Si la base ya acepta tipos que su lista no conoce (en produccion, la `00336` de Servicios se aplico antes de que su codigo llegara a `main`), arma el CHECK con TODO lo que la base acepta + `scheduled_time`, sin sacar nada (siempre como `ARRAY['x'::text, ...]`). **Cuando Servicios mergee, su lista tiene que ir en una migracion posterior a la 00339 que sume `scheduled_time`**: la ultima definicion escrita es la que lee `registry/consistency.test.ts`. La `00330` a la `00336`, la `00340` y la `00343` son de Servicios (rama `feat/servicios-a1`; la 00343 ya esta aplicada) y la `00337`/`00338` de la guardia de email y los avisos. **La proxima libre es la `00344`** (confirmar con `list_migrations` y las ramas locales).

# Buenas practicas de desarrollo

Un trabajo no esta terminado hasta cumplir la "Definicion de terminado" de `.claude/rules/00-protocolo-de-trabajo.md` (compila, lint, tests, pantalla mirada, `.env.example` al dia, migracion idempotente, sin secretos). No se dice "listo" si algo fallo.

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
- **Los tests no pueden hacer `fetch` real**: `vitest.setup.ts` lo bloquea y dice cual era la URL. Un test que lo necesita lo simula con `vi.stubGlobal("fetch", ...)`. Ya paso que un test llamo a Zernio de verdad con una clave falsa.
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

# Video y transcripción de anuncios (7/11/2026)

`meta_ads.video_id` (lo guarda el sync) y `transcript`, `transcript_status`, `transcript_source`, `transcript_updated_at/by`. Por ahora la transcripción se escribe a mano en el detalle del anuncio; la automática queda para más adelante. Detalle en [docs/dashboards.md](docs/dashboards.md) («Video y transcripción de un anuncio»).

- **El sync nunca manda las columnas `transcript*`**, y la automática nunca va a pisar una `manual`. La forma la cuida el CHECK `meta_ads_transcript_shape` (gemela de `manualTranscriptWrite`).
- **El video no se copia**: se pide a Meta al verlo (`fetchAdVideoSource`); el link vence.
- **Sumar un campo al catálogo de Meta es subir `CATALOG_FIELDS_VERSION`**: si no, los anuncios que no cambian nunca lo traen (el sync es incremental).

`00323_meta_ads_video_transcript` (aditiva): **aplicada y registrada** el 7/11/2026 (versión `20261107224824`), después de ensayarla en una transacción que se deshizo sola. La `00324` a la `00329` son de otras sesiones: **la próxima libre es la `00330`** (confirmar con `list_migrations` y las ramas locales).

# Horario de envío del WhatsApp y vigencia de una reunión (9/11/2026, sin migración)

«Enviar WhatsApp a un número» tiene «Mandar solo en este horario» (hora del negocio) y las reuniones tienen `{{booking.days_since_end}}`. Detalle en [docs/flow-registry.md](docs/flow-registry.md) («Horario de envío del WhatsApp y vigencia de una reunión»).

- **Fuera del horario el paso se deja para después, no falla** (`deferFlowNode`, `reason: "send_window"`), antes de la reserva `flow_send_claims` y del tope por hora. Reglas puras en `lib/flow-engine/send-window.ts`. Un horario al revés (21:00 a 08:00) no se publica; un paso sin horario prendido sale igual que siempre.
- **`booking.days_since_end` es el único dato de la reunión que se compara como número**, y se cuenta al armar el contexto del evento (no cambia mientras el flujo espera).

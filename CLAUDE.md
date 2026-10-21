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

## White label

El sistema se duplica por cliente: cada clon es su propia copia, con su propia base.

- Marca por variables de entorno, nunca en el codigo: `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO_URL`, `NEXT_PUBLIC_BRAND_COLOR` (ver `lib/brand.ts`). Sin configurar, el sistema muestra un nombre generico.
- Como habla el agente en espanol: `AI_LANGUAGE_STYLE` (ver `lib/ai/language-style.ts`). Sin configurar, "espanol neutro, directo y sin relleno".
- Alta solo por invitacion: no hay registro publico. `scripts/create-owner.mjs` crea el primer Owner de un clon nuevo (cuenta + workspace + zona horaria del negocio).
- Zona horaria por USUARIO, no por workspace: se detecta del navegador en el primer ingreso y se guarda en `user_preferences` (00121); editable desde el menu de perfil. `workspaces.timezone` sigue existiendo aparte, para las reglas que no pueden depender de quien mira (horario de atencion del agente, topes de gasto, hora de las tareas programadas) — ver `lib/dates.ts` y `lib/user-timezone.ts`.
- Cada clon necesita `app_url` y `cron_secret` propios en Supabase Vault (`system:app_url` / `system:cron_secret`, desde la 00139): `select private.set_system_secret('cron_secret', '...')`, el mismo valor que `CRON_SECRET` en Railway. `private.system_secrets_status()` dice si estan cargados y cuantos cron dieron 200/401, sin mostrar el secreto. Detalle en el comentario de `CRON_SECRET` en `.env.example`.
- `scripts/export-template.mjs` corta una copia limpia del repo (sin docs internos, sin `.env`, con su propio `git init`) como punto de partida para un cliente nuevo.
- `/setup` (`.claude/commands/setup.md`) guia en Claude Code el arranque obligatorio de un clon nuevo: Supabase y migraciones, Railway y variables, los secretos del cron, las URLs de Auth y el `.env` local. Nunca pide claves por chat.

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
- **Las conexiones personales no cambian** (Google Calendar y Fathom, `lib/oauth/*`, `claim_oauth_refresh`): las ve y las conecta cada persona. `oauthRouteContext` tiene tres ramas y un test las fija; la del negocio pide `integrations.manage`.
- **El menu y las pestanas salen de funciones puras** (`visibleNavItems`, `visibleSettingsTabs`, `tabsForViewer`, `pageActions`, `integrationSections`, `generalSectionsFor`, `visibleChannels`, `canExport`): los componentes solo las componen. `adminOnly` ya no existe, es `permissions`.
- **Exportar CSV es `canExport`** (`lib/auth/export.ts`) en los cuatro lugares: el endpoint, la accion y el boton. Un Member no exporta (cambio aprobado M2).
- **La bandeja respeta el canal**: `inbox.<canal>.view` filtra lo que se ve y `inbox.<canal>.reply` habilita el composer, `POST /api/v1/messages` (403 sin llamar al proveedor) y los borradores del agente.
- **Cambios del Member** (todos con test y el comentario "cambio aprobado"): M9 (Extra I) ve sus propias comisiones: `commissions.view` con alcance `own`, nada más (el Member ve «Finanzas» solo por eso); M1 no importa contactos, M2 no exporta, M3 no ve webhooks, M6 no ve Broadcasts, M7 lo que publica se dispara de verdad (la tabla `triggers` pide `flows.edit`), M8 entra a Integraciones por la URL y ve solo "Mis conexiones". Owner y Admin: ninguno. `lib/auth/access-matrix.characterization.test.ts` guarda la foto y falla si Owner o Admin cambian o el Member cambia fuera de esa lista.

## Migraciones (00208 a 00214, todas aplicadas y registradas)

`00208` (`has_permission` v2, `member_permission_keys`, `owner_only_keys`; las politicas de webhooks pasan a `webhooks.manage`), `00209` (diez columnas de `workspace_invites`), `00210` (backfill de `role_id`), `00211` (retiro de `settings.manage` y sucesoras en el jsonb de los roles), `00212` (RLS de equipo, `can_grant_permissions`, `can_give_role`, `is_own_role` y el trigger de roles), `00213` (RLS de Ajustes) y `00214` (RLS de modulos). **La proxima migracion disponible es la `00215`** (confirmar con `list_migrations`; ya paso que el numero de este archivo quedo viejo).

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

Cada closer conecta su Fathom y sus llamadas de venta entran solas: se vinculan
al contacto y a la agenda, se clasifican, se analizan con el SPSP del negocio, se
corrigen sin perder lo que dijo la IA, y lo aprendido vuelve al negocio. Plano en
`docs/requerimientos-llamadas.md`; el resumen del modulo, en
[docs/llamadas.md](docs/llamadas.md); avance y decisiones en
`docs/PROGRESS-llamadas.md` y `docs/PENDIENTE-llamadas.md`.

## Lo que no se puede romper

- **Una sola tabla nueva: `calls`.** Escribe solo el servidor; la ven Owner y
  Admin, quien la grabo, quien ve su contacto (`can_see_contact`) y un rol con
  `calls.view` de alcance `all` (`can_see_call`).
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

- **El menu es `lib/nav/items.ts`**: grupos `inicio`, `adquisicion`, `ventas` y `herramientas` (Tareas, Automatizaciones, Formularios, Agentes IA, Ajustes; Tareas se mudo ahi desde los sueltos de arriba el 14/10/2026). Conocimiento ya no es un item: es un boton de la pantalla de Agentes IA (`lib/nav/page-actions.ts`). Recursos e Integraciones se llegan desde Ajustes. Ajustes aparece para quien pueda ver al menos una pestaña (`visibleSettingsTabs`, `lib/settings/tabs.ts`): un Member lo ve y lo lleva a Recursos.
- **El colapso de Herramientas no pasa por React**: clase `nav-tools-open` en `<html>` + clave `nav-tools-open` de `localStorage` (siempre en `try/catch`) + una linea mas en el script del `<head>` de `app/layout.tsx`. Si la pantalla activa esta adentro, el servidor la dibuja abierta.
- **El editor de un formulario es lienzo + panel** (`components/forms/builder/`, pestaña Campos). Las reglas son puras y viven en `lib/forms/` (`builder-ops`, `contact-map`, `publish-issues`, `canvas-view`, `editor-bar`, `list`, `form-card`); los componentes solo las componen. **Ni un `<details>` en `components/forms/editor` ni en `components/forms/builder`** (`components/forms/no-details.test.ts`). Escribir en una pregunta no puede redibujar las otras ni perder el foco (las tarjetas son `React.memo` y reciben acciones estables).
- **"Se guarda en el contacto" y la tabla de la pestaña Contacto son el mismo dato** (`contactConfig.map`, `setFieldMapping`): un dato del contacto lo usa una sola pregunta.
- **La pestaña del editor vive en `?tab=`** y se cambia con `window.history.pushState(null, ...)` (sin pedirle la pagina al servidor).
- **El formulario publico ya no muestra el logo** (`design.showLogo` queda guardado, nadie lo usa).
- **`entry_url`**: la direccion completa por la que entro la persona, con todos sus parametros menos los sensibles (`lib/attribution/sensitive-params.ts`), los internos y el `#`; tope de 2000. Se arma y se vuelve a sanear en UN solo lugar (`lib/attribution/entry-url.ts`), viaja en `form_submissions.attribution.entry_url` y en `contact_touches.entry_url`, y se ve en el detalle de una respuesta y en las visitas del contacto. **Nunca se loguea.** `landing_page` y `page_url` siguen filtradas, la lista de claves de `lib/attribution/keys.ts` no cambio y `contacts.attribution` (copia derivada) no la incluye.
- **`record_contact_touch` cambio A PROPOSITO en la 00215** y solo para escribir `entry_url` (misma firma, mismo comportamiento): su huella ahora es `2f51ddbf060e31528b89ce7481b38e3d` (la vieja era `f364db1862cc0f90291ca14ef855a214`; la definicion completa esta en la cabecera de la migracion y `lib/contacts/record-touch-00215-diff.test.ts` fija el diff). `create_booking` NO se toco: la Agenda manda la URL dentro de `p_utm` y llega por `raw.utm`.
- **El `embed.js` se regenera** cuando se toca `lib/attribution/` o `lib/embed/` (`npm run build:embed`, se commitea, tope 60 KB). El `attr` del embed admite hasta 4096 bytes.

## Migraciones

`00215` (`contact_touches.entry_url` y `record_contact_touch`), **aplicada y registrada** (14/10/2026 UTC). **La proxima libre es la `00216`** (confirmar con `list_migrations`: la sesion de Equipo y roles uso la `00208` a la `00214`).

# Ventas Fase 1 (construido)

Catalogo de productos con precio versionado, atribucion y asignacion automatica de cada lead, alta de venta en tres pasos, pagos, mora, historial y triggers por cambio de estado. El resumen esta en [docs/ventas.md](docs/ventas.md); avance y decisiones en `docs/PROGRESS-ventas.md` y `docs/PENDIENTE-ventas.md`; triggers y nodos en [docs/flow-registry.md](docs/flow-registry.md).

## Lo que no se puede romper

- **`sales` y `payments` los escribe SOLO el servidor** (Server Actions con el cliente de servicio, despues de `getPermissionAction`); la app lee con la RLS (`can_see_sale`). Los tipos Update/Insert son `Record<string, never>`: se escribe con `as never`.
- **La plata va en centimos** (`lib/sales/money.ts`, `Number(x) || 0`). Siempre USD. La comision de **Whop esta en 0 %** hasta que Wendy confirme el porcentaje real.
- **El precio vive en la VARIANTE** (`product_variants.price`, USD, 0 = sin precio: no se vende). No hay tabla de versiones (se borro en la 00169): la venta guarda el snapshot congelado del producto y su precio, y el historial de cambios de precio vive en `audit_log`. `create_sale` compara el precio de la variante con el que mostro el asistente (`price_changed`). `products` reemplazo a `content_offers`, que se **borro en la 00171** (12/10/2026, despues de desplegar; respaldo en `docs/ventas/respaldo-content-offers.json`): ya no existe ni su puente.
- **El estado de la venta se deriva igual en SQL y en TypeScript** (`derive_sale_status` / `deriveSaleStatus`, mismos casos en `lib/sales/sale-status.cases.json`). Cuatro estados se escriben y ganan; un incobrable nunca deja llegar a `paid`.
- **Un cambio = un evento = una ejecucion por flow.** Los triggers de base emiten con un `change_id` y `pickCanonicalTrigger` (dentro de `eventMatches`) elige un trigger ganador. Los eventos llevan solo escalares y nunca `booking_id`.
- **Los pagos se tocan por un solo nucleo** (`lib/sales/payments-core.ts`, actor usuario o sistema), usado por las Server Actions y por los nodos de flow. Reembolso = fila NUEVA negativa `paid`.
- **La mora corre por SQL directo** (`private.enqueue_payments_overdue_sweep`, 00167), **no** por `call_app_cron`; solo encola si hay pagos candidatos. Los jobs de Ventas no lanzan por un fallo de proveedor: reagendan.
- **`audit_log_select` NO se reescribe**: el historial de Ventas es la politica ADICIONAL `audit_log_select_sales` (00168).
- **`submit_form_response` valida el `sale_id`** del link firmado (00164): uno suelto en la URL o el cuerpo se ignora. `find_or_link_contact`, `create_booking` y `record_contact_touch` no se tocaron.
- **El historial de `products` y `product_variants` lo escribe la BASE** (trigger `catalog_audit`, 00170): alta, estado, archivado, precio (`variant.price_changed` con `changes.price = {old, new}`) y el resto de los campos, venga el cambio de donde venga. `lib/actions/products.ts` NO llama a `logAudit` (`products-audit.test.ts` lo exige: duplicaria cada fila). Actor: `auth.uid()`, si no `updated_by`/`created_by`, si no `system`.
- **Los flujos de cobranza precreados** (cuatro, en borrador) se crean al abrir Ventas por primera vez (Owner/Admin), al prender la opcion y al crear un workspace; nunca con un backfill.

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
- **Indices unicos del telefono y el email principal** (`00205`, `uq_contacts_workspace_phone` / `_email`, solo contactos vivos): se aplican DESPUES de desplegar el PR (ver PENDIENTE). Antes: la consulta de duplicados de PENDIENTE tiene que dar 0 por telefono y por email.

## Migraciones

`00200` (la central y `normalize_phone`), `00201` (los buscadores sobre la busqueda compartida), `00202` (`find_or_link_contact` v3), `00203` (`create_booking` v3) y `00204` (`submit_form_response` v6), **aplicadas y registradas**. La `00205` (indices unicos) esta escrita y ensayada, **sin aplicar**. La `00206` y la `00207` son de Tareas. **La proxima migracion disponible es la `00208`** (confirmar con `list_migrations`).

# Tareas × CRM (construido, 13/10/2026)

Las tareas se conectan con el CRM y la Agenda: seccion «Tareas» en la ficha y la bandeja, «Proximo seguimiento» con «Crear tarea», cobranza automatica,
hora y duracion, tareas en el calendario, arrastre de agendas y fusion real de contactos. Resumen en [docs/tareas.md](docs/tareas.md) y
[docs/contactos-fusion.md](docs/contactos-fusion.md); nodos en [docs/flow-registry.md](docs/flow-registry.md); avance y decisiones en
`docs/PROGRESS-tareas-crm.md` y `docs/PENDIENTE-tareas-crm.md`.

## Lo que no se puede romper

- **La fusion de contactos es `merge_contacts` (00207), una sola transaccion, solo `service_role`.** Cubre las 24 relaciones de `CONTACT_MERGE_TABLES`
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

# Sitio publico

Las paginas publicas del propio proyecto viven en `app/(sitio)/` y se arman **a pedido con
Claude Code** (no hay editor visual). Guia completa en [docs/sitio.md](docs/sitio.md).

- La home (`app/(sitio)/page.tsx`) **por defecto redirige a `/login`**. Cada clon la reemplaza
  por la suya.
- Las paginas son **estaticas o con cache: no leen la sesion**. No pueden llamarse como una ruta
  reservada: `dashboard`, `login`, `auth`, `invite`, `api`, `calendario`, `f`, `embed`.
- Cada pagina nueva se suma a `lib/site/pages.ts` (sitemap y `robots`). `robots.txt` **sigue
  bloqueando todo** salvo esas paginas.
- Un formulario se pone con `<Formulario slug="…" />`: muestra siempre la version publicada
  (cache por etiqueta `form:<slug>`; publicar, pausar, archivar o cambiar el link la invalidan).
- **Son de cada clon**: `scripts/export-template.mjs` no copia `app/(sitio)/` ni `public/sitio/`;
  copia la version por defecto de `scripts/template-files/sitio/`.
- La atribucion viaja entre paginas: cookie `ssa_attr` en el sitio y `localStorage` en una web
  externa con el mismo `embed.js` (modo `data-agenda-track`).

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

# Correcciones del Extra L (Tiron 2, 14/10/2026, rama `fix/atribucion-webhooks-flujos`)

Webhooks que no repiten, flujos sin contacto con origen, leads de Meta sin duplicados, la tabla Meta vs CRM con detalle, el anuncio de origen y el vinculo
anuncio ↔ pieza. Avance y decisiones en `docs/PROGRESS-atribucion.md` ("Correcciones (Tiron 2)") y `docs/PENDIENTE-atribucion.md`; producto en
[docs/webhooks.md](docs/webhooks.md), [docs/atribucion.md](docs/atribucion.md) y [docs/flow-registry.md](docs/flow-registry.md).

## Migraciones (`00216` a `00222`)

`00216` (`receive_inbound_webhook` con lock), `00217` (claves nuevas de `trigger_fires`), `00218` (`source_type`/`source_id`), `00219` (`ads_crm_items`,
`ads_crm_metrics_v2`, `ads_crm_cell_detail`), `00221` (`enrich_touch_ad_origin`) y `00222` (`flow_send_claims`): **aplicadas y registradas**. **La `00220`
(recalcula `leads`/`purchases` de Meta) esta escrita y ensayada pero SIN APLICAR a proposito**: va DESPUES de desplegar el codigo que cuenta el evento
canonico (si va antes, el proximo sync con el codigo viejo vuelve a escribir los dias recientes inflados); su respaldo esta en
`docs/atribucion/respaldo-leads-meta.json`. **La proxima libre es la `00223`** (confirmar con `list_migrations`). No cambiaron las huellas de
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

## Migraciones (00242 y 00243, escritas y ensayadas, **SIN aplicar**)

`00242` (columnas nuevas de `contract_signatures`, `contract_render_matches`, el trigger de evidencia y `record_contract_signature` v2, con las dos definiciones viejas completas en la cabecera) y `00243` (`get_public_form` suma `mode` y `business_signer`, con la vieja en la cabecera). Se ensayaron el 21/10/2026 contra la base real en una transacción que se deshace sola (los 17 casos dan igual que en TypeScript). **Son aditivas: se pueden aplicar antes de desplegar** (el código viejo no manda `contract_render` y no lee las claves nuevas). **La próxima libre es la `00244`** (confirmar con `list_migrations`).

Ojo: el MCP de Supabase de esta sesión apuntaba a OTRO proyecto (`rutledxu…`), no al de producción (`knrxjnmx…`, el del `.env` y el vinculado con la CLI). Para la base real, `supabase db query --linked` desde una carpeta vinculada.

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
- **Los mensajes entrantes de todos los canales se guardan en `messages`** (Fase 3). Para Instagram es dual-write: se guarda en paralelo y la bandeja sigue leyendo el hilo de Zernio. Guardar nunca puede hacer fallar un webhook: si el insert falla, se loguea y la recepcion sigue. **Se guardan siempre**: ya no hay interruptor en Ajustes (`workspaces.persist_zernio_inbound` quedó sin leerse). Todo el detalle —los dos ids del mensaje, la retencion de 12 meses, el backfill y sus limites— en [docs/flujo-de-mensajes.md](docs/flujo-de-mensajes.md).
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

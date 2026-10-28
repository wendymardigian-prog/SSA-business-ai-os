# Comunicación

- Explicá todo en lenguaje simple. Si usás un término técnico, agregá una explicación breve entre paréntesis.
- Cuando propongas algo, da tu recomendación y explicá por qué. No listes opciones sin recomendar.
- Si algo sale mal, explicá qué pasó, por qué, y cómo lo vas a resolver. No tires el error técnico solo.
- Antes de hacer cambios grandes (migraciones, borrar archivos, tocar auth), explicá qué vas a hacer y esperá confirmación.
- Usá español rioplatense (vos/tenés, no tú/tienes).
- **Nunca pidas claves por chat** (API keys, la Service Role Key, el `CRON_SECRET`, contraseñas). Decí DÓNDE copiarlas y DÓNDE pegarlas (Railway, el `.env`, Supabase Vault). Si alguien pega una igual, no la repitas ni la uses, y avisale que conviene generar una nueva.

# Proyecto

Nombre: Sistema Operativo de Negocio con IA (cambialo por el nombre de tu negocio)
Descripción: un sistema operativo centralizado que unifica CRM, bandeja multicanal con agente de IA, automatizaciones, agenda y contenido en una sola plataforma, para que ningún lead quede sin respuesta y todo viva en una sola fuente de verdad.

Lo que trae:
- **Bandeja multicanal**: WhatsApp (Evolution API), Instagram (Zernio) y email, con adjuntos, notas de voz transcriptas, reacciones, stickers y registro de llamadas de WhatsApp.
- **Contactos (CRM)**: etiquetas, campos personalizados, segmentos, importación, estados de setter y de vendedor, producto de interés, fusión de duplicados, marca «Conocido».
- **Asignación**: setter y vendedor de cada lead (a mano o por reglas) y responsable de cada chat (Ajustes → Asignación).
- **Banca de recursos**: textos, audios, videos, imágenes, archivos y enlaces listos para mandar.
- **Secuencias**, **broadcasts** y **automatizaciones** (editor visual de flujos con el paso Condiciones).
- **Agentes IA** (BYOK: tu propia clave de OpenAI, Anthropic o Google), las tareas de IA en segundo plano y la base de conocimiento.
- **Agenda**: Google Calendar, página pública `/calendario` y un embed para cualquier web.
- **Contenido y publicación**, **Social** y **dashboards** (Chat, Contenido, Anuncios de Meta con la tabla Meta vs CRM, Agenda y el unificado).
- **Catálogo de productos** (Ajustes → Productos).
- **Equipo, roles, permisos e invitaciones**.

Multi-tenancy: **una copia por dueño**. Una instalación puede tener **varios negocios del MISMO dueño** (por ejemplo dos marcas propias): cada uno es un workspace con sus claves, canales, equipo y marca, y se cambia con el selector de arriba a la izquierda. No hay pantalla para crear workspaces: se usa `scripts/create-workspace.mjs` (ver «Varios negocios en una instalación»).

# Base del proyecto

Fork de: ZernFlow (https://github.com/zernio-dev/zernflow, licencia MIT)
Framework: Next.js 16 (App Router) + React 19 + TypeScript 5
Estilos: Tailwind CSS v4 (el código real usa v4, NO v3)
Flow builder: @xyflow/react 12
SDK de canales: @zernio/node 0.2.519 (Zernio, ex "Late")
IA: Vercel AI SDK (paquete `ai`) v6, soporta ToolLoopAgent
Data: @supabase/supabase-js 2.95 + @supabase/ssr 0.8
Testing: Vitest 3

Patterns a seguir (mantener consistencia, no reinventar):
- Auth: Supabase SSR con cookies httpOnly. El trigger `on_auth_user_created` arma el workspace automáticamente.
- State management: Server Components + React hooks. NO Redux, NO Zustand.
- API layer: webhooks en API Routes (`app/api/`), mutaciones de la UI en Server Actions.
- Data access: `@supabase/supabase-js` con RLS del lado del usuario; la Service Role Key solo en el servidor (cron, webhooks, acciones después de chequear el permiso).
- Styling: utilidades de Tailwind v4. Sin CSS modules ni styled-components.
- Flow engine: motor recursivo en `lib/flow-engine/engine.ts`, nodos en `lib/flow-engine/nodes/`, registro de disparadores y pasos en `lib/flow-engine/registry/`, abstracción de plataforma en `lib/flow-engine/platform-adapter.ts`.
- Migraciones en `supabase/migrations/`, numeradas `000NN_nombre.sql`.
- Reglas de negocio puras en `lib/` (con su test); los componentes solo las componen.

NO reescribir (ya existe, solo verificar/extender):
- Autenticación con Supabase Auth + trigger de auto-creación de workspace.
- Workspaces y equipo con invitaciones (tabla `workspace_invites`, vencen a los 7 días).
- Roles Owner / Admin / Member (`workspace_members.role`) y roles personalizados (`role_id`).
- Flow builder visual con @xyflow/react (motor recursivo con profundidad máxima 50, interpolación de variables, pila de flujos).
- Bandeja con lista de conversaciones y panel de mensajes.
- CRM con tags, campos personalizados (6 tipos: text, number, boolean, date, url, email — NO existe 'list') y segmentos.
- Secuencias (drip) con auto-pausa cuando el contacto responde.
- Broadcasts.
- Registro de eventos de webhook para idempotencia (tabla `webhook_events`).
- Versiones de flujos (historial al publicar).
- Realtime en `conversations` y `messages`.
- Integración con Zernio para Instagram (DMs, comentarios, respuestas a historias).

# Stack

- Base de datos: Supabase (PostgreSQL). El plan free alcanza para probar; para un negocio en marcha, Pro.
- Auth: Supabase Auth (email/password) + SSR.
- Frontend: Next.js 16 (App Router) + React 19 + TypeScript 5.
- Estilos: Tailwind CSS v4.
- Hosting: Railway. Si Evolution API vive en otro proyecto de Railway, la app le habla por su dominio público (la red privada de Railway es por proyecto).
- Canal Instagram: Zernio — DMs, comentarios, respuestas a historias, y publicación en Instagram y TikTok.
- Canal WhatsApp: Evolution API (Baileys, se conecta por QR), self-hosted en Railway.
- Email: Resend (saliente; también entrante como canal de la bandeja).
- IA: BYOK multi-proveedor (OpenAI / Anthropic / Google) con Vercel AI SDK; Voyage AI para los embeddings de la base de conocimiento.
- Secrets: Supabase Vault (AES-256).
- Versionado: GitHub.
- Testing: Vitest 3.

## White label

Cada instalación es su propia copia, con su propia base y su propio deploy.

- **Marca por variables de entorno, nunca en el código**: `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO_URL`, `NEXT_PUBLIC_BRAND_COLOR` (ver `lib/brand.ts`). Sin configurar, el sistema muestra un nombre genérico. Es la marca de la INSTALACIÓN (login, ícono de la pestaña) y el respaldo de cada negocio: cada workspace puede tener la suya (`workspaces.brand_*`, Ajustes → General → Marca), y todo lo que ve un lead y el panel usan `resolveBrand(workspace)`.
- **Cómo habla el agente en español**: `AI_LANGUAGE_STYLE` (ver `lib/ai/language-style.ts`). Sin configurar, "español neutro, directo y sin relleno". Un negocio con `workspaces.ai_language_style` usa el suyo (`aiLanguageStyle(propio)`; las tareas de IA lo reciben con `loadTaskInstructionsForRun`).
- **Alta solo por invitación**: no hay registro público. `scripts/create-owner.mjs` crea el primer Owner (cuenta + workspace + zona horaria del negocio). Después, el resto del equipo entra por invitación (Ajustes → Equipo).
- **Zona horaria por USUARIO**, no por workspace: se detecta del navegador en el primer ingreso y se guarda en `user_preferences`; se edita desde el menú de perfil. `workspaces.timezone` existe aparte para las reglas que no pueden depender de quién mira (horario de atención del agente, topes de gasto de IA, hora de lo programado) — ver `lib/dates.ts` y `lib/user-timezone.ts`.
- **Secretos del cron en Vault**: cada instalación necesita `app_url` y `cron_secret` propios en Supabase Vault (`system:app_url` / `system:cron_secret`). Se cargan con `select private.set_system_secret('cron_secret', '...')` (el mismo valor que `CRON_SECRET` en Railway) y se comprueban con `select * from private.system_secrets_status();`, que dice si están cargados y cuántos cron dieron 200/401 sin mostrar el secreto. Sin esto, todo lo automático queda agendado y no corre nunca.
- **`/setup`** (`.claude/commands/setup.md`) guía en Claude Code el arranque obligatorio: Supabase y migraciones, Railway y variables, los secretos del cron, las URLs de Auth y el `.env` local. Nunca pide claves por chat.
- La raíz del dominio (`/`) redirige a `/login`.

# Comandos

## Desarrollo
- Instalar dependencias: `npm install`
- Correr en desarrollo: `npm run dev` (http://localhost:3000)
- Build: `npm run build` (regenera también `public/embed/embed.js`)
- Tests: `npx vitest run`
- Lint: `npm run lint`

## Base de datos (CLI de Supabase)
- Aplicar migraciones al proyecto vinculado: `supabase db push`
- Correr un archivo SQL contra el proyecto vinculado: `supabase db query --linked -f <archivo>`
- Base local (necesita Docker): `supabase start`, `supabase db reset` (vuelve a aplicar todas las migraciones), `supabase status` (muestra URL y claves locales), `supabase stop`.

## Git y GitHub
- Ver estado: `git status`
- Crear branch: `git checkout -b feature/nombre-descriptivo`
- Commit: `git commit -m "tipo: descripción clara"` (agregá los archivos por ruta, no `git add -A` a ciegas)
- Push: `git push origin nombre-del-branch`
- Traer cambios: `git pull origin main`
- Ver historial: `git log --oneline -20`
- Volver atrás un archivo: `git checkout -- ruta/al/archivo`

## Convenciones de commits
- Formato: `tipo: descripción breve`
- Tipos: feat (funcionalidad nueva), fix (corrección de bug), refactor (reorganizar sin cambiar comportamiento), chore (mantenimiento, deps), docs (documentación), style (formato), test (tests).
- Ejemplos:
  - `feat: agregar detección cross-canal por teléfono y email`
  - `fix: corregir RLS en contact_notes`
  - `chore: actualizar .env.example con una variable nueva`
- Commit después de cada funcionalidad completa. Cada commit deja el proyecto funcionando (que compile y corra).

# Reglas de negocio

- **El contacto es la entidad central.** Deduplicación por teléfono, email o usuario de una red; nunca solo por nombre.
- **Identificación cross-canal**: si el mismo teléfono o email aparece por dos canales, es UN contacto, pero cada conversación sigue separada por canal.
- **Doble asignación**: cada lead tiene setter (quien contacta) y vendedor/closer (quien cierra). Los dos son opcionales e independientes.
- **Alcance de leads (restricción dura por RLS)**: un Member solo ve y edita contactos y conversaciones donde es setter, vendedor o responsable asignado. Owner y Admin ven todo. El alcance sale del ROL: `own` (lo asignado), `own_unassigned` (lo asignado + lo que no tiene a nadie) o `all`; el Member de sistema es `own`.
- **Soft delete**: nada se borra de verdad, se marca con `deleted_at`. Retención de 30 días y después purga por cron.
- **"No contactar"**: se detecta sola o se marca a mano; pausa las secuencias del contacto y frena los envíos automáticos.
- **Secuencias**: se pausan solas cuando el contacto responde; hay alerta de colisión si hay más de una activa en el mismo canal.

# Calidad de código

- Cada cambio de base de datos va en una migración SQL nueva, numerada en orden (ver «Migraciones»).
- Cada migración es idempotente: `CREATE TABLE IF NOT EXISTS`, `DO $$ ... END $$` para los chequeos, `IF NOT EXISTS` en restricciones y columnas.
- `.env.example` siempre al día: cada variable nueva con un comentario de qué es y de dónde sale.
- El sistema funciona con la base vacía: empty states claros en todas las pantallas.
- Nunca commitear `.env` con valores reales; solo `.env.example`.
- Datos de demo en seeds aparte (`supabase/seeds/`), nunca en las migraciones de estructura.
- UUIDs con `gen_random_uuid()`.

# Migraciones

La base viene armada en **17 archivos, uno por área**, que se aplican en orden:

| Archivo | Qué crea |
|---|---|
| `00000_permisos_por_defecto` | El acceso por defecto de `anon`, `authenticated` y `service_role` a lo nuevo de `public`. Corre antes que todo. |
| `00001_extensiones_y_utilidades` | Extensiones, el esquema `private` y funciones chicas (normalizar teléfonos, emails, textos). |
| `00002_espacios_y_equipo` | Workspaces, roles, miembros, invitaciones, preferencias y las funciones de permisos. |
| `00003_secretos_e_integraciones` | Vault (guardar/leer/borrar claves), integraciones, conexiones OAuth y canales. |
| `00004_catalogo_y_asignacion` | Productos y variantes, y las reglas de asignación de setter/vendedor. |
| `00005_contactos` | Contactos, tags, campos, segmentos, estados, la regla única de alta. |
| `00006_bandeja` | Conversaciones, mensajes, reacciones, stickers, llamadas de WhatsApp, reglas de responsable. |
| `00007_banca_de_recursos` | `response_assets`. |
| `00008_automatizaciones` | Flujos, disparadores, sesiones, secuencias, broadcasts. |
| `00009_agentes_ia` | Agentes, corridas, borradores, conocimiento, tareas de IA, precios de modelos. |
| `00010_agenda` | Eventos, disponibilidad, reuniones, `create_booking`. |
| `00011_contenido` | Ideas, piezas, publicaciones, pilares. |
| `00012_metricas_anuncios_y_atribucion` | Métricas sociales, catálogo de Meta, toques de atribución. |
| `00013_auditoria_y_avisos` | `audit_log` y notificaciones. |
| `00014_trabajos_y_cron` | `scheduled_jobs`, `call_app_cron` y los cron de `pg_cron`. |
| `00015_funciones_transversales` | Funciones que cruzan áreas (fusión de contactos, métricas del chat...). |
| `00016_archivos` | Buckets de Storage y sus políticas. |

Reglas para las migraciones NUEVAS:

- **La próxima es la `00017` en adelante.** Antes de escribir una, mirá la carpeta `supabase/migrations/` y usá el número siguiente al último. Nombre: `000NN_descripcion_corta.sql`.
- **Nunca edites una migración que ya se aplicó** (las 17 de base incluidas). Un cambio a algo que ya existe es una migración nueva que lo altera.
- **Idempotente siempre** (ver «Calidad de código»).
- **Cada tabla nueva declara sus `GRANT`**: a `service_role` siempre, y a `authenticated`/`anon` lo que corresponda. `ENABLE ROW LEVEL SECURITY` y sus políticas en la misma migración. `lib/migrations-grants.test.ts` lo exige.
- **Tipos de extensiones con su esquema**: `extensions.vector(1024)`, no `vector(1024)`. La CLI no tiene `extensions` en su `search_path` y la migración falla.
- **Un DEFAULT de columna nunca llama a una función de `private`**: se evalúa con los permisos de quien inserta y rompe el alta.
- **Se aplican con la CLI**: `supabase db push` (aplica en orden lo que falta y anota qué aplicó). No pegues migraciones grandes en el SQL Editor.
- **Una migración que BORRA va después del código que deja de usar lo borrado**: primero el código desplegado y comprobado, después las consultas de seguridad, un respaldo de lo que se va a borrar, y recién ahí la migración. Las aditivas pueden ir antes del código; las que borran, nunca.
- Si una función existente se reescribe, la migración lleva en su cabecera la definición vieja completa, para poder volver atrás.

**Seeds (datos, no estructura)**: `supabase/seeds/00_model_pricing.sql` y `01_transcription_pricing.sql` cargan los precios de los modelos de IA y de la transcripción para cada workspace que exista. Se corren **después de crear el primer usuario** (`supabase db query --linked -f supabase/seeds/00_model_pricing.sql`, o en el SQL Editor). Se pueden correr más de una vez sin duplicar. Sin ellos, lo que gasta IA queda con el costo vacío y los topes de gasto no funcionan. `create-workspace.mjs` copia los precios al negocio nuevo.

# Scripts de verificación

Corren contra la base del `.env` con usuarios de verdad: crean y limpian sus datos (prefijo `zz-test-`). Una limpieza que falla es una prueba que falla. **Se corren de a uno**: comparten el prefijo y se pisan la limpieza.

```
node scripts/verify-rls.mjs                   # políticas, alcance de leads, Vault
node scripts/verify-roles.mjs                 # roles personalizados y alcances
node scripts/verify-permissions-matrix.mjs    # cada tabla con permiso: Owner, Admin, Member, un rol con la clave y uno sin ella
node scripts/verify-workspace-isolation.mjs   # secretos e integraciones entre workspaces, alta por invitación
node scripts/verify-crm.mjs
node scripts/verify-contact-merge.mjs         # fusión de contactos, atomicidad, tablas que faltan
node scripts/verify-contact-pipeline.mjs      # valores tipados, estados, producto de interés
node scripts/verify-contacts-single-entry.mjs # la regla única de alta y la concurrencia
node scripts/verify-csv-import.mjs
node scripts/verify-enrichment.mjs
node scripts/verify-inbox-filters.mjs
node scripts/verify-chat-awaiting.mjs         # esperando respuesta, cierre, tiempo humano
node scripts/verify-chat-media.mjs
node scripts/verify-message-persistence.mjs
node scripts/verify-optout.mjs
node scripts/verify-webhook.mjs               # receptor de Evolution
node scripts/verify-knowledge.mjs
node scripts/verify-content.mjs               # piezas, versiones y el bucket
node scripts/verify-publishing.mjs            # publicar de punta a punta con proveedores simulados
node scripts/verify-scheduling.mjs            # agenda: RLS, únicos, la RPC y la purga
node scripts/verify-booking-concurrency.mjs   # diez pedidos a la vez, una reunión
node scripts/verify-attribution.mjs
node scripts/verify-ads-attribution.mjs       # catálogo de Meta, paridad SQL↔TS, Meta vs CRM
node scripts/verify-organic-attribution.mjs
node scripts/verify-dashboards.mjs
node scripts/verify-audit-visibility.mjs
```

Para correrlos contra una base local (`supabase start`): `DB_TARGET=local` (y `SUPABASE_WORKDIR=<carpeta>` si hay otro stack local prendido), con el `.env` apuntando también a la base local (URL y claves de `supabase status`). Nunca contra una base con datos reales de clientes sin entender qué hace el script.

# Lo que no se puede romper

Reglas de cada módulo que no se ven mirando una sola pantalla. Si un cambio choca con alguna, frená y explicá por qué antes de seguir.

## Varios negocios en una instalación

- **Qué es de cada negocio**: sus claves (Vault con prefijo `ws:<id>:`), canales, contactos, conversaciones, automatizaciones, contenido, equipo, roles y marca. **Qué es de la instalación**: el dominio (`NEXT_PUBLIC_APP_URL`, de ahí salen los links de agenda), el login, el ícono y la marca de respaldo.
- **Crear uno**: `node scripts/create-workspace.mjs --owner-email=... --name="..." --timezone=America/...`. Usa la Service Role Key del `.env`, te deja como Owner, copia los precios de IA y frena si ya tenés un negocio con ese nombre. No crea cuentas (para eso está `create-owner.mjs`). Después, en el negocio nuevo: Marca, Integraciones (registra su webhook de Zernio sola), un usuario de agenda distinto (es único en toda la instalación) y el equipo.
- **El workspace activo sale de `lib/workspace.ts`**: `getWorkspace()` (pantallas y Server Actions) o `getActiveWorkspace()` (API Routes, no redirige). Es el de la cookie `workspace_id` si la persona sigue siendo miembro; si no, el más viejo. Nunca "el primer workspace" con `.limit(1)` (`lib/workspace-boundary.test.ts`).
- **La RLS deja leer todos los negocios de los que sos miembro**: toda consulta del navegador que LISTE filas filtra por el activo (`useActiveWorkspaceId()`), y toda suscripción de Realtime filtra por `workspace_id` o por un id.
- **No conectar la misma cuenta de Instagram ni el mismo número en dos negocios**: el webhook no sabría a cuál mandarlo y los mensajes se pierden.
- Los cron y los webhooks ya recorren todos los negocios: no hay nada que configurar para el segundo.

## Integraciones y secretos

- **Todos los secretos viven en Supabase Vault**, nunca en el `.env` ni en el código (salvo los de arranque: Supabase, `CRON_SECRET`, Evolution). De un secreto guardado la pantalla solo sabe que EXISTE.
- El catálogo de proveedores está en `lib/integrations/providers.ts`; los nombres de los secretos en `lib/secret-names.ts`, que **no importa nada** a propósito.
- **`readSecret` siempre con el cliente de servicio** (`createServiceClient`): `read_secret` solo la ejecuta `service_role`. Quién puede USAR una clave lo decide el que llama (el guard del permiso, la RLS de la conversación), y el workspace sale siempre de la sesión, nunca del pedido.
- `lib/vault-boundary.test.ts` falla si un Client Component llega por imports a `lib/vault.ts` o `lib/supabase/server.ts`. Si aparece un módulo nuevo que no puede ir al navegador, sumalo ahí.
- **"Probar y guardar" usa la clave contra el proveedor ANTES de guardarla** (`lib/integrations/ai-key-check.ts` para las de IA): un 401/403 no se guarda; un 429/5xx sí (no dice nada de la clave).
- Las conexiones personales (Google Calendar) las ve y las conecta cada persona; las del negocio piden `integrations.manage`.

## Equipo, roles y permisos

- **El catálogo de claves es `lib/auth/permissions.ts` y es la fuente**: los permisos de Owner, Admin y Member salen de ahí, no de la base. La fila de un rol de sistema tiene los permisos vacíos a propósito. `workspace_members.role` sigue siendo owner/admin/member; un rol personalizado es siempre un `member` con `role_id`.
- **Cada clave hace lo que dice en las tres capas**: la página (`requirePermission`), la acción (`getPermissionAction` / `getAnyPermissionAction`) y la tabla (`has_permission` en la política). `lib/auth/catalog-usage.test.ts` falla si una clave no se usa en ningún lado.
- **La lista del Member vive en dos lugares que tienen que ser iguales**: `MEMBER_PERMISSION_KEYS` (TypeScript) y `private.member_permission_keys()` (SQL); lo mismo `private.owner_only_keys()` y `private.ungrantable_keys()`. `lib/auth/member-sql-parity.test.ts` las compara.
- **`has_permission` nunca devuelve NULL** y conserva su firma. Ojo: para el Member de sistema es falso en SQL; las políticas de escritura de un Member usan el patrón `role_id IS NULL OR system_role = 'member' OR has_permission(...)`.
- **"No podés dar lo que no tenés"**: quien invita, asigna un rol o arma un rol no puede dar más de lo que tiene. Gemelas con los mismos casos (`lib/team/grant.cases.json`): `lib/team/grant.ts` y `can_grant_permissions` / `can_give_role` / `is_own_role` + el trigger `workspace_roles_grant_check`. El rol Admin lo dan solo Owner o Admin; el Owner no se da; nadie se cambia su propio rol ni toca al Owner.
- **Invitaciones**: el link es `/invite/<id>`; "vencida" se deriva, no se guarda; anular es un UPDATE; reenviar, una vez por minuto y cinco en total; `delivery='link'` no manda correo. Los logs no llevan emails ni links.
- **Roles con guardado automático**: una cola serial (`lib/roles/save-queue.ts`); un cambio que falla vuelve a su valor y ofrece "Reintentar". Nada de `window.location.reload()`.
- **`workspaces` se escribe con el cliente de servicio DESPUÉS de chequear la clave** (`settings.general` y compañía), filtrando por el workspace de la sesión. No se reescribe esa política.
- **El menú y las pestañas salen de funciones puras** (`visibleNavItems`, `visibleSettingsTabs`, `tabsForViewer`, `pageActions`, `canExport`...). El menú es `lib/nav/items.ts`; el colapso de Herramientas no pasa por React (clase en `<html>` + `localStorage` en `try/catch`).
- **La bandeja va por CUENTA conectada**: cada rol guarda en `permissions.channels` «todas las cuentas» (incluye las futuras) o una lista por cuenta, cada una con su alcance (solo asignadas / + sin asignar / todas) y si «responde». Lo aplica la base (`can_see_conversation`; ver un chat deja ver la ficha del contacto) y la pantalla usa las mismas reglas (`lib/auth/channel-permissions.ts`, gemela SQL con `channel-permissions.cases.json`).
- `lib/auth/access-matrix.characterization.test.ts` guarda la foto de lo que puede cada rol: falla si cambia sin querer.

## Contactos

- **Un dato fuerte identifica a una persona**: el canal con el id del remitente, el teléfono, el WhatsApp, el email (y el secundario) y los usuarios de Instagram, TikTok, X, LinkedIn y Facebook. **Nunca el nombre.** Se normalizan igual en TS y SQL (`lib/contacts/identity.ts` + gemela, casos en `identity.cases.json`; los usuarios sin "@" y en minúsculas).
- **Todo contacto nuevo nace en UN lugar**: `find_or_create_contact` / `findOrCreateContact` (`lib/contacts/find-or-create.ts`), con bloqueo por dato (dos llegadas simultáneas = un contacto), siempre con el cliente de servicio. Los mensajes entrantes (`find_or_link_contact`) y la agenda (`create_booking`) la usan desde la base. **Ningún archivo de la app inserta en `contacts`** (`lib/contacts/single-entry.test.ts`).
- **Un error de la base nunca se toma como "no encontrado"** (crearía un duplicado): `findOrCreateContact` lanza y quien llama decide.
- Solo el alta manual crea un contacto con el nombre solo. **Un teléfono o email que ya es de OTRO contacto no se escribe** al completar datos; se anota el conflicto (`lib/contacts/unique-errors.ts`). El alta manual de un Member con un dato de un contacto que no ve responde sin enlace ni nombre.
- **Índices únicos** del teléfono y el email principal (solo contactos vivos).
- **La fusión es `merge_contacts`**, una sola transacción, solo `service_role`, y cubre todas las relaciones de `CONTACT_MERGE_TABLES` (`lib/contacts/merge.ts`). **Una tabla nueva con `contact_id` se suma a la función y a esa lista en el mismo cambio**: `verify-contact-merge.mjs` lee el catálogo y falla si falta una.
- **Estados de setter y de vendedor**: solo cambian por `set_contact_status` (solo `service_role`; núcleo `applyContactStatus`, `lib/contacts/status-core.ts`). La guardia `contacts_status_guard` rechaza (`CS001`) cualquier otro cambio, así ningún estado queda sin su fila en `contact_status_changes`. El último estado es el más reciente de los dos (empatados, el del vendedor), igual en TS y SQL. Las listas viven en `workspaces.contact_status_settings`: la `key` no cambia nunca y un estado se archiva, no se borra. El historial lo ve quien ve el contacto.
- **Producto de interés**: el trigger `contacts_interest_check` exige una variante del mismo producto y del mismo workspace.
- **Un valor de campo personalizado se valida por tipo en UN lugar** (`normalizeCustomValue`, `lib/custom-fields.ts`): ficha, flujos e importación. `value_number` / `value_date` los llena un trigger que nunca lanza; comparar números o fechas va contra esas columnas, nunca contra el texto.
- **Importación**: un contacto nuevo nace con el toque de origen `import`; uno que ya existía no recibe toque, solo una entrada en su historial.
- **Exportar CSV es `canExport`** (`lib/auth/export.ts`) en el endpoint, la acción y el botón. Un Member no exporta.
- **El historial del contacto** (`lib/contacts/history.ts`) muestra lo automático (automatizaciones, secuencias, emails), no los mensajes del chat.
- **La foto de perfil** se refresca sola cuando viene de Instagram/WhatsApp (`avatar_source = 'external'`); una subida a mano nunca se pisa (`lib/contacts/avatar.ts`). El @ de Instagram es un link (`lib/contacts/links.ts`).

## Asignación, responsable del chat, «Conocido» y «Cliente»

- **Setter y vendedor por reglas** (Ajustes → Asignación, tabla `assignment_rules`): a mano, por turnos o por condiciones. Algunos nombres internos dicen `sales` (por ejemplo el job que evalúa un contacto): son de la asignación y se dejan así.
- **El responsable del chat es `conversations.assigned_to`** (la RLS ya lo usa: te asignan un chat → el contacto es «tuyo»). Se cambia con `setConversationAssignee`: con `contacts.assign` a cualquiera; sin la clave, solo «Tomar» uno sin responsable en una cuenta donde respondés. El aviso nunca va a quien asignó.
- **Reglas por cuenta** (`conversation_assignment_rules`): gana la primera activa que coincide; `assign_new_conversation` corre SOLO en una conversación nueva y nunca pisa un responsable. `conversation_rule_pick` y `pickRuleMember` son gemelas (`assignment-rules.cases.json`).
- El filtro «Asignación → persona» usa `conversation_people` (responsable + setter + vendedor); «Asignadas a mí» es `?asignado=mias`.
- **Conocido es una marca del contacto, no una etiqueta** (`is_known`, quién y cuándo). Al marcar, la BASE asigna cada chat a la persona de su cuenta (`workspaces.known_contacts_settings`, si no el Owner) y apaga el agente (`agent_disabled_by_known`). Al quitar, se prende solo lo que apagó la marca. Las secuencias se pausan (motivo `known`); los flujos siguen. Quien no lo marcó ni lo tiene a cargo ve un aviso antes de abrir el chat, que no se marca como leído hasta «Abrir igual».
- **Cliente es la marca hermana** (`is_customer`, `customer_marked_by/at`, `customer_source`): mismos efectos que Conocido (agente apagado con `agent_disabled_by_customer`, secuencias pausadas con motivo `customer`, aviso antes de abrir). Sus chats van a la persona de `workspaces.customer_contacts_settings`; sin nadie configurado, el responsable NO cambia. Las reglas puras están en `lib/inbox/marks.ts` y cómo se ve cada marca en `components/contacts/mark-badge.tsx`. Cada fila de la lista de chats tiene un menú «⋯» (`planRowActions`) para marcar sin abrir el chat.

## Bandeja y mensajes

- **Un receptor por canal, en la app**: `app/api/webhooks/late` (Zernio, firma HMAC; sin secreto, rechaza) y `app/api/webhooks/evolution` (header `x-webhook-token` comparado en tiempo constante). Nunca en una Edge Function: el motor de flujos y el agente corren en Node.
- Lo que hacen los dos igual vive en `lib/inbound.ts`. Responden 200 enseguida y procesan en `after()`, con idempotencia por `webhook_events`.
- **Todos los mensajes entrantes se guardan en `messages`**; guardar nunca hace fallar un webhook. El hilo de Instagram se lee en vivo de Zernio y se cruza con la tabla por `platform_message_id`.
- La URL que se registra en cada proveedor la arma `lib/webhook-url.ts` desde `NEXT_PUBLIC_APP_URL`, y se niega a registrar una dirección local: un webhook a localhost no falla, simplemente no entra nada.
- Una cuenta conectada o desconectada en Zernio se identifica por la firma y relee la lista completa (`syncZernioChannels`). Si Zernio no responde, no se desactiva ningún canal.
- **Los adjuntos tienen UN solo formato**: `{ v: 2, items: ChatAttachment[] }`; `parseAttachments` (`lib/messages/attachments.ts`, módulo PURO) entiende además los formatos viejos de cada origen.
- **La media se copia a Storage** (bucket privado `chat-media`, el primer segmento del path es el workspace, sin políticas de escritura: sube el service role). La descarga va en el `after()` del webhook, no en la cola (la URL de Meta vence). WhatsApp manda la media cifrada: se pide a Evolution por id (`getBase64FromMediaMessage` con `convertToMp4: false`). Lo que no tiene archivo (ubicación, contacto, encuesta) no se intenta bajar. Retención de 180 días; la transcripción nunca se borra.
- **La transcripción tiene UNA puerta**: `lib/ai/transcribe.ts` (un test de frontera lo exige). Se intenta en el momento y la cola es el respaldo; un claim condicional (`none|failed -> pending`) evita cobrar dos veces; un reaper libera las colgadas. Se cobra por hora de audio (`model_pricing.audio_per_hour`).
- **Un envío con media pasa por `sendChannelMessage`** (`lib/flow-engine/send.ts`), con **rama explícita por proveedor, nunca un `else`**: un canal nuevo que cae por defecto en otro proveedor manda al lugar equivocado sin avisar. Qué acepta cada canal lo decide `channelAccepts` (`lib/channels/media.ts`). Los archivos se validan por sus bytes, no por la extensión; tope de 16 MB.
- **Email como canal**: entra por `channels`, `conversations` y `messages`. El canal guarda `email:<dirección>` en `channels.late_account_id` (que sigue NOT NULL). Responder arma el hilo con `In-Reply-To` y `References`. El HTML de un email se limpia DESPUÉS de pegar los valores (`lib/email/html.ts`: las variables se escapan y lo que sale pasa por una lista blanca).
- **Una reacción NO es un mensaje**: los webhooks la atajan antes del camino de los mensajes (`lib/messages/reactions-inbound.ts`) y la guardan en `message_reactions`. Qué admite cada canal: `lib/channels/reactions.ts` (WhatsApp cualquier emoji, Instagram solo ❤️, email ninguna).
- **Stickers**: solo WhatsApp (`lib/channels/stickers.ts`). La biblioteca se arma con los que se mandan; un archivo se COPIA a la conversación antes de mandarse. `sharp` fijado en la 0.34.5.
- **Llamadas de WhatsApp**: Evolution no hace ni atiende llamadas, solo avisa con el evento `CALL`. `record_whatsapp_call` hace la transición en una sentencia; la llamada es una línea del hilo, **no un mensaje** (no la ve el agente ni dispara flujos). Una perdida suma un no leído y avisa. Un número conectado antes de activar «Llamadas» no recibe el evento hasta reconectarlo o guardar «Llamadas» una vez.
- **Esperando respuesta**: el estado vive en `conversations` y lo mantiene SOLO el trigger de `messages` (`awaiting_reply_since`, `reply_window_until`, la marca «no necesita respuesta»), envuelto en `EXCEPTION WHEN OTHERS`: **nunca puede tumbar el insert de un mensaje**. La tarjeta del dashboard (`chat_waiting_now_v2`) y el filtro de la bandeja (`lib/inbox/awaiting.ts`) usan el mismo criterio: si cambia uno, cambian los dos. «No necesita respuesta» tiene tres fuentes (`rule`, `agent`, `manual`) y se borra sola con un mensaje nuevo.
- **Reglas con gemelas SQL↔TS**: el mensaje de cierre (`chat_is_closure_message` / `lib/messages/closure.ts`, conservadora: un "?" o una promesa nuestra piden respuesta) y la respuesta humana (`chat_reply_is_human` / `isHumanReply`). La espera se cuenta desde el PRIMER mensaje sin responder.
- **El último mensaje de la conversación** (`last_message_at`, `_preview`, `_direction`) lo mantiene un trigger con cualquier entrante y cualquier saliente que salió, mirando cuál es DE VERDAD el último. El «Vos: » lo pone la pantalla. El «no leído» se apaga en la base si el último mensaje es una respuesta nuestra.
- **Un envío fallido** guarda lo que se quiso mandar en `text` y el motivo en `messages.send_error`. «Reintentar» reclama la MISMA fila (`failed -> pending`): doble clic = un envío. Un fallido no cuenta como respuesta para el agente.
- **CSS**: el tema lo maneja la clase `.dark` del `<html>`, no `prefers-color-scheme` (el `dark:` de Tailwind sigue a esa clase). `min-width` le gana a `max-width`. La flecha de todos los `<select>` sale de `app/globals.css`; uno que dibuja la suya lleva `select-bare`. Las fechas del sistema abren el calendario con un clic en cualquier parte del campo (un único escuchador en `app/layout.tsx`).

## Banca de recursos

- Seis tipos en UNA tabla (`response_assets`): texto, audio, video, imagen, archivo y enlace. El atajo es único entre todos los tipos. Qué exige cada tipo lo dice `lib/response-assets/shape.ts` (`KIND_SHAPE`), igual que los CHECK de la base.
- **Todo lo que tiene archivo pasa por `copyAssetToChat` antes de mandarse**, por cualquier camino: nunca se manda el path de `library/` (el barrido de retención se llevaría el recurso).
- **Un solo widget** (`components/inbox/asset-picker.tsx`) para "/", el botón y ⌘/Ctrl + /. Enter nunca manda: inserta un texto o abre el preview.
- Administrar es `templates.manage`; usar los recursos, cualquier miembro. El contador lo escribe solo `touch_response_asset`, después de mandar, y nunca frena un envío.
- **Un solo camino de envío desde automatizaciones** (`deliverAsset`, `lib/response-assets/deliver.ts`); las variables de un texto (`{{contact.*}}`, `{{workspace.name}}`) se resuelven al enviar.
- El agente usa `listar_recursos` / `usar_recurso`: con un texto devuelve el contenido interpolado para que lo use como su respuesta (no manda un mensaje aparte); un audio o video con voz necesita la transcripción lista.

## Automatizaciones, secuencias y broadcasts

- **El motor no se toca para sumar cosas**: un disparador o un paso nuevo entra por el registro (`lib/flow-engine/registry/`). Cada disparador declara su `subject` y su `sourceType`; cada paso, si necesita contacto (`needsContact`) y qué conexión requiere (`requires`). `registry/consistency.test.ts` lo exige.
- **Tres catálogos, una lista cada uno**: disparadores (`trigger-catalog.ts`, comparado con el registro y el CHECK de `triggers.type`), sus valores por defecto (`trigger-defaults.ts`) y las variables por disparador (`variable-catalog.ts`).
- **Una automatización publicada guarda en `draft_nodes`/`draft_edges`**: lo que corre es `nodes` hasta «Publicar cambios». Un solo disparador, elegido (`triggerType: null` = sin elegir); publicar lo exige (`lib/flow-engine/publish-rules.ts`).
- **Una acción sin su conexión se ve bloqueada, no oculta, y no se puede publicar** (`connectionProblemsForGraph`). Un flujo ya publicado al que se le desconecta algo no se despublica: se avisa.
- **Arrancar un flujo NO retoma una sesión en espera**: solo el receptor de mensajes retoma «Esperar respuesta».
- **Toda sesión y todo evento lleva su origen** (`source_type`, `source_id`). Un evento de automatización nunca tumba lo que lo emite, y lleva solo escalares (nunca `booking_id` suelto: el cron lo trataría como una reserva).
- **Condiciones** (`branch`): los caminos son handles `handle:<id>` y `handle:else` («Si no», siempre el último); el id del camino no cambia aunque se renombre. Va por el primer camino que se cumple; un campo que no se puede leer es "no se cumple", nunca un error. **Un solo evaluador**: `lib/flow-engine/condition-eval.ts`. El `condition` viejo no se toca. `branch_taken` no guarda valores.
- **Árbol ↔ grafo** (`lib/automations/step-tree.ts`): ida y vuelta exacta; lo que no es árbol devuelve `null` y se edita solo en el lienzo.
- **«Enviar WhatsApp a un número»** no necesita contacto ni crea ninguno; «no contactar» frena; nunca manda dos veces lo mismo (`flow_send_claims`).
- **Llamada HTTP solo por `lib/net/safe-fetch.ts`** (sin direcciones internas, 10 s, 256 KB).
- **Adjuntos del email = recursos de la banca** (hasta 10 y 25 MB); uno que falta no frena el email.
- «Agregar/Quitar etiqueta» decide por el tipo del paso, nunca por `data.action`.
- Categorías en `flows.categories` (hasta 10, `lib/flows/categories.ts`); la lista filtra por URL.
- `flows` no tiene `deleted_at`: una consulta que lo filtre falla.

## Agentes IA

- **Un solo lugar agenda un turno del agente**: `maybeScheduleAgentTurn` (`lib/agent/dispatch.ts`), después de guardar el mensaje y de las automatizaciones (la automatización tiene prioridad). El turno corre en `/api/cron/agent-bursts`. La segunda puerta es «Sugerir respuesta» (`lib/agent/drafts/suggest.ts`): siempre deja un BORRADOR, nunca envía.
- **Toda llamada a IA pasa por `openAiRun`** (`lib/ai/run.ts`), que registra la corrida y congela el costo.
- **Nunca `select("*")` sobre `agents` o `agent_runs` con el cliente de un usuario** (privilegio de columna en los costos): usar `lib/agent/public.ts`. Toda columna nueva de `agents` que lea la pantalla va a su GRANT.
- **El interruptor por conversación tiene tres estados** (`agent_enabled` NULL = heredar del canal); el estado efectivo se calcula solo en `resolveAgentState`.
- **Una sola regla de disponibilidad** (`lib/agent/availability.ts`): interruptor + modelo + IAs conectadas. Desconectar una IA no apaga ni borra ningún agente: queda `blocked`, no se agendan turnos que fallarían y Owner/Admin reciben un aviso.
- **El agente entiende, o se calla**: la compuerta vive al inicio de `continueTurn` en `lib/agent/runner.ts`, antes de los guardarraíles. Responde, reagenda (hasta 90 s esperando una transcripción) o escala a una persona (`needs_human`). Ante la duda, escala. El historial usa `effectiveMessageText` envuelto en `wrapUntrusted`.
- **Las acciones del agente** pasan por `lib/agent/tools/effects.ts` y quedan en `audit_log` con `performed_by_agent_id`; la pestaña Acciones y la reversión se arman sobre eso.
- **No responder**: solo si la tanda pasa `canSkipReply` (`lib/agent/no-reply.ts`); la herramienta es `no_hace_falta_responder`.
- **El agente solo mueve el estado de SETTER** (`cambiar_estado_setter`, apagada por defecto, lista blanca). `programar_seguimiento` escribe `contacts.next_followup_date`.
- **Lo que escribe una persona como pedido** viaja como dato en el mensaje del usuario, nunca en el system prompt.
- **Tareas de IA**: el catálogo único es `lib/ai-tasks/catalog.ts`; todas tienen las mismas cinco pestañas (`lib/ai-tasks/tabs.ts`). Solo se versiona la parte EDITABLE de sus instrucciones (`ai_task_prompt_versions`); sin versión activa, la tarea usa el texto del sistema, y un error al leer la versión nunca frena la tarea. Catálogo, `DEFAULT_TEXT` y el CHECK de `ai_task_prompt_versions.task` listan las mismas tareas (`store.test.ts`).
- **Sin ninguna IA conectada y sin uso previo, Agentes IA es solo el empty state**. Los agentes nacen configurados con `ensure_default_agents` (idempotente): crea el agente de chat apagado si nunca hubo uno, completa el modelo donde falta y nunca pisa algo elegido ni prende nada.
- **Topes de gasto de IA** (`lib/ai/spend.ts`): cada tope elige cortar o solo avisar, con aviso previo al X %.
- **Base de conocimiento**: un documento subido sin Voyage queda `pending` (no `error`) y se retoma al conectar Voyage o con «Indexar pendientes». La columna de embeddings es `extensions.vector(1024)`: cambiar de modelo o dimensión obliga a reindexar todo.
- **Un borrador vencido es `expired`**, no `discarded`.

## Agenda

- **Los horarios salen de una sola función** (`getPublicSlots`): la página pública, el agendar a mano y el agente la llaman.
- **El servidor nunca confía en el horario del cliente**: antes de crear, vuelve a preguntar a Google sin cache.
- **La doble reserva la evita la base** (restricción de exclusión por anfitrión y rango). `verify-booking-concurrency.mjs` lo prueba con diez pedidos a la vez.
- **UTC en la base; la disponibilidad es hora de pared + zona IANA** ("martes de 9 a 17 en Costa Rica" sigue siendo de 9 a 17 con el cambio de horario).
- **Cancelar es definitivo.** La categoría queda congelada en cada reunión (`category_snapshot`).
- **El código público de una reunión (22 caracteres) es una credencial**: con él se cancela sin sesión. Nunca se le pasa al agente.
- **Un evento se activa sin calendario** ("solo en el sistema"); solo Google Meet lo exige. Una conexión ROTA corta los horarios.
- **Google Calendar es por persona**: el token se renueva a demanda y un `invalid_grant` avisa a esa persona. La invitación la manda Google (`sendUpdates=all`). Los reintentos los agenda el handler (1, 5 y 15 minutos), NO la cola.
- **Una reunión la ve también el setter de su contacto** (`can_see_booking`).
- **Automatizaciones de la agenda**: disparadores por evento y relativos a la hora de la reunión; los relativos se AGENDAN (`syncRelativeJobs`) con una clave que lleva el número de reagendas. `flow_sessions.channel_id` admite null (quien agenda desde la página pública no tiene conversación).
- **Las cuatro áreas de sistema de la agenda vienen precargadas**: se renombran pero no se archivan, y `SYSTEM_AREAS` y el SQL dicen lo mismo.
- **El embed** (`public/embed/embed.js`) **se commitea** (en Railway el build no tiene esbuild) y no pasa de 60 KB. Se regenera con `npm run build:embed` cuando se toca `lib/attribution/` o `lib/embed/`.
- Los endpoints públicos tienen tope por IP; la IP nunca se guarda en texto (SHA-256 con `RATE_LIMIT_SALT`).

## Contenido, publicación y Social

- Ideas → piezas → publicaciones por red. Una pieza puede tener variante por red y **una fecha por red**. Las reglas puras viven en `lib/content/*.ts`.
- **Publicar pasa por `lib/publishing/dispatcher.ts`**, el único lugar donde una fila de `social_posts` pasa a publicada. La guarda contra publicar dos veces es `UPDATE ... WHERE status='scheduled' RETURNING`. Los reintentos los agenda el despachador (1, 5 y 15 minutos), NO la cola.
- **Instagram y TikTok se programan del lado de Zernio** (`scheduledFor` + `timezone`, un post por red). Desprogramar borra el post ALLÁ antes de cancelar acá. El despachador propio queda para YouTube, LinkedIn y Threads.
- **El SDK de Zernio LANZA** en vez de devolver `{ error }` y expone `.statusCode`; los errores se clasifican en `lib/publishing/zernio-errors.ts`. `lib/publishing/zernio.test.ts` fija el body exacto que recibe Zernio: sus aserciones no se tocan.
- **No usar `upsert` sobre `social_posts`**: su índice único es parcial. Es buscar-y-escribir.
- **Una red sin cuenta conectada nunca está "Programada"** ("conectada" = cuenta activa CON publicador usable, `lib/content/connection.ts`). **Marcar como publicado crea una fila real** (`origin = 'manual'`) que la sincronización adopta después por link o fecha única (`lib/metrics/adopt-manual.ts`).
- **`networks[].format` es el único campo de formato.** El estado de la pieza se deriva de TODAS sus redes (`derivePieceStatus`).
- **Una versión es por sesión de edición** (10 minutos); cambiar estado, aprobar, generar con IA y restaurar cortan la sesión.
- **Una pieza se edita en cualquier estado**; un Member no mueve el ESTADO fuera de Borrador / En producción / En revisión. Lo agendado en Zernio se reenvía al guardar (`lib/publishing/content-resync.ts`).
- **Responsable de la pieza** (`content_posts.assigned_to`): por defecto quien la crea (trigger). Reasigna un administrador o quien la creó.
- **Pilares no se borran, se archivan.** Los drawers viven en la URL (`?idea=`, `?piece=`).
- La atribución y la sincronización de cuentas NUNCA tumban nada (`recordTouch`, `lib/social/sync-hook.ts`). Sin clave de Zernio, sus cuentas quedan "no disponibles" (una falla de Vault al leer no cuenta como desconectado: `getZernioKeyState`).
- `LINKEDIN_API_VERSION` vence a los ~12 meses: revisarla una vez por año.

## Métricas y dashboards

- **Un metric que la red no dio queda en `null` y no se escribe.** Un cero se lee como "ese día no pasó nada", que es otra afirmación. Lo que no existe se muestra «—», nunca 0.
- Los seguidores no se suman (la semana es el ÚLTIMO día). El alcance único de un período se pide en vivo con cache de 15 minutos (`lib/meta/live.ts`).
- Frecuencia de recolección por antigüedad del post: diaria hasta 30 días, semanal hasta 90, nunca después.
- **Medir una pieza**: se compara por edad, nunca por fecha de calendario. El índice (`lib/dashboards/piece-index.ts`) es el engagement a 7 días contra la mediana de la misma red y formato de los 90 días anteriores, con mínimo 3 comparables. El total de leads de una pieza no es la suma de sus filas (una persona cuenta una vez).
- El dashboard de contenido agrupa y filtra por URL; **nada se pierde**: lo sin valor va a "Sin asignar" y la suma de las filas es el total.
- **Dashboard de Chat**: la sección "El agente" existe solo si el agente actuó alguna vez o hay uno encendido con canales.
- **Dashboard de Agenda**: cuentas puras en `lib/dashboards/agenda.ts`, lee con el cliente del usuario (la RLS decide qué ve cada quien).
- Cada dashboard pide su permiso (`dashboards.*.view`), no el cargo.

## Atribución y anuncios

- **`contacts.attribution` es una copia derivada** de `contact_touches` (la recalcula la base). `readAttribution` devuelve siempre la forma canónica.
- **La atribución nunca tumba nada**: `recordTouch`, los triggers de `contact_touches` (canal, código de pieza, vínculo con Meta) y el sync del catálogo van en `try/catch` o `EXCEPTION WHEN OTHERS`. El toque de un mensaje va DESPUÉS de guardarlo.
- **Funciones protegidas** (no se reescriben sin una razón fuerte y la definición vieja en la cabecera): `record_contact_touch`, `find_or_link_contact`, `find_or_create_contact`, `create_booking`, `resolve_meta_match`. `scripts/protected-functions.mjs` guarda sus huellas.
- **Las claves de atribución están en UN lugar**: `lib/attribution/keys.ts`. `entry_url` (la dirección completa de entrada, sin parámetros sensibles, tope 2000) se arma en `lib/attribution/entry-url.ts` y **nunca se loguea**.
- **El canal de un toque** (`organic|paid|referral|direct`) lo calcula un trigger con `touch_channel`, gemela de `lib/attribution/channel.ts` (`channel.cases.json`). `fbclid` solo no alcanza para pauta.
- **Instagram no crea contactos por comentar (apagado por defecto); TikTok sí, anónimos** (Ajustes → General → Atribución). Solo cuenta como lead por comentario el contacto cuyo PRIMER toque fue ese comentario.
- **Links medidos**: `/l/[token]` es público; el destino sale SOLO del token firmado (HMAC, secreto en Vault, vence a 180 días), un token alterado cae a la app sin error, nunca 500. Con la opción apagada, el mensaje es idéntico al de siempre.
- **`content_posts.attribution_code`** en el `utm_content` vincula el toque a la pieza.
- **Vínculo toque ↔ anuncio de Meta**: `resolve_meta_match` (SQL) y `resolveMetaMatch` (TS) son gemelas (`meta-match.cases.json`). En un comentario o DM orgánico, `content_label` es el título de la publicación, no un dato de anuncio. **El vínculo automático nunca pisa un `manual` ni un `ignored`**; vincular a mano va por `set_touch_meta_match` (atómica) desde `lib/actions/meta-match.ts` y queda en `audit_log`.
- **El catálogo de Meta nunca se borra**; su sync es independiente del de métricas. Un tope de páginas se anota en `integration_configs.config.ad_accounts[].last_error`, no en silencio.
- **Leads de Meta: un solo evento canónico por nombre** (`lib/meta/action-counts.ts`); sumar variantes infla el número.
- **Tabla Meta vs CRM** (`ads_crm_metrics_v2`, `ads_crm_items`, SECURITY INVOKER: la RLS de quien mira decide). Leads nuevos ≠ leads totales; el Total cuenta personas DISTINTAS; la lista que abre un número sale de la misma consulta. Las columnas son un catálogo (`lib/dashboards/ads-crm-columns.ts`); las preferencias en `localStorage` siempre en `try/catch`.
- El anuncio de origen de un DM de Instagram se recupera de Zernio UNA vez (job con reintentos a 1, 5 y 15 minutos), sin bloquear el webhook.

## Catálogo de productos

- Productos y variantes (Ajustes → Productos, `products.manage`). **El precio vive en la variante** (`product_variants.price`, USD, en céntimos). La plata siempre en céntimos enteros.
- Tipos: Programa, Mentoría / Consultoría / Asesoría, Curso, Evento, Servicio y Producto. Lo que pide cada variante sale de `variantTiming`: duración sin fecha, evento con `event_date` fija + duración, producto sin duración. Lo valida el SERVIDOR.
- **El historial del catálogo lo escribe la BASE** (trigger), venga el cambio de donde venga: las acciones NO llaman a `logAudit` (duplicaría cada fila).

# Seguridad

## Autenticación y sesiones
- Supabase Auth con email/password. Sesiones por Supabase SSR con cookies httpOnly.
- Sin registro público (`enable_signup = false`): las cuentas nacen por invitación o con `create-owner.mjs`.
- Recuperación de contraseña con token de tiempo limitado. Las URLs de Auth (Site URL y Redirect URLs) apuntan al dominio de la app.

## Row Level Security (RLS) — obligatorio
- TODAS las tablas tienen RLS. Aislamiento por `workspace_id` (`is_workspace_member`) y alcance de leads con funciones reutilizables (`can_see_contact`, `can_see_conversation`, `can_see_booking`...), que devuelven siempre true o false, nunca NULL (un NULL deja pasar un `NOT (...)`).
- Políticas explícitas para SELECT, INSERT, UPDATE y DELETE. El alcance se evalúa en la base, no solo en la UI.
- **`audit_log_select` no se reescribe**: el acceso al historial de un módulo nuevo es una política ADICIONAL `audit_log_select_<modulo>`. `verify-audit-visibility.mjs` compara la visibilidad antes y después.
- Una tabla que escribe solo el servidor no tiene políticas de escritura: las acciones escriben con el cliente de servicio DESPUÉS de chequear el permiso y sacando el workspace de la sesión.

## Validación y datos sensibles
- Validación en cliente Y en servidor. Sanitizar entradas (XSS, inyección SQL).
- Claves de terceros en Supabase Vault, nunca en variables del frontend ni en el código. Service Role Key solo en el servidor.
- Logs sin tokens, contraseñas, claves ni datos personales.
- `.env` nunca se commitea.
- **En un archivo `"use server"` todo lo exportado es una función asincrónica.** Un `export type { ... }` rompe la app entera en tiempo de ejecución y ni el typecheck ni el build lo ven (`lib/vault-boundary.test.ts` lo atrapa). Los tipos van en otro archivo.
- **Los jobs no lanzan por el fallo de un proveedor** (IA, Zernio, Google, Voyage): la cola reintentaría a los 10 s encima de la espera propia. Reagendan (1, 5 y 15 minutos) o dejan un estado que una persona ve.

## Cron
- Los cron corren con `pg_cron` dentro de Supabase y llaman a `/api/cron/*` con `private.call_app_cron`, que lee `app_url` y `cron_secret` de Vault. El secreto viaja SOLO en `Authorization: Bearer <CRON_SECRET>`.
- No hay Edge Functions: toda la lógica corre en la app y en la base.

## Checklist de seguridad (en cada cambio)
- [ ] RLS habilitado y políticas escritas en toda tabla nueva (incluido el alcance de leads)
- [ ] `GRANT` declarados en la migración
- [ ] Sesión verificada en toda API Route nueva; permiso chequeado en página, acción y tabla
- [ ] Validación de entradas en el servidor
- [ ] Secretos en Vault, no en el código
- [ ] Logs sin datos sensibles
- [ ] Webhooks con firma o token validado e idempotencia

# Estructura del proyecto

```
app/
├── (auth)/              # Login
├── (dashboard)/         # La app: bandeja, contactos, automatizaciones, agentes, agenda, contenido, ajustes
├── invite/              # Aceptar una invitación (y crear la cuenta, si hace falta)
├── calendario/          # Páginas públicas de la agenda (sin sesión)
├── l/                   # Links medidos (atribución)
└── api/
    ├── webhooks/        # Receptores: Zernio (Instagram), Evolution (WhatsApp), Resend (email)
    ├── cron/            # Lo que llama pg_cron
    └── v1/              # API interna
components/              # Por módulo: inbox, contacts, flow-builder, agents, scheduling, content, settings...
lib/
├── supabase/            # Clientes server / browser / middleware
├── auth/                # Catálogo de permisos y guards
├── flow-engine/         # Motor de flujos, nodos y registro
├── agent/               # Agente de IA: runner, herramientas, guardarraíles
├── ai-tasks/            # Catálogo de tareas de IA
├── actions/             # Server Actions
├── brand.ts             # Marca (white label)
└── workspace.ts         # El workspace activo
scripts/                 # create-owner, create-workspace, verify-*
supabase/
├── migrations/          # La base, un archivo por área (00000 a 00016) y lo que sumes desde la 00017
└── seeds/               # Precios de los modelos de IA
```

## Cómo sumar un permiso nuevo

1. La clave en el catálogo (`lib/auth/permissions.ts`), con su etiqueta y descripción.
2. Si el Member de sistema la tiene: en `MEMBER_PERMISSION_KEYS` Y en `private.member_permission_keys()` (migración nueva).
3. El guard en la página (`requirePermission`) y en la acción (`getPermissionAction`).
4. La política de la tabla con `has_permission(workspace_id, 'la.clave')` (migración nueva).
5. `npx vitest run` (los tests de catálogo, paridad y matriz de acceso) y `node scripts/verify-permissions-matrix.mjs`.

# Buenas prácticas de desarrollo

## Estructura de código
- Seguir la estructura existente. No inventar carpetas si ya hay una que sirve.
- Lógica de negocio en Server Actions o `lib/`, no en componentes de UI. Un archivo por responsabilidad.
- Cuando una regla vive en SQL y en TypeScript, son gemelas con un archivo de casos compartido (`*.cases.json`) que corre contra las dos. Si cambia una, cambia la otra y se suma el caso.

## Manejo de errores
- Siempre manejar errores. Nunca un `catch` vacío.
- Mensajes claros al usuario (toast con la acción sugerida). Loguear en el servidor sin datos sensibles.
- Reintentos automáticos para operaciones de red (máximo 3, con espera creciente).

## Performance
- Server Components por defecto; Client Components solo donde hace falta interactividad.
- Paginación en todas las listas. Índices en las columnas de filtro, orden y búsqueda.
- Las pestañas de un detalle no esperan los datos: el armazón responde enseguida y el contenido va en `<Suspense>`.

## Testing y accesibilidad
- Tests para la lógica crítica, sin depender de servicios externos.
- **Los tests no pueden hacer `fetch` real**: `vitest.setup.ts` lo bloquea y dice cuál era la URL. Un test que lo necesita lo simula con `vi.stubGlobal("fetch", ...)`.
- Un test de caracterización fija el comportamiento de antes de un cambio: sus aserciones no se tocan para que pase.
- Labels en los inputs, contraste WCAG AA, navegación por teclado, `alt` en las imágenes.

## Dependencias
- Fijar la versión al instalar algo nuevo (`npm i paquete@x.y.z`) y no subir de versión mayor sin leer qué cambia.

# Diseño para el futuro

- **El modelo de datos se piensa para lo que viene**: si un campo va a hacer falta, se agrega aunque quede vacío por ahora (por ejemplo `ai_conversation_summary`, `next_followup_date`).
- **El flow builder tiene registro de disparadores y pasos**: un módulo nuevo suma los suyos sin tocar el motor.
- **El agente usa un registro de herramientas**: una herramienta nueva es una entrada, con su efecto en `lib/agent/tools/effects.ts`.
- **`channels` abstrae cómo se conectó cada canal** (Zernio, Evolution, email), así la bandeja no depende de eso.
- **`integration_configs` es genérica**: sumar un proveedor es un registro en el catálogo, no una tabla nueva.
- **Las tareas de IA se suman en el catálogo** (`lib/ai-tasks/catalog.ts`), no con una pantalla nueva.

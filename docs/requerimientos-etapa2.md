# Requerimientos: Etapa 2 completa (Integraciones, Publicación, Contenido, Métricas, Email y Roles)

**Proyecto:** SSA Business AI OS
**Paso del Método Builder:** 05-Requerimientos (brownfield, construcción autónoma)
**Versión:** 2.0, 26 de septiembre de 2026. **Reemplaza** a `requerimientos-etapa2.md` v1.0 y a su addendum v1.3: este es el único documento de la etapa.
**Anclado a:** `alcance-v4.md` (Etapa 2), `investigacion-etapa2.md` y el prototipo `docs/referencia/prototipo/dashboards-de-chat.html`
**Para:** Claude Code, corrida autónoma (one-shot) de las 3 fases de la Etapa 2

---

## 0. Cómo usar este documento

Este es el plano de **toda la Etapa 2**: 3 fases, 9 bloques y 72 funcionalidades (F1 a F72). Está escrito para que Claude Code lo construya de corrido, bloque por bloque y en orden, sabiendo solo cuándo termina cada bloque. El apéndice A dice qué cambió respecto de la v1.0, por si hace falta comparar.

**Requisitos previos (no arrancar sin esto):**
1. `main` está actualizado con `origin/main`. Al 26/9 es `3706c23`: tiene la Fase 3 completa (PR #3) y el rediseño del menú lateral (PR #4). `git status` está limpio.
2. Hay un backup del día de la base de Supabase.
3. El plano se guarda sin cambios en `docs/requerimientos-etapa2.md`.
4. Se trabaja en la rama `etapa2` creada desde `main`. Nada en `main` hasta el cierre.

**Reglas de la corrida** (se suman a las del `CLAUDE.md`):
- Toda API externa (Zernio, Postproxy, Google, LinkedIn, Threads, Meta, Resend y **los proveedores de IA**) va **simulada** en los tests. No se llama a ningún proveedor real durante la construcción.
- Las migraciones se aplican a la base como en las fases anteriores, **pero solo las aditivas**: crear tablas, agregar columnas, agregar valores permitidos a un CHECK, backfills que no pisan datos. Lo que borra o modifica datos existentes se escribe como archivo de migración **y no se aplica**: se anota en `docs/PENDIENTE.md` (ver §9.10).
- No se cambia ninguna configuración real: no se conectan cuentas, no se registran webhooks en proveedores, no se publica nada, no se tocan canales ni el agente.
- **Todo es por workspace** (§16.1): cada tabla nueva lleva `workspace_id` y RLS, y `verify-rls.mjs` prueba la lectura cruzada entre dos workspaces en cada tabla y bucket nuevos.
- Después de cada funcionalidad: `npx vitest run`. Después de cada bloque: marcar `docs/PROGRESS.md`, hacer commit `feat: etapa 2 - bloque N (nombre)` y `git push origin etapa2`.
- Si algo queda trabado después de un intento serio: anotarlo en `docs/PENDIENTE.md` con qué quedó, por qué y qué se decidió en su lugar, y seguir.
- La lógica de cada pantalla (qué se muestra según estado, cálculos, formatos, permisos) va en **funciones puras** testeables con Vitest. Los componentes solo las componen. No se suman dependencias de testing.
- Al cerrar cada bloque con pantallas: levantar la app y recorrer las pantallas nuevas con el navegador de Claude Code en 1440 y 390 px, **comparándolas con el prototipo** (sin scroll horizontal, estados vacío y error visibles). Si no hay sesión iniciada, anotarlo en `docs/PENDIENTE.md` (Claude Code no ingresa credenciales).

---

## 1. Mapa de ruta

| Etapa | Estado | Qué tiene |
|---|---|---|
| Etapa 1: Sistema Operativo Base | Construida (Fase 3 mergeada) | CRM, bandeja Instagram + WhatsApp, flows, secuencias, base de conocimiento, agente IA, dashboards de chat, patrones de mensajes, tareas en segundo plano |
| **Etapa 2: Integraciones, Publicación y Métricas** | **Este documento** | Integraciones rediseñadas, pipeline de contenido (ideas, guion y caption con IA, versiones), publicación en 5 redes, página Social, métricas de contenido con análisis por post, réplica de Meta Ads, comentarios, email como canal, roles personalizados |
| Etapa 3: Agentes | Futuro (`diseno-etapa3-agentes.md`) | Agentes con conversaciones propias, agente general que llama a especialistas, agente de redacción y generador de piezas (reemplaza la generación simple de copy de esta etapa) |
| Etapa 4: Agendamiento + Ventas | Futuro | Google Calendar, ventas y pagos |
| Extras A a I | Futuro | Tareas, Gmail, forms, browser automation, video, etc. |

**Lo que NO se construye ahora pero el diseño contempla:**
- Los agentes de la Etapa 3 van a crear ideas, escribir guiones, publicar y leer métricas. Por eso los publicadores, los lectores de métricas y la generación de copy se escriben como módulos con una interfaz común, reutilizables como herramientas, y `content_ideas.source` / `content_posts.source` admiten `agent`.
- Google Calendar por usuario (Etapa 4): `oauth_connections.user_id` admite una conexión por persona.
- Atribución contenido → leads: cada publicación guarda el ID del post en la red.
- Integraciones futuras (Apify, Tavily, Fathom, Cloudflare Browser Run, Composio): el catálogo las suma como entradas nuevas, sin tocar la pantalla.

---

## 2. Objetivo y mapa de bloques

**Objetivo:** que el negocio conecte todas sus herramientas desde una sola pantalla con los secretos en Vault; lleve su contenido de la idea a la publicación (con guion y caption generados con IA, versiones, fecha por red y palabras clave de automatización); publique en Instagram, TikTok, YouTube, LinkedIn y Threads; vea sus perfiles, el rendimiento de cada post y de sus anuncios; reciba email como un canal más de la bandeja, y defina roles con permisos a medida. Todo separado por workspace.

**Por qué en este orden:** la pantalla de integraciones y las conexiones son la base de todo (Fase 1). Las métricas reutilizan esas conexiones y el patrón de crons (Fase 2). Email y roles son independientes y tocan zonas sensibles de lo existente (bandeja, RLS), por eso van al final, con todo lo demás ya estable (Fase 3).

| Fase | Bloque | Qué se construye | Contexto compartido | Funcionalidades |
|---|---|---|---|---|
| 1 | **B1** Integraciones, Vault y barra superior | Catálogo extendido, grid, modal, secretos a Vault, barra superior en todas las pantallas | `integration_configs`, Vault, `lib/integrations/*`, `PageHeader` | F1 a F7 |
| 1 | **B2** Conexiones de redes | OAuth (Google, LinkedIn, Threads) con `state` firmado, Postproxy, cuentas de Zernio, cuentas sociales, avisos | `oauth_connections`, `social_accounts`, `/api/oauth/*` | F8 a F15 |
| 1 | **B3** Modelo de contenido y pipeline | Ideas, posts, versiones, publicaciones por red, media, kanban de 7 columnas, calendario por pieza, lista | `content_ideas`, `content_posts`, `content_post_versions`, `social_posts`, bucket `content-media` | F16 a F23 |
| 1 | **B4** Editor, IA y publicación | Editor en una página, fecha por red, validación, palabras clave, variantes y redistribución, copy con IA, publicadores, dispatcher, detalle, aprobación | `social_posts`, `scheduled_jobs`, publicadores, webhooks | F24 a F39 |
| 2 | **B5** Recolección de métricas y comentarios | Meta, lectores, reglas de recolección, engagement a 7 días, comentarios, cron | `social_posts`, `social_post_metrics_daily`, `social_account_metrics_daily`, `social_post_comments` | F40 a F47 |
| 2 | **B6** Dashboard orgánico y página Social | Dashboard de ScaleOS + agrupación, explorador de doble eje, análisis por post, seguidores alrededor del post, Social | Tablas de métricas, `/dashboard/dashboards/content`, `/dashboard/social` | F48 a F54 |
| 2 | **B7** Meta Ads y unificado | Réplica de ScaleOS corregida (cuenta, campaña, ad set, anuncio), datos híbridos, unificado, IA | `meta_ads_insights_daily`, `integration_configs` (meta) | F55 a F61 |
| 3 | **B8** Email como canal | Resend Receiving, conversaciones, respuesta, adjuntos | `channels`, `conversations`, `messages`, `/api/webhooks/resend-inbound` | F62 a F67 |
| 3 | **B9** Roles personalizados | Catálogo de permisos, roles, guards, RLS por permiso | `workspace_roles`, `workspace_members`, `can_see_*`, `lib/auth/*` | F68 a F72 |

---

## 3. Estado actual del sistema (as-is)

Verificado en el código de `main` (`3706c23`, 26/09/2026) y en la base. **Claude Code confirma cada punto en la exploración** y, si algo no coincide, lo informa en el plan.

### 3.1 Stack y patrones (no cambian)
- Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind 4 + Zod 4 + Vercel AI SDK v6 + `@supabase/ssr` 0.8 + `@zernio/node` 0.2.x. Tests: Vitest 3 (entorno node), unos 110 archivos. Scripts de verificación contra la base: `scripts/verify-*.mjs` (crean un workspace de prueba y lo limpian), incluido `verify-dashboards.mjs` de la Fase 3.
- Server Components por defecto; mutaciones en Server Actions (`lib/actions/*`); webhooks en `app/api/webhooks/*`; crons en `app/api/cron/*` disparados por `pg_cron` vía `private.call_app_cron('<nombre>')`, que tiene **lista blanca de rutas** (redefinida en 00063 y 00077): cada cron nuevo redefine la función con la lista ampliada.
- Cola de trabajos: `lib/scheduler.ts` solo **encola** en `scheduled_jobs`. El despacho es un `switch (job.type)` en `app/api/cron/jobs/route.ts` (`index_document`, `conversation_close`, `resume_flow`, `send_broadcast`; `agent_burst` va aparte por `/api/cron/agent-bursts`; la Fase 3 sumó `bg_task`, encolado por `bg-dispatch`, **todavía sin handler**). Hoy un tipo desconocido hace `console.warn` y el job queda `completed`.
- Auditoría: `lib/audit.ts` → `audit_log` inmutable. Notificaciones: `lib/notifications/*`, con `createNotificationOnce` (dedup por tipo + entidad, ventana de 60 min).
- `lib/types/database.ts` se edita a mano (no hay generador).
- **Migraciones:** la última en el repo y en la base es `00080_background_tasks` (la base tiene además `00078_chat_dashboard_trends`, `00079b` y `00079c`). **La Etapa 2 empieza en `00081`.** Todas las funciones SQL nuevas llevan `SET search_path = ''`.

### 3.2 Integraciones y secretos hoy
- `integration_configs` (00020): `workspace_id, type, provider, config jsonb, is_active, connected_at, last_error, vault_secret_name`. CHECK de `type`: `channel`, `ai_provider`, `email_provider`. Único por `(workspace_id, type, provider)`.
- Vault (`lib/vault.ts`): secretos con nombre `ws:<workspace>:<nombre>`; helpers `storeSecret`, `readSecret`, `deleteSecret`, `listSecretNames`, solo en el servidor. `SECRET_NAMES`: `zernio_api_key`, `evolution_api_key` (definido, no usado), `resend_api_key`, `openai_api_key`, `anthropic_api_key`, `google_ai_api_key`, `voyage_api_key`.
- Catálogo `lib/integrations/providers.ts`: Resend, OpenAI, Anthropic, Google IA, Voyage. Solo sabe manejar API keys.
- Pantalla `/dashboard/settings/integrations` (`components/settings/integrations-view.tsx`): una columna, inputs a la vista. La card de Zernio llama `fetch("/api/v1/channels/test-key")`. Después del PR #4, Integraciones ya no está en el menú lateral: se entra desde Settings.
- **Secretos fuera de Vault (a migrar):** Evolution en variables de entorno de Railway (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_PREFIX`, `EVOLUTION_WEBHOOK_TOKEN`); secreto del webhook de Zernio en `workspaces.webhook_secret` y `channels.webhook_secret`; clave vieja de Zernio en `workspaces.late_api_key_encrypted` (fallback de `getZernioApiKey`, y la leen directo `scripts/backfill-zernio-messages.mjs` y `scripts/enrich-instagram-contacts.mjs`).

### 3.3 Canales, bandeja y mensajes hoy
- `channels`: `platform` CHECK (`facebook, instagram, twitter, telegram, bluesky, reddit, whatsapp`), `provider` CHECK (`zernio, evolution`), `late_account_id NOT NULL` con `unique(workspace_id, late_account_id)` (Evolution guarda `'evolution:<instancia>'`), `connection_status`, `evolution_instance`, `webhook_secret`.
- `conversations`: única por `(channel_id, contact_id)`; `messages` guarda entrantes y salientes con `origin`, `attachments jsonb`, ids de plataforma.
- El envío es binario: `if (provider === "evolution") … else Zernio` en `lib/flow-engine/send.ts` y `app/api/v1/messages/route.ts`. Entrada común en `lib/inbound.ts` (`claimWebhookEvent`, `upsertConversation`, `insertMessage`, `persistInboundMessage`, `applyOptOut`, `runInboundAutomation`); dedup de contactos en `lib/inbox-sync.ts` (`upsertContactForSender` → `find_or_link_contact`).
- **Automatizaciones por palabra clave (del fork de ZernFlow):** disparadores `keyword` (DM, filtro `storyReply`) y `comment_keyword` (comentario; `config.keywords [{ value, matchType exact|contains|startsWith }]`, `postIds` opcional, `replyText`), procesados por `processComment` (`lib/comment-processor.ts`). El receptor `app/api/webhooks/late` pasa `postId || platformPostId`. Hoy los `postIds` se cargan a mano en Growth (texto separado por comas). El receptor de `comment.received` **solo busca la cuenta en `channels`** (por eso rechaza TikTok) y saltea los comentarios propios; `comment_logs` es el log de estas automatizaciones.

### 3.4 Roles hoy
- `workspace_members.role` CHECK (`owner, admin, member`). Helpers en `lib/auth/roles.ts`; guards en `lib/auth/guards.ts`: `requireWorkspaceAdmin` (lo usan 7 páginas) y `getAdminContext()` (unas 40 Server Actions; devuelve null, sin redirect).
- Scope de leads por RLS: `can_see_contact` / `can_see_conversation` (00024/00028), `workspaces.lead_scope_enabled = true`.
- Menú en `lib/nav/items.ts` (con test), extraído en la Fase 3; el PR #4 movió Broadcasts, Sequences y Growth adentro de Inbox, sacó Integraciones del menú y bajó notificaciones y perfil al pie.
- **Lo que hoy puede un Member** (a fijar con el test de caracterización de F68): sequences y agents solo lectura; Conocimiento sin acceso de UI (la RLS le deja leer para el agente); no borra contactos ni saca "no contactar"; importa contactos; flows y broadcasts completos; templates solo lista; Channels es de admin.

### 3.5 Dashboards y barra superior hoy (Fase 3)
- `/dashboard/dashboards/chat` con filtros en la URL (`lib/dashboards/url-state.ts`: `range`, `from`, `to`, `channel`, `author`) y selector de período (`lib/dashboards/period.ts`, 11 atajos). **No hay selector de dashboards**: una etiqueta fija "Chat".
- `components/page-header.tsx` (barra de 56 px con ⓘ) existe, pero solo lo usa el dashboard de Chat; el resto de las páginas tiene su encabezado propio y en el celular conviven dos barras (pendiente F13 de la Fase 3, que esta etapa resuelve en F7).

### 3.6 Storage hoy
Un solo bucket, `knowledge` (privado, 25 MB), **sin policies en `storage.objects`**: todo por service role. `createSignedUploadUrl` no se usa. Esta etapa inaugura policies por workspace (hace falta para la subida reanudable desde el navegador).

### 3.7 Código de referencia a portar (fuera del repo)
Wendy tiene la carpeta `~/Documents/SSA-referencia-etapa2/` con `scaleos/`, `latewiz/` y `prototipo/`. En el arranque se copia a `docs/referencia/` (en `.gitignore`, excluida de TypeScript y ESLint). Además se copian desde `~/Documents/scaleos`: `src/components/admin/AdsPanel.tsx`, `CampaignDetailPanel.tsx`, `AdDetailPanel.tsx`, `ads-utils.tsx`, `ai-chat/AdsAIChatPanel.tsx`, `InstagramPanel.tsx`, la carpeta `instagram/` (`IgProfileBar`, `IgPostTile`, `PostMetricsGrid`, `ig-types`), `supabase/functions/meta-ads/index.ts`, la carpeta `src/components/admin/scaleos/content-dashboard/` completa y `src/lib/scaleos/ig-analytics-view.ts`. **Se lee, nunca se importa; se borra al final de la etapa.** Si falta algo, se implementa desde este documento y se anota.

### 3.8 Qué se porta de dónde

| Pieza | Origen | Archivos de referencia | Cómo se porta |
|---|---|---|---|
| Cliente de Threads | ScaleOS | `_shared/threads.ts`, `_shared/threads-api.ts`, `threads-auth/`, `threads-content/` | Lógica pura a `lib/social/threads/*`. Token a Vault |
| Meta: token, cuentas publicitarias, insights | ScaleOS | `_shared/meta-token.ts`, `_shared/meta-ads-accounts.ts`, `meta-ads/index.ts` | A `lib/meta/*`, con las correcciones de F55 a F58 |
| Dashboards de Meta Ads | ScaleOS | `AdsPanel.tsx`, `CampaignDetailPanel.tsx`, `AdDetailPanel.tsx`, `ads-utils.tsx`, `AdsAIChatPanel.tsx` | Réplica de layout, secciones, textos, fórmulas y umbrales, adaptada a los componentes del fork |
| Instagram por Graph API | ScaleOS | `_shared/instagram-graph.ts`, `instagram-content/index.ts` | A `lib/meta/instagram-graph.ts` |
| Analytics vía Zernio | ScaleOS | `_shared/ig-analytics.ts`, `_shared/ig-analytics-fetch.ts`, `ig-analytics-view.ts` | A `lib/metrics/zernio.ts`, extendido a TikTok |
| Dashboard de contenido | ScaleOS | `content-dashboard/*` (IgKpiRow, IgFollowerGrowth, IgPublishActivity, IgEngagementSeries, IgFormatPerformance, IgPostsSection) | Componentes adaptados; datos desde tablas propias |
| Perfil de Instagram (página Social y análisis del post) | ScaleOS | `InstagramPanel.tsx`, `instagram/IgProfileBar.tsx`, `IgPostTile.tsx`, `PostMetricsGrid.tsx` | Réplica extendida a todas las redes |
| Pipeline (kanban, calendario, lista, arrastrar) | ScaleOS | `produccion/*` (KanbanView, CalendarView, ListView, drag.ts, filters.ts) | Adaptados al modelo de §9 |
| Catálogo de permisos | ScaleOS | `src/lib/scaleos/permissions.ts`, `PermissionGate.tsx`, `UsersPanel.tsx` | A `lib/auth/permissions.ts` + `components/auth/permission-gate.tsx` |
| Card de integración | ScaleOS | `integrations/IntegrationCard.tsx`, `StatusBadge.tsx`, `LimitsFooter.tsx` | Referencia visual |
| Firma de Resend | ScaleOS | `supabase/functions/resend-webhook/index.ts` | Referencia |
| Vistas previas, opciones por red, uploader, zonas horarias | LateWiz (MIT) | `compose/*`, `platform-previews.tsx`, `media-uploader.tsx`, `schedule-picker.tsx`, `platform-selector.tsx`, `late-api/types.ts`, `timezones.ts` | Copiados adaptados, con el aviso MIT en el encabezado. Nunca se guarda una clave en el navegador ni se llama a Zernio desde el cliente |
| **Diseño de todas las pantallas nuevas** | Prototipo | `prototipo/dashboards-de-chat.html` (Contenido, editor, calendario, Social, Dashboards, Integraciones, barra superior) | Referencia visual y de comportamiento. La sección Agenda es de la Etapa 4: no se construye |

---

## 4. Qué cambia y qué NO cambia

### 4.1 Cambia
- Pantalla de integraciones (rediseño) y catálogo de proveedores (nuevos tipos de conexión).
- Barra superior de 56 px con filtros y acciones en **todas** las pantallas (§13.0).
- Dónde viven los secretos de Evolution y del webhook de Zernio (Vault, con fallback temporal).
- `integration_configs.type` admite nuevos valores; `channels.platform` y `channels.provider` admiten `email` / `resend`.
- `messages` suma columnas de email.
- `workspace_members` suma `role_id`; `can_see_contact` / `can_see_conversation` consideran el rol.
- Menú lateral: se agregan "Contenido" y "Social"; "Roles" dentro de Settings.
- Dashboards: selector con Chat, Contenido orgánico, Meta Ads, Unificado.
- Receptor `app/api/webhooks/late`: eventos de posts de Zernio y guardado de comentarios (incluye TikTok y comentarios propios).
- Procesador de `scheduled_jobs`: registro de handlers por tipo (publicación, métricas, copy con IA).
- Automatizaciones `comment_keyword`: el sistema completa sus `postIds` al publicar (F27).

### 4.2 NO cambia (intocable)
- Recepción y envío de mensajes de Instagram y WhatsApp, dedup de contactos, opt-out, persistencia de mensajes, agente IA y su runner, borradores, flows (su motor y su editor), secuencias, base de conocimiento, dashboard de Chat, patrones de mensajes, costos de IA.
- `processComment` y las automatizaciones existentes: siguen disparándose igual; solo se suma el guardado del comentario.
- El scope de leads: con los roles de sistema, un Member ve exactamente lo mismo que hoy.
- `requireWorkspaceAdmin` y `getAdminContext` siguen existiendo y comportándose igual para Owner/Admin.
- Los webhooks existentes siguen verificando firma/token igual; solo cambia **de dónde** leen el secreto.
- Los jobs de tipos que existen hoy (incluido `bg_task`) mantienen su comportamiento.
- Ningún dato existente se borra en esta corrida.

### 4.3 Análisis de impacto y riesgos

| Zona que se toca | Quién depende | Riesgo | Mitigación (test de caracterización ANTES) |
|---|---|---|---|
| Secretos de Evolution | Envío de WhatsApp, webhook `evolution`, cron `whatsapp-health`, QR | WhatsApp deja de funcionar | `getEvolutionConfig(workspaceId)` con fallback a env. Caracterización del cliente y del webhook (token válido 200 / inválido 401 / sin env 500) |
| Secreto del webhook de Zernio | Recepción de Instagram | Rechazar webhooks válidos | Vault → `workspaces.webhook_secret` → `channels.webhook_secret`; `zernio-webhook.test.ts` en verde + casos nuevos |
| Receptor de `comment.received` | Automatizaciones por comentario | Una automatización deja de dispararse o se dispara con un comentario propio | Caracterización: comentario de tercero dispara `processComment` igual que hoy; propio no dispara |
| `channels` con canal Email | 40+ lecturas que asumen `late_account_id` string | Errores en runtime | Email guarda `'email:<dirección>'`; el NOT NULL queda intacto |
| `can_see_*` con roles | Policies de contactos, conversaciones, secuencias, notificaciones, mensajes, notas, tags | Un Member ve más o menos | `verify-rls.mjs` en verde antes y después; solo cambia el cuerpo de las funciones |
| Guards y menú por permiso | Páginas con `requireWorkspaceAdmin`, acciones con `getAdminContext`, `lib/nav/items.ts` | Un Member pierde algo | `lib/auth/member-baseline.test.ts` fija la tabla real; `SYSTEM_ROLE_PERMISSIONS.member` se deriva de ella |
| Procesador de `scheduled_jobs` | Agente, flows, KB, broadcasts, `bg_task` | Un job nuevo frena la cola o uno viejo empieza a fallar | Extraer la decisión a `lib/jobs/dispatch.ts` con test que fija lo de hoy; después sumar el registro. Desconocido → `failed`; tipos existentes sin cambio |
| Barra superior en todas las páginas | ~22 páginas y la barra móvil | Romper encabezados o acciones existentes | Una página por vez, con recorrida a 1440/390; `lib/nav/items.test.ts` sigue en verde |
| Bandeja con canal Email | Filtros, lista, envío binario | Lista rota o envío por la rama equivocada | `PLATFORMS` suma `email`; rama `resend` explícita en los dos lugares de envío; `verify-inbox-filters.mjs` |
| Storage con policies (patrón nuevo) | Ninguno (knowledge sigue por service role) | Fuga entre workspaces | `verify-content.mjs` prueba lectura cruzada del bucket |

---

## 5. Usuarios y roles

| Rol | Qué puede hacer | Qué NO puede hacer |
|---|---|---|
| **Owner** (sistema) | Todo | Nadie puede dejar el workspace sin Owner |
| **Admin** (sistema) | Todo lo de hoy + integraciones, contenido (aprobar, programar, publicar, generar con IA), métricas de contenido y Ads, página Social, roles | Quitar al último Owner |
| **Member** (sistema) | Exactamente lo de hoy + **Contenido: ver, crear ideas y posts, editar los suyos y enviar a revisión** | Integraciones, aprobar ideas o posts, programar, publicar, generar con IA, ver métricas de contenido y Ads, página Social, roles |
| **Rol personalizado** (B9) | Lo que marquen sus permisos, con alcance "solo lo mío" o "todo" en leads y conversaciones | Lo que no marquen |

El primer usuario del workspace es Owner (sin cambios). Los roles personalizados solo se asignan a personas cuya base es `member`.

---

## 6. Alcance específico por módulo

### 6.1 Integraciones (B1, B2)
- **Qué hace:** una pantalla con todas las integraciones que guardan secretos, en secciones, con cards compactas y configuración en modal. Conexiones por API key, OAuth con app propia, token de sistema, QR (link a WhatsApp) y "vía Zernio".
- **Hasta dónde llega:** las de la Etapa 1 más Postproxy, Google (YouTube), LinkedIn, Threads, Meta y Resend entrante. Avisos de vencimiento y estado "Requiere atención".
- **Qué NO hace:** integraciones de etapas futuras; varias cuentas de la misma red; Google Calendar, Drive ni Gmail; registrar webhooks automáticamente si el proveedor no lo permite (se muestra la URL para copiar).

### 6.2 Contenido y publicación (B3, B4)
- **Qué hace:** pipeline de ideas y posts (kanban de 7 columnas, calendario por pieza, lista); cada post tiene **copy** (el guion para grabar) y **caption**, generables con IA; historial de versiones; editor en una sola página con fecha, caption, media y CTA por red; palabras clave vinculadas a automatizaciones; variantes y redistribución; subida de media; publicación programada o inmediata por el publicador de cada red; reintentos; estado por red; aprobación.
- **Hasta dónde llega:** Instagram (feed, carrusel, Reel, Story) y TikTok (video, carrusel de fotos) por Zernio; YouTube (video y Short) por Postproxy o API oficial; LinkedIn (texto, imagen, video, PDF) y Threads (texto, imagen, video, carrusel, hilo) directo. La IA genera guion y caption con un pedido simple (no es un agente).
- **Qué NO hace:** borrar o editar posts ya publicados en las redes; editar video; generar imágenes, carruseles o piezas; agentes de contenido; importar al pipeline los posts publicados a mano (aparecen en Social y en métricas, no en el kanban); publicar en páginas de empresa de LinkedIn.
- **Dónde va lo que queda afuera:** agentes, generador de piezas y agente de redacción → Etapa 3.

### 6.3 Métricas, Social y comentarios (B5, B6, B7)
- **Qué hace:** fotos diarias de métricas de Instagram, TikTok, YouTube y Threads (con historial inicial donde la API lo permite); stories y audiencia de Instagram; engagement comparable a 7 días; comentarios guardados y vinculados a cada publicación; dashboard orgánico de ScaleOS con agrupación Día/Semana/Mes, explorador de doble eje y análisis de cada post; página Social con el perfil de cada red; réplica corregida de los dashboards de Meta Ads (cuenta, campaña, ad set, anuncio) y unificado.
- **Qué NO hace:** métricas o comentarios de LinkedIn (la API gratuita no los da); crear o editar anuncios; métricas en tiempo real; exportar a PDF o CSV; atribuir seguidores a un post (se muestra la variación de la cuenta como señal, F52).

### 6.4 Email (B8)
- **Qué hace:** recibe emails en una dirección de un subdominio vía Resend, los muestra como conversaciones del canal Email vinculadas al contacto, permite responder manteniendo el hilo y guarda los adjuntos.
- **Qué NO hace:** el agente no responde emails; no hay Gmail; no hay firmas HTML ni plantillas; no hay reenvío.

### 6.5 Roles (B9)
- **Qué hace:** catálogo de permisos en código, roles de sistema, roles personalizados con permisos y alcance, asignación, aplicación en interfaz, Server Actions y base.
- **Qué NO hace:** permisos por registro individual; roles distintos por canal; varios roles por persona.

---

## 7. Funcionalidades y criterios de aceptación

> Formato: descripción + criterios **EARS** (`CUANDO …, EL SISTEMA DEBE …`) o **DADO/CUANDO/ENTONCES**, + el test que debe pasar. Todo proveedor externo va simulado (`vi.fn()` sobre `fetch` o sobre el cliente). Los tests nuevos van junto al módulo (`*.test.ts`). Cada tabla nueva: RLS por workspace y lectura cruzada probada en `verify-rls.mjs`.

---

### FASE 1: INTEGRACIONES, CONTENIDO Y PUBLICACIÓN

### Bloque 1: Integraciones, Vault y barra superior

#### F1: Catálogo extendido con tipos de conexión
**Descripción:** `ProviderDefinition` suma `connection` (`api_key` | `oauth_app` | `system_token` | `qr` | `via_zernio`), `section` (`messaging` | `publishing` | `google` | `meta` | `email` | `ai`), `visible`, `secretFields` (varios secretos por integración, cada uno con su nombre en Vault) y `usage` opcional. Entradas nuevas: `zernio`, `evolution`, `postproxy`, `google`, `linkedin`, `threads`, `meta` (oculta hasta B5), `resend_inbound` (oculta hasta B8). Sigue siendo la única fuente de verdad, sin dependencias de servidor.
**Criterios:**
- CUANDO se llama `providersBySection()`, EL SISTEMA DEBE devolver las secciones en el orden Mensajería, Publicación y redes, Google, Meta, Email, IA, solo con proveedores visibles.
- CUANDO un proveedor no es visible, EL SISTEMA DEBE excluirlo de la pantalla y de las Server Actions (una acción sobre un proveedor oculto responde error).
- CUANDO un proveedor declara `secretFields`, cada nombre DEBE existir en `SECRET_NAMES`.
- Test: `lib/integrations/providers.test.ts` (extendido) pasa.

#### F2: Pantalla en grid con cards compactas
**Descripción:** `/dashboard/settings/integrations` en secciones con grid (1 columna < 768 px, 2 ≥ 768, 3 ≥ 1280). Card: ícono, nombre, una línea de descripción, badge de estado, cuenta conectada, barra de uso y un botón ("Conectar" o "Configurar"). Sin inputs a la vista. Filtro "Requiere atención" en la barra superior.
**Criterios:**
- `integrationStatus()` DEBE devolver `not_connected`, `connected`, `attention` (token por vencer en ≤ 7 días, permiso faltante o uso ≥ 90 %) o `error` (`last_error` reciente).
- CUANDO se activa "Requiere atención", EL SISTEMA DEBE mostrar solo `attention` o `error`, y "Todo en orden" si no hay ninguna.
- CUANDO un Member intenta abrir la pantalla, EL SISTEMA DEBE redirigir (guard existente).
- Test: `lib/integrations/status.test.ts` pasa.

#### F3: Modal de configuración genérico
**Descripción:** un modal que arma sus campos desde el catálogo: para qué sirve, dónde sacar cada dato, campos no secretos editables, secretos como "Guardado ✓ · Reemplazar", dirección de retorno OAuth o URL de webhook para copiar, "Probar y guardar", "Desconectar" (con confirmación) y, en redes, el publicador por defecto. En el celular ocupa la pantalla completa.
**Criterios:**
- CUANDO se guarda un secreto, EL SISTEMA DEBE guardarlo en Vault y **nunca** devolverlo al cliente (test que inspecciona la respuesta de la acción).
- CUANDO la prueba de conexión falla, EL SISTEMA DEBE mostrar el error y no guardar nada.
- CUANDO se desconecta, EL SISTEMA DEBE borrar sus secretos de Vault, marcar `is_active = false`, registrar en `audit_log` e informar antes cuántas publicaciones programadas la usan.
- Test: `lib/actions/integrations.test.ts` (nuevo) pasa.

#### F4: Evolution en Vault con fallback
**Descripción:** la card de Evolution guarda en Vault `evolution_api_key` y `evolution_webhook_token`, y en `config` la URL y el prefijo de instancia. Helper único `getEvolutionConfig(workspaceId)`: Vault/config y, si no hay, las variables de entorno actuales. Todo lo que hoy lee `process.env.EVOLUTION_*` pasa por el helper (cambian las firmas de unos 8 llamadores). El webhook resuelve el canal por `evolution_instance` y valida el token del workspace de ese canal; si no hay canal, cae a env. Link "Abrir WhatsApp (QR)".
**Criterios:**
- ANTES de cambiar nada: caracterización de `lib/evolution-client.ts` y de `app/api/webhooks/evolution` en verde.
- CUANDO hay valores en Vault, EL SISTEMA DEBE usarlos; si no, las variables de entorno; si no hay en ninguno, el mismo error que hoy.
- `process.env.EVOLUTION_` no DEBE aparecer fuera de `getEvolutionConfig` en `lib/` y `app/`.
- Test: `lib/evolution-config.test.ts` pasa.

#### F5: Secreto del webhook de Zernio en Vault con fallback
**Descripción:** `zernio_webhook_secret` en Vault; `resolveWebhookSecret` lee Vault → `workspaces.webhook_secret` → `channels.webhook_secret`. Botón "Migrar a Vault" en la card (copia sin loguear). Las columnas viejas no se borran (§9.10).
**Criterios:**
- CUANDO el secreto está en Vault, EL SISTEMA DEBE verificar la firma con él; si no, con la columna; firma inválida → 401 como hoy.
- Test: `lib/zernio-webhook.test.ts` en verde + casos de Vault y fallback.

#### F6: Cards de las integraciones existentes y barra de uso
**Descripción:** Zernio ("N de 2 cuentas gratis usadas", contando `channels` + `social_accounts` vía Zernio), Evolution, Resend (salida), OpenAI, Anthropic, Google IA, Voyage, con las mismas validaciones de hoy.
**Criterios:**
- CUANDO se guarda una key de IA o de Resend, EL SISTEMA DEBE comportarse igual que antes (prefijos, validaciones, destino en Vault).
- CUANDO Zernio tiene 2 cuentas, la barra DEBE mostrar "2 de 2 gratis" y avisar que la próxima cuesta $6/mes.
- Test: `lib/integrations/usage.test.ts` pasa; los tests existentes siguen en verde.

#### F7: Barra superior en todas las pantallas
**Descripción:** el `PageHeader` de 56 px de la Fase 3 (título + ⓘ con tooltip, sin subtítulo) se aplica a **todas** las páginas, con un slot de acciones a la derecha donde van **los filtros y botones de la página** (no hay barras de herramientas dentro del contenido). En el celular hay una sola barra (se unifica `MobileTopBar`); los filtros y botones pasan a una segunda franja fija debajo, con desplazamiento horizontal. Las pestañas de sección (Settings, estados como "Próximas / Por marcar") siguen dentro del contenido. Ejemplos del prototipo: Contenido → vista Kanban / Calendario / Lista, filtro de red, "+ Nueva idea", "+ Nuevo post"; editor → volver, estado, "✦ Generar guion y caption", "Guardar versión"; Social → selector de red y de formato, "Analíticas"; Dashboards → selector de dashboard, filtros, período; Integraciones → "Requiere atención"; Equipo → "+ Nuevo rol", "Invitar".
**Criterios:**
- CUANDO se abre cualquier página del menú, DEBE verse una sola barra superior con título e ⓘ, en escritorio y a 390 px.
- CUANDO una página tiene filtros o acciones, DEBEN estar en la barra (función pura `pageActions(page, state)` que decide qué va).
- Test: `lib/nav/page-actions.test.ts` pasa; `lib/nav/items.test.ts` sigue en verde; recorrida de todas las páginas o anotada.

**Bloque 1 listo cuando:** F1 a F7 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `npm run lint` sin errores nuevos; `node scripts/verify-rls.mjs` sale 0; pantallas revisadas en 1440 y 390 px o anotadas.

---

### Bloque 2: Conexiones de redes

#### F8: Tablas de conexiones y cuentas sociales
**Descripción:** migraciones de `oauth_connections` y `social_accounts` (§9.1). `social_accounts.publishers jsonb` reemplaza a una tabla de publicadores. `social_accounts` guarda también los datos del perfil para la página Social (F54). Tipos a mano en `lib/types/database.ts`.
**Criterios:**
- CUANDO se aplica la migración dos veces, NO DEBE fallar.
- CUANDO un usuario de otro workspace consulta, NO DEBE ver filas; un Member NO DEBE ver `oauth_connections`.
- CUANDO `publishers` no cumple el esquema Zod, la escritura DEBE rechazarse.
- Test: `verify-rls.mjs` extendido sale 0; `lib/social/accounts-schema.test.ts` pasa.

#### F9: Flujo OAuth genérico con `state` firmado
**Descripción:** rutas `app/api/oauth/[provider]/start` y `/callback`. El inicio exige Owner/Admin, lee el Client ID de Vault y arma un **`state` firmado** (HMAC-SHA256 con el secreto `oauth_state_secret` de Vault, que se genera la primera vez) con `nonce`, `provider`, `user_id`, `workspace_id`, `redirect_to` (relativo, lista blanca) y vencimiento de 10 minutos, más una cookie `httpOnly` con el mismo nonce. **Sin tabla.** El retorno valida firma, vencimiento, usuario y nonce contra la cookie (y la borra), intercambia el código con Client ID y Secret de Vault, guarda los tokens en Vault y crea/actualiza `oauth_connections` con los permisos otorgados de verdad, la identidad y el vencimiento. Redirige con `?connected=<proveedor>` o `?error=<motivo>`. La dirección de retorno sale de `lib/webhook-url.ts` (`oauthCallbackUrl(provider)`), que se niega a usar localhost en producción.
**Criterios:**
- CUANDO el `state` tiene firma inválida, venció, es de otro usuario o el nonce no coincide con la cookie, EL SISTEMA DEBE rechazar con `?error=invalid_state` sin guardar nada.
- CUANDO el mismo `state` se usa dos veces, la segunda DEBE rechazarse (la cookie ya no está).
- CUANDO el usuario cancela (`error=access_denied`), DEBE redirigir con `?error=cancelled`.
- CUANDO un Member llama a `/start`, DEBE responder 403.
- Test: `lib/oauth/flow.test.ts` y `lib/oauth/state.test.ts` pasan.

#### F10: Conexión con Google (YouTube)
**Descripción:** adaptador `google`: `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, permisos `youtube.readonly`, `youtube.upload`, `yt-analytics.readonly`, `youtube.force-ssl` (lectura de comentarios). Tras conectar, lee el canal (`channels.list?mine=true`) y crea el `social_account` YouTube. Refresca el access token en memoria. `invalid_grant` → conexión `revoked` + aviso.
**Criterios:**
- CUANDO no se otorgó `youtube.upload`, el publicador `youtube_api` DEBE quedar `unavailable` con el motivo.
- CUANDO el refresh devuelve `invalid_grant`, DEBE quedar `revoked`, avisar una vez y no reintentar.
- CUANDO se reconecta, NO DEBE duplicar el `social_account`.
- Test: `lib/social/google.test.ts` pasa.

#### F11: Conexión con LinkedIn
**Descripción:** permisos `openid profile email w_member_social`; lee `/v2/userinfo` y crea el `social_account` LinkedIn (`urn:li:person:<sub>`); guarda el vencimiento (60 días). `LINKEDIN_API_VERSION` como constante (la 202510 vence el 15/10/2026).
**Criterios:**
- CUANDO faltan ≤ 7 días, el estado DEBE ser `attention` con un solo aviso por período.
- CUANDO el token venció, las publicaciones programadas de LinkedIn DEBEN fallar `permanent` con "Reconectar LinkedIn".
- Test: `lib/social/linkedin.test.ts` pasa.

#### F12: Conexión con Threads
**Descripción:** portado de ScaleOS: OAuth (`threads_basic, threads_content_publish, threads_manage_insights, threads_read_replies, threads_manage_replies`), token largo (60 días), perfil; alternativa "Pegar token". Cron semanal `social-token-refresh` que renueva cuando quedan < 15 días.
**Criterios:**
- CUANDO se pega un token válido, DEBE cambiarse por uno largo, guardarse en Vault y crear el `social_account`.
- CUANDO la renovación falla, la conexión DEBE pasar a `attention` con aviso; con > 15 días, el cron NO DEBE renovar.
- Test: `lib/social/threads/*.test.ts` pasan.

#### F13: Cuentas sociales y publicadores disponibles
**Descripción:** `syncSocialAccounts(workspaceId)` arma una `social_account` por red y su `publishers jsonb` (`[{ publisher, account_ref, status: available|unverified|unavailable, status_reason, verified_at, manually_enabled }]`): Zernio → Instagram y TikTok (`zernio`; la cuenta de Instagram se vincula al canal de la bandeja con `channel_id`); Postproxy → YouTube (`postproxy`); Google → YouTube (`youtube_api`, `unverified` hasta F38); LinkedIn (`linkedin_api`); Threads (`threads_api`). Publicador por defecto elegible en la card; si deja de estar disponible pasa al siguiente (`youtube_api` > `postproxy` > `zernio`) y se avisa. Al sincronizar se guardan los datos de perfil (nombre, usuario, foto, bio, link) cuando la API los da.
**Criterios:**
- DADO Postproxy y Google conectados, ENTONCES YouTube tiene `postproxy` (available) y `youtube_api` (unverified), y el por defecto es `postproxy`.
- CUANDO se desconecta Postproxy, EL SISTEMA DEBE cambiar el por defecto o dejarlo vacío, y avisar.
- CUANDO se sincroniza dos veces, NO DEBE duplicar.
- Test: `lib/social/accounts.test.ts` pasa.

#### F14: Conexión de Postproxy
**Descripción:** card con API key y secreto del webhook (si Postproxy lo ofrece). Cliente `lib/social/postproxy.ts` según su documentación (Claude Code la lee antes; si difiere, adapta y anota). Barra de uso: publicaciones del mes desde `social_posts` con `publisher = 'postproxy'` (plan gratis: 10).
**Criterios:**
- CUANDO la key es inválida, la prueba DEBE fallar sin guardar.
- CUANDO se llegó a 10 en el mes, el estado DEBE ser `attention` y el editor DEBE avisar al elegir YouTube por Postproxy.
- Test: `lib/social/postproxy.test.ts` pasa.

#### F15: Avisos de conexiones
**Descripción:** tipo de notificación `integration_attention` (token por vencer, revocado, permiso faltante, cuota ≥ 90 %), reutilizando `createNotificationOnce` con ventana configurable por causa y período. Aparece en la campana del pie del menú y en la card.
**Criterios:**
- CUANDO la misma causa ya tiene un aviso sin leer en el período, NO DEBE crearse otro.
- Test: `lib/notifications/create.test.ts` extendido pasa.

**Bloque 2 listo cuando:** F8 a F15 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-rls.mjs` sale 0 con las tablas nuevas; cards y modales revisados o anotados.

---

### Bloque 3: Modelo de contenido y pipeline

#### F16: Tablas de contenido y bucket
**Descripción:** migraciones de `content_ideas`, `content_posts`, `content_post_versions` y `social_posts` (§9.2) y del bucket privado `content-media` con **policies en `storage.objects` por workspace** (el primer segmento del path es el `workspace_id`). RLS: Owner/Admin todo; Member ve todo el contenido del workspace (el contenido no tiene scope de leads) y crea y edita **sus** ideas y posts en `draft`, `in_production` o `in_review`. `social_posts` lo escribe solo el servidor.
**Criterios:**
- CUANDO un Member intenta pasar un post a `approved` o `scheduled` por la API de Supabase, la RLS/función DEBE rechazarlo.
- CUANDO un usuario de otro workspace intenta leer una fila o un archivo del bucket, DEBE fallar.
- Test: `scripts/verify-content.mjs` (nuevo) prueba las reglas con Owner y Member reales de dos workspaces y limpia; sale 0.

#### F17: Estados del post
**Descripción:** funciones puras `canTransition(perms, from, to)` y `aggregatePostStatus(publicaciones)`. Estados: `draft`, `in_production`, `in_review`, `approved`, `scheduled`, `publishing`, `published`, `partially_published`, `failed`; archivar es `archived_at`. Transiciones en §9.4. Marcar el material "Grabado" desde Borrador pasa el post a En producción. El estado desde `scheduled` se **deriva** de sus filas de `social_posts`: Programado si al menos una red está programada; Publicado, Parcial o Falló según sus filas. Las ideas tienen su propio estado (`nueva`, `aprobada`, `descartada`).
**Criterios:**
- CUANDO todas las redes están `published`, el post DEBE quedar `published`; mezcla con `failed` → `partially_published`; todas `failed` → `failed`; alguna `publishing` → `publishing`.
- CUANDO un Member intenta `draft → scheduled`, DEBE ser inválido; `draft → in_review` y `draft → in_production`, válidos.
- Test: `lib/content/status.test.ts` cubre la tabla completa por rol.

#### F18: Subida de media
**Descripción:** subida directa del navegador a Storage con URL firmada generada por una Server Action (tipo y tamaño validados en el servidor, MIME real por magic bytes); TUS (`tus-js-client`) para > 6 MB. La media vive en `content_posts.media jsonb` (§9.2): la **media base** del post, más la media propia de una red en `networks[].media` (variante, F28). Tipos: jpg, png, webp, gif, mp4, mov, pdf. Máximo 1 GB.
**Criterios:**
- CUANDO el MIME real no está permitido o supera 1 GB, la acción DEBE rechazar la URL.
- CUANDO se quita una media de un post no publicado, DEBE borrarse del bucket.
- Test: `lib/content/media.test.ts` pasa. El límite global de 1 GB de Supabase queda anotado para la verificación en vivo.

#### F19: Ideas
**Descripción:** `content_ideas` (§9.2) se crean desde el kanban ("+ Nueva idea" en la barra superior y "+ Idea" al pie de la columna): título, hook, ángulo, formato, pilar, referencia, notas. Cualquiera con `content.create` crea; un Member ve la suya "Esperando aprobación". En la tarjeta y en el detalle de la idea, quien tiene `content.approve` ve **Aprobar** (crea un post en Borrador con la idea vinculada y copy y caption vacíos; la idea pasa a `aprobada`), **✦ Aprobar y producir copy** (lo mismo y además encola la generación con IA de F29; requiere `content.ai`) y **Descartar** (con motivo opcional; sale del kanban y queda en el historial de ideas). Una idea puede originar varios posts.
**Criterios:**
- CUANDO se aprueba, DEBE crearse un post `draft` con `idea_id` y la idea quedar `aprobada`, en una sola transacción.
- CUANDO se aprueba y produce copy, DEBE además encolarse un job `content_copy`; si no hay proveedor de IA, el botón DEBE estar deshabilitado con el motivo.
- CUANDO un Member intenta aprobar, DEBE rechazarse.
- Test: `lib/content/ideas.test.ts` pasa.

#### F20: Kanban
**Descripción:** `/dashboard/content`, vista kanban con columnas **Ideas · Borrador · En producción · En revisión · Aprobado · Programado · Publicado** (fallidos y parciales con badge). Tarjeta de post: título, formato, íconos de redes con su fecha y estado, autor, y en Borrador/En producción si tiene copy y caption (✦ si los generó la IA) y el estado del material; en Publicado, chip "↻ YouTube programado 3 oct" si hay redistribución (F28). "+ Post" al pie de Borrador y "+ Nuevo post" en la barra superior (título, formato, idea de origen opcional, redes y "Generar guion y caption con IA al crear"). Arrastrar respeta `canTransition`; orden manual con `position`. Portado de ScaleOS.
**Criterios:**
- CUANDO se arrastra a una columna no permitida, DEBE revertir y mostrar el motivo.
- CUANDO se arrastra a Programado un post sin redes con fecha o sin aprobar, DEBE abrir el editor en vez de mover.
- Test: `lib/content/board.test.ts` pasa.

#### F21: Calendario y lista
**Descripción:** calendario (mes y semana, zona `workspaces.timezone`) con **una tarjeta por pieza por día**: la misma pieza en varias redes el mismo día es una tarjeta con los íconos de esas redes y el estado de cada una (tentativa con borde punteado, programada, publicada, fallida); una red en otra fecha es otra tarjeta ese día, marcada **↻ redistribución** (toda fecha posterior a la primera de la pieza). Selector "Contar: Piezas / Publicaciones" en la barra superior: Piezas (por defecto) cuenta cada pieza una vez, en su primera fecha; Publicaciones cuenta cada red. Resumen del mes: "X piezas nuevas · Y publicaciones · Z redistribuciones". Las publicaciones externas cuentan como pieza propia. Arrastrar una red programada a otro día la reprograma. Vista lista con filtros (red, estado, autor, fecha) en la URL. En el celular, el calendario pasa a vista agenda.
**Criterios:**
- DADA una pieza en 3 redes el mismo día, ENTONCES es 1 tarjeta, cuenta 1 pieza y 3 publicaciones.
- DADA una pieza publicada en IG y redistribuida en YT una semana después, ENTONCES son 2 tarjetas (la segunda con ↻) y cuenta 1 pieza, 2 publicaciones, 1 redistribución.
- CUANDO se reprograma a una fecha pasada o a menos de 5 minutos, DEBE rechazarse; si es válida, se actualizan la fila y su job.
- Test: `lib/content/calendar.test.ts` y `lib/content/filters.test.ts` pasan.

#### F22: Historial de versiones
**Descripción:** `content_post_versions` (§9.2). Se crea una versión al cambiar de estado, al tocar "Guardar versión", al retomar un borrador después de 10 minutos sin editar y en cada generación con IA (autor "IA"). El autoguardado de 10 s no crea versiones. Panel "Historial" en el editor: autor, motivo y fecha; **Comparar** (lado a lado, campo por campo) y **Restaurar** (crea una versión nueva, nunca borra). Se conservan las últimas 50 por post.
**Criterios:**
- CUANDO se autoguarda, NO DEBE crearse versión; al cambiar de estado, sí.
- CUANDO se restaura la versión 3, DEBE crearse la versión N+1 con el contenido de la 3.
- CUANDO hay 51 versiones, DEBE borrarse la más vieja.
- Test: `lib/content/versions.test.ts` pasa.

#### F23: Limpieza de media
**Descripción:** cron diario `content-media-cleanup` que borra del bucket la media de posts publicados hace más de `workspaces.content_media_retention_days` (default 30; 0 = nunca) y la marca `deleted_at` en el jsonb.
**Criterios:**
- DADO un post publicado hace 31 días y retención 30, ENTONCES su media se borra del bucket y queda marcada; con retención 0, nada.
- Test: `lib/content/cleanup.test.ts` pasa.

**Bloque 3 listo cuando:** F16 a F23 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-rls.mjs` y `verify-content.mjs` salen 0; pantallas revisadas contra el prototipo o anotadas.

---

### Bloque 4: Editor, IA y publicación

#### F24: Editor del post en una sola página
**Descripción:** `/dashboard/content/new` y `/dashboard/content/[id]/edit`. **Sin pestañas**: secciones en este orden: **Copy** (hook, desarrollo, cierre/CTA, notas de grabación y estado del material: pendiente, grabado, editado, listo) → **Caption base** → **Media base** → **Redes y publicación** (una fila desplegable por red) → pie con "Programar N redes con fecha". A la derecha, vista previa de la red abierta (LateWiz) e **Historial** (F22); en pantallas angostas pasan debajo. Cada fila de red, cerrada, resume fecha y estado (F25), si usa caption o media propios y el CTA; abierta: fecha, publicador, caption (base o propio, con contador de límite), media (base o variante), CTA y palabra clave (F27), opciones de la red (§9.5), mensajes de validación y "Programar solo esta red". Barra superior: volver, estado, "✦ Generar guion y caption" y "Guardar versión". Botones según permiso. Autoguardado cada 10 s y aviso al salir con cambios (`lib/unsaved-changes.ts`).
**Criterios:**
- CUANDO no hay ninguna red conectada, DEBE mostrar un estado vacío con link a Integraciones.
- CUANDO un Member abre el editor, NO DEBE ver "Programar", "Publicar ahora" ni "✦ Generar".
- CUANDO dos personas editan el mismo post, gana el último guardado y DEBE avisarse si el post cambió desde que se abrió (`updated_at`).
- Test: `lib/content/editor.test.ts` (acciones por permiso, resumen de cada red) pasa.

#### F25: Fecha por red: tentativa y programado
**Descripción:** cada red tiene su propia fecha. Mientras no se programa, vive en `content_posts.networks[].planned_at` y es **tentativa**: aparece en el calendario, pero no hay nada en la cola. **Programado** = existe la fila en `social_posts` con `status='scheduled'` y su job `content_publish` en `scheduled_jobs`. Se llega con "Programar solo X" o "Programar N redes con fecha" (exige post aprobado o permiso `content.publish`, cuenta conectada y fecha futura). "Publicar ahora" crea la fila y el job con `run_at = now()`. Cambiar la fecha de una red programada reprograma el job; "Desprogramar" pasa la fila a `cancelled` y la fecha vuelve a tentativa. Estados que se muestran por red: Sin fecha, Fecha tentativa, Programado, Publicado, Falló.
**Criterios:**
- CUANDO se programa una sola red, DEBEN crearse exactamente una fila de `social_posts` y un job; las otras redes siguen tentativas.
- CUANDO se desprograma, la fila DEBE quedar `cancelled`, el job cancelado y `planned_at` intacto.
- CUANDO se edita una red programada a menos de 5 minutos de su hora, DEBE rechazarse.
- Test: `lib/content/schedule.test.ts` pasa.

#### F26: Validación por red
**Descripción:** función pura `validateNetwork(platform, contenido, media, opciones)` con los límites de §9.6; errores y advertencias por red. Se puede programar el resto y dejar una red sin programar.
**Criterios:**
- Reel > 90 s → error en Instagram; texto de Threads de 501 caracteres → error; YouTube sin título → error; Instagram sin media → error; video vertical de YouTube ≤ 3 min → advertencia "se publicará como Short".
- CUANDO la red llegó a su límite diario (conteo desde `social_posts`), DEBE dar error.
- Test: `lib/content/validation.test.ts` pasa.

#### F27: Palabras clave y automatizaciones
**Descripción:** el CTA de cada red declara tipo (`comment` = "Comentá X", `dm` = "Escribime X por DM", `link`, `none`) y palabra clave; además se detectan palabras en mayúsculas del copy y del caption y se resaltan. Para cada palabra se busca una automatización **activa del mismo workspace** que coincida por palabra (`matchType`), tipo (`comment_keyword` para comentario, `keyword` para DM) y red. Junto al CTA: ✓ "Comentá SISTEMA → DM con la guía (automatización X)" con link al flow, o ⚠ "Ninguna automatización responde a SISTEMA" con **"Crear automatización"** (abre el editor de flows con la palabra, el tipo y la red precargados). Es advertencia, no bloquea. Si la automatización está limitada a "solo este post", al publicarse esa red el sistema **agrega el `external_post_id` a sus `postIds`** (sin duplicar). LinkedIn: el CTA se permite con el aviso "Las respuestas en LinkedIn se atienden a mano".
**Criterios:**
- CUANDO la automatización está inactiva, NO DEBE contar como coincidencia.
- CUANDO `matchType` es `contains` y el CTA dice "SISTEMA", DEBE coincidir con la palabra "sistema".
- CUANDO se publica una red con automatización "solo este post", su `postIds` DEBE incluir el id publicado una sola vez, y `processComment` DEBE dispararse con un comentario simulado en ese post.
- Test: `lib/content/keywords.test.ts` pasa.

#### F28: Variantes, duplicar y redistribución
**Descripción:** **variante dentro del mismo post:** una red puede tener media propia (otro carrusel), caption propio y CTA propio; sigue siendo una pieza con un solo copy y un solo estado. **"Duplicar como variante"** crea un post nuevo con la misma `idea_id` y todo copiado (son dos piezas). **Redistribución:** desde un post publicado, "**+ Publicar en otra red**" (en el detalle o activando la red en el editor) agrega la red con su fecha y la programa (fila nueva en `social_posts`); el post sigue en Publicado con el chip "↻ …". No hace falta aprobar de nuevo salvo que se cambie el copy o la media base (entonces esa red vuelve a revisión). Si la red nueva necesita media que todavía no existe, queda tentativa hasta cargarla.
**Criterios:**
- CUANDO se agrega YouTube a un post publicado, el post NO DEBE cambiar de columna y DEBE existir una fila `scheduled` de YouTube.
- CUANDO se duplica como variante, el post nuevo DEBE tener la misma `idea_id`, estado `draft` y una versión inicial.
- Test: `lib/content/redistribution.test.ts` pasa.

#### F29: Generar guion y caption con IA
**Descripción:** botón "✦ Generar guion y caption" (o "Regenerar") en la barra del editor, en "Aprobar y producir copy" (F19) y en "Nuevo post" con la opción marcada. Permiso nuevo **`content.ai`** (por defecto Owner y Admin). **Entrada:** la idea (título, hook, ángulo, formato, pilar, referencia), el formato del post, las redes elegidas y la **voz de marca del workspace** (texto y ejemplos en Settings → IA y tareas → "Generación de copy"). **Salida estructurada** validada con Zod: `{ copy: { hook, body, cta, recording_notes }, caption_base, captions: { [platform]: texto }, youtube_title? }`, respetando §9.6. **Guardado:** versión nueva con autor "IA" (F22); nunca pisa sin versión; si hay copy escrito a mano, "Regenerar" pide confirmación; el post muestra "✦ Generado con IA · revisalo antes de aprobar" hasta la primera edición humana; `copy_source` = `ai` o `mixed`. **Ejecución:** job `content_copy` en `scheduled_jobs`, con el proveedor y modelo de IA **del workspace**, costo registrado en su gasto de IA y sujeto a sus topes. Sin proveedor, el botón queda deshabilitado con el motivo. Si falla: el post queda sin copy y llega un aviso con "Reintentar". Es un pedido simple, no un agente: la interfaz (`generateCopy(input) → output`) queda lista para que la reemplace el agente de redacción de la Etapa 3.
**Criterios:**
- CUANDO la salida no cumple el esquema, NO DEBE guardarse nada y el job DEBE fallar con aviso.
- CUANDO el workspace superó su tope de gasto de IA, DEBE rechazarse antes de llamar.
- CUANDO un usuario sin `content.ai` lo pide, DEBE rechazarse.
- CUANDO se genera, el costo DEBE registrarse en el workspace que lo pidió.
- Test: `lib/content/ai-copy.test.ts` (armado del pedido, validación, versión con autor IA, confirmación, permiso, tope, fallo) con el proveedor simulado.

#### F30: Interfaz común de publicadores y registro de jobs
**Descripción:** `lib/publishing/types.ts`: `Publisher { id; platforms; publish(post, red, media, creds): PublishResult; getStatus?(ref) }`, `PublishResult = { status: 'published'|'processing'|'failed', externalId?, externalUrl?, ref?, error?, errorKind?: 'temporary'|'permanent' }`. Registro `lib/publishing/registry.ts`; `classifyPublishError()` (red caída, 429, 5xx → temporal; 4xx de validación, token vencido, permiso faltante → permanente). En la cola: primero se extrae la decisión del `switch` de `app/api/cron/jobs/route.ts` a `lib/jobs/dispatch.ts` con un test de caracterización que fija lo de hoy (tipos, reintentos `2^(n+1)·5 s`, máximo 3, exclusión de `agent_burst`); después se suma `lib/jobs/registry.ts`, que el `default` consulta. **Un tipo desconocido pasa a `failed` sin reintento; los tipos existentes (incluido `bg_task`) mantienen su comportamiento de hoy.**
**Criterios:**
- CUANDO se pide un publicador que no existe, DEBE lanzar un error tipado que termina en `failed/permanent`.
- CUANDO el proveedor responde 429 o 503 → `temporary`; 401 o 400 de validación → `permanent`.
- CUANDO entra un tipo desconocido, DEBE quedar `failed` y los jobs del agente seguir procesándose; un `bg_task` DEBE comportarse como hoy.
- Test: `lib/jobs/dispatch.test.ts`, `lib/publishing/errors.test.ts` y `registry.test.ts` pasan.

#### F31: Publicador Zernio (Instagram y TikTok)
**Descripción:** `lib/publishing/zernio.ts` con `@zernio/node`: "publicar ahora" con la media por URL firmada de 24 h (la de la red o la base) y las opciones por red (Instagram: tipo, colaboradores, `shareToFeed`; TikTok: `PUBLIC_TO_EVERYONE` o borrador, comentarios, duetos, stitch, `content_preview_confirmed`, `express_consent_given`). Guarda el id de Zernio como `publisher_ref`; el estado final llega por webhook (F35).
**Criterios:**
- CUANDO la creación responde OK, la fila DEBE quedar `publishing` con `publisher_ref`.
- CUANDO TikTok se pide con una privacidad distinta de pública o borrador, la validación DEBE rechazarlo antes de llamar.
- Test: `lib/publishing/zernio.test.ts` pasa.

#### F32: Publicador Postproxy (YouTube)
**Descripción:** `lib/publishing/postproxy.ts`: video por URL firmada, título, descripción, privacidad, Short si corresponde, miniatura si hay portada (si la API no documenta Short o miniatura, se adapta y anota). Estado final por webhook o por chequeo periódico (job `content_publish_check` cada 5 minutos hasta 2 horas).
**Criterios:**
- CUANDO queda en proceso, DEBE quedar `publishing` con un chequeo agendado; pasadas 2 horas sin resultado, `failed/temporary` "sin confirmación de Postproxy".
- Test: `lib/publishing/postproxy.test.ts` pasa.

#### F33: Publicador YouTube API oficial
**Descripción:** `lib/publishing/youtube.ts`: subida reanudable con `fetch` y `Content-Range` (sin `googleapis`), en partes, sin cargar el archivo entero en memoria. Título, descripción, privacidad, `madeForKids`, `publishAt`. Si se pidió `public`/`unlisted` y quedó `private` sin `publishAt`: `youtube_api` → `unavailable` ("el proyecto no pasó la auditoría"), cambia el por defecto y avisa. Solo se usa si está `available` (F38).
**Criterios:**
- CUANDO el video quedó privado sin pedirlo, DEBE deshabilitar `youtube_api`, avisar y dejar la fila `published` con advertencia "quedó privado".
- CUANDO la cuota diaria está agotada (403 `quotaExceeded`), DEBE ser `failed/temporary` con reintento al día siguiente.
- Test: `lib/publishing/youtube.test.ts` pasa.

#### F34: Publicadores LinkedIn y Threads
**Descripción:** `lib/publishing/linkedin.ts` (Posts API `/rest/posts`, `Linkedin-Version` constante; texto, imagen, video por partes, PDF; autor = URN de la persona) y `lib/publishing/threads.ts` (portado: contenedor + publicar; texto, imagen, video, carrusel, hilo).
**Criterios:**
- CUANDO LinkedIn responde 401, DEBE ser `failed/permanent` "Reconectar LinkedIn" y la conexión pasar a `attention`.
- CUANDO un hilo de Threads tiene 3 partes, DEBE publicarse en orden, cada una respondiendo a la anterior.
- Test: `lib/publishing/linkedin.test.ts` y `threads.test.ts` pasan.

#### F35: Dispatcher, reintentos y webhooks de estado
**Descripción:** el handler `content_publish` toma la fila con `UPDATE social_posts SET status='publishing' … WHERE id=… AND status='scheduled' RETURNING` (evita doble publicación), llama al publicador, guarda el resultado (el publicador escribe solo estado, intentos, errores, id y link), recalcula el estado del post (F17), completa los `postIds` de las automatizaciones (F27) y registra en `audit_log`. Temporales: hasta 3 reintentos a 1, 5 y 15 minutos; después `failed` + aviso `content_publish_failed`. Webhooks: `app/api/webhooks/late` suma `post.platform.published` / `post.platform.failed` / `post.published` / `post.partial` / `post.failed` (y `SUBSCRIBED_EVENTS` se amplía, sin registrarlo en el proveedor); `app/api/webhooks/postproxy` con firma (o token en la URL comparado en tiempo constante) e idempotencia en `webhook_events`.
**Criterios:**
- CUANDO el mismo job corre dos veces en paralelo, DEBE publicarse una sola vez.
- CUANDO un publicador devuelve `temporary` por tercera vez, la fila DEBE quedar `failed` con aviso.
- CUANDO llega el mismo webhook dos veces, DEBE procesarse una sola vez.
- Test: `lib/publishing/dispatcher.test.ts` y `app/api/webhooks/*.test.ts` pasan; los tests existentes siguen en verde.

#### F36: Detalle del post
**Descripción:** `/dashboard/content/[id]`: estado por red (badge, fecha, link, publicador, error en lenguaje simple, intentos, advertencias), "Reintentar" en redes fallidas, "+ Publicar en otra red" (F28), "Archivar", historial (desde `audit_log` y versiones), métricas del post (cuando existan, con link a su análisis, F51) y comentarios por red (F46). Respuestas de Threads: nice-to-have.
**Criterios:**
- CUANDO se reintenta una red `failed`, DEBE crearse un job nuevo y quedar `scheduled`; las publicadas no se tocan.
- Test: `lib/content/detail.test.ts` pasa.

#### F37: Aprobación
**Descripción:** un Member envía a revisión y se avisa a Owners y Admins (`content_review_requested`). Quien tiene `content.approve` aprueba (queda `approved`; si ya tiene redes con fecha y `content.publish`, puede aprobar y programar en un paso) o devuelve a `draft` con `review_note`, avisando al autor (`content_returned`). Cada cambio de estado crea una versión.
**Criterios:**
- CUANDO se aprueba y programa un post con 2 redes con fecha futura, DEBEN crearse 2 filas `scheduled` con sus jobs.
- CUANDO se devuelve, DEBE quedar `draft` con la nota y un aviso al autor.
- Test: `lib/content/review.test.ts` pasa.

#### F38: Prueba de publicación directa de YouTube
**Descripción:** en la card de Google, "Probar publicación directa": sube un video de 2 s (`lib/publishing/assets/youtube-probe.mp4`, < 100 KB; si no se puede generar con `ffmpeg`, ruta configurable y anotado) como `unlisted`, lee `status.privacyStatus` y lo borra. `unlisted` → `youtube_api` `available`; `private` → sigue `unverified` con el mensaje de la auditoría y el link al formulario. "Activar de todos modos" con advertencia → `available` + `manually_enabled`.
**Criterios:**
- Con `unlisted` → `available` y video borrado; con `private` → `unverified` y borrado igual; si el borrado falla → aviso "borrá el video de prueba a mano" con su link.
- Test: `lib/publishing/youtube-probe.test.ts` pasa.

#### F39: Menú de Contenido
**Descripción:** ítem "Contenido" (visible para todos) en `lib/nav/items.ts`, debajo de Flows, respetando el menú del PR #4. El ítem "Social" se suma en F54.
**Criterios:**
- CUANDO un Member entra a Contenido, DEBE ver el pipeline y poder crear ideas y posts.
- Test: `lib/nav/items.test.ts` extendido pasa.

**Bloque 4 listo cuando:** F24 a F39 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-rls.mjs` y `verify-content.mjs` salen 0; pantallas revisadas contra el prototipo o anotadas.

**Fase 1 lista cuando:** los Bloques 1 a 4 están listos y la suite completa sale 0.

---

### FASE 2: MÉTRICAS, SOCIAL Y ANUNCIOS

### Bloque 5: Recolección de métricas y comentarios

#### F40: Card de Meta y cuentas publicitarias
**Descripción:** se habilita la card `meta`: token de system user en Vault (`meta_system_user_token`, vencimiento "Nunca", permiso `ads_read`, sin verificar el negocio); en `integration_configs` (type `meta`) → `config`: Business ID, cuenta de Instagram de Graph y `ad_accounts: [{ ad_account_id, name, currency, timezone, sync_enabled, last_synced_at, last_error, first_sync_completed_at }]` (validado con Zod; **sin tabla propia**). "Probar y guardar" valida el token (`/me`) y lista las cuentas publicitarias (portado de ScaleOS) para elegir cuáles sincronizar.
**Criterios:**
- CUANDO el token es inválido, DEBE fallar sin guardar.
- CUANDO se destilda una cuenta, su `sync_enabled` DEBE quedar `false` y el cron dejar de sincronizarla.
- Test: `lib/meta/accounts.test.ts` (portado + nuevos) pasa.

#### F41: Tablas de métricas
**Descripción:** migraciones de `social_post_metrics_daily`, `social_account_metrics_daily`, `social_post_comments` y `meta_ads_insights_daily`, y de las columnas de métricas de `social_posts` (§9.3). RLS: leen quienes tienen `dashboards.content.view` / `dashboards.ads.view` (hasta B9: Owner/Admin); escribe solo el servidor.
**Criterios:**
- CUANDO un Member consulta estas tablas, NO DEBE ver filas; otro workspace tampoco.
- Test: `verify-rls.mjs` extendido sale 0.

#### F42: Lector de Zernio (Instagram y TikTok)
**Descripción:** `lib/metrics/zernio.ts` (normalización portada de ScaleOS, extendida a TikTok). Zernio expone `GET /v1/analytics` (arranque) y `GET /v1/analytics/delta` con cursor guardado en `integration_configs.config.analytics_cursor`, más el evento `analytics.synced`: el lector usa el delta y mantiene una interfaz común. Trae posts con `source=all` (incluye los publicados a mano, que entran a `social_posts` con `origin='external'`), métricas por post y seguidores por día. Vincula por `external_post_id` con las filas publicadas por el sistema. El lector escribe solo caption, miniatura, tipo de media, `last_synced_at` y las métricas.
**Criterios:**
- CUANDO un post coincide con una fila del sistema, DEBE actualizarla (no crear otra); si no, crear una `external`.
- CUANDO se recolecta dos veces el mismo día, DEBE actualizar la fila del día.
- Test: `lib/metrics/zernio.test.ts` pasa.

#### F43: Lector de Instagram Graph (stories, audiencia y alcance por audiencia)
**Descripción:** `lib/meta/instagram-graph.ts` (portado): audiencia de la cuenta (en `social_account_metrics_daily.extra`), alcance de cada post entre seguidores y no seguidores (en `social_post_metrics_daily.extra`: `reach_followers`, `reach_non_followers`) y datos de perfil. Las stories activas **no se guardan**: se consultan en vivo con caché de 15 minutos para la página Social (F54).
**Criterios:**
- CUANDO no hay token de Meta, el lector DEBE saltearse sin error.
- Test: `lib/meta/instagram-graph.test.ts` pasa.

#### F44: Lectores de YouTube y Threads
**Descripción:** `lib/metrics/youtube.ts`: suscriptores, videos (Data API) y métricas por video por día (Analytics API: views, estimatedMinutesWatched, averageViewDuration, likes, comments, shares, subscribersGained, `creatorContentType`). `lib/metrics/threads.ts` (portado): vistas, likes, respuestas, reposts, citas. Regla de YouTube: la Data API se refresca en ciclos < 30 días.
**Criterios:**
- CUANDO un video es vertical ≤ 3 min o `creatorContentType = SHORTS`, DEBE guardarse `media_type = 'short'`.
- Test: `lib/metrics/youtube.test.ts` y `threads.test.ts` pasan.

#### F45: Reglas de recolección y engagement a 7 días
**Descripción:**
1. **Historial inicial:** al conectar se trae lo que la API permita (YouTube: suscriptores ganados y perdidos por día desde el inicio del canal; Instagram: `follower_count` de 30 días; TikTok y Threads: lo que documenten). Sin historial, la serie empieza el día de conexión y el gráfico dice "Datos desde el …". Se anota en PENDIENTE qué permitió cada red.
2. **Frecuencia por antigüedad del post:** hasta 30 días, a diario; de 31 a 90, una vez por semana; más de 90, no se actualiza (YouTube sigue su regla).
3. **Días sin dato:** si una red falla, no se escribe una fila en cero; el gráfico muestra el hueco.
4. **Fecha:** la del día en la zona del workspace. Valores acumulados al día.
5. **Atraso de Instagram:** los dos últimos días se marcan "pueden subir".
6. **Engagement comparable:** `social_posts.engagement_d7`, `interactions_d7`, `reach_d7`, `views_d7`, `d7_computed_at`, calculados cuando el post cumple 7 días (o con el primer dato posterior). Antes: "en curso".
**Criterios:**
- Tests de backfill por red (API simulada), de la regla de frecuencia, del hueco (nunca un cero inventado) y del cálculo a 7 días en `lib/metrics/rules.test.ts`.

#### F46: Comentarios
**Descripción:** `social_post_comments` (§9.3). **Tiempo real:** el receptor de `comment.received` de Zernio (Instagram y TikTok) busca la cuenta también en `social_accounts` (hoy solo en `channels`, por eso rechaza TikTok), guarda el comentario (también los propios, `author.isOwnAccount`, **sin disparar flows**), lo vincula a la publicación por `account.id` + `platformPostId` (si no existe, crea la fila `external` y la próxima sincronización la completa) y sigue llamando a `processComment` como hoy (`comment_logs` no cambia). Si el autor coincide con un contacto, se completa `contact_id`. **Relectura:** el cron de métricas vuelve a leer los comentarios de los posts de hasta 30 días (Zernio `/v1/inbox/comments/{postId}`, Threads por su API, YouTube por `commentThreads.list`). LinkedIn no permite leer comentarios: se indica en pantalla. **Pantalla:** en el detalle del post y en el análisis (F51), hilo por red con Responder, Ocultar y Responder por DM; la respuesta propia aparece en el hilo.
**Criterios:**
- ANTES de tocar el receptor: caracterización (comentario de tercero dispara `processComment` igual que hoy).
- CUANDO llega un comentario de una cuenta de TikTok conectada, DEBE guardarse.
- CUANDO el comentario es propio, DEBE guardarse y NO disparar automatizaciones.
- CUANDO el post no existe en `social_posts`, DEBE crearse como `external`; un duplicado DEBE ignorarse.
- Test: `lib/comments/*.test.ts` y el test del receptor pasan.

#### F47: Cron de métricas y actualización manual
**Descripción:** cron diario `metrics-sync` (03:30 en la zona del workspace; `call_app_cron` con la lista blanca ampliada) que encola un job `metrics_sync` por cuenta social y por cuenta publicitaria; "Actualizar ahora" en los dashboards y en Social (una vez cada 15 minutos). Si un lector falla: `last_error`, se conservan los datos anteriores y la card pasa a `attention`.
**Criterios:**
- CUANDO se aprieta "Actualizar ahora" dos veces en 15 minutos, la segunda DEBE rechazarse con el tiempo restante.
- CUANDO un lector falla, los otros DEBEN correr igual.
- Test: `lib/metrics/sync.test.ts` pasa.

**Bloque 5 listo cuando:** F40 a F47 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-rls.mjs` sale 0.

---

### Bloque 6: Dashboard orgánico y página Social

#### F48: Dashboard de contenido orgánico
**Descripción:** el selector de Dashboards (componente nuevo `dashboard-switcher` en la barra superior; Chat no cambia de ruta ni de datos) habilita "Contenido orgánico" en `/dashboard/dashboards/content`. Filtros en la barra y en la URL: red (todas o una) y período (el de la Fase 3). Secciones portadas de ScaleOS y extendidas a todas las redes:
1. Encabezado con período, filtro de red, nota de atraso de Instagram y "Datos al …" por red con "Actualizar ahora".
2. KPI: Seguidores (con variación en el período), Alcance y vistas, Publicaciones, Engagement promedio, Follows orgánicos; variación contra el período anterior del mismo largo.
3. **Crecimiento de seguidores** (barras ganados/perdidos + línea de total), con selector **Día / Semana / Mes** en la tarjeta. En Día, las publicaciones del período aparecen como puntos bajo el eje (color de la red); tocar uno abre su análisis (F51).
4. **Actividad de publicación** (posts apilados por formato) con su propio selector **Día / Semana / Mes**.
5. Engagement en el tiempo, con selector Guardados, Compartidos, Comentarios, Me gusta.
6. Rendimiento por formato (Reel, Carrusel, Imagen, Story, Video, Short, Texto, Documento).
7. Explorador de tendencias (F49) y engagement a 7 días (F50).
8. Tabla "Tus posts" con miniaturas: red, formato, fecha, **Seguidores ±1 d** (F52), alcance, me gusta, comentarios, compartidos, guardados, engagement (mejor en verde, peor en rojo), engagement a 7 días, Sistema / A mano; ordenable por cualquier columna (por defecto Guardados), paginada. **Cualquier post, también los hechos a mano, abre su análisis (F51).**
9. Stories activas de Instagram (en vivo).
**Criterios:**
- CUANDO no hay datos, cada sección DEBE mostrar su estado vacío (nunca ceros de relleno).
- CUANDO se filtra por LinkedIn, DEBE mostrar "LinkedIn no ofrece métricas con esta conexión" y cuántas publicaciones se hicieron.
- CUANDO se agrupa por semana o mes, los totales DEBEN coincidir con la suma de los días (seguidores: último valor del grupo).
- Test: `lib/dashboards/content.test.ts` (agregaciones por día, semana y mes, variación, engagement, huecos, métricas no disponibles por red) pasa. "Este mes" carga en < 1,5 s con datos de prueba.

#### F49: Explorador de tendencias (doble eje por red)
**Descripción:** tarjeta de ancho completo: **barras en el eje izquierdo** y **líneas en el eje derecho**, cada una con su métrica (cualquiera puede ser "Ninguna"): Seguidores, Seguidores ganados, Alcance y vistas, Interacciones, Engagement rate, Engagement a 7 días, Guardados, Compartidos, Comentarios, Me gusta, Publicaciones, Tiempo visto (YouTube). **Una serie de barras y una línea por red**, con el color de la red; selector de redes con pastillas (LinkedIn deshabilitada con el motivo; una red sin esa métrica no dibuja esa serie). Barras apiladas o lado a lado (porcentajes y Seguidores nunca se apilan: el control se deshabilita con el motivo). Agrupar Día / Semana / Mes. "Marcar publicaciones" (solo en Día): puntos por post que abren su análisis. Atajos: "Alcance y engagement", "Seguidores ganados y publicaciones", "Interacciones y engagement a 7 días", "Seguidores por red". La configuración vive en la URL (sin tabla de vistas guardadas); "Copiar link".
**Criterios:**
- CUANDO la métrica de barras es un porcentaje, el modo apilado DEBE quedar deshabilitado.
- CUANDO se copia el link y se abre, DEBE reconstruirse la misma configuración (ida y vuelta).
- Test: `lib/dashboards/explorer.test.ts` pasa.

#### F50: Engagement a 7 días por semana de publicación
**Descripción:** gráfico fijo: por semana de publicación, promedio de `engagement_d7` por red; la semana en curso se marca "en curso".
**Criterios:**
- CUANDO una semana tiene posts de menos de 7 días, DEBE marcarse en curso.
- Test: incluido en `lib/dashboards/content.test.ts`.

#### F51: Análisis histórico de un post
**Descripción:** panel lateral que se abre desde la tabla y las miniaturas del dashboard, los puntos de los gráficos, la grilla de Social y el detalle del post. Flechas anterior/siguiente dentro de la lista de origen; Esc cierra.
- Encabezado: red, formato, fecha, antigüedad, Sistema / A mano; "Ver en la red" y, si es del sistema, "Abrir en Contenido".
- Métricas actuales (grilla de `PostMetricsGrid`): Alcance, Vistas (video), Interacciones, Me gusta, Comentarios, Compartidos, Guardados (no en YouTube), Engagement, Engagement a 7 días ("en curso" antes).
- **Evolución desde la publicación** con selector de métrica: barras = nuevos por día (eje izquierdo), línea = acumulado (eje derecho), línea punteada = promedio de los posts del mismo formato y red a la misma edad. Eje X "día 0, día 1…". Sale de las fotos de `social_post_metrics_daily` (diarias hasta 30 días, semanales hasta 90).
- Seguidores alrededor de la publicación (F52).
- Alcance por audiencia (solo Instagram): seguidores vs. no seguidores con la frase de ScaleOS (> 60 % no seguidores = "alto alcance a gente nueva").
- Comentarios recientes (F46) con "Ver todos y responder".
**Criterios:**
- CUANDO hay fotos acumuladas con un día faltante, los nuevos por día DEBEN repartirse sin inventar valores negativos ni ceros.
- CUANDO el post pasa los 30 días, los puntos siguientes DEBEN ser semanales.
- Test: `lib/dashboards/post-analysis.test.ts` pasa.

#### F52: Seguidores alrededor de la publicación
**Descripción:** las redes no dicen cuántos seguidores trajo un post. Se muestra **cuánto creció la cuenta ese día y el siguiente comparado con lo normal**, como señal y no como atribución (y así se rotula). Cálculo desde `social_account_metrics_daily`, en la zona del workspace: `sumados` = seguidores netos del día de la publicación + el siguiente; `normal` = mediana diaria de las 28 jornadas anteriores × 2; `ratio` = sumados ÷ normal. En la tabla: columna "Seguidores ±1 d" con `+N` y la insignia `1,8×` (verde desde 1,5×), ordenable. En el análisis: las tres cifras, un gráfico de ±7 días con los dos días resaltados y la mediana punteada, y la frase "Salto: …", "Dentro de lo normal" o "Por debajo de lo normal". Contexto que se muestra: otros posts de la misma red en esas 48 h (el salto es compartido, con links) y, en Instagram, si hubo gasto en Meta Ads esos días. Casos borde: si el día siguiente no terminó, "parcial"; si `normal` < 3 (cuenta chica), solo `+N` sin ratio; LinkedIn no aplica. Se calcula al leer (vista o función SQL); no se guarda por post.
**Criterios:**
- Tests del cálculo con zona horaria, del caso parcial, de la base mínima, de la detección de posts vecinos y de que el ratio no aparece si falta el dato del día, en `lib/dashboards/follower-bump.test.ts`.

#### F53: Datos al día
**Descripción:** "Datos al [fecha y hora]" por red y aviso si una red falló en la última recolección, con la fecha del último dato bueno. Aplica al dashboard orgánico y a Social.
**Criterios:**
- CUANDO la última recolección de una red falló, DEBE verse su aviso.
- Test: incluido en `lib/dashboards/content.test.ts`.

#### F54: Página Social
**Descripción:** ítem de menú **Social** (debajo de Contenido; permiso `social.view`, por defecto Owner y Admin), en `/dashboard/social`. Réplica del perfil de Instagram de ScaleOS (`InstagramPanel`, `IgProfileBar`, `IgPostTile`) extendida a todas las redes.
- **Barra superior:** selector de red (solo las conectadas en el workspace), filtro de formato de esa red (p. ej. Reels / Carruseles / Imágenes), "Analíticas" (abre el dashboard orgánico filtrado por esa red) y Actualizar.
- **Perfil:** foto, usuario, nombre, bio, link, cifras de cada red (IG: publicaciones, seguidores, seguidos · TikTok: siguiendo, seguidores, me gusta · YouTube: suscriptores, videos, vistas · Threads: seguidores), tendencia de seguidores a 30 días con mini gráfico, y de dónde salen los datos y cuándo se sincronizaron.
- **Stories** (solo Instagram): en vivo con caché de 15 minutos.
- **Grilla** como en cada red (IG 3:4, TikTok 9:16, YouTube 16:9 con título; Threads como lista de textos): tipo (Reel, carrusel, video, Short), vistas o alcance, "A mano" si no salió del sistema; al pasar el mouse o con foco, me gusta, comentarios, compartidos, alcance, guardados y engagement. Tocar abre el análisis (F51). Sale de `social_posts` (sistema + externos) con su última foto.
- **Próximas:** al principio de la grilla, con borde punteado, lo programado y lo tentativo para esa red (F25); tocar abre el post en Contenido.
- **LinkedIn:** perfil y lista de lo publicado desde el sistema con su estado; sin métricas ni seguidores (aviso fijo). Red no conectada: "Conectá tu cuenta" con link a Integraciones.
**Criterios:**
- CUANDO se elige una red, la grilla DEBE mostrar solo sus publicaciones (sistema + externas) ordenadas por fecha, y el filtro de formato DEBE aplicarse.
- CUANDO hay publicaciones programadas o tentativas para esa red, DEBEN aparecer primero.
- CUANDO un Member entra, NO DEBE ver el ítem ni la página.
- Test: `lib/social/profile-page.test.ts` pasa; RLS de lectura cruzada en `verify-rls.mjs`.

**Bloque 6 listo cuando:** F48 a F54 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-rls.mjs` sale 0; pantallas revisadas contra el prototipo o anotadas.

---

### Bloque 7: Meta Ads y dashboard unificado

#### F55: Sincronización de insights
**Descripción:** job `meta_ads_sync` por cuenta con `sync_enabled`: insights diarios a nivel cuenta, campaña, ad set y anuncio en `meta_ads_insights_daily` (§9.3): gasto, impresiones, alcance, clics, clics salientes, clics en enlace, leads, compras y su valor, métricas de video, rankings, estado. Últimos 3 días en cada corrida diaria (Meta corrige datos recientes) y **90 días** al activar una cuenta. **Paginación completa** (sin tope de 50 filas); los ad sets traen `campaign_id` y los anuncios `adset_id` y `campaign_id`. Respeta los límites del nivel Development (`x-business-use-case-usage`).
**Criterios:**
- CUANDO se sincroniza el mismo día dos veces, DEBE actualizar sin duplicar.
- CUANDO Meta responde código 17 o 80004, DEBE reintentar más tarde (`temporary`).
- CUANDO la API devuelve 3 páginas, DEBEN guardarse todas las filas.
- Test: `lib/meta/insights.test.ts` pasa.

#### F56: Dashboard de Meta Ads (cuenta)
**Descripción:** réplica de `AdsPanel` de ScaleOS en `/dashboard/dashboards/ads`, adaptada a los componentes del fork. Barra superior: selector de cuenta publicitaria (si hay más de una; **la cuenta elegida viaja a todos los niveles**), período y "✦ Analizar con IA" (F61). Secciones:
1. 8 KPI: Gasto total, Impresiones, Alcance, Frecuencia, Clics (con CTR), CPM, CPC, Leads (con CPL); variación contra el período anterior del mismo largo.
2. Evolución diaria de dos ejes: barras a la izquierda (Gasto, Impr., Clics, Alcance, Leads, CPM, CPC; por defecto Gasto), línea a la derecha (CTR, Gasto, Impr., Clics, Leads, CPM, CPC; por defecto CTR).
3. Comparativa por campaña (barras horizontales apiladas por anuncio; Gasto, Alcance, Clics o Leads) y Costo por campaña (líneas diarias de CPC o CPL).
4. Cuatro tarjetas: Acciones generadas, Por placement (top 5, Gasto o CTR, mejor y peor CTR), Por dispositivo (gasto y CTR), Retención de video (calculada sobre reproducciones).
5. Audiencia: edad y género.
6. Desglose en pestañas Campañas, Ad sets, Anuncios (columnas de ScaleOS, fila Total, tooltips en los encabezados, **estado real**, orden por cualquier columna). Clic en una fila abre su detalle.
7. Métricas por día: tabla ordenable con fila Total.
**Fórmulas (las de ScaleOS):** Frecuencia = Impresiones ÷ Alcance; CTR = Clics ÷ Impresiones × 100; CPM = Gasto ÷ Impresiones × 1000; CPC = Gasto ÷ Clics; CPL = Gasto ÷ Leads ("—" sin leads). Leads = acciones cuyo tipo contiene `lead` o `complete_registration`. CTR en tablas: verde > 3,5 %, rojo < 2 %. Leads en 0: rojo y negrita. Montos en la moneda de la cuenta. Alcance y frecuencia del período: el alcance único que da Meta para el rango (no la suma diaria). La columna "Conv." muestra compras reales (o no aparece). Nada de valores fijos.
**Criterios:**
- CUANDO no hay cuentas sincronizadas, DEBE mostrar un estado vacío con link a Integraciones.
- CUANDO leads es 0, el CPL DEBE mostrarse "—".
- Test: `lib/dashboards/ads.test.ts` (fórmulas, umbrales, leads por tipo de acción, delta contra período anterior, orden) pasa.

#### F57: Detalles de campaña, ad set y anuncio
**Descripción:** rutas `dashboards/ads/campaigns/[id]`, `dashboards/ads/adsets/[id]` (**nueva: ScaleOS no la tiene**) y `dashboards/ads/ads/[id]`, con migas de pan Meta Ads › Campaña › Ad set › Anuncio. Los KPI se recalculan al cambiar el período.
- **Campaña** (como `CampaignDetailPanel`): objetivo en español, barra de presupuesto (diario o total, gastado y restante), 8 KPI, evolución diaria, comparativa y costo por anuncio, las cuatro tarjetas filtradas por la campaña, audiencia, rendimiento por hora, funnel (Impresiones → Clics salientes → Leads → Compras, con ROAS y valor si hay), pestañas **solo con sus** ad sets y anuncios, métricas por día.
- **Ad set:** misma plantilla, con presupuesto y optimización del ad set y la tabla de sus anuncios.
- **Anuncio** (como `AdDetailPanel`): tipo de creativo, selector para saltar a otro anuncio de la misma campaña, 8 KPI (Clics "Salientes"), evolución, Acciones, Placement, Rankings (Calidad, Engagement, Conversión), Retención de video del anuncio, audiencia, por hora, funnel, métricas por día y **vista previa del creativo** (miniatura o video, título, texto y llamado a la acción).
**Criterios:**
- CUANDO se abre una campaña, DEBEN verse solo sus ad sets y anuncios.
- CUANDO se abre el detalle con otra cuenta elegida, DEBE consultarse esa cuenta.
- Test: `lib/dashboards/ads-detail.test.ts` pasa.

#### F58: Datos en vivo con caché
**Descripción:** lo que no se guarda por día se consulta a Meta al abrir la pantalla, con **caché de 15 minutos** en memoria del servidor por cuenta, nivel, objeto y período: alcance y frecuencia únicos del período, desgloses por edad y género, hora, placement y dispositivo, metadatos (objetivo, presupuesto, estado) y creativo. Si una consulta en vivo falla, solo esa tarjeta muestra el error.
**Criterios:**
- CUANDO se pide lo mismo dos veces en 15 minutos, DEBE responderse desde la caché.
- CUANDO falla el desglose por edad, las demás tarjetas DEBEN mostrarse.
- Test: `lib/meta/live.test.ts` pasa.

#### F59: Dashboard unificado
**Descripción:** opción "Unificado": por período, alcance orgánico vs pagado, interacciones, seguidores ganados, gasto y leads, y una serie diaria combinada.
**Criterios:**
- CUANDO falta una de las dos fuentes, DEBE mostrarse la otra con un aviso.
- Test: `lib/dashboards/unified.test.ts` pasa.

#### F60: Leads por campaña (nice-to-have)
**Descripción:** cruza `contacts.attribution` (jsonb con `ad_id` y `campaign_id`) con las campañas: contactos creados por campaña en el período.
**Criterios:**
- CUANDO un contacto tiene el `campaign_id` de una campaña sincronizada, DEBE contarse en ella.
- Test: `lib/dashboards/ads-leads.test.ts` pasa.

#### F61: Analizar con IA (nice-to-have, último del bloque)
**Descripción:** panel lateral como `AdsAIChatPanel`: arma el contexto en texto (período, totales, hasta 10 campañas, 15 ad sets y 15 anuncios), usa el proveedor de IA del workspace, registra el costo y respeta sus topes, y guarda los análisis anteriores.
**Criterios:**
- CUANDO se analiza, el costo DEBE registrarse en el workspace; con el tope superado, DEBE rechazarse.
- Test: `lib/meta/ai-analysis.test.ts` pasa (proveedor simulado).

**Bloque 7 listo cuando:** F55 a F59 (F60 y F61 si se llegó) cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-rls.mjs` sale 0; pantallas revisadas en 1440 y 390 px o anotadas.

**Fase 2 lista cuando:** los Bloques 5 a 7 están listos y la suite completa sale 0.

---

### FASE 3: EMAIL ENTRANTE Y ROLES

### Bloque 8: Email como canal

#### F62: Canal Email y cambios de esquema
**Descripción:** migración: `channels.platform` suma `email`; `channels.provider` suma `resend`; `channels.email_address`; el canal Email guarda `late_account_id = 'email:<dirección>'` (**el NOT NULL queda intacto**); `messages` suma `email_subject`, `email_message_id` (índice), `email_in_reply_to`, `email_references`, `email_from`, `email_to`, `email_cc` (jsonb). La card `resend_inbound` (secreto `resend_inbound_webhook_secret` en Vault, dirección de entrada en `config`) crea el canal. `lib/platforms.ts` suma `email`.
**Criterios:**
- CUANDO se crea el canal Email, DEBE existir uno solo por workspace.
- Los tests de canales y `verify-inbox-filters.mjs` DEBEN seguir en verde.
- Test: `lib/email/channel.test.ts` pasa.

#### F63: Recepción de email
**Descripción:** `app/api/webhooks/resend-inbound`: verifica la firma Svix (`svix-id`, `svix-timestamp`, `svix-signature`; HMAC-SHA256 base64 sobre `id.timestamp.body`, varias firmas `v1,`, tolerancia 5 min), idempotencia por `svix-id` en `webhook_events`, responde 200 y procesa con `after()`: trae el contenido (`emails.receiving.get`), copia los adjuntos a Storage (`email-attachments`) antes de que venzan sus links, detecta email automático, busca o crea el contacto con `upsertContactForSender`, busca o crea la conversación del canal Email, guarda el mensaje con las funciones de `lib/inbound.ts` (`direction = 'inbound'`, `origin = 'external'`), aplica opt-out, actualiza `last_message_at` y `unread_count`, y dispara `email_received` si existe (F67). **No agenda turnos del agente.**
**Criterios:**
- CUANDO la firma es inválida o el timestamp tiene más de 5 minutos, DEBE responder 401 sin procesar.
- CUANDO llega el mismo `svix-id` dos veces, DEBE guardarse un solo mensaje.
- CUANDO el email es automático (`Auto-Submitted` distinto de `no`, `Precedence: bulk|auto_reply|list`, remitente `no-reply`/`mailer-daemon`), DEBE guardarse sin crear contacto ni disparar flows.
- CUANDO entra un email, `maybeScheduleAgentTurn` NO DEBE llamarse (test con espía).
- Test: `lib/email/inbound.test.ts` y el test de la ruta pasan.

#### F64: Email en la bandeja
**Descripción:** conversaciones del canal Email con ícono de sobre, filtros y asignación como las demás; en el hilo, asunto, remitente y adjuntos (descarga con URL firmada). El scope de leads aplica igual.
**Criterios:**
- CUANDO se filtra por Email, DEBEN verse solo esas conversaciones; un Member sin el contacto asignado NO DEBE verlas.
- Test: `lib/inbox/filters.test.ts` extendido + `verify-inbox-filters.mjs` y `verify-rls.mjs` salen 0.

#### F65: Responder email
**Descripción:** rama explícita `provider === "resend"` en `lib/flow-engine/send.ts` y `app/api/v1/messages/route.ts`. Envía por Resend desde la dirección de entrada, con `Re: <asunto>` (sin duplicar), `In-Reply-To` y `References`, texto con HTML simple. Se guarda como saliente con el `email_message_id` devuelto. Contacto con "no contactar": aviso antes de enviar. Un flow con "Enviar mensaje" sobre una conversación de email responde por email o rechaza con error claro.
**Criterios:**
- CUANDO se responde, DEBE incluir `In-Reply-To` = id del último entrante y `References` acumulado.
- CUANDO Resend falla, el mensaje DEBE quedar `failed` con opción de reintentar.
- Test: `lib/email/reply.test.ts` pasa.

#### F66: Cuota de Resend
**Descripción:** barra de uso en la card: emails de hoy (entrada + salida) sobre 100 (configurable en `config.daily_quota`); al 90 %, `integration_attention` (una por día).
**Criterios:**
- CUANDO se llega a 90 de 100, DEBE crearse un aviso por día.
- Test: `lib/email/quota.test.ts` pasa.

#### F67: Trigger "email recibido" en flows (nice-to-have)
**Descripción:** trigger `email_received` en el flow registry, con filtro opcional por asunto.
**Criterios:**
- CUANDO entra un email no automático y hay un flow activo con ese trigger, DEBE iniciarse una sesión.
- Test: el test de triggers extendido pasa.

**Bloque 8 listo cuando:** F62 a F66 (F67 si se llegó) cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-rls.mjs` y `verify-inbox-filters.mjs` salen 0; pantallas revisadas o anotadas.

---

### Bloque 9: Roles personalizados

#### F68: Catálogo de permisos
**Descripción:** `lib/auth/permissions.ts` (patrón de ScaleOS): `PERMISSION_KEYS` por módulo con etiqueta en español, `SYSTEM_ROLE_PERMISSIONS` (owner: todos; admin: todos salvo transferir ownership; member: exactamente lo de hoy) y funciones puras `can`, `canAny`, `scopeFor`. Claves: `dashboards.chat.view`, `dashboards.content.view`, `dashboards.ads.view`, `social.view`, `inbox.instagram.view/reply`, `inbox.whatsapp.view/reply`, `inbox.email.view/reply`, `contacts.view/edit/import/delete`, `flows.view/edit`, `sequences.view/edit`, `broadcasts.manage`, `templates.manage`, `agents.view/edit`, `ai_costs.view`, `knowledge.view/edit`, `content.view`, `content.create`, `content.approve`, `content.publish`, `content.ai`, `integrations.manage`, `team.manage`, `roles.manage`, `settings.manage`. Alcances `leads` y `conversations`: `own` | `all`.
**Criterios:**
- ANTES de tocar guards o menú: `lib/auth/member-baseline.test.ts` fija lo que hoy puede un Member (§3.4) recorriendo páginas y acciones; `SYSTEM_ROLE_PERMISSIONS.member` DEBE coincidir.
- CUANDO una clave no existe, `can` DEBE devolver `false`.
- Test: `lib/auth/permissions.test.ts` pasa.

#### F69: Tablas y funciones de roles
**Descripción:** migración `workspace_roles` (§9.8) con los 3 roles de sistema por workspace (backfill), `workspace_members.role_id` (backfill), `has_permission(workspace_id, key)` y `permission_scope(workspace_id, module)` (`SECURITY DEFINER`, `SET search_path = ''`), trigger que impide editar roles de sistema. Otra migración reescribe **solo el cuerpo** de `can_see_contact` y `can_see_conversation`: Owner/Admin → todo; alcance `all` → todo; `own` → la lógica actual. Se aplica **después** de `verify-rls.mjs` en verde, y se vuelve a correr.
**Criterios:**
- DADO los roles de sistema recién creados, ENTONCES `verify-rls.mjs` sale 0 sin cambiar sus aserciones.
- DADO un rol personalizado con alcance `all` en leads, ENTONCES esa persona ve todos los contactos.
- Test: `scripts/verify-roles.mjs` (nuevo, con usuarios reales y limpieza) sale 0.

#### F70: Guards y menú por permiso
**Descripción:** `requirePermission(key)` y `getPermissionContext()` en `lib/auth/guards.ts`, junto a `requireWorkspaceAdmin` y `getAdminContext` (que se mantienen, implementados sobre permisos). Verifican permisos las Server Actions de contenido (incluida la IA), integraciones, roles, dashboards de contenido y Ads, Social y email. `PermissionGate` en la interfaz. El menú filtra por permiso en lugar de `adminOnly`.
**Criterios:**
- CUANDO alguien sin `integrations.manage` llama a guardar integración, DEBE responder "sin permiso" sin tocar Vault.
- CUANDO un rol con `content.publish` programa, DEBE poder; sin él, solo enviar a revisión. Sin `content.ai`, el botón de IA no aparece.
- Los tests de caracterización de F68 siguen en verde.
- Test: `lib/auth/guards.test.ts` pasa.

#### F71: Pantalla de roles
**Descripción:** `/dashboard/settings/roles`: roles de sistema (solo lectura) y personalizados con cantidad de personas. Crear/editar: nombre, descripción, permisos por módulo ("todos" por módulo) y alcance de leads y conversaciones. Borrar un rol con personas exige reasignarlas. Advertencia si no tiene ningún permiso. "+ Nuevo rol" en la barra superior.
**Criterios:**
- CUANDO se intenta borrar un rol con personas, DEBE bloquearse con la lista; editar uno de sistema, rechazarse. Todo cambio queda en `audit_log`.
- Test: `lib/auth/roles-admin.test.ts` pasa.

#### F72: Asignar rol a una persona
**Descripción:** en Equipo, el selector de rol de un miembro con base `member` ofrece "Member" y los roles personalizados. No se puede quitar al último Owner.
**Criterios:**
- CUANDO se asigna un rol personalizado, `role_id` DEBE cambiar y `role` seguir en `member`.
- Test: `lib/actions/team.test.ts` (nuevo) pasa.

**Bloque 9 listo cuando:** F68 a F72 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-rls.mjs`, `verify-roles.mjs` y `verify-crm.mjs` salen 0; pantallas revisadas o anotadas.

**Fase 3 lista cuando:** los Bloques 8 y 9 están listos.

---

### Definición de "listo" de toda la Etapa 2
`docs/PROGRESS.md` tiene los 9 bloques y F1 a F72 marcados (las nice-to-have F60, F61, F67 y las respuestas de Threads de F36 pueden quedar anotadas en PENDIENTE); `npx vitest run`, `npm run build`, `npm run lint` (sin errores nuevos respecto del punto de partida), `node scripts/verify-rls.mjs` (con lectura cruzada entre dos workspaces en cada tabla y bucket nuevos), `node scripts/verify-content.mjs`, `node scripts/verify-roles.mjs`, `node scripts/verify-crm.mjs`, `node scripts/verify-inbox-filters.mjs` y `node scripts/verify-dashboards.mjs` salen 0; ningún test que pasaba en el punto de partida se rompió; `.env.example`, `CLAUDE.md`, `docs/integraciones.md` (nuevo), `docs/publicacion.md` (nuevo), `docs/contenido.md` (nuevo: ideas, IA, versiones, fecha por red, palabras clave), `docs/dashboards.md` y la bitácora están actualizados; `docs/referencia/` fue borrada; las migraciones no aplicadas y todo lo que quedó sin hacer están en `docs/PENDIENTE.md`.

---

## 8. Flujos principales

### 8.1 Conectar YouTube (Google + Postproxy)
1. Admin abre Settings → Integraciones → sección Google → "Conectar".
2. El modal muestra la dirección de retorno y los pasos para crear el cliente OAuth. Pega Client ID y Secret → "Guardar y conectar con Google".
3. Google pide permisos; vuelve con `?connected=google`. La card muestra el canal, los permisos y "Publicación directa: sin probar".
4. Admin conecta Postproxy. Se sincroniza: YouTube publica por Postproxy por defecto.
5. (Opcional) "Probar publicación directa".

### 8.2 De la idea a la publicación
1. Member: Contenido → "+ Nueva idea" (título, hook, ángulo, formato). Queda "Esperando aprobación".
2. Admin, en la tarjeta: "✦ Aprobar y producir copy". Se crea el post en Borrador y la IA escribe guion, caption base y caption por red (versión con autor "IA").
3. El equipo revisa y edita el guion; graba; marca el material "Grabado" → En producción. Sube el video, pone fecha a Instagram (lun 18:00, CTA "Comentá SISTEMA": ✓ automatización activa), a TikTok (misma fecha) y a LinkedIn (mar 09:00, carrusel propio y CTA a DM). Todas quedan con **fecha tentativa** (borde punteado en el calendario).
4. Envía a revisión; Admin aprueba y toca "Programar 3 redes con fecha": se crean 3 filas en `social_posts` y 3 jobs.
5. A la hora, el dispatcher publica cada red por su publicador; la de Instagram completa los `postIds` de la automatización "SISTEMA".
6. Si TikTok falla por un error temporal, reintenta a los 1, 5 y 15 minutos; si sigue fallando, el post queda "Parcial" y llega un aviso.
7. Una semana después, desde el post publicado, "+ Publicar en otra red" → YouTube, con su fecha. El post sigue en Publicado con "↻ YouTube programado". En el calendario aparece ese día con ↻ y cuenta como publicación, no como pieza nueva.

### 8.3 Métricas y comentarios
1. 03:30 (zona del workspace) el cron encola un job por cuenta social y por cuenta publicitaria.
2. Cada job lee su fuente, guarda el día (sin ceros si falla), vincula los posts del sistema, calcula el engagement a 7 días de los que cumplieron 7 y relee comentarios de los posts de hasta 30 días.
3. Los comentarios nuevos llegan además en tiempo real por el webhook de Zernio.

### 8.4 Analizar un post
1. En Dashboards → Contenido orgánico, la tabla muestra "Seguidores ±1 d: +63 · 1,5×" en un reel.
2. Al tocarlo se abre el análisis: métricas, evolución desde el día 0 comparada con el promedio de los reels, el gráfico de seguidores ±7 días con "Salto: 1,5× lo normal" y el aviso de que ese mismo día salió otro post y hubo anuncios activos.

### 8.5 Email entrante y respuesta
1. Un cliente escribe a `hola@mail.dominio.com`. Resend avisa; el sistema verifica la firma, responde 200 y procesa.
2. Se vincula al contacto por email, se guardan mensaje y adjuntos, la conversación sube en la bandeja.
3. El setter responde desde la bandeja; sale por Resend con el hilo correcto.

### 8.6 Rol "Community Manager"
1. Owner → Settings → Roles → "+ Nuevo rol": Contenido (ver, crear, publicar, IA), Social, Dashboards de contenido, Bandeja Instagram (ver, responder), conversaciones "solo lo mío".
2. Lo asigna. Esa persona genera guiones, programa sin aprobación, ve Social y el dashboard de contenido, y solo sus conversaciones de Instagram.

---

## 9. Modelo de datos

> **11 tablas nuevas.** Todas con `id uuid default gen_random_uuid()`, `workspace_id` con FK y `on delete cascade`, `created_at`, `updated_at` (trigger existente) y RLS por workspace. Las columnas jsonb se validan con Zod al escribir. Índices en columnas de filtro y orden.

**Se reutiliza (no se crea nada equivalente):** `scheduled_jobs` (publicar, chequear, métricas, Meta, copy con IA), `notifications` con `createNotificationOnce`, `audit_log`, `integration_configs` + Vault (toda configuración y secreto, por workspace; también las cuentas publicitarias de Meta), la infraestructura de IA de la Fase 3 (proveedor del workspace, costos, topes) y `comment_logs` (log de automatizaciones).

**No se crean** (decisiones de diseño): `oauth_states` (el `state` es un token firmado, F9), `social_account_publishers` (columna jsonb), `content_post_media` (columna jsonb), `content_post_targets` (lo reemplaza `social_posts`), `meta_ad_accounts` (va en `integration_configs`).

### 9.1 Integraciones y conexiones

| Tabla / cambio | Campos | Notas |
|---|---|---|
| `integration_configs` (cambio) | CHECK `type` suma `social_network`, `publishing_service`, `google`, `meta` | Aditivo. Meta: `config.ad_accounts` (F40); Zernio: `config.analytics_cursor` |
| `oauth_connections` (nueva) | `provider` (`google`, `linkedin`, `threads`), `user_id` (nullable: null = del workspace), `external_account_id`, `account_label`, `granted_scopes text[]`, `token_expires_at`, `refresh_expires_at`, `status` (`active`, `attention`, `revoked`, `error`), `last_error`, `last_refreshed_at`, `vault_secret_prefix` | Único `(workspace_id, provider, coalesce(user_id, '0000…'))`. Tokens solo en Vault. Solo Owner/Admin |
| `social_accounts` (nueva) | `platform` (`instagram`, `tiktok`, `youtube`, `linkedin`, `threads`), `handle`, `username`, `display_name`, `avatar_url`, `bio`, `profile_url`, `website`, `external_id`, `channel_id` (FK nullable a `channels`, Instagram), `default_publisher`, `publishers jsonb` (`[{ publisher, account_ref, status, status_reason, verified_at, manually_enabled }]`), `is_active`, `profile_synced_at` | Único `(workspace_id, platform)` en esta etapa |
| `workspaces` (cambio) | `content_media_retention_days int default 30` | Aditivo. La voz de marca para la IA va en la configuración de IA existente |

### 9.2 Contenido

| Tabla | Campos | Notas |
|---|---|---|
| `content_ideas` (nueva) | `title`, `hook`, `angle`, `format`, `pillar`, `reference`, `notes`, `status` (`nueva`, `aprobada`, `descartada`), `source` (`manual`, `agent`), `position`, `created_by`, `approved_by`, `approved_at`, `discarded_reason`, reservados nullable para la Etapa 3: `score`, `target_audience`, `awareness_level`, `embedding` | Índice `(workspace_id, status, position)` |
| `content_posts` (nueva) | `idea_id` (nullable), `title`, `format`, **`copy jsonb`** `{ hook, body, cta, recording_notes }`, **`caption`**, **`networks jsonb`** `[{ platform, planned_at, caption (null = base), media (null = base), cta { type: comment|dm|link|none, keyword }, options, publisher, youtube_title }]`, **`media jsonb`** `[{ storage_path, mime_type, kind, size_bytes, width, height, duration_ms, is_cover, alt_text, deleted_at }]`, **`material_status`** (`pendiente`, `grabado`, `editado`, `listo`), `copy_source` (`manual`, `ai`, `mixed`), `ai_unreviewed boolean`, `status` (§9.4), `current_version`, `position`, `created_by`, `approved_by`, `approved_at`, `review_note`, `source` (`manual`, `agent`), `archived_at`, `deleted_at` | Soft delete; índices `(workspace_id, status, position)` |
| `content_post_versions` (nueva) | `post_id`, `version_no`, `snapshot jsonb` (título, formato, copy, caption, networks, media), `author_kind` (`human`, `ai`, `system`), `author_id`, `reason` (`status_change`, `manual_save`, `resume_after_idle`, `ai_generation`, `restore`) | Único `(post_id, version_no)`. Máximo 50 por post |
| `social_posts` (nueva) | `content_post_id` (nullable), `social_account_id`, `platform`, `publisher`, `publisher_ref`, `origin` (`system`, `external`), `status` (`scheduled`, `publishing`, `published`, `failed`, `cancelled`; null en externas), `scheduled_at`, `attempts`, `last_error`, `last_error_kind` (`temporary`, `permanent`), `requested_visibility`, `actual_visibility`, `warning`, `external_post_id`, `url`, `published_at`, `caption`, `media_type` (`image`, `carousel`, `reel`, `story`, `video`, `short`, `text`, `document`), `thumbnail_url`, `last_synced_at`, `sync_error`, `deleted_at`, y métricas a 7 días (§9.3) | Una fila por red y post, creada **al programar esa red**; las externas entran con `content_post_id` nulo. Únicos parciales `(content_post_id, platform)` y `(social_account_id, external_post_id)`. Índice `(workspace_id, publisher, published_at)` para cuotas. Solo escribe el servidor |

### 9.3 Métricas, comentarios y anuncios

| Tabla / cambio | Campos | Notas |
|---|---|---|
| `social_posts` (columnas) | `engagement_d7 numeric`, `interactions_d7`, `reach_d7`, `views_d7`, `d7_computed_at` | F45 |
| `social_post_metrics_daily` (nueva) | `social_post_id`, `date`, `views`, `impressions`, `reach`, `likes`, `comments`, `shares`, `saves`, `watch_time_seconds`, `avg_view_duration_seconds`, `engagement_rate numeric`, `extra jsonb` (`reach_followers`, `reach_non_followers`, …) | Valores acumulados al día. Único `(social_post_id, date)` |
| `social_account_metrics_daily` (nueva) | `social_account_id`, `date`, `followers`, `followers_gained`, `followers_lost`, `impressions`, `reach`, `profile_views`, `extra jsonb` (audiencia) | Único `(social_account_id, date)`. Base de F52 |
| `social_post_comments` (nueva) | `social_post_id`, `platform`, `external_comment_id`, `parent_external_comment_id`, `author_external_id`, `author_username`, `author_name`, `author_avatar_url`, `is_own`, `text`, `commented_at`, `like_count`, `hidden`, `deleted_at`, `contact_id` (nullable), `source` (`webhook`, `sync`) | Único `(workspace_id, platform, external_comment_id)` |
| `meta_ads_insights_daily` (nueva) | `ad_account_id`, `level` (`account`, `campaign`, `adset`, `ad`), `object_id`, `object_name`, `parent_name`, `campaign_id`, `adset_id`, `date`, `spend numeric`, `impressions`, `reach`, `clicks`, `outbound_clicks`, `link_clicks`, `ctr`, `cpc`, `cpm`, `leads`, `purchases`, `purchase_value numeric`, `video_p25`, `video_p50`, `video_p75`, `video_p95`, `video_p100`, `thruplays`, `video_avg_time_seconds numeric`, `quality_ranking`, `engagement_ranking`, `conversion_ranking`, `status`, `effective_status`, `actions jsonb` | Único `(workspace_id, level, object_id, date)` |

### 9.4 Estados del post y transiciones

| Desde → Hacia | Quién (hasta B9) | Quién (desde B9) |
|---|---|---|
| Crear idea o post | Todos | `content.create` |
| Idea `nueva` → `aprobada` (crea post) / `descartada` | Owner/Admin | `content.approve` (+ `content.ai` para "producir copy") |
| `draft` ↔ `in_production` | Autor u Owner/Admin | `content.create` (sus posts) |
| `draft` / `in_production` → `in_review` | Todos (sus posts) | `content.create` |
| `in_review` → `draft` (devolver) | Owner/Admin | `content.approve` |
| `in_review` → `approved` | Owner/Admin | `content.approve` |
| Programar una red (`approved` o con permiso) → fila `scheduled` | Owner/Admin | `content.publish` |
| Desprogramar una red | Owner/Admin | `content.publish` |
| `scheduled` → `publishing` → `published` / `partially_published` / `failed` (derivado de sus redes) | Sistema | Sistema |
| Reintentar una red fallida | Owner/Admin | `content.publish` |
| Redistribuir (agregar una red a un publicado) | Owner/Admin | `content.publish` |
| Archivar (`archived_at`) | Owner/Admin o el autor si no está publicado | `content.publish` o autor |

### 9.5 Opciones por red (`networks[].options`)
- **Instagram:** `contentType` (`feed` | `carousel` | `reel` | `story`), `shareToFeed`, `collaborators[]`, `coverOffsetMs`.
- **TikTok:** `mode` (`public` | `draft`), `allowComment`, `allowDuet`, `allowStitch`, `commercialContentType`, `coverOffsetMs`.
- **YouTube:** `visibility` (`public` | `unlisted` | `private`), `madeForKids`, `format` (`video` | `short`, calculado), `tags[]` (el título va en `youtube_title`).
- **LinkedIn:** `postType` (`text` | `image` | `multi_image` | `video` | `document`), `documentTitle`.
- **Threads:** `threadItems[]`, `replyControl`.

### 9.6 Límites de validación (`lib/content/limits.ts`)

| Red | Texto | Media | Diario |
|---|---|---|---|
| Instagram | 2.200 caracteres | Imagen ≤ 8 MB; carrusel 2 a 10; Reel ≤ 90 s y ≤ 300 MB; Story video ≤ 60 s y ≤ 100 MB; requiere media | 100 posts |
| TikTok | 2.200 caracteres | Video 3 s a 10 min, ≤ 4 GB; carrusel hasta 35 fotos ≤ 20 MB c/u | 15 videos + 15 fotos |
| YouTube | Título ≤ 100, descripción ≤ 5.000 | Requiere 1 video; vertical ≤ 3 min = Short | 100 (API oficial); Postproxy 10/mes (gratis) |
| LinkedIn | 3.000 caracteres | Hasta 20 imágenes; video 3 s a 30 min, ≤ 500 MB, MP4; PDF ≤ 100 MB y ≤ 300 páginas | 150 llamadas por persona |
| Threads | 500 caracteres por parte | Carrusel hasta 10; video ≤ 5 min | 250 posts |

### 9.7 Email

| Cambio | Detalle |
|---|---|
| `channels` | `platform` + `email`; `provider` + `resend`; `email_address text`; `late_account_id = 'email:<dirección>'` (NOT NULL intacto) |
| `messages` | `email_subject`, `email_message_id` (índice), `email_in_reply_to`, `email_references`, `email_from`, `email_to jsonb`, `email_cc jsonb` |
| Bucket | `email-attachments` (privado, lectura según acceso a la conversación) |

### 9.8 Roles

| Tabla / cambio | Campos | Notas |
|---|---|---|
| `workspace_roles` (nueva) | `key`, `name`, `description`, `is_system`, `permissions text[]`, `scopes jsonb` (`{"leads":"own","conversations":"own"}`), `deleted_at` | Único `(workspace_id, key)`. Backfill de los 3 de sistema. Roles de sistema inmutables (trigger) |
| `workspace_members` (cambio) | `role_id uuid` FK | Backfill según `role`; `role` se conserva |

**Rol de sistema "Member" = hoy** (§3.4) + `content.view` y `content.create`; alcance `own`. La tabla definitiva sale del test de caracterización de F68: si difiere, gana el comportamiento actual y se anota.

### 9.9 Numeración
Desde `00081`, en el orden de los bloques. Los números de esta tabla son orientativos: si hace falta partir o sumar una migración, se corre la numeración.

### 9.10 Migraciones: plan y clasificación

| Migración (nombre orientativo) | Bloque | Tipo | ¿Se aplica? |
|---|---|---|---|
| `integration_types_etapa2` | B1 | Aditiva | Sí |
| `oauth_and_social_accounts` (+ cron `social-token-refresh`) | B2 | Aditiva | Sí |
| `content_pipeline` (ideas, posts, versiones, `social_posts`, bucket y policies, cron `content-media-cleanup`) | B3 | Aditiva | Sí |
| `metrics_comments_ads` (tablas de métricas, comentarios, insights, columnas d7, cron `metrics-sync`) | B5 | Aditiva | Sí |
| `email_channel` | B8 | Aditiva | Sí |
| `workspace_roles` | B9 | Aditiva con backfill | Sí |
| `can_see_with_roles` | B9 | Reemplazo de cuerpo de función | Sí, **después** de `verify-rls.mjs` en verde |
| `drop_legacy_secret_columns` (`workspaces.late_api_key_encrypted`, `workspaces.webhook_secret`, `channels.webhook_secret`) | B9 | **Destructiva** | **No.** Se escribe y se anota, junto con los dos scripts que leen la columna vieja (§3.2) |

---

## 10. Arquitectura

```
[Pantallas Next.js] ── PageHeader con filtros y acciones (todas las páginas)
   │ Server Actions (guards por permiso)
   ▼
[lib/integrations]──►[Vault]                  [pg_cron]──►/api/cron/jobs, metrics-sync, social-token-refresh,
   │                                                      content-media-cleanup (lista blanca de call_app_cron)
[lib/oauth] state firmado ◄── /api/oauth/[provider]/start|callback
   │
[lib/social] cuentas + publishers jsonb + perfil
   │
[lib/content] ideas, posts, estados, versiones, validación, palabras clave, calendario
   │         └─ ai-copy (job content_copy → proveedor de IA del workspace; Etapa 3: agente de redacción)
   │ scheduled_jobs (content_publish, content_publish_check) ── lib/jobs/registry
   ▼
[lib/publishing/dispatcher] ──► zernio (IG, TikTok) · postproxy (YouTube) · youtube (API oficial) · linkedin · threads
   ▲ estado final                      └─► social_posts ──► postIds de automatizaciones (comment_keyword)
/api/webhooks/late (posts + comentarios) · /api/webhooks/postproxy

[lib/metrics] zernio (delta) · instagram-graph · youtube · threads ──► métricas diarias ──► Dashboard orgánico, Social, análisis por post
[lib/comments] webhook + relectura ──► social_post_comments
[lib/meta] cuentas + insights (guardados) + consultas en vivo (caché 15 min) ──► Meta Ads (4 niveles) / Unificado

/api/webhooks/resend-inbound ──► lib/email/inbound ──► contacts, conversations, messages ──► Bandeja
Bandeja (canal Email) ──► rama resend ──► Resend

[lib/auth/permissions] ──► guards, menú, PermissionGate ; SQL has_permission / can_see_*
```

Principios:
- **Un solo camino de publicación** (dispatcher a la hora) para todas las redes.
- **Publicadores, lectores y generación de copy con interfaz común**, reutilizables como herramientas de los agentes de la Etapa 3.
- **Toda credencial desde Vault** (`readSecret`) en el servidor; nunca llega al cliente.
- **Webhooks:** firma verificada sobre el cuerpo crudo, ack inmediato con `after()`, idempotencia en `webhook_events`.
- **Todo por workspace:** datos, secretos, gasto de IA, configuración de agentes y roles.

---

## 11. Storage

| Bucket | Acceso | Contenido | Límite | Retención |
|---|---|---|---|---|
| `content-media` (nuevo) | Privado; policies en `storage.objects` por workspace (primer segmento del path = `workspace_id`); URLs firmadas | Media base y variantes de los posts | 1 GB por archivo; jpg, png, webp, gif, mp4, mov, pdf (MIME real validado) | 30 días después de publicado (configurable) |
| `email-attachments` (nuevo) | Privado; lectura según acceso a la conversación | Adjuntos de emails | 25 MB por email | Sigue a la conversación |

- Subida directa del navegador con URL firmada; TUS para > 6 MB.
- A intermediarios se entrega una URL firmada de lectura de 24 h.
- Plan Supabase Pro (100 GB). Si se superan 80 GB: migrar a Cloudflare R2 (futuro).

---

## 12. Stack y decisiones técnicas

| Decisión | Elección | Por qué |
|---|---|---|
| Dependencias nuevas | Solo `tus-js-client` | YouTube, LinkedIn, Threads, Postproxy y Meta con `fetch`; sin `googleapis` |
| Calendario y kanban | Componentes portados de ScaleOS | Ya resuelven vistas y arrastre |
| Publicación a la hora | Dispatcher propio para todas las redes | Editar, cancelar y reprogramar funciona igual en todas |
| Fecha por red | `planned_at` en el jsonb (tentativa) + fila en `social_posts` (programada) | Se puede planificar sin programar, y programar red por red |
| Copy con IA | Pedido simple con salida estructurada (Zod) sobre la infraestructura de IA existente | Sin agente en esta etapa; la interfaz queda para la Etapa 3 |
| Métricas | Fotos diarias en tablas propias | Rápido, comparable, tolera caídas de APIs |
| Meta Ads | Híbrido: guardado por día + consultas en vivo con caché de 15 min | Límites del nivel Development; los desgloses no se agregan bien por día |
| Seguidores por post | Variación de la cuenta ±1 día vs. mediana, calculada al leer | Las redes no atribuyen seguidores a un post |
| OAuth `state` | Token firmado + cookie | Sin tabla ni cron de purga |
| Versión de LinkedIn | Constante `LINKEDIN_API_VERSION` | LinkedIn da de baja versiones (202510 vence el 15/10/2026) |
| Tipos de job | Registro por tipo; desconocido → `failed` | Un job mal tipado no frena la cola; los tipos de hoy no cambian |

---

## 13. Pantallas detalladas

> Referencia visual y de comportamiento: `docs/referencia/prototipo/dashboards-de-chat.html`.

### 13.0 Convenciones globales
- **Barra superior de 56 px en todas las pantallas** (F7): título + ⓘ; a la derecha, los filtros (dropdowns) y botones de la página. No hay barras de herramientas dentro del contenido. En el celular: una sola barra, y los filtros y botones en una franja fija debajo con desplazamiento horizontal.
- Estados estándar: skeleton al cargar, vacío con acción sugerida, error con "Reintentar", éxito con toast.
- Responsive: 390 px sin scroll horizontal de la página; tablas y gráficos anchos con scroll propio.
- Textos en español, voseo, sin jerga (errores de proveedores traducidos por `lib/*/errors.ts`).
- Accesibilidad: labels, foco visible, teclado en modales, paneles laterales (Esc cierra) y kanban (mover con teclado: nice-to-have).

### 13.1 Integraciones (B1, B2, B5, B8)
Grid por secciones con cards (ícono, nombre, descripción, badge, cuenta, barra de uso, botón); filtro "Requiere atención" en la barra. Modal según F3; en redes, selector "Publicar por"; en Google, "Publicación directa" con "Probar" y "Activar de todos modos". En el celular, el modal ocupa la pantalla.

### 13.2 Contenido: pipeline (B3)
- **Barra:** Kanban | Calendario | Lista, filtro de red, "+ Nueva idea", "+ Nuevo post"; en Calendario, además "Contar: Piezas / Publicaciones".
- **Kanban:** 7 columnas con contador; tarjeta de idea con Aprobar / ✦ Aprobar y producir copy / Descartar; tarjeta de post con formato, redes con fecha y estado, copy/caption (✦), material, badges y chip ↻.
- **Calendario:** una tarjeta por pieza por día (F21), estados por red, ↻, resumen del mes. En el celular, vista agenda.
- **Lista:** tabla paginada (título, redes, estado, fechas, autor).
- **Vacío:** "Todavía no hay contenido" + "Crear el primer post" (y "Conectá tus redes").

### 13.3 Editor del post (B4)
Una sola página (F24): Copy → Caption base → Media base → Redes y publicación (acordeón por red con fecha, estado, publicador, caption, media, CTA y palabra clave con su automatización, opciones, validaciones y "Programar solo esta red") → pie "Programar N redes con fecha". A la derecha, vista previa de la red abierta e Historial (comparar y restaurar). Estado "✦ generando…" mientras corre la IA. En el celular, una columna.

### 13.4 Detalle del post (B4)
Estado general y acciones (Editar, Aprobar/Devolver, Reintentar, + Publicar en otra red, Archivar). Tarjeta por red: estado, fecha, publicador, link, error en simple, intentos, advertencias. Métricas (con acceso al análisis), comentarios por red, historial.

### 13.5 Social (B6)
Barra: selector de red, formato, Analíticas, Actualizar. Perfil, stories (IG), grilla con próximas punteadas primero; paneles de análisis al tocar. LinkedIn como lista sin métricas.

### 13.6 Dashboards (B6, B7)
Selector de dashboard en la barra (Chat, Contenido orgánico, Meta Ads, Unificado) y los filtros de cada uno (red o cuenta publicitaria, período) como dropdowns en la misma barra. Orgánico según F48 a F53; Meta Ads según F56 a F58 con migas de pan y "Analizar con IA". En el celular: KPI en 2 columnas, secciones en una columna.

### 13.7 Bandeja con Email (B8)
Sobre en la lista y en el filtro de canal. En el hilo: asunto, de/para, adjuntos descargables. Asunto calculado visible (no editable).

### 13.8 Roles (B9)
Lista con badge "Sistema" y cantidad de personas; editor con permisos por módulo y alcance ("Solo lo mío" / "Todo"). En Equipo, selector de rol por persona.

---

## 14. Guía de UI
Se sigue el diseño actual del fork (Tailwind 4, `components/ui`) y el prototipo. Los componentes de ScaleOS (tema oscuro con tokens `ds.*`) y LateWiz (shadcn) se adaptan a las clases del fork: **no se importan tokens ni estilos de ScaleOS**. Íconos de marca con `@icons-pack/react-simple-icons` (ya instalado). Gráficos con lo que ya usa el dashboard de Chat.

---

## 15. Seguridad

**Autenticación:** sin cambios. Las rutas OAuth y las Server Actions nuevas exigen sesión.

**RLS por tabla nueva** (siempre dentro del workspace):

| Tabla | SELECT | INSERT / UPDATE | DELETE |
|---|---|---|---|
| `oauth_connections` | Owner/Admin (`integrations.manage`) | Solo servidor | Solo servidor |
| `social_accounts` | Miembros | Owner/Admin (`integrations.manage`) | Owner/Admin |
| `content_ideas`, `content_posts` | Miembros (`content.view`) | Autor en `draft`/`in_production`/`in_review` (y sus ideas `nueva`); Owner/Admin (`content.approve`/`publish`) en cualquier estado | Soft delete: autor si no publicado, Owner/Admin |
| `content_post_versions` | Miembros (`content.view`) | Solo servidor (acciones) | Solo servidor (recorte a 50) |
| `social_posts` | Miembros (`content.view`) | Solo servidor | Solo servidor |
| Métricas, comentarios y Ads | `dashboards.content.view` / `dashboards.ads.view` / `social.view` (hasta B9: Owner/Admin) | Solo servidor (responder u ocultar comentarios, vía acción con permiso) | Solo servidor |
| `workspace_roles` | Miembros | `roles.manage`; sistema inmutable | Solo personalizados sin personas |
| Storage `content-media` | Miembros del workspace | `content.create` | Autor u Owner/Admin |
| Storage `email-attachments` | Quien ve la conversación | Solo servidor | Solo servidor |

**Validación:** Zod en Server Actions, webhooks, columnas jsonb y la salida de la IA; MIME real de archivos; `redirect_to` de OAuth relativo y en lista blanca.

**Webhooks:** Zernio (HMAC, existente), Postproxy (firma o token en la URL en tiempo constante), Resend (Svix). Todos con ack inmediato e idempotencia.

**Datos sensibles:** todo secreto en Vault; nada de secretos en respuestas, logs ni `audit_log`. El cliente nunca llama a APIs de terceros con credenciales. Los pedidos a la IA no incluyen secretos ni datos de otros workspaces.

**Checklist por bloque:**
- [ ] RLS en todas las tablas nuevas, con lectura cruzada entre dos workspaces probada
- [ ] Guards por permiso en toda Server Action y ruta nueva
- [ ] Validación con Zod en el servidor
- [ ] Secretos solo en Vault; nada en logs
- [ ] Webhooks con firma, ack inmediato e idempotencia
- [ ] URLs firmadas con vencimiento para media
- [ ] OAuth con `state` firmado, de un solo uso y con vencimiento

---

## 16. Decisiones transversales

### 16.1 Todo es por workspace
- **Conexiones y claves:** cada workspace tiene sus integraciones, cuentas sociales, cuentas publicitarias y secretos (`ws:<workspace>:<nombre>`). Nada se comparte.
- **IA:** proveedor, modelo, claves, voz de marca, gasto y topes son por workspace; cada generación (copy, "Analizar con IA") se registra en el workspace que la pidió.
- **Agentes:** todos los workspaces tienen los mismos tipos de agente, pero cada uno tiene su fila y su configuración (esta etapa no crea agentes; no debe romper ese modelo).
- **Contenido:** ideas, posts, versiones, publicaciones, comentarios, métricas y dashboards son por workspace; los buckets usan el `workspace_id` como primer segmento del path.
- **Roles:** los personalizados son por workspace.
- **Criterio:** `verify-rls.mjs` crea dos workspaces y prueba que un usuario de uno no lee ni escribe nada del otro en cada tabla y bucket nuevos; los tests de IA verifican que el costo se registra en el workspace correcto.

### 16.2 Otras
- **Auditoría:** `logAudit` en integraciones, cuentas, publicador por defecto, prueba de YouTube, ideas (aprobar, descartar), posts (crear, editar, aprobar, devolver, programar, desprogramar, redistribuir, archivar, restaurar versión, generar con IA), cada publicación, comentarios (responder, ocultar) y roles.
- **Soft delete:** `content_ideas`, `content_posts`, `workspace_roles`, `social_posts` y comentarios con `deleted_at`.
- **Zona horaria:** la del workspace para programar, calendario, cortes diarios de métricas y "Seguidores ±1 d"; todo se guarda en UTC.
- **Concurrencia:** publicar con actualización condicional de estado; editar el mismo post: gana el último guardado, con aviso si cambió.
- **Contacto cross-canal:** el email se suma a la dedup existente.
- **Motor de automatización:** las automatizaciones por palabra clave siguen siendo del flow builder; el contenido solo las lee y completa sus `postIds`.

---

## 17. Fuera de alcance de la Etapa 2
- Publicar en Pinterest, X, Facebook, Bluesky, Snapchat, Google Business, Reddit, Telegram.
- LinkedIn: página de empresa, métricas, comentarios.
- Varias cuentas de una misma red.
- Borrar o editar en las redes posts ya publicados.
- Editor de video, conversión de formatos, miniaturas generadas.
- **Agentes** (de contenido, de redacción, general), generador de piezas y carruseles HTML→PNG, generación de imágenes: Etapa 3. (La generación simple de guion y caption **sí** entra, F29.)
- Importar al pipeline los posts publicados a mano (aparecen en Social y en métricas).
- Comentarios en la bandeja (se ven y responden en el post, no como conversaciones).
- Crear o editar anuncios de Meta; atribución de ventas; atribución de seguidores a un post.
- Exportar dashboards; métricas en tiempo real; vistas guardadas del explorador.
- Agente IA sobre email; firmas y plantillas de email; reenvío; Gmail.
- Google Calendar, Drive, Meet; Apify, Tavily, Fathom, Composio, Cloudflare Browser Run.
- Agenda (sección del prototipo): Etapa 4.
- Permisos por registro individual; varios roles por persona.
- Aplicar la migración que borra columnas viejas de secretos.
- Pendientes de la Fase 3 que no son la barra superior (handler de `bg_task`, UI de calidad, pestañas de tendencias del dashboard de Chat, "qué le responden"): siguen en su sección de `docs/PENDIENTE.md`.

---

## 18. Verificación en vivo (después de la construcción, con Wendy)
No forma parte de la definición de listo. Se hace después del merge, con cuentas reales:
1. Evolution y Zernio en Vault (confirmar que WhatsApp e Instagram siguen enviando y recibiendo).
2. Conectar Google, LinkedIn, Threads, Postproxy; revisar cuentas, publicadores y perfiles en Social.
3. Configurar el límite global de archivos de Supabase (1 GB).
4. Configurar la voz de marca y generar un guion desde una idea real.
5. Publicar un post de prueba en cada red (TikTok como borrador, YouTube como no listado), con una palabra clave de automatización en Instagram, y verificar que el comentario dispara el flow.
6. "Probar publicación directa" de YouTube.
7. Registrar los webhooks de Zernio (posts y comentarios) y Postproxy.
8. Token de Meta, cuentas, "Actualizar ahora", comparar con Ads Manager en los 4 niveles.
9. Subdominio de Resend (MX), email de prueba, respuesta y hilo.
10. Crear un rol, asignarlo y recorrer lo que ve.
11. Con todo leyendo de Vault, aplicar `drop_legacy_secret_columns` y borrar `EVOLUTION_*` de Railway.

---

## 19. Si algo bloquea
- **Documentación de un proveedor distinta a lo esperado:** gana la documentación, se mantiene la interfaz común, se anota en PENDIENTE.
- **Archivo de prueba de YouTube imposible de generar:** ruta configurable y anotado.
- **Falta algo en `docs/referencia/`:** se implementa desde este documento y se anota.
- **Test de caracterización con un comportamiento distinto al descrito:** gana el comportamiento actual; se ajusta la tabla y se anota.
- **Migración que necesite borrar o modificar datos:** se escribe, no se aplica, se anota.
- **Un bloque demasiado grande para cerrarlo de una vez:** se puede partir (p. ej. B4a editor y IA, B4b publicadores) sin cambiar el orden, y se anota en PROGRESS.
- Nunca quedarse en un loop: después de un intento serio, anotar y seguir.

---

## 20. Chequeo de sincronía con el alcance v4
Divergencias con `alcance-v4.md`, a favor de simplificar o por pedido de Wendy:
- **Programación:** todo lo publica el sistema a la hora (no se programa del lado de Zernio o Postproxy).
- **IA de contenido:** el alcance la dejaba para la Etapa 3; entra la generación simple de guion y caption (F29), sin agentes.
- **Comentarios, página Social y análisis por post:** suman a las métricas; no estaban en el alcance.
- **Meta Ads:** réplica de ScaleOS en 4 niveles (el alcance hablaba de un dashboard).
- **Rol Member:** suma Contenido (ver, crear, enviar a revisión).
- **Columnas viejas de secretos:** se borran después de la verificación en vivo.

---

## Apéndice A. Qué cambió respecto de la v1.0

| Tema | v1.0 | v2.0 |
|---|---|---|
| Punto de partida | Fase 3 en rama aparte; migraciones "desde la siguiente" | `main` con la Fase 3 y el menú nuevo; desde `00081` |
| Tablas | 13 (con `oauth_states`, `social_account_publishers`, `content_post_media`, `content_post_targets`, `meta_ad_accounts`) | 11 (esas 5 no se crean; nuevas: `content_ideas`, `content_post_versions`, `social_post_comments`) |
| Pipeline | Estados `idea`→…; 6 columnas; un `body` por post | Ideas en tabla propia con aprobación; copy (guion) y caption; `in_production`; 7 columnas; versiones |
| IA | Fuera de alcance | Generar guion y caption con IA (F29), permiso `content.ai` |
| Composer | Dos columnas con pestañas por red | Editor en una sola página, fecha tentativa por red, programar por red, palabras clave, variantes, redistribución |
| Calendario | Por `scheduled_at` del post | Una tarjeta por pieza por día, redistribución ↻, conteo Piezas / Publicaciones |
| Publicaciones | `content_post_targets` + `social_posts` separados | Solo `social_posts` (sistema y externas) |
| Métricas | Fotos diarias | + historial inicial, frecuencia por antigüedad, sin ceros, engagement a 7 días, comentarios |
| Dashboard orgánico | Secciones de ScaleOS + top 10 | + Día/Semana/Mes, explorador de doble eje por red, análisis por post, seguidores ±1 día |
| Social | No existía | Página nueva (F54) |
| Meta Ads | Un dashboard | Réplica de ScaleOS en 4 niveles con 10 correcciones y datos híbridos, + Analizar con IA |
| Barra superior | Convención | Funcionalidad (F7) en todas las pantallas |
| Por workspace | Implícito | Regla explícita con prueba de lectura cruzada (§16.1) |
| Email | `late_account_id` NULL | `'email:<dirección>'`, NOT NULL intacto |
| Jobs | Desconocido → `failed` | Igual, sin cambiar los tipos de hoy (`bg_task`) |
| Dependencias | `googleapis` opcional + `tus-js-client` | Solo `tus-js-client` |

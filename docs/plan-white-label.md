# Plan: white label, limpieza de datos propios y zona horaria por usuario

## Contexto

El sistema se va a duplicar para cada cliente. La auditoría encontró tres problemas.

**1. Todavía es "ZernFlow" por fuera**
- La landing pública en `/` es la de ZernFlow.
- El login y la invitación muestran su logo.
- Todas las pestañas dicen "… | ZernFlow", también las de agenda que ven los leads.
- El manifest, el sitemap y el robots apuntan a `zernflow.com`.
- Además, `/register` está abierto: cualquiera crea una cuenta y recibe un negocio propio.

**2. El código tiene datos propios de Wendy y de su negocio**
- Su WhatsApp real (`50670814873`) aparece en ayudas de pantalla y en una herramienta del agente.
- "Hola Wendy" está en el link de WhatsApp que el agente les manda a los leads.
- `ScaleOS` es la palabra prohibida por defecto del agente.
- Los 12 textos de botón de sus campañas están escritos en el código.
- "agencia de marketing en Argentina" aparece en un prompt.
- Hay una dirección real de Escazú en un placeholder.
- "Noelia Mereles" se usa como contacto de ejemplo.
- Los tests tienen sus handles de Instagram y IDs reales de su cuenta.
- Unos 40 comentarios mencionan "Wendy", "ScaleOS" o "Sofia".
- `.mcp.json` está commiteado con el ID del proyecto de Supabase.
- `scripts/smoke-test.mjs` trae IDs del proyecto original de ZernFlow.
- El prefijo `SSA` aparece en el embed, los cron, las cookies y el `.ics`.
- Los docs y screenshots tienen emails reales de contactos.

**Secretos y claves: limpio.** No hay ninguna clave real ni en el código ni en el historial de git (se revisaron 476 commits). Las claves reales están solo en `.env`, que nunca se commiteó.

**3. Fechas y horas: Costa Rica y Argentina escritas a mano**
- Todo se guarda en UTC (`timestamptz`), eso está bien.
- Pero el "qué día es" sale de cuatro fuentes según la pantalla: la zona del negocio, Costa Rica fija, Buenos Aires fija o UTC.
- Unas 45 fechas se muestran sin zona, así que dependen del servidor o del navegador.
- Ningún usuario tiene zona propia.
- Pedido de Wendy: **cada usuario con su zona horaria**, detectada del navegador la primera vez que entra, guardada y editable, y toda la app (tablas, filtros, dashboards, entradas de fecha) en esa zona.

**Decisiones ya tomadas**
- La marca se configura por variables de entorno. La copia de Wendy se llama **Scale·OS**.
- Registro solo por invitación.
- El color de marca es configurable.
- El embed se renombra sin dejar compatibilidad, porque no está pegado en ningún sitio.
- Va un script de exportación limpia, y además se limpia el repo de Wendy.
- Zona horaria por usuario.

## Cómo se ejecuta

Son **tres bloques**, una rama por bloque, en este orden. Cada bloque lleva sus commits, y cada commit deja la app compilando. Lo más probable es que sea una sesión por bloque.

| Bloque | Rama | Migraciones |
|---|---|---|
| A. Marca y acceso | `feature/white-label` | `00119` |
| B. Limpieza de datos propios | `feature/limpieza-datos` | `00120` |
| C. Zona horaria por usuario | `feature/zona-horaria-usuario` | `00121`, `00122` |

---

## Bloque A: marca y acceso

### A1. Config de marca

**`lib/brand.ts`** (nuevo): un módulo puro, sin imports, con test. Lee tres variables:
- `NEXT_PUBLIC_BRAND_NAME`. Si no está, usa un nombre neutro.
- `NEXT_PUBLIC_BRAND_LOGO_URL`, opcional.
- `NEXT_PUBLIC_BRAND_COLOR`, opcional. Se valida que sea un hex con regex. Si no está, queda el índigo actual.

**`components/brand-mark.tsx`**: muestra el logo. Si no hay logo, muestra un monograma (la inicial del nombre sobre un cuadrado del color de marca).

**`.env.example`**: documenta las tres variables. Las `NEXT_PUBLIC_*` se fijan en el build, así que cambiarlas en Railway implica un redeploy.

### A2. Fuera la web, queda solo el acceso

- **`app/page.tsx`** pasa a `redirect("/login")`.
- **`app/layout.tsx`**: el título sale de la marca (`template "%s | <marca>"`), descripción neutra, `metadataBase` desde `appUrl()` (`lib/app-url.ts`), `lang="es"` y un `<style>` con `--primary`/`--ring` si hay color de marca.
- **Íconos y manifest**: `app/icon.tsx`, `app/apple-icon.tsx` (con `next/og`) y `app/manifest.ts`.
- **Se borran**: `app/sitemap.ts`, `public/site.webmanifest`, los 8 archivos del logo de ZernFlow y `powered-by-zernio.svg`.
- **`app/robots.ts`** queda con `disallow: "/"`.
- **Las páginas públicas de agenda** (`app/calendario/*`) usan título absoluto con el nombre del anfitrión, **sin la marca del producto**: el lead ve al negocio, no al software.
- **Login**: en español, con `BrandMark`, sin GitHub, sin "Sign up", y respeta `?next=` (solo rutas relativas).
- **Sidebar**: `BrandMark` reemplaza al avatar de DiceBear en `components/workspace-switcher.tsx`, que hoy se pide a un servicio externo.

### A3. Color de marca en todo

- **`app/globals.css`**: `--c-agent` y `--sent` pasan a `var(--primary)`, y también el `--color-primary` fijo de `[data-theme="dark"]`. El booker sigue pudiendo pisarlo por perfil.
- **Gráficos**: `#6366f1` pasa a `var(--primary)` en 7 archivos de `components/dashboards/*`.
- **Flow builder**: las clases `indigo-*` pasan a `primary` (`DelayPanel`, `AiResponseNode`, `NodeConfigSidebar`, `delay-node`, `TestPanel`, `ActionPanel`).
- **Emails**: el botón de `lib/email/templates.ts` usa el hex de marca.

### A4. Registro solo por invitación (toca auth)

- **Se borra `app/(auth)/register/`.** El middleware redirige `/register` a `/login`.
- **`/invite/[inviteId]` sin sesión** muestra "Creá tu cuenta" (nombre y contraseña; el email es el de la invitación).
- **Server action `registerFromInvite`** en `lib/actions/team.ts`:
  - Reutiliza las validaciones de `acceptInvite` en una función común.
  - Crea el usuario con `auth.admin.createUser({ email_confirm: true, user_metadata: { full_name, invite_id } })`.
  - Inicia la sesión y acepta la invitación.
  - Si el email ya tiene cuenta, manda a `/login?next=/invite/<id>`.
- **Migración `00119_invite_signup_no_workspace`**:
  - Copia `handle_new_user` (de `00001:301-327`) letra por letra.
  - Único cambio: si el `invite_id` de la metadata corresponde a una invitación pendiente del mismo email, no crea el workspace personal.
  - La definición vieja queda completa en la cabecera.
- **`scripts/create-owner.mjs`**: crea el primer Owner de un clon y le pone al workspace el nombre de la marca y la zona horaria pasada por parámetro.
- **`supabase/config.toml`**: `enable_signup = false`.

### A5. Nombres técnicos de ZernFlow

- **Cookie**: `zernflow_workspace_id` pasa a `workspace_id`; se sigue leyendo la vieja como respaldo.
- **`WEBHOOK_NAME`** (`lib/zernio-webhook.ts:20`) pasa a la marca. No se duplica el webhook porque se busca también por URL.
- **`source`** de los flows exportados pasa a `business-os`; la importación no lo valida.
- **`package.json`**: `name` pasa a `business-os`.
- **`build-all-migrations.mjs`**: encabezado neutro.
- **Comentarios "ZernFlow"** en `lib/` y `components/` pasan a "sistema original".
- **README** neutro, con la línea "Basado en ZernFlow (MIT)", también en `THIRD_PARTY_NOTICES.md`. `LICENSE` no se toca, porque la MIT obliga a conservarlo.

---

## Bloque B: limpieza de datos propios

### B1. Lo que ven los leads o el agente

**`lib/agent/tools/whatsapp-link.ts`**
- Nuevo campo de config opcional, "Nombre de quien recibe" (`nombre_destino`).
- El texto pasa a "Hola {nombre_destino}, soy X…" o "Hola, soy X…".
- La plantilla default pasa a "Hola, te escribo desde Instagram.".
- La descripción de la herramienta dice "el WhatsApp del negocio".
- El ejemplo del número pasa a `5491100000000`.

**`lib/agent/schemas.ts:76`**: `DEFAULT_BANNED_WORDS = []`.

**`lib/agent/rules/known-buttons.ts`**: la lista queda vacía. La fuente real ya es `message_texts.is_button` (`lib/agent/rules/button-texts.ts`).

**Placeholders y textos:**
- `components/agents/config-tab.tsx:369`: el ejemplo pasa a `wa.me/5491100000000, tusitio.com/oferta`.
- `config-tab.tsx:266`: muestra la zona del negocio en vez de "Costa Rica".
- `background-tasks-view.tsx:621`: "Quiero más info".
- `new-event-dialog.tsx:169`: "Av. Siempre Viva 123, piso 3".

**`lib/actions/scheduling/event-flows.ts:139,145`**: el contacto de ejemplo pasa a "Ana Pérez", y el anfitrión sale del usuario real.

**Prompts de IA:**
- `lib/meta/ai-analysis.ts:22`: "este negocio" en lugar de la agencia en Argentina.
- La forma de hablar ("español rioplatense") de los 6 prompts sale de una variable nueva, `AI_LANGUAGE_STYLE`, con default "español neutro". Los prompts son `content/ai-copy.ts`, `agent/summary.ts`, `sequences/processor.ts`, `ai/generate-reply.ts`, `meta/ai-analysis.ts` y `scheduling/automation/templates.ts`, más el placeholder de `AiResponsePanel.tsx`.

**Antes de desplegar, cuidar que la copia de Wendy no cambie de comportamiento** (solo lectura, y lo que haya que escribir se confirma antes):
- **Palabras prohibidas:** si su agente no tiene `phrases` guardado, guardarle `["ScaleOS"]` explícito.
- **Link de WhatsApp:** cargarle `nombre_destino = "Wendy"` en la herramienta.
- **Textos de botón:** comprobar que sus 12 textos están marcados `is_button` en la base.
- **Railway:** cargar `AI_LANGUAGE_STYLE` con su forma de hablar rioplatense.
- **Prefijo de Evolution:** comprobar que Railway tiene `EVOLUTION_INSTANCE_PREFIX=ssa` explícito (si no, se rompe su WhatsApp) antes de cambiar el default del código a `app`.

### B2. Embed y prefijos `SSA`

**Embed (no está pegado en ningún sitio):**
- `window.SSA` pasa a `window.Agendar`.
- `data-ssa-*` pasa a `data-agendar-*`, y los eventos `ssa:*` a `agendar:*`.
- También se renombran el `source` del postMessage, los ids de elementos, el banner y el prefijo de consola.
- Archivos: `lib/embed/*`, `booker.tsx`, `use-embed-bridge.ts`, `scripts/build-embed.mjs`. Después se regenera `public/embed/embed.js`.

**Otros prefijos:**
- `PRODID` del `.ics` (`lib/scheduling/ics.ts:75`) pasa a la marca.
- Cookie `ssa_oauth_nonce` pasa a `oauth_nonce`.
- `ssaBookingUid` pasa a `bookingUid` en Google Calendar, leyendo también la clave vieja para las reuniones ya creadas.
- Claves de localStorage `ssa.*` pasan a `app.*`.
- La sal de respaldo `"ssa-scheduling"` (`lib/scheduling/antispam.ts:27`) se reemplaza por un error logueado si faltan `RATE_LIMIT_SALT` y `CRON_SECRET`.

**Cron `ssa-cron-*` (25 jobs):**
- **Migración `00120_rename_cron_jobs`**: en un bloque `DO`, des-agenda cada `ssa-cron-*` y lo vuelve a agendar sin el prefijo, con el mismo horario y comando leídos de `cron.job`. Es idempotente.
- **Migraciones viejas**: se cambian los nombres literales. Es la única vez que se edita SQL de migraciones ya aplicadas; en la base de Wendy no se re-ejecutan, y así un clon nuevo nace con nombres neutros.
- **En el mismo commit**:
  - se buscan en el código los usos del nombre (`cron.job_run_details`, chequeos de salud);
  - se quita el bloque de textos de botón de la `00079`, que en una base vacía no hace nada;
  - se reescriben los comentarios con nombres de personas en `00073`, `00111`, `00118` y `00028`.

### B3. Tests, scripts y config

- **Tests (unos 50 archivos):**
  - el payload real de Instagram (`lib/zernio-message.test.ts`, `backfill-messages.test.ts`) pasa a IDs falsos;
  - `wendymardigian`/`wendy.sistemas` pasan a `cuenta_demo`;
  - el teléfono pasa a `5491100000000`;
  - "Wendy" pasa a "Ana", y `wendy/llamada` a `anfitrion/llamada`;
  - "Noelia Mereles" y "Sofía Ramírez" pasan a nombres genéricos;
  - las URLs `app.zernflow.test` pasan a `app.ejemplo.test`.
- **Comentarios** con Wendy, ScaleOS, Sofia o "agencia" en `lib/`, `components/` y `app/` se reescriben.
- **Se borra `scripts/smoke-test.mjs`**: es un resto del proyecto original y apunta al deploy de otra persona.
- **`.mcp.json`** sale del repo (`git rm --cached` y `.gitignore`), y queda un `.mcp.json.example` con `<PROJECT_REF>`.
- **`.gitignore`**: se suma `.claude/worktrees/`.

### B4. Docs del repo de Wendy y la exportación limpia

**Se borran del repo:**
- `docs/shots/` (32 capturas con contactos y emails reales).
- `docs/referencia/prototipo-ssa-baios.html` (emails reales).
- `docs/chat-media/zernio-share-samples.json` (posts reales de terceros).

**Se tachan** el teléfono en `docs/agente-ia.md:661`, el ID del proyecto de Supabase y las URLs de Railway en los `PROGRESS`, `PENDIENTE` y `BITACORA`. El resto de los docs se queda, porque es la historia interna de Wendy.

**El historial de git del repo de Wendy no se reescribe.** Sería destructivo, y lo resuelve la exportación.

**`scripts/export-template.mjs`** arma una copia en una carpeta nueva:
- **Excluye:** `docs/`, `BITACORA.md`, `claude/`, `.claude/worktrees`, `.env*`, `supabase/.temp` y `.mcp.json`.
- Corre un `git init` con un solo commit inicial.
- **Al final**, hace un `grep` de control que falla si encuentra wendy, mardigian, scaleos, zernflow, `50670814873` o el ID del proyecto.

**`CLAUDE.md`** suma una sección "White label / clonar para un cliente": variables, `create-owner`, `system_config` del cron, la exportación y la zona horaria.

---

## Bloque C: zona horaria por usuario

### Reglas

1. **Todo se guarda en UTC.** Ya es así: todas las fechas son `timestamptz`.
2. **Lo que se muestra, filtra, agrupa por día o se carga a mano usa la zona del usuario que está mirando.**
3. **Las reglas del negocio usan la zona del negocio** (`workspaces.timezone`, la que ya existe en Ajustes), porque no pueden cambiar según quién mire:
   - el horario de atención del agente;
   - los topes diarios de gasto de IA;
   - el tope diario de publicaciones;
   - la hora de las tareas en segundo plano y de la sincronización de métricas.

   Hoy varias de estas usan Costa Rica fija e ignoran el ajuste. Se corrige.
4. **Excepciones que se dejan con una etiqueta visible:**
   - las métricas guardadas por día (`*_metrics_daily`, Meta Ads) ya vienen cortadas por día en la zona del negocio o de la cuenta de Meta, y no se pueden recortar por usuario;
   - la agenda pública sigue usando la zona del invitado;
   - la disponibilidad sigue usando la zona de su horario.

### C1. Dónde se guarda

**Migración `00121_user_preferences`:**
- Tabla `user_preferences (user_id PK → auth.users, timezone text NOT NULL, timezone_source text CHECK ('browser','manual'), created_at, updated_at)`.
- RLS: cada uno ve, crea y edita solo su fila. No depende del workspace.

**Migración `00122_workspace_timezone_default`:**
- El default de `workspaces.timezone` pasa de `'America/Costa_Rica'` a `'UTC'`. La de Wendy no cambia, porque ya tiene valor.
- Los `p_tz DEFAULT 'America/Costa_Rica'` de las RPC pasan a ser obligatorios o `'UTC'` (`00078`, `00110`, `00111`). La app siempre los pasa.

### C2. Detección y edición

- **Lectura en el servidor:** `lib/user-timezone.ts` tiene `getViewerTimezone()`, cacheado por request. Lee `user_preferences`; si no hay fila, usa la zona del negocio y después UTC.
- **Detección:** `components/timezone-bootstrap.tsx` va en el layout del dashboard. Si el usuario no tiene fila, lee `Intl.DateTimeFormat().resolvedOptions().timeZone`, la valida con `isValidTimeZone` y la guarda con `saveDetectedTimezone`, que solo inserta si no existe. Después hace `router.refresh()`.
- **Una vez guardada, no se pisa sola.** Si el navegador después está en otra zona (un viaje), aparece un aviso chico: "Tu navegador está en X; ¿usar esa zona?".
- **Edición:** en el menú de perfil (`components/profile-menu.tsx`) hay "Zona horaria", con el selector existente `listTimeZones` (`lib/timezone.ts`). Guarda con `timezone_source = 'manual'`.
- **Para los componentes de cliente:** `TimezoneProvider` en `app/(dashboard)/layout.tsx` (vía `DashboardChromeProvider`) y el hook `useViewerTimezone()`.

### C3. Un solo set de formateadores

**`lib/dates.ts`:**
- Se eliminan `APP_TIMEZONE` y `BUSINESS_TIMEZONE`, y todos los parámetros de zona pasan a ser obligatorios.
- `lib/timezone.ts` pierde `DEFAULT_TIMEZONE`, y `lib/publishing/schedule-core.ts` pierde `DEFAULT_TIME_ZONE`.
- Se borran los unos 30 `|| "America/Costa_Rica"` y los 2 de Buenos Aires.

**`lib/locale.ts`:** `APP_LOCALE` sale de `NEXT_PUBLIC_LOCALE` (default `es-AR`, para no cambiar formatos) y reemplaza los `"es-AR"` sueltos en unos 38 archivos.

**Formateadores:**
- **Cliente:** `useDateFormat()` devuelve `dateTime`, `date`, `time` y `relative` (con "hoy"/"ayer" por día calendario en la zona del usuario, no por diferencias de 24 horas), atados a la zona del usuario y `APP_LOCALE`.
- **Servidor:** las mismas funciones reciben `getViewerTimezone()`.
- **Hidratación:** como el servidor ya conoce la zona del usuario, servidor y navegador muestran lo mismo y desaparece el riesgo de que no coincidan.

### C4. Cambios por área

- **Mostrar** (unas 45 fechas hoy sin zona, más las fijas):
  - bandeja: `conversation-list`, `message-thread` (también "Today/Yesterday" en inglés), `contact-panel`, `draft-card`;
  - contactos: `components/contacts/ui.tsx`, `followup-field`, historial, secuencias, atribución;
  - contenido: `board`, `kanban`, `list-view`, `version-history`, `social-view`/`profile-page`;
  - agentes: runs, costos, acciones, detalle, prompt, `scatter-chart` (hoy Costa Rica fija);
  - ajustes: equipo, canales, integraciones (`lib/integrations/format.ts`), tareas en segundo plano;
  - flows: `en-US`;
  - broadcasts, growth, knowledge;
  - agenda (admin): pasa a la zona del usuario en lugar de la del perfil de agenda.
- **Filtros y agrupaciones:**
  - bandeja (`inbox/page.tsx:108`, hoy Buenos Aires);
  - pestaña Acciones (`agents/[agentId]/page.tsx:124`);
  - Costos y KPIs del agente y "hoy" de borradores (`costs-query.ts`, `drafts/metrics-query.ts`, hoy Costa Rica);
  - dashboards de chat, contenido, unificado y ads, y runs (`resolvePeriod`/`p_tz` con la zona del usuario);
  - **bugs que se corrigen:** los cortes por día con `.slice(0,10)` en UTC (`lib/dashboards/content.ts:360,444`, `trend-explorer.tsx`, `ads/page.tsx:80`, `ads-load.ts`, `content-load.ts`), el rango UTC de `agenda/page.tsx:72` y `read-tools.ts:110`;
  - semanas en UTC de `lib/patterns/review-queue.ts` y "emails de hoy" en `lib/integrations/usage-counts.ts`.
- **Entradas de fecha** (se interpretan en la zona del usuario):
  - fecha de publicación por red (`network-row.tsx`) y arrastrar en el calendario (`content-calendar.ts:52`);
  - seguimiento del contacto;
  - fuera de oficina;
  - **bug que se corrige:** `contact-editor.tsx:210`, que hoy manda la hora "local" al servidor y la interpreta con la zona del servidor;
  - delay "esperar hasta" del flow: hoy se guarda pero el motor lo ignora, así que solo se documenta y no se toca.
- **Reglas del negocio:**
  - `lib/agent/guardrails.ts`, `runner.ts:480-542`, `lib/ai/spend.ts` y `lib/ai/workspace-budget.ts` reciben `workspaces.timezone`;
  - Zernio y `provider-dispatch.ts` usan la zona del negocio, sin Buenos Aires de respaldo;
  - el horario de atención del agente muestra al lado en qué zona está;
  - Ajustes etiqueta la zona del negocio como "Zona horaria del negocio (horario del agente, topes diarios, tareas programadas)".
- **Exportación CSV de runs:** se suma la columna "fecha local" en la zona del usuario, junto a la ISO en UTC.
- **País de teléfono por defecto** (`DEFAULT_PHONE_COUNTRY = "CR"`): sale de `NEXT_PUBLIC_DEFAULT_COUNTRY`, y si no está, se deduce de la zona del usuario o del negocio (ya existe ese mapeo en `lib/scheduling/booking/create.ts`).

---

## Pasos que necesitan confirmación o que hace Wendy

- **Aplicar las migraciones `00119` a `00122`:** se corre `list_migrations` antes, se aplican con `supabase db query --linked -f` y se registran en `schema_migrations`. Las cuatro son aditivas o renombres idempotentes, no borran datos.
- **Supabase:** apagar "Allow new users to sign up". Lo hace Wendy.
- **Railway:** cargar `NEXT_PUBLIC_BRAND_NAME=Scale·OS` (y logo/color si los hay), `AI_LANGUAGE_STYLE`, `NEXT_PUBLIC_DEFAULT_COUNTRY=CR`, y confirmar `EVOLUTION_INSTANCE_PREFIX=ssa`. Se confirma antes de tocar.
- **Ajustes de datos en la base de Wendy** (palabra prohibida, `nombre_destino`): se muestran antes de escribirlos.
- **Google Cloud y Meta:** si la "homepage" configurada es la raíz de la app, ahora muestra el login. Si Google pide una página de privacidad, va en otra tanda.
- **Miembros con un workspace personal sobrante** (los creó el trigger viejo): se informa, no se borra nada.

## Verificación

**Siempre:** `npx vitest run`, `npm run lint` y `npm run build`.

**Búsqueda de restos:**
- En `app lib components public scripts supabase`, un `grep -riE "zernflow|wendy|mardigian|scaleos|50670814873|knrxjn"` tiene que dar 0.
- Solo se aceptan `LICENSE`, `THIRD_PARTY_NOTICES` y `CLAUDE.md` (crédito al fork).
- `scripts/export-template.mjs` repite el mismo control sobre la copia exportada.

**Scripts nuevos** (prefijo `zz-test-`, limpian sus datos, no se corren en simultáneo con otros):
- `verify-invite-signup.mjs`: un usuario con `invite_id` no recibe workspace; uno sin `invite_id`, sí.
- `verify-user-timezone.mjs`: RLS de `user_preferences` (uno no ve ni edita la fila de otro) y que `saveDetectedTimezone` no pisa una zona manual.

**Tests nuevos:**
- `lib/brand.test.ts`.
- Formateadores con dos zonas: un mensaje de las 23:30 UTC cae "hoy" en Madrid y "ayer" en Costa Rica.
- Filtros por día con la zona del usuario.
- Reglas del negocio con la zona del negocio y no la del usuario.

**Se re-corren** `verify-rls`, `verify-crm`, `verify-dashboards`, `verify-scheduling` y `verify-inbox-filters`.

**En el preview:**
- `/` redirige a `/login`, y el login muestra Scale·OS.
- `/register` redirige a `/login`.
- Invitación de prueba: se crea la cuenta y el selector muestra un solo workspace.
- Con el color de marca puesto: botones, gráficos y flows lo toman, en claro y en oscuro.
- La pestaña del booker muestra al anfitrión, no la marca.
- Zona horaria:
  - en el primer ingreso con el navegador emulando otra zona, se guarda sola;
  - cambiarla en el menú de perfil mueve horas de la bandeja, días del dashboard y filtros;
  - el horario del agente no se mueve.
- Captura como prueba.

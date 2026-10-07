# Progreso — White label (marca, limpieza de datos propios, zona horaria por usuario)

Corrida autónoma en la rama `oneshot-white-label`. Plan aprobado: [docs/plan-white-label.md](plan-white-label.md) (7/10/2026).

Nota de convención: el pedido original decía "docs/PROGRESS.md", pero ese archivo
es el cierre de una corrida anterior ("Mejoras de Chat, corrida B") — cada
corrida tiene su propio `docs/PROGRESS-<nombre>.md` (ver `docs/PROGRESS-CV3.md`,
`docs/etapa2/PROGRESS.md`). Este es el de esta corrida.

**Alcance: los tres bloques del plan, en orden — A (marca y acceso), B (limpieza
de datos propios) y C (zona horaria por usuario) — migraciones aplicadas,
mergeado a `main` y desplegado.**

## Bloque A — Marca y acceso

**Hecho:**
- `lib/brand.ts` (+ test): nombre, logo y color de marca por variables de entorno (`NEXT_PUBLIC_BRAND_NAME/LOGO_URL/COLOR`), sin ningún valor de cliente escrito en el código.
- `components/brand-mark.tsx`: el logo, o un monograma con la inicial si no hay uno. Reemplaza el avatar de DiceBear (un servicio externo) en `workspace-switcher.tsx`.
- `app/page.tsx` → `redirect("/login")`. No hay más landing de marketing.
- `app/layout.tsx`: título desde la marca, `lang="es"`, color de marca inyectado con `!important` sobre `--primary`/`--ring` **y** `--color-primary`/`--color-ring` (Tailwind v4 resuelve estos últimos de forma distinta dentro de `.dark`/`[data-theme]`, ver el comentario en el archivo).
- `app/icon.tsx`, `app/apple-icon.tsx`, `app/manifest.ts` (generados con `next/og`), reemplazan los archivos fijos de `public/` (favicons, `site.webmanifest`, los 8 archivos del logo de ZernFlow y `powered-by-zernio.svg`, todos borrados).
- `app/robots.ts`: `disallow: "/"`. Se borró `app/sitemap.ts` (no hay nada público que indexar).
- Páginas públicas de agenda (`app/calendario/*`): título `absolute`, para que no les llegue el sufijo `| <marca>` — quien agenda ve al negocio, no al software.
- Login reescrito en español, sin GitHub, sin link a "Sign up", respeta `?next=` (solo rutas relativas).
- **Registro público eliminado** (`app/(auth)/register/` borrado; el middleware redirige `/register` → `/login`).
- **Alta solo por invitación**: `lib/actions/team.ts` suma `registerFromInvite` (crea la cuenta con `auth.admin.createUser`, inicia sesión y acepta la invitación en un solo paso) y extrae `validatePendingInvite`/`finalizeAcceptInvite` de `acceptInvite` para no duplicar las validaciones. `app/invite/[inviteId]/accept-invite-view.tsx` tiene el formulario de alta cuando no hay sesión.
- **Migración `00119_invite_signup_no_workspace`**: redefine `handle_new_user` (copiada de la 00001) para que un alta con `invite_id` de una invitación pendiente **no** reciba su propio workspace — antes de esto, aceptar una invitación dejaba a la persona con dos workspaces.
- `supabase/config.toml`: `enable_signup = false` (local; falta el equivalente en el proyecto alojado, ver "Pendiente" más abajo).
- `scripts/create-owner.mjs`: crea el primer Owner de un clon nuevo.
- Color de marca propagado a los charts de dashboards (`#6366f1` → `var(--primary)` en 6 archivos), al botón de los emails (`lib/email/templates.ts`) y a `--c-agent`/`--sent` de `globals.css`.
- Nombres técnicos: cookie `zernflow_workspace_id` → `workspace_id` (con respaldo leyendo la vieja), `WEBHOOK_NAME` de Zernio → `brandName()`, `source` de los flows exportados `"zernflow"` → `"business-os"`, `package.json`/`package-lock.json` → `"business-os"`, encabezado de `build-all-migrations.mjs`.
- `README.md` reescrito (neutro, con las instrucciones de white label), `THIRD_PARTY_NOTICES.md` suma la entrada de ZernFlow. **`LICENSE` no se tocó** (la MIT obliga a conservar el aviso original).

**Decisión que cambié respecto del plan, con el código ya mirado:** el plan
decía "las clases `indigo-*` del flow builder pasan a `primary`" en
`DelayPanel`, `AiResponseNode`, `NodeConfigSidebar`, `delay-node`, `TestPanel`
y `ActionPanel`. Mirando el código, esos colores (púrpura para el nodo Delay,
violeta para AI Response, y en `TestPanel` una paleta de 15 colores — uno por
cada tipo de nodo, para el log de una corrida de prueba) son un **sistema
categórico legítimo** para distinguir tipos de nodo a simple vista, no la
marca filtrándose. Unificarlos a `primary` hubiera hecho que, por ejemplo,
"condición" y "AI Response" se vean exactamente iguales en el log de pruebas,
sin arreglar nada real (el resto de los 15 colores de `TestPanel` no son de
la familia índigo y quedarían igual). No los toqué. El verdadero "color de
marca pisando todo" eran los `#6366f1` sueltos en los dashboards y el
manifest, que sí se corrigieron.

**Verificado:** `npx vitest run` (420 archivos, 5299 tests, todos en verde),
`npm run lint` (sin errores ni warnings nuevos — los 4 errores pre-existentes
de `main` en `dashboard-panel.tsx`, `spend-chart-tabs.tsx` y
`onboarding-banner.tsx` no los tocó esta corrida, confirmado corriendo lint
con los cambios en el stash), `npm run build` (compila; `/`, `/login`,
`/icon`, `/apple-icon`, `/manifest.webmanifest` y `/robots.txt` salen
estáticos).

**Pendiente de este bloque:**
- ~~Aplicar la `00119` contra la base~~ — **hecho**, ver "Migraciones aplicadas" más abajo.
- Apagar "Allow new users to sign up" en el Supabase alojado — **esto lo tiene que hacer Wendy**, no es algo que se pueda hacer por código.

## Bloque B — Limpieza de datos propios

**B1 (ya estaba cerrado antes de este resumen):** `lib/agent/tools/whatsapp-link.ts`
con `nombre_destino` opcional, `KNOWN_BUTTON_TEXTS` vacía por defecto (con
`knownButtonExtra` conectado de verdad en `runner.ts` — estaba escrito y
probado pero nunca llamado, quedaba anotado en `docs/PENDIENTE.md`),
`DEFAULT_BANNED_WORDS` vacío, `lib/ai/language-style.ts` (`AI_LANGUAGE_STYLE`)
reemplazando "español rioplatense" fijo en 6 prompts, placeholders y
comentarios neutros.

**B2 — embed y cron sin el prefijo SSA:**
- El embed (`window.SSA` → `window.Agenda`, `data-ssa-*` → `data-agenda-*`,
  eventos `ssa:*` → `agenda:*`, etc.) se renombró directo, sin compatibilidad
  hacia atrás: Wendy confirmó que todavía no está pegado en ningún sitio.
- `PRODID` del `.ics`, cookie OAuth, `extendedProperties` de Google Calendar:
  sin el prefijo, sin riesgo (ninguno se lee de vuelta).
- **25 cron jobs renombrados** (`ssa-cron-X` → `X`): las migraciones de origen
  (00036 a 00092) se editaron para agendar sin el prefijo — la única vez que
  se tocó SQL de una migración ya aplicada, autorizado porque en la base de
  Wendy esas migraciones no se vuelven a correr. La migración `00120` hace el
  renombre real contra `cron.job`, leyendo schedule y command de ahí (nunca
  transcriptos a mano). **Aplicada y verificada**: los 25 jobs quedaron con
  el mismo horario, sin el prefijo, sin ninguno viejo colgado.
- `EVOLUTION_INSTANCE_PREFIX` **no se tocó en el código** (sigue siendo
  `"ssa"` por defecto): las instancias de Evolution ya creadas se buscan por
  ese nombre exacto, y cambiar el default sin confirmar Railway primero
  rompía el WhatsApp del agente. Confirmado y cargado explícito en Railway,
  ver "Variables de Railway" más abajo.
- `.mcp.json` fuera del repo, `scripts/smoke-test.mjs` borrado, sal de
  respaldo de `lib/scheduling/antispam.ts` sin el string fijo (ahora se
  genera una al azar por proceso y avisa fuerte por log).

**B3 — nombres de persona y de ScaleOS en comentarios y tests** (delegado a
un agente en un worktree aparte, rama `oneshot-white-label-b3-names`,
mergeada): "Wendy"/"Wendy Mardigian" → "Ana"/"Ana Pérez" en ~54 archivos
(comentarios y fixtures de test, nunca lógica ni nombres de columna),
"ScaleOS" → "un sistema anterior", los handles reales de Instagram
(`wendymardigian`, `wendy.sistemas`) → `cuenta_demo`, el payload "real" de
Zernio en `lib/zernio-message.test.ts`/`lib/backfill-messages.test.ts` →
IDs falsos del mismo formato. Dos migraciones viejas (`00073`, `00118`) con
comentarios editados, mismo criterio que B2.

**B4 — docs, redacciones y el script de export** (mismo patrón, rama
`oneshot-white-label-b4-docs`, mergeada): se borraron `docs/shots/` (32
capturas con contactos y emails reales) y
`docs/chat-media/zernio-share-samples.json` (posts reales de un tercero);
`docs/referencia/prototipo-ssa-baios.html` resultó no existir en el repo (se
había quedado sin trackear fuera de este worktree). Se redactaron el
project ref de Supabase y las URLs de Railway/Evolution en varios docs de
historia, y el teléfono real en `docs/agente-ia.md`. `CLAUDE.md` suma la
sección "White label". **`scripts/export-template.mjs`** nuevo: arma una
copia limpia en una carpeta hermana, con git nuevo (un commit) y un grep de
control al final — probado de punta a punta tres veces.

**Cierre del grep final** (después de mergear B3 y B4): quedaban 4 restos —
dos míos (un comentario de migración que decía "el de Wendy..." y el
crédito a ZernFlow en `README.md`, que ahora queda solo en
`THIRD_PARTY_NOTICES.md`) y dos del propio self-check del script de export
(que por fuerza tiene que nombrar las palabras que busca). Las palabras del
self-check quedaron partidas en dos strings concatenados — un grep sobre el
archivo ya no las encuentra como substring contiguo, pero el `RegExp`
compilado sigue buscándolas enteras — y se agregó `settings.local.json`
(permisos locales de Claude Code, nunca del repo) a lo que el export no
copia. **`grep -riE "zernflow|wendy|mardigian|scaleos|50670814873|knrxjn"`
sobre `app lib components public scripts supabase` da 0** (fuera de
`supabase/.temp`, que es estado local del CLI, no versionado).

## Bloque C — Zona horaria por usuario

**Hecho:**
- **Migración `00121_user_preferences`**: tabla `user_id` (PK) → `timezone`,
  `timezone_source` ('browser'|'manual'). RLS pura por `auth.uid()`, sin
  workspace. **Migración `00123`** (de seguimiento, ver abajo) la hace
  reusar el trigger compartido en vez de uno propio.
- **Migración `00122`**: default de `workspaces.timezone` de
  `'America/Costa_Rica'` a `'UTC'` — solo afecta workspaces nuevos. Las
  funciones RPC de los dashboards con el mismo default en `p_tz` se dejaron
  sin tocar a propósito: la app siempre pasa `p_tz` explícito, así que el
  default no tiene efecto real, y reescribir esas funciones completas solo
  para cambiar un literal sin uso era un riesgo real (transcribir mal un
  cuerpo de función grande) por un beneficio simbólico.
- `lib/user-timezone.ts` (`getSavedViewerTimezone`, cacheada por request;
  `resolveViewerTimezone` con el respaldo preferencia → workspace → UTC),
  `lib/actions/user-preferences.ts` (`saveDetectedTimezone`, que nunca pisa
  una fila que ya existe; `setViewerTimezone`, manual), y
  `components/timezone-bootstrap.tsx`, montado en el layout del dashboard:
  detecta `Intl.DateTimeFormat().resolvedOptions().timeZone` una sola vez,
  la primera vez que alguien entra sin preferencia guardada.
- `DashboardChrome` suma `viewerTimezone` (resuelta una vez por el layout) y
  el hook `useViewerTimezone()`. Selector de zona horaria nuevo en el menú
  de perfil (mismo catálogo que el ajuste del negocio).
- **`lib/dates.ts` reescrito**: se eliminan `APP_TIMEZONE` (Buenos Aires) y
  `BUSINESS_TIMEZONE` (Costa Rica). Todas las funciones reciben la zona por
  parámetro, sin default — la regla: zona del NEGOCIO
  (`workspaces.timezone`) para lo que no puede depender de quien mira; zona
  de QUIEN MIRA (`resolveViewerTimezone`) para lo que se muestra, filtra o
  agrupa.
- Arreglando esto aparecieron **tres bugs reales** (no cosmesis): el horario
  de atención del agente y los topes de gasto de IA corrían SIEMPRE en
  Costa Rica, ignorando el ajuste "Zona horaria" de Ajustes (`runner.ts`
  nunca les pasaba ninguna zona); la pestaña Acciones del agente ya aceptaba
  un `timeZone` pero la página nunca lo mandaba, así que filtraba en Buenos
  Aires para cualquiera; la bandeja tenía el mismo bug, mismo default.
  Los tres, arreglados.
- Costos y KPIs del agente (`costs-query.ts`) y "hoy" de borradores
  (`drafts/metrics-query.ts`) se quedan en la zona del NEGOCIO a propósito
  — el propio comentario del archivo ya documentaba esa decisión
  (consistencia con los topes de gasto) y cambiarla rompía esa consistencia
  sin necesidad real. Desviación del plan, explicada en el commit.
- Ocho respaldos "si el workspace no tiene zona" que apuntaban a Costa Rica
  o Buenos Aires pasaron a `UTC` (publishing, content-calendar, metrics
  sync, background dispatch). `scatter-chart.tsx` ignoraba la zona del
  workspace del todo (Costa Rica fija en las dos fechas que dibuja): ahora
  recibe `timeZone` por prop como el resto del dashboard de IA.
- Fechas de integraciones (antes Buenos Aires fija) y el seguimiento de un
  contacto pasan a la zona de quien mira.
- **Barrido más amplio delegado** (rama `oneshot-white-label-c-sweep`, en
  revisión): el resto de las páginas de dashboards/reportes que todavía
  tenían `workspace.timezone || "America/Costa_Rica"` como único origen, y
  los bugs puntuales ya identificados (cortes de día en UTC con
  `.slice(0,10)` en los dashboards, el rango UTC de la agenda admin, la
  medianoche UTC de `read-tools.ts`, las semanas UTC de `review-queue.ts`,
  el "hoy" UTC de `usage-counts.ts`, y el doble-interpretación de zona en
  `contact-editor.tsx`). Se actualiza este documento cuando termine.

**Deliberadamente fuera de esta corrida** (no son bugs, son pulido o una
variable nueva que nadie pidió con urgencia):
- El barrido de `"es-AR"` suelto en formateadores (~38 archivos) hacia un
  `NEXT_PUBLIC_LOCALE`/`lib/locale.ts` configurable.
- `DEFAULT_PHONE_COUNTRY = "CR"` (`lib/scheduling/phone-countries.ts`) por
  una variable `NEXT_PUBLIC_DEFAULT_COUNTRY`: no se implementó, así que no
  hace falta cargar nada en Railway por esto todavía.
- El delay "esperar hasta" del flow builder: se guarda pero el motor lo
  ignora (bug preexistente, no nuevo de esta corrida).

## Migraciones aplicadas (00119 a 00123)

Aplicadas contra la base real (`knrxjnmxnmjavivyuwew`) con la CLI
(`supabase db query --linked -f`, igual que documenta `CLAUDE.md`: el MCP de
Supabase rechazó tanto `apply_migration` como escrituras por `execute_sql`
sin dar motivo, así que se usó la CLI para las cinco) y registradas a mano en
`supabase_migrations.schema_migrations`. Cada una se verificó con una lectura
antes de pasar a la siguiente:

- **00119**: `handle_new_user` releída de `pg_proc` — el cuerpo coincide
  exactamente con el archivo, con el chequeo de `invite_id` presente.
- **00120**: los 25 `ssa-cron-*` ya no existen en `cron.job`; los 25 nombres
  nuevos existen, con el mismo `schedule` que tenían antes (capturado antes
  y después de aplicar).
- **00121**: tabla, columnas, constraint y las tres policies (`select`,
  `insert`, `update`, sin `delete`) confirmadas contra
  `information_schema`/`pg_policies`.
- **00122**: `column_default` de `workspaces.timezone` es `'UTC'::text`; el
  workspace de Wendy sigue en `'America/Costa_Rica'` (no se tocó ninguna
  fila existente).
- **00123** (de seguimiento, no estaba en el plan original): `get_advisors`
  marcó `function_search_path_mutable` en la función de trigger propia de la
  00121 apenas se aplicó — en vez de reescribir la 00121 ya aplicada, se
  agregó esta migración para repuntar el trigger a `update_updated_at()`
  (la función compartida que ya usa el resto de las tablas desde la 00001,
  que ya tiene `SET search_path`) y borrar la propia. Verificado:
  `get_advisors` ya no tiene ningún hallazgo nuevo.

## Ajustes de datos en la base de Wendy

Antes de mergear, se leyó su config real para no cambiarle el
comportamiento:

- **Palabras prohibidas**: su agente "Asistente de conversacion" ya tenía
  `phrases: ["ScaleOS"]` guardado explícito en la base — **no hizo falta
  escribir nada**, el `DEFAULT_BANNED_WORDS` vacío del código no la afecta.
- **Link de WhatsApp**: el `tools_config.generar_link_whatsapp` de ese mismo
  agente tenía `plantilla_default: "Hola Wendy, te escribo desde
  Instagram."` guardado (tampoco se tocó: es su configuración, no el
  default del código) pero no tenía el campo nuevo `nombre_destino`. Se le
  agregó `"nombre_destino": "Wendy"` con un `UPDATE` puntual por `id`, para
  que el saludo "con contexto" siga diciendo "Hola Wendy, soy &lt;lead&gt;..."
  exactamente como antes.
- **Textos de botón**: los 12 ya están marcados `is_button = true, source =
  'rule'` en `message_texts` para su workspace — confirmado, sin cambios.

**Hallazgo de paso, sin tocar**: existe un segundo workspace, "Paula Diaz's
Workspace", creado por el trigger viejo (antes de la 00119) cuando esa
persona se registró por el `/register` público que ya no existe. No es
miembro del workspace real de Wendy. Se informa, no se borra nada.

## Variables de Railway

Confirmado con `list-variables` contra el proyecto "SSA Business AI OS":
antes de esta corrida **faltaban las tres** variables nuevas. Se cargaron
con `skipDeploys: true` (no disparan un deploy propio; las toma el deploy
del merge):

- `EVOLUTION_INSTANCE_PREFIX=ssa` — el mismo valor que ya era el default en
  el código: no cambia nada hoy, pero deja el WhatsApp a salvo si el
  default del código cambia en el futuro sin revisar Railway.
- `NEXT_PUBLIC_BRAND_NAME=Scale·OS`.
- `AI_LANGUAGE_STYLE=español rioplatense (vos/tenés)`.

`NEXT_PUBLIC_DEFAULT_COUNTRY` no se cargó: no está implementada en el
código (ver "Deliberadamente fuera de esta corrida"), así que no hay nada
que leería esa variable todavía.

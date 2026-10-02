# Requerimientos v2.0: Navegación, Bandeja, Configuración, Integraciones y Observabilidad de IA

**Proyecto:** SSA Business AI OS
**Paso del Método Builder:** 05-Requerimientos (brownfield, capa de interfaz + dos pantallas nuevas)
**Versión:** 2.0 · 1 de octubre de 2026
**Reemplaza:** la v1.1, que fue escrita contra el prototipo y **no contra el código**. Varias de sus premisas eran falsas; la §2 las lista una por una.
**Para:** Claude Code, **un bloque por sesión, en orden**, cada una en su worktree. Cada bloque corre sus propias migraciones.

---

## 0. Cómo usar este documento

Cinco bloques, **39 funcionalidades**: N (menú lateral, N1-N5), I (Bandeja, I1-I7), S (Configuración, S1-S7), G (Integraciones, G1-G10), A+R (Observabilidad, A1-A6 y R1-R4).

**Esta versión está anclada al código real**, leído el 1 de octubre de 2026 en `main` (último commit `4fd0960`). Cada bloque empieza diciendo **qué existe hoy**, con rutas de archivo y nombres textuales, y recién después qué cambia. Si al abrir el código algo no coincide con lo que dice acá, **gana el código**: avisá y no construyas sobre la diferencia.

### Orden de ejecución

```
Sesión 1 → Bloque N   (feat/nav-grupos)
Sesión 2 → Bloque I   (feat/bandeja-barra)
Sesión 3 → Bloque S   (feat/ajustes-secciones)
Sesión 4 → Bloque G   (feat/integraciones-dos-secciones)
Sesión 5 → Bloques A+R (feat/observabilidad-ia)
```

Secuencial: cada sesión arranca de `main` con la anterior ya mergeada. **No hay contratos congelados ni stubs**: cada sesión ve el trabajo de la anterior. N va primera porque I, S y G cuelgan de la navegación. A+R va última porque es la única con migración y la única que toca la base.

### Requisitos previos

1. La sesión anterior está mergeada en `main` y sus tests pasan.
2. `npx vitest run` en verde **antes** de empezar. Si ya viene en rojo, avisá y no construyas encima.
3. Backup del día de la base (solo relevante para la sesión 5).
4. Este documento guardado en `docs/requerimientos-ui-navegacion-observabilidad.md`.

### Reglas de la corrida (se suman a las del `CLAUDE.md`)

- **Las rutas no cambian.** Todas las de este sistema están en inglés (`/dashboard/settings`, `/dashboard/contacts`, `/dashboard/agents`). Cambian **etiquetas** y **agrupamiento**, no URLs. Una ruta que muera sin redirección es un reporte de bug la semana siguiente.
- **Cada bloque corre sus propias migraciones.** La numeración es secuencial (`000NN_nombre.sql`). La última aplicada es `00111`. La banda `00104`-`00109` quedó libre; **no la uses**, seguí desde `00112` para que el orden de aplicación coincida con el orden cronológico. Después de escribir una: `node scripts/build-all-migrations.mjs`. Antes de aplicar: `list_migrations`.
- **Hay otra sesión trabajando en paralelo** (mejoras de chat). No toques `messages`, `conversations`, `contacts`, `chat_media` ni nada bajo `lib/chat-media/` o `lib/messages/`. Si creés que hace falta, pará y avisá.
- Después de cada funcionalidad, `npx vitest run`. Después de cada bloque, `docs/PROGRESS-<bloque>.md` y commit.
- **Capturas obligatorias** al cerrar cada bloque, a 1440 px y a 390 px, en `docs/shots/`. Una sesión que no tiene a nadie mirando no "revisa visualmente": deja la captura para que la revise una persona.
- **Cuatro tests estructurales van a frenarte si no los tenés presentes.** Están en §2.6. Leelos antes de escribir la primera línea.

---

## 1. Qué cambia y qué NO cambia

### 1.1 Cambia

- **Menú lateral:** de lista plana de 11 ítems a **grupos con título**, todo en español, sin `Channels`, con `Integraciones`.
- **Bandeja:** las pestañas de sección y el buscador suben a la barra superior; el panel de filtros inline pasa a ser un **popover**.
- **Configuración:** General se parte en secciones con navegación interna; se sacan las tarjetas-link duplicadas; Equipo y Roles se vuelven visibles una desde la otra; se termina de pasar a español.
- **Integraciones:** de **6 secciones a 2** (Conexiones · Inteligencia artificial), con chips de tipo. Se enchufa la **salud de la credencial**, que ya está escrita y testeada pero hoy no corre. El modal pasa a ser una **pantalla de detalle**.
- **Agentes:** gana un **mini dashboard** de gasto y corridas arriba de la lista.
- **Pantalla nueva:** `/dashboard/agents/runs`, la lista global de corridas para auditoría.
- **Una migración:** la agregación de gasto por día. Nada más.

### 1.2 NO cambia (intocable)

- **`lib/ai/run.ts`.** Es la única puerta hacia los proveedores de IA y ya funciona. No se reescribe, no se cambia su firma, no se agregan fuentes al CHECK de `source`.
- **Las tablas `agent_runs`, `agent_run_steps` y `model_pricing`.** Ya existen y están bien. **No se crean tablas nuevas de observabilidad.**
- **El motor de flows**, su registry y sus triggers.
- **El receptor de webhooks** y sus endpoints.
- **Vault** y el patrón de secretos.
- **La lógica de conexión de cada integración.** Se reorganiza cómo se ven; no se reescribe cómo se conectan.
- **Las rutas públicas** (`/api/hooks/*`, `/api/webhooks/*`, `/calendario/*`).
- **La pantalla `/dashboard/channels`.** Sale del menú, pero la pantalla **se conserva entera**: tiene el QR de WhatsApp, el alta de canales y la sincronización, y nada de eso se reconstruye en otro lado.

---

## 2. Lo que encontré en el código (y por qué esta versión existe)

La v1.1 se escribió mirando el prototipo. Al leer el código aparecieron seis cosas que la invalidaban. Van acá porque explican todas las decisiones que siguen.

### 2.1 La observabilidad de IA ya está construida

No parcialmente: **está completa del lado de los datos.**

| Qué | Dónde | Desde |
|---|---|---|
| `agent_runs`, `agent_run_steps`, `model_pricing` | `supabase/migrations/00059_agent_runs.sql` | Fase 3 |
| Policies y privilegios de columna | `00060_agents_rls.sql` | |
| `sum_ai_spend(workspace, since, agent?)` | `00064_ai_spend_sum.sql` | |
| `ai_cost_report(workspace, from, to) → jsonb` | `00069`, **redefinida en `00071`** | |
| `messages.agent_run_id` | `00059` | |
| `purge_agent_run_step_content(meses)` + cron diario | `00059` | |
| La puerta única hacia los proveedores | `lib/ai/run.ts` → `openAiRun`, `recordRunOutcome`, `closeStaleRuns` | |
| Precios sembrados | `supabase/seeds/00_model_pricing.sql` (19 modelos) y `01_transcription_pricing.sql` (3) | |

**Once fuentes ya registran corrida**, con su `source`: `agent`, `flow_ai_node`, `sequence_ai_step`, `kb_indexing`, `conversation_summary`, `message_classification`, `content_copy`, `ads_analysis`, `audio_transcription`, `media_description` (y `message_classification_eval`, que está en el CHECK y nadie escribe).

**Qué significa:** el bloque A+R **no construye un sistema de medición**. Construye **las dos pantallas que faltan** sobre el sistema que ya existe. La v1.1 mandaba crear `ai_runs` y `ai_run_steps` en micro-dólares: eso habría levantado un sistema paralelo y redundante de medición de costos, que es el peor desenlace posible para algo hecho para auditar.

**Los micro-dólares se descartan.** La unidad del sistema es `numeric(12,6)` USD, el costo se congela al cerrar la corrida y si falta un precio queda `NULL` (nunca un parcial). Está resuelto mejor de lo que proponía la v1.1 y no se toca.

### 2.2 Las rutas están en inglés y Configuración no son pestañas de query param

Las rutas reales: `/dashboard/settings`, `/dashboard/settings/{team,roles,integrations,custom-fields,background,templates}`, `/dashboard/contacts`, `/dashboard/agents`, `/dashboard/channels`, `/dashboard/content`, `/dashboard/social`, `/dashboard/inbox`, `/dashboard/drafts`, `/dashboard/flows`, `/dashboard/knowledge`, `/dashboard/dashboards/{chat,content,ads,unified}`.

Configuración ya tiene **pestañas de verdad** (`components/settings/settings-tabs.tsx`), con subrayado, y son **sub-rutas**, no `?tab=`. Son cuatro: General, Equipo y roles, Integraciones, Tareas. `custom-fields` y `templates` existen como rutas pero **quedaron fuera del sistema de pestañas**.

### 2.3 No existe el módulo de Ventas

No hay ruta, ni ítem de menú, ni clave de permiso, ni tabla. Está especificado en `claude/requerimientos-ventas.md` pero no construido. **El grupo Ventas del menú arranca con dos ítems** (Contactos y Agenda) y reserva el lugar de Facturación para cuando exista.

### 2.4 Zernio ya es una sola card, y Whop no existe

El catálogo (`lib/integrations/providers.ts`) tiene **14 proveedores en 6 secciones**, con una sola entrada `zernio`. No hay nada que unificar. `whop` no aparece en ningún lado del repo. **Postproxy sí existe y está completo** (publicación, webhook, barra de uso, prueba de clave).

### 2.5 Postproxy no es fuente de métricas — el selector que pedías es otro

La v1.1 diseñaba un "resolver de fuente de métricas" entre Google y Postproxy. **Postproxy no lee métricas de nada.** La fuente de métricas está en un `switch` por plataforma en `lib/jobs/handlers/metrics-sync.ts`: Instagram y TikTok por Zernio, Threads por su API, **YouTube por Google**, LinkedIn por nadie (su API no lo permite desde afuera). No hay nada que elegir.

Lo que **sí** es una elección real y hoy casi no tiene interfaz es **por dónde se publica**: `social_accounts.publishers` y `social_accounts.default_publisher` (`PUBLISHER_IDS = ["zernio","postproxy","youtube_api","linkedin_api","threads_api"]`), con estado por publicador (`available` / `unverified` / `unavailable`). Hoy solo se puede elegir **post por post**, en un `<select>` del editor de contenido. **G7 pasa a ser eso**: el selector de publicador por cuenta.

Y Google: hay **dos conexiones OAuth distintas con el mismo cliente**. `google` (YouTube: `youtube.readonly`, `youtube.upload`, `yt-analytics.readonly`, `youtube.force-ssl`) y `google_calendar` (por persona, se configura en Agenda, no en Integraciones). **Drive no existe**: no hay un solo scope de Drive en el repo.

### 2.6 Cuatro tests estructurales que te van a frenar

No son opcionales ni se borran. Son la red que mantiene el menú y la navegación coherentes.

1. **`lib/nav/items.test.ts`** fija, entre otras cosas, que `Integraciones` **no** está en el menú (por `name` y por `href`), que `Contenido` va justo después de `Flows`, y el baseline exacto de un Member: `["Dashboards","Flows","Contenido","Inbox","Contacts","Agentes"]`. El bloque N **tiene que reescribir estas aserciones**, no eludirlas.
2. **`lib/auth/member-baseline.test.ts`** fija textualmente las listas de ítems `adminOnly` (`["Channels","Conocimiento","Settings","Social"]`) y no-`adminOnly`, y que **no haya ninguna página con `requireWorkspaceAdmin` fuera de su lista de 12**. Una pantalla nueva con guard de admin rompe este test si no se agrega.
3. **`lib/nav/page-actions.test.ts`** recorre el filesystem y exige que **toda** ruta bajo `app/(dashboard)` esté en `PAGE_META` o en `PAGES_WITHOUT_HEADER` (con un motivo de más de 20 caracteres), **y** que su `page.tsx` llegue a `<PageHeader` siguiendo imports. La pantalla de Corridas rompe los dos si no se registra.
4. **`lib/vault-boundary.test.ts`** recorre los imports reales desde cada Client Component y falla si alguno llega a `lib/vault.ts` o a `lib/supabase/server.ts`. Si el bloque G crea un componente cliente nuevo que importa del catálogo, hay que revisar que la cadena no arrastre Vault.

### 2.7 Dos cosas más que condicionan todo

**El muro de los privilegios de columna.** La `00060` revoca el SELECT de tabla y lo re-otorga por lista. Un usuario autenticado —**incluido un Owner**— no puede leer `input_tokens`, `output_tokens`, `cached_tokens`, `embedding_tokens`, `cost_usd`, `pricing_id` ni `audio_seconds` de `agent_runs`. **Todo lo que muestre costo o tokens tiene que ser server-side con service role detrás de un guard.** No es un detalle de implementación: define la arquitectura de las dos pantallas nuevas.

**Hay dos vocabularios de período en la misma app**, y mezclarlos sin decidir es el bug más probable de todo este trabajo:

| | `lib/dates.ts` | `lib/dashboards/period.ts` |
|---|---|---|
| Tipo | `DatePreset` | `PeriodPreset` |
| Presets | 4: `hoy`, `7d`, `30d`, `custom` | 11: `hoy`, `esta-semana`, `semana-pasada`, `este-mes`, `mes-pasado`, `7d`, `30d`, `60d`, `90d`, `este-ano`, `historico` |
| Componente | `DateFilter` (`components/agents/filters.tsx`) | `PeriodPopover` (`components/dashboards/chat/filters/`) |
| Params | `fecha`, `desde`, `hasta` | `period`, `from`, `to` |
| Quién lo usa | las pestañas de Agentes | el dashboard de Chat |

---

## 3. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| **D1** | **La observabilidad son pantallas sobre `agent_runs`.** Cero tablas nuevas, cero micro-dólares, cero instrumentación nueva. | §2.1. Lo que falta son las vistas, no la medición. |
| **D2** | **El grupo Ventas arranca con Contactos y Agenda.** Facturación entra cuando exista el módulo. | §2.3. Un ítem de menú que lleva a una ruta inexistente rompe el test de `href` de N1. |
| **D3** | **`Channels` sale del menú; la pantalla se conserva.** Se llega desde el detalle de Zernio y de Evolution en Integraciones. | La pantalla tiene el QR de WhatsApp y el alta de canales. Sacarla del menú es lo que pediste; borrarla sería perder funcionalidad real. |
| **D4** | **Integraciones pasa de 6 secciones a 2**, con chips de tipo derivados del catálogo que ya existe. | Seis encabezados para catorce cards es más estructura que contenido. La división que importa es **conexión externa vs. proveedor de modelo**: son dos decisiones distintas, de dos personas distintas. |
| **D5** | **No hay selector de fuente de métricas. Hay selector de publicador por cuenta.** | §2.5. Postproxy no lee métricas. Lo que sí existe sin interfaz es elegir por dónde sale cada red. |
| **D6** | **Se adopta `PeriodPreset` (11 presets) para las pantallas nuevas**, y `loadRuns` se generaliza para aceptar un rango ya resuelto. `DateFilter` sigue donde está. | §2.7. Un solo vocabulario en lo nuevo, sin reescribir lo viejo. |
| **D7** | **El permiso es `ai_costs.view`, que ya existe** en `PERMISSION_KEYS` (módulo `agents`). No se crea ninguna clave nueva. | Ya está, ya tiene su lugar en la matriz de roles, y significa exactamente lo que hace falta. |
| **D8** | **Corridas es una ruta global nueva** (`/dashboard/agents/runs`) y la pestaña Runs del agente pasa a ser esa misma vista con `?agente={id}`. | Hoy el historial vive escondido adentro del detalle de un agente. Para auditar hace falta verlo todo junto, y duplicar la vista sería mantener dos. |
| **D9** | **El detalle de una corrida se extrae a un componente compartido** que usan la lista y la pantalla de detalle. | Hoy el acordeón de la pestaña Runs muestra **más** que la pantalla de detalle (`runs/[runId]`): muestra el `input` de las herramientas, el routing en lenguaje llano y los títulos de los fragmentos de la base de conocimiento. El "detalle" es la vista pobre. |
| **D10** | **La salud de la credencial se enchufa, no se escribe.** `integrationStatus()` ya sabe calcular vencimiento y scopes faltantes; la pantalla nunca le pasa `connection` ni `requiredScopes`. | §G6. Es la mejora con mejor relación valor/esfuerzo de todo el documento: lógica escrita, testeada y apagada. |

---

## 4. Bloque N: Menú lateral

**Migraciones:** ninguna. **Rama:** `feat/nav-grupos`.

### Lo que existe hoy

`lib/nav/items.ts` exporta `interface NavItemMeta { name, href, icon, adminOnly, permissions? }`, el array `NAV_ITEMS` (11 ítems, **lista plana, sin agrupación**) y `visibleNavItems(items, { isAdmin, permissionKeys })`. El sidebar (`components/sidebar.tsx`) resuelve el ícono con el mapa `ICONS` (lucide) y renderiza un `.map()` plano.

El colapso **no es estado de React**: `toggleCollapsed()` hace `classList.toggle("sidebar-collapsed")` sobre el `<html>` y lo guarda en `localStorage`; se lee con `useHtmlClass("sidebar-collapsed")` y se aplica antes del primer pintado con un script en el `<head>`. La variante CSS es `@custom-variant collapsed (html.sidebar-collapsed &:where([data-sidebar="desktop"], ...))`, o sea **solo aplica al sidebar de escritorio**: el cajón del teléfono reusa `NavLinks` y nunca colapsa.

Hay **un solo badge**, el de borradores, sobre Inbox, como `<Link>` hermano posicionado en absoluto.

### N1: Grupos

**Descripción:** `NavItemMeta` gana un campo de grupo y `NAV_ITEMS` pasa a renderizarse agrupado, con título por grupo, dos ítems sueltos arriba y dos pegados al fondo.

```
  Dashboards                    (suelto)
  Bandeja          • badge      (suelto)

  ADQUISICIÓN
    Contenido
    Social

  VENTAS
    Contactos
    Agenda
    ·  (Facturación entra acá cuando exista el módulo — D2)

  AUTOMATIZACIÓN
    Automatizaciones
    Agentes
    Conocimiento
  ──────────────────            (separador, pegado al fondo)
    Integraciones
    Ajustes
```

**Equivalencias — las rutas NO cambian:**

| `name` hoy | `name` nuevo | `href` (sin cambios) | `adminOnly` |
|---|---|---|---|
| `Dashboards` | `Dashboards` | `/dashboard/dashboards/chat` | false |
| `Inbox` | **`Bandeja`** | `/dashboard/inbox` | false |
| `Contenido` | `Contenido` | `/dashboard/content` | false |
| `Social` | `Social` | `/dashboard/social` | true |
| `Contacts` | **`Contactos`** | `/dashboard/contacts` | false |
| `Agenda` | `Agenda` | `/dashboard/agenda` | false |
| `Flows` | **`Automatizaciones`** | `/dashboard/flows` | false |
| `Agentes` | `Agentes` | `/dashboard/agents` | false |
| `Conocimiento` | `Conocimiento` | `/dashboard/knowledge` | true |
| `Channels` | *(sale del menú)* | `/dashboard/channels` | — |
| — | **`Integraciones`** *(nuevo)* | `/dashboard/settings/integrations` | true |
| `Settings` | **`Ajustes`** | `/dashboard/settings` | true |

El ícono de Integraciones es `Blocks` (hay que volver a agregarlo al mapa `ICONS`: se había borrado cuando el ítem salió del menú).

**Criterios:**
- CUANDO se renderiza el menú, los grupos DEBEN aparecer en el orden declarado, con Dashboards y Bandeja **antes** del primer título de grupo.
- CUANDO se renderiza el menú, Integraciones y Ajustes DEBEN estar pegados al fondo, separados del último grupo por una línea.
- CUANDO una persona no tiene permiso para un ítem, el ítem NO DEBE aparecer; **y si un grupo queda sin ningún ítem visible, su título tampoco DEBE aparecer**. Un encabezado sin nada debajo es un bug visual.
- Todo `href` del árbol DEBE resolver a una ruta que existe. Test que los recorre.
- `visibleNavItems` NO DEBE cambiar de firma ni de semántica: `adminOnly` sigue valiendo por rol y `permissions` sigue siendo "alguno de".

### N2: Permisos de los ítems nuevos

**Descripción:** solo se agrega permiso donde hoy no hay, y **sin inventar claves**. Las 41 claves de `PERMISSION_KEYS` son las que son.

- `Integraciones` → `adminOnly: true`. (Su pantalla ya usa `requireWorkspaceAdmin()`; la clave `integrations.manage` existe, pero el ítem sigue el mismo criterio que el resto de las pantallas admin para no desalinearse del `member-baseline`.)
- El resto de los ítems **conserva exactamente** su `adminOnly` y sus `permissions` de hoy.

**Criterios:**
- NINGUNA clave nueva DEBE agregarse a `PERMISSION_KEYS` en este bloque.
- `lib/auth/member-baseline.test.ts` DEBE actualizarse para que la lista `adminOnly` sea `["Ajustes","Conocimiento","Integraciones","Social"]` y la no-`adminOnly` `["Agenda","Agentes","Automatizaciones","Bandeja","Contactos","Contenido","Dashboards"]`, ordenadas. **Se actualiza la aserción, no se borra el test.**

### N3: Sidebar colapsado

**Descripción:** colapsado a 72 px, solo íconos. Los títulos de grupo no entran.

- Los títulos se reemplazan por una **línea separadora fina** entre grupos. Los ítems sueltos de arriba y los del fondo conservan sus separadores propios.
- El tooltip del ícono muestra la etiqueta **y** su grupo (`Contactos · Ventas`), que es justamente lo que se pierde al colapsar.
- El mecanismo de colapso **no cambia**: sigue siendo la clase en el `<html>` + `localStorage` + el script del `<head>`. No se migra a estado de React.

**Criterios:**
- CUANDO el sidebar está colapsado, NO DEBE haber texto de títulos de grupo renderizado.
- CUANDO el sidebar está colapsado, DEBE haber exactamente una línea separadora entre grupos consecutivos visibles, y ninguna al principio ni al final.
- CUANDO se abre el cajón del teléfono, los grupos y sus títulos DEBEN verse (ahí no hay colapso).

### N4: Estado activo

**Descripción:** hoy el activo es `pathname.startsWith(item.href)` más una excepción que mapea `drafts`, `broadcasts`, `sequences` y `growth` a Inbox. Se suma el caso de Integraciones, que es sub-ruta de Ajustes.

- **Integraciones** está activo cuando `pathname.startsWith("/dashboard/settings/integrations")`.
- **Ajustes** está activo cuando `pathname.startsWith("/dashboard/settings")` **y no** cuando lo está Integraciones.
- La excepción de Bandeja se conserva tal cual, y se le suma `/dashboard/channels` (que ya no tiene ítem propio y conceptualmente cuelga de Integraciones → se marca **Integraciones**).

**Criterios:**
- CUANDO la ruta es `/dashboard/settings/integrations`, Integraciones DEBE estar activo y Ajustes NO.
- CUANDO la ruta es `/dashboard/settings/team`, Ajustes DEBE estar activo e Integraciones NO.
- CUANDO la ruta es `/dashboard/channels`, Integraciones DEBE estar activo.
- Exactamente **un** ítem DEBE tener `aria-current="page"` en cualquier ruta del dashboard. Test que recorre todas las rutas de `PAGE_META`.

### N5: Los tests que hay que reescribir

**Descripción:** no es trabajo opcional, es parte del bloque.

- `lib/nav/items.test.ts`: la aserción "Integraciones no está en el menú" **se invierte**; el baseline de Member pasa a los nombres nuevos; se agrega una aserción de que cada ítem pertenece a un grupo declarado y de que no hay grupos vacíos declarados.
- `lib/auth/member-baseline.test.ts`: las dos listas de N2.
- `lib/nav/page-actions.test.ts`: no debería romperse (no se crean rutas en este bloque), pero se corre igual.

**Criterios:**
- `npx vitest run` en verde al cerrar el bloque, sin tests saltados ni comentados.
- NINGÚN test se borra. Si una aserción ya no aplica, se reescribe diciendo la regla nueva.

---

## 5. Bloque I: Bandeja

**Migraciones:** ninguna. **Rama:** `feat/bandeja-barra`.

### Lo que existe hoy

Mejor de lo que parecía desde el prototipo: **la lógica de filtros ya está hecha, es pura y está testeada.**

`lib/inbox/filters.ts` exporta `INBOX_STATUS_VALUES`, `DEFAULT_INBOX_STATUS`, `INBOX_STATUS_LABELS`, `ASSIGNMENT_ANY | ASSIGNMENT_UNASSIGNED | ASSIGNMENT_AI`, `interface InboxFilters`, `EMPTY_INBOX_FILTERS`, **`countActiveFilters(filters)`**, `needsServerToFilter(filters)`, `matchesInboxRow(row, filters, range)` y `statusForQuery(status)`. `lib/inbox/needs-human.ts` aporta `NEEDS_HUMAN_PARAM` y el badge.

**Los parámetros de URL ya existen y tienen nombre.** Se usan tal cual, no se renombran:

| Param | Filtro |
|---|---|
| `q` | búsqueda (pasa por `sanitizeSearch`) |
| `estado` | `all` / `open` / `closed` / `snoozed`, default `open` |
| `canal` | multi-valor |
| `tag` | multi-valor (uuids validados) |
| `asignado` | `""` / `sin-asignar` / `agente-ia` / userId |
| `fecha`, `desde`, `hasta` | preset y rango |
| `error-agente` | `"1"` |
| `necesita-humano` | `"1"` |
| `page`, `c` | paginación y conversación abierta |

**Dónde está el problema, entonces.** `components/inbox/inbox-filters.tsx` (`InboxFiltersBar`) se renderiza **dentro de la columna de 320 px de la lista**, y el panel de filtros es un `<div>` inline con `border-t` que **empuja el contenido hacia abajo**: no flota, no cierra al hacer clic afuera, no maneja teclado ni `Esc`. Y `SectionTabs` (`components/comunicacion/section-tabs.tsx`, pastillas con ícono) se renderiza **debajo** del `PageHeader`, como una segunda franja, en las cuatro pantallas de comunicación.

Mientras tanto, la barra superior de la Bandeja está **vacía**: `inbox/page.tsx` renderiza `<PageHeader route="/dashboard/inbox" />` sin `left`, sin `right` y sin `filters`. `PageHeader` ya acepta esos tres props y abajo de 860 px (`topbar:`) baja los `filters` a una segunda franja con scroll horizontal.

Y ya existe un popover bien hecho con teclado completo, click-outside y `role="menu"`: `components/dashboards/chat/filters/filter-menu.tsx` (`FilterMenu`, `MenuGroupLabel`, `MenuOption`). Vive bajo `dashboards/chat/` pero **no tiene nada específico de ese dashboard**.

### I1: Promover `FilterMenu` a componente compartido

**Descripción:** se mueve `filter-menu.tsx` a `components/ui/filter-menu.tsx` sin cambiar su API, y se actualizan los imports del dashboard de Chat. Es un movimiento mecánico que habilita I3 y R2.

**Criterios:**
- La firma de `FilterMenu`, `MenuGroupLabel`, `MenuOption`, `ColorDot` y `Avatar` NO DEBE cambiar.
- El dashboard de Chat DEBE seguir funcionando igual: sus tests en verde, su captura sin diferencias.
- NO DEBE quedar ningún import apuntando a la ruta vieja.

### I2: Las pestañas de sección suben a la barra

**Descripción:** `SectionTabs` deja de renderizarse como franja propia y pasa al prop `left` del `PageHeader` de cada una de las cuatro pantallas (`inbox`, `broadcasts`, `sequences`, `growth`).

- Cambian de **pastillas con ícono** a **segmented control**, siguiendo el patrón que ya existe en `components/content/view-switcher.tsx` (que es el más canónico del repo y ya se pasa por `left`).
- El título de la barra pasa de `Inbox` a **`Bandeja`** en `PAGE_META`, para no tener el menú diciendo "Bandeja" y la barra "Inbox".
- Los íconos se conservan en el segmented control solo si entran a 390 px; si no, quedan solo las etiquetas.

**Criterios:**
- CUANDO se abre cualquiera de las cuatro pantallas, las pestañas DEBEN estar dentro de la barra superior de 56 px, no debajo.
- CUANDO el ancho es 390 px, NO DEBE haber scroll horizontal de página; las pestañas scrollean internamente.
- La sección activa DEBE seguir marcándose con `aria-current="page"`.
- Las cuatro rutas DEBEN seguir funcionando y el `(comunicacion)/layout.tsx` DEBE seguir sin dibujar pestañas.

### I3: El popover de filtros

**Descripción:** el panel inline de `InboxFiltersBar` pasa a ser un popover construido sobre `FilterMenu` (I1), y el botón que lo abre sube al prop `filters` del `PageHeader`.

Contenido del popover, con los mismos grupos que hoy: **Canal** (chips), **Tags** (chips), **Agente de IA** (los dos chips: `Con error del agente`, `Necesita humano`), **Asignación** (`<select>`), **Último mensaje** (preset + rango). Al pie, `N filtros activos` y `Limpiar filtros`.

- El contador del botón sale de **`countActiveFilters(filters)`**, que ya existe. No se recalcula.
- `Limpiar filtros` conserva `?c=`, como hoy.
- Cambiar un filtro sigue borrando `page` y haciendo `router.replace(..., { scroll: false })` dentro de un `useTransition`.
- **Debajo de la barra queda una línea de resumen** de lo filtrado cuando hay al menos un filtro activo (`Abiertas · Instagram · 2 tags`), con la `×` para limpiar. Sin filtros no se renderiza nada.

**Criterios:**
- CUANDO se hace clic afuera del popover, DEBE cerrarse.
- CUANDO se presiona `Esc` con el popover abierto, DEBE cerrarse y el foco DEBE volver al botón.
- CUANDO el popover está abierto, las flechas, `Home` y `End` DEBEN navegar sus opciones (es lo que `FilterMenu` ya hace).
- CUANDO hay N filtros activos, el botón DEBE mostrar `N`; con cero, NO DEBE mostrar contador.
- CUANDO se abre un link con filtros en la URL, el popover DEBE reflejarlos al abrirse.
- El popover NO DEBE empujar el contenido de la página.

### I4: El buscador sube a la barra

**Descripción:** el `<input type="search">` sale de la columna de 320 px y pasa a la barra superior, junto al botón de filtros.

- Sigue haciendo commit a `?q=` al enviar (Enter), con `sanitizeSearch`.
- El `placeholder` se adapta a la sección: Conversaciones → `Buscar por nombre, teléfono o texto del mensaje`; Broadcasts → `Buscar un broadcast`; Sequences → `Buscar una secuencia`; Growth → `Buscar una herramienta`.
- A 390 px el buscador colapsa a un ícono que lo expande; no compite por ancho con las pestañas.

**Criterios:**
- CUANDO se escribe y se presiona Enter, la URL DEBE actualizarse con `?q=`.
- CUANDO hay búsqueda activa, DEBE verse una `×` para limpiarla sin tocar el resto de los filtros.
- La búsqueda del servidor DEBE seguir siendo por `contacts.display_name` con `ilike` y la del cliente DEBE seguir usando `matchesInboxRow`. **No se cambia la semántica de la búsqueda en este bloque.**

### I5: El filtro es exclusivo de Conversaciones

**Descripción:** el botón de filtros y la línea de resumen solo existen en la sección Conversaciones. Broadcasts, Sequences y Growth tienen pestañas y buscador, no filtros.

**Criterios:**
- CUANDO la sección activa no es Conversaciones, el botón de filtros NO DEBE renderizarse.
- CUANDO se vuelve a Conversaciones, los filtros que estaban en la URL DEBEN seguir aplicados.

### I6: La columna de conversaciones

**Descripción:** al salir el buscador y los filtros, la cabecera de la columna queda con `Bandeja` y `N conversaciones`. Se conserva **todo lo demás tal cual**: avatar con badge de plataforma, `Ban` de no contactar, hora relativa diferida hasta `mounted`, preview, los cuatro badges condicionales (error del agente, necesita humano, borrador esperando, no leídos), la paginación y los dos empty states distintos.

El Realtime **no se toca**: canal `conversations-updates`, debounce de 800 ms, merge en cliente cuando la fila sigue cumpliendo `matchesInboxRow`.

**Criterios:**
- Las pastillas de estado (`Todas`/`Abiertas`/`Cerradas`/`Pospuestas`) DEBEN quedar visibles **fuera** del popover, arriba de la lista: son el filtro que más se usa y esconderlo detrás de un clic lo empeora.
- El link condicional `Borradores (N)` DEBE conservarse donde está.
- El comportamiento de Realtime DEBE ser idéntico al de antes. Test de caracterización.

### I7: Nueva conversación — fuera de alcance, con su razón escrita

**Descripción:** no existe hoy (cero resultados de grep) y **no se construye acá**. Empezar una conversación saliente depende de la ventana de mensajería de cada canal (24 h en WhatsApp, reglas distintas en Instagram), que es una decisión de producto que este documento no cubre.

**Criterios:**
- NO DEBE agregarse ningún botón de nueva conversación en este bloque.
- DEBE quedar anotado en `docs/PENDIENTE.md` con esta razón.

---

## 6. Bloque S: Configuración

**Migraciones:** ninguna. **Rama:** `feat/ajustes-secciones`.

### Lo que existe hoy

Cuatro pestañas (`components/settings/settings-tabs.tsx`): `General` → `/dashboard/settings`, `Equipo y roles` → `/dashboard/settings/team` (marca también `/roles`), `Integraciones` → `/dashboard/settings/integrations`, `Tareas` → `/dashboard/settings/background`. Son `<Link>` con subrayado; `General` compara por igualdad exacta y el resto por `startsWith`.

**General es una sola columna de 13 secciones apiladas** (`settings-view.tsx`, `max-w-2xl space-y-8`), separadas por `<hr>`: General (nombre), Zona horaria, Visibilidad de leads, Guardado de mensajes, Fotos/videos/audios del chat, API keys, Global Keywords, Team, Roles, Campos personalizados, Tareas en segundo plano, Frases de "no contactar", Respuestas rápidas. Un botón `Save Changes` al final que guarda **solo** nombre y keywords; el resto de las secciones guarda cada una por su cuenta.

**Cinco de esas secciones son tarjetas-link que duplican una pestaña o una ruta**: API keys (→ Integraciones), Team, Roles, Campos personalizados, Tareas en segundo plano. Son exactamente el motivo por el que no encontrabas dónde se crean los roles: **Roles es una ruta propia cuya única puerta es una tarjeta enterrada en la sección 9 de una página de 13**.

`custom-fields` y `templates` tienen ruta pero **no tienen pestaña** y **no renderizan `SettingsTabs`**: se caen del sistema de navegación.

Textos mezclados: "Workspace Name", "Global Keywords", "Team", "Manage Team", "Save Changes", "Settings saved", "Members", "Invite a Member", "Pending Invites".

Guards: todas `requireWorkspaceAdmin()`, salvo `roles` (que gatea vía `listRoles()` con el permiso `roles.manage`) y `templates` (que usa `getWorkspace()` y deja que mande la RLS).

### S1: Las pestañas

**Descripción:** de 4 a **6**, sumando las dos rutas huérfanas. Se mantiene el estilo de subrayado y el mecanismo de sub-rutas: **no se migra a `?tab=`**.

| Pestaña | Ruta | `also` |
|---|---|---|
| `General` | `/dashboard/settings` | — |
| `Equipo y roles` | `/dashboard/settings/team` | `/dashboard/settings/roles` |
| `Campos personalizados` | `/dashboard/settings/custom-fields` | — |
| `Respuestas rápidas` | `/dashboard/settings/templates` | — |
| `Integraciones` | `/dashboard/settings/integrations` | — |
| `Tareas` | `/dashboard/settings/background` | — |

**Criterios:**
- CUANDO se abre `/dashboard/settings/custom-fields` o `/templates`, DEBEN renderizarse las pestañas y la propia DEBE estar marcada.
- CUANDO se abre `/dashboard/settings`, solo `General` DEBE estar marcada (igualdad exacta, como hoy).
- A 390 px la fila de pestañas DEBE scrollear internamente, sin scroll horizontal de página.

### S2: General dividido en secciones

**Descripción:** General deja de ser 13 bloques apilados. Pasa a **cinco secciones con navegación interna**, y **se eliminan las cinco tarjetas-link duplicadas** (ya son pestañas o se llega por pestaña).

| Sección | Qué lleva |
|---|---|
| **Workspace** | Nombre, Zona horaria |
| **Conversaciones** | Visibilidad de leads, Guardado de mensajes, Frases de "no contactar", Global Keywords |
| **Archivos** | Fotos, videos y audios del chat (incluida la retención) |
| **IA** | Topes de gasto del workspace (diario y mensual) y escalar cuando no se entiende un audio |
| **Zona de peligro** | Lo destructivo, si lo hay |

La navegación interna es una **columna de anclas a la izquierda** en escritorio (el patrón que ya existe en `components/scheduling/config-nav.tsx` para la configuración de Agenda) y una fila con scroll en teléfono. Se reutiliza ese patrón, no se inventa otro.

La sección **IA** expone tres columnas de `workspaces` que hoy existen y **no tienen interfaz en ningún lado**: `ai_daily_cost_limit_usd`, `ai_monthly_cost_limit_usd` y `agent_escalate_on_unreadable`. Las dos primeras hoy solo se editan desde la pestaña Costos de un agente, que es un lugar raro para un ajuste del negocio.

**Criterios:**
- CUANDO se abre General, DEBEN verse las cinco secciones y la navegación interna.
- CUANDO se hace clic en un ancla, la vista DEBE ir a esa sección y el ancla DEBE marcarse.
- Las cinco tarjetas-link duplicadas NO DEBEN existir más.
- CADA ajuste DEBE conservar su forma de guardado actual: el botón de abajo sigue guardando nombre y keywords, y los demás siguen guardando solos. **No se unifica el guardado en este bloque.**
- CUANDO se guarda un tope de gasto desde acá, DEBE escribir las mismas columnas que escribe hoy `updateWorkspaceAiLimits`, reutilizando `updateWorkspaceAiLimits` de `lib/actions/agents.ts`.

### S3: Equipo y Roles, una al lado de la otra

**Descripción:** son dos rutas bajo una pestaña y hoy no hay forma de pasar de una a la otra. Se agrega un **segmented control** dentro de la pestaña, debajo de las pestañas: `Miembros` | `Roles`.

- En Roles, el botón `Nuevo rol` ya está en el `right` del `PageHeader` y **ahí se queda**: es el lugar correcto.
- El formulario de alta/edición de rol sigue siendo una sección debajo de la lista, no un modal. No se cambia.
- Se agrega, arriba de la lista de roles, la leyenda: **"Los roles Owner, Admin y Member vienen con el sistema y no se editan. Duplicá uno para armar el tuyo."**

**Criterios:**
- CUANDO se está en Miembros, DEBE haber un control visible para ir a Roles, y al revés.
- CUANDO se entra a `/dashboard/settings/roles` directo, el segmented DEBE mostrar `Roles` activo.
- El botón `Nuevo rol` DEBE seguir estando en la barra superior y DEBE seguir abriendo el formulario existente.

### S4: Español parejo

**Descripción:** se traducen los textos de las pantallas de Configuración y de Canales.

| Hoy | Nuevo |
|---|---|
| Workspace Name | Nombre del workspace |
| Global Keywords | Palabras clave globales |
| Save Changes / Saving… / Settings saved | Guardar cambios / Guardando… / Cambios guardados |
| Team / Manage Team | Equipo / Administrar equipo |
| Members (N) | Miembros (N) |
| Invite a Member / Invite | Invitar a alguien / Invitar |
| Pending Invites (N) | Invitaciones pendientes (N) |
| Remove member / Revoke invite | Quitar del equipo / Anular invitación |
| Connect Channel / Sync | Conectar canal / Sincronizar |
| Active / Inactive | Activo / Inactivo |

Y la pantalla `channels/callback` entera, que hoy está en inglés.

**Criterios:**
- NO DEBE quedar texto visible en inglés en ninguna pantalla de Configuración ni de Canales. Test que grepea las cadenas de la lista.
- Los nombres técnicos (nombres de modelo, claves de permiso, códigos de error) **no se traducen**.

### S5: Estados vacíos

**Descripción:** cada pestaña tiene que verse bien con la base recién creada, que es una regla del proyecto (`CLAUDE.md`: "el sistema debe funcionar con base de datos vacía").

Texto por defecto: título **"Todavía no hay nada acá"**, bajada con el nombre de lo que falta, y el botón de alta de esa pestaña. Donde no hay alta (Tareas), la bajada es **"Cuando el sistema empiece a registrar tareas, las vas a ver acá"**.

**Criterios:**
- CADA una de las seis pestañas DEBE renderizar un estado vacío con su texto y, si corresponde, su botón de alta.
- Test de render por pestaña que verifica el texto en el DOM.

### S6: Permisos por pestaña

**Descripción:** no cambia qué puede ver quién. Se documenta y se hace un test de caracterización para que no se corra sin querer.

| Pestaña | Guard hoy | Guard después |
|---|---|---|
| General | `requireWorkspaceAdmin()` | igual |
| Equipo | `requireWorkspaceAdmin()` | igual |
| Roles | `listRoles()` con `roles.manage` | igual |
| Campos personalizados | `requireWorkspaceAdmin()` | igual |
| Respuestas rápidas | `getWorkspace()` + RLS | igual |
| Integraciones | `requireWorkspaceAdmin()` | igual |
| Tareas | `requireWorkspaceAdmin()` | igual |

**Criterios:**
- Lo que una persona veía antes DEBE ser exactamente lo que ve después. Test de caracterización por rol.
- `lib/auth/member-baseline.test.ts` NO DEBE necesitar cambios por este bloque (no se agregan páginas con `requireWorkspaceAdmin`).

### S7: Link a Corridas

**Descripción:** en la sección **IA** de General, un link a la pantalla de Corridas, gateado por **`ai_costs.view`** (la clave ya existe, D7). Se construye en este bloque aunque la pantalla llegue en el bloque siguiente: hasta entonces apunta a `/dashboard/agents`.

**Criterios:**
- CUANDO la persona tiene `ai_costs.view`, el link DEBE aparecer.
- CUANDO no la tiene, NO DEBE aparecer.
- El destino final DEBE actualizarse a `/dashboard/agents/runs` en el bloque A+R.

---

## 7. Bloque G: Integraciones

**Migraciones:** ninguna. Todo lo que hace falta guardar entra en el `config jsonb` de `integration_configs`, que para eso es genérico. **Rama:** `feat/integraciones-dos-secciones`.

### Lo que existe hoy

`lib/integrations/providers.ts` es un **array plano de 14 proveedores** con `SECTION_ORDER = ["messaging","publishing","google","meta","email","ai"]` y `providersBySection()` agrupando en tiempo de render. Cada entrada declara `id`, `label`, `type`, `section`, `connection` (`api_key` | `oauth_app` | `system_token` | `qr` | `via_zernio`), `capability` (solo IA: `text` | `embeddings` | `transcription`), `visible`, y sus `secretFields` / `configFields` / `usage`.

Los 14 ids: `zernio`, `evolution` (messaging) · `postproxy`, `linkedin`, `threads` (publishing) · `google` (google) · `meta` (meta) · `resend_inbound`, `resend` (email) · `openai`, `anthropic`, `google_ai`, `voyage`, `groq` (ai).

La pantalla (`integrations-grid.tsx`) renderiza un `<h2>` por sección y una grilla de cards. **Un solo filtro**: el toggle `Requiere atención` en el `right` del `PageHeader`. La card (`integration-card.tsx`) muestra label, descripción, `StatusBadge`, cuenta, **solo la primera** razón, barra de uso y un botón. **Sin chips, sin ícono, sin logo.** El detalle es un **modal genérico** (`integration-modal.tsx`) armado desde el catálogo, con tres `extraFooter` especiales (Zernio, Meta, Google).

`lib/integrations/status.ts` calcula el estado con `integrationStatus({ config, connection?, requiredScopes?, usage?, now? })` → `not_connected` | `connected` | `attention` | `error`, con `EXPIRY_WARNING_DAYS = 7` y `ERROR_FRESHNESS_DAYS = 7`.

**Y acá está el hallazgo que vale más que todo el resto del bloque:** la pantalla llama a `integrationStatus({ config, usage })` **sin pasar `connection` ni `requiredScopes`**. Los caminos de vencimiento de token y de scopes faltantes **existen, están testeados y nunca se ejecutan**. `oauth_connections` —que guarda `token_expires_at`, `refresh_expires_at`, `granted_scopes`, `status`, `last_error`, `last_refreshed_at`— **no se lee desde ninguna página ni componente**: solo desde el cron de refresco.

### G1: Dos secciones y chips de tipo

**Descripción:** `SECTION_ORDER` pasa de seis valores a dos.

| Sección | Qué lleva | Proveedores |
|---|---|---|
| **Conexiones** | Todo lo que el sistema conecta hacia afuera | `zernio`, `evolution`, `postproxy`, `linkedin`, `threads`, `google`, `meta`, `resend_inbound`, `resend` |
| **Inteligencia artificial** | Tus propias claves (BYOK) | `openai`, `anthropic`, `google_ai`, `voyage`, `groq` |

El agrupamiento fino que se pierde lo recuperan **chips de tipo**, que filtran la sección de Conexiones sin partirla. Los chips se derivan del campo `type` que el catálogo **ya tiene**, más un campo nuevo `types?: string[]` para las cards que sirven para más de una cosa:

| Card | Chips |
|---|---|
| `zernio` | Mensajería, Publicación |
| `evolution` | Mensajería |
| `postproxy`, `linkedin`, `threads` | Publicación |
| `google` | Publicación *(YouTube)* |
| `meta` | Publicación, Anuncios |
| `resend_inbound`, `resend` | Email |
| las cinco de IA | sin chips (viven en la otra sección) |

**Criterios:**
- CUANDO se abre la pantalla sin filtros, DEBEN verse las dos secciones con las **14** cards.
- CUANDO se elige un chip, solo DEBE filtrarse la sección Conexiones; la sección de IA NO DEBE verse afectada.
- CUANDO se elige un chip y además `Requiere atención`, DEBEN aplicarse los dos a la vez.
- CUANDO un chip no tiene ninguna card, DEBE verse deshabilitado, no desaparecer: que un tipo exista y esté vacío es información.
- El chip activo DEBE viajar en la URL como `?tipo=<chip>` y sobrevivir la ida y vuelta al detalle.
- Test de caracterización: **el conjunto de proveedores DEBE ser el mismo antes y después**. Este bloque reagrupa; no agrega ni quita integraciones.

### G2: La card

**Descripción:** la card gana los chips de G1 y **todas** las razones, no solo la primera.

- Las razones pasan de `reasons[0]` a la lista completa, con un `+N más` si son más de dos.
- Se agrega la fecha de `connected_at` cuando está conectada ("Conectada desde el 12 de agosto").
- El botón pasa de abrir un modal a **navegar al detalle** (G5).

**Criterios:**
- CUANDO una integración tiene más de una razón de atención, DEBEN verse al menos dos.
- La barra de uso DEBE conservarse tal cual, con su `role="progressbar"` y su umbral de 0,9.

### G3: La salud de la credencial, enchufada

**Descripción:** se le pasa a `integrationStatus()` lo que hoy no recibe. **No se escribe lógica nueva**: se lee `oauth_connections` en el server component de la pantalla y se le pasa `connection` y `requiredScopes` por proveedor.

- `requiredScopes` sale de los adaptadores que ya existen: `GOOGLE_REQUIRED_SCOPES`, `LINKEDIN_REQUIRED_SCOPES`, `THREADS_REQUIRED_SCOPES`.
- Con eso se encienden solos: "El acceso vence en N días", "El acceso venció", "Se revocó el acceso. Hay que volver a conectar", "Faltan permisos: …".
- La card muestra, cuando hay conexión OAuth: el vencimiento, la última renovación y los scopes otorgados.

**Criterios:**
- CUANDO una conexión OAuth vence en 7 días o menos, la card DEBE decirlo y la integración DEBE quedar en `Requiere atención`.
- CUANDO a una conexión le falta un scope requerido, la card DEBE nombrar cuáles faltan.
- CUANDO `oauth_connections.status` es `revoked`, la integración DEBE quedar en `Con error`.
- `integrationStatus()` NO DEBE cambiar de firma ni de lógica. Sus tests DEBEN seguir pasando sin tocarlos.
- El umbral de vencimiento DEBE ser **uno solo** en todo el sistema: `EXPIRY_WARNING_DAYS` de `status.ts`. Ninguna pantalla calcula días por su cuenta.

### G4: La card de Google dice qué servicios usa

**Descripción:** hoy la card se llama `Google (YouTube)` y no cuenta que el mismo cliente OAuth sirve para dos cosas distintas, una de las cuales se configura en otra pantalla.

La card pasa a listar sus servicios con estado propio:

| Servicio | Estado | Dónde se configura |
|---|---|---|
| **YouTube** | de la conexión `google` | acá |
| **Google Calendar** | de las conexiones `google_calendar` (son **por persona**) | link a `/dashboard/agenda/configuracion/calendarios` |

Para Calendar, la card dice cuántas personas lo tienen conectado, no un estado binario: es una conexión por persona y un sí/no mentiría.

**Criterios:**
- CUANDO YouTube está conectado y Calendar no, la card DEBE mostrar los dos estados por separado.
- CUANDO alguien hace clic en Calendar, DEBE ir a la configuración de Agenda, no quedarse en Integraciones.
- La card NO DEBE ofrecer conectar Calendar desde acá: es por persona y su flujo vive en Agenda.
- **Drive no se menciona**: no existe ningún scope de Drive en el sistema.

### G5: El detalle en pantalla

**Descripción:** el modal pasa a ser una ruta: `/dashboard/settings/integrations/[providerId]`, con `providerId` = el `id` del catálogo.

Tres pestañas dentro del detalle:

| Pestaña | Qué lleva |
|---|---|
| **Credenciales** | Lo que hoy tiene el modal: un campo por `secretField` (los guardados como `Guardado ✓` + `Reemplazar`), un campo por `configField`, la URL del webhook, el bloque de OAuth, `Probar y guardar`, `Desconectar`, el link a la documentación |
| **Cuentas** | Lo que hoy son los `extraFooter`: cuentas de Zernio, cuentas publicitarias de Meta, la prueba de subida de YouTube. Para `zernio` y `evolution`, el link a `/dashboard/channels` |
| **Actividad** | Las entradas de `audit_log` de esa integración: conexiones, renovaciones y errores |

- `PAGE_META` gana la entrada `/dashboard/settings/integrations/[providerId]` (si no, el test de `page-actions` falla).
- Migas de pan: `Ajustes › Integraciones › <nombre>`.
- La pestaña activa va en la URL (`?tab=`), para poder compartir el link.

**Criterios:**
- CUANDO se entra a un `providerId` que no existe en el catálogo, DEBE devolver 404.
- CUANDO se vuelve al listado, el chip y el filtro `Requiere atención` que estaban puestos DEBEN seguir puestos.
- `IntegrationModal` DEBE dejar de usarse; no quedan dos caminos al mismo contenido.
- La frontera de Vault DEBE seguir en verde: `lib/vault-boundary.test.ts` sin cambios.

### G6: WhatsApp y sus instancias

**Descripción:** el modelo real es **un número de WhatsApp por workspace** (lo dice la descripción del proveedor) y la gestión del QR y del estado vive en `/dashboard/channels`. No se construye una gestión de instancias que el sistema no tiene.

La pestaña Cuentas de `evolution` muestra el canal conectado con su `connection_status` en vivo y su `last_error`, y el botón que lleva a `/dashboard/channels` para el QR.

**Criterios:**
- NO DEBE construirse alta ni baja de instancias de Evolution en este bloque.
- El estado del canal que se muestra DEBE ser el mismo que muestra `/dashboard/channels`, leído de la misma columna.
- DEBE quedar anotado en `docs/PENDIENTE.md` que la multi-instancia no está contemplada.

### G7: Por dónde sale cada red

**Descripción:** reemplaza al "selector de fuente de métricas" de la v1.1, que no tenía sentido (D5, §2.5).

En la pestaña Cuentas de los proveedores de publicación, se expone el **publicador por defecto de cada cuenta social** (`social_accounts.default_publisher`), que hoy solo se puede cambiar post por post.

- Por cada cuenta conectada: la red, el publicador por defecto, y los publicadores disponibles con su estado (`available` / `unverified` / `unavailable`) y su motivo.
- Debajo, en una línea, **de dónde salen las métricas de esa red**, que es informativo y no configurable: Instagram y TikTok por Zernio, Threads por su API, YouTube por Google, **LinkedIn por nadie** ("LinkedIn no permite leer métricas de publicaciones desde afuera").

**Criterios:**
- CUANDO se cambia el publicador por defecto de una cuenta, DEBE guardarse en `social_accounts.default_publisher` y DEBE respetarse en la próxima publicación.
- CUANDO un publicador está `unavailable`, NO DEBE poder elegirse y DEBE mostrarse su motivo.
- La línea de métricas DEBE decir la verdad por red, incluido el caso de LinkedIn.
- NO DEBE construirse ningún selector de "fuente de métricas": no hay nada que elegir.

### G8: Estado vacío y primera conexión

**Descripción:** un workspace nuevo abre esta pantalla con catorce cards grises y nada que le diga por dónde empezar.

Aparece una franja arriba mientras falte **al menos uno** de los tres mínimos, mostrando **solo los que faltan**:

| Falta | Qué sugiere |
|---|---|
| un canal de mensajería | Zernio (Instagram) o Evolution (WhatsApp) |
| un proveedor de IA de texto | Anthropic |
| email saliente | Resend |

**Criterios:**
- CUANDO falta al menos uno de los tres, la franja DEBE aparecer y DEBE listar solo los que faltan.
- CUANDO están los tres, la franja NO DEBE aparecer.
- La franja DEBE poder descartarse, y DEBE volver a los 7 días si sigue faltando algo. El descarte va a `localStorage` (`ssa.integ.onboarding.dismissed`), **no a la base**.

### G9: Channels sale del menú

**Descripción:** complementa a N1. La ruta y la pantalla se conservan enteras (D3).

**Criterios:**
- `/dashboard/channels` DEBE seguir funcionando con toda su funcionalidad actual: alta de canal, QR de WhatsApp, sincronización, activar/desactivar, borrar, link de DM.
- DEBE llegarse desde el detalle de `zernio` y de `evolution`, pestaña Cuentas.
- El menú lateral NO DEBE tener el ítem (lo hace N1).
- NINGÚN link interno a `/dashboard/channels` DEBE romperse. Test que los recorre.

### G10: Lo que no se toca

**Descripción:** límites explícitos de este bloque, para que no se expanda.

- **No se agrega ningún proveedor.** Whop no existe y no entra acá: entra con el módulo de Ventas.
- **No se cambia cómo se conecta nada.** `testConnection`, `saveIntegration`, `disconnectIntegration` y el flujo de OAuth quedan como están.
- **No se toca Vault** ni `lib/secret-names.ts`.
- **No se agregan scopes.** Drive no se conecta.
- El código muerto de `MigrateToVault` (`zernioLegacySecrets` siempre `false` desde la 00090) **se borra**, que es lo único de limpieza que sí entra.

---

## 8. Bloque A: Mini dashboard de IA

**Migraciones:** `00112`. **Rama:** `feat/observabilidad-ia` (junto con el bloque R).

### Lo que existe hoy

Todo el lado de los datos (§2.1). Lo que **no** existe es una sola pantalla de conjunto: `app/(dashboard)/dashboard/agents/page.tsx` muestra un `PageHeader` y una lista de tarjetas con nombre, chip Encendido/Apagado y una línea de subtítulo. **Cero métricas, cero costo, cero gráfico.**

Lo que sí hay para reusar y **no hay que escribir de nuevo**:

| Qué | Dónde |
|---|---|
| El informe de costos de un período, en una llamada | `ai_cost_report(workspace, from, to)` → jsonb con `totals`, `drafts`, `by_source`, `by_agent`, `by_model`, `top_conversations` |
| El patrón de 5 tarjetas con tooltip y comparación contra el período anterior | `components/dashboards/chat/kpi-cards.tsx` + `lib/dashboards/chat/comparisons` + `previousPeriod()` |
| **Barras apiladas con ejes, grilla y tooltip por columna** | `components/dashboards/chat/trend-chart.tsx` → `TrendChart` con `mode="stack"` |
| El selector de 11 presets con calendario | `components/dashboards/chat/filters/period-popover.tsx` → `PeriodPopover` |
| Escalas y ticks | `lib/dashboards/chat/scale` → `axisTicks`, `axisTop`, `labelEvery`, `niceStep` |
| Formato de dinero | `formatUsd` (`components/agents/filters.tsx`) |

**Lo único que falta de verdad en gráficos es la dispersión.** No hay scatter en todo el repo.

### A1: La agregación por día (migración `00112`)

**Descripción:** no existe **ninguna** función que agrupe `cost_usd` por fecha. `ai_cost_report` da totales y desgloses por dimensión, pero ni una serie temporal. Hace falta una función nueva.

```sql
public.ai_spend_by_day(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_tz           text
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
```

Devuelve `[{ day: 'YYYY-MM-DD', source: text, runs: int, cost_usd: numeric, input_tokens: bigint, output_tokens: bigint }]`, agrupado por `date_trunc('day', created_at AT TIME ZONE p_tz)` y `source`, excluyendo `status = 'running'`.

**Rellena los días sin corridas con cero.** Es exactamente el problema que la `00110` ya tuvo que resolver para las tendencias del dashboard de Chat: un día sin datos que falta en vez de valer cero hace que el gráfico mienta la forma. Se usa `generate_series` sobre el rango.

Va en SQL y no en la app por los dos motivos de siempre: PostgREST topea en 1.000 filas, y **`cost_usd` no es legible por `authenticated`** (§2.7).

En la misma migración, una segunda función para la dispersión, que necesita filas y no agregados:

```sql
public.ai_runs_scatter(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_limit        int DEFAULT 500
) RETURNS jsonb
```

Devuelve `[{ id, created_at, source, status, cost_usd, latency_ms, input_tokens, conversation_id }]`, ordenado por `created_at`, con muestreo del lado del servidor cuando hay más de `p_limit`: **se conservan todas las corridas con `status` de error o escalada** y se muestrean las que salieron bien. Una dispersión que esconde los errores no sirve para nada.

**Criterios:**
- Las dos funciones DEBEN ser `SECURITY DEFINER`, `STABLE`, `SET search_path = ''` y con `GRANT EXECUTE` **solo a `service_role`**, igual que `sum_ai_spend` y `ai_cost_report`.
- CUANDO el rango tiene días sin corridas, `ai_spend_by_day` DEBE devolver esos días con `runs = 0` y `cost_usd = 0`.
- CUANDO una corrida tiene `cost_usd NULL` (modelo sin precio), DEBE sumar 0 al costo y contarse igual en `runs`.
- Las corridas en `running` NO DEBEN entrar en ninguna de las dos.
- La migración DEBE ser idempotente (`CREATE OR REPLACE FUNCTION`).
- La migración **NO DEBE alterar `agent_runs`, `agent_run_steps` ni `model_pricing`**. Solo agrega funciones.

### A2: El filtro de período

**Descripción:** el mini dashboard usa `PeriodPopover` con sus 11 presets (D6), en el prop `filters` del `PageHeader` de Agentes. El preset por defecto es `30d`.

El rango viaja en la URL como `?period=`, `?from=`, `?to=`, que son los nombres que `PeriodPopover` ya usa.

**Criterios:**
- CUANDO se cambia el período, las cinco tarjetas y el gráfico DEBEN actualizarse juntos.
- CUANDO se abre un link con período en la URL, DEBE aplicarse.
- El rango DEBE resolverse con `resolvePeriod(preset, now, timeZone)` y la zona DEBE ser la del workspace (`workspaces.timezone`), no la del navegador.
- `DateFilter` y los cuatro presets de `lib/dates.ts` NO DEBEN modificarse: siguen sirviendo a las pestañas del agente.

### A3: Las cinco tarjetas

**Descripción:** arriba de la lista de agentes, el patrón de `KpiCards` (grid `grid-cols-2 md:grid-cols-5`), cada una con `InfoTooltip` y comparación contra el período anterior vía `previousPeriod()`.

| # | Tarjeta | De dónde sale | Comparación |
|---|---|---|---|
| 1 | **Gasto de hoy** | `ai_cost_report` del día | vs. ayer |
| 2 | **Gasto del período** | `totals.cost_usd` | vs. período anterior |
| 3 | **Tokens del período** | `totals.input_tokens + output_tokens + cached_tokens + embedding_tokens` | vs. período anterior |
| 4 | **Corridas del período** | `totals.runs` | vs. período anterior |
| 5 | **Estado del sistema** | A5 | sin comparación |

**Criterios:**
- La tarjeta 1 DEBE comparar contra **ayer**, no contra el período anterior: es la única diaria y compararla contra un mes no dice nada.
- CUANDO el período anterior es cero, DEBE escribirse "sin comparación", no un porcentaje infinito.
- CUANDO la variación está entre −1 % y +1 %, DEBE escribirse "sin cambios" y no DEBE dibujarse flecha.
- CUANDO `totals.missing_pricing > 0`, DEBE verse un aviso: "N corridas sin precio cargado — el gasto real es mayor". Con link a la pestaña Costos de un agente, donde se cargan los precios.
- Las tarjetas 1 a 4 DEBEN ser clicables y llevar a Corridas con el filtro equivalente. La 3 (tokens) **no es clicable**: no existe un filtro por tokens.
- Todo el bloque DEBE calcularse **server-side con service role** detrás de `requireWorkspaceAdmin()`. §2.7.

### A4: El gráfico, con dos pestañas

**Descripción:** un solo gráfico con un segmented control de dos opciones, para que no queden dos gráficos apilados.

**Pestaña `Barras` (por defecto):** `TrendChart` con `mode="stack"`. Una barra por día, segmentada **por origen**, siempre en USD.

"Origen" es el `source` de la corrida, con las etiquetas completas. Hoy `RUN_SOURCE_LABELS` (`lib/agent/run-labels.ts`) tiene **5 de los 11 valores** y los demás caen al valor crudo (`"ads_analysis"` en pantalla). **Completarlo es parte de este bloque:**

| `source` | Etiqueta |
|---|---|
| `agent` | Agente |
| `flow_ai_node` | Automatización |
| `sequence_ai_step` | Secuencia |
| `kb_indexing` | Base de conocimiento |
| `conversation_summary` | Resumen de cierre |
| `message_classification` | Clasificador |
| `message_classification_eval` | Clasificador (evaluación) |
| `content_copy` | Copywriter |
| `ads_analysis` | Análisis de anuncios |
| `audio_transcription` | Transcripción |
| `media_description` | Descripción de imagen |

Hace falta además una **paleta por origen**: hoy solo existe `PLATFORM_COLORS`, que es de redes sociales. Se declara una paleta nueva de 11 colores sobre los tokens que ya existen, en los dos temas.

**Pestaña `Puntos`:** la dispersión. Eje horizontal el tiempo, eje vertical el costo en USD (escala logarítmica, porque una corrida de embeddings y una del agente difieren en tres órdenes de magnitud), un punto por corrida, **verde si terminó bien y rojo si no**, radio por tokens. Datos de `ai_runs_scatter`.

**Criterios:**
- CUANDO se cambia de pestaña, el período NO DEBE perderse.
- CUANDO una barra se clickea, DEBE llevar a Corridas filtrado por ese día; CUANDO se clickea un segmento, por ese día **y** ese origen.
- CUANDO un punto se clickea, DEBE abrir el detalle de esa corrida.
- La leyenda es **obligatoria** en las dos pestañas, y cada estado DEBE llevar además de color una etiqueta o un ícono: nunca el color solo.
- El tooltip DEBE decir el estado en palabras.
- CUANDO un día no tiene corridas, DEBE dibujarse como cero, no saltearse.
- `TrendChart` NO DEBE modificarse: se usa como está. Si hiciera falta un cambio, se para y se avisa.
- La dispersión DEBE escribirse en SVG a mano siguiendo la convención del repo (`viewBox` fijo, `<title>` como tooltip nativo, escalas con `niceStep`/`axisTicks`). **No se agrega ninguna librería de gráficos.**

### A5: Estado del sistema

**Descripción:** la quinta tarjeta, con tres estados y tres señales.

| Estado | Cuándo |
|---|---|
| 🟢 **Todo bien** | ninguna de las de abajo |
| 🟡 **Revisar** | hay corridas con `status = 'error'` en las últimas 24 h, **o** alguna integración está en `Requiere atención`, **o** `missing_pricing > 0` |
| 🔴 **Con problemas** | más del 10 % de las corridas de las últimas 24 h terminaron en error, **o** alguna integración está en `Con error` |

- La señal de integraciones **consume el estado ya resuelto** por `integrationStatus()` (G3). **No calcula días de vencimiento por su cuenta**: el único umbral del sistema es `EXPIRY_WARNING_DAYS`.
- Al hacer clic, se despliega un panel con las tres señales y su detalle, con link a Corridas filtrado por errores y a Integraciones.
- **No hay señal de "latido del worker".** No existe una fuente de latido en el sistema, y inventar una tabla para eso está fuera de alcance. Se declara explícito en el panel: la tarjeta mira errores, integraciones y precios.

**Criterios:**
- CUANDO no hay ninguna corrida en 24 h, el estado DEBE ser verde con la nota "sin actividad en 24 h", no rojo.
- CUANDO una integración está en `Requiere atención`, la tarjeta DEBE ponerse ámbar y nombrarla.
- La tarjeta NO DEBE inventar señales que el sistema no tiene.

### A6: Plegado, carga y vacío

**Descripción:** el mini dashboard ocupa espacio y la lista de agentes es lo que la mayoría viene a ver.

- Se puede plegar. El estado va a `localStorage` con la clave `ssa.ai.dashboard.collapsed`. **No va a la base** y, por lo tanto, es por navegador. Si no se puede leer `localStorage` (ventana privada), se renderiza desplegado.
- Carga: esqueleto con la misma altura que el contenido final, para que la lista no salte.
- Vacío: con cero corridas en el período, las tarjetas muestran `—` y el gráfico el mensaje **"Todavía no hay corridas en este período."** No se dibuja un gráfico vacío con ejes.
- **Solo lo ve quien tiene `ai_costs.view`** (D7). Para el resto, la pantalla de Agentes queda como está hoy.

**Criterios:**
- CUANDO la persona no tiene `ai_costs.view`, el mini dashboard NO DEBE renderizarse **ni consultarse**: nada de costo viaja al cliente.
- CUANDO está plegado, DEBE recordarse al volver.
- CUANDO el período no tiene datos, NO DEBE verse un gráfico con ejes vacíos.
- Las consultas de las cinco tarjetas y del gráfico DEBEN resolverse en **a lo sumo tres llamadas** (`ai_cost_report` del período, `ai_cost_report` del período anterior, `ai_spend_by_day`), más una cuarta solo si se abre la pestaña de puntos.

---

## 9. Bloque R: Pantalla de Corridas

**Migraciones:** ninguna propia (usa las de A1). **Rama:** la misma que A.

### Lo que existe hoy

**El 80 %, mal ubicado.** La pestaña Runs del detalle de un agente (`components/agents/runs-tab.tsx`, con `lib/agent/runs-query.ts` y `lib/agent/runs-filters.ts`) ya es un historial de corridas con:

- **Once filtros en la URL**: `fecha`/`desde`/`hasta`, `agente`, `canal`, `resultado` (los 10 status), `modelo`, `accion` (herramienta ejecutada, con join a `agent_run_steps!inner`), `regla`, `detalle`, `q` (nombre del contacto), `contacto`, `c`, y `costo_min`/`costo_max` cuando el rol lo permite. Más `countActiveRunFilters`.
- **Doble cliente por rol**: Admin con service role y columnas de costo; Member con su propio cliente, sin costo.
- Paginación de 25 (`RUNS_PAGE_SIZE`).
- Acordeón por corrida con routing en lenguaje llano, "por qué terminó así", pasos con `input` de las herramientas y títulos reales de los fragmentos de la base de conocimiento, tokens y costo, y links a conversación, contacto y detalle.

Y `app/(dashboard)/dashboard/agents/runs/[runId]/page.tsx` ya existe, pero **muestra menos que el acordeón de la lista**: no pide `input` de los pasos, no muestra `routing`, `trigger`, `prompt_version`, `thread_id`, `intent` ni `completed_at`, no resuelve el nombre del contacto ni del canal, muestra los fragmentos de la base solo como cantidad, no pasa el error por `describeModelError`, y como usa el cliente del usuario **nunca puede mostrar tokens ni costo, ni a un Owner**.

### R1: La ruta global

**Descripción:** nace `/dashboard/agents/runs`, la lista de corridas de **todo** el sistema. La pestaña Runs del agente pasa a ser esa misma vista con `?agente={id}` (D8), para no mantener dos.

Para eso hay que **generalizar `parseRunFilters` y `loadRuns`**, que hoy exigen un `currentAgentId` y arman las opciones de los selectores (modelos, herramientas, reglas) a partir de un agente concreto:

- `parseRunFilters` acepta `agentId: string | null`.
- Las opciones de **modelo** salen de `model_pricing` más los modelos distintos presentes en `agent_runs` del período, no de un agente.
- Las opciones de **origen** (`source`) salen de los 11 valores del CHECK, con las etiquetas de A4, **filtradas por los que tienen al menos una corrida en el período**: un filtro con opciones que nunca devuelven nada es ruido.
- El rango de fechas pasa a resolverse con `resolvePeriod` (D6): `loadRuns` acepta un `{ from, to }` **ya resuelto** en vez de un `DatePreset`. La pestaña del agente le sigue pasando lo que resuelve `DateFilter`, así que no se rompe.

**Criterios:**
- `/dashboard/agents/runs` DEBE registrarse en `PAGE_META` (si no, `lib/nav/page-actions.test.ts` falla) con título **Corridas**.
- CUANDO se entra desde el detalle de un agente, DEBE llegarse con `?agente={id}` y el filtro DEBE verse aplicado.
- `loadRuns` DEBE devolver lo mismo que hoy cuando se la llama con un `agentId`. Test de caracterización antes de generalizarla.
- La paginación DEBE seguir siendo de 25 y DEBE seguir en la URL.

### R2: Filtros y presets

**Descripción:** los once filtros que ya existen, más el de **origen**, en un popover construido sobre el `FilterMenu` compartido (I1).

Arriba, atajos de un clic que son los que se usan de verdad al auditar:

| Atajo | Qué filtra |
|---|---|
| **Solo errores** | `resultado` en `error` |
| **Escaladas** | `resultado` en `escalated` |
| **Sin precio** | corridas con `cost_usd IS NULL` y tokens > 0 |
| **Más lentas de 30 s** | `latency_ms > 30000` |
| **Más caras** | orden por `cost_usd` descendente |

**Criterios:**
- CUANDO se aplica un atajo, DEBE reflejarse en la URL y en el contador de filtros activos.
- CUANDO hay filtros puestos, DEBE verse `N filtros activos` y un `Limpiar filtros`.
- El filtro por costo (`costo_min`/`costo_max`) DEBE seguir apareciendo **solo** para quien tiene `ai_costs.view`.
- Los filtros DEBEN resolverse en la base, no en el cliente. La paginación con filtros aplicados tiene que ser correcta.

### R3: La tabla

**Descripción:** una fila por corrida. Columnas, en orden:

| Columna | De dónde |
|---|---|
| Cuándo | `created_at`, hora local del workspace |
| Origen | `source` con la etiqueta de A4; si es `agent`, el nombre del agente |
| Disparador | `trigger` (6 valores) |
| Contacto | `contacts.display_name`, con link a la ficha |
| Canal | `channel_id` resuelto |
| Modelo | `provider/model` |
| Estado | `status` (10 valores) con su chip |
| Motivo | `describeRunDetail(status_detail)` + `describeModelError(error)` |
| Pasos | `step_count` |
| Duración | `latency_ms` en segundos |
| Tokens | entrada / salida — **solo con `ai_costs.view`** |
| Costo | `cost_usd` — **solo con `ai_costs.view`**; `sin precio` cuando es NULL |

Export a CSV del período filtrado, respetando el rol: sin `ai_costs.view` no van las columnas de tokens ni costo, en ningún caso.

**Criterios:**
- CUANDO la persona no tiene `ai_costs.view`, las columnas de tokens y costo NO DEBEN pedirse al servidor. No se ocultan en el cliente: no se consultan. §2.7.
- CUANDO una corrida tiene `cost_usd NULL` y tokens > 0, DEBE decir `sin precio`, no `$0,00`. Son cosas distintas y confundirlas hace que el total mienta.
- El CSV DEBE llevar: `id, fecha, origen, disparador, contacto, canal, modelo, estado, motivo, pasos, duracion_ms` y, con permiso, `tokens_in, tokens_out, costo_usd`.
- A 390 px la tabla DEBE scrollear horizontalmente **dentro de su contenedor**, sin scroll horizontal de página.

### R4: El detalle, unificado

**Descripción:** el acordeón de la lista y la pantalla `runs/[runId]` pasan a usar **el mismo componente** (D9), que es el más completo de los dos.

Lo que el detalle muestra, de arriba a abajo:

1. **Cabecera**: estado, origen, agente, fecha, `provider/model`, `prompt v{n}`, duración, disparador, y — con `ai_costs.view` — tokens desglosados (entrada, salida, caché, embeddings) y costo congelado con el precio que se usó.
2. **Por qué terminó así**: `describeRunDetail(status_detail)` y el error pasado por `describeModelError` (los dos en `lib/agent/run-labels.ts`). Hoy la pantalla de detalle muestra el error crudo; la lista lo traduce. Gana la traducción.
3. **Enrutamiento**: `routingSentence(run.routing)` (`lib/agent/routing-sentence.ts`), que ya existe y hoy la pantalla de detalle no usa.
4. **Paso a paso**: por cada `agent_run_step`, su `kind` (`model_call`, `kb_search`, `tool_call`, `guardrail`), el `name`, la duración, el `input` **y** el `output`, los **títulos** de los fragmentos de la base de conocimiento usados (no solo la cantidad), el error del paso, y el link al `audit_log` cuando hay `audit_log_id`.
5. **Links**: a la conversación, a la ficha del contacto, y anterior/siguiente dentro del filtro actual.

La pantalla `runs/[runId]` **bifurca por rol** como ya hace `[agentId]/page.tsx`: service role detrás de `requireWorkspaceAdmin()` para quien tiene `ai_costs.view`, cliente del usuario para el resto.

**Criterios:**
- El componente de detalle DEBE ser uno solo, usado por la lista y por la pantalla.
- CUANDO se abre el detalle con `ai_costs.view`, DEBEN verse tokens y costo. Sin el permiso, NO DEBEN verse ni viajar.
- La query de pasos DEBE pedir `input` y `audit_log_id`, que hoy no pide.
- CUANDO el contenido de un paso fue purgado por retención, DEBE decirlo con su fecha, no mostrar un hueco sin explicación.
- CUANDO alguien entra a un `runId` de otro workspace, DEBE devolver 404. La RLS ya lo hace; el test lo verifica.
- Anterior/siguiente DEBEN respetar los filtros con los que se llegó.

### R5: Los tres huecos de cobertura, anotados

**Descripción:** la instrumentación está mejor de lo esperado —once fuentes registran corrida y no encontré consumo de IA sin registrar— pero hay tres grietas reales. **Este bloque no las arregla**: las anota, para que nadie lea el dashboard como si fuera completo.

1. **Una transcripción que falla no deja corrida.** `recordUsage` se llama solo dentro de `if (attempt.ok)` (`lib/ai/transcribe.ts`), y además abre y cierra el run **después** de llamar al proveedor, al revés de lo que manda `run.ts`. Un audio que falló, o un proceso que murió en el medio, no deja fila — y algunos proveedores cobran igual.
2. **El modo Económico todavía no mide.** `bg-collect` dice en su propio comentario que el pipeline de lote está pendiente y que debería cerrar el run. Cuando se encienda, va a haber consumo sin registrar.
3. **`message_classification_eval` está en el CHECK y nadie lo escribe.** Si el gráfico se arma desde los valores del CHECK en vez de desde los datos, va a aparecer un segmento siempre vacío.

**Criterios:**
- Los tres DEBEN quedar escritos en `docs/PENDIENTE.md` con su archivo y su línea.
- El gráfico de A4 DEBE armar sus segmentos **desde los datos**, no desde la lista de valores del CHECK.
- NO DEBE tocarse `lib/ai/transcribe.ts` en este bloque: arreglarlo bien es cambiar el orden de apertura del run y eso merece su propia corrida.

### R6: Dos cosas a dejar consistentes

**Descripción:** aparecieron leyendo el código y van acá porque la pantalla nueva las va a exponer.

1. **Dos módulos responden distinto "llegué al tope".** `lib/ai/spend.ts` evalúa el tope diario del workspace con acción `notify` y el mensual con `disable`; `lib/ai/workspace-budget.ts` evalúa **los dos con `disable`**. Si el mini dashboard va a mostrar gasto contra tope, la pantalla va a contradecir al motor. **Se unifica en `disable` para los dos**, que es lo que ya hace el camino que efectivamente corta.
2. **`AGENT_RUN_PUBLIC_COLUMNS` omite columnas que sí tienen permiso de lectura**: `inbound_at`, `responded_at` e `intent` tienen GRANT y nunca se piden. Se agregan, porque el detalle de R4 los muestra.

**Criterios:**
- Después del cambio, los dos módulos DEBEN dar la misma respuesta para el mismo workspace y el mismo gasto. Test que los compara.
- `AGENT_RUN_PUBLIC_COLUMNS` NO DEBE incluir ninguna columna sin GRANT. Test que lo verifica contra la lista de la `00060`.

---

## 10. Migraciones

**Una sola en toda la tanda**, y solo agrega funciones.

| Bloque | Migración | Qué hace |
|---|---|---|
| N | — | ninguna |
| I | — | ninguna |
| S | — | ninguna (las columnas de `workspaces` que expone ya existen) |
| G | — | ninguna (lo que hace falta guardar va al `config jsonb` de `integration_configs`) |
| **A+R** | **`00112_ai_spend_by_day.sql`** | `ai_spend_by_day()` y `ai_runs_scatter()`, las dos `SECURITY DEFINER`, `STABLE`, `search_path = ''`, `GRANT EXECUTE` solo a `service_role` |

**Reglas:**

- La última migración aplicada es la `00111`. La banda `00104`-`00109` quedó libre: **no se usa**, se sigue desde `00112` para que el orden de aplicación coincida con el cronológico.
- Idempotente, con `CREATE OR REPLACE FUNCTION`.
- Después de escribirla: `node scripts/build-all-migrations.mjs`. Antes de aplicarla: `list_migrations`.
- **Ninguna migración de esta tanda altera una tabla.** Si en algún momento parece que hace falta, pará y avisá: significa que el alcance cambió.
- **Nada toca `messages`, `conversations`, `contacts` ni `chat_media`.** Es la zona de la sesión de chat que corre en paralelo.

### Cambios en tablas existentes

Ninguno. Esta tanda no agrega, cambia ni borra una sola columna.

---

## 11. Guía de UI

- **Tailwind v4, sin archivo de configuración.** Todo vive en `app/globals.css`: `@theme` mapea los utilitarios a variables, y los valores están en `:root` (claro) y `.dark` (oscuro), en `oklch`. **Todo color nuevo se declara en los dos.** Los bloques `[data-theme="dark"|"light"]` son del booker público y no se tocan.
- **`dark:` de Tailwind ya sigue a la clase `.dark`**, gracias a `@custom-variant dark (&:where(.dark, .dark *))` declarado al final de `globals.css`. Se usa `dark:` normal. **Ojo: la nota del `CLAUDE.md` que dice que `dark:` compila a `prefers-color-scheme` está desactualizada** — se resolvió el 28/9/2026. (Conviene corregirla de paso.)
- **Dos breakpoints propios** que hay que conocer: `topbar:` (860 px, cuando los filtros de la barra superior bajan a una segunda franja) y `queue:` (980 px, la cola de borradores).
- **No hay design system de primitivos.** `components/ui/` tiene exactamente dos archivos: `switch.tsx` e `tooltip.tsx`. No existe Button, Input, Select, Dialog, Card, Badge, Table ni Tabs compartidos: todo está inline con clases repetidas. **Este documento no manda construir ese design system.** Lo único que se promueve a `components/ui/` es `FilterMenu` (I1), porque nace usado en dos lugares.
- Se reutilizan, sin duplicar: `PageHeader` (y sus props `left` / `right` / `filters`), `ConfirmDialog`, `PlatformIcon`, `Pagination`, el patrón de segmented control de `components/content/view-switcher.tsx`, `TrendChart`, `KpiCards`, `PeriodPopover`, `ConfigNav` (`components/scheduling/config-nav.tsx`, para la navegación interna de S2) y `Pagination` (`components/agents/filters.tsx`).
- **Nunca el color solo**: cada estado de corrida lleva además su ícono o su etiqueta. En la dispersión, donde solo hay color, la leyenda es obligatoria y el tooltip dice el estado en palabras.
- Textos en español rioplatense (vos/tenés). En el detalle de una corrida sí se muestran nombres técnicos —modelo, herramienta, código de error—: ahí el público es quien audita.
- **390 px sin scroll horizontal de página** en todo lo que se toque. Una tabla ancha scrollea dentro de su contenedor.

---

## 12. Seguridad

El riesgo nuevo de esta tanda es **uno solo**: las dos pantallas de observabilidad exponen el contenido de los pasos, que son conversaciones de clientes. Todo lo demás es reorganización.

- **El muro de los privilegios de columna es la defensa principal, y ya existe.** La `00060` revoca el SELECT de tabla sobre `agent_runs` y lo re-otorga por lista; `input_tokens`, `output_tokens`, `cached_tokens`, `embedding_tokens`, `cost_usd`, `pricing_id` y `audio_seconds` **no tienen GRANT para nadie autenticado**. Eso significa que mostrar costo exige service role detrás de un guard, y que un error de código no puede filtrarlo por accidente: la base lo rechaza. **No se agrega ningún GRANT nuevo en esta tanda.**
- **El filtro por permiso va en el servidor, no en el cliente.** Sin `ai_costs.view`, las columnas de costo y tokens **no se consultan**. Ocultarlas en el cliente las dejaría en la respuesta de red.
- **Las corridas sin `conversation_id` no las ve un Member.** Es la RLS de la `00060` y es correcta, pero produce un efecto que hay que explicar en pantalla: `kb_indexing`, `message_classification` y `media_description` no tienen conversación, así que un Member ve una lista que parece incompleta. **La pantalla de Corridas dice, cuando el visor no es admin, que está viendo solo las corridas de sus conversaciones.** Un subconjunto sin aviso es peor que un subconjunto.
- **Nunca se loguea contenido de mensajes, fragmentos de documentos ni claves.** Es la regla de `lib/ai/run.ts` y sigue valiendo.
- **El contenido purgado se dice, no se esconde.** `purge_agent_run_step_content` vacía `input`/`output` a los 12 meses; el detalle muestra que fue purgado y cuándo.
- Las pantallas reorganizadas **no cambian ningún permiso**: lo que una persona veía antes es lo que ve después, con test de caracterización por rol.

**Checklist por bloque:**

- [ ] Ninguna Server Action nueva sin su guard
- [ ] Ninguna consulta de costo o tokens fuera de service role + `ai_costs.view`
- [ ] `lib/vault-boundary.test.ts` en verde (bloque G sobre todo)
- [ ] `lib/auth/member-baseline.test.ts` en verde, con las aserciones actualizadas y **no borradas**
- [ ] Test de caracterización de permisos por rol en verde antes y después
- [ ] La migración `00112` no altera ninguna tabla
- [ ] `node scripts/verify-rls.mjs` y `node scripts/verify-roles.mjs` en verde al cerrar el bloque A+R

---

## 13. Fuera de alcance

Cada uno con su razón, para que no vuelva a discutirse dentro de una sesión.

- **Nueva conversación saliente en la Bandeja.** Depende de la ventana de mensajería de cada canal, que es una decisión de producto que este documento no cubre (I7).
- **El módulo de Ventas / Facturación.** No existe. El menú le reserva el lugar (D2).
- **Whop.** Entra con Ventas, no acá.
- **Multi-instancia de WhatsApp.** El modelo real es un número por workspace (G6).
- **Google Drive.** No hay un solo scope de Drive en el sistema y nada lo pide.
- **Arreglar la transcripción que falla sin dejar corrida.** Está identificado (R5) y merece su propia corrida: hay que cambiar el orden de apertura del run.
- **Instrumentar el modo Económico.** Su pipeline todavía no existe (R5).
- **Un design system de primitivos.** Haría falta, pero es un proyecto propio y no se cuela adentro de un rediseño de navegación (§11).
- **Alertas de gasto** (avisar cuando el gasto del día pasa de X). El mini dashboard muestra; no avisa. Es lo natural que sigue y se construye sobre lo que esta tanda deja, sin migrar nada.
- **Unificar los dos vocabularios de período.** Se adopta `PeriodPreset` en lo nuevo (D6) y se deja `DateFilter` donde está. Unificarlos de verdad es tocar las cuatro pestañas de Agentes.

---

## 14. Verificación en vivo (al cerrar cada bloque)

Lo que hay que mirar con la app abierta, además de los tests.

**Bloque N**
1. El menú muestra los grupos en orden, con Dashboards y Bandeja arriba sueltos, e Integraciones y Ajustes al fondo.
2. Colapsar el sidebar: los títulos desaparecen, quedan las líneas, el tooltip dice `Contactos · Ventas`.
3. Recargar: sigue colapsado.
4. Entrar a `/dashboard/settings/integrations`: Integraciones marcado, Ajustes no.
5. Entrar a `/dashboard/channels`: Integraciones marcado.
6. Con un usuario Member: ve seis ítems y ningún título de grupo vacío.

**Bloque I**
7. Las cuatro pestañas de comunicación están en la barra superior.
8. Abrir el popover de filtros, poner tres, cerrar con `Esc`: el foco vuelve al botón y el contador dice 3.
9. Copiar la URL con filtros, abrirla en otra pestaña: los filtros están puestos y el popover los refleja.
10. A 390 px: sin scroll horizontal de página, las pestañas scrollean solas.
11. El filtro no existe en Broadcasts, Sequences ni Growth.

**Bloque S**
12. General muestra cinco secciones con navegación interna y ninguna tarjeta-link duplicada.
13. Las seis pestañas están y `custom-fields` y `templates` las renderizan.
14. En Equipo, el segmented lleva a Roles y el botón `Nuevo rol` está en la barra superior.
15. Buscar "Save Changes" o "Workspace Name" en la pantalla: no aparecen.

**Bloque G**
16. Dos secciones, catorce cards, chips de tipo que filtran solo Conexiones.
17. La card de Google muestra YouTube y Calendar por separado, y Calendar lleva a Agenda.
18. Una integración OAuth con token cercano a vencer aparece en `Requiere atención` **diciendo cuántos días faltan**. Si ninguna está por vencer, verificarlo bajando `EXPIRY_WARNING_DAYS` a 400 en una corrida de prueba y volviéndolo a 7.
19. Entrar al detalle de Zernio, volver: el chip que estaba puesto sigue puesto.
20. `/dashboard/channels` sigue funcionando entera: conectar, QR, sincronizar.

**Bloque A+R**
21. El mini dashboard muestra las cinco tarjetas y el gráfico de barras apiladas por día.
22. Cambiar el período: las cinco tarjetas y el gráfico se mueven juntos.
23. Un día sin corridas aparece como cero, no se saltea.
24. Cambiar a la pestaña de puntos: los errores se ven en rojo y no están muestreados hacia afuera.
25. Clic en un segmento de una barra: abre Corridas filtrado por ese día y ese origen.
26. Plegar el mini dashboard y recargar: sigue plegado.
27. En Corridas, el atajo "Solo errores" filtra y el contador lo refleja.
28. Abrir una corrida: se ve el paso a paso con el `input` de las herramientas y los títulos de los fragmentos de la base.
29. Con un usuario **sin** `ai_costs.view`: no hay columnas de costo, y en la pestaña de red de las herramientas del navegador **no viaja** ningún `cost_usd`.
30. Con un usuario Member: la pantalla avisa que está viendo solo las corridas de sus conversaciones.
31. Exportar el CSV con y sin permiso: las columnas cambian.

---

## 15. Si algo bloquea

Pará y avisá —no improvises un rediseño— cuando:

- Un criterio de este documento es **imposible** con el código real. Pasó al escribir la v1.1 y por eso existe la v2.0.
- Hace falta **alterar una tabla**. Esta tanda no altera ninguna: si parece necesario, el alcance cambió.
- Hace falta tocar `messages`, `conversations`, `contacts` o `chat_media`. Es la zona de la sesión de chat que corre en paralelo.
- Un test estructural (§2.6) exige algo que contradice lo pedido acá. Esos tests son la red del sistema: se reescribe la aserción con la regla nueva, nunca se borra el test ni se lo salta.
- Hace falta cambiar `lib/ai/run.ts`, `integrationStatus()` o `TrendChart`. Los tres son piezas que ya funcionan y que esta tanda **consume**, no modifica.
- Un proveedor del catálogo real no está en los catorce de §2.4, o un permiso que necesitás no está en las 41 claves de `PERMISSION_KEYS`.

En todos los casos: anotalo en `docs/PENDIENTE-<bloque>.md`, seguí con lo siguiente si se puede, y contalo al cerrar.

---

## Anexo: qué cambió respecto de la v1.1

| v1.1 decía | La realidad | Dónde |
|---|---|---|
| Crear `ai_runs` y `ai_run_steps` en micro-dólares | Ya existen `agent_runs`, `agent_run_steps` y `model_pricing` en `numeric(12,6)` USD, con RPC de costos y cron de purga | §2.1 |
| Instrumentar todas las llamadas a IA | Once fuentes ya registran corrida; `lib/ai/run.ts` es la puerta única desde la Fase 3 | §2.1 |
| Rutas en español (`/dashboard/configuracion`, `/dashboard/agentes`) | Todas las rutas están en inglés | §2.2 |
| Configuración son nueve pestañas con `?tab=` | Son cuatro pestañas con sub-rutas, más dos rutas huérfanas | §2.2 |
| El grupo Ventas lleva Facturación | El módulo de Ventas no existe | §2.3 |
| Zernio son dos cards a unificar | Ya es una sola | §2.4 |
| Trece integraciones | Son catorce (faltaban `resend_inbound` y `groq`) | §2.4 |
| Whop está en el catálogo | No existe en el repo | §2.4 |
| Resolver de fuente de métricas entre Google y Postproxy | Postproxy no lee métricas de nada. Lo que falta interfaz es el **publicador** por cuenta | §2.5, G7 |
| La card de Google cubre Calendar, Drive y YouTube | YouTube sí; Calendar es otra conexión, por persona, configurada en Agenda; **Drive no existe** | §2.5, G4 |
| Crear la clave de permiso `ai_runs.view` | `ai_costs.view` ya existe y significa exactamente eso | D7 |
| Un paso previo con contratos congelados y stubs | Innecesario en ejecución secuencial | §0 |
| El botón de filtros con contador hay que construirlo | `countActiveFilters` ya existe y está testeado; el popover con teclado también (`FilterMenu`) | §5 |

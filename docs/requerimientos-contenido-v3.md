# Requerimientos v3: Publicación real, Contenido rediseñado y Atribución

**Proyecto:** SSA Business AI OS
**Paso del Método Builder:** 05-Requerimientos (brownfield, corrida autónoma one-shot)
**Versión:** 3.0 — 3 de octubre de 2026
**Anclado a:** `docs/requerimientos-etapa2.md` (v2.0, F1 a F72), `claude/reporte-estado-contenido-social.md` (3/10/2026), `cambios-prototipo-contenido.md` (3/10/2026) y el estado real de la base verificado el 3/10/2026.
**Referencia visual:** `docs/referencia/prototipo-ssa-baios.html` — el prototipo navegable, exportado del artefacto "SSA BAIOS Prototipo" (versión del 3/10/2026) y guardado en el repo. **Es la referencia de diseño y de comportamiento de todas las pantallas de esta tanda.** Secciones a mirar: **Contenido** (kanban, drawer de idea, drawer de pieza, calendario), **Social**, **Dashboards → Contenido orgánico** y **Ajustes**. Se abre en el navegador; también se puede leer como texto. Donde el prototipo y este documento se contradigan en una regla de negocio, gana este documento; donde se contradigan en cómo se ve o cómo se comporta una pantalla, **gana el prototipo**.
**Para:** Claude Code, corrida autónoma de 5 bloques.

> **Jerarquía de documentos.** Este documento **corrige** al plano de la Etapa 2 (v2.0). Donde se contradigan, **gana este**. `cambios-prototipo-contenido.md` es la descripción funcional del rediseño: este documento lo traduce a requerimientos y resuelve sus 4 decisiones abiertas (§3). El reporte de estado es la foto de partida, no una orden.

---

## 0. Cómo usar este documento

Cinco bloques, **B10 a B14**, en orden. 33 funcionalidades, **F73 a F105**, continuando la numeración del plano.

**El orden no es negociable y tiene una razón:** el B10 es chico y desbloquea la publicación real. Si la corrida muere en el B11, Wendy ya puede publicar. Si se construyera primero el modelo nuevo (B12), se estaría depurando una estructura nueva contra un circuito que nunca se vio funcionar, sin saber cuál de los dos falla.

**Reglas de la corrida** (se suman a las del `CLAUDE.md` y repiten las del plano v2.0):
- Rama `contenido-v3` creada desde `main`. Nada en `main` hasta el cierre.
- Toda API externa va **simulada** en los tests. No se llama a Zernio, Meta, Google, LinkedIn ni Threads reales. **No se publica nada, no se conectan cuentas, no se registran webhooks.**
- Migraciones: **solo aditivas se aplican**. Lo que borre o pise datos se escribe y **no se aplica**, y se anota en `docs/PENDIENTE.md`. Antes de aplicar cualquiera: `list_migrations`.
- **La próxima migración libre es la `00113`.** (El `CLAUDE.md` dice `00107`: está desactualizado, hay que corregirlo — ver F105.)
- Después de cada funcionalidad: `npx vitest run`. Después de cada bloque: marcar `docs/PROGRESS-CV3.md`, commit `feat: contenido v3 - bloque N (nombre)` y `git push origin contenido-v3`.
- La lógica de pantalla va en **funciones puras** testeables. Los componentes solo las componen.
- **Al cerrar cada bloque con pantallas, se abre el prototipo** (`docs/referencia/prototipo-ssa-baios.html`) y se compara con lo construido a 1440 y 390 px: sin scroll horizontal de página, con los estados vacío y de error visibles. Lo que no coincida se corrige o se anota.
- Nunca se muestra, loguea ni commitea el valor de un secreto.
- Si algo queda trabado después de un intento serio: anotarlo en `docs/PENDIENTE.md` con qué quedó, por qué y qué se decidió, y seguir. Nunca un loop.

---

## 1. Punto de partida verificado (3/10/2026)

Verificado contra la base de producción y el código de `main` (`c380037`). **Claude Code confirma cada punto en la exploración y reporta lo que no coincida.**

### 1.1 Lo que está vivo
- Canal de Instagram por Zernio (`channels`, `@wenmardigian`), con `late_account_id`. El inbox funciona.
- 167 comentarios entrando por webhook en tiempo real, el último de hoy.
- 636 contactos, 2.616 mensajes, 636 conversaciones.
- Los 5 crons de contenido y métricas registrados y respondiendo 200: `jobs` (cada minuto), `content-upload` (cada 2 min), `metrics-sync` (cada hora :30), `content-media-cleanup` (diario), `social-token-refresh` (lunes).
- Suite: 373 archivos, 4.486 tests, todos en verde. Migración más alta aplicada: `00112`.

### 1.2 Lo que está vacío y por qué
| Tabla | Filas | Causa |
|---|---|---|
| `social_accounts` | **0** | Nadie llama a `syncSocialAccounts` salvo el retorno de OAuth, y nunca se conectó nada por OAuth |
| `oauth_connections` | 0 | Google, LinkedIn y Threads sin configurar (trámites externos) |
| `social_posts` | 0 | El cron de métricas corre pero no tiene ninguna cuenta que leer |
| `social_post_metrics_daily`, `social_account_metrics_daily` | 0 | Idem |
| `contacts.attribution` | **0 de 636** | Nadie la escribe en los caminos de entrada reales |
| `content_posts` | 1 (vacío, de prueba) | — |
| `content_ideas` | 1 | — |
| `social_post_comments.social_post_id` | **0 de 167** | El vínculo solo se arma si existe la `social_account` |

**Consecuencia para el diseño:** no hay datos reales de contenido que migrar. El cambio de modelo del B12 se puede hacer limpio, sin backfill complejo.

### 1.3 Los seis bugs que este documento corrige
1. `syncSocialAccounts` solo corre en el retorno de OAuth (`app/api/oauth/[provider]/callback/route.ts:72`).
2. `computeAccounts` (`lib/social/accounts.ts:144`) arma las cuentas desde `channels`, no desde las cuentas de Zernio. Como `channels_platform_check` **no admite `tiktok`** y el sync de canales lo descarta a propósito, TikTok no tiene ningún camino para existir.
3. Nadie escribe `handle`, `avatar_url`, `bio`, `profile_url` ni `website` en `social_accounts`: `readProfile`, `readActiveStories`, `readAudience` y `readAccountInsights` (`lib/meta/instagram-graph.ts`) están escritas y **nadie las llama**.
4. No hay adopción de comentarios huérfanos, pese a que el comentario del archivo la promete (`lib/comments/store.ts:15-18`). Además `social_post_comments` **no guarda el id del post en la red**, así que hoy no hay con qué adoptarlos.
5. La validación por red corre **solo en el navegador** (`post-editor.tsx:169`); el servidor no la repite, y `publishedToday` nunca se calcula: **el tope diario no existe**.
6. Social y el dashboard de contenido piden Owner/Admin (`requireWorkspaceAdmin`, `lib/nav/items.ts:72`) en lugar de los permisos `social.view` y `dashboards.content.view`, **que ya existen y ya están asignados** a un rol personalizado "Content Manager" en producción.

### 1.4 La atribución: tres formas incompatibles conviviendo
| Quién escribe | Forma | Quién la lee |
|---|---|---|
| `lib/contacts/attribution.ts` (alta manual e importación) | `{ first_click: {...}, last_click: {...} }` | La ficha del contacto y el panel de la bandeja |
| `00099_bookings.sql:370` (agendamiento) | **plana**: `{ utm_*, source: 'scheduling', referrer }` | Nadie: `readAttribution` devuelve `{}` para esa forma |
| Trigger `contacts_emit_created` (`00039:105`) | lee `attribution->>'source'` | Solo funciona con la forma plana |

O sea: **la atribución del agendamiento es invisible en la ficha**, y el trigger de automatizaciones lee una clave que la forma canónica no tiene. Hay que unificar (B11).

### 1.5 Con fecha
`LINKEDIN_API_VERSION = "202510"` (`lib/social/linkedin.ts:32`) **vence el 15/10/2026**. Es una constante. Se actualiza en el B10 aunque LinkedIn todavía no esté conectado.

---

## 2. Objetivo y mapa de bloques

**Objetivo:** que Wendy pueda ver su perfil y su contenido publicado de cada red conectada, programar y publicar sola en Instagram y TikTok por Zernio, trabajar el contenido con el modelo nuevo (pieza clasificada, biblioteca de archivos, drawer), medir cada pieza repartida en varias redes, y que **todo contacto que entre quede atribuido** con first touch y last touch.

| Bloque | Qué se construye | Funcionalidades | Tamaño |
|---|---|---|---|
| **B10** | Desatasque: cuentas sociales reales, TikTok, perfil, comentarios huérfanos, validación en el servidor, permisos de lectura | F73 a F80 | Chico |
| **B11** | Atribución de contactos: toques, taxonomía, first/last, captura en todos los caminos de entrada | F81 a F88 | Mediano |
| **B12** | Modelo nuevo de la pieza: pilares, ofertas, embudo, campo único, biblioteca de archivos, formato por red | F89 a F94 | Mediano |
| **B13** | Drawer y pantallas: idea como galería, drawer de pieza, historial, barra superior, Social completa | F95 a F101 | Mediano |
| **B14** | Medición de la pieza: rollup por red, índice, agrupaciones, leads por comentario | F102 a F105 | Chico |

---

## 3. Decisiones tomadas

### 3.1 Las cuatro que `cambios-prototipo-contenido.md` dejó abiertas

**D1 — Formato principal vs. formato por red → gana el formato de cada publicación.**
Los dashboards y el rendimiento de la pieza agrupan por el formato con que **salió** cada publicación (`social_posts.media_type`), no por el formato principal de la pieza. El formato principal (`content_posts.format`) se conserva como valor de planificación: ordena el tablero, filtra el kanban y es el valor por defecto que hereda cada red. *Por qué:* una pieza que fue Reel en Instagram y carrusel PDF en LinkedIn, agrupada por su formato principal, miente en los dos casos.

**D2 — Ventana del índice → 90 días, mediana, base mínima de 3.**
El índice de una publicación se calcula contra la mediana de las publicaciones de **la misma red y el mismo formato** de los últimos 90 días. Si hay **menos de 3** publicaciones comparables, no se muestra índice: se muestran los números crudos y la leyenda "base insuficiente". *Por qué:* es la misma regla que F52 ya aplica para el salto de seguidores (`normal < 3`); dos reglas distintas para el mismo problema confunden.

**D3 — Leads atribuidos → entra, acotado al camino del comentario, y es lo último que se construye.**
Se cuenta como lead atribuido a una publicación el contacto cuyo toque provenga de un comentario en esa publicación (B11 lo registra). **No** se intenta atribuir desde el DM por palabra clave: hoy no hay forma confiable de saber qué publicación originó un DM, y adivinarlo sería peor que no mostrarlo. Es la última funcionalidad de la corrida (F104): si el tiempo se acaba, es lo que se cae.

**D4 — Orden de los archivos de un carrusel → orden de selección, con control de reordenar.**
El orden es el de selección (1, 2, 3 según se tocan). Además cada archivo elegido tiene flechas ↑ ↓ para moverlo. **No** se implementa arrastrar: las flechas se operan con teclado y la convención de accesibilidad del proyecto (§13 del plano) lo pide.

### 3.2 Las nuevas

**D5 — La cuenta social se arma desde Zernio, no desde los canales.** `computeAccounts` pasa a leer la lista de cuentas de Zernio por API y a cruzarla con `channels` para completar `channel_id` cuando existe un canal de esa plataforma. Es la única forma de que TikTok exista, porque `channels.platform` no admite `tiktok` y **no se va a modificar ese CHECK**: TikTok no tiene API de mensajes directos y un canal de TikTok ensuciaría la bandeja, sus filtros y el scope de leads.

**D6 — Los toques se guardan en una tabla, y first/last es una copia derivada.** `contact_touches` guarda cada interacción atribuible; `contacts.attribution` conserva `first_touch` y `last_touch` como copia desnormalizada para que la ficha y los filtros no hagan JOIN. *Por qué:* guardar solo dos fotos pierde el camino completo, y Wendy pidió entender todo lo que se puede trackear. Con la tabla, el día que haya formularios y páginas, enchufar una fuente nueva no toca el esquema.

**D7 — Una sola forma canónica de atribución, con compatibilidad hacia atrás.** La forma pasa a ser `{ first_touch, last_touch, version: 2 }`. Se conserva la lectura de `first_click` / `last_click` (forma vieja) y de la forma plana del agendamiento, para que nada de lo que ya existe se rompa. La migración rellena hacia adelante; no borra nada.

**D8 — Los contactos de comentarios de TikTok se crean anónimos.** Un comentario de Instagram resuelve el contacto por el camino de siempre (`find_or_link_contact`, que necesita un canal). TikTok no tiene canal, así que si el comentarista no coincide con ningún contacto conocido se crea un contacto con `is_anonymous = true` y su `tiktok_username`. Esto ya está previsto en el sistema: el trigger `contacts_emit_created` saltea los anónimos, así que no dispara automatizaciones ni ensucia los conteos, y el día que esa persona escriba por otro canal, `find_or_link_contact` lo unifica.

**D9 — El cambio de modelo es aditivo.** `content_posts.copy` (jsonb de 4 campos) y `content_ideas.hook/angle/notes` **no se borran en esta corrida**. Se agregan `script`, `recording_notes` y `content`, se rellenan desde lo viejo, el código deja de escribir lo viejo, y la migración que borra las columnas se escribe **sin aplicar** y queda en `docs/PENDIENTE.md`. *Por qué:* es la regla del proyecto, y el costo de romperla no se compensa con nada cuando hay 1 pieza de prueba en la base.

**D10 — "Publicación 100% funcional" se declara con una publicación real, no con tests en verde.** La definición de listo de la corrida **no** incluye publicar (Claude Code no toca proveedores reales). Incluye, en cambio, un test de integración que recorre el camino completo con Zernio simulado **desde guardar la integración** hasta `published` (F80). La publicación real va en la verificación en vivo (§11), con Wendy.

---

## 4. Qué cambia y qué NO cambia

### 4.1 Cambia
- `computeAccounts` y sus disparadores; `social_accounts` empieza a tener filas y perfil real.
- `social_post_comments` suma el id del post en la red y `contact_id`.
- La validación por red se repite en el servidor y el tope diario se calcula de verdad.
- Social y el dashboard de contenido pasan a permisos.
- `contacts.attribution` cambia de forma (aditivo) y empieza a escribirse en todos los caminos de entrada.
- `content_ideas` y `content_posts` suman columnas; aparecen `content_pillars`, `content_offers` y `contact_touches`.
- El editor de pieza y el detalle de post dejan de ser páginas y pasan a un drawer.
- El dashboard de contenido suma agrupaciones y la vista de rendimiento por pieza.

### 4.2 NO cambia (intocable)
- La recepción y el envío de mensajes de Instagram y WhatsApp, la deduplicación de contactos, el opt-out, el agente IA y su runner, los borradores, los flows y su editor, las secuencias, la base de conocimiento, el dashboard de Chat, los patrones de mensajes y los costos de IA.
- `processComment` y las automatizaciones por palabra clave: siguen disparándose igual. Solo se suma el guardado del vínculo con el contacto.
- `find_or_link_contact`: **no se cambia su firma ni su cuerpo.** La atribución se escribe después de llamarla.
- `channels.platform` y `channels.provider`: sin tocar (D5).
- El scope de leads y las funciones `can_see_*`.
- Los publicadores, el despachador, los reintentos y los webhooks de estado (F30 a F35): funcionan, no se tocan salvo lo que indique F80.
- Los 7 estados del pipeline y sus transiciones, el kanban de 7 columnas, el calendario por pieza.

### 4.3 Análisis de impacto

| Zona que se toca | Quién depende | Riesgo | Mitigación (test de caracterización ANTES) |
|---|---|---|---|
| `computeAccounts` | Programar, métricas, comentarios, Social | Que una cuenta existente se duplique o se pierda | `lib/social/accounts.test.ts` ya existe: fija lo de hoy antes de cambiar. El único `(workspace_id, platform)` protege de duplicados |
| Disparadores de la sync | `saveIntegration`, `disconnectIntegration`, `/api/v1/channels/sync` | Que guardar una clave falle porque la sync falla | La sync **nunca** puede hacer fallar el guardado: va en try/catch, sus `warnings` se muestran, su error se registra y no se propaga |
| `storeComment` | Webhook de comentarios y relectura | Que un comentario deje de guardarse o dispare un flow de más | Caracterización: comentario de tercero dispara `processComment` igual que hoy; propio no dispara. El vínculo con el contacto es posterior y en try/catch |
| `contacts.attribution` | Ficha, panel de bandeja, trigger `contacts_emit_created`, `ads-leads` | Que la ficha deje de mostrar lo que mostraba | `readAttribution` lee las tres formas; test con las tres |
| Receptores de webhooks (DM y comentario) | Toda la recepción | Que una atribución que falla tumbe la recepción de un mensaje | El registro del toque va **después** de persistir el mensaje, en try/catch, y nunca lanza |
| `content_posts.copy` → `script` | Editor, IA, versiones, kanban | Perder el copy existente | Aditivo con backfill (D9). 1 pieza en la base, vacía |
| Rutas `/content/[id]/edit` y `/content/[id]` | Links guardados, avisos, audit log | Romper un link | Las rutas **se conservan** y redirigen al tablero con el drawer abierto (F99) |

---

## 5. Funcionalidades y criterios de aceptación

> Formato: descripción + criterios EARS (`CUANDO …, EL SISTEMA DEBE …`) o DADO/CUANDO/ENTONCES + el test que debe pasar. Todo proveedor externo simulado. Cada tabla nueva: RLS por workspace y lectura cruzada probada en `verify-rls.mjs`.

---

### BLOQUE 10 — Desatasque: cuentas reales, TikTok y permisos

#### F73: Las cuentas sociales se arman desde Zernio
**Descripción:** `computeAccounts` (`lib/social/accounts.ts:144`) deja de derivar las cuentas de `channels` y pasa a leer la lista de cuentas de Zernio (`accounts.listAccounts` del SDK; si el método difiere, gana la documentación del SDK y se anota). Por cada cuenta de Zernio de una plataforma soportada (`instagram`, `tiktok`) se arma una `social_account` con su `external_id`, `username`, `display_name` y el publicador `zernio` en estado `available`. `channel_id` se completa **solo** cuando existe un canal activo de esa plataforma con el mismo `late_account_id`; para TikTok queda null. Los caminos de OAuth (Google, LinkedIn, Threads) y Postproxy siguen igual que hoy. **No se modifica `channels`.**
**Criterios:**
- DADA una cuenta de Instagram y una de TikTok en Zernio, ENTONCES deben existir dos `social_accounts`, la de Instagram con `channel_id` apuntando al canal y la de TikTok con `channel_id` null.
- CUANDO la sincronización corre dos veces, NO DEBE duplicar ninguna fila (único `(workspace_id, platform)`).
- CUANDO Zernio devuelve una plataforma que `social_accounts.platform` no admite, EL SISTEMA DEBE saltearla y sumar un `warning`, sin fallar.
- CUANDO la llamada a Zernio falla, EL SISTEMA DEBE devolver el error como `warning` y **no** borrar ni desactivar las cuentas que ya existían.
- Test: `lib/social/accounts.test.ts` extendido pasa, con casos de Instagram solo, Instagram + TikTok, plataforma desconocida y error de red.

#### F74: Disparadores de la sincronización y sus avisos
**Descripción:** `syncSocialAccounts` se llama, además del retorno de OAuth, en: `saveIntegration` al guardar Zernio o Postproxy (`lib/actions/integrations.ts:92`), `disconnectIntegration` al desconectar cualquier integración de red (`:286`), y el botón "Sincronizar canales" (`app/api/v1/channels/sync/route.ts`). Se suma un botón **"Sincronizar cuentas"** en la card de Zernio y en la de Postproxy. Los `warnings` que devuelve la función **se muestran** (hoy el callback los descarta): como toast en las acciones con interfaz y en el estado de la card.
**Criterios:**
- CUANDO se guarda la clave de Zernio y es válida, DEBE existir al menos una `social_account` al terminar la acción.
- CUANDO la sincronización falla, el guardado de la integración DEBE completarse igual, el error DEBE registrarse y DEBE mostrarse un aviso. **Nunca** se propaga.
- CUANDO se desconecta Postproxy, el publicador por defecto de YouTube DEBE recalcularse y avisarse (comportamiento de F13 ya existente).
- CUANDO la sincronización devuelve `warnings`, DEBEN verse en la interfaz.
- Test: `lib/actions/integrations.test.ts` extendido pasa, con un caso que verifica que un error de sync no hace fallar `saveIntegration`.

#### F75: Perfil real de la cuenta
**Descripción:** la sincronización completa `handle`, `avatar_url`, `bio`, `profile_url`, `website` y las cifras de perfil de cada red, y sella `profile_synced_at`. Fuentes: Instagram y TikTok, lo que entregue Zernio en la lista de cuentas y, si hay token de Meta, `readProfile` de `lib/meta/instagram-graph.ts` (**ya escrita, hoy sin llamar**); YouTube, `channels.list`; Threads, su `/me`. Las cifras por red (IG: publicaciones, seguidores, seguidos · TikTok: siguiendo, seguidores, me gusta · YouTube: suscriptores, videos, vistas · Threads: seguidores) van a `social_account_metrics_daily` del día cuando son series, y a `social_accounts` cuando son del perfil.
**Criterios:**
- CUANDO una fuente no entrega un campo, EL SISTEMA DEBE dejarlo null y **no** inventar un valor ni escribir cero.
- CUANDO la lectura del perfil falla, `profile_synced_at` **NO DEBE** actualizarse y el error DEBE guardarse (corrige el bug de `markAccountSync`, `lib/metrics/sync.ts:319-332`, que sella el sync aunque haya fallado).
- CUANDO no hay token de Meta, la lectura de Graph DEBE saltearse sin error.
- Test: `lib/social/profile.test.ts` (nuevo) pasa.

#### F76: Adopción de comentarios huérfanos
**Descripción:** `social_post_comments` suma la columna **`external_post_id`** (el id del post en la red), que hoy no guarda y sin la cual no hay con qué adoptar. `storeComment` la escribe siempre. Función nueva `adoptOrphanComments(workspaceId, platform)`: vincula los comentarios con `social_post_id` null a la publicación cuyo `(social_account_id, external_post_id)` coincide. Se llama después de crear o actualizar una cuenta social (F73) y al final de cada sincronización de métricas. Backfill: los 167 comentarios existentes no tienen `external_post_id`; la migración lo deja null y la primera relectura de Zernio (que trae los comentarios de los posts de los últimos 30 días) los completa por `external_comment_id`. Los que queden sin completar se informan en el log, no se borran.
**Criterios:**
- DADO un comentario huérfano con `external_post_id` y una publicación que coincide, CUANDO corre la adopción, ENTONCES el comentario DEBE quedar vinculado.
- CUANDO la adopción corre dos veces, NO DEBE cambiar nada la segunda vez.
- CUANDO un comentario no tiene `external_post_id`, la adopción DEBE saltearlo sin error.
- Test: `lib/comments/adopt.test.ts` (nuevo) pasa.

#### F77: Validación por red en el servidor y tope diario
**Descripción:** `validateNetwork` (`lib/content/validation.ts`) se ejecuta **también en el servidor**, dentro de `canScheduleNetwork` (`lib/content/schedule.ts:78`), antes de crear la fila de `social_posts`. Se calcula `publishedToday`: conteo de `social_posts` de esa cuenta y plataforma con `published_at` dentro del día en la zona del workspace, más las programadas para ese mismo día. Los límites son los de §9.6 del plano.
**Criterios:**
- CUANDO se llama a la acción de programar con una pieza que la validación rechaza, EL SISTEMA DEBE rechazarla aunque el navegador la haya dejado pasar.
- DADO el tope diario de una red alcanzado, CUANDO se intenta programar una más para ese día, EL SISTEMA DEBE rechazarla nombrando el límite.
- CUANDO la validación del servidor y la del navegador difieren, gana la del servidor y el mensaje DEBE ser el mismo.
- Test: `lib/content/schedule.test.ts` extendido pasa, con un caso que llama a la acción salteando el editor.

#### F78: Social y métricas por permiso
**Descripción:** `/dashboard/social` pasa de `requireWorkspaceAdmin` a `requirePermission("social.view")`; el dashboard de contenido, a `dashboards.content.view`; el ítem de menú "Social" deja de ser `adminOnly` y usa `social.view` (`lib/nav/items.ts:72`). **Las claves ya existen** en `PERMISSION_KEYS` y ya están asignadas a un rol personalizado en producción.
**Criterios:**
- DADO un rol personalizado con `social.view` y `dashboards.content.view`, ENTONCES esa persona DEBE ver el ítem, la página y el dashboard.
- DADO un Member sin esos permisos, ENTONCES NO DEBE ver el ítem ni poder entrar por URL.
- Owner y Admin siguen viendo todo (sus roles de sistema los incluyen).
- Test: `lib/auth/guards.test.ts` y `lib/nav/items.test.ts` extendidos pasan.

#### F79: Regla de frecuencia de métricas y versión de LinkedIn
**Descripción:** dos arreglos chicos. (a) El job de métricas (`lib/jobs/handlers/metrics-sync.ts:265`) pide siempre los últimos 30 días; pasa a usar `postsDueForSync` / `shouldCollect` (`lib/metrics/sync.ts:292`, `rules.ts:54`), **que ya existen y nadie llama**, para aplicar la regla del plano: diario hasta 30 días, semanal de 31 a 90, nunca después. (b) Se actualiza `LINKEDIN_API_VERSION` (`lib/social/linkedin.ts:32`) a la versión vigente según la documentación de LinkedIn, porque la fijada vence el 15/10/2026.
**Criterios:**
- DADO un post de 45 días sincronizado hace 3 días, CUANDO corre el job, ENTONCES NO DEBE pedirse; a los 8 días, DEBE pedirse.
- DADO un post de 100 días, ENTONCES nunca DEBE pedirse.
- Test: `lib/metrics/rules.test.ts` extendido pasa; la constante nueva queda anotada en `docs/PENDIENTE.md` con su fecha de vencimiento.

#### F80: Prueba de integración de punta a punta (la que faltaba)
**Descripción:** **Esta es la funcionalidad más importante del bloque.** Hoy hay 4.486 tests en verde y el sistema no publica, porque ningún test verifica que alguien *dispare* la creación de cuentas: los tests prueban `computeAccounts` (la parte pura), no la cadena. Se escribe `lib/publishing/e2e-zernio.test.ts`: con el cliente de Zernio simulado **y solo él** (nada de simular las funciones propias), recorre guardar la integración → sincronizar cuentas → crear una pieza → programar Instagram → correr el despachador → recibir el webhook de estado → fila `published` y estado de la pieza. Se repite para TikTok.
**Criterios:**
- El test DEBE fallar si se quita cualquiera de los disparadores de F74.
- El test DEBE fallar si `computeAccounts` deja de crear la cuenta de TikTok.
- NO DEBE simularse `syncSocialAccounts`, `canScheduleNetwork`, `runPublication` ni `settlePublication`: solo el cliente de Zernio y el reloj.
- Test: `lib/publishing/e2e-zernio.test.ts` pasa.

**Bloque 10 listo cuando:** F73 a F80 cumplen sus criterios; `npx vitest run`, `npm run build` y `node scripts/verify-rls.mjs` salen 0; `npm run lint` sin errores nuevos.

---

### BLOQUE 11 — Atribución de contactos

> **Qué resuelve.** Hoy 636 contactos no tienen atribución, hay tres formas incompatibles de guardarla (§1.4) y ningún camino de entrada real la escribe. Este bloque define una taxonomía, una tabla de toques y la captura en todos los caminos que existen hoy, dejando enchufables los que vendrán (formularios, páginas, agendamiento público).

#### F81: Taxonomía de atribución
**Descripción:** `lib/contacts/taxonomy.ts` fija el vocabulario. **Es la decisión de fondo del bloque: sin una taxonomía cerrada, los dashboards no se pueden agrupar.**

| Campo | Qué significa | Valores |
|---|---|---|
| `source` | **Dónde** ocurrió el toque: la plataforma o propiedad | `instagram`, `tiktok`, `youtube`, `linkedin`, `threads`, `whatsapp`, `email`, `google`, `web`, `referral`, `direct`, `manual`, `csv`, o el `utm_source` crudo si llega uno que no está en la lista |
| `medium` | **Cómo** llegó: el mecanismo | `dm`, `comment`, `story_reply`, `mention`, `link_in_bio`, `paid_social`, `organic_social`, `email`, `form`, `booking`, `qr`, `import` |
| `campaign` | La campaña u oferta | `utm_campaign`, o el nombre de campaña de Meta cuando el toque viene de un anuncio |
| `content` | **La pieza**: qué contenido concreto lo trajo | `utm_content`, y cuando el toque viene de un comentario en una publicación conocida, el `social_post_id` y el `content_post_id` |
| `term` | Palabra clave | `utm_term` |

Ejemplos canónicos (los de Wendy): DM de Instagram → `source: instagram, medium: dm`. Comentario en un reel → `source: instagram, medium: comment, content: <la pieza>`. Click desde el link de la bio → `source: instagram, medium: link_in_bio`. Anuncio de Meta que abre un DM → `source: instagram, medium: paid_social` con los ids del anuncio.
**Criterios:**
- CUANDO llega un `utm_source` que no está en la lista, EL SISTEMA DEBE guardarlo crudo y **no** descartarlo.
- CUANDO llega un `utm_medium` que no está en la lista, EL SISTEMA DEBE guardarlo crudo y marcar el toque como `medium_raw`, sin romper los agrupadores.
- Test: `lib/contacts/taxonomy.test.ts` pasa.

#### F82: Tabla de toques
**Descripción:** tabla nueva `contact_touches` (§6.2). Una fila por interacción atribuible, con `occurred_at`, los cinco campos de la taxonomía, los identificadores de anuncio (`ad_id`, `adset_id`, `campaign_id`, `fbclid`, `gclid`, `ttclid`, `li_fat_id`, `ctwa_clid`), `referrer_url`, `landing_page`, la fuente técnica (`origin`: `dm`, `comment`, `booking`, `form`, `manual`, `import`), el `dedupe_key` y el `raw jsonb` con la carga original recortada. **Escribe solo el servidor.**
**Criterios:**
- CUANDO se registra el mismo toque dos veces (mismo `dedupe_key`), DEBE quedar una sola fila.
- CUANDO un usuario de otro workspace consulta, NO DEBE ver filas; un Member solo ve los toques de los contactos que ya puede ver (reutiliza `can_see_contact`).
- CUANDO se borra un contacto, sus toques DEBEN borrarse en cascada.
- Test: `verify-rls.mjs` extendido sale 0; `lib/contacts/touches.test.ts` pasa.

#### F83: Registrar un toque y derivar first/last
**Descripción:** función única `recordTouch(supabase, { workspaceId, contactId, touch })` en `lib/contacts/touch.ts`. Inserta la fila (idempotente por `dedupe_key`) y actualiza `contacts.attribution` con la forma canónica `{ version: 2, first_touch, last_touch }`: `first_touch` **solo si está vacío**, `last_touch` **siempre**. Un toque sin ningún dato atribuible no se registra y no pisa nada. **Nunca lanza**: un fallo de atribución no puede tumbar la recepción de un mensaje.
**Criterios:**
- DADOS tres toques seguidos, ENTONCES `first_touch` DEBE ser el primero y `last_touch` el tercero, y DEBEN existir 3 filas en `contact_touches`.
- CUANDO un toque llega con fecha anterior al `first_touch` guardado (una relectura vieja), EL SISTEMA DEBE recalcular `first_touch` desde la tabla, no desde la copia.
- CUANDO la escritura falla, la función DEBE registrar el error y devolver sin lanzar.
- Test: `lib/contacts/touch.test.ts` pasa.

#### F84: Lectura compatible de las tres formas
**Descripción:** `readAttribution` (`lib/contacts/attribution.ts`) pasa a entender tres formas y devolver siempre la canónica: la nueva (`version: 2`), la vieja de clicks (`first_click` / `last_click`) y la plana del agendamiento (`{ utm_*, source: 'scheduling' }`). La función `create_booking` de `00099_bookings.sql` pasa a escribir la forma canónica, y el trigger `contacts_emit_created` (`00039:105`) pasa a leer `attribution->'first_touch'->>'source'` con fallback a `attribution->>'source'`, para no perder el comportamiento de las automatizaciones.
**Criterios:**
- CUANDO se lee una atribución en forma vieja, EL SISTEMA DEBE devolver sus datos como `first_touch` / `last_touch` sin perder ningún campo.
- CUANDO se lee la forma plana del agendamiento, EL SISTEMA DEBE devolver `source: scheduling, medium: booking` (hoy devuelve vacío: **es un bug**, §1.4).
- CUANDO el trigger emite `contact_created`, el `source` DEBE ser el mismo que antes para los contactos viejos.
- Test: `lib/contacts/attribution.test.ts` extendido pasa con las tres formas.

#### F85: Captura en los mensajes entrantes
**Descripción:** en `processMessageEvent` (`app/api/webhooks/late/route.ts:247`) y en el receptor de Evolution, **después** de persistir el mensaje, se registra el toque: `source` según la plataforma del canal, `medium` = `story_reply` si `metadata.storyReply`, si no `dm`. Si la carga trae datos de referencia de anuncio (el `referral` de Instagram con `ad_id` / `ref` / `ctwa_clid`), `medium` = `paid_social` y los identificadores se completan; el objeto crudo va a `raw`. **Si Zernio no reenvía esos datos, el toque queda como `dm` y se anota en PENDIENTE**: hay que verificarlo con un DM real que venga de un anuncio (§11).
**Criterios:**
- CUANDO entra un DM de un contacto nuevo, DEBE crearse el contacto y registrarse un toque `instagram / dm`, y `first_touch` DEBE quedar escrito.
- CUANDO entra una respuesta a una historia, el `medium` DEBE ser `story_reply`.
- CUANDO el registro del toque falla, el mensaje DEBE guardarse igual (test con el registro simulado para que lance).
- CUANDO el mismo webhook llega dos veces, DEBE haber un solo toque (`dedupe_key` = id del mensaje en la plataforma).
- Test: `lib/contacts/touch-inbound.test.ts` y el test del receptor pasan.

#### F86: Captura en los comentarios y vínculo con el contacto
**Descripción:** `storeComment` completa `contact_id`: para Instagram, resolviendo por `find_or_link_contact` con el canal de Instagram; para TikTok, buscando un contacto con ese `tiktok_username` y, si no existe, creando uno **anónimo** con ese username (D8). Hecho eso, se registra el toque: `source` = la plataforma, `medium` = `comment`, y `content` con el `social_post_id` y el `content_post_id` de la publicación comentada cuando se conoce. Los comentarios **propios** (`is_own`) no crean contacto ni toque.
**Criterios:**
- CUANDO llega un comentario de Instagram de alguien que ya es contacto, DEBE vincularse y registrarse el toque con la pieza.
- CUANDO llega un comentario de TikTok de alguien desconocido, DEBE crearse un contacto anónimo con su `tiktok_username` y registrarse el toque.
- CUANDO el comentario es propio, NO DEBE crearse contacto ni toque, y DEBE seguir sin disparar automatizaciones (caracterización de §4.3).
- CUANDO el comentario está huérfano (sin publicación), el toque DEBE registrarse igual, sin `content`; la adopción de F76 **no** reescribe toques pasados.
- Test: `lib/comments/contact-link.test.ts` pasa.

#### F87: Captura en los demás caminos y backfill
**Descripción:** se registra el toque además en: alta manual de contacto (`lib/actions/contacts.ts:95`, hoy el único camino que escribe algo) con `origin: manual`; importación de CSV con `origin: import` y `source: csv`; agendamiento (`create_booking`) con `medium: booking` y las UTMs que lleguen; email entrante, cuando exista el canal, con `source: email, medium: email`. **Backfill:** una migración recorre `analytics_events` (636 filas `contact_created` con `platform`, `channel_id` y fecha) y crea el toque inicial de cada contacto existente: `source` según la plataforma, `medium: dm`, `origin: dm`, `occurred_at` = la fecha del evento. Los contactos sin evento quedan sin toque.
**Criterios:**
- DESPUÉS del backfill, los 636 contactos con evento DEBEN tener `first_touch`.
- CUANDO el backfill corre dos veces, NO DEBE duplicar toques (`dedupe_key` = id del evento).
- CUANDO un contacto ya tiene un toque más viejo que el del backfill, `first_touch` DEBE quedar en el más viejo.
- Test: `scripts/verify-attribution.mjs` (nuevo, con workspace de prueba y limpieza) sale 0.

#### F88: La atribución en pantalla
**Descripción:** la ficha del contacto y el panel de la bandeja muestran **first touch** y **last touch** con los cinco campos en lenguaje claro ("Instagram · comentario · Reel «cómo cobrar en dólares» · 12 sep"), y debajo el **camino completo**: la lista de toques en orden, con fecha y origen, plegada por defecto. Cuando el toque tiene una pieza, su nombre es un link a la pieza. Se agrega el filtro por `source` y `medium` en la lista de contactos.
**Criterios:**
- CUANDO un contacto no tiene ningún toque, DEBE verse el estado vacío de hoy, sin ceros ni guiones inventados.
- CUANDO un contacto tiene un solo toque, first y last DEBEN ser el mismo y mostrarse una sola vez, no duplicado.
- CUANDO se filtra por `medium = comment`, DEBEN listarse solo los contactos cuyo **first touch** sea un comentario (el filtro aclara que es por primer toque).
- Test: `lib/contacts/attribution-view.test.ts` pasa; pantallas revisadas a 1440 y 390 px o anotadas.

**Bloque 11 listo cuando:** F81 a F88 cumplen sus criterios; `npx vitest run`, `npm run build`, `verify-rls.mjs`, `verify-crm.mjs` y `verify-attribution.mjs` salen 0.

---

### BLOQUE 12 — Modelo nuevo de la pieza

> Traduce §1 a §4 de `cambios-prototipo-contenido.md`.

#### F89: Pilares y ofertas configurables
**Descripción:** tablas `content_pillars` y `content_offers` (§6.3) y pestaña nueva **Ajustes → Contenido** (permiso `settings.manage`). Cada lista: nombre (y color en pilares), cuántas piezas lo usan, renombrar y **archivar**. No existe borrar: archivar lo saca del selector sin tocar lo publicado. Los selectores tienen "+ Crear" al final para no frenar la carga de una idea. Lo que queda sin pilar se agrupa como "Sin pilar".
**Criterios:**
- CUANDO se archiva un pilar en uso, las piezas que lo tienen DEBEN seguir mostrándolo y los dashboards DEBEN poder filtrar por él.
- CUANDO se intenta borrar, la acción NO DEBE existir.
- Test: `lib/content/taxonomy.test.ts` pasa.

#### F90: Campo único de texto
**Descripción:** la idea pasa de `hook` + `angle` + `notes` a un solo campo **`content`**. La pieza pasa de `copy jsonb` de cuatro campos a **`script`** (el guion completo) + **`recording_notes`** (instrucciones de producción, a todo el ancho). **Aditivo (D9):** se agregan las columnas, se rellenan desde las viejas concatenando lo que haya, el código deja de leer y escribir las viejas, y la migración que las borra se escribe sin aplicar.
**Criterios:**
- DADA una idea con hook y ángulo cargados, DESPUÉS de la migración `content` DEBE contener los dos textos y nada DEBE perderse.
- CUANDO el código nuevo guarda una pieza, `copy` NO DEBE modificarse.
- Test: `lib/content/migrate-copy.test.ts` pasa.

#### F91: Clasificación de idea y pieza
**Descripción:** los mismos seis campos en las dos: **plataformas** (multi-select de redes conectadas; en la idea es intención y al aprobar se heredan), **formato** (principal, D1), **oferta**, **pilar**, **etapa del embudo** (`tofu` | `mofu` | `bofu`, lista fija en código, con la descripción de la etapa bajo el selector) y **referencia** (texto libre). Autor y fecha de creación y de última edición, **visibles**: al pie del drawer de idea, bajo el título en la pieza, y en el kanban y la lista.
**Criterios:**
- CUANDO se aprueba una idea, sus plataformas, formato, oferta, pilar y embudo DEBEN heredarse a la pieza.
- CUANDO una pieza no tiene pilar, DEBE agruparse como "Sin pilar" y no quedar fuera de los conteos.
- Test: `lib/content/classification.test.ts` pasa.

#### F92: Biblioteca de archivos de la pieza
**Descripción:** `content_posts.media` pasa a ser **la biblioteca**: todos los archivos de la pieza, subidos una vez. Cada archivo muestra nombre, tipo, peso, proporción y **qué redes lo usan** (o "sin usar", en naranja). La elección de archivos vive en cada entrada de `networks[]` como **lista ordenada de ids**, no como copia del archivo. La subida es la de F18, que no cambia.
**Criterios:**
- CUANDO un archivo no lo usa ninguna red, DEBE marcarse "sin usar".
- CUANDO se quita un archivo de la biblioteca y alguna red lo usa, EL SISTEMA DEBE avisar y quitarlo también de esas redes.
- CUANDO se quita un archivo de una pieza no publicada, DEBE borrarse del bucket (comportamiento de F18).
- Test: `lib/content/media-library.test.ts` pasa.

#### F93: Formato y archivos por red
**Descripción:** `networks[]` suma `format` y `files[]`. Formatos admitidos por red y qué pide cada uno: Instagram (Reel, Carrusel, Imagen, Story) · TikTok (Video, Carrusel de fotos) · YouTube (Video, Short) · LinkedIn (Solo texto, Imagen, Carrusel PDF, Video) · Threads (Solo texto, Imagen, Carrusel, Video). Reel/Video/Short = 1 video; Imagen = 1 imagen; Carrusel IG/Threads = 2 a 10 imágenes en orden; Carrusel de fotos TikTok = 2 a 35; Carrusel PDF LinkedIn = 1 PDF; Story = 1 archivo; Solo texto = ninguno. El selector de archivos de cada red se **filtra por el formato elegido**, numera en orden de selección y permite reordenar con ↑ ↓ (D4). Una línea de verificación en verde o rojo por red ("Publica 3 imágenes en ese orden" / "Faltan archivos: este formato pide entre 2 y 10"). Al cambiar el formato de una red, se descartan los archivos que ya no sirven y se propone uno válido si lo hay.
**Criterios:**
- CUANDO el formato de una red pide un carrusel y hay un solo archivo, la verificación DEBE estar en rojo y la red NO DEBE poder programarse.
- CUANDO se cambia de Reel a Carrusel, el video DEBE quitarse de esa red y quedar en la biblioteca.
- CUANDO se reordena con ↑, el orden guardado DEBE cambiar y verse en la vista previa.
- Esta validación DEBE correr también en el servidor (F77).
- Test: `lib/content/network-format.test.ts` pasa.

#### F94: La IA al modelo nuevo
**Descripción:** la entrada del copywriter (`lib/agent/copywriter.ts`) pasa a ser el campo único de la idea más la clasificación (formato, oferta, pilar, embudo) y las redes elegidas. La salida estructurada pasa de `{ copy: {hook, body, cta, recording_notes}, caption_base, captions }` a **`{ script, recording_notes, caption_base, captions: { [platform]: texto } }`**, validada con Zod y respetando los límites por red. Todo lo demás de F29 no cambia: versión con autor "IA", confirmación al regenerar, permiso `content.ai`, tope de gasto.
**Criterios:**
- CUANDO la salida no cumple el esquema nuevo, NO DEBE guardarse nada y el job DEBE fallar con aviso.
- CUANDO la pieza ya tiene guion escrito a mano, "Regenerar" DEBE pedir confirmación.
- Test: `lib/agent/copywriter.test.ts` actualizado pasa.

**Bloque 12 listo cuando:** F89 a F94 cumplen sus criterios; `npx vitest run`, `npm run build`, `verify-rls.mjs` y `verify-content.mjs` salen 0.

---

### BLOQUE 13 — Drawer y pantallas

#### F95: Drawer de idea con galería
**Descripción:** drawer de ~560 px con los campos de F90 y F91, **todo editable al abrir** (sin modo lectura ni botón "Editar"). Contador ("1 de 3") y flechas anterior/siguiente. **Descartar** saca la idea del tablero y abre la siguiente sin cerrar el drawer. **Aprobar** crea la pieza en Borrador y abre la siguiente idea. **✦ Aprobar y producir copy** rompe la secuencia: encola la generación y abre **la pieza generada** en el mismo drawer. Cuando no quedan ideas, el drawer se cierra con un aviso. Cada acción deja un toast.
**Criterios:**
- CUANDO se descarta la última idea, el drawer DEBE cerrarse con el aviso y no quedar en blanco.
- CUANDO se aprueba, DEBE crearse la pieza y abrirse la idea siguiente en la misma apertura del drawer.
- Esc cierra; el foco vuelve a la tarjeta de origen.
- Test: `lib/content/idea-gallery.test.ts` pasa.

#### F96: Drawer de la pieza
**Descripción:** drawer de ~900 px que **reemplaza** la página de editor (F24) y el detalle (F36). Sin pestañas, en este orden: contenido/guion → notas de grabación (ancho completo) → clasificación → biblioteca de archivos → caption base → una tarjeta por red (F93: formato, archivos, verificación, caption propio o base, CTA y palabra clave, fecha y hora, y al pie "sacar esta red") → selector para agregar una red → para las publicadas, estado por red y rendimiento (B14). A la derecha, la vista previa del teléfono de la red abierta. El pie resume el estado ("2 de 3 redes con fecha") y lleva las acciones según permiso: Generar con IA, Guardar versión, Programar / Enviar a revisión. El estado de la pieza es un **dropdown**.
**Criterios:**
- CUANDO se abre, todos los campos DEBEN ser editables sin ningún clic previo.
- CUANDO se abre desde el kanban, el calendario o la lista, DEBE verse lo mismo.
- CUANDO dos personas editan la misma pieza, gana el último guardado y DEBE avisarse si cambió desde que se abrió (comportamiento de F24).
- A 390 px el drawer ocupa la pantalla completa y la vista previa pasa debajo.
- Test: `lib/content/piece-drawer.test.ts` pasa; revisado a 1440 y 390 px o anotado.

#### F97: Historial detrás de un botón
**Descripción:** el panel de versiones sale de la vista principal. Queda un botón de reloj en la cabecera del drawer con el número de versiones; al tocarlo, el historial ocupa el mismo drawer con **"← Volver al post"**. Comparar y Restaurar no cambian (F22).
**Criterios:**
- CUANDO se restaura desde el historial, DEBE crearse una versión nueva y volverse a la vista del post.
- Test: `lib/content/versions.test.ts` sigue en verde.

#### F98: Kanban y barra superior
**Descripción:** la tarjeta de idea **pierde los botones de aprobar y descartar**: solo abre. Muestra formato, redes, la primera línea del contenido, oferta, pilar y autor. La barra superior de Contenido concentra: Kanban / Calendario / Lista, el conteo Piezas / Publicaciones (solo en calendario), el filtro de Red, el ⓘ con lo que puede hacer el rol, y "+ Nueva idea" / "+ Nuevo post". El cuerpo queda limpio: solo el tablero. Se eliminan los chips de contexto, la nota explicativa del kanban y la barra interna del calendario.
**Criterios:**
- CUANDO se mira el tablero, NO DEBE haber ninguna barra de herramientas dentro del contenido.
- CUANDO una persona no tiene `content.approve`, el ⓘ DEBE decírselo.
- Test: `lib/nav/page-actions.test.ts` extendido pasa.

#### F99: Las rutas viejas siguen funcionando
**Descripción:** `/dashboard/content/[id]/edit` y `/dashboard/content/[id]` **se conservan** y redirigen a `/dashboard/content?piece=<id>` con el drawer abierto en esa pieza. Hay links guardados, avisos y entradas de `audit_log` que apuntan ahí.
**Criterios:**
- CUANDO se entra por la ruta vieja, DEBE abrirse el tablero con el drawer de esa pieza.
- CUANDO la pieza no existe o no se puede ver, DEBE mostrarse el mismo error que hoy.
- Test: test de la ruta pasa.

#### F100: Social — perfil real y "Próximas"
**Descripción:** completa F54 con lo que falta: la tarjeta de perfil muestra los datos reales que ahora llena F75 (foto, usuario, nombre, bio, link y las cifras de cada red); al principio de la grilla, la sección **"Próximas"**, con borde punteado, con lo programado y lo tentativo de esa red (al tocar, abre la pieza en Contenido); por red no conectada, "Conectá tu cuenta" con link a Integraciones; LinkedIn como lista de lo publicado desde el sistema con su estado y el aviso de que no entrega métricas. **Las historias de Instagram quedan fuera** (§12): dependen del token de Meta, que no está configurado.
**Criterios:**
- CUANDO hay publicaciones programadas o tentativas para esa red, DEBEN aparecer primero y distinguirse de las publicadas.
- CUANDO una red no está conectada, DEBE verse el estado vacío con el link, no una grilla vacía.
- Test: `lib/social/profile-page.test.ts` extendido pasa.

#### F101: La atribución entra al kanban y a la lista
**Descripción:** la tarjeta de la pieza y la fila de la lista muestran, cuando la pieza tiene publicaciones, cuántos contactos tienen a esa pieza en su first touch (viene de B11). Es un número con tooltip, no una sección.
**Criterios:**
- CUANDO la pieza no tiene publicaciones, el número NO DEBE mostrarse (ni como cero).
- Test: incluido en `lib/content/board.test.ts`.

**Bloque 13 listo cuando:** F95 a F101 cumplen sus criterios; `npx vitest run`, `npm run build` y `verify-content.mjs` salen 0; pantallas revisadas a 1440 y 390 px o anotadas.

---

### BLOQUE 14 — Medición de la pieza

#### F102: Rendimiento de la pieza
**Descripción:** sección en el drawer de la pieza: una fila por red publicada y una fila de total, con Red, Publicado, **Edad** (días desde que salió esa publicación), Alcance, Interacciones, Engagement a 7 días (`engagement_d7`, ya existe), **Índice** (F103) y **Leads** (F104). Todo lo comparable se mide **por edad de la publicación, nunca por fecha de calendario**. Nunca se inventan ceros: una red que no entrega una métrica muestra el hueco con su aviso.
**Criterios:**
- DADA una pieza en Instagram (10 días) y YouTube (3 días), ENTONCES la columna Edad DEBE decir 10 y 3, y la comparación DEBE ser a la misma edad.
- CUANDO LinkedIn es una de las redes, su fila DEBE mostrar el aviso de que no entrega métricas, no ceros.
- Test: `lib/dashboards/piece-performance.test.ts` pasa.

#### F103: El índice
**Descripción:** cada publicación se compara contra la **mediana de las publicaciones de la misma red y el mismo formato de los últimos 90 días** (D1, D2). `1,8×` = rindió casi el doble de lo normal. Verde desde 1,5×, rojo por debajo de 0,8×. El índice de la pieza es el promedio de los de sus publicaciones. Con **menos de 3** publicaciones comparables no se muestra índice: se muestran los crudos y "base insuficiente". Las sumas crudas de alcance e interacciones quedan como contexto, no como ranking.
**Criterios:**
- DADAS 2 publicaciones comparables, ENTONCES NO DEBE mostrarse índice y DEBE verse "base insuficiente".
- CUANDO una publicación no tiene todavía su `engagement_d7`, DEBE marcarse "en curso" y quedar fuera del promedio de la pieza.
- Test: `lib/dashboards/piece-index.test.ts` pasa.

#### F104: Leads por comentario (última, opcional)
**Descripción:** cuenta los contactos cuyo **first touch** tiene a esa publicación en `content` (B11, D3). Se muestra en la fila de cada red y en el total de la pieza, y como columna nueva en el dashboard de contenido. **No** se atribuyen leads desde DM por palabra clave.
**Criterios:**
- CUANDO un contacto comentó en dos publicaciones de la misma pieza, DEBE contarse una sola vez en el total de la pieza.
- CUANDO el first touch del contacto es anterior al comentario, NO DEBE contarse.
- Test: `lib/dashboards/piece-leads.test.ts` pasa.

#### F105: Agrupaciones nuevas del dashboard y documentación
**Descripción:** el dashboard de contenido orgánico suma agrupar y filtrar por **pieza**, **oferta**, **pilar** y **etapa del embudo**, además de red y formato (que ahora es el de cada publicación, D1). Y se cierra la documentación: `docs/contenido.md`, `docs/publicacion.md` y `docs/atribucion.md` (nuevo) actualizados, el `CLAUDE.md` corregido (dice que la próxima migración libre es la `00107` cuando la base tiene aplicada la `00112`) y la bitácora al día.
**Criterios:**
- CUANDO se agrupa por oferta, los totales DEBEN coincidir con la suma de las piezas de esa oferta.
- CUANDO una pieza no tiene oferta, DEBE aparecer en "Sin asignar", no desaparecer del total.
- Test: `lib/dashboards/content.test.ts` extendido pasa.

**Bloque 14 listo cuando:** F102 a F105 cumplen sus criterios (F104 puede quedar anotada en PENDIENTE); la suite completa sale 0.

---

## 6. Modelo de datos

> Tablas nuevas: **3**. Todas con `id uuid default gen_random_uuid()`, `workspace_id` con FK y `on delete cascade`, `created_at`, `updated_at`, y RLS por workspace.

### 6.1 Cambios en tablas existentes

| Tabla | Cambio | Tipo |
|---|---|---|
| `social_post_comments` | `+ external_post_id text` (índice con `platform`), `+ contact_id uuid` FK | Aditivo |
| `contacts` | `attribution` cambia de forma a `{ version: 2, first_touch, last_touch }`; se conserva la lectura de las formas viejas | Aditivo (no se borra nada) |
| `content_ideas` | `+ content text`, `+ platforms text[]`, `+ offer_id uuid`, `+ pillar_id uuid`, `+ funnel_stage text`; `hook`, `angle`, `notes` quedan y dejan de usarse | Aditivo |
| `content_posts` | `+ script text`, `+ recording_notes text`, `+ offer_id uuid`, `+ pillar_id uuid`, `+ funnel_stage text`, `+ reference text`; `copy jsonb` queda y deja de usarse. `media jsonb` cambia de **semántica** (pasa a ser la biblioteca) sin cambiar de tipo; `networks[]` suma `format` y `files[]` | Aditivo |
| `social_accounts` | sin cambios de esquema: las columnas de perfil ya existen y hoy no se llenan | — |

### 6.2 `contact_touches` (nueva)

| Campo | Notas |
|---|---|
| `contact_id` | FK, cascade |
| `occurred_at` | Cuándo pasó, en UTC |
| `source`, `medium`, `campaign`, `content_label`, `term` | La taxonomía de F81 |
| `social_post_id`, `content_post_id` | Nullable: la pieza concreta cuando se conoce |
| `ad_id`, `adset_id`, `campaign_id`, `fbclid`, `gclid`, `ttclid`, `li_fat_id`, `ctwa_clid` | Identificadores de anuncio |
| `referrer_url`, `landing_page` | Para cuando haya páginas y formularios |
| `origin` | `dm`, `comment`, `booking`, `form`, `manual`, `import` |
| `dedupe_key` | Único `(workspace_id, dedupe_key)`. Es el id del mensaje, del comentario, del evento o de la reserva |
| `raw jsonb` | La carga original recortada, para no perder lo que todavía no sabemos leer |

Índices: `(workspace_id, contact_id, occurred_at)`, `(workspace_id, source, medium, occurred_at)`, `(social_post_id)` parcial.
RLS: SELECT para quien puede ver el contacto (reutiliza `can_see_contact`); INSERT y UPDATE solo servidor.

### 6.3 `content_pillars` y `content_offers` (nuevas)

| Campo | Notas |
|---|---|
| `name` | Único por workspace entre los no archivados |
| `color` | Solo en pilares |
| `archived_at` | Archivar, nunca borrar |

RLS: SELECT para miembros con `content.view`; escritura con `settings.manage`.

### 6.4 Migraciones

| Migración | Bloque | Tipo | ¿Se aplica? |
|---|---|---|---|
| `00113_comment_post_and_contact` | B10 | Aditiva | Sí |
| `00114_contact_touches` | B11 | Aditiva | Sí |
| `00115_attribution_v2_and_backfill` (forma canónica, `create_booking`, trigger, backfill desde `analytics_events`) | B11 | Aditiva con backfill | Sí |
| `00116_content_taxonomy` (pilares, ofertas, columnas de clasificación) | B12 | Aditiva | Sí |
| `00117_content_single_text` (columnas nuevas + backfill desde `copy` / `hook`) | B12 | Aditiva con backfill | Sí |
| `00118_drop_legacy_content_columns` (`content_posts.copy`, `content_ideas.hook/angle/notes`) | B12 | **Destructiva** | **No.** Se escribe y se anota en `docs/PENDIENTE.md` |

Después de cada migración: `node scripts/build-all-migrations.mjs`. Antes de aplicar cualquiera: `list_migrations`.

---

## 7. Seguridad

- RLS en las 3 tablas nuevas, con lectura cruzada entre dos workspaces probada en `verify-rls.mjs`.
- `contact_touches` es dato personal: SELECT sigue el scope de leads (`can_see_contact`), nunca es público, y `raw` **no puede contener secretos ni tokens** (se recorta a una lista blanca de claves conocidas antes de guardar).
- Guards por permiso en toda Server Action nueva. `social.view` y `dashboards.content.view` en las pantallas (F78).
- Validación con Zod en el servidor: la salida de la IA (F94), los jsonb de `networks` y `media`, y cada toque antes de insertarlo.
- Los webhooks no cambian su verificación de firma ni su idempotencia. El registro del toque va después del ack y nunca puede hacer fallar la recepción.
- Nunca se muestra, loguea ni commitea el valor de un secreto.

---

## 8. Definición de "listo" de la corrida

`docs/PROGRESS-CV3.md` con los 5 bloques y F73 a F105 marcados (F104 puede quedar anotada en PENDIENTE); `npx vitest run`, `npm run build`, `node scripts/verify-rls.mjs`, `node scripts/verify-content.mjs`, `node scripts/verify-crm.mjs`, `node scripts/verify-attribution.mjs` y `node scripts/verify-inbox-filters.mjs` salen 0; `npm run lint` sin errores nuevos respecto del punto de partida; **ningún test que pasaba en el punto de partida se rompió**; `lib/publishing/e2e-zernio.test.ts` (F80) en verde; `docs/contenido.md`, `docs/publicacion.md`, `docs/atribucion.md`, `CLAUDE.md` y la bitácora actualizados; `00118` escrita y sin aplicar, anotada en `docs/PENDIENTE.md`; y solo entonces, `contenido-v3` mergeada a `main` y pusheada.

---

## 9. Verificación en vivo (después del merge, con Wendy)

No forma parte de la definición de listo. **Es lo único que prueba de verdad que el sistema publica.**

1. Apretar "Sincronizar cuentas" en la card de Zernio. Confirmar que aparecen Instagram y TikTok en Social, con foto, bio y cifras.
2. Confirmar en el panel de Zernio que la cuenta tiene **Analytics**. Sin eso no entran publicaciones externas ni métricas, aunque la cuenta exista.
3. Apretar "Sincronizar canales" para que el webhook de Zernio quede registrado con los eventos `post.platform.published` y `post.platform.failed`.
4. Esperar la sincronización nocturna: confirmar que entran las publicaciones de los últimos 30 días y que los comentarios se vinculan.
5. **Publicar una pieza de prueba en Instagram y una en TikTok (como borrador)**, con una palabra clave de automatización, y confirmar que el comentario dispara el flow y que el contacto queda atribuido con `medium: comment` y la pieza.
6. Mandar un DM desde una segunda cuenta y confirmar el toque `instagram / dm` en la ficha.
7. Si hay un anuncio activo: entrar por el anuncio y confirmar si llegan `ad_id` / `ctwa_clid`. **Es el dato que no se pudo verificar** (F85).
8. Revisar los 167 comentarios: cuántos quedaron adoptados y cuántos sin `external_post_id`.
9. Recorrer Social y Contenido con el rol "Content Manager" para confirmar los permisos.

---

## 10. Fuera de alcance de esta corrida

- **Historias de Instagram** en Social: dependen del token de system user de Meta, que no está configurado.
- **LinkedIn con media** (imagen, video, PDF): hoy publica solo texto. Son tres flujos de subida distintos y conviene hacerlos con la cuenta conectada.
- **Threads "Pegar token"**, YouTube por Postproxy o API oficial, Meta Ads: dependen de trámites externos que no están hechos.
- **Atribución desde DM por palabra clave** a una publicación (D3).
- **Formularios de opt-in y páginas propias**: la tabla de toques los contempla (`origin: form`, `landing_page`, `referrer_url`), pero no se construyen acá.
- Email como canal de atribución más allá de registrar el toque cuando el canal exista.
- Borrar o editar en las redes publicaciones ya publicadas.
- Agentes de contenido, generador de piezas, carruseles HTML→PNG (Etapa 3).
- Aplicar la `00118`.

---

## 11. Si algo bloquea

- **El SDK de Zernio no expone la lista de cuentas como espera F73:** gana la documentación del SDK; se mantiene la interfaz de `computeAccounts` y se anota.
- **Zernio no reenvía los datos de anuncio en el DM:** el toque queda `dm`, se anota en PENDIENTE y se verifica en vivo (§9.7).
- **Un test de caracterización muestra un comportamiento distinto al descrito acá:** gana el comportamiento actual; se ajusta el documento y se anota.
- **Una migración necesita borrar o pisar datos:** se escribe, no se aplica, se anota.
- **Un bloque es demasiado grande para cerrarlo de una vez:** se puede partir (por ejemplo B13a drawer y B13b Social) sin cambiar el orden, y se anota en PROGRESS.
- Nunca quedarse en un loop: después de un intento serio, anotar y seguir.

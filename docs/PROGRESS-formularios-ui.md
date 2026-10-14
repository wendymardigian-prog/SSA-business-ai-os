# Progreso: Formularios (UI nueva), menú lateral y URL de entrada

Plano: `claude/v12/requerimientos-formularios-ui-menu.md` (v1.0, 13/10/2026). Rama `feat/formularios-ui-menu`. Prototipo: `claude/v12/prototipo-ssa-baios.html`. Pendientes y decisiones en [PENDIENTE-formularios-ui.md](PENDIENTE-formularios-ui.md).

> En paralelo corre la sesión de **Equipo y roles** (`feat/equipo-roles`, migraciones `00208`–`00214` reservadas). Esta corrida usa la **`00215`**.

## Checklist

### Paso 0 · Antes de tocar
- [x] Rama renombrada a `feat/formularios-ui-menu`; `.env` enlazado (gitignored)
- [x] `npm run build` de base (salida 0, `embed.js` sin cambios)
- [x] Caracterización: menú por rol (`lib/nav/menu-by-role.characterization.test.ts`)
- [x] Caracterización: ida y vuelta de `definition` (`lib/forms/definition-roundtrip.characterization.test.ts` + `__fixtures__/definitions/`)
- [x] Caracterización: atribución de hoy (`lib/forms/attribution-view.characterization.test.ts`, `lib/contacts/attribution-view.characterization.test.ts`)
- [ ] `verify-*` de base, de a uno (ver "Punto de partida")
- [ ] Mensaje a la sesión de roles (00215 y archivos del menú)

### B1 · Menú lateral
- [x] F1 · Orden y grupos
- [x] F2 · Herramientas colapsable
- [x] F3 · Estado activo
- [x] F4 · Botón Conocimiento en Agentes IA

### B6 · URL de entrada completa
- [ ] F17 · Qué se guarda (`entryUrlFrom`, saneo, tope)
- [ ] F18 · Dónde queda (respuesta, toque, visita guardada, embed, Agenda) + M1 `00215`
- [ ] F19 · Dónde se ve (detalle de respuesta y visitas del contacto)

### B2 · Lista de formularios
- [x] F5 · La barra superior
- [x] F6 · Las tarjetas

### B3 · La barra superior del editor
- [ ] F7 · Qué va en la barra
- [ ] F8 · Vista previa

### B4 · El constructor (pestaña Campos)
- [ ] F9 · El lienzo
- [ ] F10 · Elegir
- [ ] F11 · El panel de la derecha

### B5 · Las demás pestañas
- [ ] F12 · Contacto
- [ ] F13 · Flows
- [ ] F14 · Publicar
- [ ] F15 · Encuesta, Contrato, Configuración y Canales del EOD
- [ ] F16 · Respuestas

### B7 · Verificación y cierre
- [ ] Revisión visual (1440 y 390 px, claro y oscuro)
- [ ] `docs/formularios.md` y `docs/atribucion.md`
- [ ] `CLAUDE.md` (menú nuevo, próxima migración libre)
- [ ] PR a `main` (sin mergear)

## Punto de partida

Medido el 13/10/2026 sobre `main` (`7bad3d1`), antes de tocar código.

| Qué | Resultado |
|---|---|
| `npx vitest run` | 836 archivos, 10 442 tests, todos verdes |
| `npm run lint` | 0 errores, 36 avisos |
| `npm run build` | salida 0 (34 s) |
| `vitest` con las caracterizaciones nuevas | 840 archivos, 10 485 tests, todos verdes |
| `scripts/verify-*.mjs` (28) | _(se completa abajo cuando termina la corrida de a uno)_ |

Datos vivos (solo lectura): 2 formularios (borradores personalizados, vacíos), 0 respuestas, 0 versiones, 0 reportes EOD, 4 reservas, 793 toques (140 en los últimos 7 días, de mensajes).

`record_contact_touch(uuid, uuid, jsonb)` vivo: md5 `f364db1862cc0f90291ca14ef855a214`, `SECURITY DEFINER`, `search_path = ''`.

## Migración

| Plano | Número real | Nombre | Estado |
|---|---|---|---|
| M1 | **00215** | `contact_touch_entry_url` | pendiente (después del código de B6) |

La `00208`–`00214` son de la sesión de Equipo y roles. Antes de escribir la 00215 se reconfirma con `list_migrations` y `ls supabase/migrations`.

## Diferencias con el plano

Están desarrolladas (21 puntos) en el plan completo de abajo, sección "Diferencias con el plano". Las que más pesan:

1. La barra superior sale de `PageHeader` (`left` / `filters` / `right`), no de `pageActions()`, que no usa nadie.
2. Conocimiento es por rol (`adminOnly`), no por permiso.
3. **Recursos y el Member:** Ajustes aparece para quien vea alguna pestaña; el Member pierde "Recursos" y gana "Ajustes" (decidido el 13/10).
4. **Tarjetas:** se reusan los cálculos que ya existen (conversión, NPS, reportes y personas del EOD), sin inventar números (decidido el 13/10).
5. La ruta `/encuesta` suma arriba la configuración de la encuesta; desaparece el botón "Panel NPS".
6. Contacto, Encuesta y Contrato conservan su botón Guardar (escriben otras columnas).
7. `entry_url` tiene su propio límite de 2000; hoy un texto de más de 500 haría fallar el toque entero.

## Funcionalidad que se conserva (F16)

Se tilda a mano en el navegador al cerrar B5.

- **Contacto:** [ ] interruptor de vincular · [ ] si la persona no está · [ ] si ya está · [ ] mapeo pregunta → dato · [ ] aviso "ninguna respuesta va a crear contacto" · [ ] etiquetas al enviar · [ ] avisar al equipo (con personas)
- **Flows:** [ ] lista de flows · [ ] encender y apagar · [ ] Editar · [ ] Nuevo flow · [ ] las 5 plantillas (con selector de tag y de pregunta) · [ ] aviso sin permiso de flows · [ ] link a Automatizaciones · [ ] EOD: plantillas de EOD
- **Publicar:** [ ] copiar el link · [ ] cambiar la parte final (con confirmación si está publicado) · [ ] embed (inline, ventana, botón flotante) · [ ] snippet del sitio · [ ] link firmado para un contacto (60 días) · [ ] armador de link de prellenado · [ ] versiones · [ ] pausar · [ ] reanudar · [ ] archivar · [ ] restaurar · [ ] razones para publicar
- **Encuesta:** [ ] el puntaje · [ ] "una vez por contacto" · [ ] panel NPS
- **Contrato:** [ ] texto · [ ] firma y aceptación · [ ] copias por email
- **EOD:** [ ] roles · [ ] horario · [ ] pantalla final · [ ] recordatorio · [ ] canales
- **Respuestas:** [ ] filtros (fecha, estado, contacto) · [ ] paginación · [ ] columnas · [ ] exportar CSV · [ ] detalle: marcar spam · [ ] vincular contacto · [ ] panel del contrato · [ ] archivos · [ ] historial · [ ] notas
- **Lista y editor:** [ ] crear un formulario de cada tipo · [ ] duplicar · [ ] autoguardado y conflicto · [ ] publicar con y sin contactos · [ ] solo lectura sin `forms.manage`

## Revisión visual

**Sin sesión:** la app pide login en `/dashboard/*` y no escribo credenciales. Para ver los componentes reales armé una página de prueba temporal (`app/harness-zz`, excluida de git con `.git/info/exclude`, se borra al cerrar B7) que renderiza `NavLinks` y, en los bloques siguientes, los componentes de Formularios con datos de ejemplo. Lo que depende de datos reales de la base (números de la lista, respuestas) no se ve.

### B1 · Menú (1440 px, oscuro; claro y 390 px en B7)
- Orden y grupos igual al prototipo: Dashboards, Bandeja, Tareas, Mi reporte del día · ADQUISICIÓN · VENTAS · HERRAMIENTAS ⌄ (Automatizaciones, Formularios, Agentes IA, Ajustes).
- Herramientas arranca cerrada con chevron; Enter la abre sin perder el foco; se recuerda en `localStorage`; con la pantalla activa adentro se ve abierta aunque esté guardada como cerrada (Conocimiento marca Agentes IA).
- Menú angosto: los cuatro íconos de Herramientas visibles, sin título, con la línea separadora y el tooltip "Nombre · Herramientas".
- Member: Ajustes lleva a `/dashboard/settings/recursos`.
- Diferencia con el prototipo: el prototipo tiene el "Asistente" arriba y "Facturación"/"Agentes" con otros nombres; no se suman (D5). El resto coincide.

### B2 · Lista de formularios (800/1000/390 px; oscuro y claro; datos de ejemplo del prototipo)
- Barra: buscador · Estado ⌄ · Tipo ⌄ · "+ Nuevo formulario"; en el celular los tres primeros bajan a la segunda fila (el `PageHeader` ya lo hace). Los contadores de los menús van a la derecha, como en el prototipo.
- Tarjetas: ícono de tipo con color, tipo, chip de estado con punto, "⋯", nombre, "Lo que ve el público: …", número grande + unidad + conversión/NPS/personas, barra fina, pie con preguntas, última respuesta y "Editado …". Archivadas al final y apagadas. Tarjeta punteada "+ Nuevo formulario" al final (sin filtros y con `forms.manage`).
- Toda la tarjeta es un `<Link>` real; el "⋯" es un hermano del link (no un hijo), así que tocarlo no navega (verificado en el navegador: la URL no cambia al abrir el menú).
- Escribir en el buscador filtra al instante, mantiene el foco (verificado tras 10 teclas), escribe `?q=` en la URL con `history.replaceState` (sin pedir la página al servidor) y recuerda lo filtrado en `sessionStorage` para el "← Volver" del editor (B3). Esc lo vacía.
- Estados: vacío ("Todavía no hay formularios" + "Crear el primero"), sin resultados ("Ningún formulario coincide" + "Ver todos"), esqueleto de tarjetas (`loading.tsx`), y `formularios/[id]/loading.tsx` para que el editor no herede el de la lista.
- Diferencias con el prototipo, justificadas:
  - **La barra de cada tarjeta compara las respuestas con las del formulario que más tiene** (no la conversión escalada): el prototipo la escala con un factor arbitrario por tipo y la app no calcula nada equivalente; así no se inventa un número.
  - **La conversión de la tarjeta es la de los últimos 366 días** (el tope de `form_metrics_daily`), no la de toda la vida; para pedirla se llama a la RPC una vez por formulario con respuestas (hasta 40, en paralelo), no una consulta única: la RPC solo acepta un formulario. Anotado en PENDIENTE.
  - Los números del prototipo (582 respuestas, NPS +62…) son de ejemplo; los de la app salen de la base.

---

# Plan completo (tal cual se aprobó)

## Plan · Formularios (UI nueva), menú lateral y URL de entrada (B1–B7)

## Contexto

- **El plano manda:** `claude/v12/requerimientos-formularios-ui-menu.md`. La copia de Downloads es la misma más una línea: "el diseño tiene que quedar lo más parecido posible al prototipo".
- **Prototipo:** `claude/v12/prototipo-ssa-baios.html`.
  - Vive solo en el checkout principal, fuera de git.
  - Lo recorrí en el navegador propio (servido localmente desde una copia en el scratchpad, porque el navegador no abre `file://`).
  - El código relevante va de la línea 7790 a la 8855.
- **Los tres cambios:**
  1. Menú con la sección **Herramientas** colapsable.
  2. Formularios estilo Tally: se escribe sobre el formulario y se configura en un panel al costado.
  3. La **URL de entrada completa** en la atribución.
- **En paralelo corre la sesión de Equipo y roles** (`feat/equipo-roles`; hoy solo tiene su plan commiteado).
  - Reservó las migraciones `00208`–`00214`, todavía sin aplicar.
  - Va a tocar `lib/nav/{items,page-actions}.ts`, `lib/settings/tabs.ts`, `components/sidebar.tsx` y `member-baseline.test.ts`.
  - **Decidiste:** reservo la `00215`, le aviso a esa sesión y dejo B1 lo más chico posible.

## Punto de partida (13/10/2026, `main` 7bad3d1)

| Qué | Hoy |
|---|---|
| `npx vitest run` | 836 archivos, 10 442 tests, todos verdes |
| `npm run lint` | 0 errores, 36 avisos |
| `npm run build` | **Se corre en el paso 0 de la ejecución**, no ahora (ver abajo) |
| `scripts/verify-*.mjs` (28) | **Se corren en el paso 0**, de a uno |

**Por qué el build y los verify no se corrieron todavía:**
- Estoy en modo plan, y el build reescribe `public/embed/embed.js`, que es un archivo commiteado.
- Los `verify-*` escriben en la base real con el prefijo `zz-test-`. La sesión de roles corre los mismos scripts y se pisarían la limpieza.
- Antes de cada `verify` chequeo que no haya filas `zz-test-` de otra corrida. Si las hay, espero y reintento. Lo que ya falle se anota y no puede empeorar.

**Datos vivos (solo lectura):**
- Hay 2 formularios, los dos borradores personalizados, con 0 respuestas, 0 versiones y 0 reportes EOD.
- Hay 4 reservas.
- `contact_touches` tiene 793 filas, 140 de los últimos 7 días (mensajes).
- **`record_contact_touch` está caliente:** la llama cada mensaje entrante. M1 es el cambio de más riesgo de la corrida, aunque los formularios todavía no tengan respuestas.

**Preparación del worktree (paso 0):**
- La rama real es `claude/formularios-ui-menu-660253`, no `feat/formularios-ui-menu`. La renombro con `git branch -m feat/formularios-ui-menu` (ese nombre no existe en el remoto) y la subo con `-u`.
- El worktree no tiene `.env`. Le pongo un **symlink** al `.env` del checkout principal: está en `.gitignore`, no se copia ningún secreto y nunca se commitea.

## Base viva y migración

- **`record_contact_touch(p_workspace_id uuid, p_contact_id uuid, p_touch jsonb) RETURNS jsonb`**
  - `SECURITY DEFINER`, `SET search_path = ''`.
  - md5 vivo: `f364db1862cc0f90291ca14ef855a214`.
  - La única definición está en la 00114.
  - El INSERT tiene una lista explícita de columnas, así que una clave nueva en el jsonb se ignora: **hay que reescribirla**.
- **El toque de un formulario no lo arma `submit_form_response`.**
  - Lo arma TypeScript después del commit: `recordFormTouch` → `formTouch` (`lib/contacts/touch-entry.ts`) → `recordTouch`/`parseTouch` (`lib/contacts/touch.ts`).
  - `submit_form_response` guarda la atribución completa en `form_submissions.attribution`.
- **Agenda:** `create_booking` v3 (00203) llama a `record_contact_touch` desde SQL. Pasa `raw.utm = p_utm` entero.
- **M1 = `00215_contact_touch_entry_url.sql`.** Antes de escribirla confirmo con `list_migrations` y `ls supabase/migrations`.
  - `ALTER TABLE contact_touches ADD COLUMN IF NOT EXISTS entry_url text`.
    - Sin CHECK, a propósito: un CHECK violado pone "Failing row contains (…)" en el log, con la URL adentro.
  - `record_contact_touch`: la definición viva, leída con `pg_get_functiondef` y copiada entera en la cabecera. El único cambio es sumar `entry_url` a la lista de columnas y a los valores:
    - `left(nullif(btrim(coalesce(p_touch->>'entry_url', p_touch->'raw'->'utm'->>'entry_url')), ''), 2000)`
    - La segunda rama es la de la Agenda, sin tocar `create_booking`.
  - Firma, permisos, `SECURITY DEFINER` y `search_path` quedan iguales. No cambia ningún otro comportamiento.
  - Encabezado "Cómo volver atrás": `DROP COLUMN` más la definición vieja.
  - No hay backfill. `contact_touch_json` **no se toca**, así que `contacts.attribution` no cambia.
- **Aplicación:**
  1. `supabase db query --linked -f`.
  2. El `INSERT` en `supabase_migrations.schema_migrations`.
  3. `node scripts/build-all-migrations.mjs`.
  4. Actualizar `lib/types/database.ts` (`contact_touches.Row.entry_url`).
- **Verificación:**
  - El caso nuevo de F19 en `verify-forms`.
  - `verify-attribution`, `verify-ads-attribution`, `verify-scheduling`, `verify-booking-concurrency` y `verify-inbound-webhooks`.
  - **Si algo falla, paro.** Anoto en `docs/PENDIENTE-formularios-ui.md` qué falló y cómo volver atrás, y no sigo.
- **Las huellas que cambian por F18:** `verify-forms.impl.ts:252-271` y `verify-ads-attribution.mjs:309-312` fijan el md5 de `record_contact_touch`.
  - Actualizo el valor esperado con el comentario "plano formularios-ui F18: la 00215 reescribe record_contact_touch solo para escribir entry_url".
  - La huella de `create_booking` queda igual.
  - Sumo `lib/contacts/record-touch-00215-diff.test.ts` (mismo patrón que `c2-migrations-diff`): falla si la definición nueva difiere de la vieja en algo más que las dos líneas de `entry_url`.

## Diferencias con el plano (gana el código real o tu decisión)

1. **La barra superior no sale de `page-actions`.** `pageActions()` no lo llama nadie: solo su test. Cada página arma su `<PageHeader>` con `left` / `right` / `filters`, y esos son los props que uso.
   - Para F4 el botón Conocimiento se declara en `ACTIONS` de `page-actions.ts` (adminOnly) y `agents/page.tsx` lo dibuja con `pageActions(...)`. Es el primer uso real de esa función.
2. **Conocimiento es por rol, no por permiso.** `knowledge.view` existe, pero nada lo lee y la página usa `requireWorkspaceAdmin`. El botón es `adminOnly`, como el ítem de hoy.
3. **Recursos y el Member.** Hoy el Member ve "Recursos" y no ve "Ajustes".
   - **Decidiste:** Ajustes aparece para quien pueda ver al menos una pestaña de Ajustes.
   - Para el Member, Ajustes lleva directo a `/dashboard/settings/recursos`, y sin la barra de pestañas, como hoy.
   - Se arma con una función pura `visibleSettingsTabs({ isAdmin })` en `lib/settings/tabs.ts`. Hoy: admin ve todas, si no, solo Recursos. Es el mismo nombre que va a usar la sesión de roles, que después reemplaza su cuerpo por claves.
   - **Cambio visible para el Member:** pierde "Recursos" y gana "Ajustes".
4. **Grupos.** Hoy son `inicio`, `adquisicion`, `ventas`, `automatizacion` y `sistema` (Ajustes e Integraciones abajo de todo, con línea). Pasan a `inicio`, `adquisicion`, `ventas` y `herramientas`, y `herramientas` reemplaza a `automatizacion` y `sistema`.
5. **La lista hoy filtra el estado solo en el cliente.** El tipo va en `useState` y no hay buscador. Los tres pasan a la URL.
6. **Métricas de las tarjetas.** Hoy solo se calculan las respuestas y la última; el EOD no cuenta nada.
   - **Decidiste:** reusar los cálculos que ya existen.
     - La conversión con `conversionRate` sobre lo mismo que lee Métricas, de toda la vida del formulario.
     - El NPS con la función del panel de la encuesta.
     - Para el EOD, los reportes enviados y las personas distintas.
   - Una consulta por cada cosa, nunca una por formulario. Si `form_metrics_daily` solo acepta un formulario, leo su tabla de origen con el cliente del usuario y agrupo en TypeScript con la misma `conversionRate`.
   - La barra fina es la conversión. El EOD no lleva barra, igual que en el prototipo.
   - Los conteos del EOD respetan la RLS: un Member sin `eod.view_all` ve solo lo suyo.
7. **La pestaña Encuesta.** Hoy hay dos cosas: la configuración de la encuesta (una pestaña del editor) y el panel NPS (la ruta `/encuesta`). El plano pide que la pestaña sea un link a la ruta.
   - **Propongo:** la ruta `/encuesta` muestra arriba las tarjetas de configuración ("El puntaje", "Una vez por contacto", con su propio Guardar de hoy) y abajo el panel.
   - Desaparece el botón "Panel NPS". No se pierde nada y la ruta no cambia.
8. **Pestañas del EOD:** sigo el plano y el código (Configuración · Preguntas · Canales · Flows · Publicar · Reportes), no el prototipo, que pone Preguntas primero y no tiene Canales.
9. **Contacto, Encuesta y Contrato tienen hoy su propio botón "Guardar".** Lo conservan: escriben otras columnas con otras acciones. Lo que se autoguarda sigue siendo el borrador: nombre, definición, diseño, final y mapeo.
10. **El nombre interno en las subrutas** (Respuestas, Métricas, Encuesta, Reportes) se ve, pero no se edita: ahí no está cargado el borrador. Se edita en el editor, con el autoguardado de hoy.
11. **Los estados de guardado de hoy se conservan** con los textos del plano: "Guardando…", "Guardado ✓" y "No se guardó · Reintentar". También queda el estado de conflicto ("Alguien más cambió este formulario" · Recargar), que el plano no nombra pero hoy existe. "Cambios sin guardar…" pasa a "Guardando…".
12. **`prefill-card`.**
    - La tabla de cada campo pasa a "Avanzado → Prellenar desde la dirección" en el panel de la pregunta.
    - El **armador de link** con varios valores pasa a Publicar, en la tarjeta "Link para un contacto", para no perderlo.
    - "Lo que se registra solo" se reemplaza por "Atribución · Automática".
13. **Respuestas ahora es una pestaña del editor (D7).** Por eso el `<details>` "Atribución de la visita" de `submission-detail.tsx` pasa a una tarjeta siempre abierta, "De dónde vino", como en el prototipo. El de `metrics-view` ("Ver como tabla") queda: Métricas es un botón, no una pestaña.
14. **Vista previa (F8).** La ruta que "ya existe" es `/f/[slug]?preview=1`. El overlay usa el `PublicForm` real con `preview`.
15. **El prototipo trae cosas que la app no tiene; no se agregan:**
    - el botón "Ver corridas" en Agentes;
    - en Encuesta, "Según el puntaje" y "Envío automático";
    - el "Asistente" arriba del menú.
    - Los nombres "Facturación" y "Agentes" quedan como hoy, "Ventas" y "Agentes IA" (D5).
16. **La tarjeta sin título público distinto** muestra "El título público es el mismo", como el prototipo. El plano no dice nada para ese caso.
17. **El script del `<head>`.** La regla dice "sin `dangerouslySetInnerHTML`", pero el plano pide para Herramientas "la misma técnica" del colapso del menú. Sumo **una línea** al script que ya existe en `app/layout.tsx`, sin crear uno nuevo.
18. **Los límites que hoy cortarían `entry_url`, y cómo los manejo:**
    - `parseTouch` rechaza el toque entero si un texto pasa de 500. Para `entry_url` uso un límite de 2000 que **recorta o descarta el dato, nunca el toque**.
    - `store.ts` corta cada valor a 200. `entry_url` tiene su propio límite de 2000.
    - El `attr` del embed tiene un tope de 2048 bytes.
    - El `referrer` del embed se corta a 500. Por eso en el embed la URL completa viaja dentro de `attr`, y el `referrer` queda solo de respaldo.
    - El tope de la cookie (2600 bytes) y el de `localStorage` (3500) no cambian.
19. **Agenda.** `pickUtm` (`app/api/public/scheduling/bookings/route.ts`) hoy descarta lo que no es una clave de atribución. Lo cambio para que conserve `entry_url`, re-saneada. Llega a `bookings.utm` y, por `raw.utm`, a `contact_touches.entry_url`. No toco ni `create_booking` ni sus pantallas.
20. **`VISIT_META_KEYS` no cambia** (de él sale el CSV de respuestas). `entry_url` va en su propia constante, `ENTRY_URL_KEY`. El CSV de respuestas no suma columna; queda anotado en PENDIENTE.
21. **No hay librerías de test de componentes** (vitest en `node`, sin testing-library). "Tocar ⋯ no navega" y "escribir no pierde el foco" se verifican en el navegador y quedan anotados en PROGRESS. Lo demás se prueba en funciones puras o con tests de fuente, el patrón que ya existe.

## Tests de caracterización (regla 2, ANTES de tocar; se escriben en el paso 0)

**Nuevos:**
- **`lib/forms/__fixtures__/definitions/*.json` y `lib/forms/definition-roundtrip.characterization.test.ts`.**
  - Las definiciones: las 2 de la base (solo la estructura; reviso que no traigan datos personales ni valores fijos de ocultos), `defaultDefinition` de cada tipo, `eodTemplate("setter" | "general")` y una rica armada a mano con los 14 tipos, condiciones, prellenado, ocultos con las tres fuentes y un social.
  - Fija:
    - que `validateDefinition` da hoy esos errores, texto por texto;
    - que `addField`, `removeField`, `moveField` y `reconcileContactConfig` dan hoy esos resultados;
    - el payload de `saveFormDraft`.
  - En B4 suma: cada función nueva sin cambios (mover al mismo lugar, mapear lo mismo, cambiar al mismo tipo) devuelve la definición idéntica.
- **`lib/nav/menu-by-role.characterization.test.ts`.** El menú de hoy (nombre, grupo, orden y separadores) para Owner, Admin, Member, un rol personalizado sin `forms.view` y uno con. En B1 se reescriben solo las aserciones que cambian por D1–D4 y la decisión de Recursos, con su comentario.
- **`lib/forms/attribution-view.characterization.test.ts` y `lib/contacts/attribution-view.characterization.test.ts`.** Lo que muestran hoy una respuesta con anuncio de Meta y `first_visit`, y un toque del contacto. Después de B6 tienen que dar igual, más el bloque nuevo.

**Ya existen; los confirmo en verde:**
- `lib/nav/{items,active,page-actions}.test.ts`, `lib/settings/tabs.test.ts`, `lib/auth/member-baseline.test.ts`, `lib/auth/permissions.test.ts`;
- `lib/forms/{list,builder,definition-schema,publish,prefill,public-load,contact-config,submit-form-response-diff}.test.ts`;
- `lib/attribution/{collect,merge,store,browser,keys}.test.ts`, `lib/embed/{build,url,embed-source}.test.ts`, `lib/contacts/c2-migrations-diff.test.ts`.

## Plan por bloques

**Orden:** B1 → B6 → B2 → B3 → B4 → B5 → B7.
- B1 y B6 no dependen de nadie.
- B2 no depende del editor.
- B3 va antes que B4 y B5.
- B7 va al final.
- Si un bloque se traba después de un intento serio, lo anoto y sigo solo con los que no dependen de él.

### B1 · Menú lateral (F1–F4)

**Archivos:**
- `lib/nav/items.ts`:
  - grupos `inicio`, `adquisicion`, `ventas` y `herramientas` (título "Herramientas", `collapsible: true`);
  - Formularios pasa a `herramientas`, con el orden de D1;
  - salen Conocimiento, Recursos e Integraciones;
  - Agentes IA suma `alsoActiveOn: ["/dashboard/knowledge"]`;
  - Ajustes suma `alsoActiveOn: ["/dashboard/channels"]` y una bandera `requires: "settings"` en vez de `adminOnly`.
- `lib/nav/active.ts`: sin cambios de regla. Gana el candidato más largo y `/dashboard/settings` ya cubre todas sus subrutas.
- `lib/nav/tools-open.ts`, nuevo, con `toolsOpen(stored, activeHref)`.
- `lib/settings/tabs.ts`: `visibleSettingsTabs`.
- `components/sidebar.tsx`: el título de Herramientas es un `<button>` con `aria-expanded`/`aria-controls`.
- `app/layout.tsx`: una línea más en el script.
- `app/globals.css`: variante `tools-open`.
- `lib/nav/page-actions.ts`: acción `knowledge` en `/dashboard/agents`.
- `agents/page.tsx`: el botón Conocimiento.
- `dashboard-chrome.tsx`: el cajón del celular.
- La bandera `settings` la calcula el layout del dashboard, donde hoy se calcula `eod`.

**Colapso:**
- Clase `nav-tools-open` en `<html>` y la clave `nav-tools-open` en `localStorage`, las dos en `try/catch`.
- Arranca cerrada.
- Si la pantalla activa está adentro, el servidor la dibuja abierta (`data-active-inside`).
- Con el menú angosto se ven todos los íconos, con su línea separadora (`collapsed:`).
- En el cajón del celular abre y cierra igual.
- No pasa a estado de React (§3).

**Tests:**
- `tools-open.test.ts` con los seis casos.
- `items.test.ts`: orden exacto, Formularios en Herramientas, los tres fuera, visibilidad por rol, grupo vacío sin título.
- `active.test.ts`: knowledge → Agentes IA; settings/\*, recursos, integrations, templates, audios y channels → Ajustes; formularios/\* → Formularios.
- `page-actions.test.ts`: Conocimiento lo ven Owner y Admin, el Member no.
- `tabs.test.ts`.

**Tests que se reescriben citando el plano (D1–D4 y la decisión de Recursos):**
- `items.test.ts`: los grupos, `sistema` y la lista del Member.
- `member-baseline.test.ts` L290–327: la lista de `adminOnly` y la de visibles.
- `permissions.test.ts` L133–148: "Conocimiento es adminOnly" pasa al botón de la barra.

Ninguno se desactiva.

**Listo:** vitest y build en verde, revisión visual lado a lado y el mensaje enviado a la sesión de roles.

**Riesgos:**
- Conflictos con roles en los mismos archivos. Se mitiga con el diff mínimo y el aviso.
- El test de PAGE_META exige un ítem activo por ruta para el admin: Agentes IA cubre knowledge y Ajustes cubre channels.

### B6 · URL de entrada completa (F17–F19, M1)

**Funciones puras:**
- `lib/attribution/sensitive-params.ts`, nuevo. Ahí se **mueve** `SENSITIVE_PARAM_NAMES` desde `lib/embed/url.ts`, que pasa a importarla, sin duplicarla.
- `lib/attribution/entry-url.ts` con `entryUrlFrom(url)`:
  - solo http o https;
  - limpia los caracteres de control y saca el `#`;
  - saca los sensibles y los internos (`embed`, `attr`, `preview`, `c`, `referrer`), conservando el orden y la codificación del resto;
  - recorta a 2000;
  - devuelve null si no hay URL.
- `collect.ts`: `attributionFromParams` suma `entry_url` (de `landing`), y `sanitizeAttribution` la re-sanea, arriba y en `first_visit`.
- `merge.ts`:
  - si la visita actual trae claves de atribución, gana la URL de esa página;
  - si no, la de la visita guardada;
  - si no hay, la de la página.
  - `first_visit` conserva la suya.
- `store.ts`: `entry_url` en la primera y la última visita, con el orden de recorte "entry_url de first → entry_url de last → (lo de hoy)".
- `embed-source.ts` `attrParam`: `entry_url` es lo primero que se saca.

**Servidor:**
- `submit.ts` ya re-sanea con `sanitizeAttribution`.
- `touch-entry.ts` `formTouch` pasa `entryUrl`.
- `touch.ts` `parseTouch` suma `entry_url`: si no es válida, se descarta el dato y el toque sigue.
- `pickUtm` de la agenda.

**Pantallas:**
- `lib/forms/attribution-view.ts` suma `entryUrl` aparte. `submission-detail.tsx` lo dibuja con un bloque monoespaciado que corta líneas y un botón Copiar.
- `lib/contacts/attribution-view.ts` y `attribution-section.tsx` lo muestran en cada visita.
  - La consulta de toques suma `entry_url`, con un reintento sin esa columna si la base no la tiene (error 42703).
  - En las tarjetas de primera y última visita, la URL se busca por el id del toque, si `contact_touch_json` lo trae (lo confirmo). Si no, queda solo en la lista de visitas.
- **Nunca se loguea la URL.**

**Después de tocar `lib/attribution/`:** `npm run build:embed`, `public/embed/embed.js` regenerado y commiteado, y `build.test.ts` en verde (< 60 KB).

**Tests (F19):**
- `entry-url.test.ts`: `ad_name`, `campaign_name`, `site_source_name` y `ref` en su orden y con su codificación; sensibles e internos fuera; `#`; 2000; no http; null.
- `collect`, `merge` y `store`: el tope con una URL enorme deja la cookie en ≤ 3500 bytes y conserva las UTM.
- La prioridad: la visita guardada, la página y la página madre del embed.
- `touch.test`.
- `embed-source.test`: los parámetros del iframe siguen siendo `["embed","referrer"]`.
- **El caso nuevo en `verify-forms.impl.ts`:** se envía una respuesta con una URL de Meta completa. En `form_submissions.attribution.entry_url` y en `contact_touches.entry_url` tiene que llegar entera, sin `token`.

**Orden:**
1. El código y sus tests.
2. M1, que es aditiva: el código viejo sigue andando.
3. Aplicarla, registrarla y verificarla.
4. Recién ahí el commit del bloque.

### B2 · Lista (F5–F6)

**Funciones puras** (`lib/forms/list.ts`):
- `"all"` como default de `parseListFilter`. La aserción vieja (`parseListFilter("x") → "published"`) se reescribe citando "plano formularios-ui D-B2".
- `parseTypeFilter`.
- `parseListQuery({ q, estado, tipo })`: un valor inválido se ignora.
- `filterForms(rows, …)`: sin distinguir mayúsculas ni tildes, sobre el nombre y el título público; archivados al final.
- `listSummary` (los dos textos y los chips) y `countsFor` (cantidades por estado y por tipo).
- **`lib/forms/form-card.ts`** con `formCardView(row)`: ícono y color del tipo, chip, "Lo que ve el público", números, "Sin publicar todavía" / "Sin respuestas", "respuestas" / "firmas" / "reportes" y el pie.

**Archivos:**
- `formularios/page.tsx`: suma `design`, la cuenta de preguntas del borrador y las tres métricas en lote.
- `forms-list.tsx` se reescribe:
  - barra en `PageHeader filters` (buscador, Estado y Tipo con `FilterMenu`) y `right` (+ Nuevo formulario con `forms.manage`);
  - la URL se actualiza con `replaceState`, sin ir al servidor, y escribir no pierde el foco;
  - la grilla `minmax(272px, 1fr)`, con cada tarjeta como `Link`;
  - el menú "⋯" con `stopPropagation` y `preventDefault`;
  - la tarjeta punteada para crear, los esqueletos, los vacíos;
  - el diálogo de creación de hoy.
- Los filtros se guardan en `sessionStorage` (en `try/catch`) para el "← Volver" de B3.

**Tests:** `list.test.ts` y `form-card.test.ts`, por tipo y por estado.

**Riesgo:** el costo de las métricas. Una consulta por cosa; medido en PROGRESS.

### B3 · Barra del editor (F7–F8)

**Funciones puras:**
- `lib/forms/editor-bar.ts`:
  - `editorBarView(form, { canManage, section, saveState, route })`: pestañas con etiqueta, href, cantidad y cuál está activa; el botón de publicar (`publish` / `publish_changes` / `published` / ninguno); chip; "Cambios sin publicar"; si va Vista previa.
  - `parseEditorTab(type, raw)`: un valor inválido cae en la primera pestaña.
- `lib/forms/preview-view.ts`: el texto final o "Acá la persona va a [url]".

**Archivos:**
- `components/forms/editor/editor-bar.tsx`, que se usa en el editor y en las rutas `respuestas`, `metricas`, `encuesta` y `reportes`.
  - El número de Respuestas/Reportes lo calcula el servidor.
  - En las subrutas, publicar valida en el servidor con `checkPublishable`. Si falta algo, lleva a `?tab=campos&problema=…`.
- `form-editor.tsx`: la pestaña sale de `?tab=` y se cambia con `router.replace` (sin recargar). Sale el encabezado interno.
- `components/forms/editor/preview-overlay.tsx`:
  - pantalla completa, Escritorio/Celular, "Abrir en pestaña" (`/f/slug?preview=1`) y ✕;
  - Esc la cierra y devuelve el foco;
  - usa `PublicForm` con `preview`.
- Los anchos: menos de 1320 px (Métricas solo ícono), menos de 1180 px (guardado solo ícono) y menos de 860 px (segunda fila con scroll de pestañas, que ya da `PageHeader filters`).

**Tests:** `editor-bar.test.ts` para custom, survey, contract, eod-setter y eod-general, por permiso y por estado de publicación, y para un `?tab=` inválido.

### B4 · Constructor (F9–F11)

**Funciones puras** (reusan `lib/forms/builder.ts`, `contact-config.ts` y `definition-schema.ts` sin duplicar reglas):
- `insertFieldAt` y `moveFieldTo`.
- `duplicateField`: clave nueva sin choque, sin mapeo y sin parámetros de prellenado repetidos.
- `removeField`, que ya limpia las condiciones.
- `changeFieldType`: conserva lo que se pueda; si deja de ser de opciones, poda las condiciones que dependían de ella.
- `setFieldMapping(config, fieldId, target)`: devuelve a quién se lo sacó, para el toast.
- `lib/forms/publish-issues.ts`: los problemas por id de pregunta y los generales.
  - `validateDefinition` pasa a armar internamente una lista `{ fieldId?, message }` y sigue devolviendo **exactamente** los mismos `errors: string[]` (lo fija la caracterización).
- `lib/forms/builder-summary.ts`: preguntas, obligatorias, condicionales y van al contacto.
- `lib/forms/canvas-view.ts`:
  - chips de condición ("Si ¿Qué negocio tenés? = Otro") y de mapeo ("→ Email");
  - las primeras 6 opciones y "y N más";
  - la nota del oculto;
  - los tipos del selector, agrupados y filtrados para el EOD;
  - los 5 atajos del vacío.
- `lib/forms/builder-selection.ts`: qué está elegido.

**Componentes:**
- **Nuevos** en `components/forms/builder/`:
  - `form-canvas.tsx` y `question-card.tsx` (`React.memo`, clave `field.id`);
  - `inert-control.tsx` (el control como lo ve el público);
  - `add-question-picker.tsx` (dentro del lienzo, no un modal);
  - `inspector-form.tsx`, `inspector-field.tsx` e `inspector-end.tsx`.
- Arrastrar y soltar con **HTML5 nativo**, el patrón de `tasks-board.tsx`. Se arrastra solo desde el asa, nunca con el foco en un input de esa tarjeta, con una línea que marca dónde cae. También Subir y Bajar.
- **Salen:** `design-cards.tsx` (y con él la opción del logo), el panel y la vista previa al costado de `fields-tab.tsx`, y el `<details>` de `field-editor.tsx`, que se reparte en el panel.
- En el EOD, la pestaña Preguntas usa el mismo lienzo con los tipos que acepta y los ajustes de número que ya existen (`eod-number-settings`).
- **D9:**
  - `app/f/[slug]/page.tsx` deja de dibujar el logo para cualquier `showLogo`;
  - `saveFormDraft` conserva el valor guardado tal cual (no se migra nada);
  - `defaults.ts` no cambia.
- **D12:** el oculto ya no ofrece la fuente "atribución". Los que ya la tienen muestran "Atribución de la visita (ya se guarda sola)", en solo lectura.
- **Sin `forms.manage`:** todo en solo lectura, sin asas ni "+", con el aviso del plano.

**Tests:**
- Las funciones de arriba.
- `no-details.test.ts`: recorre `components/forms/editor/` y `builder/` y falla si encuentra `<details`.
- `public-logo.test.ts`: el test de fuente sobre la página pública.
- La ida y vuelta con las fixtures.

**Riesgos:**
- Es el bloque más grande y el EOD tiene reglas propias (`step`, `metricKey`, canales). Se mitiga con la ida y vuelta, y con `verify-forms` y `verify-eod` al final.
- El foco al tipear: lo verifico a mano en el navegador.

### B5 · Las demás pestañas (F12–F16)

Tarjetas simples en una columna (máx. ~900 px), sin `<details>`:
- **Contacto**, en el orden de F12. La tabla de mapeo usa la misma `setFieldMapping`.
- **Flows**, con los textos de F13 (`automations-tab.tsx`: la lógica no cambia, se renombra la pestaña).
- **Publicar**, en dos columnas, con lo de F14 más el armador de link de prellenado.
- **Encuesta** (ruta, según la diferencia 7), **Contrato**, **Configuración** y **Canales** del EOD (`components/eod/editor/*`).
- **Respuestas y Reportes**, con la barra de F7.

El checklist de "Funcionalidad que se conserva" va en PROGRESS y se tilda a mano en el navegador:
- **Contacto:** el interruptor, si no está, si ya está, el mapeo, el aviso sin identificador, las etiquetas, avisar al equipo con personas.
- **Flows:** la lista, encender y apagar, editar, nueva, las 5 plantillas con sus selectores, el aviso sin permiso de flows, el link a Automatizaciones.
- **Publicar:**
  - copiar el link, cambiar la parte final, los 3 tipos de embed, el snippet del sitio;
  - el link firmado para un contacto (60 días) y el armador de prellenado;
  - las versiones;
  - pausar, reanudar, archivar y restaurar;
  - las razones para publicar.
- **Encuesta:** el puntaje y "una vez por contacto".
- **Contrato:** el texto, la firma y la aceptación, las copias por email.
- **EOD:** roles, horario, pantalla final, recordatorio, canales.
- **Respuestas:**
  - filtros (fecha, estado, contacto), paginación, columnas, exportar CSV;
  - en el detalle: spam, vincular contacto, el panel del contrato, archivos, historial y notas.

### B7 · Verificación y cierre

- La revisión visual completa del plano (B7), a 1440 y 390 px, en claro y oscuro. Las capturas finales van a `docs/capturas-formularios-ui/`.
  - Si la app pide login y no hay sesión, lo anoto. Nunca escribo credenciales.
- `docs/formularios.md` y `docs/atribucion.md` al día.
- `CLAUDE.md`:
  - el menú nuevo;
  - la próxima migración libre;
  - que `record_contact_touch` ahora escribe `entry_url` (su huella cambió).
- vitest, build y los `verify-*` que pasaban dan 0; lint sin errores nuevos.
- PR con `gh pr create` hacia `main`, **sin mergear**, con los cambios visibles arriba de todo.

## Cambios visibles por rol (solo los del plano y tus decisiones)

- **Owner y Admin:**
  - el menú con el orden nuevo y Herramientas colapsable (Automatizaciones, Formularios, Agentes IA, Ajustes);
  - Conocimiento, Recursos e Integraciones ya no están en el menú;
  - el botón "Conocimiento" en Agentes IA;
  - la lista en tarjetas, con buscador, Estado y Tipo en la barra, que por defecto muestra **todos**, incluidos los archivados;
  - el editor con la barra nueva, las pestañas "Flows" y "Respuestas N", el lienzo con panel, sin vista previa al costado ni opción de logo, y la vista previa a pantalla completa;
  - las pestañas en tarjetas;
  - la ruta Encuesta con la configuración arriba;
  - la URL de entrada en el detalle de una respuesta y en las visitas del contacto.
- **Member:**
  - el mismo menú reordenado, sin "Recursos" y **con "Ajustes"**, que lo lleva a Recursos;
  - sin el botón Conocimiento, como hoy;
  - la lista sin "+ Nuevo";
  - el editor en solo lectura, con su aviso;
  - "Flows";
  - la URL de entrada (si tiene `forms.view`).
- **Quien responde un formulario:** ya no ve el logo.
- **Agenda:** guarda `entry_url` sin que cambie ninguna pantalla.

## Reglas para toda la corrida (confirmadas)

- Sin secretos, variables de entorno ni dependencias nuevas. Sin tocar la configuración real (Railway, producción).
- Lo de §3 es literal. Si para algo hiciera falta tocarlo, **paro y pregunto**.
- Meta, Resend, Zernio y Evolution van simulados en los tests.
- **Ritmo:**
  - `npx vitest run` después de cada funcionalidad;
  - al cerrar cada bloque: PROGRESS, commit `feat: formularios-ui - bloque Bn (nombre)` y `git push origin feat/formularios-ui-menu`.
- Revisión visual lado a lado (app y prototipo) al cerrar B1 a B5, con las diferencias en PROGRESS, corrigiendo y volviendo a comparar.
- Los commits con rutas explícitas, nunca `git add -A` (hay sesiones concurrentes).

## Primeras tareas al aprobar (y después freno)

1. **Paso 0:**
   - renombrar la rama y poner el symlink de `.env`;
   - `npm run build` y cada `verify-*` de a uno, chequeando `zz-test-` antes;
   - escribir los tests de caracterización;
   - mandarle el mensaje a la sesión de roles: que reservo la 00215 y qué archivos del menú toco.
2. Crear `docs/PROGRESS-formularios-ui.md` con este plan tal cual. Lleva B1 a B7 con sus F como checklist, "Punto de partida" (con los resultados del paso 0), "Migración" (00215), "Diferencias con el plano" y "Funcionalidad que se conserva".
3. Crear `docs/PENDIENTE-formularios-ui.md` con el formato qué quedó, por qué y qué se decidió.
4. Commit `docs: plan de formularios UI, menú y URL de entrada` (los docs y los tests de caracterización) y push.
5. **Freno y espero tu `/goal`.** No empiezo B1.

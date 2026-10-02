# Bloque I — Bandeja (I1 a I7)

**Rama:** `feat/bandeja-barra` (worktree aparte). **Migraciones:** ninguna,
como pedía el bloque.

## Punto de partida

- `main` local estaba desactualizado: el Bloque N (PR #11) ya estaba
  mergeado en GitHub pero no traído. Se armó la rama desde `origin/main`
  (`e35a427`), no desde el `main` local viejo.
- `npx vitest run` antes de tocar nada: 340 archivos, 4233 tests, todo verde.
- `npm run build`: compila sin errores.

Base sana: se construyó encima sin problema.

## Las tres confirmaciones del documento

- **a) Cierta, con un matiz.** `countActiveFilters()` ya existe y ya
  alimentaba el contador, pero cuenta también la búsqueda y el estado. Como
  esos dos pasan a vivir afuera del popover (búsqueda en la barra, estado en
  las pastillas), se neutralizan antes de contar (`countMenuFilters`,
  `lib/inbox/filter-summary.ts`), sin tocar `lib/inbox/filters.ts`.
- **b) Cierta.** Los 12 parámetros de URL son exactamente esos, sin
  renombrar ninguno. Se encontró un link roto fuera de este bloque (ver
  "Hallazgos" en `docs/PENDIENTE.md`).
- **c) Cierta solo a medias.** `FilterMenu` manejaba flechas/Home/End/Esc/
  click-outside, pero solo sobre botones. El popover de la Bandeja necesita
  un `<select>` y dos `<input type="date">`, así que se sumó la regla de
  I1b sin cambiar su firma.

## Qué se hizo

| Paso | Commit | Qué cambia |
|---|---|---|
| 0 | `test:` | Caracterización del Realtime de `conversation-list.tsx` antes de tocar nada: compara el bloque del `useEffect` contra una copia literal fijada. Sigue en verde al final: ese bloque no se tocó. |
| I1 | `refactor:` | `filter-menu.tsx` se mueve a `components/ui/`, sin cambiar una línea. Se actualizan los tres imports del dashboard de Chat. |
| I1b | `feat:` | `FilterMenu` acepta campos de formulario sin cambiar su firma. La regla de teclado se extrae a `lib/ui/menu-keys.ts` (puro, testeado): con el foco en un `select`/`input`, las flechas son del campo y Tab pasa al ítem siguiente sin cerrar el menú. Un menú sin campos (los del dashboard de Chat) se comporta igual que antes — verificado en vivo. |
| I2 | `feat:` | `SectionTabs` pasa de franja propia a segmented control en el `left` del `PageHeader`, en las cuatro pantallas de comunicación. El título de la Bandeja pasa de "Inbox" a "Bandeja" en `PAGE_META`. Volver a Conversaciones desde otra sección conserva los filtros que tenía (se recuerdan en `sessionStorage`, `lib/comunicacion/tab-href.ts`). |
| I2 (fix) | `fix:` | A 390 px, la pestaña activa se trae a la vista con el scroll del propio control (no el de la página), para que "Growth" no deje "Conversaciones" fuera de pantalla. |
| I3-I6 | `feat:` | `InboxFiltersBar` se parte en `InboxFiltersMenu` (popover sobre `FilterMenu`, prop `filters`), `InboxFilterSummary` (línea de resumen debajo de la barra) e `InboxStatusBar` (pastillas de estado + "Borradores (N)", arriba de la lista, sin tocar). El estado de URL se comparte en `components/inbox/use-inbox-url.ts`. El contador del botón usa `countMenuFilters`. |
| I4 | `feat:` | `SectionSearch` (`components/comunicacion/section-search.tsx`) sube el buscador a la barra, compartido por las cuatro secciones. Placeholder por sección, decidido con Wendy: "Buscar por nombre" en Conversaciones (la búsqueda del servidor es solo por nombre, no por teléfono ni mensaje). |
| I4 | `feat:` | Broadcasts, Sequences y Growth no tenían buscador: se sumó filtrando en el cliente la lista que ya cargan entera (`lib/comunicacion/search.ts`, sin mayúsculas ni tildes), con su propio estado vacío (`NoSearchResults`). |
| I7 | `docs:` | Anotado en `docs/PENDIENTE.md`: no se construyó nueva conversación saliente (depende de la ventana de mensajería por canal, decisión de producto fuera de este documento). |

## Verificación

- `npx vitest run` después de cada paso, siempre en verde. Al cierre:
  **345 archivos, 4274 tests**, 0 en rojo, 0 saltados. Suma 41 tests nuevos
  sobre el punto de partida (caracterización del Realtime, `menu-keys`,
  `filter-summary`, `tab-href`, `comunicacion/search`).
- `npm run build`: compila sin errores en todo el recorrido.
- `npm run lint`: 0 errores. 38 warnings, todos preexistentes (ninguno en
  los archivos de este bloque).
- `node scripts/verify-inbox-filters.mjs`: todo verde contra la base real
  (RLS, scope de leads, los filtros combinados con AND). Limpió sus
  `zz-test-*` al terminar.
- Verificación visual en el navegador integrado, con Wendy con sesión
  iniciada. Se levantó un segundo servidor temporal en el puerto 3002
  (entrada `ssa-dev-bandeja` en `.claude/launch.json`, sacada al cerrar el
  bloque) para comparar la rama contra `main` en paralelo.

## Criterios de la sección 5 del documento

**I1 — Promover `FilterMenu`**
- ✅ La firma de `FilterMenu`, `MenuGroupLabel`, `MenuOption`, `ColorDot` y
  `Avatar` no cambió.
- ✅ El dashboard de Chat sigue funcionando igual: capturas antes/después
  idénticas en estructura (`docs/shots/chat-antes-*.jpg` vs.
  `chat-despues-*.jpg`), y se probó en vivo que sus menús (sin campos)
  recorren con flechas y cierran con Esc devolviendo el foco, igual que
  antes del Bloque I.
- ✅ Ningún import apunta a la ruta vieja (`grep` en el repo entero, 0
  resultados fuera de `docs/`).

**I2 — Las pestañas suben a la barra**
- ✅ Las pestañas están dentro de la barra de 56 px en las cuatro pantallas.
- ✅ A 390 px no hay scroll horizontal de página (`docScrollW === 390` en
  las cuatro); las pestañas scrollean internamente, y la activa se trae a
  la vista.
- ✅ `aria-current="page"` sigue marcando la sección activa.
- ✅ Las cuatro rutas funcionan y `(comunicacion)/layout.tsx` sigue sin
  dibujar pestañas.

**I3 — El popover de filtros**
- ✅ Clic afuera cierra el popover.
- ✅ Esc cierra y devuelve el foco al botón (probado en vivo).
- ✅ Flechas, Home y End navegan sus opciones.
- ✅ El contador muestra solo lo que hay adentro del popover (probado con
  3 filtros + búsqueda + estado "Todas" puestos: el botón dijo 3).
- ✅ Un link con filtros en la URL los refleja al abrir el popover (probado
  en vivo con `?tag=...&error-agente=1&canal=instagram&estado=all&q=ana`).
- ✅ El popover no empuja el contenido: es `position: fixed`/`absolute`
  sobre la lista.

**I4 — El buscador sube a la barra**
- ✅ Enter actualiza `?q=`.
- ✅ Hay una `×` que limpia solo la búsqueda.
- ✅ La búsqueda del servidor sigue siendo por `contacts.display_name` con
  `ilike`, y la del cliente sigue usando `matchesInboxRow`. No se tocó la
  semántica.
- ✅ Placeholder por sección, según lo decidido: "Buscar por nombre",
  "Buscar un broadcast", "Buscar una secuencia", "Buscar una herramienta".

**I5 — El filtro es exclusivo de Conversaciones**
- ✅ El botón de filtros no aparece en Broadcasts, Sequences ni Growth
  (verificado en vivo a 390 px: `filterBtn: false` en las tres).
- ✅ Volver a Conversaciones conserva los filtros que tenía la URL.

**I6 — La columna de conversaciones**
- ✅ Las pastillas de estado (`Todas`/`Abiertas`/`Cerradas`/`Pospuestas`)
  quedan fuera del popover, arriba de la lista.
- ✅ El link `Borradores (N)` se conserva donde estaba.
- ✅ El Realtime es idéntico: test de caracterización en verde durante todo
  el bloque.

**I7 — Nueva conversación**
- ✅ No se agregó ningún botón.
- ✅ Anotado en `docs/PENDIENTE.md` con su razón.

## Hallazgos de la exploración (en `docs/PENDIENTE.md`)

- Un link del dashboard de Chat manda `?estado=abiertas` (valor inválido;
  cae a "open" de casualidad).
- Comentario desactualizado en `scripts/verify-inbox-filters.mjs` (apunta a
  la ruta vieja sin el route group).
- Por qué el placeholder de Conversaciones dice "Buscar por nombre" y no lo
  que proponía el documento.

## Capturas

En `docs/shots/`: `bandeja-general-1440.jpg`, `bandeja-popover-1440.jpg`,
`bandeja-popover-390.jpg`, `bandeja-resumen-390.jpg`, `broadcasts-390.jpg`,
`sequences-390.jpg`, `growth-390.jpg`, `chat-antes-{1440,390}.jpg`,
`chat-despues-{1440,390}.jpg`.

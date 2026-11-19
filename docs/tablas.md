# Tablas del sistema: un solo componente

Toda tabla con columnas se arma con `DataTable` (`components/ui/data-table/`). Da, sin programar nada en cada pantalla:

- **Columnas**: prender y apagar, reordenar (flechas y arrastre), **fijar a la izquierda** y **ancho ajustable** (arrastrar el borde del título; doble clic = ancho normal).
- **Totales** al pie de las columnas con plata o cantidades, calculados sobre **todo el filtro** (no solo la página).
- **Vistas guardadas**: cada persona guarda cómo mira una tabla (columnas y filtros), con varias vistas y una predeterminada. Owner y Admin pueden compartirlas con todo el equipo o con personas elegidas, y dejarlas como predeterminada de otras personas.

Estrenado en **Ventas** (`/dashboard/ventas`) y **Pagos** (`/dashboard/ventas/pagos`); desde el 19/11/2026 también la usan **Contactos, Agenda (lista), Llamadas, Respuestas de formularios, Comisiones, Gastos y Servicios** (con el menú «Columnas» y lo elegido en el navegador de cada persona, sin vistas guardadas todavía). Las demás tablas se migran por tandas: la lista de las que faltan está en `lib/ui/data-table/no-raw-table.test.ts` (`LEGACY`). Ese test falla si alguien arma una tabla nueva con `<table>` a mano.

## Cómo armar una tabla nueva (5 pasos)

1. **Catálogo de columnas** (`lib/<modulo>/columns.ts`, puro): un `ColumnMeta` por columna (`key`, `label`, `defaultVisible`, `defaultWidth`, `hideable`, `pinnable`, `resizable`). El orden del catálogo es el orden normal. Una columna que no tiene que poder ocultarse (la que identifica la fila) lleva `hideable: false`; la de acciones, además, `pinnable: false` y `resizable: false`.
2. **Dibujo de las celdas** (en el componente de la pantalla): `DataColumn<Row>` = el meta + `render(row)` (+ `align: "right"` para números y `cellClassName`).
3. **Estado**: `useTablePrefs(tableKey, viewActivaOBase, columnas, columnasGuardadasDeLaVista)`. Lo comparten la tabla, el menú de columnas y el de vistas.
4. **Barra superior**: `<ViewsMenu …/>` y `<ColumnsMenu state={state}/>` junto a Buscar y Filtros (todo control va en la barra, nunca adentro de la página).
5. **Totales**: calcularlos en el servidor sobre todo el filtro (`fetchAllPages`, `lib/shared/paginate.ts`, porque PostgREST corta cada respuesta en 1.000 filas) con `sumMoney` / `sumCount` (`lib/ui/data-table/totals.ts`), y pasarlos a `DataTable` como `totals={{ amount: "…" }}`. Un dato que no existe es «—», nunca 0.

**Ordenar (opcional).** Una columna con `sortable: true` se ordena con un clic en el título solo si la tabla recibe `sort` y `onSortChange`; sin eso, el título es el de siempre. La tabla no ordena: la pantalla decide (en la consulta, con la página entera) y guarda el orden en la URL. `nextSort` y `ariaSort` en `lib/ui/data-table/sort.ts`. Ejemplo: Ventas.

En el servidor, la página llama a `loadTableViews(ctx, tableKey, searchParams)` y, si la URL llegó pelada, parsea sus filtros con `resolved.inheritedFilters` (los de la vista predeterminada). Todo link de la pantalla preserva `?vista=` (`withViewParam`).

## Lo que se le sumó para las pantallas grandes (19/11/2026)

- **`rowClassName(row)`**: clases de una fila (atenuar una anulada, marcar la elegida).
- **`wrap` en una columna**: el contenido puede ocupar varias líneas (nombre con insignias, etiquetas). Sin `wrap`, una línea con «…».
- **`groups`**: filas agrupadas con su título (y un dato a la derecha, por ejemplo el subtotal) adentro de la misma tabla, en vez de una tabla por grupo. Los grupos vacíos no se dibujan.
- **`defaultPinned` en `ColumnMeta`** + **`basePrefsFor(metas)`** como base de `useTablePrefs`: la columna arranca fija (el contacto en Agenda y Respuestas) y la persona la puede soltar.
- **`selection.isSelectable` / `disabledReason`**: filas que no se pueden elegir (Comisiones); la casilla del encabezado no las cuenta.
- **Columnas de atribución** (UTM, Meta, último click): `attributionColumnMetas` (`lib/attribution/table-columns.ts`) y la celda `ColumnCellContent`.
- **Una clave por tipo de tabla**, aunque cambien las columnas (por ejemplo `form_responses` para todos los formularios): la regla de `table_key` no admite un id, y las columnas que no existen en esa pantalla se ignoran al leer.

## Clic en la fila y editar en la tabla (18/11/2026)

- **La fila entera abre el registro**, no solo la primera columna. En `DataTable`: `rowHref={(row) => "/ruta"}` (o `onRowClick` para abrir un diálogo; `beforeRowNavigate` para recordar la fila que abre un modal por URL). En una tabla a mano: `<ClickableTr href=… | onOpen=…>` en vez de `<tr>`; para una fila o tarjeta que no es de tabla, `<ClickableBox>`. Todo sale de `useRowOpen` (`components/ui/clickable-row.tsx`) y la regla pura `rowClickIntent` (`lib/ui/row-click.ts`).
- **Qué no abre la fila**: lo que es un control adentro (links a otra cosa, botones, casillas, selects, menús; `ROW_INTERACTIVE_SELECTOR`), seleccionar texto y los clics que vienen de un portal. **Cmd/Ctrl/Shift + clic o el botón del medio** abren `href` en otra pestaña. Con el teclado, Tab llega a la fila y Enter la abre.
- **El contacto nunca es un link en una tabla**: es texto. Donde la fila ES la persona (Contactos, Clientes, Inscriptos de una secuencia, Afiliados), la ficha es el destino de la fila. `lib/ui/no-contact-link-in-tables.test.ts` lo controla.
- **Editar en la tabla**: `InlineSelect` (`components/ui/inline-select.tsx`) sobre `PortalMenu`. Recibe `display` (el chip de siempre), `options`, `canEdit` (sin permiso, solo el valor) y `onSelect` (la acción del servidor; refresca al terminar y muestra el motivo si falla). Una opción con `onPick` no guarda: abre lo que pide más datos (el cobro de un pago, el motivo de incobrable, la confirmación de pausar).
- **Hoy se editan en la tabla**: Contactos (estado del setter y del vendedor, setter, vendedor y calificación), el estado de un pago (cada opción abre su diálogo; regla pura `paymentStatusMenu`), variantes (activa/archivada), webhooks y gastos recurrentes (activo/pausado), respuestas de formularios (spam). Agenda ya tenía su Estado y Tareas edita cada celda.
- **No se ofrece un desplegable** para un estado que calcula el sistema (venta, cola de envíos, ejecuciones) ni para uno que pide un dato que el desplegable no tiene (fase de un servicio, pagar un gasto).

## Cómo funcionan las vistas

- **Qué guarda una vista**: `{ v: 1, columns: { order, hidden, shown, pinned, widths }, filters }`. Las columnas se guardan como **diferencia con lo normal**: una columna nueva aparece sola. Los filtros son el texto de la URL, sin la página ni la búsqueda.
- **Cuál manda** (`resolveActiveView`, `lib/ui/data-table/views.ts`): `?vista=base` es la del sistema; `?vista=<id>` esa vista (sus filtros solo se aplican al **elegirla**, desde el menú); sin `?vista=`, la predeterminada de la persona (con sus filtros solo si la URL llegó sin nada).
- **Cambios sin guardar**: lo que la persona ajusta (columnas, anchos) se ve y se recuerda en su navegador (`localStorage`, `ssa:table:<tabla>:<vista>`); el menú de vistas muestra «Hay cambios sin guardar» con Guardar / Guardar como nueva / Descartar. Guardar lo lleva a la base.
- **Quién puede qué** (lo decide la base, migración `00360`): cada persona crea y borra las suyas (privadas); compartir y dejar una vista como predeterminada de otra persona es de **Owner y Admin** (por su rol, sin clave nueva en el catálogo). Una vista compartida la edita su dueña o un Owner/Admin; el resto puede guardar una copia propia. Un Admin **no** ve las privadas de otra persona.
- **Tablas**: `table_views`, `table_view_members` (a quién se le muestra una vista «personas elegidas») y `table_view_defaults` (una predeterminada por persona y tabla, con quién se la dejó). La app **solo lee**; escriben `save_table_view`, `delete_table_view` y `set_table_view_default` (SECURITY DEFINER, miran `auth.uid()` y el rol).

## Cosas que no hay que romper

- `table_key` es texto libre acotado (`^[a-z][a-z0-9_]{1,40}$`): sumar una tabla nueva no pide migración.
- Una vista guarda claves de columnas; una columna que ya no existe se ignora al leer (`normalizePrefs`). Nunca renombrar la `key` de una columna: se pierde lo guardado.
- `localStorage` siempre en `try/catch` (el hook tiene respaldo en memoria).
- En un archivo `"use server"` todo lo exportado es una función asíncrona (`lib/actions/table-views.ts`).
- La plata va en céntimos y siempre bruta en los totales; no mezclar comisión o neto en un total sin decirlo.

## Verificación

```
node scripts/verify-table-views.mjs   # RLS, quién comparte, predeterminadas (una por persona, 10 a la vez), aislamiento entre negocios
```

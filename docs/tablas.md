# Tablas del sistema: un solo componente

Toda tabla con columnas se arma con `DataTable` (`components/ui/data-table/`). Da, sin programar nada en cada pantalla:

- **Columnas**: prender y apagar, reordenar (flechas y arrastre), **fijar a la izquierda** y **ancho ajustable** (arrastrar el borde del título; doble clic = ancho normal).
- **Totales** al pie de las columnas con plata o cantidades, calculados sobre **todo el filtro** (no solo la página).
- **Vistas guardadas**: cada persona guarda cómo mira una tabla (columnas y filtros), con varias vistas y una predeterminada. Owner y Admin pueden compartirlas con todo el equipo o con personas elegidas, y dejarlas como predeterminada de otras personas.

Estrenado en **Ventas** (`/dashboard/ventas`) y **Pagos** (`/dashboard/ventas/pagos`). Las demás tablas se migran por tandas: la lista de las que faltan está en `lib/ui/data-table/no-raw-table.test.ts` (`LEGACY`). Ese test falla si alguien arma una tabla nueva con `<table>` a mano.

## Cómo armar una tabla nueva (5 pasos)

1. **Catálogo de columnas** (`lib/<modulo>/columns.ts`, puro): un `ColumnMeta` por columna (`key`, `label`, `defaultVisible`, `defaultWidth`, `hideable`, `pinnable`, `resizable`). El orden del catálogo es el orden normal. Una columna que no tiene que poder ocultarse (la que identifica la fila) lleva `hideable: false`; la de acciones, además, `pinnable: false` y `resizable: false`.
2. **Dibujo de las celdas** (en el componente de la pantalla): `DataColumn<Row>` = el meta + `render(row)` (+ `align: "right"` para números y `cellClassName`).
3. **Estado**: `useTablePrefs(tableKey, viewActivaOBase, columnas, columnasGuardadasDeLaVista)`. Lo comparten la tabla, el menú de columnas y el de vistas.
4. **Barra superior**: `<ViewsMenu …/>` y `<ColumnsMenu state={state}/>` junto a Buscar y Filtros (todo control va en la barra, nunca adentro de la página).
5. **Totales**: calcularlos en el servidor sobre todo el filtro (`fetchAllPages`, `lib/shared/paginate.ts`, porque PostgREST corta cada respuesta en 1.000 filas) con `sumMoney` / `sumCount` (`lib/ui/data-table/totals.ts`), y pasarlos a `DataTable` como `totals={{ amount: "…" }}`. Un dato que no existe es «—», nunca 0.

En el servidor, la página llama a `loadTableViews(ctx, tableKey, searchParams)` y, si la URL llegó pelada, parsea sus filtros con `resolved.inheritedFilters` (los de la vista predeterminada). Todo link de la pantalla preserva `?vista=` (`withViewParam`).

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

# PENDIENTE — Diseñador IA

Formato: **qué quedó** · **por qué** · **qué se decidió**. El avance está en [PROGRESS-designer.md](PROGRESS-designer.md).

## Decisiones tomadas al planificar (7/11/2026)

### El link público no lleva pie
- **Qué quedó:** el plano (F43, §11.7) pide el pie "Hecho con SSA BAIOS" en `/d/<código>`. No se muestra ningún "Hecho con…".
- **Por qué:** la regla de white label del `CLAUDE.md` dice que la marca va por variables de entorno, nunca escrita en el código. En el clon de un cliente diría "SSA BAIOS".
- **Qué se decidió:** Wendy eligió "sin pie". Si algún día se quiere, se arma con la marca de la instalación (`lib/brand.ts`), no con un nombre fijo.

### Una red con la publicación fallida avisa en vez de actualizarse sola
- **Qué quedó:** F64 enumera los estados de cada red; el código tiene además `fail` (la publicación programada falló).
- **Por qué:** una publicación que falló estaba programada y alguien la va a reintentar. Cambiarle los archivos solos puede reintentar con otra pieza sin que nadie lo note.
- **Qué se decidió:** `fail` se trata como `sched`: muestra el aviso "El diseño cambió · Actualizar los archivos / Dejar como está". Es la opción conservadora.

### En el gráfico de Costos, el Diseñador IA cae en "Otros (sistema)"
- **Qué quedó:** `SOURCE_COLORS` (`lib/agent/ai-dashboard/source-palette.ts`) tiene 8 series fijas. `designer` no tiene color propio.
- **Por qué:** sumar una serie pide otra variable CSS `--src-*` en los dos temas, y el plano solo pide que Costos lo muestre.
- **Qué se decidió:** en la tabla de Costos sale con su nombre ("Diseñador IA"); en el gráfico entra en "Otros (sistema)". Si se quiere separado, es sumar una serie.

### El prototipo no se pudo recorrer con clics
- **Qué quedó:** el recorrido interactivo del prototipo del paso 0.
- **Por qué:** Chrome respondió "extension disconnected" y el navegador de la app solo muestra un archivo local como imagen estática.
- **Qué se decidió:** se leyó entero como texto (estructura, textos, orden e interacciones del HTML), como estaba previsto. La comparación visual se hace contra las capturas de la app en cada revisión; si Chrome vuelve a conectarse, se recorre en la revisión de la Ola 2.

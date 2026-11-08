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

## Ola 1 (7/11/2026)

### La 00318 la tomó otra sesión: el Diseñador IA usa 00319 a 00322
- **Qué quedó:** D1 = 00319, D2 = 00320, D3 = 00321 (el plan decía 00318–00320), más la 00322 que corrige la 00320.
- **Por qué:** a las 21:54 UTC otra sesión (vincular anuncios sin id) registró la `00318_meta_match_rules_similar`. La 00322: el trigger del documento leía `NEW.format` en `design_versions` (no tiene esa columna) y ninguna versión se podía guardar; lo detectó `verify-permissions-matrix` antes de que el código nuevo se usara en producción.
- **Qué se decidió:** se corrió la numeración y se corrigió con una migración nueva (la 00320 ya estaba aplicada). **La próxima libre es la 00323.**

### La imagen Docker del servicio de render no se probó
- **Qué quedó:** `render/Dockerfile` (Playwright 1.65.0, `mcr.microsoft.com/playwright:v1.65.0-noble`) sin construir.
- **Por qué:** en esta máquina no hay Docker. El servidor sí se probó con un Chromium real (Playwright en una carpeta temporal) y con 57 tests con navegador simulado.
- **Qué se decidió:** se prueba en el primer despliegue en Railway (paso a paso en `docs/designer/puesta-en-marcha.md`). Los flags `--no-sandbox --disable-dev-shm-usage` son los de un contenedor sin sandbox; confirmarlos ahí.

### La limpieza diaria todavía puede encolar un trabajo que no borra nada
- **Qué quedó:** si la versión vieja de una pieza es la última PUBLICADA y hay otra más nueva sin publicar, `enqueue_design_cleanup` la cuenta como candidata pero `cleanupPlan` la conserva.
- **Por qué:** afinarlo en SQL repite la regla de `cleanupPlan`; el costo es un job diario chico que no hace nada.
- **Qué se decidió:** se deja así; si molesta, otra migración.

### `verify-designer --bloque ds0` llama a la limpieza sobre toda la base
- **Qué quedó:** el bloque prueba `private.enqueue_design_cleanup(now())`, que mira todos los negocios.
- **Por qué:** la función no recibe un negocio.
- **Qué se decidió:** hoy no hay datos del Diseñador IA en producción, así que no encola nada real. Cuando los haya, cada corrida puede encolar limpiezas reales (que solo borran lo que ya correspondía borrar).

### Para los bloques que siguen (notas del auditor)
- `design.code` solo se ofrece en plantillas con verificación (`variableGroups`); DS6 confirma si hace falta en las que no verifican.
- `custom_vars` no se valida en SQL (forma de la clave y unicidad): lo validan las acciones de DS2 y DS6.
- `design_public_get` devuelve una generación con verificación en cualquier estado: DS5 muestra solo `ready` o `void` (y "Se está preparando" en los demás).
- La limpieza lista hasta 2000 carpetas de diseños por negocio.

## Ola 2 (7/11/2026)

### Las cargas de HTML abandonadas no se limpian todavía
- **Qué quedó:** `design-assets/<ws>/imports/<id>/` de un archivo que se revisó y nunca se cargó (o de un diseño borrado) queda en el bucket.
- **Por qué:** la limpieza diaria solo se encola cuando hay versiones o exportaciones viejas (`enqueue_design_cleanup`, 00320/00322), y saber si una carga está en uso pide mirar el documento de todos los diseños, plantillas y versiones.
- **Qué se decidió:** se deja para una migración propia (otro criterio de encolado + una función pura con su test). No ocupa lugar visible ni expone nada: el bucket es privado.

### El tope del cuerpo de las Server Actions pasó a 51 MB
- **Qué quedó:** `experimental.serverActions.bodySizeLimit = "51mb"` en `next.config.ts` (antes regía 1 MB).
- **Por qué:** cargar un .zip de 50 MB (F39) y subir una imagen de 20 MB (F22) son Server Actions; con 1 MB no llegaban.
- **Qué se decidió:** el tope es de toda la app (Next no permite uno por acción). Cada acción vuelve a validar el tamaño y los bytes antes de usar el archivo. Si algún día molesta, la alternativa es una ruta propia que lea el cuerpo con tope y sesión primero (como `readBytesCapped`).

### Exportar puede tardar hasta un minuto más
- **Qué quedó:** `requestExport` solo encola el job (como pide el plano) y la cola corre cada minuto.
- **Por qué:** disparar el render también en `after()` podría renderizar dos veces.
- **Qué se decidió:** la pantalla muestra «Preparando tu archivo…» y descarga sola al terminar. Si molesta, se suma un disparo inmediato con un reclamo del job.

### Un archivo borrado se sigue pudiendo bajar ~1 minuto
- **Qué quedó:** al volver a renderizar (F48b) se borran los archivos del juego anterior, pero el almacenamiento de Supabase los sigue sirviendo desde su caché hasta ~1 minuto (comprobado el 7/11/2026 con un archivo de prueba: devuelve a los 0, 3 y 15 s y falla a los 45 s).
- **Por qué:** es la caché del proveedor; la tabla de objetos ya no los tiene.
- **Qué se decidió:** nada que cambiar: el link público y la descarga leen el juego VIGENTE (`designs.renders`), nunca una ruta vieja. `verify-ds5` comprueba el borrado en `storage.objects`, no con una descarga. La 00324 también: el bucket no aceptaba el `error.json`, ahora sí.

### Revisión visual de la Ola 2: el editor y el link público con datos quedan para hacerlos con vos
- **Qué quedó:** se revisó con el navegador de la app (sesión iniciada, base real), sin crear nada: la lista vacía, el modal «Nuevo» (los 3 pasos y el paso «Archivo» de cargar HTML), Ajustes y el 404 del link público, a 1440 y a 390 px, en claro y en oscuro (el tema real, emulando el sistema). Se arregló el título de la lista, que se truncaba en escritorio. A 390 px no hay desplazamiento horizontal (ancho del documento 375).
- **Por qué no más:** para ver el editor, Generaciones o un link publicado hay que crear un diseño, y el servidor de desarrollo escribe en la base REAL del negocio.
- **Qué se decidió:** no crear nada en el negocio sin tu OK. Con tu OK, se crea uno llamado «zz-test revisión» y se borra al terminar; o se revisa en un clon de prueba. El aviso «Encountered a script tag…» de la consola aparece igual en `/f/` y viene del layout general, no del Diseñador.

## Auditoría de la Ola 2 (8/11/2026 UTC)

### Editar un diseño publicado ya no cambia el link: hay que «Publicar cambios»
- **Qué quedó:** guardar (a mano, al restaurar o por la IA) ya no vuelve a armar los archivos del link; el editor marca «Hay cambios sin publicar» y el menú ofrece «Publicar cambios». La página web pública muestra la última versión publicada (00325).
- **Por qué:** el plano dice que se re-renderiza al publicar o exportar (F48b), y un Member (con `designer.edit` y sin `designer.publish`) cambiaba lo que ve el público con solo guardar. Lo marcó el auditor.
- **Qué se decidió:** publicar es la única puerta al link público. `verify-ds5` lo prueba con una web (lo editado no se ve hasta «Publicar cambios»).

### «Permitir descargar» de una plantilla pide `designer.publish`
- **Qué quedó:** en una plantilla, «Permitir descargar» (lo heredan sus generaciones) se cambia con `designer.publish`, como dice §4.1; «Se puede verificar» y el tipo de documento siguen con `designer.edit`.
- **Por qué:** el plano pone «permitir descarga» en `designer.publish`; para plantillas era ambiguo.
- **Qué se decidió:** lo más estricto.

### Imágenes externas en un HTML cargado
- **Qué quedó:** la limpieza conserva `<img src="https://…">` de otros sitios. En el link público de una web se cargan desde ese sitio; en una exportación salen vacías, porque el servicio de render solo sale a los hosts de `RENDER_ALLOWED_HOSTS`.
- **Por qué:** quitarlas rompería muchas landings hechas con imágenes de un CDN; bajarlas al importar es otro trabajo (y otro riesgo: pedidos a sitios ajenos desde el servidor).
- **Qué se decidió:** se dejan. Si molesta, al cargar se bajan con `safeFetch` (con tope) y pasan a `asset:`.

### La IA cambia los TEXTOS de un HTML cargado, no su CSS
- **Qué quedó:** F42 pide que la IA pueda editar «textos y estilos» de una página cargada. Se construyó la parte de textos (`updateText`, nodo por nodo, siempre como texto plano y limpio); los estilos (el CSS del archivo) no.
- **Por qué:** dejar que la IA reescriba CSS de un archivo ajeno abre otra puerta (CSS que oculta o tapa contenido, `url()` hacia afuera) y pide su propia limpieza y pruebas; los textos son el 90 % de los pedidos.
- **Qué se decidió:** solo textos. Para cambiar colores o tipografías de una página cargada: pedírselo a la IA en el archivo original y volver a cargarlo, o rearmarla con la IA desde cero. Si se construye, va con la misma limpieza de `css.ts` y un test de ataques.

## Ola 3 · DS8 (8/11/2026 UTC)

### Dos redes del mismo diseño comparten los PNG
- **Qué quedó:** los archivos de un diseño tienen id estable (`design-<id>-<n>`) y una sola copia en la biblioteca de la pieza. Si una red está publicada y otra se actualiza, el archivo de la biblioteca cambia aunque la red publicada no se toque.
- **Por qué:** es lo que pide F64 (ids que no cambian entre sincronizaciones).
- **Qué se decidió:** se deja. Lo programado o publicado en Zernio tiene su propia copia; lo que se ve publicado no cambia.

### Un diseño que no se puede renderizar muestra «Actualizando…» en la pieza
- **Qué quedó:** si el render falla del todo (por ejemplo, sin el servicio de render), el drawer de la pieza no muestra un estado de fallo; el job reintenta a 1, 5 y 15 minutos y se puede forzar con «Actualizar los archivos».
- **Por qué:** no hay un lugar en la pieza para el error de un diseño sin tocar más de Contenido.
- **Qué se decidió:** queda así en esta corrida.

### Historia con varias páginas, y carta/presentación solo como PDF de LinkedIn
- **Qué quedó:** una Historia con varias páginas arma todas, y Contenido avisa «Sobran archivos» (admite uno por historia) en vez de recortar en silencio. Los formatos carta y presentación solo ofrecen el «Carrusel PDF» de LinkedIn.
- **Por qué:** recortar sin avisar pierde trabajo; un PDF es un documento.
- **Qué se decidió:** se deja así.

## Ola 3 · DS6 y auditoría (8/11/2026 UTC)

### El selector «Contacto / <origen>» de emitir y de generar para varios
- **Qué quedó:** F50 y F51 piden elegir entre «Contacto» y un origen que registre otro módulo (Servicios). El servidor ya acepta y valida `subjectRef` (solo de orígenes registrados, `validSubjectRef`), pero los modales solo buscan contactos.
- **Por qué:** en esta corrida ningún módulo registra un origen (`registerDesignVariables` queda vacío salvo en su test), así que el selector no tendría qué listar.
- **Qué se decidió:** lo construye Servicios cuando registre su origen: dibujar el selector cuando `registeredSubjectSources()` no esté vacío.

### Detalles de las generaciones que quedan así
- **Dos emisiones al mismo tiempo para la misma persona** pueden dejar dos piezas válidas: la regla «una válida por persona» la aplica la acción (como dice el plano), no la base. El modal frena el doble clic.
- **Mandar por email con «Publicar con link» apagado** en una plantilla que no verifica deja un `{{design.link}}` que lleva a un 404. El modal arranca con «Publicar con link» prendido.
- **«Reintentar las fallidas (N)»** cuenta también las que fallaron por falta de un dato; esas no se reintentan en tanda (piden el dato una por una) y el resultado lo dice.
- **«Anular»** aparece solo en plantillas con verificación: anular es lo que hace «no válida» una pieza en su link de verificación.

### Carta vertical y presentación en Contenido: solo como PDF de LinkedIn (para confirmar)
- **Qué quedó:** el plano dice que los formatos que no van a redes (carta, A4, presentación, web) no ofrecen «Usar en contenido». DS8 dejó carta vertical y presentación solo para el «Carrusel PDF» de LinkedIn.
- **Por qué:** un PDF es un documento, y LinkedIn publica documentos.
- **Qué se decidió:** queda así hasta que lo confirmes; si preferís lo literal del plano, es sacarlos de `CONTENT_FORMATS` (`lib/designer/screens/toolbar.ts`) y de `content-map.ts`.

## Cierre (Ola 5): la plantilla de estudiantes

### La exportación común sale limpia; la de estudiantes necesita la sincronización de BAIOS
- **Qué quedó:** `node scripts/export-template.mjs` sale limpio (4.507 archivos, sin restos identificables) y `npx vitest run scripts/plantilla` da 82/82. Con `--perfil=estudiantes`, `tsc`, `eslint`, `build` y «nombres» pasan, pero fallan tres controles:
  - **vitest**: 5 archivos. 3 son del Diseñador IA y se deben a que la base de la plantilla (`plantilla-estudiantes/supabase/migrations`, un archivo por área) todavía no tiene sus tablas, sus claves del Member ni el `designer` en el CHECK de `agent_runs`: `member-sql-parity`, `run-labels` y `lib/designer/public/model.test.ts` (lee `00320_designer_tables.sql`, que la plantilla no lleva). Los otros 2 (`lib/dashboards/chat/core-migration.test.ts`, que lee la `00305`, y `lib/actions/piece-link-destinations.test.ts`) vienen de `main`.
  - **historia**: 9 comentarios nombran un módulo que no viaja; 7 son del Diseñador IA (`ai/retry.ts`, `permission-members.ts`, `ai/action-types.ts`, `contracts.ts`, `automation/flow-template.ts`, `lib/nav/items.test.ts`, `scripts/verify-designer/verify-ds7.ts`).
  - **textos**: 18 textos visibles nombran Formularios o Tareas; 14 son del Diseñador IA. Son el modal «Automatizar» y su borrador «Formulario enviado», la ayuda del panel del nodo, el «TAREA:» de las instrucciones de la IA y un falso positivo en la limpieza de HTML («formulario» = la etiqueta `<form>` de un archivo cargado).
- **Por qué:** la base de la plantilla se regenera desde una base de referencia local (`scripts/plantilla/build-reference.mjs` + `generate-migrations.mjs`, con Supabase local en Docker), y esta máquina no tiene Docker. Es el paso de la sincronización de BAIOS después del merge, como en las sincronizaciones anteriores («la plantilla de estudiantes suma lo nuevo: base, marcas, controles y textos»).
- **Qué se decidió:** en la sincronización se resuelve:
  1. sumar el área «Diseñador IA» en `scripts/plantilla/areas.mjs` y regenerar las migraciones;
  2. marcar con `@plantilla-quitar(formularios)` lo que depende de Formularios: «Automatizar» (modal, acción, botón) arma un flujo «Formulario enviado», que la plantilla no tiene;
  3. reescribir esos comentarios y textos;
  4. hacer que `public/model.test.ts` lea la definición desde la base de la plantilla, o marcarlo.

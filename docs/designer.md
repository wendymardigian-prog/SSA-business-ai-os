# Diseñador IA

Diseñar piezas visuales con IA o a mano: carruseles, historias, presentaciones, PDF, certificados y páginas web. Se publican con un link (`/d/<código>`) o se exportan; las **plantillas** generan piezas solas (a mano, para varios o desde una automatización) y todo se conecta con Contenido.

En el código el módulo se llama `designer` / `design_*` y vive en `/dashboard/disenos`; en todo lo que ve una persona se llama **Diseñador IA**.

- Plano: `claude/v12/disenador-ia/requerimientos-disenador-ia.md` (v1.4), en la carpeta principal del proyecto.
- Avance, pruebas de cada F y auditorías: [PROGRESS-designer.md](PROGRESS-designer.md). Decisiones y lo que quedó afuera: [PENDIENTE-designer.md](PENDIENTE-designer.md).
- Contratos entre bloques: [designer/contratos.md](designer/contratos.md). Servicio de render en Railway: [designer/puesta-en-marcha.md](designer/puesta-en-marcha.md).

## Las piezas

| Qué | Dónde | Bloque |
|---|---|---|
| El documento (`DesignDoc`: posiciones en %, centro x,y; el orden del arreglo es el orden de las capas) y su render único `renderPageHTML` | `lib/designer/doc/schema.ts`, `lib/designer/render/page-html.ts` | DS1 |
| Lista, «Nuevo» (4 caminos), editor (lienzo, capas, variables, páginas, configuración) | `app/(dashboard)/dashboard/disenos/**`, `components/designer/**`, `lib/designer/screens/*` | DS2 |
| La IA diseñadora (conversación en `ai_threads`/`ai_messages`, estilos, revisión automática, costos) | `lib/designer/ai/*`, `lib/designer/jobs/ai-generate.ts`, `/dashboard/disenos/ajustes` | DS3 |
| Cargar un archivo HTML o un .zip (limpieza, detección, textos editables) | `lib/designer/import/*` | DS4 |
| Publicar, link público, descargar, exportar, anular | `app/d/[code]/**`, `lib/designer/public/*`, `lib/designer/publishing.ts`, `lib/designer/exporting.ts` | DS5 |
| Plantillas y generaciones (variables, emitir para uno o para varios, Generaciones) | `lib/designer/generate-core.ts`, `lib/designer/variables/*`, `components/designer/generate/*` | DS6 |
| El paso «Generar desde plantilla» y adjuntar el PDF en «Enviar email» | `lib/flow-engine/nodes/design-generate.ts`, `lib/designer/automation/*` | DS7 |
| Contenido (usar en contenido, diseñar desde la pieza, sincronizar archivos) | `lib/designer/content-*.ts`, `lib/designer/jobs/content-sync.ts` | DS8 |
| Servicio de render (Playwright, firmado con HMAC) | `render/` (servicio aparte en Railway) | R |

## Permisos (cambio aprobado M12)

`designer.view`, `designer.edit`, `designer.publish`, `designer.generate`, `designer.manage`, en las tres capas (página, acción y política). El **Member de sistema** tiene `designer.view` y `designer.edit` (M12): ve y edita diseños, pero no publica, no emite ni anula, y no toca los ajustes. Lo que el permiso no da se **oculta**: un Member ve el editor sin «Publicar», sin «Emitir» y sin «Permitir descargar» de una plantilla.

## Lo que no se puede romper

- **Un solo render.** El lienzo, la vista previa, el link público, la exportación y el PDF de una generación salen de `renderPageHTML`, que nunca produce `<script>` ni atributos `on*`. El HTML de una página cargada se muestra siempre en un iframe `srcdoc` con `sandbox` sin `allow-scripts`.
- **Todo documento que se guarda pasa por `sanitizeDocHtml`** (`lib/designer/import/edit.ts`): lo que escribe una persona, lo que escribe la IA y lo que se carga de un archivo.
- **Publicar es la única puerta al link público.** Guardar (a mano, por la IA o al restaurar) no cambia lo que ve el público. El link de una web muestra la última versión publicada (`design_public_get`, 00325), y los archivos de una pieza se arman con esa misma versión (`latestPublishedDoc` en el job de render). Si no se puede leer la última publicación, el render reagenda en vez de usar el borrador. El editor avisa «Hay cambios sin publicar».
- **Una generación es una copia congelada.** No se edita en el editor ni por la IA (`saveDocCore`, `restoreVersionCore`, `loadTarget` y `saveDocWithRev` la rechazan). Si hace falta otra, se vuelve a generar desde la plantilla.
- **El link público** (`/d/<código>`) sale SOLO de `design_public_get` (anon puede ejecutarla a propósito): nunca devuelve el negocio, emails, teléfonos ni ids de la persona. Sin pie «Hecho con…» (white label). Una generación se muestra solo `ready` (válida) o `void` (anulada, con motivo); las demás dicen «Se está preparando». Tope de 120 pedidos por minuto e IP, `noindex` salvo una web con «Permitir buscadores».
- **Todo link que ve alguien de afuera** (copiar link, descarga, Open Graph, `{{design.link}}` del email y de automatizaciones) se arma con `publicBaseUrl` / `loadDesignLinks` (el dominio del negocio). Nunca `appUrl()`, `NEXT_PUBLIC_APP_URL` ni el dominio del navegador.
- **La verificación** existe solo en plantillas de formato impreso (`carta_v`, `carta_h`, `a4_v`, `a4_h`), apagada por defecto y con tipo de documento (certificado, constancia, diploma u otro con nombre). Los textos («Emitir constancia», el recuadro del link) salen de `lib/designer/verification.ts`; los CHECK de la base y `validateTemplateVerification` dicen lo mismo (`verification.cases.json`).
- **Un archivo de afuera se valida por sus bytes**: imágenes PNG, JPG o WebP (un SVG se rechaza), fuentes por su firma (`sniffFont`), zips sin `..`, sin enlaces simbólicos, hasta 300 archivos y 50 MB descomprimidos.
- **Un solo juego de archivos por diseño propio (F48b)**: volver a renderizar borra los anteriores; los archivos de una generación nunca se borran. La limpieza diaria (`design_cleanup`) borra versiones de más de 30 días (nunca la actual ni la última publicada) y exportaciones sueltas de más de 7.
- **No hay miniaturas renderizadas**: la lista, el historial y los selectores dibujan la página 1 en vivo con `renderPageHTML`. Guardar no encola ningún render.
- **Los jobs nunca lanzan por un proveedor** (render, IA): reagendan a 1, 5 y 15 minutos y dejan el error en la fila. Sin el servicio de render: «Falta conectar el servicio de render».
- **La IA**: lo que pide una persona viaja como DATO en el mensaje, nunca en las instrucciones fijas; con el tope de gasto alcanzado no se llama al proveedor; nunca más de 2 pasadas de corrección; sobre una página cargada cambia solo textos, nodo por nodo (no el CSS).
- **Las conversaciones** viven en `ai_threads` / `ai_messages` (genéricas de BAIOS, también para el tutor y el asistente), con RLS por canal: `designer` → `designer.view`; `assistant` → `user_id = auth.uid()` y miembro del negocio; `portal` → ninguna todavía.
- **Las variables usan las claves del catálogo de Automatizaciones** (`contact.first_name`, `contact.display_name`, `contact.email`, `contact.phone`, `workspace.name`): no se inventan otras `contact.*` ni `workspace.*`. `catalog.test.ts` falla si se separan de `lib/flow-engine/variable-catalog.ts`.
- **La IA nunca escribe directo en la base**: devuelve un documento o un parche que se valida con Zod (`ai/schema.ts`), se aplica sobre la versión en la que se pidió (`mergeAiPatch`), se limpia (`sanitizeAiDoc` + `sanitizeDocHtml`) y recién ahí se guarda con control de versión (`rev`).
- **La fusión de contactos** reapunta `designs.subject_contact_id` y `ai_threads.contact_id` por trigger (`contacts_designs_on_merge`); `merge_contacts` no se tocó.

## Variables

Tres orígenes (`lib/designer/variables/catalog.ts`):
1. **Del sistema**, con las claves de Automatizaciones (Contacto y Negocio) más las del Diseñador IA: `design.code` («Código de verificación»), `design.doc_type` («Tipo de documento», solo en plantillas que verifican), `design.issued_on` («Fecha de emisión», en la zona del negocio y con el formato de fecha de la plantilla) y `design.today`.
2. **Registradas por otros módulos** con `registerDesignVariables({group, label, source, vars, resolve})` (`lib/designer/extensions.ts`): el punto de extensión que va a usar Servicios (`service.*`). En esta corrida queda vacío (solo un test registra uno de prueba). `onDesignGenerated` avisa cuando una generación queda lista; hoy lo usa el propio módulo para mandar el email de la pieza.
3. **Propias de la plantilla** (`design_templates.custom_vars`): clave, nombre, valor de ejemplo y valor por defecto opcional. Se completan al generar, a mano o desde la automatización.

`resolveValues` aplica primero lo que se pasa, después el sujeto y después el valor por defecto; si falta un dato decide la política: «No generar y avisarme», «Usar el valor de la plantilla» o «Dejarlo vacío» (`variables/missing.cases.json`).

## Las reglas de la IA

Fijas en `lib/designer/ai/rules.ts` y en el prompt (con su test): una idea por página y un título por página; tamaño mínimo de letra y palabras por página según el formato (`FORMATS[fmt].minFontSize`, `wordsPerPage`); todo dentro de las zonas seguras; contraste 4,5:1 para texto y 3:1 para texto grande y elementos (`lib/designer/color.ts`); en carruseles, portada con gancho y cierre con llamado a la acción; sobre una foto, una capa de color que asegure la lectura (`overlayForContrast`). La revisión automática (`qa.ts`) mide el render y corrige con una pasada (nunca más de 2 en total).

## Datos

Tablas: `design_templates`, `designs` (diseños propios y generaciones; una generación tiene `template_id`), `design_versions`, `ai_threads`, `ai_messages`. Escribe solo el servidor (sin políticas de escritura para `authenticated`). Buckets privados `design-assets` (imágenes, fuentes, cargas) y `design-renders` (PNG, PDF, ZIP y el `error.json` de una exportación fallida). `workspaces.design_settings` guarda estilos propios y fuentes.

Migraciones: `00319` (ajustes, permisos del Member, buckets), `00320` (tablas, RLS, códigos, `design_public_get`, fusión, limpieza diaria), `00321` (CHECK de `agent_runs.source` con `designer`), `00322` (corrige el trigger del documento en versiones), `00324` (el bucket acepta `error.json`) y `00325` (el link de una web muestra lo publicado). Todas aplicadas y registradas. La `00318` y la `00323` son de otras sesiones.

## Jobs

`design_render` (publicar, exportar, una generación), `design_generate_many` (tandas de 10, hasta 500), `design_content_sync` (archivos de la pieza de Contenido, 30 s después de guardar), `design_ai_generate` y `design_cleanup` (cron diario por SQL directo). Se registran en `lib/jobs/handlers/designer.ts`.

## Verificación

```
node scripts/verify-designer.mjs                 # todos los bloques (ds0, ds2, ds5, ds6, ds7, ds8)
node scripts/verify-designer.mjs --bloque ds5    # uno solo
```

El render va siempre simulado (`DESIGNER_FAKE_RENDER=1`). Crea y limpia sus datos (prefijo `zz-test-`); se corre de a uno con el candado `/private/tmp/ssa-verify.lock`. También cubren el módulo `verify-rls`, `verify-permissions-matrix`, `verify-contact-merge`, `verify-content`, `verify-flow-runs` y `verify-flow-metrics`.

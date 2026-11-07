# Diseñador IA · Contratos entre bloques

Lo que cada bloque le pide a otro, fijado al cerrar la Ola 1. Los tipos viven en `lib/designer/contracts.ts`; las firmas de las Server Actions, en `lib/actions/designer/*`; los puntos de montaje, en `components/designer/*`.

**Regla:** un subagente construye SU lado del contrato y no cambia el contrato. Si necesita otra cosa (un campo, una acción nueva, un tipo), la pide en su informe y la suma la sesión principal al integrar.

## 1. Documento y render (sesión principal, listo)

| Qué | Dónde | Para qué |
|---|---|---|
| `DesignDoc`, `parseDesignDoc`, `newId`, `emptyDoc`, `docVariables`, `variablesIn` | `lib/designer/doc/schema.ts` | El formato único (§8.3). Posiciones en % de la página, centro del elemento; el orden del arreglo es el orden de capas. Gemela SQL: `public.validate_design_doc` (casos en `doc.cases.json`). |
| `FORMATS`, `FormatKey`, `PRINT_FORMATS`, `exportOptions`, `formatsForNew` | `lib/designer/formats.ts` | Medidas, zonas seguras, escala de exportación y tamaño mínimo de letra. |
| `renderPageHTML(doc, página, { mode, values, assetUrl, variableLabel, uploadedFonts, showHidden })` | `lib/designer/render/page-html.ts` | EL render: lienzo (miniaturas en vivo), link público y servicio de render. Nunca produce `<script>`. |
| `elementStyle`, `textInnerStyle`, `backgroundLayers`, `cssText`, `toReactStyle` | ídem | Las MISMAS funciones de estilo para el lienzo React (paridad probada en 10 elementos). |
| `snap`, `nudge`, `resizeWidth`, `resizeHeight`, `resizeFont`, `scaleBox`, `rotate`, `pointerAngle`, `alignSelection`, `intersects`, `screenToPct` | `lib/designer/canvas-math.ts` | Imanes, mover, tamaño y rotación. El lienzo NO calcula posiciones por su cuenta. |
| `CURATED_FONTS`, `fontGroups`, `googleCssUrl`, `sniffFont`, `checkFontUpload`, `uploadedFontFaces` | `lib/designer/fonts.ts` | Tipografías. |
| `contrastRatio`, `mixOverlay`, `overlayForContrast`, `colorChoices` | `lib/designer/color.ts` | Colores y contraste. |
| `FACTORY_STYLES`, `styleSchema`, `availableStyles`, `findStyle`, `wordsPerPage` | `lib/designer/styles.ts` | Los 6 estilos de fábrica; los propios tienen la misma forma. |
| `parseDesignSettings` | `lib/designer/settings-schema.ts` | `workspaces.design_settings` (gemela SQL `validate_design_settings`). |

## 2. Servicio de render (sesión principal + R, listo)

- `renderDesign(req)` en `lib/designer/render-client.ts`. Pedido: `{ html | pages, width, height, format: "png" | "pdf", scale, measure }`. Respuesta: `{ files: [{ page, contentType, bytes }], measure?, version }`.
- Sin `RENDER_SERVICE_URL` / `RENDER_SERVICE_SECRET` lanza `RenderNotConfigured` ("Falta conectar el servicio de render"). Una falla pasajera es `RenderFailed` con `retryable: true`.
- `DESIGNER_FAKE_RENDER=1`: archivos de 1×1 sin llamar a nadie (tests y `verify-designer`).
- Arranque en frío (Serverless): espera hasta 60 s y reintenta una vez ante un error de conexión o un 502/503/504.
- Firma: `X-Render-Signature: t=<s>,v1=<hex HMAC-SHA256 de "<t>.<cuerpo>">`, vence a los 60 s. `lib/designer/render-sign.ts` es copia letra por letra de `render/sign.mjs` (un test compara las dos).

## 3. Jobs y almacenamiento (sesión principal, listo salvo lo marcado)

| Job | Lo construye | Estado |
|---|---|---|
| `design_render` (`lib/designer/jobs/render.ts`, `runDesignRender`, `enqueueDesignRender`) | Sesión principal | Listo: `publish`, `generation`, `export` (pdf, zip, png); reintentos 1/5/15 min; `failed` al cuarto fallo. |
| `releasePreviousRenders` (`lib/designer/jobs/render-replace.ts`) | **DS5** (F48b) | Hoy no borra nada. DS5 borra el juego anterior de un diseño propio después de guardar el nuevo. |
| `design_generate_many` (`lib/designer/jobs/generate-many.ts`) | **DS6** | Registrado; por ahora solo avisa que no está construido. |
| `design_content_sync` (`lib/designer/jobs/content-sync.ts`) | **DS8** | Ídem. |
| `design_ai_generate` (`lib/designer/jobs/ai-generate.ts`) | **DS3** | Ídem. |
| `design_cleanup` (`lib/designer/jobs/cleanup.ts`, `cleanupPlan` en `lib/designer/cleanup.ts`) | Sesión principal | Listo, con el cron diario de la 00320. |

Los cinco están registrados en `lib/jobs/handlers/designer.ts` (llamado desde `registerPublishing`). Un bloque reemplaza el cuerpo de SU archivo `lib/designer/jobs/<x>.ts`; no toca el registro.

Storage (`lib/designer/storage.ts`): `checkImageUpload` (PNG, JPG o WebP por bytes; un SVG se rechaza con "Usá PNG o JPG"), `uploadDesignImage`, `signAssetUrls` (solo rutas del workspace), `assetUrlFrom`, `collectAssetPaths`, `imageAssetPath`, `fontAssetPath`, `importAssetPath`, `renderFolder`, `exportFolder`, `pageFileName`, y los buckets `design-assets` y `design-renders`.

## 4. Variables, verificación, links y conversaciones (sesión principal, listo)

- **Variables** (`lib/designer/variables/catalog.ts`): `variableGroups`, `variableInfo`, `sampleValues`, `customVarKey`, `formatDesignDate`; claves de Contacto y Negocio iguales a las de Automatizaciones, más `design.code`, `design.doc_type`, `design.issued_on` y `design.today`. DS6 suma `resolveValues` y la política si falta un dato (`./resolve.ts`, `./custom.ts`).
- **Extensiones** (`lib/designer/extensions.ts`): `registerDesignVariables`, `onDesignGenerated`, `emitDesignGenerated`, `resolveRegisteredValues`. Vacías en esta corrida.
- **Verificación** (`lib/designer/verification.ts`): solo en plantillas impresas, apagada por defecto, con tipo de documento. `canVerify`, `verifyAfterFormatChange`, `verificationText`, `verificationTitle`, `issueButtonLabel`, `alreadyValidNotice`, `docTypeVariable`, `verifyProposalText`, `validateTemplateVerification` (gemela de los CHECK de `design_templates`, casos en `verification.cases.json`).
- **Links públicos** (`lib/designer/public-links.ts`): `designLinksFor(workspace, code)` y `loadDesignLinks(db, ws, code)` con el dominio del negocio (`publicBaseUrl`). Un test de frontera falla si un archivo del Diseñador IA arma un link con el dominio del navegador o con la variable del dominio principal. Los componentes reciben la URL armada como prop.
- **Conversaciones** (`lib/ai-threads/*`): `getOrCreateDesignerThread`, `appendMessage`, `updateMessageResult`, `listMessages`; la forma de `context` y `result` por canal se valida en `schema.ts`.

## 5. Server Actions (firmas definitivas)

Cada acción valida su permiso adentro (`getPermissionAction`) y escribe con el cliente de servicio filtrando por el workspace de la sesión. Mientras no se construyen, responden `{ ok: false, error: "Todavía no está construido (Ola N)." }`.

| Archivo | Dueño | Acciones |
|---|---|---|
| `lib/actions/designer/designs.ts` | DS2 | `createDesign`, `saveDesignDoc` (→ `conflict` con una `rev` vieja), `renameDesign`, `duplicateDesign`, `archiveDesign`, `deleteDesign`, `listVersions`, `restoreVersion`, `uploadDesignImageAction`, `updateTemplateSettings` |
| `lib/actions/designer/ai.ts` | DS3 | `startAiDesign`, `sendAiMessage`, `loadConversation`, `proposeTemplateTexts`, `answerProposal`, `changeStyle` |
| `lib/actions/designer/settings.ts` | DS3 | `extractStyle`, `saveStyle`, `archiveStyle`, `addGoogleFont`, `uploadFont`, `removeFont` |
| `lib/actions/designer/import.ts` | DS4 | `inspectHtmlUpload`, `importHtml` |
| `lib/actions/designer/publish.ts` | DS5 | `publishDesign`, `unpublishDesign`, `setPublicOptions`, `requestExport`, `exportStatus`, `voidDesign` |
| `lib/actions/designer/generate.ts` | DS6 | `previewGeneration`, `generateOne`, `countGenerationAudience`, `generateMany`, `retryGeneration`, `retryFailedGenerations`, `regenerate`, `sendGenerationEmail` |
| `lib/actions/designer/content.ts` | DS8 | `useInContent`, `designFromPiece`, `syncToPiece`, `unlinkFromPiece` |
| `lib/actions/designer/automate.ts` | Sesión principal (Ola 4) | `createAutomationFromTemplate`, `automationsUsingTemplate` |

## 6. Puntos de montaje (componentes placeholder)

Cada uno es de UN bloque, que reemplaza el archivo. El editor (DS2) los importa y les pasa las props del contrato.

| Componente | Dueño | Props |
|---|---|---|
| `components/designer/ai/ai-panel.tsx` (`AiPanel`) | DS3 | `AiPanelProps` |
| `components/designer/import/html-step.tsx` (`HtmlStep`) | DS4 | `HtmlStepProps` |
| `components/designer/publish/publish-menu.tsx` (`PublishMenu`) | DS5 | `PublishMenuProps` |
| `components/designer/publish/export-menu.tsx` (`ExportMenu`) | DS5 | `ExportMenuProps` |
| `components/designer/generate/generate-one-modal.tsx`, `generate-many-modal.tsx` | DS6 | `GenerateModalProps` |
| `components/designer/generate/generations-tab.tsx` | DS6 | `GenerationsTabProps` |
| `components/designer/content/use-in-content.tsx` | DS8 | `UseInContentProps` |
| `components/designer/automate/automate-modal.tsx` | Sesión principal (Ola 4) | `AutomateModalProps` |

## 7. Pantallas y guards

- `lib/designer/guards.ts`: `requireDesigner(<clave>)` (sin el permiso, **404**) y `designerAbilities(ctx)`.
- Rutas: `/dashboard/disenos` (DS2), `/dashboard/disenos/d/[id]` (DS2), `/dashboard/disenos/t/[id]` (DS2; la pestaña Generaciones la monta DS2 con el componente de DS6), `/dashboard/disenos/ajustes` (DS3), `/d/[code]` y `/d/[code]/descargar` (DS5). Hoy tienen contenido mínimo con su guard.

## 8. Verificación

`scripts/verify-designer.mjs` corre `scripts/verify-designer/run.ts`, que importa `scripts/verify-designer/verify-<bloque>.ts` (ds0, ds2, ds5, ds6, ds7, ds8). Cada archivo es de un solo dueño; los subagentes los escriben pero **no los corren** (los corre la sesión principal, de a uno, con el candado). El render siempre va simulado.

# Auditoría de automatizaciones — avance (octubre 2026)

Rama `claude/automation-engine-audit-77122c`. Plan aprobado por Wendy el 22/10/2026.

## Decisiones de Wendy

1. Los cambios de una automatización publicada corren **recién al publicar** (borrador «Cambios sin publicar»).
2. **Un solo disparador** por automatización, obligatorio desde el arranque.
3. Los adjuntos del email son **siempre Recursos**, y se puede subir uno nuevo desde el editor del flujo.
4. Todo junto, por tandas, en un PR.

## Lo que se hizo

| Tanda | Qué | Commit |
|---|---|---|
| 1 | Bugs graves del motor (15 puntos) | `fix: motor de automatizaciones, bugs graves de la auditoria` |
| 2–4 | 00254, borrador, guardar por el servidor, lista con buscador/filtros/categorías/descripción, disparador primero, selector, paleta con buscador, catálogos | `feat: automatizaciones con borrador, lista con buscador y categorias, y el disparador primero` |
| 5 y 7 | Pasos de mensajes, IA y acciones; disparadores que respetan «no contactar»; todo en español | `fix: pasos de mensajes, IA y acciones…` |
| 6 | Adjuntos en «Enviar email» | `feat: adjuntos en 'Enviar email' desde Recursos` |
| 8 | Lo menor, documentación | este commit |

## Migración

`00254_flows_categories_drafts` (aditiva): **aplicada y registrada** el 23/10/2026 (versión `20261023130139`), antes de
desplegar el código. Columnas `flows.categories`, `draft_nodes`, `draft_edges`, `draft_updated_at`, CHECK de 10
categorías e índice GIN.

## Datos de producción al aplicar (solo lectura)

- 22 automatizaciones, **todas en borrador** (ninguna publicada): las reglas nuevas de publicar no frenan nada que esté
  corriendo.
- 0 automatizaciones con más de un disparador; 3 borradores sin disparador (al abrirlos, el lienzo les agrega uno sin
  elegir).

## Bugs encontrados que no estaban en la lista

- «Agregar etiqueta» armado en el lienzo **quitaba** la etiqueta (el paso miraba `data.action`, que el lienzo no guarda).
- Las tres plantillas de la pantalla Plantillas no funcionaban: el texto estaba en `data.text` (el paso lee
  `messages`), las palabras clave con otra forma, una condición sobre un campo que no existe y una variable inexistente.

## Verificación

- `npx vitest run`: todo en verde (más de 13.800 tests), con tests nuevos para cada bug de la Tanda 1, los catálogos, la
  lista, las categorías, el borrador, los adjuntos, las palabras clave, la inactividad, el email y las etiquetas.
- `npm run lint` sin errores.
- En el navegador (dev local contra la base real, sin guardar nada): la lista con filtros y en el celular, el selector de
  disparador que se abre solo, la paleta bloqueada y con buscador, tocar un paso para sumarlo, las variables de agenda en
  el email, Detalles con categorías, y la sección Adjuntos (elegir y el formulario de alta).

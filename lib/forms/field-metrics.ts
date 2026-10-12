/**
 * Métricas de un formulario cualquiera, armadas desde su ESQUEMA (F14).
 *
 * Portado de `src/lib/form-metrics.ts` de prevxcrm. El tipo de cada campo ya
 * está declarado en el formulario: un `number` es un número aunque todavía no lo
 * haya contestado nadie, y eso permite que un formulario nuevo tenga métricas
 * desde el primer día.
 *
 * Cambios para SSA: a esta función se le pasa la `key` de cada campo como `id`; los tipos son los de
 * `lib/forms/fields.ts` (el NPS y las estrellas se promedian; el consentimiento,
 * los archivos y los ocultos no se agregan). Los conteos por día (vistas,
 * inicios, envíos) NO salen de acá: los da `form_metrics_daily`.
 */

export type ClaseDeCampo = 'numero' | 'opcion' | 'texto' | 'ignorar';

export interface CampoDeFormulario {
  id: string;
  label?: string;
  type?: string;
  options?: Array<{ id?: string; label?: string } | string> | null;
}

export interface MetricaNumerica {
  id: string;
  label: string;
  respuestas: number;
  suma: number;
  promedio: number;
  minimo: number;
  maximo: number;
}

export interface MetricaDeOpcion {
  id: string;
  label: string;
  respuestas: number;
  opciones: Array<{ opcion: string; cantidad: number; porcentaje: number }>;
}

export interface MetricaDeTexto {
  id: string;
  label: string;
  respuestas: number;
  ultimas: string[];
}

export interface MetricasDelFormulario {
  numericas: MetricaNumerica[];
  opciones: MetricaDeOpcion[];
  textos: MetricaDeTexto[];
}

/**
 * Los que no son preguntas (un título, una línea divisoria) y los que no dicen
 * nada agregados: el teléfono de cada uno no es una métrica, es un dato de la
 * respuesta, y promediar fechas o archivos no significa nada.
 */
const NO_SON_PREGUNTA = new Set(['heading', 'paragraph', 'divider']);
const NO_SE_AGREGAN = new Set([
  'file', 'consent', 'hidden', 'date', 'email', 'phone', 'social',
]);

export function clasificarCampo(type: string | undefined): ClaseDeCampo {
  const t = String(type ?? '').trim();
  if (!t || NO_SON_PREGUNTA.has(t) || NO_SE_AGREGAN.has(t)) return 'ignorar';
  if (t === 'number' || t === 'rating' || t === 'nps') return 'numero';
  if (t === 'single_select' || t === 'multi_select') return 'opcion';
  if (t === 'short_text' || t === 'long_text') return 'texto';
  // Un tipo que no conocemos se ignora en vez de inventarle una agregación: es
  // preferible un tablero incompleto a uno que promedia cualquier cosa.
  return 'ignorar';
}

/** Sin respuesta: null, cadena vacía o lista vacía. Un 0 SÍ es una respuesta. */
function contesto(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

function comoNumero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Una respuesta de selección múltiple cuenta una vez por opción elegida. */
function comoOpciones(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.filter(contesto).map((v) => String(v));
  if (contesto(valor)) return [String(valor)];
  return [];
}

export function calcularMetricasDelFormulario(
  campos: CampoDeFormulario[],
  respuestas: Array<Record<string, unknown>>,
  opciones?: { ultimasTextos?: number },
): MetricasDelFormulario {
  const cuantosTextos = opciones?.ultimasTextos ?? 5;
  const salida: MetricasDelFormulario = { numericas: [], opciones: [], textos: [] };

  for (const campo of campos ?? []) {
    if (!campo?.id) continue;
    const clase = clasificarCampo(campo.type);
    if (clase === 'ignorar') continue;

    const etiqueta = campo.label?.trim() || campo.id;
    const valores = (respuestas ?? []).map((r) => r?.[campo.id]);

    if (clase === 'numero') {
      const numeros = valores.map(comoNumero).filter((n): n is number => n !== null);
      if (numeros.length === 0) {
        salida.numericas.push({ id: campo.id, label: etiqueta, respuestas: 0, suma: 0, promedio: 0, minimo: 0, maximo: 0 });
        continue;
      }
      const suma = numeros.reduce((a, b) => a + b, 0);
      salida.numericas.push({
        id: campo.id,
        label: etiqueta,
        respuestas: numeros.length,
        suma,
        // Se redondea a un decimal: un promedio con quince cifras en una tarjeta
        // no lo lee nadie.
        promedio: Math.round((suma / numeros.length) * 10) / 10,
        minimo: Math.min(...numeros),
        maximo: Math.max(...numeros),
      });
      continue;
    }

    if (clase === 'opcion') {
      const conteo = new Map<string, number>();
      let conRespuesta = 0;
      for (const valor of valores) {
        const elegidas = comoOpciones(valor);
        if (elegidas.length > 0) conRespuesta += 1;
        for (const op of elegidas) conteo.set(op, (conteo.get(op) ?? 0) + 1);
      }
      const total = [...conteo.values()].reduce((a, b) => a + b, 0);
      salida.opciones.push({
        id: campo.id,
        label: etiqueta,
        respuestas: conRespuesta,
        opciones: [...conteo.entries()]
          .map(([opcion, cantidad]) => ({
            opcion,
            cantidad,
            porcentaje: total > 0 ? Math.round((cantidad / total) * 1000) / 10 : 0,
          }))
          .sort((a, b) => b.cantidad - a.cantidad),
      });
      continue;
    }

    const textos = valores.filter(contesto).map((v) => String(v).trim());
    salida.textos.push({
      id: campo.id,
      label: etiqueta,
      respuestas: textos.length,
      // Las últimas primero: en un texto abierto lo que sirve es lo reciente.
      ultimas: textos.slice(-cuantosTextos).reverse(),
    });
  }

  return salida;
}

/**
 * Cuántas respuestas por día. Recibe fechas ya en el día correcto —quien llama
 * decide si es el día reportado o el de envío, que en el reporte diario no son
 * lo mismo— y devuelve la serie ordenada, sin huecos rellenados.
 */
export function respuestasPorDia(dias: Array<string | null | undefined>): Array<{ dia: string; cantidad: number }> {
  const conteo = new Map<string, number>();
  for (const d of dias ?? []) {
    if (!d) continue;
    const dia = String(d).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
    conteo.set(dia, (conteo.get(dia) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .map(([dia, cantidad]) => ({ dia, cantidad }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

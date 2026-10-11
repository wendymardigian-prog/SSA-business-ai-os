import { describe, it, expect } from 'vitest';
import {
  clasificarCampo,
  calcularMetricasDelFormulario,
  respuestasPorDia,
  type CampoDeFormulario,
} from './field-metrics';

// El esquema real del «Reporte diario — Reto X».
const CAMPOS_DEL_RETO: CampoDeFormulario[] = [
  { id: 'contactos_nuevos', label: 'Contactos nuevos que hiciste hoy', type: 'number' },
  { id: 'respuestas', label: 'Respuestas que recibiste', type: 'number' },
  { id: 'conversaciones', label: 'Conversaciones activas', type: 'number' },
  { id: 'agendadas', label: 'Llamadas o reuniones agendadas', type: 'number' },
  { id: 'tarea_del_dia', label: '¿Completaste la tarea del día?', type: 'single_select' },
  { id: 'freno', label: '¿Qué te frenó hoy?', type: 'long_text' },
];

describe('clasificarCampo', () => {
  it('número y calificación se promedian', () => {
    expect(clasificarCampo('number')).toBe('numero');
    expect(clasificarCampo('rating')).toBe('numero');
    expect(clasificarCampo('nps')).toBe('numero');
  });

  it('las selecciones se cuentan por opción', () => {
    expect(clasificarCampo('single_select')).toBe('opcion');
    expect(clasificarCampo('multi_select')).toBe('opcion');
  });

  it('los textos se muestran, no se agregan', () => {
    expect(clasificarCampo('short_text')).toBe('texto');
    expect(clasificarCampo('long_text')).toBe('texto');
  });

  it('lo que no es pregunta se ignora', () => {
    for (const t of ['heading', 'paragraph', 'divider']) {
      expect(clasificarCampo(t)).toBe('ignorar');
    }
  });

  it('lo que agregado no significa nada se ignora', () => {
    // El teléfono de cada uno es un dato de su respuesta, no una métrica; y
    // promediar archivos o fechas no quiere decir nada.
    for (const t of ['file', 'consent', 'hidden', 'date', 'email', 'phone']) {
      expect(clasificarCampo(t)).toBe('ignorar');
    }
  });

  it('un tipo desconocido se ignora en vez de inventarle agregación', () => {
    expect(clasificarCampo('tipo_que_no_existe')).toBe('ignorar');
    expect(clasificarCampo(undefined)).toBe('ignorar');
  });
});

describe('calcularMetricasDelFormulario', () => {
  const respuestas = [
    { contactos_nuevos: 20, respuestas: 6, conversaciones: 2, agendadas: 0, tarea_del_dia: 'Sí', freno: 'Miedo al primer contacto' },
    { contactos_nuevos: 10, respuestas: 2, conversaciones: 1, agendadas: 1, tarea_del_dia: 'No', freno: 'Sin tiempo' },
    { contactos_nuevos: 30, respuestas: 4, conversaciones: 3, agendadas: 2, tarea_del_dia: 'Sí', freno: '' },
  ];

  it('suma, promedia y da el rango de los numéricos', () => {
    const m = calcularMetricasDelFormulario(CAMPOS_DEL_RETO, respuestas);
    const contactos = m.numericas.find((x) => x.id === 'contactos_nuevos')!;
    expect(contactos.respuestas).toBe(3);
    expect(contactos.suma).toBe(60);
    expect(contactos.promedio).toBe(20);
    expect(contactos.minimo).toBe(10);
    expect(contactos.maximo).toBe(30);
  });

  it('un 0 es una respuesta, no un vacío', () => {
    // Si el 0 no contara, «agendadas» diría 2 respuestas y un promedio de 1,5:
    // el tablero mostraría mejores números que la realidad.
    const m = calcularMetricasDelFormulario(CAMPOS_DEL_RETO, respuestas);
    const agendadas = m.numericas.find((x) => x.id === 'agendadas')!;
    expect(agendadas.respuestas).toBe(3);
    expect(agendadas.promedio).toBe(1);
  });

  it('cuenta las opciones y las ordena de mayor a menor', () => {
    const m = calcularMetricasDelFormulario(CAMPOS_DEL_RETO, respuestas);
    const tarea = m.opciones.find((x) => x.id === 'tarea_del_dia')!;
    expect(tarea.opciones[0]).toEqual({ opcion: 'Sí', cantidad: 2, porcentaje: 66.7 });
    expect(tarea.opciones[1]).toEqual({ opcion: 'No', cantidad: 1, porcentaje: 33.3 });
  });

  it('la selección múltiple cuenta una vez por opción elegida', () => {
    const campos: CampoDeFormulario[] = [{ id: 'canales', label: 'Canales', type: 'multi_select' }];
    const m = calcularMetricasDelFormulario(campos, [
      { canales: ['IG', 'WhatsApp'] },
      { canales: ['IG'] },
      { canales: [] },
    ]);
    const canales = m.opciones[0];
    expect(canales.respuestas).toBe(2); // la lista vacía no es una respuesta
    expect(canales.opciones.find((o) => o.opcion === 'IG')!.cantidad).toBe(2);
    expect(canales.opciones.find((o) => o.opcion === 'WhatsApp')!.cantidad).toBe(1);
  });

  it('los textos vacíos no cuentan y se muestran los últimos primero', () => {
    const m = calcularMetricasDelFormulario(CAMPOS_DEL_RETO, respuestas);
    const freno = m.textos.find((x) => x.id === 'freno')!;
    expect(freno.respuestas).toBe(2);
    expect(freno.ultimas[0]).toBe('Sin tiempo');
  });

  it('un formulario sin respuestas devuelve sus campos en cero, no vacío', () => {
    // El tablero de un formulario recién creado tiene que dibujarse igual, o
    // parece que está roto.
    const m = calcularMetricasDelFormulario(CAMPOS_DEL_RETO, []);
    expect(m.numericas).toHaveLength(4);
    expect(m.numericas[0].respuestas).toBe(0);
    expect(m.numericas[0].promedio).toBe(0);
  });

  it('aguanta respuestas incompletas y basura sin explotar', () => {
    const m = calcularMetricasDelFormulario(CAMPOS_DEL_RETO, [
      { contactos_nuevos: '15' },          // número que llegó como texto
      { contactos_nuevos: 'muchos' },      // texto que no es número
      {},                                  // sin contestar nada
    ]);
    const contactos = m.numericas.find((x) => x.id === 'contactos_nuevos')!;
    expect(contactos.respuestas).toBe(1);
    expect(contactos.suma).toBe(15);
  });
});

describe('respuestasPorDia', () => {
  it('agrupa y ordena por día', () => {
    expect(respuestasPorDia(['2026-08-17', '2026-08-15', '2026-08-17'])).toEqual([
      { dia: '2026-08-15', cantidad: 1 },
      { dia: '2026-08-17', cantidad: 2 },
    ]);
  });

  it('recorta la hora de una marca de tiempo', () => {
    expect(respuestasPorDia(['2026-08-17T14:22:08.461117+00:00'])).toEqual([
      { dia: '2026-08-17', cantidad: 1 },
    ]);
  });

  it('descarta nulos y fechas que no lo son', () => {
    expect(respuestasPorDia([null, undefined, '', 'ayer', '2026-08-17'])).toEqual([
      { dia: '2026-08-17', cantidad: 1 },
    ]);
  });
});

import { describe, it, expect } from 'vitest';
import { analyzerCallType, buildStoredAnalysis, leadQualification, validFollowupDate, collectQuotes } from './analysis-store';

describe('call-analysis-store', () => {
  it('venta sin subtipo → cierre', () => {
    expect(analyzerCallType('venta')).toBe('cierre');
    expect(analyzerCallType(null)).toBe('cierre');
    expect(analyzerCallType('triaje')).toBe('triaje');
  });
  it('calificación por puntaje y resultado', () => {
    expect(leadQualification(65, 'venta')).toBe('calificado');
    expect(leadQualification(50, null)).toBe('con_reservas');
    expect(leadQualification(44, null)).toBe('no_calificado');
    expect(leadQualification(90, 'no_calificaba')).toBe('no_calificado');
    expect(leadQualification(null, null)).toBeNull();
  });
  it('fecha de seguimiento inválida → null', () => {
    expect(validFollowupDate('mañana')).toBeNull();
    expect(validFollowupDate('2026-10-02')).toBe('2026-10-02T12:00:00.000Z');
  });
  it('arma claves de primer nivel con puntajes del código', () => {
    const r = buildStoredAnalysis({
      analysis: {
        resultado: { categoria: 'seguimiento_con_fecha', fecha: '2026-10-02' },
        objecion: { categoria: 'precio', cita: 'es demasiado caro para mi' },
        dolor: { cita: 'frase que no existe en la llamada' },
        rubrica: [{ codigo: 'x', puntaje: 5, cita: 'hola como estas hoy' }],
        alertas: [{ tipo: 'a', texto: 'b' }],
        closer_score: 1,
      },
      scores: { closer_score: 100, lead_score: 50 },
      transcriptText: 'Hola, ¿cómo estás hoy? ... Es demasiado caro para mí.',
      model: 'm', costUsd: 0.1234567, promptVersion: 3, rubricVersion: 2, generatedAt: 't',
    });
    expect(r.closer_score).toBe(100);
    expect(r.outcome).toBe('seguimiento_con_fecha');
    expect(r.main_objection).toBe('precio');
    expect(r.has_open_alerts).toBe(true);
    expect(r.lead_qualification).toBe('con_reservas');
    expect(r.cost_usd).toBe(0.123457);
    expect(r.citas_verificadas).toEqual({ total: 3, verificadas: 2 });
  });
  it('guarda las versiones usadas y no inventa un nivel de razonamiento', () => {
    const r = buildStoredAnalysis({ analysis: {}, scores: { closer_score: null, lead_score: null }, transcriptText: '', model: 'm', costUsd: 0, promptVersion: 3, rubricVersion: 2, generatedAt: 't' });
    expect(r).toMatchObject({ prompt_version: 3, rubric_version: 2 });
    expect(r).not.toHaveProperty('thinking_level');
  });
  it('lead 62 queda con reservas; 9 citas con 8 verificadas', () => {
    expect(leadQualification(62, null)).toBe('con_reservas');
    const quotes = Array.from({ length: 9 }, (_, i) => `cita textual numero ${i}`);
    const analysis = { rubrica: quotes.map((c, i) => ({ codigo: `c${i}`, puntaje: 3, cita: c })) };
    const transcriptText = quotes.slice(0, 8).join('. ');
    const r = buildStoredAnalysis({ analysis, scores: { closer_score: 50, lead_score: 62 }, transcriptText, model: 'm', costUsd: 0, promptVersion: null, rubricVersion: 1, generatedAt: 't' });
    expect(collectQuotes(analysis)).toHaveLength(9);
    expect(r.citas_verificadas).toEqual({ total: 9, verificadas: 8 });
  });
});

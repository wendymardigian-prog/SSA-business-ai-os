import { describe, it, expect } from 'vitest';
import { hasTimestamps, tsToSeconds, speakerStats, conversationMetrics, buildParticipants, readAnalysis, isQuotedLine, fmtClock } from './detail';

const lines = [
  { speaker: { display_name: 'Ana', matched_calendar_invitee_email: 'ana@x.com' }, text: '¿Cómo estás? ¿Qué te trajo?', timestamp: '00:00:00' },
  { speaker: { display_name: 'Ana' }, text: 'Te cuento el programa', timestamp: '00:01:00' },
  { speaker: { display_name: 'Leo' }, text: 'Dale', timestamp: '00:03:00' },
  { speaker: { display_name: 'Ana' }, text: 'La inversión es de 3 mil dólares', timestamp: '00:04:00' },
  { speaker: { display_name: 'Leo' }, text: 'Ok', timestamp: '00:06:00' },
];

describe('tiempos', () => {
  it('tsToSeconds HH:MM:SS y MM:SS → segundos', () => {
    expect(tsToSeconds('01:02:03')).toBe(3723);
    expect(tsToSeconds('02:03')).toBe(123);
    expect(tsToSeconds('x')).toBeNull();
  });
  it('fmtClock → m:ss', () => { expect(fmtClock(125)).toBe('2:05'); });
});

describe('speakerStats', () => {
  it('reparte el tiempo hasta la línea siguiente', () => {
    const s = speakerStats(lines, 420);
    expect(s[0].name).toBe('Ana');
    expect(s[0].seconds).toBe(300);
  });
});

describe('conversationMetrics', () => {
  it('% closer, monólogo, preguntas/hora y minuto del precio', () => {
    const m = conversationMetrics(lines, (n) => n === 'Ana', 3600);
    expect(m.longestMonologueSec).toBe(180);
    expect(m.questionsPerHour).toBe(2);
    expect(m.priceMinute).toBe(4);
    expect(m.closerTalkPct).toBeGreaterThan(50);
  });
  it('sin transcripción → nulls', () => {
    expect(conversationMetrics([], () => true).closerTalkPct).toBeNull();
  });
  it('una transcripción SIN tiempos no inventa minuto del precio ni monólogo en segundos', () => {
    const sinTiempos = lines.map((l) => ({ ...l, timestamp: '' }));
    const m = conversationMetrics(sinTiempos, (n) => n === 'Ana');
    expect(m.timesAvailable).toBe(false);
    expect(m.priceMinute).toBeNull();
    expect(m.longestMonologueSec).toBeNull();
    expect(m.questionsPerHour).toBeNull();
    expect(m.closerTalkPct).not.toBeNull();
  });
  it('hasTimestamps distingue las que traen tiempos', () => {
    expect(hasTimestamps(lines)).toBe(true);
    expect(hasTimestamps([{ text: 'hola' }, { text: 'chau', timestamp: '' }])).toBe(false);
    expect(conversationMetrics(lines, (n) => n === 'Ana', 3600).timesAvailable).toBe(true);
  });
});

describe('buildParticipants', () => {
  it('rol por host y externo; cuenta invitados y hablantes', () => {
    const p = buildParticipants(
      [{ name: 'Ana', email: 'ana@x.com', is_external: false }, { name: 'Leo', email: 'leo@y.com', is_external: true }, { name: 'Mudo', email: 'm@y.com', is_external: true }],
      lines, 'ana@x.com', 420,
    );
    expect(p.invited).toBe(3);
    expect(p.spoke).toBe(2);
    expect(p.participants.find((x) => x.name === 'Ana')?.role).toBe('closer');
    expect(p.participants.find((x) => x.name === 'Leo')?.role).toBe('lead');
    expect(p.participants.find((x) => x.name === 'Mudo')?.spoke).toBe(false);
  });
});

describe('readAnalysis', () => {
  it('vacío → empty, sin romper', () => {
    const a = readAnalysis(null);
    expect(a.empty).toBe(true);
    expect(a.rubric).toEqual([]);
  });
  it('lee rúbrica, creencias no exploradas y alertas', () => {
    const a = readAnalysis({
      rubrica: [{ codigo: 'rapport', nombre: 'Rapport', puntaje: 4, cita: 'hola' }],
      lead: { creencias: [{ nombre: 'Puedo', estado: 'No explorado' }, { nombre: 'Vale', estado: 'Firme' }] },
      alertas: [{ tipo: 'descuento', resuelta: true }, { tipo: 'promesa' }],
    });
    expect(a.rubric[0].score).toBe(4);
    expect(a.lead.beliefs.map((b) => b.unexplored)).toEqual([true, false]);
    expect(a.alerts.filter((x) => !x.resolved).map((x) => x.type)).toEqual(['promesa']);
  });
});

describe('isQuotedLine', () => {
  it('coincide ignorando mayúsculas y signos', () => {
    expect(isQuotedLine('La inversión es de 3 mil dólares.', ['la inversión es de 3 mil dólares'])).toBe(true);
    expect(isQuotedLine('Ok', ['ok'])).toBe(false);
  });
});

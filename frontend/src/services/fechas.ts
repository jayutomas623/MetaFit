/** Utilidades de fecha para el seguimiento diario (semana de lunes a domingo). */

export const NOMBRES_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const LETRAS_DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Índice del día de la semana con 0 = lunes … 6 = domingo. */
export const indiceDia = (fecha: Date = new Date()): number => {
  const d = fecha.getDay(); // 0 = domingo
  return d === 0 ? 6 : d - 1;
};

/** Clave local 'AAAA-MM-DD' para guardar el avance de un día. */
export const claveFecha = (fecha: Date = new Date()): string => {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
};

/** Texto corto de una lista de días: "L · X · V". */
export const resumenDias = (dias: number[]): string =>
  dias.length === 7 ? 'Todos los días' : [...dias].sort((a, b) => a - b).map((d) => LETRAS_DIAS[d]).join(' · ');

export const nuevoId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Generador del Plan personalizado (IA) de alimentación y ejercicio.
 *
 * Función pura: perfil (peso, estatura, edad, género) + configuración elegida (objetivo y
 * frecuencia de entrenamiento) → plan completo. No guarda estado: cualquier cambio de
 * usuario, medidas u opciones produce un plan nuevo.
 *
 * Cálculos (estimaciones orientativas, no diagnóstico médico):
 *  - IMC y % de grasa: los de UsuarioLogic (src/models/Usuario.ts).
 *  - Tasa metabólica basal: Mifflin-St Jeor; mantenimiento = TMB × factor de actividad.
 *  - Rango de peso saludable: IMC 18.5–24.9 para la estatura.
 *  - Proteína 1.8–2.0 g/kg (peso de referencia ajustado si el IMC es alto),
 *    grasas ≥ 20 % de las calorías, carbohidratos el resto.
 *  - Agua: ~35 ml por kg, +0.5 L los días de entrenamiento.
 */
import { CategoriaGrasa, UsuarioLogic, getCategoriaGrasaInfo } from '../models/Usuario';
import { listaEjerciciosEjemplo } from '../models/Ejercicio';
import {
  ConfigPlanIA,
  FrecuenciaEntreno,
  Macros,
  ObjetivoUsuario,
  TIEMPOS_COMIDA,
  TiempoComidaId,
} from '../models/Plan';
import { esUnilateral, ExerciseType } from './exerciseEngine';
import { NOMBRES_DIAS } from './fechas';

export type Enfoque = 'deficit' | 'superavit' | 'recomposicion';

export const OBJETIVOS: { id: ObjetivoUsuario; etiqueta: string }[] = [
  { id: 'automatico', etiqueta: 'Automático' },
  { id: 'perder_grasa', etiqueta: 'Perder grasa' },
  { id: 'ganar_musculo', etiqueta: 'Ganar músculo' },
  { id: 'mantener', etiqueta: 'Mantener' },
];

export const FRECUENCIAS: { id: FrecuenciaEntreno; etiqueta: string }[] = [
  { id: 'diario', etiqueta: 'Todos los días' },
  { id: 'alterno', etiqueta: 'Día por medio' },
  { id: 'libre', etiqueta: 'Elegir días' },
];

export interface DatosPerfil {
  peso: number;
  estatura: number;
  edad: number;
  genero: 'M' | 'F';
  actividadSemanal?: number[];
}

export interface MacrosObjetivo extends Macros {
  pctProteina: number;
  pctCarbos: number;
  pctGrasas: number;
}

export interface ItemComida {
  alimento: string;
  porcion: string;
}

export interface OpcionComida extends Macros {
  nombre: string;
  items: ItemComida[];
}

export interface TiempoComidaPlan {
  id: TiempoComidaId;
  nombre: string;
  horario: string;
  kcalObjetivo: number;
  opciones: OpcionComida[];
}

export interface EjercicioPlan {
  /** Clave estable para el seguimiento diario. */
  key: string;
  tipo: ExerciseType;
  nombre: string;
  series: number;
  /** Repeticiones objetivo por serie (por lado si es unilateral): se pasan a la cámara. */
  reps: number;
  unilateral: boolean;
}

export interface DiaPlan {
  indice: number;
  dia: string;
  entrena: boolean;
  titulo: string;
  ejercicios: EjercicioPlan[];
  /** Actividad complementaria (cardio, movilidad o descanso activo). */
  complemento: string | null;
}

export interface PlanPersonalizado {
  perfil: {
    imc: number;
    categoriaImc: string;
    porcentajeGrasa: number;
    categoriaGrasa: string;
    pesoSaludableMin: number;
    pesoSaludableMax: number;
    tmb: number;
    mantenimiento: number;
    nivelActividad: string;
  };
  config: ConfigPlanIA;
  enfoque: Enfoque;
  tituloEnfoque: string;
  descripcionEnfoque: string;
  avisos: string[];
  calorias: number;
  ajusteCalorico: number;
  macros: MacrosObjetivo;
  aguaLitros: number;
  aguaEntrenoLitros: number;
  comidas: TiempoComidaPlan[];
  consejosAlimentacion: string[];
  diasEntreno: number[];
  semana: DiaPlan[];
  descansoEntreSeries: string;
  consejosEntreno: string[];
}

// -----------------------------------------------------------------------------
// Cálculos base
// -----------------------------------------------------------------------------

const redondear = (v: number, paso: number) => Math.round(v / paso) * paso;

function nivelActividad(actividad: number[] | undefined, diasEntreno: number) {
  // Puntos semanales de la app (5 por repetición válida) + días planificados.
  const puntos = (actividad ?? []).reduce((a, b) => a + (b || 0), 0);
  if (puntos >= 600 || diasEntreno >= 6) return { factor: 1.725, etiqueta: 'Alta', principiante: false };
  if (puntos >= 150 || diasEntreno >= 4) return { factor: 1.55, etiqueta: 'Moderada', principiante: puntos < 150 };
  return { factor: 1.375, etiqueta: 'Ligera', principiante: true };
}

function decidirEnfoque(objetivo: ObjetivoUsuario, imc: number, categoria: CategoriaGrasa, edad: number) {
  const avisos: string[] = [];
  const grasaAlta = categoria === CategoriaGrasa.elevado || categoria === CategoriaGrasa.critico;

  if (edad < 18) {
    avisos.push('Eres menor de edad: el plan se mantiene en calorías de mantenimiento. Consulta con un profesional antes de cambiar tu dieta.');
    return { enfoque: 'recomposicion' as Enfoque, avisos };
  }
  switch (objetivo) {
    case 'perder_grasa':
      if (imc < 18.5) {
        avisos.push('Tu IMC está bajo: no se recomienda un déficit. Te proponemos mantenimiento con entrenamiento de fuerza.');
        return { enfoque: 'recomposicion' as Enfoque, avisos };
      }
      return { enfoque: 'deficit' as Enfoque, avisos };
    case 'ganar_musculo':
      if (imc >= 30 || categoria === CategoriaGrasa.critico) {
        avisos.push('Con tu composición actual conviene ganar músculo sin superávit (recomposición) y reducir grasa primero.');
        return { enfoque: 'recomposicion' as Enfoque, avisos };
      }
      return { enfoque: 'superavit' as Enfoque, avisos };
    case 'mantener':
      return { enfoque: 'recomposicion' as Enfoque, avisos };
    default:
      if (imc < 18.5) return { enfoque: 'superavit' as Enfoque, avisos };
      if (imc >= 30 || grasaAlta) return { enfoque: 'deficit' as Enfoque, avisos };
      return { enfoque: 'recomposicion' as Enfoque, avisos };
  }
}

const TEXTOS_ENFOQUE: Record<Enfoque, { titulo: string; descripcion: string }> = {
  deficit: {
    titulo: 'Déficit calórico controlado',
    descripcion: 'Reducir grasa de forma sostenible: comer algo menos de lo que gastas, proteína alta para conservar músculo y fuerza combinada con cardio.',
  },
  superavit: {
    titulo: 'Superávit limpio',
    descripcion: 'Ganar peso y músculo: comer un poco más de lo que gastas con alimentos nutritivos y priorizar la fuerza con poco cardio.',
  },
  recomposicion: {
    titulo: 'Recomposición / mantenimiento',
    descripcion: 'Mantener el peso mientras mejoras tu composición: calorías de mantenimiento, proteína suficiente y fuerza con cardio moderado.',
  },
};

function calcularCalorias(enfoque: Enfoque, mantenimiento: number, tmb: number, genero: 'M' | 'F', grasaAlta: boolean) {
  let calorias = mantenimiento;
  if (enfoque === 'deficit') {
    const piso = Math.max(tmb, genero === 'M' ? 1500 : 1200);
    calorias = Math.max(piso, mantenimiento - Math.min(mantenimiento * 0.2, 600));
  } else if (enfoque === 'superavit') {
    calorias = mantenimiento + Math.min(Math.max(mantenimiento * 0.12, 250), 450);
  } else if (grasaAlta) {
    // Recomposición con grasa elevada: déficit leve (~10 %).
    calorias = Math.max(tmb, mantenimiento * 0.9);
  }
  calorias = redondear(calorias, 10);
  return { calorias, ajuste: calorias - mantenimiento };
}

function calcularMacros(enfoque: Enfoque, calorias: number, peso: number, pesoSaludableMax: number): MacrosObjetivo {
  const pesoRef = peso > pesoSaludableMax ? pesoSaludableMax + 0.25 * (peso - pesoSaludableMax) : peso;
  const proteinaG = redondear(pesoRef * (enfoque === 'deficit' ? 2.0 : 1.8), 5);
  let grasasG = redondear(Math.max(pesoRef * (enfoque === 'deficit' ? 0.8 : 0.9), (calorias * 0.2) / 9), 5);
  let carbosG = redondear(Math.max((calorias - proteinaG * 4 - grasasG * 9) / 4, 0), 5);
  if (carbosG < 80) {
    grasasG = redondear(Math.max((calorias * 0.2) / 9, (calorias - proteinaG * 4 - 80 * 4) / 9), 5);
    carbosG = redondear(Math.max((calorias - proteinaG * 4 - grasasG * 9) / 4, 0), 5);
  }
  const total = proteinaG * 4 + carbosG * 4 + grasasG * 9 || 1;
  const pctProteina = Math.round(((proteinaG * 4) / total) * 100);
  const pctGrasas = Math.round(((grasasG * 9) / total) * 100);
  return {
    kcal: calorias,
    proteinaG,
    carbosG,
    grasasG,
    pctProteina,
    pctGrasas,
    pctCarbos: 100 - pctProteina - pctGrasas,
  };
}

// -----------------------------------------------------------------------------
// Alimentos y comidas
// -----------------------------------------------------------------------------

type Unidad = 'g' | 'ml' | 'unidad' | 'rebanada' | 'cda' | 'cdta';

/** Catálogo de alimentos: valores por 1 unidad de medida (1 g, 1 ml, 1 unidad…). */
const ALIMENTOS: Record<string, { nombre: string; unidad: Unidad; kcal: number; p: number; c: number; g: number }> = {
  avena: { nombre: 'Avena en hojuelas', unidad: 'g', kcal: 3.75, p: 0.13, c: 0.66, g: 0.07 },
  lecheDesc: { nombre: 'Leche descremada', unidad: 'ml', kcal: 0.35, p: 0.035, c: 0.05, g: 0.001 },
  lecheEntera: { nombre: 'Leche entera', unidad: 'ml', kcal: 0.63, p: 0.033, c: 0.047, g: 0.033 },
  platano: { nombre: 'Plátano', unidad: 'unidad', kcal: 105, p: 1.3, c: 27, g: 0.4 },
  mani: { nombre: 'Mantequilla de maní', unidad: 'cda', kcal: 90, p: 4, c: 3, g: 8 },
  huevo: { nombre: 'Huevo', unidad: 'unidad', kcal: 75, p: 6.3, c: 0.6, g: 5 },
  pan: { nombre: 'Pan integral', unidad: 'rebanada', kcal: 75, p: 3.5, c: 13, g: 1 },
  palta: { nombre: 'Palta', unidad: 'g', kcal: 1.6, p: 0.02, c: 0.09, g: 0.15 },
  tomate: { nombre: 'Tomate en rodajas', unidad: 'g', kcal: 0.18, p: 0.009, c: 0.039, g: 0.002 },
  yogur: { nombre: 'Yogur natural sin azúcar', unidad: 'g', kcal: 0.6, p: 0.035, c: 0.047, g: 0.033 },
  fruta: { nombre: 'Fruta de temporada', unidad: 'g', kcal: 0.5, p: 0.005, c: 0.125, g: 0.002 },
  pollo: { nombre: 'Pechuga de pollo a la plancha', unidad: 'g', kcal: 1.65, p: 0.31, c: 0, g: 0.036 },
  arroz: { nombre: 'Arroz cocido', unidad: 'g', kcal: 1.3, p: 0.027, c: 0.28, g: 0.003 },
  ensalada: { nombre: 'Ensalada de verduras', unidad: 'g', kcal: 0.27, p: 0.013, c: 0.047, g: 0.002 },
  aceite: { nombre: 'Aceite de oliva', unidad: 'cdta', kcal: 45, p: 0, c: 0, g: 5 },
  lentejas: { nombre: 'Lentejas cocidas', unidad: 'g', kcal: 1.16, p: 0.09, c: 0.2, g: 0.004 },
  quinua: { nombre: 'Quinua cocida', unidad: 'g', kcal: 1.2, p: 0.044, c: 0.21, g: 0.019 },
  verduras: { nombre: 'Verduras salteadas', unidad: 'g', kcal: 0.4, p: 0.02, c: 0.07, g: 0.006 },
  pescado: { nombre: 'Pescado blanco a la plancha', unidad: 'g', kcal: 1.0, p: 0.21, c: 0, g: 0.015 },
  papa: { nombre: 'Papa cocida', unidad: 'g', kcal: 0.87, p: 0.019, c: 0.2, g: 0.001 },
  carne: { nombre: 'Carne magra de res', unidad: 'g', kcal: 1.85, p: 0.26, c: 0, g: 0.085 },
  fideos: { nombre: 'Fideos integrales cocidos', unidad: 'g', kcal: 1.25, p: 0.05, c: 0.25, g: 0.011 },
  frutosSecos: { nombre: 'Frutos secos (nueces, almendras)', unidad: 'g', kcal: 6.0, p: 0.2, c: 0.2, g: 0.52 },
  queso: { nombre: 'Queso fresco', unidad: 'g', kcal: 2.64, p: 0.17, c: 0.03, g: 0.2 },
  pavo: { nombre: 'Jamón de pavo', unidad: 'g', kcal: 1.1, p: 0.18, c: 0.02, g: 0.03 },
  galletasArroz: { nombre: 'Galletas de arroz', unidad: 'unidad', kcal: 35, p: 0.7, c: 7.3, g: 0.3 },
  atun: { nombre: 'Atún en agua', unidad: 'g', kcal: 1.1, p: 0.25, c: 0, g: 0.01 },
};

interface ItemBase {
  id: keyof typeof ALIMENTOS;
  cantidad: number;
  /** false para porciones fijas (verduras libres). */
  escalable?: boolean;
}

interface OpcionBase {
  nombre: string;
  items: ItemBase[];
  enfoques?: Enfoque[];
}

const DISTRIBUCION: Record<TiempoComidaId, number> = { desayuno: 0.25, almuerzo: 0.35, merienda: 0.15, cena: 0.25 };

const OPCIONES_COMIDA: Record<TiempoComidaId, OpcionBase[]> = {
  desayuno: [
    { nombre: 'Avena con fruta', items: [{ id: 'avena', cantidad: 40 }, { id: 'lecheDesc', cantidad: 200 }, { id: 'platano', cantidad: 1 }, { id: 'mani', cantidad: 1 }] },
    { nombre: 'Huevos con pan integral', items: [{ id: 'huevo', cantidad: 2 }, { id: 'pan', cantidad: 2 }, { id: 'palta', cantidad: 30 }, { id: 'tomate', cantidad: 80, escalable: false }] },
    { nombre: 'Yogur con fruta y avena', enfoques: ['deficit', 'recomposicion'], items: [{ id: 'yogur', cantidad: 200 }, { id: 'fruta', cantidad: 150 }, { id: 'avena', cantidad: 20 }] },
    { nombre: 'Batido energético', enfoques: ['superavit'], items: [{ id: 'lecheEntera', cantidad: 300 }, { id: 'avena', cantidad: 50 }, { id: 'platano', cantidad: 1 }, { id: 'mani', cantidad: 2 }] },
  ],
  almuerzo: [
    { nombre: 'Pollo con arroz y ensalada', items: [{ id: 'pollo', cantidad: 120 }, { id: 'arroz', cantidad: 150 }, { id: 'ensalada', cantidad: 150, escalable: false }, { id: 'aceite', cantidad: 1 }] },
    { nombre: 'Lentejas con quinua', items: [{ id: 'lentejas', cantidad: 150 }, { id: 'quinua', cantidad: 120 }, { id: 'huevo', cantidad: 1 }, { id: 'verduras', cantidad: 150, escalable: false }] },
    { nombre: 'Pescado con papa y ensalada', items: [{ id: 'pescado', cantidad: 150 }, { id: 'papa', cantidad: 200 }, { id: 'ensalada', cantidad: 150, escalable: false }, { id: 'aceite', cantidad: 1 }] },
    { nombre: 'Carne magra con fideos integrales', enfoques: ['superavit', 'recomposicion'], items: [{ id: 'carne', cantidad: 130 }, { id: 'fideos', cantidad: 180 }, { id: 'verduras', cantidad: 150, escalable: false }, { id: 'aceite', cantidad: 1 }] },
  ],
  merienda: [
    { nombre: 'Yogur con frutos secos', items: [{ id: 'yogur', cantidad: 150 }, { id: 'frutosSecos', cantidad: 20 }] },
    { nombre: 'Fruta con queso fresco', items: [{ id: 'fruta', cantidad: 150 }, { id: 'queso', cantidad: 40 }] },
    { nombre: 'Sándwich de pavo', enfoques: ['superavit', 'recomposicion'], items: [{ id: 'pan', cantidad: 2 }, { id: 'pavo', cantidad: 40 }, { id: 'queso', cantidad: 30 }] },
    { nombre: 'Galletas de arroz con maní', enfoques: ['deficit'], items: [{ id: 'galletasArroz', cantidad: 2 }, { id: 'mani', cantidad: 1 }] },
  ],
  cena: [
    { nombre: 'Pescado con verduras y quinua', items: [{ id: 'pescado', cantidad: 150 }, { id: 'quinua', cantidad: 100 }, { id: 'verduras', cantidad: 150, escalable: false }, { id: 'aceite', cantidad: 1 }] },
    { nombre: 'Tortilla de huevo con verduras', items: [{ id: 'huevo', cantidad: 2 }, { id: 'verduras', cantidad: 120, escalable: false }, { id: 'pan', cantidad: 1 }, { id: 'queso', cantidad: 30 }] },
    { nombre: 'Atún con papa y ensalada', items: [{ id: 'atun', cantidad: 120 }, { id: 'papa', cantidad: 150 }, { id: 'ensalada', cantidad: 150, escalable: false }, { id: 'aceite', cantidad: 1 }] },
  ],
};

const PASO_UNIDAD: Record<Unidad, number> = { g: 10, ml: 50, unidad: 1, rebanada: 1, cda: 0.5, cdta: 1 };

function formatearPorcion(cantidad: number, unidad: Unidad): string {
  const n = Number.isInteger(cantidad) ? String(cantidad) : cantidad.toFixed(1).replace('.0', '');
  const plural = cantidad !== 1;
  switch (unidad) {
    case 'g':
      return `${n} g`;
    case 'ml':
      return `${n} ml`;
    case 'unidad':
      return `${n} ${plural ? 'unidades' : 'unidad'}`;
    case 'rebanada':
      return `${n} ${plural ? 'rebanadas' : 'rebanada'}`;
    case 'cda':
      return `${n} ${plural ? 'cucharadas' : 'cucharada'}`;
    case 'cdta':
      return `${n} ${plural ? 'cucharaditas' : 'cucharadita'}`;
  }
}

/** Ajusta las porciones de una opción a las calorías objetivo y calcula sus macros reales. */
function escalarOpcion(opcion: OpcionBase, kcalObjetivo: number): OpcionComida {
  const kcalDe = (i: ItemBase) => ALIMENTOS[i.id].kcal * i.cantidad;
  const fijas = opcion.items.filter((i) => i.escalable === false).reduce((a, i) => a + kcalDe(i), 0);
  const escalables = opcion.items.filter((i) => i.escalable !== false).reduce((a, i) => a + kcalDe(i), 0);
  const factor = escalables > 0 ? Math.min(Math.max((kcalObjetivo - fijas) / escalables, 0.5), 2.2) : 1;

  const tot = { kcal: 0, p: 0, c: 0, g: 0 };
  const items = opcion.items.map((i) => {
    const a = ALIMENTOS[i.id];
    const paso = PASO_UNIDAD[a.unidad];
    const cantidad = i.escalable === false ? i.cantidad : Math.max(paso, redondear(i.cantidad * factor, paso));
    tot.kcal += a.kcal * cantidad;
    tot.p += a.p * cantidad;
    tot.c += a.c * cantidad;
    tot.g += a.g * cantidad;
    return { alimento: a.nombre, porcion: formatearPorcion(cantidad, a.unidad) };
  });

  return {
    nombre: opcion.nombre,
    items,
    kcal: redondear(tot.kcal, 5),
    proteinaG: Math.round(tot.p),
    carbosG: Math.round(tot.c),
    grasasG: Math.round(tot.g),
  };
}

function crearComidas(enfoque: Enfoque, calorias: number): TiempoComidaPlan[] {
  return TIEMPOS_COMIDA.map((t) => {
    const kcalObjetivo = redondear(calorias * DISTRIBUCION[t.id], 10);
    const opciones = OPCIONES_COMIDA[t.id]
      .filter((o) => !o.enfoques || o.enfoques.includes(enfoque))
      .map((o) => escalarOpcion(o, kcalObjetivo));
    return { ...t, kcalObjetivo, opciones };
  });
}

const CONSEJOS_ALIMENTACION: Record<Enfoque, string[]> = {
  deficit: [
    'Llena la mitad del plato con verduras: dan saciedad con pocas calorías.',
    'Incluye proteína en cada comida para conservar músculo.',
    'Mide el aceite con cucharita y evita bebidas azucaradas.',
  ],
  superavit: [
    'No te saltes comidas; si te cuesta, agrega un vaso de leche o frutos secos.',
    'Come carbohidratos y proteína 1 a 2 horas antes de entrenar.',
    'Si en 2 semanas tu peso no sube, aumenta un poco las porciones.',
  ],
  recomposicion: [
    'Mantén horarios regulares y proteína en cada comida.',
    'Ubica más carbohidratos en las comidas cercanas al entrenamiento.',
    'Si tu peso cambia más de 1 kg en 2 semanas, ajusta las porciones.',
  ],
};

// -----------------------------------------------------------------------------
// Rutina semanal según frecuencia
// -----------------------------------------------------------------------------

const nombreEjercicio = (tipo: ExerciseType) =>
  listaEjerciciosEjemplo.find((e) => e.engineType === tipo)?.nombre ?? tipo;

interface SesionBase {
  titulo: string;
  ejercicios: { tipo: ExerciseType; series: number; reps: number }[];
  complemento: string | null;
}

export function diasDeEntreno(config: ConfigPlanIA): number[] {
  if (config.frecuencia === 'diario') return [0, 1, 2, 3, 4, 5, 6];
  if (config.frecuencia === 'alterno') return [0, 2, 4, 6];
  const dias = [...new Set(config.diasLibres)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  return dias.length > 0 ? dias : [0, 2, 4];
}

function sesionesPorEnfoque(enfoque: Enfoque, bajoImpacto: boolean, principiante: boolean, nDias: number) {
  const s = (n: number) => (principiante ? Math.max(2, n - 1) : n);
  const pierna: SesionBase['ejercicios'][number] = bajoImpacto
    ? { tipo: 'squat', series: s(3), reps: 12 }
    : { tipo: 'bulgarianSquat', series: s(3), reps: 10 };
  const cardio = bajoImpacto ? 'caminata rápida o bicicleta' : 'trote suave, bicicleta o caminata rápida';
  const conCardio = enfoque === 'deficit' && nDias <= 4 ? `20 min de ${cardio} al terminar` : null;

  if (enfoque === 'superavit') {
    const fuerza: SesionBase[] = [
      {
        titulo: 'Tren inferior',
        ejercicios: [{ tipo: 'squat', series: s(4), reps: 10 }, pierna, { tipo: 'gluteKickback', series: s(3), reps: 12 }, { tipo: 'abdominals', series: s(3), reps: 15 }],
        complemento: null,
      },
      {
        titulo: 'Tren superior',
        ejercicios: [{ tipo: 'shoulderPress', series: s(4), reps: 10 }, { tipo: 'singleArmRow', series: s(4), reps: 10 }, { tipo: 'bicepCurl', series: s(3), reps: 10 }, { tipo: 'tricepExtension', series: s(3), reps: 10 }],
        complemento: null,
      },
    ];
    const ligera: SesionBase = {
      titulo: 'Core y movilidad',
      ejercicios: [{ tipo: 'abdominals', series: 3, reps: 15 }],
      complemento: '15 min de movilidad y estiramientos',
    };
    return { fuerza, ligera };
  }

  const reps = enfoque === 'deficit' ? 12 : 10;
  const fuerza: SesionBase[] = [
    {
      titulo: 'Fuerza cuerpo completo A',
      ejercicios: [{ tipo: 'squat', series: s(3), reps: reps + 2 }, { tipo: 'singleArmRow', series: s(3), reps }, { tipo: 'shoulderPress', series: s(3), reps }, { tipo: 'abdominals', series: s(3), reps: 15 }],
      complemento: conCardio,
    },
    {
      titulo: 'Fuerza cuerpo completo B',
      ejercicios: [pierna, { tipo: 'bicepCurl', series: s(3), reps }, { tipo: 'tricepExtension', series: s(3), reps }, { tipo: 'gluteKickback', series: s(3), reps: reps + 2 }],
      complemento: conCardio,
    },
  ];
  const ligera: SesionBase = {
    titulo: 'Cardio y core',
    ejercicios: [{ tipo: 'abdominals', series: 3, reps: 15 }],
    complemento: `${enfoque === 'deficit' ? '30 – 40' : '25 – 30'} min de ${cardio}`,
  };
  return { fuerza, ligera };
}

function crearSemana(enfoque: Enfoque, dias: number[], bajoImpacto: boolean, principiante: boolean): DiaPlan[] {
  const { fuerza, ligera } = sesionesPorEnfoque(enfoque, bajoImpacto, principiante, dias.length);
  // Con 5 o más días, cada tercer día de entreno es una sesión ligera para recuperar.
  const asignadas = new Map<number, SesionBase>();
  let f = 0;
  dias.forEach((dia, i) => {
    asignadas.set(dia, dias.length >= 5 && i % 3 === 2 ? ligera : fuerza[f++ % fuerza.length]);
  });

  return NOMBRES_DIAS.map((nombre, indice) => {
    const sesion = asignadas.get(indice);
    if (!sesion) {
      return {
        indice,
        dia: nombre,
        entrena: false,
        titulo: 'Descanso',
        ejercicios: [],
        complemento: 'Descanso activo: caminata suave o estiramientos',
      };
    }
    return {
      indice,
      dia: nombre,
      entrena: true,
      titulo: sesion.titulo,
      complemento: sesion.complemento,
      ejercicios: sesion.ejercicios.map((e, i) => ({
        key: `ia:${indice}:${i}:${e.tipo}`,
        tipo: e.tipo,
        nombre: nombreEjercicio(e.tipo),
        series: e.series,
        reps: e.reps,
        unilateral: esUnilateral(e.tipo),
      })),
    };
  });
}

const DESCANSO_SERIES: Record<Enfoque, string> = {
  deficit: '45 – 60 s de descanso entre series',
  superavit: '90 – 120 s de descanso entre series',
  recomposicion: '60 – 90 s de descanso entre series',
};

// -----------------------------------------------------------------------------
// API pública
// -----------------------------------------------------------------------------

export function generarPlan(datos: DatosPerfil, config: ConfigPlanIA): PlanPersonalizado {
  const usuario = new UsuarioLogic(datos);
  const { peso, estatura, edad, genero } = usuario;
  const alturaM = estatura / 100;

  const imc = usuario.imc;
  const categoria = usuario.categoriaGrasa;
  const pesoSaludableMin = Math.round(18.5 * alturaM * alturaM);
  const pesoSaludableMax = Math.round(24.9 * alturaM * alturaM);
  const diasEntreno = diasDeEntreno(config);

  const tmb = Math.round(
    genero === 'M' ? 10 * peso + 6.25 * estatura - 5 * edad + 5 : 10 * peso + 6.25 * estatura - 5 * edad - 161
  );
  const actividad = nivelActividad(datos.actividadSemanal, diasEntreno.length);
  const mantenimiento = redondear(tmb * actividad.factor, 10);

  const { enfoque, avisos } = decidirEnfoque(config.objetivo, imc, categoria, edad);
  const grasaAlta = (categoria === CategoriaGrasa.elevado || categoria === CategoriaGrasa.critico) && edad >= 18;
  const { calorias, ajuste } = calcularCalorias(enfoque, mantenimiento, tmb, genero, grasaAlta);
  const macros = calcularMacros(enfoque, calorias, peso, pesoSaludableMax);

  const aguaLitros = Math.round(peso * 0.035 * 10) / 10;
  const bajoImpacto = imc >= 30 || edad >= 50;

  if (peso < pesoSaludableMin || peso > pesoSaludableMax) {
    avisos.push(`Tu rango de peso saludable estimado es de ${pesoSaludableMin} a ${pesoSaludableMax} kg.`);
  }
  if (config.frecuencia === 'diario') {
    avisos.push('Entrenar todos los días: el plan intercala sesiones ligeras para que te recuperes.');
  }
  avisos.push('Valores estimados a partir de tus medidas. Si tienes alguna condición de salud, consulta con un profesional.');

  const consejosEntreno: string[] = [];
  if (actividad.principiante) consejosEntreno.push('Las primeras 2 semanas haz una serie menos y aprende la técnica con la cámara IA.');
  if (enfoque === 'superavit') consejosEntreno.push('Sube la carga o las repeticiones cuando completes todas las series con buena técnica.');
  if (enfoque === 'deficit') consejosEntreno.push('Mantén la fuerza aunque estés en déficit: protege tu masa muscular.');
  if (bajoImpacto) consejosEntreno.push('Prefiere cardio de bajo impacto (caminar, bicicleta) para cuidar rodillas y tobillos.');
  consejosEntreno.push('En los ejercicios de un lado, la cámara cuenta primero un lado y luego te pide girar para el otro.');
  consejosEntreno.push('Duerme 7 – 9 horas: la recuperación también es parte del progreso.');

  return {
    perfil: {
      imc: Number(imc.toFixed(1)),
      categoriaImc: usuario.categoriaImc,
      porcentajeGrasa: usuario.porcentajeGrasa,
      categoriaGrasa: getCategoriaGrasaInfo(categoria).titulo,
      pesoSaludableMin,
      pesoSaludableMax,
      tmb,
      mantenimiento,
      nivelActividad: actividad.etiqueta,
    },
    config,
    enfoque,
    tituloEnfoque: TEXTOS_ENFOQUE[enfoque].titulo,
    descripcionEnfoque: TEXTOS_ENFOQUE[enfoque].descripcion,
    avisos,
    calorias,
    ajusteCalorico: ajuste,
    macros,
    aguaLitros,
    aguaEntrenoLitros: Math.round((aguaLitros + 0.5) * 10) / 10,
    comidas: crearComidas(enfoque, calorias),
    consejosAlimentacion: CONSEJOS_ALIMENTACION[enfoque],
    diasEntreno,
    semana: crearSemana(enfoque, diasEntreno, bajoImpacto, actividad.principiante),
    descansoEntreSeries: DESCANSO_SERIES[enfoque],
    consejosEntreno,
  };
}

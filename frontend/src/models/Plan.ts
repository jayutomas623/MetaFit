import type { ExerciseType } from '../services/exerciseEngine';

/** Tipos compartidos del Plan personalizado, la dieta propia, las rutinas propias y el seguimiento diario. */

export type ObjetivoUsuario = 'automatico' | 'perder_grasa' | 'ganar_musculo' | 'mantener';
export type FrecuenciaEntreno = 'diario' | 'alterno' | 'libre';
export type TiempoComidaId = 'desayuno' | 'almuerzo' | 'merienda' | 'cena';
/** De dónde salen las comidas / rutinas que se siguen: el Plan IA o lo creado por el usuario. */
export type ModoFuente = 'ia' | 'propio';

export const TIEMPOS_COMIDA: { id: TiempoComidaId; nombre: string; horario: string }[] = [
  { id: 'desayuno', nombre: 'Desayuno', horario: '7:00 – 9:00' },
  { id: 'almuerzo', nombre: 'Almuerzo', horario: '12:30 – 14:00' },
  { id: 'merienda', nombre: 'Merienda / Snack', horario: '16:30 – 17:30' },
  { id: 'cena', nombre: 'Cena', horario: '19:30 – 21:00' },
];

export interface ConfigPlanIA {
  objetivo: ObjetivoUsuario;
  frecuencia: FrecuenciaEntreno;
  /** Días elegidos en modo "libre" (0 = lunes … 6 = domingo). */
  diasLibres: number[];
}

export interface Macros {
  kcal: number;
  proteinaG: number;
  carbosG: number;
  grasasG: number;
}

export interface ComidaPropia extends Macros {
  id: string;
  tiempo: TiempoComidaId;
  nombre: string;
  detalle: string;
}

export interface EjercicioRutina {
  uid: string;
  tipo: ExerciseType;
  series: number;
  /** Repeticiones por serie (por lado en ejercicios unilaterales). */
  reps: number;
}

export interface RutinaPropia {
  id: string;
  nombre: string;
  /** Días de la semana (0 = lunes … 6 = domingo). */
  dias: number[];
  ejercicios: EjercicioRutina[];
}

/** Avance de un día concreto. */
export interface RegistroDia {
  /** Comidas marcadas: 'ia:<tiempo>' o 'propia:<id>'. */
  comidas: string[];
  /** Series completadas por ejercicio: clave → número de series. */
  series: Record<string, number>;
}

/** Todo lo que el usuario decide sobre cómo comer y entrenar (persistido por usuario). */
export interface DatosPlanUsuario {
  configIA: ConfigPlanIA;
  /** true después de pulsar "Seguir este plan". */
  planIAActivo: boolean;
  modoNutricion: ModoFuente;
  modoRutinas: ModoFuente;
  /** Opción elegida para cada comida del Plan IA (índice). */
  opcionesComidaIA: Partial<Record<TiempoComidaId, number>>;
  comidasPropias: ComidaPropia[];
  rutinasPropias: RutinaPropia[];
  rutinaPropiaActivaId: string | null;
  /** Seguimiento diario por fecha 'AAAA-MM-DD'. */
  registro: Record<string, RegistroDia>;
}

export const DATOS_PLAN_INICIALES: DatosPlanUsuario = {
  configIA: { objetivo: 'automatico', frecuencia: 'alterno', diasLibres: [0, 2, 4] },
  planIAActivo: false,
  modoNutricion: 'ia',
  modoRutinas: 'ia',
  opcionesComidaIA: {},
  comidasPropias: [],
  rutinasPropias: [],
  rutinaPropiaActivaId: null,
  registro: {},
};

export const REGISTRO_VACIO: RegistroDia = { comidas: [], series: {} };

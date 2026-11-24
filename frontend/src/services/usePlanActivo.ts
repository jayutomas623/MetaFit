/**
 * Fuente única del "plan activo" para toda la app (Dashboard, Nutrición, Mis Rutinas y
 * Plan personalizado). Combina el perfil, la configuración del Plan IA, la dieta y las
 * rutinas propias y el registro de hoy, según el modo elegido por el usuario.
 */
import { useMemo } from 'react';
import { useStore, datosPlanDe } from './useStore';
import { generarPlan, PlanPersonalizado } from './recomendador';
import { claveFecha, indiceDia, NOMBRES_DIAS } from './fechas';
import { DatosPlanUsuario, Macros, REGISTRO_VACIO, RutinaPropia, TIEMPOS_COMIDA, TiempoComidaId } from '../models/Plan';
import { listaEjerciciosEjemplo } from '../models/Ejercicio';
import { esUnilateral, ExerciseType } from './exerciseEngine';

export interface ComidaHoy extends Macros {
  /** Clave de seguimiento: 'ia:<tiempo>' o 'propia:<id>'. */
  clave: string;
  tiempo: TiempoComidaId;
  nombre: string;
  detalle: string;
  hecha: boolean;
}

export interface EjercicioHoy {
  key: string;
  tipo: ExerciseType;
  nombre: string;
  series: number;
  reps: number;
  unilateral: boolean;
  seriesHechas: number;
}

export interface ResumenHoy {
  fecha: string;
  indiceDia: number;
  nombreDia: string;
  // Nutrición
  comidas: ComidaHoy[];
  objetivo: Macros;
  consumido: Macros;
  // Entrenamiento
  tituloEntreno: string;
  esDescanso: boolean;
  complemento: string | null;
  ejercicios: EjercicioHoy[];
  seriesHechas: number;
  seriesTotales: number;
  /** 0 – 1 */
  progresoEntreno: number;
  rutinaPropiaActiva: RutinaPropia | null;
}

const sumar = (lista: Macros[]): Macros =>
  lista.reduce(
    (a, m) => ({
      kcal: a.kcal + m.kcal,
      proteinaG: a.proteinaG + m.proteinaG,
      carbosG: a.carbosG + m.carbosG,
      grasasG: a.grasasG + m.grasasG,
    }),
    { kcal: 0, proteinaG: 0, carbosG: 0, grasasG: 0 }
  );

const nombreEjercicio = (tipo: ExerciseType) =>
  listaEjerciciosEjemplo.find((e) => e.engineType === tipo)?.nombre ?? tipo;

export function calcularResumenHoy(plan: PlanPersonalizado, datos: DatosPlanUsuario, fecha = new Date()): ResumenHoy {
  const clave = claveFecha(fecha);
  const dia = indiceDia(fecha);
  const registro = datos.registro[clave] ?? REGISTRO_VACIO;

  // --- Nutrición de hoy según el modo elegido ---
  let comidas: ComidaHoy[];
  if (datos.modoNutricion === 'ia') {
    comidas = plan.comidas.map((t) => {
      const idx = Math.min(datos.opcionesComidaIA[t.id] ?? 0, t.opciones.length - 1);
      const o = t.opciones[idx];
      const c = `ia:${t.id}`;
      return {
        clave: c,
        tiempo: t.id,
        nombre: o.nombre,
        detalle: o.items.map((i) => `${i.alimento} (${i.porcion})`).join(', '),
        kcal: o.kcal,
        proteinaG: o.proteinaG,
        carbosG: o.carbosG,
        grasasG: o.grasasG,
        hecha: registro.comidas.includes(c),
      };
    });
  } else {
    const orden = TIEMPOS_COMIDA.map((t) => t.id);
    comidas = [...datos.comidasPropias]
      .sort((a, b) => orden.indexOf(a.tiempo) - orden.indexOf(b.tiempo))
      .map((cp) => {
        const c = `propia:${cp.id}`;
        return { ...cp, clave: c, hecha: registro.comidas.includes(c) };
      });
  }

  // --- Entrenamiento de hoy según el modo elegido ---
  const rutinaPropiaActiva = datos.rutinasPropias.find((r) => r.id === datos.rutinaPropiaActivaId) ?? null;
  let tituloEntreno = 'Descanso';
  let complemento: string | null = null;
  let base: Omit<EjercicioHoy, 'seriesHechas'>[] = [];

  if (datos.modoRutinas === 'ia') {
    const d = plan.semana[dia];
    tituloEntreno = d.titulo;
    complemento = d.complemento;
    base = d.ejercicios;
  } else if (rutinaPropiaActiva) {
    if (rutinaPropiaActiva.dias.includes(dia)) {
      tituloEntreno = rutinaPropiaActiva.nombre;
      base = rutinaPropiaActiva.ejercicios.map((e) => ({
        key: `propia:${rutinaPropiaActiva.id}:${e.uid}`,
        tipo: e.tipo,
        nombre: nombreEjercicio(e.tipo),
        series: e.series,
        reps: e.reps,
        unilateral: esUnilateral(e.tipo),
      }));
    } else {
      complemento = `"${rutinaPropiaActiva.nombre}" no toca hoy.`;
    }
  } else {
    tituloEntreno = 'Sin rutina activa';
    complemento = 'Crea o activa una rutina propia para hacerle seguimiento.';
  }

  const ejercicios = base.map((e) => ({ ...e, seriesHechas: Math.min(e.series, registro.series[e.key] ?? 0) }));
  const seriesTotales = ejercicios.reduce((a, e) => a + e.series, 0);
  const seriesHechas = ejercicios.reduce((a, e) => a + e.seriesHechas, 0);

  return {
    fecha: clave,
    indiceDia: dia,
    nombreDia: NOMBRES_DIAS[dia],
    comidas,
    objetivo: plan.macros,
    consumido: sumar(comidas.filter((c) => c.hecha)),
    tituloEntreno,
    esDescanso: ejercicios.length === 0,
    complemento,
    ejercicios,
    seriesHechas,
    seriesTotales,
    progresoEntreno: seriesTotales > 0 ? seriesHechas / seriesTotales : 0,
    rutinaPropiaActiva,
  };
}

export function usePlanActivo() {
  const usuario = useStore((s) => s.usuarioActual);
  const planes = useStore((s) => s.planes);

  const datos = useMemo(() => datosPlanDe({ planes, usuarioActual: usuario }), [planes, usuario]);

  const plan = useMemo(
    () =>
      usuario
        ? generarPlan(
            {
              peso: usuario.peso,
              estatura: usuario.estatura,
              edad: usuario.edad,
              genero: usuario.genero,
              actividadSemanal: usuario.actividadSemanal,
            },
            datos.configIA
          )
        : null,
    [usuario?.peso, usuario?.estatura, usuario?.edad, usuario?.genero, usuario?.actividadSemanal, datos.configIA]
  );

  const hoy = useMemo(() => (plan ? calcularResumenHoy(plan, datos) : null), [plan, datos]);

  return { usuario, datos, plan, hoy };
}

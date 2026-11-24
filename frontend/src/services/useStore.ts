import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ComidaPropia,
  ConfigPlanIA,
  DATOS_PLAN_INICIALES,
  DatosPlanUsuario,
  ModoFuente,
  REGISTRO_VACIO,
  RutinaPropia,
  TiempoComidaId,
} from '../models/Plan';
import { claveFecha } from './fechas';

// Similar to PerfilUsuario in Dart
export interface PerfilUsuario {
  nombre: string;
  correo: string;
  estatura: number;
  peso: number;
  edad: number;
  genero: 'M' | 'F';
  evaluacionCompletada: boolean;
  avatarIndex: number;
  avatarUri?: string;
  actividadSemanal: number[]; // Puntos ganados de Lunes a Domingo
}

interface AppState {
  estaAutenticado: boolean;
  usuarioActual: PerfilUsuario | null;
  /** Plan IA, dieta propia, rutinas propias y seguimiento diario, por usuario (clave: correo). */
  planes: Record<string, DatosPlanUsuario>;

  // Actions
  iniciarSesion: (perfil: Partial<PerfilUsuario> & { correo: string, nombre: string }) => void;
  cerrarSesion: () => void;
  actualizarEvaluacion: (datos: Partial<PerfilUsuario>) => void;
  sumarPuntosActividad: (puntos: number) => void;

  // Plan personalizado (IA)
  actualizarConfigIA: (config: Partial<ConfigPlanIA>) => void;
  seguirPlanIA: () => void;
  dejarPlanIA: () => void;
  elegirOpcionComidaIA: (tiempo: TiempoComidaId, indice: number) => void;

  // Fuente elegida en Nutrición / Mis Rutinas
  setModoNutricion: (modo: ModoFuente) => void;
  setModoRutinas: (modo: ModoFuente) => void;

  // Dieta propia
  guardarComidaPropia: (comida: ComidaPropia) => void;
  eliminarComidaPropia: (id: string) => void;

  // Rutinas propias
  guardarRutinaPropia: (rutina: RutinaPropia) => void;
  eliminarRutinaPropia: (id: string) => void;
  activarRutinaPropia: (id: string | null) => void;

  // Seguimiento diario
  alternarComidaHoy: (clave: string) => void;
  registrarSerieHoy: (claveEjercicio: string, totalSeries: number) => void;
}

/** Clave del usuario para separar los datos de plan entre cuentas del mismo celular. */
export const claveUsuario = (u: PerfilUsuario | null): string => (u?.correo || u?.nombre || 'local').toLowerCase();

/** Datos de plan del usuario actual, con valores por defecto si aún no existen. */
export const datosPlanDe = (state: Pick<AppState, 'planes' | 'usuarioActual'>): DatosPlanUsuario => {
  const guardado = state.planes[claveUsuario(state.usuarioActual)];
  return guardado
    ? { ...DATOS_PLAN_INICIALES, ...guardado, configIA: { ...DATOS_PLAN_INICIALES.configIA, ...guardado.configIA } }
    : DATOS_PLAN_INICIALES;
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      /** Aplica un cambio a los datos de plan del usuario actual. */
      const actualizarPlan = (fn: (d: DatosPlanUsuario) => Partial<DatosPlanUsuario>) => {
        set((state) => {
          const actual = datosPlanDe(state);
          return {
            planes: { ...state.planes, [claveUsuario(state.usuarioActual)]: { ...actual, ...fn(actual) } },
          };
        });
      };

      /** Aplica un cambio al registro de HOY del usuario actual. */
      const actualizarHoy = (fn: (r: DatosPlanUsuario['registro'][string]) => DatosPlanUsuario['registro'][string]) => {
        const hoy = claveFecha();
        actualizarPlan((d) => ({
          registro: { ...d.registro, [hoy]: fn(d.registro[hoy] ?? REGISTRO_VACIO) },
        }));
      };

      return {
        estaAutenticado: false,
        usuarioActual: null,
        planes: {},

        iniciarSesion: (perfil) => {
          set((state) => {
            const prev = state.usuarioActual;
            const esMismoUsuario = prev && (!perfil.correo || prev.correo === perfil.correo || prev.nombre === perfil.nombre);

            return {
              estaAutenticado: true,
              usuarioActual: {
                nombre: perfil.nombre || prev?.nombre || 'Usuario',
                correo: perfil.correo || prev?.correo || '',
                estatura: perfil.estatura ?? (esMismoUsuario ? prev.estatura : 175.0),
                peso: perfil.peso ?? (esMismoUsuario ? prev.peso : 74.0),
                edad: perfil.edad ?? (esMismoUsuario ? prev.edad : 24),
                genero: perfil.genero ?? (esMismoUsuario ? prev.genero : 'M'),
                evaluacionCompletada: true,
                avatarIndex: perfil.avatarIndex ?? (esMismoUsuario ? prev.avatarIndex : 0),
                avatarUri: perfil.avatarUri !== undefined ? perfil.avatarUri : (esMismoUsuario ? prev.avatarUri : undefined),
                actividadSemanal: perfil.actividadSemanal ?? prev?.actividadSemanal ?? [0, 0, 0, 0, 0, 0, 0],
              },
            };
          });
        },

        cerrarSesion: () => {
          set({ estaAutenticado: false }); // Mantiene el perfil guardado en almacenamiento local
        },

        actualizarEvaluacion: (datos) => {
          set((state) => ({
            usuarioActual: state.usuarioActual
              ? { ...state.usuarioActual, ...datos, evaluacionCompletada: true }
              : null,
          }));
        },

        sumarPuntosActividad: (puntos) => {
          set((state) => {
            if (!state.usuarioActual) return state;

            const hoy = new Date().getDay(); // 0 is Sunday, 1 is Monday...
            // Map to index where 0 is Lunes and 6 is Domingo
            const index = hoy === 0 ? 6 : hoy - 1;

            const nuevaActividad = [...(state.usuarioActual.actividadSemanal || [0,0,0,0,0,0,0])];
            nuevaActividad[index] += puntos;

            return {
              usuarioActual: {
                ...state.usuarioActual,
                actividadSemanal: nuevaActividad
              }
            };
          });
        },

        // --- Plan personalizado (IA) ---------------------------------------
        actualizarConfigIA: (config) =>
          actualizarPlan((d) => ({ configIA: { ...d.configIA, ...config } })),

        seguirPlanIA: () =>
          actualizarPlan(() => ({ planIAActivo: true, modoNutricion: 'ia', modoRutinas: 'ia' })),

        dejarPlanIA: () => actualizarPlan(() => ({ planIAActivo: false })),

        elegirOpcionComidaIA: (tiempo, indice) =>
          actualizarPlan((d) => ({ opcionesComidaIA: { ...d.opcionesComidaIA, [tiempo]: indice } })),

        setModoNutricion: (modo) => actualizarPlan(() => ({ modoNutricion: modo })),
        setModoRutinas: (modo) => actualizarPlan(() => ({ modoRutinas: modo })),

        // --- Dieta propia ----------------------------------------------------
        guardarComidaPropia: (comida) =>
          actualizarPlan((d) => {
            const existe = d.comidasPropias.some((c) => c.id === comida.id);
            return {
              comidasPropias: existe
                ? d.comidasPropias.map((c) => (c.id === comida.id ? comida : c))
                : [...d.comidasPropias, comida],
            };
          }),

        eliminarComidaPropia: (id) =>
          actualizarPlan((d) => ({ comidasPropias: d.comidasPropias.filter((c) => c.id !== id) })),

        // --- Rutinas propias -------------------------------------------------
        guardarRutinaPropia: (rutina) =>
          actualizarPlan((d) => {
            const existe = d.rutinasPropias.some((r) => r.id === rutina.id);
            return {
              rutinasPropias: existe
                ? d.rutinasPropias.map((r) => (r.id === rutina.id ? rutina : r))
                : [...d.rutinasPropias, rutina],
              // La primera rutina creada queda activa para el seguimiento.
              rutinaPropiaActivaId: d.rutinaPropiaActivaId ?? rutina.id,
            };
          }),

        eliminarRutinaPropia: (id) =>
          actualizarPlan((d) => ({
            rutinasPropias: d.rutinasPropias.filter((r) => r.id !== id),
            rutinaPropiaActivaId: d.rutinaPropiaActivaId === id ? null : d.rutinaPropiaActivaId,
          })),

        activarRutinaPropia: (id) => actualizarPlan(() => ({ rutinaPropiaActivaId: id })),

        // --- Seguimiento diario ------------------------------------------------
        alternarComidaHoy: (clave) =>
          actualizarHoy((r) => ({
            ...r,
            comidas: r.comidas.includes(clave) ? r.comidas.filter((c) => c !== clave) : [...r.comidas, clave],
          })),

        registrarSerieHoy: (claveEjercicio, totalSeries) =>
          actualizarHoy((r) => ({
            ...r,
            series: { ...r.series, [claveEjercicio]: Math.min(totalSeries, (r.series[claveEjercicio] ?? 0) + 1) },
          })),
      };
    },
    {
      name: 'metafit-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Solo se persisten datos, no funciones. `planes` arranca vacío en instalaciones previas.
      partialize: (state) => ({
        estaAutenticado: state.estaAutenticado,
        usuarioActual: state.usuarioActual,
        planes: state.planes,
      }),
    }
  )
);

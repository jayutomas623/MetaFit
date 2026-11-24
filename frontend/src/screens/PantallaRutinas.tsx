import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { ColoresApp } from '../theme/colors';
import { useStore } from '../services/useStore';
import { usePlanActivo } from '../services/usePlanActivo';
import { listaEjerciciosEjemplo, Ejercicio } from '../models/Ejercicio';
import { EjercicioRutina, RutinaPropia } from '../models/Plan';
import { esUnilateral, ExerciseType } from '../services/exerciseEngine';
import { nuevoId, resumenDias } from '../services/fechas';
import { ModalCamaraBiomecanica, DetalleSerie } from '../components/ModalCamaraBiomecanica';
import { BarraProgreso, SelectorDias, SelectorModo, Stepper, est } from '../components/plan/ui';

interface SesionCamara {
  ejercicio: Ejercicio;
  clave: string;
  series: number;
  reps: number;
}

const ejercicioDe = (tipo: ExerciseType) => listaEjerciciosEjemplo.find((e) => e.engineType === tipo)!;

export const PantallaRutinas = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { datos, plan, hoy } = usePlanActivo();
  const setModoRutinas = useStore((s) => s.setModoRutinas);
  const registrarSerieHoy = useStore((s) => s.registrarSerieHoy);
  const sumarPuntosActividad = useStore((s) => s.sumarPuntosActividad);
  const activarRutinaPropia = useStore((s) => s.activarRutinaPropia);
  const eliminarRutinaPropia = useStore((s) => s.eliminarRutinaPropia);
  const seguirPlanIA = useStore((s) => s.seguirPlanIA);

  const [sesion, setSesion] = useState<SesionCamara | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [rutinaEditando, setRutinaEditando] = useState<RutinaPropia | null>(null);

  if (!plan || !hoy) return null;

  const iniciarCamara = (tipo: ExerciseType, clave: string, series: number, reps: number) => {
    setSesion({ ejercicio: ejercicioDe(tipo), clave, series, reps });
  };

  // Al terminar la serie en la cámara: se marca el avance de hoy y se suman puntos.
  const alCompletarSerie = (reps: number, _detalle: DetalleSerie) => {
    if (!sesion || reps <= 0) return;
    registrarSerieHoy(sesion.clave, sesion.series);
    sumarPuntosActividad(reps * 5);
  };

  const confirmarEliminar = (r: RutinaPropia) => {
    Alert.alert('Eliminar rutina', `¿Eliminar "${r.nombre}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => eliminarRutinaPropia(r.id) },
    ]);
  };

  const modoIA = datos.modoRutinas === 'ia';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCentrado}>
          <Text style={styles.subtituloCentrado}>PLANES DE ENTRENAMIENTO</Text>
          <Text style={styles.tituloNegroCentrado}>MIS RUTINAS</Text>
        </View>

        <SelectorModo
          opciones={[
            { id: 'ia', etiqueta: 'Rutina del Plan (IA)', icono: 'sparkles-outline' },
            { id: 'propio', etiqueta: 'Mis Rutinas Propias', icono: 'create-outline' },
          ]}
          valor={datos.modoRutinas}
          onCambiar={setModoRutinas}
        />

        {/* SEGUIMIENTO DE HOY */}
        <View style={est.card}>
          <Text style={est.cardTitulo}>SEGUIMIENTO DE HOY</Text>
          <View style={[est.filaEntre, { marginBottom: 6 }]}>
            <Text style={styles.hoyDia}>{hoy.nombreDia.toUpperCase()}</Text>
            <Text style={[styles.hoyTitulo, hoy.esDescanso && { color: '#64748B' }]} numberOfLines={1}>
              {hoy.esDescanso && modoIA ? 'Día de descanso' : hoy.tituloEntreno}
            </Text>
          </View>

          {hoy.esDescanso ? (
            <View style={[est.fila, { marginTop: 4 }]}>
              <Ionicons name="bed-outline" size={20} color="#64748B" style={{ marginRight: 8 }} />
              <Text style={[est.texto, { flex: 1 }]}>
                {hoy.complemento ?? 'Hoy no hay ejercicios programados. Descansa y recupérate.'}
              </Text>
            </View>
          ) : (
            <>
              <View style={[est.filaEntre, { marginBottom: 4 }]}>
                <Text style={est.nota}>
                  {hoy.seriesHechas} de {hoy.seriesTotales} series
                </Text>
                <Text style={styles.porcentaje}>{Math.round(hoy.progresoEntreno * 100)}%</Text>
              </View>
              <BarraProgreso valor={hoy.progresoEntreno} color={hoy.progresoEntreno >= 1 ? '#10B981' : ColoresApp.primario} />
              {hoy.ejercicios.map((e) => {
                const completo = e.seriesHechas >= e.series;
                return (
                  <View key={e.key} style={styles.ejercicioFila}>
                    <Ionicons
                      name={completo ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={completo ? '#10B981' : '#CBD5E1'}
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ejercicioNombre}>{e.nombre}</Text>
                      <Text style={est.nota}>
                        {e.seriesHechas}/{e.series} series · {e.reps} reps{e.unilateral ? ' por lado' : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.botonCamara, completo && { backgroundColor: '#94A3B8' }]}
                      onPress={() => iniciarCamara(e.tipo, e.key, e.series, e.reps)}
                      activeOpacity={0.85}
                      accessibilityLabel={`Iniciar ${e.nombre} con cámara`}
                    >
                      <Ionicons name="videocam" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                      <Text style={styles.botonCamaraTexto}>{completo ? 'OTRA' : 'INICIAR'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
              {hoy.complemento && <Text style={[est.nota, { marginTop: 10 }]}>+ {hoy.complemento}</Text>}
            </>
          )}
        </View>

        {modoIA ? (
          <>
            {!datos.planIAActivo && (
              <View style={est.card}>
                <Text style={[est.texto, { marginBottom: 10 }]}>
                  Esta rutina se calculó con tus medidas ({plan.tituloEnfoque.toLowerCase()}). Actívala para seguirla
                  también en Nutrición.
                </Text>
                <TouchableOpacity style={est.botonPrimario} onPress={seguirPlanIA}>
                  <Text style={est.botonPrimarioTexto}>SEGUIR ESTE PLAN</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={est.card}>
              <View style={[est.filaEntre, { marginBottom: 4 }]}>
                <Text style={est.subtituloSeccion}>SEMANA DEL PLAN</Text>
                <TouchableOpacity onPress={() => navigation.navigate('PlanPersonalizado')}>
                  <Text style={styles.enlace}>Ajustar plan ›</Text>
                </TouchableOpacity>
              </View>
              <Text style={[est.nota, { marginBottom: 6 }]}>
                Entrenas: {resumenDias(plan.diasEntreno)} · {plan.descansoEntreSeries}
              </Text>
              {plan.semana.map((d) => (
                <View key={d.dia} style={[styles.diaFila, d.indice === hoy.indiceDia && styles.diaHoy]}>
                  <Text style={styles.diaNombre}>{d.dia.slice(0, 3).toUpperCase()}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.diaTitulo, !d.entrena && { color: '#94A3B8' }]}>{d.titulo}</Text>
                    {d.ejercicios.length > 0 && (
                      <Text style={est.nota} numberOfLines={2}>
                        {d.ejercicios.map((e) => `${e.nombre} ${e.series}×${e.reps}`).join(' · ')}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            {datos.rutinasPropias.length === 0 ? (
              <View style={[est.card, { alignItems: 'center', paddingVertical: 28 }]}>
                <Ionicons name="barbell-outline" size={40} color="#94A3B8" />
                <Text style={[styles.ejercicioNombre, { marginTop: 10 }]}>Aún no tienes rutinas propias</Text>
                <Text style={[est.nota, { textAlign: 'center', marginTop: 4 }]}>
                  Crea una con los ejercicios de la app, elige sus días y actívala para seguirla cada día.
                </Text>
              </View>
            ) : (
              datos.rutinasPropias.map((r) => {
                const activa = r.id === datos.rutinaPropiaActivaId;
                return (
                  <View key={r.id} style={[est.card, activa && styles.cardActiva]}>
                    <View style={est.filaEntre}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rutinaNombre}>{r.nombre}</Text>
                        <Text style={est.nota}>
                          {resumenDias(r.dias)} · {r.ejercicios.length} ejercicios
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[est.botonIcono, { marginLeft: 6 }]}
                        onPress={() => {
                          setRutinaEditando(r);
                          setFormVisible(true);
                        }}
                        accessibilityLabel="Editar rutina"
                      >
                        <Ionicons name="create-outline" size={16} color="#000000" />
                      </TouchableOpacity>
                      <TouchableOpacity style={[est.botonIcono, { marginLeft: 6 }]} onPress={() => confirmarEliminar(r)} accessibilityLabel="Eliminar rutina">
                        <Ionicons name="trash-outline" size={16} color={ColoresApp.primario} />
                      </TouchableOpacity>
                    </View>

                    {r.ejercicios.map((e) => (
                      <View key={e.uid} style={styles.ejercicioFila}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.ejercicioNombreChico}>{ejercicioDe(e.tipo).nombre}</Text>
                          <Text style={est.nota}>
                            {e.series} × {e.reps}
                            {esUnilateral(e.tipo) ? ' por lado' : ''}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={est.botonIcono}
                          onPress={() => iniciarCamara(e.tipo, `propia:${r.id}:${e.uid}`, e.series, e.reps)}
                          accessibilityLabel="Iniciar con cámara"
                        >
                          <Ionicons name="videocam-outline" size={16} color={ColoresApp.primario} />
                        </TouchableOpacity>
                      </View>
                    ))}

                    <TouchableOpacity
                      style={[activa ? est.botonSecundario : est.botonPrimario, { marginTop: 12 }]}
                      onPress={() => activarRutinaPropia(activa ? null : r.id)}
                      activeOpacity={0.88}
                    >
                      {activa && <Ionicons name="checkmark-circle" size={16} color="#10B981" style={{ marginRight: 6 }} />}
                      <Text style={activa ? est.botonSecundarioTexto : est.botonPrimarioTexto}>
                        {activa ? 'RUTINA ACTIVA · tocar para desactivar' : 'ACTIVAR PARA SEGUIMIENTO'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {!modoIA && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.fab}
          onPress={() => {
            setRutinaEditando(null);
            setFormVisible(true);
          }}
          accessibilityLabel="Crear rutina"
        >
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </TouchableOpacity>
      )}

      <FormRutina visible={formVisible} rutina={rutinaEditando} onCerrar={() => setFormVisible(false)} />

      {/* Cámara IA con la meta de repeticiones del ejercicio */}
      <ModalCamaraBiomecanica
        visible={sesion !== null}
        ejercicio={sesion?.ejercicio ?? null}
        metaReps={sesion?.reps}
        onCerrar={() => setSesion(null)}
        onCompletarSerie={alCompletarSerie}
      />
    </SafeAreaView>
  );
};

/** Crear / editar una rutina propia: nombre, días y ejercicios con series y repeticiones. */
const FormRutina = ({ visible, rutina, onCerrar }: { visible: boolean; rutina: RutinaPropia | null; onCerrar: () => void }) => {
  const guardarRutinaPropia = useStore((s) => s.guardarRutinaPropia);
  const [nombre, setNombre] = useState('');
  const [dias, setDias] = useState<number[]>([0, 2, 4]);
  const [ejercicios, setEjercicios] = useState<EjercicioRutina[]>([]);

  React.useEffect(() => {
    if (!visible) return;
    setNombre(rutina?.nombre ?? '');
    setDias(rutina?.dias ?? [0, 2, 4]);
    setEjercicios(rutina?.ejercicios ?? []);
  }, [visible, rutina]);

  const alternar = (tipo: ExerciseType) => {
    setEjercicios((prev) =>
      prev.some((e) => e.tipo === tipo)
        ? prev.filter((e) => e.tipo !== tipo)
        : [...prev, { uid: nuevoId(), tipo, series: 3, reps: 10 }]
    );
  };

  const actualizar = (tipo: ExerciseType, cambio: Partial<EjercicioRutina>) => {
    setEjercicios((prev) => prev.map((e) => (e.tipo === tipo ? { ...e, ...cambio } : e)));
  };

  const guardar = () => {
    if (!nombre.trim()) return Alert.alert('Falta el nombre', 'Escribe un nombre para tu rutina.');
    if (dias.length === 0) return Alert.alert('Elige los días', 'Selecciona al menos un día de la semana.');
    if (ejercicios.length === 0) return Alert.alert('Sin ejercicios', 'Agrega al menos un ejercicio.');
    guardarRutinaPropia({ id: rutina?.id ?? nuevoId(), nombre: nombre.trim(), dias, ejercicios });
    onCerrar();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCerrar}>
      <View style={est.modalFondo}>
        <View style={est.modalHoja}>
          <View style={[est.filaEntre, { marginBottom: 14 }]}>
            <Text style={est.modalTitulo}>{rutina ? 'EDITAR RUTINA' : 'NUEVA RUTINA'}</Text>
            <TouchableOpacity style={est.botonIcono} onPress={onCerrar} accessibilityLabel="Cerrar">
              <Ionicons name="close" size={18} color="#000000" />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <TextInput style={est.input} placeholder="Nombre de la rutina" placeholderTextColor="#94A3B8" value={nombre} onChangeText={setNombre} />
            <Text style={est.subtituloSeccion}>DÍAS DE LA SEMANA</Text>
            <SelectorDias dias={dias} onCambiar={setDias} />

            <Text style={est.subtituloSeccion}>EJERCICIOS</Text>
            {listaEjerciciosEjemplo.map((ej) => {
              const sel = ejercicios.find((e) => e.tipo === ej.engineType);
              const unilateral = esUnilateral(ej.engineType);
              return (
                <View key={ej.id} style={[styles.formEjercicio, sel && styles.formEjercicioActivo]}>
                  <TouchableOpacity style={est.filaEntre} onPress={() => alternar(ej.engineType)} activeOpacity={0.8}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ejercicioNombreChico}>{ej.nombre}</Text>
                      <Text style={est.nota}>
                        {ej.grupoMuscular}
                        {unilateral ? ' · un lado a la vez' : ''}
                      </Text>
                    </View>
                    <Ionicons name={sel ? 'checkbox' : 'square-outline'} size={22} color={sel ? ColoresApp.primario : '#CBD5E1'} />
                  </TouchableOpacity>
                  {sel && (
                    <View style={[est.filaEntre, { marginTop: 10 }]}>
                      <View style={est.fila}>
                        <Text style={[est.nota, { marginRight: 6 }]}>Series</Text>
                        <Stepper valor={sel.series} onCambiar={(v) => actualizar(ej.engineType, { series: v })} max={10} />
                      </View>
                      <View style={est.fila}>
                        <Text style={[est.nota, { marginRight: 6 }]}>{unilateral ? 'Reps/lado' : 'Reps'}</Text>
                        <Stepper valor={sel.reps} onCambiar={(v) => actualizar(ej.engineType, { reps: v })} max={50} />
                      </View>
                    </View>
                  )}
                </View>
              );
            })}

            <TouchableOpacity style={[est.botonPrimario, { marginTop: 8 }]} onPress={guardar} activeOpacity={0.88}>
              <Text style={est.botonPrimarioTexto}>GUARDAR RUTINA</Text>
            </TouchableOpacity>
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAFAFA' },
  scroll: { paddingHorizontal: 18, paddingTop: 8 },
  headerCentrado: { alignItems: 'center', marginBottom: 16, paddingTop: 8 },
  subtituloCentrado: { fontSize: 10, fontWeight: '800', color: '#64748B', letterSpacing: 1.2 },
  tituloNegroCentrado: { fontSize: 20, fontWeight: '900', color: '#000000', letterSpacing: 0.5 },
  hoyDia: { fontSize: 12, fontWeight: '900', color: '#000000', letterSpacing: 1 },
  hoyTitulo: { fontSize: 12, fontWeight: '800', color: ColoresApp.primario, flexShrink: 1, marginLeft: 10 },
  porcentaje: { fontSize: 12, fontWeight: '900', color: '#000000' },
  ejercicioFila: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10, marginTop: 10 },
  ejercicioNombre: { fontSize: 13, fontWeight: '800', color: '#000000' },
  ejercicioNombreChico: { fontSize: 12, fontWeight: '800', color: '#000000' },
  botonCamara: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ColoresApp.primario,
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  botonCamaraTexto: { fontSize: 10, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5 },
  enlace: { fontSize: 11, fontWeight: '800', color: ColoresApp.primario },
  diaFila: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10 },
  diaHoy: { backgroundColor: '#FFF1F2' },
  diaNombre: { width: 42, fontSize: 11, fontWeight: '900', color: '#000000', letterSpacing: 0.6 },
  diaTitulo: { fontSize: 12, fontWeight: '800', color: '#000000' },
  cardActiva: { borderColor: '#A7F3D0' },
  rutinaNombre: { fontSize: 14, fontWeight: '900', color: '#000000' },
  formEjercicio: { borderWidth: 1, borderColor: '#F1F5F9', borderRadius: 12, padding: 12, marginBottom: 8 },
  formEjercicioActivo: { borderColor: ColoresApp.primario, backgroundColor: '#FFF7F8' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: ColoresApp.primario,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ColoresApp.primario,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
});

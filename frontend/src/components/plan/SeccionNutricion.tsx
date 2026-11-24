/**
 * Contenido de la pestaña Nutrición: resumen de hoy + Plan Recomendado (IA) o Mi Dieta Propia.
 * Todo se guarda localmente (Zustand + AsyncStorage) por usuario y por fecha.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../services/useStore';
import { usePlanActivo } from '../../services/usePlanActivo';
import { nuevoId } from '../../services/fechas';
import { ComidaPropia, TIEMPOS_COMIDA, TiempoComidaId } from '../../models/Plan';
import { ColoresApp, ColoresMetricas } from '../../theme/colors';
import { BarraProgreso, Check, Chip, SelectorModo, est } from './ui';

export const SeccionNutricion = ({ onAbrirPlan }: { onAbrirPlan: () => void }) => {
  const { datos, plan, hoy } = usePlanActivo();
  const setModoNutricion = useStore((s) => s.setModoNutricion);
  const alternarComidaHoy = useStore((s) => s.alternarComidaHoy);
  const elegirOpcionComidaIA = useStore((s) => s.elegirOpcionComidaIA);
  const eliminarComidaPropia = useStore((s) => s.eliminarComidaPropia);
  const [editando, setEditando] = useState<ComidaPropia | null>(null);
  const [formVisible, setFormVisible] = useState(false);

  if (!plan || !hoy) return null;

  const abrirNueva = (tiempo: TiempoComidaId) => {
    setEditando({ id: '', tiempo, nombre: '', detalle: '', kcal: 0, proteinaG: 0, carbosG: 0, grasasG: 0 });
    setFormVisible(true);
  };

  const confirmarEliminar = (c: ComidaPropia) => {
    Alert.alert('Eliminar comida', `¿Eliminar "${c.nombre}" de tu dieta?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => eliminarComidaPropia(c.id) },
    ]);
  };

  const { objetivo, consumido } = hoy;
  const hechas = hoy.comidas.filter((c) => c.hecha).length;

  return (
    <>
      <SelectorModo
        opciones={[
          { id: 'ia', etiqueta: 'Plan Recomendado (IA)', icono: 'sparkles-outline' },
          { id: 'propio', etiqueta: 'Mi Dieta Propia', icono: 'create-outline' },
        ]}
        valor={datos.modoNutricion}
        onCambiar={setModoNutricion}
      />

      {/* RESUMEN DE HOY */}
      <View style={est.card}>
        <Text style={est.cardTitulo}>HOY · {hoy.nombreDia.toUpperCase()}</Text>
        <View style={[est.fila, { justifyContent: 'center', alignItems: 'flex-end' }]}>
          <Text style={styles.kcal}>{Math.round(consumido.kcal).toLocaleString()}</Text>
          <Text style={styles.kcalDe}> / {objetivo.kcal.toLocaleString()} KCAL</Text>
        </View>
        <View style={{ marginVertical: 8 }}>
          <BarraProgreso valor={consumido.kcal / (objetivo.kcal || 1)} color={ColoresMetricas.calorias} />
        </View>
        <Text style={[est.notaCentrada, { marginBottom: 10 }]}>
          {hechas} de {hoy.comidas.length} comidas completadas
          {datos.modoNutricion === 'propio' ? ' · objetivo según tu Plan IA' : ''}
        </Text>
        {[
          { n: 'PROTEÍNA', v: consumido.proteinaG, o: objetivo.proteinaG, color: ColoresMetricas.proteina },
          { n: 'CARBOHIDRATOS', v: consumido.carbosG, o: objetivo.carbosG, color: ColoresMetricas.carbos },
          { n: 'GRASAS', v: consumido.grasasG, o: objetivo.grasasG, color: ColoresMetricas.grasa },
        ].map((m) => (
          <View key={m.n} style={{ marginBottom: 8 }}>
            <View style={[est.filaEntre, { marginBottom: 3 }]}>
              <Text style={styles.macroNombre}>{m.n}</Text>
              <Text style={styles.macroValor}>
                {Math.round(m.v)} / {m.o} g
              </Text>
            </View>
            <BarraProgreso valor={m.v / (m.o || 1)} color={m.color} alto={4} />
          </View>
        ))}
        <View style={[est.fila, { marginTop: 4 }]}>
          <Ionicons name="water-outline" size={16} color={ColoresMetricas.proteina} style={{ marginRight: 6 }} />
          <Text style={est.nota}>
            Agua recomendada: {plan.aguaLitros} L ({plan.aguaEntrenoLitros} L si entrenas)
          </Text>
        </View>
      </View>

      {datos.modoNutricion === 'ia' ? (
        <>
          {!datos.planIAActivo && (
            <TouchableOpacity style={[est.card, est.fila]} onPress={onAbrirPlan} activeOpacity={0.88}>
              <Ionicons name="information-circle-outline" size={20} color={ColoresApp.primario} style={{ marginRight: 8 }} />
              <Text style={[est.texto, { flex: 1 }]}>
                Menú calculado para ti ({plan.tituloEnfoque.toLowerCase()}). Toca para ajustar tu objetivo y pulsar
                "Seguir este plan".
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#000000" />
            </TouchableOpacity>
          )}

          {plan.comidas.map((t) => {
            const idx = Math.min(datos.opcionesComidaIA[t.id] ?? 0, t.opciones.length - 1);
            const o = t.opciones[idx];
            const clave = `ia:${t.id}`;
            const hecha = hoy.comidas.find((c) => c.clave === clave)?.hecha ?? false;
            return (
              <View key={t.id} style={[est.card, hecha && styles.cardHecha]}>
                <View style={est.filaEntre}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tiempoNombre}>{t.nombre.toUpperCase()}</Text>
                    <Text style={est.nota}>
                      {t.horario} · ~{t.kcalObjetivo} kcal
                    </Text>
                  </View>
                  <Check marcado={hecha} onPress={() => alternarComidaHoy(clave)} />
                </View>
                <View style={[est.chipsFila, { marginTop: 10 }]}>
                  {t.opciones.map((op, i) => (
                    <Chip key={op.nombre} etiqueta={`Opción ${i + 1}`} activo={i === idx} onPress={() => elegirOpcionComidaIA(t.id, i)} />
                  ))}
                </View>
                <Text style={styles.opcionNombre}>{o.nombre}</Text>
                {o.items.map((it) => (
                  <View key={it.alimento} style={[est.filaEntre, { paddingVertical: 2 }]}>
                    <Text style={[est.texto, { flex: 1, paddingRight: 8 }]}>• {it.alimento}</Text>
                    <Text style={styles.porcion}>{it.porcion}</Text>
                  </View>
                ))}
                <Text style={[est.nota, { marginTop: 6 }]}>
                  {o.kcal} kcal · P {o.proteinaG} g · C {o.carbosG} g · G {o.grasasG} g
                </Text>
              </View>
            );
          })}
        </>
      ) : (
        TIEMPOS_COMIDA.map((t) => {
          const lista = hoy.comidas.filter((c) => c.tiempo === t.id);
          return (
            <View key={t.id} style={est.card}>
              <View style={est.filaEntre}>
                <View>
                  <Text style={styles.tiempoNombre}>{t.nombre.toUpperCase()}</Text>
                  <Text style={est.nota}>{t.horario}</Text>
                </View>
                <TouchableOpacity style={est.botonSecundario} onPress={() => abrirNueva(t.id)}>
                  <Ionicons name="add" size={14} color="#000000" style={{ marginRight: 4 }} />
                  <Text style={est.botonSecundarioTexto}>Agregar</Text>
                </TouchableOpacity>
              </View>
              {lista.length === 0 ? (
                <Text style={[est.nota, { marginTop: 10 }]}>Aún no agregaste comidas en este horario.</Text>
              ) : (
                lista.map((c) => {
                  const propia = datos.comidasPropias.find((cp) => `propia:${cp.id}` === c.clave)!;
                  return (
                    <View key={c.clave} style={styles.itemPropio}>
                      <Check marcado={c.hecha} onPress={() => alternarComidaHoy(c.clave)} style={{ marginRight: 10 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.opcionNombre}>{c.nombre}</Text>
                        {!!c.detalle && <Text style={est.nota}>{c.detalle}</Text>}
                        <Text style={[est.nota, { marginTop: 2 }]}>
                          {c.kcal} kcal · P {c.proteinaG} g · C {c.carbosG} g · G {c.grasasG} g
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[est.botonIcono, { marginLeft: 6 }]}
                        onPress={() => {
                          setEditando(propia);
                          setFormVisible(true);
                        }}
                        accessibilityLabel="Editar comida"
                      >
                        <Ionicons name="create-outline" size={16} color="#000000" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[est.botonIcono, { marginLeft: 6 }]}
                        onPress={() => confirmarEliminar(propia)}
                        accessibilityLabel="Eliminar comida"
                      >
                        <Ionicons name="trash-outline" size={16} color={ColoresApp.primario} />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </View>
          );
        })
      )}

      <FormComidaPropia
        visible={formVisible}
        comida={editando}
        onCerrar={() => {
          setFormVisible(false);
          setEditando(null);
        }}
      />
    </>
  );
};

/** Formulario para agregar o editar una comida de la dieta propia. */
const FormComidaPropia = ({
  visible,
  comida,
  onCerrar,
}: {
  visible: boolean;
  comida: ComidaPropia | null;
  onCerrar: () => void;
}) => {
  const guardarComidaPropia = useStore((s) => s.guardarComidaPropia);
  const [tiempo, setTiempo] = useState<TiempoComidaId>('desayuno');
  const [nombre, setNombre] = useState('');
  const [detalle, setDetalle] = useState('');
  const [kcal, setKcal] = useState('');
  const [p, setP] = useState('');
  const [c, setC] = useState('');
  const [g, setG] = useState('');

  // Cargar valores al abrir
  React.useEffect(() => {
    if (visible && comida) {
      setTiempo(comida.tiempo);
      setNombre(comida.nombre);
      setDetalle(comida.detalle);
      setKcal(comida.kcal ? String(comida.kcal) : '');
      setP(comida.proteinaG ? String(comida.proteinaG) : '');
      setC(comida.carbosG ? String(comida.carbosG) : '');
      setG(comida.grasasG ? String(comida.grasasG) : '');
    }
  }, [visible, comida]);

  const num = (v: string) => {
    const n = parseFloat(v.replace(',', '.'));
    return isNaN(n) || n < 0 ? 0 : Math.round(n);
  };

  const guardar = () => {
    if (!nombre.trim()) {
      Alert.alert('Falta el nombre', 'Escribe el nombre de la comida.');
      return;
    }
    const proteinaG = num(p);
    const carbosG = num(c);
    const grasasG = num(g);
    // Si no se indican calorías, se estiman a partir de los macros.
    const kcalFinal = num(kcal) || proteinaG * 4 + carbosG * 4 + grasasG * 9;
    guardarComidaPropia({
      id: comida?.id || nuevoId(),
      tiempo,
      nombre: nombre.trim(),
      detalle: detalle.trim(),
      kcal: kcalFinal,
      proteinaG,
      carbosG,
      grasasG,
    });
    onCerrar();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCerrar}>
      <View style={est.modalFondo}>
        <View style={est.modalHoja}>
          <View style={[est.filaEntre, { marginBottom: 14 }]}>
            <Text style={est.modalTitulo}>{comida?.id ? 'EDITAR COMIDA' : 'NUEVA COMIDA'}</Text>
            <TouchableOpacity style={est.botonIcono} onPress={onCerrar} accessibilityLabel="Cerrar">
              <Ionicons name="close" size={18} color="#000000" />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={est.subtituloSeccion}>HORARIO</Text>
            <View style={est.chipsFila}>
              {TIEMPOS_COMIDA.map((t) => (
                <Chip key={t.id} etiqueta={t.nombre} activo={tiempo === t.id} onPress={() => setTiempo(t.id)} />
              ))}
            </View>
            <TextInput style={est.input} placeholder="Nombre (ej. Arroz con pollo)" placeholderTextColor="#94A3B8" value={nombre} onChangeText={setNombre} />
            <TextInput
              style={[est.input, { minHeight: 60, textAlignVertical: 'top' }]}
              placeholder="Detalle / porciones (opcional)"
              placeholderTextColor="#94A3B8"
              value={detalle}
              onChangeText={setDetalle}
              multiline
            />
            <Text style={est.subtituloSeccion}>APORTE (OPCIONAL)</Text>
            <View style={styles.filaInputs}>
              <TextInput style={[est.input, styles.inputCorto]} placeholder="Kcal" placeholderTextColor="#94A3B8" keyboardType="numeric" value={kcal} onChangeText={setKcal} />
              <TextInput style={[est.input, styles.inputCorto]} placeholder="Prot. g" placeholderTextColor="#94A3B8" keyboardType="numeric" value={p} onChangeText={setP} />
              <TextInput style={[est.input, styles.inputCorto]} placeholder="Carb. g" placeholderTextColor="#94A3B8" keyboardType="numeric" value={c} onChangeText={setC} />
              <TextInput style={[est.input, styles.inputCorto]} placeholder="Grasa g" placeholderTextColor="#94A3B8" keyboardType="numeric" value={g} onChangeText={setG} />
            </View>
            <Text style={[est.nota, { marginBottom: 14 }]}>Si dejas las kcal vacías se calculan con los macros.</Text>
            <TouchableOpacity style={est.botonPrimario} onPress={guardar} activeOpacity={0.88}>
              <Text style={est.botonPrimarioTexto}>GUARDAR</Text>
            </TouchableOpacity>
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  kcal: { fontSize: 30, fontWeight: '900', color: '#000000' },
  kcalDe: { fontSize: 12, fontWeight: '900', color: '#94A3B8', marginBottom: 5 },
  macroNombre: { fontSize: 10, fontWeight: '800', color: '#000000' },
  macroValor: { fontSize: 10, fontWeight: '900', color: '#000000' },
  tiempoNombre: { fontSize: 13, fontWeight: '900', color: '#000000', letterSpacing: 0.6 },
  opcionNombre: { fontSize: 13, fontWeight: '800', color: '#000000', marginBottom: 3 },
  porcion: { fontSize: 12, fontWeight: '800', color: '#000000' },
  cardHecha: { borderColor: '#A7F3D0', backgroundColor: '#F7FEF9' },
  itemPropio: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10, marginTop: 10 },
  filaInputs: { flexDirection: 'row', gap: 6 },
  inputCorto: { flex: 1, paddingHorizontal: 8 },
});

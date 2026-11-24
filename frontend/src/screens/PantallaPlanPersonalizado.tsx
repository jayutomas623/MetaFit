import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useStore } from '../services/useStore';
import { usePlanActivo } from '../services/usePlanActivo';
import { FRECUENCIAS, OBJETIVOS } from '../services/recomendador';
import { resumenDias } from '../services/fechas';
import { ColoresApp, ColoresMetricas } from '../theme/colors';
import { BarraProgreso, Chip, SelectorDias, est } from '../components/plan/ui';

/**
 * Plan personalizado (IA): perfil, objetivo, frecuencia de entrenamiento, requerimientos,
 * comidas y rutina semanal. "Seguir este plan" lo activa en Nutrición y Mis Rutinas.
 */
export const PantallaPlanPersonalizado = () => {
  const navigation = useNavigation();
  const { usuario, datos, plan } = usePlanActivo();
  const actualizarConfigIA = useStore((s) => s.actualizarConfigIA);
  const seguirPlanIA = useStore((s) => s.seguirPlanIA);
  const dejarPlanIA = useStore((s) => s.dejarPlanIA);
  const elegirOpcionComidaIA = useStore((s) => s.elegirOpcionComidaIA);

  if (!usuario || !plan) return null;

  const { perfil, macros, config } = plan;
  const activo = datos.planIAActivo;
  const fueraDeRango = usuario.peso < perfil.pesoSaludableMin || usuario.peso > perfil.pesoSaludableMax;
  const textoAjuste =
    plan.ajusteCalorico === 0
      ? 'MANTENIMIENTO'
      : plan.ajusteCalorico < 0
      ? `DÉFICIT ${Math.abs(plan.ajusteCalorico)} KCAL`
      : `SUPERÁVIT +${plan.ajusteCalorico} KCAL`;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* CABECERA */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.botonCircular} onPress={() => navigation.goBack()} accessibilityLabel="Volver">
            <Ionicons name="chevron-back" size={22} color="#000000" />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.subtitulo}>{usuario.nombre.toUpperCase()}</Text>
            <Text style={styles.titulo}>PLAN PERSONALIZADO</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        {/* PERFIL */}
        <View style={est.card}>
          <Text style={est.cardTitulo}>TU PERFIL</Text>
          <View style={styles.kpis}>
            <View style={styles.kpi}>
              <Text style={styles.kpiValor}>{perfil.imc}</Text>
              <Text style={styles.kpiEtiqueta}>IMC</Text>
              <Text style={styles.kpiDetalle}>{perfil.categoriaImc}</Text>
            </View>
            <View style={styles.divisor} />
            <View style={styles.kpi}>
              <Text style={[styles.kpiValor, { color: ColoresMetricas.grasa }]}>{perfil.porcentajeGrasa}%</Text>
              <Text style={styles.kpiEtiqueta}>GRASA</Text>
              <Text style={styles.kpiDetalle}>{perfil.categoriaGrasa}</Text>
            </View>
            <View style={styles.divisor} />
            <View style={styles.kpi}>
              <Text style={[styles.kpiValor, fueraDeRango && { color: ColoresApp.alerta }]}>{usuario.peso}</Text>
              <Text style={styles.kpiEtiqueta}>KG</Text>
              <Text style={styles.kpiDetalle}>
                Saludable {perfil.pesoSaludableMin}–{perfil.pesoSaludableMax} kg
              </Text>
            </View>
          </View>
          <Text style={[est.nota, { marginTop: 10, textAlign: 'center' }]}>
            TMB {perfil.tmb} kcal · Mantenimiento {perfil.mantenimiento} kcal · Actividad {perfil.nivelActividad.toLowerCase()}
          </Text>
        </View>

        {/* OBJETIVO Y FRECUENCIA */}
        <View style={est.card}>
          <Text style={est.cardTitulo}>TU OBJETIVO</Text>
          <View style={est.chipsFila}>
            {OBJETIVOS.map((o) => (
              <Chip key={o.id} etiqueta={o.etiqueta} activo={config.objetivo === o.id} onPress={() => actualizarConfigIA({ objetivo: o.id })} />
            ))}
          </View>
          <View style={styles.enfoque}>
            <Text style={styles.enfoqueTitulo}>{plan.tituloEnfoque.toUpperCase()}</Text>
            <Text style={est.texto}>{plan.descripcionEnfoque}</Text>
          </View>

          <Text style={[est.subtituloSeccion, { marginTop: 14 }]}>FRECUENCIA DE ENTRENAMIENTO</Text>
          <View style={est.chipsFila}>
            {FRECUENCIAS.map((f) => (
              <Chip key={f.id} etiqueta={f.etiqueta} activo={config.frecuencia === f.id} onPress={() => actualizarConfigIA({ frecuencia: f.id })} />
            ))}
          </View>
          {config.frecuencia === 'libre' && (
            <SelectorDias dias={config.diasLibres} onCambiar={(dias) => actualizarConfigIA({ diasLibres: dias })} />
          )}
          <Text style={est.nota}>Entrenas: {resumenDias(plan.diasEntreno)}</Text>

          {plan.avisos.map((a) => (
            <View key={a} style={[est.fila, { alignItems: 'flex-start', marginTop: 8 }]}>
              <Ionicons name="information-circle-outline" size={15} color="#64748B" style={{ marginRight: 6, marginTop: 1 }} />
              <Text style={[est.nota, { flex: 1, lineHeight: 15 }]}>{a}</Text>
            </View>
          ))}
        </View>

        {/* SEGUIR ESTE PLAN */}
        {activo ? (
          <View style={[est.card, styles.activoCard]}>
            <View style={est.fila}>
              <Ionicons name="checkmark-circle" size={22} color="#10B981" style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activoTitulo}>PLAN ACTIVO</Text>
                <Text style={est.nota}>Lo sigues en Nutrición y Mis Rutinas. Los cambios aquí se aplican al instante.</Text>
              </View>
            </View>
            <TouchableOpacity style={[est.botonSecundario, { marginTop: 10 }]} onPress={dejarPlanIA}>
              <Text style={est.botonSecundarioTexto}>Dejar de seguir este plan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[est.botonPrimario, { marginBottom: 14 }]} onPress={seguirPlanIA} activeOpacity={0.88}>
            <Ionicons name="flag-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={est.botonPrimarioTexto}>SEGUIR ESTE PLAN</Text>
          </TouchableOpacity>
        )}

        {/* REQUERIMIENTO DIARIO */}
        <View style={est.card}>
          <Text style={est.cardTitulo}>REQUERIMIENTO DIARIO</Text>
          <View style={[est.fila, { justifyContent: 'center', alignItems: 'flex-end' }]}>
            <Text style={styles.kcal}>{plan.calorias.toLocaleString()}</Text>
            <Text style={styles.kcalUnidad}>KCAL / DÍA</Text>
          </View>
          <Text style={[est.notaCentrada, { marginBottom: 12 }]}>{textoAjuste}</Text>
          {[
            { n: 'PROTEÍNA', g: macros.proteinaG, pct: macros.pctProteina, color: ColoresMetricas.proteina },
            { n: 'CARBOHIDRATOS', g: macros.carbosG, pct: macros.pctCarbos, color: ColoresMetricas.carbos },
            { n: 'GRASAS', g: macros.grasasG, pct: macros.pctGrasas, color: ColoresMetricas.grasa },
          ].map((m) => (
            <View key={m.n} style={{ marginBottom: 10 }}>
              <View style={[est.filaEntre, { marginBottom: 4 }]}>
                <Text style={styles.macroNombre}>{m.n}</Text>
                <Text style={styles.macroValor}>
                  {m.g} g · {m.pct}%
                </Text>
              </View>
              <BarraProgreso valor={m.pct / 100} color={m.color} alto={4} />
            </View>
          ))}
          <View style={est.fila}>
            <Ionicons name="water-outline" size={18} color={ColoresMetricas.proteina} style={{ marginRight: 6 }} />
            <Text style={est.texto}>
              Agua: <Text style={est.negrita}>{plan.aguaLitros} L/día</Text> · días de entreno:{' '}
              <Text style={est.negrita}>{plan.aguaEntrenoLitros} L</Text>
            </Text>
          </View>
        </View>

        {/* COMIDAS */}
        <View style={est.card}>
          <Text style={est.cardTitulo}>PLAN DE ALIMENTACIÓN</Text>
          {plan.comidas.map((t, ti) => {
            const idx = Math.min(datos.opcionesComidaIA[t.id] ?? 0, t.opciones.length - 1);
            const o = t.opciones[idx];
            return (
              <View key={t.id}>
                {ti > 0 && <View style={est.separador} />}
                <View style={est.filaEntre}>
                  <Text style={est.subtituloSeccion}>{t.nombre.toUpperCase()}</Text>
                  <Text style={styles.kcalComida}>~{t.kcalObjetivo} kcal</Text>
                </View>
                <View style={est.chipsFila}>
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
                <Text style={[est.nota, { marginTop: 4 }]}>
                  {o.kcal} kcal · P {o.proteinaG} g · C {o.carbosG} g · G {o.grasasG} g
                </Text>
              </View>
            );
          })}
          <View style={est.separador} />
          {plan.consejosAlimentacion.map((c) => (
            <Text key={c} style={[est.texto, { marginBottom: 4 }]}>• {c}</Text>
          ))}
        </View>

        {/* RUTINA SEMANAL */}
        <View style={est.card}>
          <Text style={est.cardTitulo}>RUTINA SEMANAL</Text>
          <Text style={[est.notaCentrada, { marginBottom: 6 }]}>{plan.descansoEntreSeries}</Text>
          {plan.semana.map((d) => (
            <View key={d.dia} style={styles.dia}>
              <View style={est.filaEntre}>
                <Text style={styles.diaNombre}>{d.dia.toUpperCase()}</Text>
                <Text style={[styles.diaTitulo, !d.entrena && { color: '#64748B' }]}>{d.titulo}</Text>
              </View>
              {d.ejercicios.map((e) => (
                <View key={e.key} style={[est.filaEntre, { paddingVertical: 2 }]}>
                  <Text style={[est.texto, { flex: 1 }]}>• {e.nombre}</Text>
                  <Text style={styles.porcion}>
                    {e.series} × {e.reps}
                    {e.unilateral ? ' por lado' : ''}
                  </Text>
                </View>
              ))}
              {d.complemento && <Text style={[est.nota, { marginTop: 3 }]}>{d.complemento}</Text>}
            </View>
          ))}
          <View style={est.separador} />
          {plan.consejosEntreno.map((c) => (
            <Text key={c} style={[est.texto, { marginBottom: 4 }]}>• {c}</Text>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAFAFA' },
  scroll: { paddingHorizontal: 18, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, paddingTop: 8 },
  subtitulo: { fontSize: 10, fontWeight: '800', color: '#64748B', letterSpacing: 1.2 },
  titulo: { fontSize: 18, fontWeight: '900', color: '#000000', letterSpacing: 0.5 },
  botonCircular: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  kpis: { flexDirection: 'row', alignItems: 'flex-start' },
  kpi: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  kpiValor: { fontSize: 22, fontWeight: '900', color: '#000000' },
  kpiEtiqueta: { fontSize: 9, fontWeight: '900', color: '#94A3B8', letterSpacing: 1, marginTop: 2 },
  kpiDetalle: { fontSize: 10, fontWeight: '600', color: '#64748B', textAlign: 'center', marginTop: 4 },
  divisor: { width: 1, alignSelf: 'stretch', backgroundColor: '#F1F5F9' },
  enfoque: { backgroundColor: '#FFF1F2', borderRadius: 12, padding: 12 },
  enfoqueTitulo: { fontSize: 11, fontWeight: '900', color: ColoresApp.primario, letterSpacing: 0.8, marginBottom: 4 },
  activoCard: { borderColor: '#A7F3D0', backgroundColor: '#F0FDF4' },
  activoTitulo: { fontSize: 12, fontWeight: '900', color: '#047857', letterSpacing: 1 },
  kcal: { fontSize: 34, fontWeight: '900', color: '#000000' },
  kcalUnidad: { fontSize: 10, fontWeight: '900', color: '#94A3B8', marginLeft: 6, marginBottom: 7, letterSpacing: 1 },
  macroNombre: { fontSize: 11, fontWeight: '800', color: '#000000' },
  macroValor: { fontSize: 11, fontWeight: '900', color: '#000000' },
  kcalComida: { fontSize: 12, fontWeight: '900', color: ColoresMetricas.calorias },
  opcionNombre: { fontSize: 13, fontWeight: '800', color: '#000000', marginBottom: 4 },
  porcion: { fontSize: 12, fontWeight: '800', color: '#000000' },
  dia: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10, marginTop: 10 },
  diaNombre: { fontSize: 11, fontWeight: '900', color: '#000000', letterSpacing: 1 },
  diaTitulo: { fontSize: 11, fontWeight: '800', color: ColoresApp.primario },
});

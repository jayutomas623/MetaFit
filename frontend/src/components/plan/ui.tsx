/** Piezas de UI compartidas por Plan personalizado, Nutrición y Mis Rutinas (estilo Meta Fit). */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ColoresApp } from '../../theme/colors';
import { LETRAS_DIAS } from '../../services/fechas';

export const est = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 14,
  },
  cardTitulo: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtituloSeccion: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.8,
    marginTop: 4,
    marginBottom: 8,
  },
  texto: { fontSize: 12, fontWeight: '500', color: '#334155', lineHeight: 18 },
  nota: { fontSize: 10, fontWeight: '600', color: '#64748B' },
  notaCentrada: { fontSize: 11, fontWeight: '700', color: '#64748B', textAlign: 'center' },
  negrita: { fontWeight: '900', color: '#000000' },
  fila: { flexDirection: 'row', alignItems: 'center' },
  filaEntre: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chipsFila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  botonPrimario: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ColoresApp.primario,
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  botonPrimarioTexto: { fontSize: 12, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.6 },
  botonSecundario: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  botonSecundarioTexto: { fontSize: 11, fontWeight: '800', color: '#000000' },
  botonIcono: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#000000',
    marginBottom: 10,
  },
  separador: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 10 },
  modalFondo: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  modalHoja: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    maxHeight: '88%',
  },
  modalTitulo: { fontSize: 14, fontWeight: '900', color: '#000000', letterSpacing: 1 },
});

/** Selector superior de dos opciones (p. ej. "Plan Recomendado (IA)" / "Mi Dieta Propia"). */
export function SelectorModo<T extends string>({
  opciones,
  valor,
  onCambiar,
}: {
  opciones: { id: T; etiqueta: string; icono: keyof typeof Ionicons.glyphMap }[];
  valor: T;
  onCambiar: (v: T) => void;
}) {
  return (
    <View style={estilos.segmento}>
      {opciones.map((o) => {
        const activo = o.id === valor;
        return (
          <TouchableOpacity
            key={o.id}
            style={[estilos.segmentoBoton, activo && estilos.segmentoBotonActivo]}
            onPress={() => onCambiar(o.id)}
            activeOpacity={0.85}
          >
            <Ionicons name={o.icono} size={15} color={activo ? '#FFFFFF' : '#000000'} style={{ marginRight: 5 }} />
            <Text style={[estilos.segmentoTexto, activo && estilos.segmentoTextoActivo]} numberOfLines={1}>
              {o.etiqueta}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function Chip({ etiqueta, activo, onPress }: { etiqueta: string; activo: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[estilos.chip, activo && estilos.chipActivo]} onPress={onPress} activeOpacity={0.85}>
      <Text style={[estilos.chipTexto, activo && estilos.chipTextoActivo]}>{etiqueta}</Text>
    </TouchableOpacity>
  );
}

/** Botones L M X J V S D (0 = lunes). */
export function SelectorDias({ dias, onCambiar }: { dias: number[]; onCambiar: (dias: number[]) => void }) {
  return (
    <View style={estilos.diasFila}>
      {LETRAS_DIAS.map((l, i) => {
        const activo = dias.includes(i);
        return (
          <TouchableOpacity
            key={l}
            style={[estilos.dia, activo && estilos.chipActivo]}
            onPress={() => onCambiar(activo ? dias.filter((d) => d !== i) : [...dias, i].sort((a, b) => a - b))}
            activeOpacity={0.85}
          >
            <Text style={[estilos.chipTexto, activo && estilos.chipTextoActivo]}>{l}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function BarraProgreso({ valor, color = ColoresApp.primario, alto = 6 }: { valor: number; color?: string; alto?: number }) {
  const pct = Math.max(0, Math.min(1, valor)) * 100;
  return (
    <View style={[estilos.barraPista, { height: alto, borderRadius: alto / 2 }]}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: alto / 2 }} />
    </View>
  );
}

/** Contador con botones − / + para series y repeticiones. */
export function Stepper({
  valor,
  onCambiar,
  min = 1,
  max = 50,
  sufijo,
}: {
  valor: number;
  onCambiar: (v: number) => void;
  min?: number;
  max?: number;
  sufijo?: string;
}) {
  return (
    <View style={estilos.stepper}>
      <TouchableOpacity style={estilos.stepperBoton} onPress={() => onCambiar(Math.max(min, valor - 1))}>
        <Ionicons name="remove" size={14} color="#000000" />
      </TouchableOpacity>
      <Text style={estilos.stepperTexto}>
        {valor}
        {sufijo ? ` ${sufijo}` : ''}
      </Text>
      <TouchableOpacity style={estilos.stepperBoton} onPress={() => onCambiar(Math.min(max, valor + 1))}>
        <Ionicons name="add" size={14} color="#000000" />
      </TouchableOpacity>
    </View>
  );
}

/** Casilla de verificación redonda. */
export function Check({ marcado, onPress, style }: { marcado: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={style} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: marcado }}>
      <Ionicons
        name={marcado ? 'checkmark-circle' : 'ellipse-outline'}
        size={26}
        color={marcado ? '#10B981' : '#CBD5E1'}
      />
    </TouchableOpacity>
  );
}

const estilos = StyleSheet.create({
  segmento: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 4,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 14,
  },
  segmentoBoton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 20,
  },
  segmentoBotonActivo: { backgroundColor: ColoresApp.primario },
  segmentoTexto: { fontSize: 11, fontWeight: '900', color: '#000000', letterSpacing: 0.3, flexShrink: 1 },
  segmentoTextoActivo: { color: '#FFFFFF' },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipActivo: { backgroundColor: ColoresApp.primario, borderColor: ColoresApp.primario },
  chipTexto: { fontSize: 11, fontWeight: '800', color: '#000000' },
  chipTextoActivo: { color: '#FFFFFF' },
  diasFila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  dia: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  barraPista: { backgroundColor: '#E2E8F0', overflow: 'hidden', width: '100%' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  stepperBoton: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  stepperTexto: { fontSize: 12, fontWeight: '900', color: '#000000', marginHorizontal: 8, minWidth: 18, textAlign: 'center' },
});

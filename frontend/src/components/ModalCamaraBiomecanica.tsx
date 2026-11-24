import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  AppState,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useCameraPermissions } from 'expo-camera';
import Svg, { Circle } from 'react-native-svg';
import * as Speech from 'expo-speech';
import { Ejercicio } from '../models/Ejercicio';
import { ExerciseEngine, AnalysisResult, SessionSummary, esUnilateral } from '../services/exerciseEngine';
import { ColoresApp } from '../theme/colors';
import {
  crearHtmlMediaPipe,
  SCRIPT_CAMBIAR_CAMARA,
  SCRIPT_DETENER_CAMARA,
  SCRIPT_REANUDAR_CAMARA,
  tomarCamara,
  soltarCamara,
} from '../services/mediapipeWebView';

/** Intervalo mínimo entre actualizaciones del ángulo en pantalla (evita re-render a 30 FPS). */
const UI_ANGLE_THROTTLE_MS = 100;
/** Meta de repeticiones por defecto (por lado en unilaterales) si se abre libre. */
const META_POR_DEFECTO = 10;
/** Pausa para girar de perfil entre Lado 1 y Lado 2 (sin contar movimientos). */
const SEGUNDOS_TRANSICION = 4;
/** Tiempo que la guía de ubicación queda visible al abrir la cámara. */
const GUIA_VISIBLE_MS = 8000;

// Geometría para micro-gráfica circular (estilo Análisis Biométrico)
const GAUGE_SIZE = 46;
const GAUGE_STROKE = 4.5;
const GAUGE_RADIUS = 18;
const GAUGE_CENTER = GAUGE_SIZE / 2;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

/** Fase de la serie: unilaterales recorren lado1 → transicion → lado2 → completa. */
type FaseSerie = 'lado1' | 'transicion' | 'lado2' | 'completa';

export interface DetalleSerie {
  /** Repeticiones válidas totales de la serie. */
  reps: number;
  unilateral: boolean;
  lado1: number;
  lado2: number;
  /** Meta usada (por lado en unilaterales). */
  meta: number;
  /** true si se alcanzó la meta (en ambos lados si es unilateral). */
  metaCumplida: boolean;
}

interface Props {
  visible: boolean;
  ejercicio: Ejercicio | null;
  onCerrar: () => void;
  /** Meta de repeticiones (por lado en unilaterales). Por defecto 10. */
  metaReps?: number;
  onCompletarSerie?: (reps: number, detalle: DetalleSerie) => void;
}

// HTML compartido de cámara + MediaPipe (ver src/services/mediapipeWebView.ts)
const MEDIAPIPE_HTML = crearHtmlMediaPipe({ grosorLinea: 2, radioPunto: 3 });

export const ModalCamaraBiomecanica: React.FC<Props> = ({
  visible,
  ejercicio,
  onCerrar,
  metaReps,
  onCompletarSerie,
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [reps, setReps] = useState(0);
  const [feedback, setFeedback] = useState('Ponte de pie frente a la cámara');
  const [isFormCorrect, setIsFormCorrect] = useState(true);
  const [fase, setFase] = useState('invalid');
  const [primaryAngle, setPrimaryAngle] = useState(0);
  const [humanoDetectado, setHumanoDetectado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);
  const [repsNoContadas, setRepsNoContadas] = useState(0);
  const [consejo, setConsejo] = useState<string | null>(null);
  const [resumen, setResumen] = useState<SessionSummary | null>(null);
  const [webViewKey, setWebViewKey] = useState(0);

  // Flujo guiado de la serie
  const [meta, setMeta] = useState(metaReps ?? META_POR_DEFECTO);
  const [faseSerie, setFaseSerieState] = useState<FaseSerie>('lado1');
  const [repsLado1, setRepsLado1] = useState(0);
  const [cuentaTransicion, setCuentaTransicion] = useState(0);
  const [mostrarGuia, setMostrarGuia] = useState(true);

  const engineRef = useRef<ExerciseEngine | null>(null);
  const webViewRef = useRef<any>(null);
  const ultimoAnguloUiRef = useRef<number>(0);
  const faseSerieRef = useRef<FaseSerie>('lado1');
  const offsetLado2Ref = useRef<number>(0);
  const metaRef = useRef<number>(meta);
  const guiaHabladaRef = useRef<boolean>(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const intervaloTransicionRef = useRef<ReturnType<typeof setInterval> | null>(null);
  metaRef.current = meta;

  // Control de audio mediante expo-speech (estilo Análisis Biométrico)
  const ultimoAudioRef = useRef<number>(0);
  const ultimaRepHabladaRef = useRef<number>(0);

  const unilateral = ejercicio ? esUnilateral(ejercicio.engineType) : false;

  const setFaseSerie = (f: FaseSerie) => {
    faseSerieRef.current = f;
    setFaseSerieState(f);
  };

  const programar = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  };

  const limpiarTemporizadores = () => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current.clear();
    if (intervaloTransicionRef.current) clearInterval(intervaloTransicionRef.current);
    intervaloTransicionRef.current = null;
  };

  const hablar = (texto: string, forzar: boolean = false) => {
    const ahora = Date.now();
    // Cooldown para no saturar el hilo de JavaScript ni la voz
    if (!forzar && ahora - ultimoAudioRef.current < 3500) {
      return;
    }
    try {
      Speech.stop();
      Speech.speak(texto, {
        language: 'es-US',
        rate: 1.0,
        pitch: 1.0,
      });
      ultimoAudioRef.current = ahora;
      engineRef.current?.marcarVoz(ahora);
    } catch (e) {}
  };

  // Detener voz y temporizadores al desmontar
  useEffect(() => {
    return () => {
      limpiarTemporizadores();
      try {
        Speech.stop();
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reiniciar estado cuando se abre un ejercicio
  useEffect(() => {
    limpiarTemporizadores();
    if (visible && ejercicio) {
      engineRef.current = new ExerciseEngine(ejercicio.engineType);
      setReps(0);
      setFeedback('Ponte de pie frente a la cámara');
      setIsFormCorrect(true);
      setFase('invalid');
      setPrimaryAngle(0);
      setHumanoDetectado(false);
      setCargando(true);
      setErrorCamara(null);
      setRepsNoContadas(0);
      setConsejo(null);
      setResumen(null);
      setMeta(metaReps ?? META_POR_DEFECTO);
      setFaseSerie('lado1');
      setRepsLado1(0);
      setCuentaTransicion(0);
      setMostrarGuia(true);
      offsetLado2Ref.current = 0;
      ultimoAudioRef.current = 0;
      ultimaRepHabladaRef.current = 0;
      ultimoAnguloUiRef.current = 0;
      guiaHabladaRef.current = false;
      tomarCamara(webViewRef);
    } else {
      try {
        Speech.stop();
      } catch (e) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ejercicio, metaReps]);

  // Detener / reanudar la cámara cuando la app pasa a segundo plano.
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (estado) => {
      webViewRef.current?.injectJavaScript(
        estado === 'active' ? SCRIPT_REANUDAR_CAMARA : SCRIPT_DETENER_CAMARA
      );
    });
    return () => sub.remove();
  }, [visible]);

  if (!visible || !ejercicio) return null;

  // Libera la cámara dentro del WebView antes de desmontarlo (seguro de instancia única).
  const detenerCamara = () => {
    soltarCamara(webViewRef);
  };

  /** Repeticiones válidas del lado / serie en curso. */
  const repsDeFase = (total: number) =>
    unilateral && faseSerieRef.current !== 'lado1' ? total - offsetLado2Ref.current : total;

  // Guía de ubicación: se muestra y se dice al abrir la cámara (una vez por apertura).
  const anunciarGuia = () => {
    const engine = engineRef.current;
    if (!engine || guiaHabladaRef.current) return;
    guiaHabladaRef.current = true;
    setMostrarGuia(true);
    hablar(unilateral ? `${engine.guiaCamara} Comienza con el primer lado.` : engine.guiaCamara, true);
    programar(() => setMostrarGuia(false), GUIA_VISIBLE_MS);
  };

  // Lado 1 terminado: aviso, pausa de transición sin contar y arranque del Lado 2.
  const iniciarCambioLado = () => {
    const engine = engineRef.current;
    if (!engine || faseSerieRef.current !== 'lado1') return;
    setFaseSerie('transicion');
    setRepsLado1(engine.reps);
    setCuentaTransicion(SEGUNDOS_TRANSICION);
    setFeedback('Cambio de lado: gira de perfil');
    setConsejo(engine.guiaCamara);
    hablar('¡Excelente! Ahora gira de perfil para trabajar el otro lado.', true);

    let restante = SEGUNDOS_TRANSICION;
    if (intervaloTransicionRef.current) clearInterval(intervaloTransicionRef.current);
    intervaloTransicionRef.current = setInterval(() => {
      restante -= 1;
      setCuentaTransicion(restante);
      if (restante <= 0) {
        if (intervaloTransicionRef.current) clearInterval(intervaloTransicionRef.current);
        intervaloTransicionRef.current = null;
        // Los movimientos durante el giro no se procesaron; se arranca limpio.
        engine.reiniciarSeguimiento();
        offsetLado2Ref.current = engine.reps;
        setReps(engine.reps);
        setFaseSerie('lado2');
        setFeedback('Lado 2: inicia el movimiento');
        hablar('Comienza con el segundo lado.', true);
      }
    }, 1000);
  };

  // Meta alcanzada (Lado 2 o serie bilateral): se anuncia y se abre el resumen.
  const completarSerie = () => {
    if (faseSerieRef.current === 'completa') return;
    setFaseSerie('completa');
    hablar('¡Serie completada!', true);
    programar(() => handleFinalizar(), 1500);
  };

  const revisarMeta = (totalReps: number) => {
    const enFase = repsDeFase(totalReps);
    if (enFase < metaRef.current) return;
    if (unilateral && faseSerieRef.current === 'lado1') iniciarCambioLado();
    else if (faseSerieRef.current === 'lado1' || faseSerieRef.current === 'lado2') completarSerie();
  };

  // Recepción de datos REALES desde Google MediaPipe
  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      const contando = faseSerieRef.current === 'lado1' || faseSerieRef.current === 'lado2';

      if (data.type === 'LANDMARKS' && Array.isArray(data.landmarks) && data.landmarks.length > 0) {
        setCargando(false);
        setErrorCamara(null);
        setHumanoDetectado(true);

        // Durante la transición de lado (o con la serie ya completa) no se cuenta nada.
        if (engineRef.current && !resumen && contando) {
          const result: AnalysisResult = engineRef.current.processLandmarks(data.landmarks);

          if (result.trackingValid) {
            setReps(result.reps);
            setRepsNoContadas(result.rejectedReps);
            setFeedback(result.feedback);
            setConsejo(result.tip);
            setIsFormCorrect(result.isFormCorrect);
            setFase(result.phase);
            const ahora = Date.now();
            if (ahora - ultimoAnguloUiRef.current >= UI_ANGLE_THROTTLE_MS || result.repCompleted) {
              ultimoAnguloUiRef.current = ahora;
              setPrimaryAngle(result.primaryAngle);
            }

            // AUDIO: repetición válida => número del lado/serie; no contada => motivo
            if (result.repCompleted && result.reps > ultimaRepHabladaRef.current) {
              ultimaRepHabladaRef.current = result.reps;
              hablar(`${repsDeFase(result.reps)}`, true);
              revisarMeta(result.reps);
            } else if (result.repRejected) {
              hablar(`No contada. ${result.rejectionReason ?? 'Cuida la técnica'}`, true);
            }
          } else {
            setHumanoDetectado(false);
            setFeedback('Aléjate un poco para ver tus articulaciones');
            setConsejo(engineRef.current.guiaCamara);
            setFase('invalid');
          }

          // AUDIO: corrección por postura sostenida o mala detección (~3 s, cooldown 5 s)
          if (result.vozCorreccion) hablar(result.vozCorreccion, true);
        }
      } else if (data.type === 'NO_HUMAN') {
        setHumanoDetectado(false);
        setFeedback('No se detecta cuerpo. Colócate frente a la cámara.');
        setConsejo(engineRef.current?.guiaCamara ?? null);
        setFase('invalid');
        if (engineRef.current && !resumen && contando) {
          const voz = engineRef.current.processNoHuman();
          if (voz) hablar(voz, true);
        }
      } else if (data.type === 'CAMERA_READY') {
        setCargando(false);
        anunciarGuia();
      } else if (data.type === 'CAMERA_ERROR') {
        setCargando(false);
        setErrorCamara(data.error || 'No se pudo acceder a la cámara.');
      }
    } catch (err) {
      console.error('Error parseando mensaje:', err);
    }
  };

  const handleToggleCamara = () => {
    webViewRef.current?.injectJavaScript(SCRIPT_CAMBIAR_CAMARA);
  };

  const handleReiniciar = () => {
    if (engineRef.current) {
      limpiarTemporizadores();
      engineRef.current.reset();
      setReps(0);
      setRepsNoContadas(0);
      setConsejo(null);
      setFeedback('Ponte de pie frente a la cámara');
      setIsFormCorrect(true);
      setFase('invalid');
      setPrimaryAngle(0);
      setFaseSerie('lado1');
      setRepsLado1(0);
      setCuentaTransicion(0);
      offsetLado2Ref.current = 0;
      ultimaRepHabladaRef.current = 0;
      hablar(unilateral ? 'Reinicio. Comienza con el primer lado.' : 'Reinicio', true);
    }
  };

  const cambiarMeta = (delta: number) => {
    setMeta((m) => Math.min(50, Math.max(1, m + delta)));
  };

  // Reintentar tras un error de cámara: remonta el WebView.
  const handleReintentarCamara = () => {
    detenerCamara();
    setErrorCamara(null);
    setCargando(true);
    setWebViewKey((k) => k + 1);
    tomarCamara(webViewRef);
  };

  const detalleSerie = (): DetalleSerie => {
    const total = engineRef.current?.reps ?? reps;
    const enTransicionOMas = faseSerieRef.current !== 'lado1';
    const lado1 = unilateral ? (enTransicionOMas ? repsLado1 || offsetLado2Ref.current : total) : total;
    const lado2 = unilateral && faseSerieRef.current !== 'lado1' && faseSerieRef.current !== 'transicion'
      ? total - offsetLado2Ref.current
      : 0;
    const metaCumplida = unilateral ? lado1 >= meta && lado2 >= meta : total >= meta;
    return { reps: total, unilateral, lado1, lado2, meta, metaCumplida };
  };

  const cerrarDefinitivo = () => {
    limpiarTemporizadores();
    try {
      Speech.stop();
    } catch (e) {}
    detenerCamara();
    if (onCompletarSerie) {
      const d = detalleSerie();
      onCompletarSerie(d.reps, d);
    }
    onCerrar();
  };

  // Finalizar: si hubo intentos se muestra el resumen con recomendaciones antes de cerrar.
  const handleFinalizar = () => {
    if (resumen) {
      cerrarDefinitivo();
      return;
    }
    const engine = engineRef.current;
    if (!engine || engine.reps + engine.rejectedReps === 0) {
      cerrarDefinitivo();
      return;
    }
    limpiarTemporizadores();
    try {
      Speech.stop();
    } catch (e) {}
    detenerCamara();
    const r = engine.getSessionSummary();
    setResumen(r);
    hablar(
      `Serie terminada. ${r.validReps} repeticiones correctas` +
        (r.rejectedReps > 0 ? ` y ${r.rejectedReps} no contadas.` : '.'),
      true
    );
  };

  const getFaseEtiqueta = (phase: string) => {
    switch (phase) {
      case 'readyUp':
        return 'EN POSICIÓN';
      case 'descending':
        return 'DESCENSO';
      case 'bottom':
        return 'FONDO';
      case 'ascending':
        return 'SUBIENDO';
      default:
        return 'BUSCANDO';
    }
  };

  // Color de postura
  const colorPostura = humanoDetectado
    ? (isFormCorrect ? '#10B981' : ColoresApp.primario)
    : '#94A3B8';

  // Gráfica circular para Ángulo (rango 0 - 180)
  const ratioAngulo = Math.min(Math.max(primaryAngle / 180, 0), 1);
  const offsetAngulo = GAUGE_CIRCUMFERENCE - ratioAngulo * GAUGE_CIRCUMFERENCE;

  const repsVisibles = unilateral && faseSerie !== 'lado1' ? reps - offsetLado2Ref.current : reps;
  const etiquetaContador = unilateral
    ? `LADO ${faseSerie === 'lado1' ? 1 : 2} DE 2 · META ${meta}`
    : `REPETICIONES · META ${meta}`;
  const resumenDetalle = resumen ? detalleSerie() : null;

  // Permiso de Cámara
  if (!permission || !permission.granted) {
    return (
      <Modal animationType="slide" visible={visible} onRequestClose={onCerrar}>
        <SafeAreaView style={styles.permissionContainer}>
          <View style={styles.permissionCard}>
            <View style={styles.iconCircle}>
              <Ionicons name="camera-outline" size={40} color={ColoresApp.primario} />
            </View>
            <Text style={styles.permissionTitle}>PERMISO DE CÁMARA</Text>
            <Text style={styles.permissionText}>
              Meta Fit necesita acceso a tu cámara para que la IA de Google MediaPipe detecte tu cuerpo
              y cuente tus repeticiones biomecánicamente.
            </Text>

            <TouchableOpacity style={styles.botonPermiso} onPress={requestPermission} activeOpacity={0.85}>
              <Text style={styles.botonPermisoTexto}>ACTIVAR CÁMARA</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.botonCancelar} onPress={onCerrar} activeOpacity={0.7}>
              <Text style={styles.botonCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={handleFinalizar}>
      <View style={styles.container}>
        {/* WebView con Google MediaPipe y Cámara en Tiempo Real */}
        <WebView
          key={webViewKey}
          ref={webViewRef}
          onRenderProcessGone={handleReintentarCamara}
          onContentProcessDidTerminate={handleReintentarCamara}
          originWhitelist={['*']}
          source={{ html: MEDIAPIPE_HTML, baseUrl: 'https://localhost' }}
          style={StyleSheet.absoluteFill}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          mixedContentMode="always"
          userAgent="Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
          onMessage={handleWebViewMessage}
        />

        {/* Pantalla de Carga Inicial Sobria */}
        {cargando && (
          <View style={styles.loaderContainer} pointerEvents="none">
            <ActivityIndicator size="small" color={ColoresApp.primario} />
            <Text style={styles.loaderTexto}>CALIBRANDO SENSORES IA</Text>
          </View>
        )}

        {/* Notificación de Error */}
        {errorCamara && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={32} color={ColoresApp.primario} style={{ marginBottom: 8 }} />
            <Text style={styles.errorTitulo}>ERROR AL ABRIR CÁMARA</Text>
            <Text style={styles.errorMensaje}>{errorCamara}</Text>
            <TouchableOpacity style={styles.botonReintentar} onPress={handleReintentarCamara}>
              <Text style={styles.botonReintentarTexto}>REINTENTAR</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* CAPA HUD FLUIDA (Safe Area View sin bloquear toques en pantalla) */}
        <SafeAreaView style={styles.hudSafeArea} pointerEvents="box-none">

          {/* 1. SECCIÓN SUPERIOR: Top Bar + Indicadores */}
          <View pointerEvents="box-none">
            {/* Top Bar con botones circulares */}
            <View style={styles.topBar}>
              <TouchableOpacity style={styles.tabCirculo} onPress={handleFinalizar} activeOpacity={0.8}>
                <Ionicons name="close" size={22} color="#000000" />
              </TouchableOpacity>

              <View style={styles.badgeEjercicio}>
                <Text style={styles.badgeEjercicioTexto}>{ejercicio.nombre.toUpperCase()}</Text>
                <View style={styles.aiPuntoRow}>
                  <View
                    style={[
                      styles.puntoIA,
                      { backgroundColor: humanoDetectado ? '#10B981' : '#F59E0B' },
                    ]}
                  />
                  <Text style={styles.textoEstadoIA}>
                    {humanoDetectado ? 'CONECTADO' : 'BUSCANDO'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity style={styles.tabCirculo} onPress={handleToggleCamara} activeOpacity={0.8}>
                <Ionicons name="camera-reverse-outline" size={22} color="#000000" />
              </TouchableOpacity>
            </View>

            {/* Fila de Indicadores: Ángulo en vivo y Fase (Estilo Análisis Biométrico) */}
            <View style={styles.indicadoresFila} pointerEvents="box-none">
              {/* Tarjeta Ángulo con Micro-Gráfica Circular */}
              <View style={styles.tarjetaFija}>
                <Text style={styles.tarjetaTitulo}>ÁNGULO EN VIVO</Text>
                <View style={styles.tarjetaContenido}>
                  <View style={styles.gaugeWrapper}>
                    <Svg width={GAUGE_SIZE} height={GAUGE_SIZE}>
                      <Circle
                        cx={GAUGE_CENTER}
                        cy={GAUGE_CENTER}
                        r={GAUGE_RADIUS}
                        stroke="#F1F5F9"
                        strokeWidth={GAUGE_STROKE}
                        fill="none"
                      />
                      <Circle
                        cx={GAUGE_CENTER}
                        cy={GAUGE_CENTER}
                        r={GAUGE_RADIUS}
                        stroke={colorPostura}
                        strokeWidth={GAUGE_STROKE}
                        fill="none"
                        strokeDasharray={GAUGE_CIRCUMFERENCE}
                        strokeDashoffset={offsetAngulo}
                        strokeLinecap="round"
                        transform={`rotate(-90 ${GAUGE_CENTER} ${GAUGE_CENTER})`}
                      />
                    </Svg>
                    <Text style={styles.gaugeCenterLabel}>°</Text>
                  </View>

                  <View style={styles.datosColumna}>
                    <Text style={[styles.numeroGrande, { color: colorPostura }]}>
                      {humanoDetectado ? `${Math.round(primaryAngle)}°` : '--°'}
                    </Text>
                    <Text style={styles.unidadTexto} numberOfLines={1}>
                      {ejercicio.articulacionClave.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Tarjeta Fase del Motor */}
              <View style={styles.tarjetaFija}>
                <Text style={styles.tarjetaTitulo}>FASE DEL MOTOR</Text>
                <View style={styles.datosColumnaCentral}>
                  <Text style={styles.faseValorTexto} numberOfLines={1}>
                    {faseSerie === 'transicion'
                      ? 'CAMBIO DE LADO'
                      : humanoDetectado
                      ? getFaseEtiqueta(fase)
                      : 'ESPERANDO'}
                  </Text>
                  <View style={[styles.posturaPill, { backgroundColor: isFormCorrect ? '#ECFDF5' : '#FEF2F2' }]}>
                    <Text
                      style={[
                        styles.posturaPillTexto,
                        { color: humanoDetectado ? (isFormCorrect ? '#10B981' : ColoresApp.primario) : '#94A3B8' },
                      ]}
                    >
                      {humanoDetectado ? (isFormCorrect ? 'CORRECTA' : 'CORREGIR') : 'INACTIVA'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Guía de ubicación frente a la cámara (al empezar o si no se ve al usuario) */}
            {(mostrarGuia || !humanoDetectado) && faseSerie !== 'transicion' && engineRef.current && (
              <View style={styles.guiaCamara} pointerEvents="none">
                <Ionicons name="videocam-outline" size={16} color={ColoresApp.primario} style={{ marginRight: 8 }} />
                <Text style={styles.guiaCamaraTexto} numberOfLines={2}>
                  {engineRef.current.guiaCamara}
                  {unilateral && faseSerie === 'lado1' ? ' Comienza con el primer lado.' : ''}
                </Text>
              </View>
            )}
          </View>

          {/* 2. SECCIÓN CENTRAL: CONTADOR GIGANTE (o aviso de cambio de lado) */}
          <View style={styles.centerHud} pointerEvents="none">
            {faseSerie === 'transicion' ? (
              <View style={styles.repBadgeContenedor}>
                <Text style={styles.repLabel}>¡LADO 1 COMPLETO!</Text>
                <Text style={styles.transicionTexto}>Gira de perfil para trabajar el otro lado</Text>
                <Text style={[styles.repNumero, { color: ColoresApp.primario }]}>{Math.max(cuentaTransicion, 0)}</Text>
              </View>
            ) : (
              <View style={styles.repBadgeContenedor}>
                <Text style={styles.repLabel}>{etiquetaContador}</Text>
                <Text style={[styles.repNumero, { color: humanoDetectado ? colorPostura : '#64748B' }]}>
                  {repsVisibles}
                </Text>
                {unilateral && faseSerie !== 'lado1' && (
                  <Text style={styles.repNoContadas}>LADO 1: {repsLado1}</Text>
                )}
                {repsNoContadas > 0 && (
                  <Text style={styles.repNoContadas}>NO CONTADAS: {repsNoContadas}</Text>
                )}
              </View>
            )}
          </View>

          {/* 3. SECCIÓN INFERIOR: Meta + Feedback Banner + Navbar Flotante */}
          <View pointerEvents="box-none">
            {/* Controles de la serie: meta editable y cambio manual de lado */}
            <View style={styles.controlesSerie}>
              <View style={styles.metaStepper}>
                <TouchableOpacity style={styles.metaBoton} onPress={() => cambiarMeta(-1)} activeOpacity={0.8}>
                  <Ionicons name="remove" size={16} color="#000000" />
                </TouchableOpacity>
                <Text style={styles.metaTexto}>
                  META {meta}
                  {unilateral ? ' / LADO' : ''}
                </Text>
                <TouchableOpacity style={styles.metaBoton} onPress={() => cambiarMeta(1)} activeOpacity={0.8}>
                  <Ionicons name="add" size={16} color="#000000" />
                </TouchableOpacity>
              </View>
              {unilateral && faseSerie === 'lado1' && (
                <TouchableOpacity style={styles.botonCambiarLado} onPress={iniciarCambioLado} activeOpacity={0.85}>
                  <Ionicons name="swap-horizontal" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.botonCambiarLadoTexto}>CAMBIAR DE LADO</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Banner de Feedback en Tiempo Real */}
            <View style={[styles.feedbackBanner, { borderColor: colorPostura }]}>
              <Ionicons
                name={humanoDetectado ? (isFormCorrect ? 'checkmark-circle' : 'warning') : 'body'}
                size={22}
                color={humanoDetectado ? colorPostura : '#F59E0B'}
                style={{ marginRight: 10 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.feedbackTexto} numberOfLines={2}>
                  {feedback}
                </Text>
                {consejo && (
                  <Text style={styles.consejoTexto} numberOfLines={2}>
                    {consejo}
                  </Text>
                )}
              </View>
            </View>

            {/* Barra Flotante de Controles (Estilo Análisis Biométrico) */}
            <View style={styles.floatingBar}>
              {/* Botón Reiniciar Conteo */}
              <TouchableOpacity
                onPress={handleReiniciar}
                style={styles.botonSecundarioPill}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={16} color="#000000" style={{ marginRight: 6 }} />
                <Text style={styles.botonSecundarioTexto}>Reiniciar</Text>
              </TouchableOpacity>

              {/* Botón Finalizar Serie */}
              <TouchableOpacity
                onPress={handleFinalizar}
                style={styles.tabBotonRojo}
                activeOpacity={0.85}
              >
                <Text style={styles.tabBotonRojoTexto}>FINALIZAR SERIE</Text>
              </TouchableOpacity>
            </View>
          </View>

        </SafeAreaView>

        {/* Resumen de la serie con recomendaciones (mismo estilo que el aviso de error) */}
        {resumen && (
          <View style={styles.errorContainer}>
            <Ionicons name="stats-chart" size={32} color={ColoresApp.primario} style={{ marginBottom: 8 }} />
            <Text style={styles.errorTitulo}>RESUMEN DE LA SERIE</Text>
            <Text style={styles.errorMensaje}>
              {resumen.validReps} correctas · {resumen.rejectedReps} no contadas
              {resumenDetalle?.unilateral
                ? `\nLado 1: ${resumenDetalle.lado1} · Lado 2: ${resumenDetalle.lado2} (meta ${resumenDetalle.meta} por lado)`
                : ''}
            </Text>
            <ScrollView style={styles.resumenScroll} contentContainerStyle={{ paddingBottom: 8 }}>
              {resumen.frequentErrors.length > 0 && (
                <>
                  <Text style={styles.resumenSeccion}>A CORREGIR</Text>
                  {resumen.frequentErrors.slice(0, 3).map((e) => (
                    <Text key={e.message} style={styles.resumenItem}>
                      • {e.message} ({e.count})
                    </Text>
                  ))}
                </>
              )}
              {resumen.techniqueTips.length > 0 && (
                <>
                  <Text style={styles.resumenSeccion}>CONSEJOS DE TÉCNICA</Text>
                  {resumen.techniqueTips.map((t) => (
                    <Text key={t} style={styles.resumenItem}>• {t}</Text>
                  ))}
                </>
              )}
              <Text style={styles.resumenSeccion}>RECOMENDACIONES GENERALES</Text>
              {resumen.generalTips.map((t) => (
                <Text key={t} style={styles.resumenItem}>• {t}</Text>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.botonReintentar} onPress={cerrarDefinitivo}>
              <Text style={styles.botonReintentarTexto}>CERRAR</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loaderContainer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  loaderTexto: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 12,
    marginTop: 12,
    letterSpacing: 1,
  },
  errorContainer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 25,
  },
  errorTitulo: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  errorMensaje: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  botonReintentar: {
    backgroundColor: ColoresApp.primario,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  botonReintentarTexto: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFFFFF',
  },

  // Contenedor Safe Area
  hudSafeArea: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  // Top Bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  tabCirculo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  badgeEjercicio: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  badgeEjercicioTexto: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.6,
  },
  aiPuntoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  puntoIA: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  textoEstadoIA: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },

  // Fila de Indicadores Superiores
  indicadoresFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    gap: 8,
  },
  tarjetaFija: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  tarjetaTitulo: {
    fontSize: 10,
    fontWeight: '900',
    color: '#64748B',
    marginBottom: 6,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  tarjetaContenido: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeWrapper: {
    width: GAUGE_SIZE,
    height: GAUGE_SIZE,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeCenterLabel: {
    position: 'absolute',
    fontSize: 9,
    fontWeight: '900',
    color: '#64748B',
  },
  datosColumna: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: 8,
  },
  datosColumnaCentral: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  numeroGrande: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  unidadTexto: {
    fontSize: 9,
    fontWeight: '900',
    color: '#64748B',
    marginTop: 1,
  },
  faseValorTexto: {
    fontSize: 13,
    fontWeight: '900',
    color: '#000000',
    marginBottom: 4,
    textAlign: 'center',
  },
  posturaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  posturaPillTexto: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  // Centro HUD: Repeticiones Grandes y Visibles
  centerHud: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  repBadgeContenedor: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 28,
    paddingVertical: 12,
    paddingHorizontal: 40,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#F1F5F9',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  repLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#64748B',
    letterSpacing: 1.5,
  },
  repNumero: {
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -1,
  },

  // Feedback Banner
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
  },
  feedbackTexto: {
    fontSize: 12,
    fontWeight: '800',
    color: '#000000',
    lineHeight: 16,
  },
  consejoTexto: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748B',
    lineHeight: 15,
    marginTop: 2,
  },
  guiaCamara: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    elevation: 2,
  },
  guiaCamaraTexto: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 15,
  },
  transicionTexto: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 220,
  },
  controlesSerie: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  metaStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    elevation: 2,
  },
  metaBoton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaTexto: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000000',
    marginHorizontal: 8,
    letterSpacing: 0.4,
  },
  botonCambiarLado: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  botonCambiarLadoTexto: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  repNoContadas: {
    fontSize: 10,
    fontWeight: '900',
    color: ColoresApp.primario,
    letterSpacing: 0.8,
  },
  resumenScroll: {
    alignSelf: 'stretch',
    maxHeight: 340,
    marginBottom: 16,
  },
  resumenSeccion: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.8,
    marginTop: 10,
    marginBottom: 4,
  },
  resumenItem: {
    fontSize: 12,
    fontWeight: '500',
    color: '#334155',
    lineHeight: 18,
  },

  // Floating Bar Inferior
  floatingBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    height: 58,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: Platform.OS === 'ios' ? 8 : 4,
  },
  botonSecundarioPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  botonSecundarioTexto: {
    fontSize: 12,
    fontWeight: '800',
    color: '#000000',
  },
  tabBotonRojo: {
    flex: 1,
    marginLeft: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ColoresApp.primario,
    borderRadius: 22,
    height: 42,
    paddingHorizontal: 16,
    shadowColor: ColoresApp.primario,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 4,
  },
  tabBotonRojoTexto: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.5,
  },

  // Permisos
  permissionContainer: {
    flex: 1,
    backgroundColor: '#FAFAFA',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.8,
    marginBottom: 10,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  botonPermiso: {
    width: '100%',
    backgroundColor: ColoresApp.primario,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  botonPermisoTexto: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  botonCancelar: {
    paddingVertical: 8,
  },
  botonCancelarTexto: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94A3B8',
  },
});

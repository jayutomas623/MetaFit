/**
 * Motor biomecánico de ejercicios.
 *
 * Recibe los 33 landmarks de MediaPipe Pose por frame, calcula el ángulo de la
 * articulación clave y avanza una máquina de estados por repetición:
 *
 *   readyUp ──(sale de la posición inicial)──▶ descending
 *   descending ──(alcanza la profundidad objetivo N frames)──▶ bottom
 *   bottom ──(empieza a regresar)──▶ ascending
 *   ascending ──(vuelve a la posición final)──▶ readyUp  => la repetición se EVALÚA
 *
 * Una repetición SOLO se cuenta si:
 *   1. llegó a la profundidad / rango objetivo,
 *   2. volvió a la posición de extensión final,
 *   3. no tuvo errores de postura sostenidos (un error cuenta si persiste varios frames),
 *   4. no fue demasiado rápida (sin control).
 * En otro caso se registra como "no contada" con el motivo y una recomendación.
 *
 * Estabilidad:
 *   - Se usa un solo lado del cuerpo (izquierdo o derecho) para toda la cadena articular,
 *     elegido por visibilidad y con histéresis. Antes cada articulación elegía su lado
 *     por separado y se mezclaban puntos de ambos lados (ángulos sin sentido).
 *   - Si faltan articulaciones no se avanza la máquina de estados (antes se usaba un
 *     ángulo por defecto que disparaba repeticiones falsas o dejaba el motor trabado).
 *   - Se descartan saltos de ángulo imposibles entre frames (ruido del detector).
 *   - Si se pierde el seguimiento o una repetición se queda a medias, el motor se reinicia
 *     a la posición inicial en lugar de quedarse trabado.
 */

export type ExerciseType =
  | 'squat'
  | 'bicepCurl'
  | 'shoulderPress'
  | 'abdominals'
  | 'gluteKickback'
  | 'bulgarianSquat'
  | 'tricepExtension'
  | 'singleArmRow';

export type ExerciseState =
  | 'readyUp'
  | 'descending'
  | 'bottom'
  | 'ascending'
  | 'invalid';

export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface AnalysisResult {
  /** Repeticiones válidas (bien ejecutadas). */
  reps: number;
  /** Repeticiones detectadas pero no contadas por mala ejecución. */
  rejectedReps: number;
  phase: ExerciseState;
  feedback: string;
  isFormCorrect: boolean;
  primaryAngle: number;
  /** Errores de postura activos en este frame (ya confirmados, no ruido). */
  errors: string[];
  /** true en el frame en que se cuenta una repetición válida. */
  repCompleted: boolean;
  /** true en el frame en que una repetición termina pero NO se cuenta. */
  repRejected: boolean;
  /** Motivo por el que la última repetición no se contó. */
  rejectionReason: string | null;
  /** Recomendación técnica asociada al error o rechazo actual. */
  tip: string | null;
  trackingValid: boolean;
}

export interface SessionSummary {
  validReps: number;
  rejectedReps: number;
  /** Errores más frecuentes durante la serie, ordenados de mayor a menor. */
  frequentErrors: { message: string; count: number }[];
  /** Recomendaciones técnicas según los errores cometidos. */
  techniqueTips: string[];
  /** Recomendaciones generales para la serie y el entrenamiento. */
  generalTips: string[];
}

type Joint = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle';
type Side = 'left' | 'right';
type Point = [number, number];
type SidePoints = Record<Joint, Point | undefined>;

// Índices de MediaPipe Pose
const LANDMARKS: Record<Side, Record<Joint, number>> = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
};

/** Visibilidad mínima para confiar en una articulación. */
const MIN_VISIBILITY = 0.5;
/** Ventaja de visibilidad necesaria para cambiar de lado (evita parpadeo izq/der). */
const SIDE_SWITCH_MARGIN = 0.15;
/** Frames seguidos que debe mantenerse un error para considerarlo real. */
const ERROR_CONFIRM_FRAMES = 4;
/** Frames seguidos más allá del objetivo para confirmar la profundidad. */
const BOTTOM_CONFIRM_FRAMES = 2;
/** Salto máximo de ángulo entre frames consecutivos antes de considerarlo ruido. */
const MAX_ANGLE_JUMP = 45;
/** Frames con salto anómalo tras los cuales se acepta el nuevo valor (reubicación real). */
const MAX_OUTLIER_FRAMES = 3;
/** Tiempo sin seguimiento válido tras el cual se reinicia la repetición en curso. */
const TRACKING_LOST_RESET_MS = 1000;
/** Tiempo que el mensaje de una repetición (contada o no) queda visible. */
const EVENT_FEEDBACK_MS = 1800;

const MSG_INCOMPLETE_RETURN = 'Completa el recorrido: vuelve a la posición inicial';
const MSG_TOO_FAST = 'Demasiado rápido: controla el movimiento';

interface RuleContext {
  p: SidePoints;
  angle: number;
  state: ExerciseState;
}

interface FormRule {
  /** Mensaje corto que se muestra / se dice en voz. */
  message: string;
  /** Recomendación técnica más detallada. */
  tip: string;
  /** Devuelve true si el error está presente en este frame. */
  check: (ctx: RuleContext) => boolean;
}

interface ExerciseConfig {
  /** Articulaciones [a, vértice, c] del ángulo principal. */
  joints: [Joint, Joint, Joint];
  /** true si el ángulo disminuye en la fase de esfuerzo (p. ej. sentadilla, curl). */
  decreaseOnDescent: boolean;
  /** Cruzar este ángulo desde la posición inicial inicia la repetición. */
  startAngle: number;
  /** Ángulo que hay que alcanzar para que la repetición tenga rango completo. */
  targetAngle: number;
  /** Ángulo al que hay que volver para terminar la repetición. */
  finishAngle: number;
  /** Duración mínima de una repetición controlada. */
  minRepMs: number;
  /** Duración máxima antes de dar la repetición por abandonada. */
  maxRepMs: number;
  /** Mensaje cuando no se alcanza la profundidad / rango. */
  depthMessage: string;
  depthTip: string;
  rules: FormRule[];
  /** Pauta de respiración para las recomendaciones generales. */
  breathing: string;
}

class VectorMath {
  static calculateAngle(a: Point, b: Point, c: Point): number {
    const radians = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(a[1] - b[1], a[0] - b[0]);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) {
      angle = 360.0 - angle;
    }
    return angle;
  }

  /** Inclinación del tronco respecto a la vertical (0 = erguido). */
  static calculateTorsoLean(shoulder: Point, hip: Point): number {
    const verticalPoint: Point = [hip[0], hip[1] - 0.5];
    return this.calculateAngle(shoulder, hip, verticalPoint);
  }
}

class ExponentialFilter {
  private alpha: number;
  private value: number | null = null;

  constructor(alpha: number = 0.35) {
    this.alpha = alpha;
  }

  get current(): number | null {
    return this.value;
  }

  update(current: number): number {
    this.value = this.value === null ? current : this.alpha * current + (1.0 - this.alpha) * this.value;
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

const torsoLean = (p: SidePoints): number | null =>
  p.shoulder && p.hip ? VectorMath.calculateTorsoLean(p.shoulder, p.hip) : null;

const isMoving = (s: ExerciseState) => s === 'descending' || s === 'bottom' || s === 'ascending';

const EXERCISE_CONFIG: Record<ExerciseType, ExerciseConfig> = {
  squat: {
    joints: ['hip', 'knee', 'ankle'],
    decreaseOnDescent: true,
    startAngle: 150,
    targetAngle: 100,
    finishAngle: 160,
    minRepMs: 700,
    maxRepMs: 10000,
    depthMessage: 'Baja más: rompe el paralelo de las rodillas',
    depthTip: 'Lleva la cadera hacia atrás y abajo hasta que el muslo quede paralelo al suelo.',
    rules: [
      {
        message: 'Mantén el pecho erguido, evita inclinarte',
        tip: 'Mira al frente, saca el pecho y activa el abdomen durante todo el descenso.',
        check: ({ p, state }) => isMoving(state) && (torsoLean(p) ?? 0) > 45,
      },
    ],
    breathing: 'Inhala al bajar y exhala al subir.',
  },
  bulgarianSquat: {
    joints: ['hip', 'knee', 'ankle'],
    decreaseOnDescent: true,
    startAngle: 150,
    targetAngle: 100,
    finishAngle: 155,
    minRepMs: 700,
    maxRepMs: 10000,
    depthMessage: 'Desciende hasta que el muslo quede paralelo',
    depthTip: 'Baja la rodilla trasera hacia el suelo manteniendo el peso en la pierna delantera.',
    rules: [
      {
        message: 'Mantén el torso estable y erguido',
        tip: 'Una ligera inclinación es normal; evita doblarte hacia delante para bajar.',
        check: ({ p, state }) => isMoving(state) && (torsoLean(p) ?? 0) > 35,
      },
    ],
    breathing: 'Inhala al bajar y exhala al subir.',
  },
  bicepCurl: {
    joints: ['shoulder', 'elbow', 'wrist'],
    decreaseOnDescent: true,
    startAngle: 140,
    targetAngle: 60,
    finishAngle: 150,
    minRepMs: 600,
    maxRepMs: 8000,
    depthMessage: 'Sube más: contrae el bíceps por completo',
    depthTip: 'Lleva la mancuerna hasta la altura del hombro sin despegar el codo del cuerpo.',
    rules: [
      {
        message: 'No balancees el torso, usa solo el bíceps',
        tip: 'Si necesitas balancearte, el peso es excesivo: reduce la carga y aprieta el abdomen.',
        check: ({ p, state }) => isMoving(state) && (torsoLean(p) ?? 0) > 15,
      },
      {
        message: 'Mantén el codo pegado al cuerpo',
        tip: 'El codo debe quedarse fijo a tu costado; solo se mueve el antebrazo.',
        check: ({ p, state }) =>
          isMoving(state) &&
          !!(p.hip && p.shoulder && p.elbow) &&
          VectorMath.calculateAngle(p.hip, p.shoulder, p.elbow) > 40,
      },
    ],
    breathing: 'Exhala al subir la carga e inhala al bajarla.',
  },
  shoulderPress: {
    joints: ['hip', 'shoulder', 'elbow'],
    decreaseOnDescent: false,
    startAngle: 110,
    targetAngle: 155,
    finishAngle: 100,
    minRepMs: 600,
    maxRepMs: 8000,
    depthMessage: 'Extiende los brazos completamente al subir',
    depthTip: 'Empuja hasta casi bloquear los codos por encima de la cabeza, sin encoger los hombros.',
    rules: [
      {
        message: 'No arquees la espalda al empujar',
        tip: 'Aprieta glúteos y abdomen para mantener la espalda neutra; si te arqueas, baja el peso.',
        check: ({ p, state }) => isMoving(state) && (torsoLean(p) ?? 0) > 20,
      },
    ],
    breathing: 'Exhala al empujar hacia arriba e inhala al bajar.',
  },
  abdominals: {
    joints: ['shoulder', 'hip', 'knee'],
    decreaseOnDescent: true,
    startAngle: 125,
    targetAngle: 105,
    finishAngle: 132,
    minRepMs: 500,
    maxRepMs: 8000,
    depthMessage: 'Eleva más el tronco contrayendo el abdomen',
    depthTip: 'Despega los omóplatos del suelo acercando las costillas a la cadera, sin tirar del cuello.',
    rules: [],
    breathing: 'Exhala al subir el tronco e inhala al bajar.',
  },
  gluteKickback: {
    joints: ['shoulder', 'hip', 'knee'],
    decreaseOnDescent: false,
    startAngle: 125,
    targetAngle: 150,
    finishAngle: 115,
    minRepMs: 500,
    maxRepMs: 8000,
    depthMessage: 'Extiende la pierna más atrás apretando el glúteo',
    depthTip: 'Empuja con el talón hacia atrás y aprieta el glúteo arriba un segundo.',
    rules: [],
    breathing: 'Exhala al extender la pierna e inhala al regresar.',
  },
  tricepExtension: {
    joints: ['shoulder', 'elbow', 'wrist'],
    decreaseOnDescent: true,
    startAngle: 130,
    targetAngle: 80,
    finishAngle: 150,
    minRepMs: 600,
    maxRepMs: 8000,
    depthMessage: 'Flexiona más los codos hacia atrás',
    depthTip: 'Baja la carga detrás de la cabeza hasta unos 90° de codo y extiende por completo.',
    rules: [
      {
        message: 'Mantén el torso estable',
        tip: 'Aprieta el abdomen y evita arquear la espalda; solo deben moverse los antebrazos.',
        check: ({ p, state }) => isMoving(state) && (torsoLean(p) ?? 0) > 20,
      },
    ],
    breathing: 'Exhala al extender los codos e inhala al flexionar.',
  },
  singleArmRow: {
    joints: ['shoulder', 'elbow', 'wrist'],
    decreaseOnDescent: true,
    startAngle: 140,
    targetAngle: 90,
    finishAngle: 155,
    minRepMs: 600,
    maxRepMs: 8000,
    depthMessage: 'Sube el codo pegado al torso hacia la cadera',
    depthTip: 'Tira del codo hacia atrás juntando el omóplato, no solo con el brazo.',
    rules: [],
    breathing: 'Exhala al tirar e inhala al estirar el brazo.',
  },
};

const GENERAL_TIPS = [
  'Calienta 5 a 10 minutos antes de empezar (movilidad articular y cardio suave).',
  'Descansa entre 60 y 90 segundos entre series.',
  'Hidrátate durante el entrenamiento.',
  'Prioriza la técnica sobre el número de repeticiones o la carga.',
  'Coloca el celular estable y a una distancia en la que se vea todo tu cuerpo.',
  'Si sientes dolor articular (no cansancio muscular), detén el ejercicio.',
];

export class ExerciseEngine {
  public readonly exerciseType: ExerciseType;
  private readonly config: ExerciseConfig;
  private filter = new ExponentialFilter(0.35);

  private state: ExerciseState = 'readyUp';
  private repCounter = 0;
  private rejectedCounter = 0;

  private side: Side | null = null;
  private outlierFrames = 0;
  private lastValidAt = 0;

  // Estado de la repetición en curso
  private repStartedAt = 0;
  private extremeAngle: number | null = null;
  private reachedTarget = false;
  private bottomFrames = 0;
  private repErrors = new Set<string>();
  private errorStreaks = new Map<string, number>();

  // Mensaje del último evento (repetición contada / no contada)
  private eventFeedback: string | null = null;
  private eventTip: string | null = null;
  private eventUntil = 0;
  private lastRejection: string | null = null;

  // Estadísticas de la serie
  private errorTotals = new Map<string, number>();

  constructor(exerciseType: ExerciseType) {
    this.exerciseType = exerciseType;
    this.config = EXERCISE_CONFIG[exerciseType];
  }

  get reps(): number {
    return this.repCounter;
  }

  get rejectedReps(): number {
    return this.rejectedCounter;
  }

  get currentState(): ExerciseState {
    return this.state;
  }

  reset(): void {
    this.state = 'readyUp';
    this.repCounter = 0;
    this.rejectedCounter = 0;
    this.side = null;
    this.outlierFrames = 0;
    this.lastValidAt = 0;
    this.eventFeedback = null;
    this.eventTip = null;
    this.eventUntil = 0;
    this.lastRejection = null;
    this.errorTotals.clear();
    this.filter.reset();
    this.resetRep();
  }

  /** Recomendación técnica para un mensaje de error de este ejercicio. */
  tipFor(message: string): string | null {
    if (message === this.config.depthMessage) return this.config.depthTip;
    if (message === MSG_TOO_FAST) return 'Baja en 2 segundos y sube en 1: el control trabaja más el músculo.';
    if (message === MSG_INCOMPLETE_RETURN) return 'Termina cada repetición en la posición inicial antes de empezar la siguiente.';
    return this.config.rules.find((r) => r.message === message)?.tip ?? null;
  }

  processLandmarks(
    landmarksInput: LandmarkPoint[] | Record<string, LandmarkPoint>,
    now: number = Date.now()
  ): AnalysisResult {
    const points = this.resolveSide(landmarksInput);
    const [ja, jb, jc] = this.config.joints;

    if (!points || !points[ja] || !points[jb] || !points[jc]) {
      return this.handleTrackingLoss(now);
    }

    const rawAngle = VectorMath.calculateAngle(points[ja]!, points[jb]!, points[jc]!);

    // Descarta saltos imposibles (ruido del detector) salvo que persistan.
    const prev = this.filter.current;
    if (prev !== null && Math.abs(rawAngle - prev) > MAX_ANGLE_JUMP) {
      this.outlierFrames++;
      if (this.outlierFrames < MAX_OUTLIER_FRAMES) {
        return this.buildResult(prev, [], false, false, true, now);
      }
      // El salto persiste: es una reubicación real. Se reinicia sin contar nada.
      this.filter.reset();
      this.state = 'readyUp';
      this.resetRep();
    }
    this.outlierFrames = 0;
    this.lastValidAt = now;

    const angle = this.filter.update(rawAngle);
    const errors = this.updateErrors({ p: points, angle, state: this.state });
    const { completed, rejected } = this.stepFsm(angle, now);

    return this.buildResult(angle, errors, completed, rejected, true, now);
  }

  getSessionSummary(): SessionSummary {
    const frequentErrors = [...this.errorTotals.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count);

    const techniqueTips: string[] = [];
    for (const { message } of frequentErrors.slice(0, 3)) {
      const tip = this.tipFor(message);
      if (tip && !techniqueTips.includes(tip)) techniqueTips.push(tip);
    }

    const total = this.repCounter + this.rejectedCounter;
    const generalTips: string[] = [];
    if (total === 0) {
      generalTips.push('No se detectaron repeticiones: revisa que la cámara vea las articulaciones del ejercicio.');
    } else if (this.rejectedCounter > this.repCounter) {
      generalTips.push('Más de la mitad de las repeticiones no fueron válidas: baja el ritmo o la carga y céntrate en la técnica.');
    } else if (this.rejectedCounter === 0) {
      generalTips.push('¡Técnica muy buena en toda la serie! Mantén este control en las siguientes.');
    }
    generalTips.push(`Respiración: ${this.config.breathing}`);
    generalTips.push(...GENERAL_TIPS);

    return {
      validReps: this.repCounter,
      rejectedReps: this.rejectedCounter,
      frequentErrors,
      techniqueTips,
      generalTips,
    };
  }

  // ---------------------------------------------------------------------------

  private resetRep(): void {
    this.repStartedAt = 0;
    this.extremeAngle = null;
    this.reachedTarget = false;
    this.bottomFrames = 0;
    this.repErrors.clear();
    this.errorStreaks.clear();
  }

  private handleTrackingLoss(now: number): AnalysisResult {
    if (this.lastValidAt && now - this.lastValidAt > TRACKING_LOST_RESET_MS && this.state !== 'readyUp') {
      // Se perdió el cuerpo a mitad de repetición: se descarta sin contar.
      this.state = 'readyUp';
      this.resetRep();
      this.filter.reset();
    }
    return {
      reps: this.repCounter,
      rejectedReps: this.rejectedCounter,
      phase: 'invalid',
      feedback: 'Ajusta la cámara para ver tu cuerpo completo',
      isFormCorrect: true,
      primaryAngle: this.filter.current ?? 0,
      errors: [],
      repCompleted: false,
      repRejected: false,
      rejectionReason: this.lastRejection,
      tip: null,
      trackingValid: false,
    };
  }

  /**
   * Elige UN lado del cuerpo para toda la cadena articular del ejercicio según
   * la visibilidad, con histéresis para no saltar de lado en cada frame.
   */
  private resolveSide(input: LandmarkPoint[] | Record<string, LandmarkPoint>): SidePoints | null {
    const get = (side: Side, joint: Joint): LandmarkPoint | undefined => {
      if (Array.isArray(input)) return input[LANDMARKS[side][joint]];
      return input[`${side}_${joint}`];
    };

    const chain = this.config.joints;
    const extra: Joint[] = ['shoulder', 'hip'];
    const score = (side: Side) => {
      let total = 0;
      for (const j of chain) {
        const v = get(side, j)?.visibility ?? 1.0;
        if (v < MIN_VISIBILITY) return -1; // cadena incompleta en este lado
        total += v;
      }
      return total / chain.length;
    };

    const left = score('left');
    const right = score('right');
    if (left < 0 && right < 0) return null;

    let side: Side;
    if (this.side && (this.side === 'left' ? left : right) >= 0) {
      const current = this.side === 'left' ? left : right;
      const other = this.side === 'left' ? right : left;
      side = other > current + SIDE_SWITCH_MARGIN ? (this.side === 'left' ? 'right' : 'left') : this.side;
    } else {
      side = left >= right ? 'left' : 'right';
    }

    if (this.side !== null && side !== this.side) {
      // Cambiar de lado a mitad de repetición produciría un salto de ángulo.
      this.filter.reset();
      this.state = 'readyUp';
      this.resetRep();
    }
    this.side = side;

    const points = {} as SidePoints;
    for (const j of [...chain, ...extra]) {
      const lm = get(side, j);
      points[j] = lm && (lm.visibility ?? 1.0) >= MIN_VISIBILITY ? [lm.x, lm.y] : undefined;
    }
    return points;
  }

  /** Evalúa las reglas de postura y devuelve solo los errores confirmados (sostenidos). */
  private updateErrors(ctx: RuleContext): string[] {
    const confirmed: string[] = [];
    for (const rule of this.config.rules) {
      if (rule.check(ctx)) {
        const streak = (this.errorStreaks.get(rule.message) ?? 0) + 1;
        this.errorStreaks.set(rule.message, streak);
        if (streak >= ERROR_CONFIRM_FRAMES) {
          confirmed.push(rule.message);
          if (isMoving(ctx.state)) this.repErrors.add(rule.message);
        }
      } else {
        this.errorStreaks.set(rule.message, 0);
      }
    }
    return confirmed;
  }

  private stepFsm(angle: number, now: number): { completed: boolean; rejected: boolean } {
    const c = this.config;
    const dir = c.decreaseOnDescent ? 1 : -1;
    // Con dir: "más allá" = menor ángulo si decreaseOnDescent, mayor si no.
    const beyond = (a: number, threshold: number) => dir * (threshold - a) >= 0;
    const ascendThreshold = c.targetAngle + dir * 8; // histéresis de salida del fondo

    // Repetición abandonada (se quedó a medias demasiado tiempo).
    if (this.state !== 'readyUp' && this.repStartedAt && now - this.repStartedAt > c.maxRepMs) {
      this.state = 'readyUp';
      this.resetRep();
      return { completed: false, rejected: false };
    }

    if (this.state !== 'readyUp' && this.state !== 'invalid') {
      if (this.extremeAngle === null || beyond(angle, this.extremeAngle)) this.extremeAngle = angle;
    }

    switch (this.state) {
      case 'invalid':
      case 'readyUp':
        if (beyond(angle, c.startAngle)) {
          this.state = 'descending';
          this.resetRep();
          this.repStartedAt = now;
        }
        break;

      case 'descending':
        if (beyond(angle, c.targetAngle)) {
          this.bottomFrames++;
          if (this.bottomFrames >= BOTTOM_CONFIRM_FRAMES) {
            this.state = 'bottom';
            this.reachedTarget = true;
          }
        } else {
          this.bottomFrames = 0;
          if (this.passedFinish(angle)) {
            // Volvió a la posición inicial sin llegar al objetivo.
            // Solo se reporta como intento incompleto si recorrió al menos la mitad
            // del rango; un pequeño balanceo simplemente se ignora.
            const halfway = (c.startAngle + c.targetAngle) / 2;
            if (this.extremeAngle !== null && beyond(this.extremeAngle, halfway)) {
              return this.finishRep(now);
            }
            this.state = 'readyUp';
            this.resetRep();
          }
        }
        break;

      case 'bottom':
        if (!beyond(angle, ascendThreshold)) {
          this.state = 'ascending';
        }
        break;

      case 'ascending':
        if (this.passedFinish(angle)) {
          return this.finishRep(now);
        }
        // Volvió a bajar sin terminar de subir: sigue siendo la misma repetición.
        if (beyond(angle, c.targetAngle)) {
          this.state = 'bottom';
        }
        break;
    }
    return { completed: false, rejected: false };
  }

  /** true si el ángulo volvió a la posición final (extensión completa). */
  private passedFinish(angle: number): boolean {
    const c = this.config;
    return c.decreaseOnDescent ? angle >= c.finishAngle : angle <= c.finishAngle;
  }

  private finishRep(now: number): { completed: boolean; rejected: boolean } {
    const duration = now - this.repStartedAt;
    let reason: string | null = null;

    if (!this.reachedTarget) {
      reason = this.config.depthMessage;
    } else if (this.repErrors.size > 0) {
      reason = [...this.repErrors][0];
    } else if (duration < this.config.minRepMs) {
      reason = MSG_TOO_FAST;
    }

    for (const err of this.repErrors) {
      this.errorTotals.set(err, (this.errorTotals.get(err) ?? 0) + 1);
    }

    this.state = 'readyUp';

    if (reason) {
      if (!this.repErrors.has(reason)) {
        this.errorTotals.set(reason, (this.errorTotals.get(reason) ?? 0) + 1);
      }
      this.rejectedCounter++;
      this.lastRejection = reason;
      this.eventFeedback = `No contada: ${reason}`;
      this.eventTip = this.tipFor(reason);
      this.eventUntil = now + EVENT_FEEDBACK_MS;
      this.resetRep();
      return { completed: false, rejected: true };
    }

    this.repCounter++;
    this.lastRejection = null;
    this.eventFeedback = `¡Repetición ${this.repCounter} correcta!`;
    this.eventTip = null;
    this.eventUntil = now + EVENT_FEEDBACK_MS;
    this.resetRep();
    return { completed: true, rejected: false };
  }

  private buildResult(
    angle: number,
    errors: string[],
    completed: boolean,
    rejected: boolean,
    trackingValid: boolean,
    now: number
  ): AnalysisResult {
    let feedback = this.getDefaultFeedback(this.state);
    let tip: string | null = null;

    if (errors.length > 0) {
      feedback = errors[0];
      tip = this.tipFor(errors[0]);
    } else if (this.eventFeedback && now < this.eventUntil) {
      feedback = this.eventFeedback;
      tip = this.eventTip;
    }

    return {
      reps: this.repCounter,
      rejectedReps: this.rejectedCounter,
      phase: this.state,
      feedback,
      isFormCorrect: errors.length === 0 && !(rejected || (this.lastRejection !== null && now < this.eventUntil)),
      primaryAngle: parseFloat(angle.toFixed(1)),
      errors,
      repCompleted: completed,
      repRejected: rejected,
      rejectionReason: this.lastRejection,
      tip,
      trackingValid,
    };
  }

  private getDefaultFeedback(state: ExerciseState): string {
    switch (state) {
      case 'readyUp':
        return 'En posición. Inicia el movimiento.';
      case 'descending':
        return 'Movimiento controlado...';
      case 'bottom':
        return '¡Punto máximo! Sostén y regresa.';
      case 'ascending':
        return 'Regresa a la posición inicial...';
      case 'invalid':
        return 'Ajusta la cámara para ver tu cuerpo';
    }
  }
}

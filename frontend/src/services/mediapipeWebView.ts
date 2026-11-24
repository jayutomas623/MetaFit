/**
 * HTML compartido para la cámara + Google MediaPipe Pose dentro de un WebView.
 *
 * Lo usan PantallaCamaraBiometrica (peso/estatura) y ModalCamaraBiomecanica (ejercicios).
 * Este módulo solo gestiona la CAPTURA (cámara, frames y ciclo de vida). No calcula
 * medidas: los landmarks se envían tal cual a React Native.
 *
 * Correcciones respecto al HTML anterior (estaba duplicado en ambas pantallas):
 *  - La cámara se libera explícitamente (tracks.stop + pose.close) al salir, al pasar
 *    a segundo plano o cuando RN lo pide con window.detenerCamara(). Antes la cámara
 *    seguía tomada por el WebView anterior y, al volver a entrar, el navegador abría
 *    un stream degradado o recortado (el "zoom") o fallaba al detectar.
 *  - Se fija el zoom óptico/digital en 1x cuando el dispositivo lo permite.
 *  - Se ejecuta un único bucle de frames (antes cada cambio de cámara creaba otro bucle).
 *  - Hay un watchdog: si pose.send() se cuelga, el bucle se recupera en vez de quedarse
 *    congelado con isProcessing = true para siempre.
 *  - getUserMedia se reintenta cuando la cámara todavía está ocupada (NotReadableError).
 *  - El canvas solo cambia de tamaño cuando cambia la resolución del video, no en cada frame.
 *  - NO_HUMAN se envía solo al cambiar de estado, no 30 veces por segundo.
 */

export interface OpcionesHtmlMediaPipe {
  /** Grosor de las líneas del esqueleto dibujado. */
  grosorLinea: number;
  /** Radio de los puntos del esqueleto dibujado. */
  radioPunto: number;
}

/** Script para inyectar desde RN antes de desmontar el WebView. */
export const SCRIPT_DETENER_CAMARA = 'window.detenerCamara && window.detenerCamara(); true;';
/** Script para reanudar la cámara (por ejemplo al volver de segundo plano). */
export const SCRIPT_REANUDAR_CAMARA = 'window.reanudarCamara && window.reanudarCamara(); true;';
/** Script para alternar cámara frontal / trasera. */
export const SCRIPT_CAMBIAR_CAMARA = 'window.toggleCameraFacing && window.toggleCameraFacing(); true;';

/** Espera recomendada entre liberar un WebView de cámara y montar el siguiente. */
export const ESPERA_MONTAJE_CAMARA_MS = 350;

// -----------------------------------------------------------------------------
// Seguro de instancia única: solo UN WebView puede tener la cámara a la vez.
// Si se monta una pantalla nueva y la anterior no llegó a liberar la cámara
// (entradas y salidas muy rápidas), se le ordena detenerse.
// -----------------------------------------------------------------------------

interface WebViewConCamara {
  injectJavaScript: (script: string) => void;
}
type RefWebView = { current: WebViewConCamara | null };

let duenoCamara: RefWebView | null = null;

/** Registra `ref` como dueño de la cámara y detiene al dueño anterior, si lo había. */
export function tomarCamara(ref: RefWebView): void {
  if (duenoCamara && duenoCamara !== ref) {
    try {
      duenoCamara.current?.injectJavaScript(SCRIPT_DETENER_CAMARA);
    } catch (e) {}
  }
  duenoCamara = ref;
}

/** Detiene la cámara de `ref` y lo quita del registro. */
export function soltarCamara(ref: RefWebView): void {
  try {
    ref.current?.injectJavaScript(SCRIPT_DETENER_CAMARA);
  } catch (e) {}
  if (duenoCamara === ref) duenoCamara = null;
}

export const crearHtmlMediaPipe = ({ grosorLinea, radioPunto }: OpcionesHtmlMediaPipe): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    #video, #canvas {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }
    #canvas { pointer-events: none; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js" crossorigin="anonymous"></script>
</head>
<body>
  <video id="video" playsinline autoplay muted webkit-playsinline></video>
  <canvas id="canvas"></canvas>

  <script>
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    let currentFacing = 'user';
    let poseInstance = null;
    let cameraStream = null;
    let isProcessing = false;
    let processingSince = 0;
    let loopId = null;
    let loopGeneration = 0;
    let detenida = false;
    let arrancando = false;
    let ultimoEstadoHumano = null;
    let fallosSeguidos = 0;

    const WATCHDOG_MS = 2500;
    const VIGILANCIA_ZOOM_MS = 1500;
    let zoomIntervalId = null;

    function sendToApp(msg) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    }

    if (!navigator.mediaDevices) navigator.mediaDevices = {};
    if (!navigator.mediaDevices.getUserMedia) {
      const legacy = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia || navigator.getUserMedia;
      if (legacy) {
        navigator.mediaDevices.getUserMedia = function(c) {
          return new Promise((resolve, reject) => legacy.call(navigator, c, resolve, reject));
        };
      }
    }

    function crearPose() {
      const p = new Pose({
        locateFile: (file) => 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + file
      });
      p.setOptions({
        modelComplexity: 0,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      p.onResults(onPoseResults);
      return p;
    }

    function onPoseResults(results) {
      if (detenida) return;
      const w = video.videoWidth || window.innerWidth;
      const h = video.videoHeight || window.innerHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (results.poseLandmarks && results.poseLandmarks.length > 0) {
        drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#FF2D55', lineWidth: ${grosorLinea} });
        drawLandmarks(ctx, results.poseLandmarks, { color: '#FFFFFF', fillColor: '#FF2D55', lineWidth: 1, radius: ${radioPunto} });
        ultimoEstadoHumano = true;
        sendToApp({ type: 'LANDMARKS', landmarks: results.poseLandmarks });
      } else if (ultimoEstadoHumano !== false) {
        ultimoEstadoHumano = false;
        sendToApp({ type: 'NO_HUMAN' });
      }
      ctx.restore();
    }

    function detenerBucle() {
      loopGeneration++;
      if (loopId !== null) {
        cancelAnimationFrame(loopId);
        loopId = null;
      }
      isProcessing = false;
    }

    function liberarStream() {
      if (zoomIntervalId !== null) {
        clearInterval(zoomIntervalId);
        zoomIntervalId = null;
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
        cameraStream = null;
      }
      try { video.pause(); } catch (e) {}
      video.srcObject = null;
    }

    function iniciarBucle() {
      detenerBucle();
      const miGeneracion = loopGeneration;

      async function frameLoop() {
        if (miGeneracion !== loopGeneration || detenida) return;

        // Watchdog: si un send() quedó colgado, se libera el candado y se recrea Pose.
        if (isProcessing && Date.now() - processingSince > WATCHDOG_MS) {
          isProcessing = false;
          fallosSeguidos++;
          if (fallosSeguidos >= 2) {
            try { poseInstance && poseInstance.close(); } catch (e) {}
            poseInstance = crearPose();
            fallosSeguidos = 0;
          }
        }

        if (video.readyState >= 2 && !isProcessing && poseInstance) {
          isProcessing = true;
          processingSince = Date.now();
          try {
            await poseInstance.send({ image: video });
            fallosSeguidos = 0;
          } catch (e) {
            fallosSeguidos++;
          }
          if (miGeneracion === loopGeneration) isProcessing = false;
        }
        if (miGeneracion === loopGeneration && !detenida) {
          loopId = requestAnimationFrame(frameLoop);
        }
      }
      loopId = requestAnimationFrame(frameLoop);
    }

    // Zoom objetivo: 1x, o el mínimo soportado si el dispositivo no llega a 1x.
    function zoomObjetivo(track) {
      const caps = track.getCapabilities ? track.getCapabilities() : null;
      if (!caps || !caps.zoom) return null;
      return Math.min(Math.max(1, caps.zoom.min), caps.zoom.max);
    }

    // Fija el zoom en el objetivo para que no se "acerque" la imagen.
    async function fijarZoom(track) {
      try {
        const objetivo = zoomObjetivo(track);
        if (objetivo === null) return;
        const actual = track.getSettings ? track.getSettings().zoom : undefined;
        if (actual === undefined || Math.abs(actual - objetivo) > 0.01) {
          await track.applyConstraints({ advanced: [{ zoom: objetivo }] });
          if (actual !== undefined) sendToApp({ type: 'ZOOM_CORREGIDO', de: actual, a: objetivo });
        }
      } catch (e) {}
    }

    // Vigilante periódico: algunos dispositivos cambian el zoom solos (enfoque automático,
    // cambio de lente). Si el track se sale del objetivo, se vuelve a bloquear.
    function vigilarZoom(track) {
      if (zoomIntervalId !== null) clearInterval(zoomIntervalId);
      zoomIntervalId = setInterval(function() {
        if (detenida || !cameraStream || track.readyState !== 'live') return;
        fijarZoom(track);
      }, VIGILANCIA_ZOOM_MS);
    }

    function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function abrirStream(facingMode) {
      const constraints = {
        video: { facingMode: facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      };
      let ultimoError = null;
      for (let intento = 0; intento < 4; intento++) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
          ultimoError = err;
          const nombre = err && err.name;
          // Cámara aún ocupada por la vista anterior: esperar y reintentar.
          if (nombre === 'NotReadableError' || nombre === 'AbortError' || nombre === 'TrackStartError') {
            await esperar(400 * (intento + 1));
            continue;
          }
          throw err;
        }
      }
      throw ultimoError;
    }

    async function startCamera(facingMode) {
      if (arrancando) return;
      arrancando = true;
      try {
        detenida = false;
        currentFacing = facingMode;
        const isFront = facingMode === 'user';
        video.style.transform = isFront ? 'scaleX(-1)' : 'scaleX(1)';
        canvas.style.transform = isFront ? 'scaleX(-1)' : 'scaleX(1)';

        detenerBucle();
        liberarStream();

        const stream = await abrirStream(currentFacing);
        if (detenida) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        cameraStream = stream;
        const track = cameraStream.getVideoTracks()[0];
        if (track) {
          await fijarZoom(track);
          vigilarZoom(track);
        }

        video.srcObject = cameraStream;
        try { await video.play(); } catch (e) {}

        if (!poseInstance) poseInstance = crearPose();
        ultimoEstadoHumano = null;
        sendToApp({ type: 'CAMERA_READY' });
        iniciarBucle();
      } catch (err) {
        sendToApp({ type: 'CAMERA_ERROR', error: (err && err.message) || 'No se pudo acceder a la cámara.' });
      } finally {
        arrancando = false;
      }
    }

    window.detenerCamara = function() {
      detenida = true;
      detenerBucle();
      liberarStream();
      try { poseInstance && poseInstance.close(); } catch (e) {}
      poseInstance = null;
    };

    window.reanudarCamara = function() {
      if (cameraStream && !detenida) return;
      startCamera(currentFacing);
    };

    window.toggleCameraFacing = function() {
      const nextFacing = currentFacing === 'user' ? 'environment' : 'user';
      startCamera(nextFacing);
      return nextFacing;
    };

    // Liberar la cámara si el WebView se oculta o se destruye.
    window.addEventListener('pagehide', window.detenerCamara);
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) window.detenerCamara();
    });

    function init() {
      // Protección contra doble arranque en la misma página.
      if (window.__metafitCamaraIniciada) return;
      window.__metafitCamaraIniciada = true;
      try {
        if (poseInstance) { try { poseInstance.close(); } catch (e) {} }
        poseInstance = crearPose();
      } catch (err) {
        sendToApp({ type: 'CAMERA_ERROR', error: (err && err.message) || 'No se pudo iniciar MediaPipe.' });
        return;
      }
      startCamera('user');
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  </script>
</body>
</html>
`;

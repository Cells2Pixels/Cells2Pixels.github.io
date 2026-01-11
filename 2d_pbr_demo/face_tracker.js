/* global vision */

(function () {
  "use strict";

  async function resolveVisionApi() {
    // Prefer the global bundle (UMD) if it loaded.
    if (globalThis.vision && globalThis.vision.FilesetResolver && globalThis.vision.FaceLandmarker) {
      return globalThis.vision;
    }

    // Cache module import across instances.
    if (globalThis.__mediapipeTasksVisionModule) {
      return globalThis.__mediapipeTasksVisionModule;
    }

    // Fallback: dynamically import the ESM bundle.
    // This makes the tracker robust when the UMD bundle fails to load (adblock, CDN outage, etc.).
    const mod = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"
    );
    globalThis.__mediapipeTasksVisionModule = mod;
    return mod;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function rotationMatrixToEulerYXZRowMajor(m) {
    // Euler (yaw around Y, pitch around X, roll around Z) from row-major 3x3.
    const r02 = m[2];
    const r10 = m[4];
    const r11 = m[5];
    const r12 = m[6];
    const r22 = m[10];

    const pitch = Math.asin(clamp(-r12, -1, 1));
    const yaw = Math.atan2(r02, r22);
    const roll = Math.atan2(r10, r11);
    return { yaw: yaw, pitch: pitch, roll: roll };
  }

  class FaceCameraTracker {
    constructor(options) {
      const opt = options || {};

      this._video = opt.video || null;
      this._stream = null;
      this._landmarker = null;
      this._neutral = null;

      // Tuning. These defaults are chosen for the 2d_pbr_demo camera.
      this.params = {
        // Base mapping from raw translation (dx/dy) to world-space parallax offset.
        xyGainBase: opt.xyGainBase ?? 0.12,

        // Use face depth delta to scale parallax strength.
        depthGain: opt.depthGain ?? 0.02,
        depthScaleMin: opt.depthScaleMin ?? 0.6,
        depthScaleMax: opt.depthScaleMax ?? 3.0,

        // Clamp in world units. Scaled by depthScale.
        maxXYBase: opt.maxXYBase ?? 3.0,

        // If you want to ALSO move camera along view direction (usually unnecessary), set > 0.
        zGain: opt.zGain ?? 0.0,
        maxZ: opt.maxZ ?? 3.0,

        // Smoothing (0..1). Larger = snappier.
        smoothPos: opt.smoothPos ?? 0.18,
        smoothRot: opt.smoothRot ?? 0.12,

        // MediaPipe bundle version + model
        wasmRoot:
          opt.wasmRoot ??
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
        modelAssetPath:
          opt.modelAssetPath ??
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      };

      this.pose = {
        ok: false,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        roll: 0,
        depthScale: 1,
        zRawDelta: 0,
        raw: null,
      };

      this.started = false;
    }

    async start() {
      if (this.started) return;

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("getUserMedia is not available in this browser");
      }

      let visionApi;
      try {
        visionApi = await resolveVisionApi();
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        throw new Error(
          "Failed to load MediaPipe Tasks Vision. " +
            "If you're opening the file via file://, use a local web server. " +
            "Underlying error: " +
            msg
        );
      }

      if (!this._video) {
        const v = document.createElement("video");
        v.setAttribute("playsinline", "");
        v.muted = true;
        v.autoplay = true;
        v.style.display = "none";
        document.body.appendChild(v);
        this._video = v;
      }

      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      this._video.srcObject = this._stream;
      await this._video.play();

      const FilesetResolver = visionApi.FilesetResolver;
      const FaceLandmarker = visionApi.FaceLandmarker;

      if (!FilesetResolver || !FaceLandmarker) {
        throw new Error(
          "MediaPipe Tasks Vision loaded, but expected exports are missing (FilesetResolver/FaceLandmarker)."
        );
      }

      const fileset = await FilesetResolver.forVisionTasks(this.params.wasmRoot);
      this._landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.params.modelAssetPath },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
      });

      this.started = true;
    }

    update() {
      if (!this.started || !this._landmarker || !this._video || this._video.readyState < 2) {
        this.pose.ok = false;
        return this.pose;
      }

      const now = performance.now();
      const result = this._landmarker.detectForVideo(this._video, now);

      if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
        this.pose.ok = false;
        this.pose.raw = result;
        return this.pose;
      }

      const ftm = result.facialTransformationMatrixes?.[0]?.data;
      if (!ftm || ftm.length !== 16) {
        this.pose.ok = true;
        this.pose.raw = result;
        return this.pose;
      }

      // Translation: handle row-major vs column-major.
      const txRow = ftm[3],
        tyRow = ftm[7],
        tzRow = ftm[11];
      const txCol = ftm[12],
        tyCol = ftm[13],
        tzCol = ftm[14];
      const rowScore = Math.abs(txRow) + Math.abs(tyRow) + Math.abs(tzRow);
      const colScore = Math.abs(txCol) + Math.abs(tyCol) + Math.abs(tzCol);
      const useColMajorTranslation = colScore > rowScore;

      const tx = useColMajorTranslation ? txCol : txRow;
      const ty = useColMajorTranslation ? tyCol : tyRow;
      const tz = useColMajorTranslation ? tzCol : tzRow;

      if (!this._neutral) this._neutral = { tx: tx, ty: ty, tz: tz };

      const dx = tx - this._neutral.tx;
      const dy = ty - this._neutral.ty;
      const dz = tz - this._neutral.tz;

      const depthScale = clamp(
        1 + -dz * this.params.depthGain,
        this.params.depthScaleMin,
        this.params.depthScaleMax
      );

      const xyGain = this.params.xyGainBase * depthScale;
      const maxXY = this.params.maxXYBase * depthScale;

      const targetX = clamp(dx * xyGain, -maxXY, maxXY);
      const targetY = clamp(-dy * xyGain, -maxXY, maxXY);
      const targetZ =
        this.params.zGain === 0
          ? 0
          : clamp(-dz * this.params.zGain, -this.params.maxZ, this.params.maxZ);

      const rot = rotationMatrixToEulerYXZRowMajor(ftm);

      this.pose.ok = true;
      this.pose.x = lerp(this.pose.x, targetX, this.params.smoothPos);
      this.pose.y = lerp(this.pose.y, targetY, this.params.smoothPos);
      this.pose.z = lerp(this.pose.z, targetZ, this.params.smoothPos);
      this.pose.yaw = lerp(this.pose.yaw, rot.yaw, this.params.smoothRot);
      this.pose.pitch = lerp(this.pose.pitch, rot.pitch, this.params.smoothRot);
      this.pose.roll = lerp(this.pose.roll, rot.roll, this.params.smoothRot);
      this.pose.depthScale = depthScale;
      this.pose.zRawDelta = dz;
      this.pose.raw = result;

      return this.pose;
    }

    resetNeutral() {
      this._neutral = null;
    }

    stop() {
      this.started = false;
      this._neutral = null;
      this.pose.ok = false;
      if (this._stream) {
        for (const t of this._stream.getTracks()) t.stop();
      }
      this._stream = null;
      // Not calling close() on landmarker; keep it for reuse.
    }
  }

  window.FaceCameraTracker = FaceCameraTracker;
})();

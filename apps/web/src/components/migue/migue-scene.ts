import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

export type MigueMode = "idle" | "username" | "password-hidden" | "password-visible";
export type MigueInteraction = { mode: MigueMode; winkId: number };
type Options = { paused: boolean; interaction?: MigueInteraction; ready: () => void; unavailable: () => void };

/** Decorative scene: receives field states and coordinates, never credentials. */
export function mountMigue(host: HTMLDivElement, options: Options) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, innerWidth < 640 ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.4, 0.4, 0.4, -0.4, 0.01, 10);
  camera.position.set(0, 1.60, 3);
  camera.lookAt(0, 1.60, 0);
  scene.add(new THREE.HemisphereLight(0xfff5e7, 0x737f91, 1.25));
  for (const [color, intensity, x, y, z] of [
    [0xffeddb, 2.3, -2, 4, 3], [0xdde9ff, 1.05, 2, 2, 2], [0xffffff, 1.1, 1, 3, -2],
  ] as const) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(x, y, z);
    scene.add(light);
  }

  const draco = new DRACOLoader().setDecoderPath("/marca/migue/draco/").setWorkerLimit(1);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const abort = new AbortController();
  let disposed = false, paused = options.paused, visible = true, ready = false;
  let root: THREE.Group | undefined, pivot: THREE.Object3D | undefined;
  const morphs: THREE.Mesh[] = [];
  let raf = 0, last = 0, time = 0, blinkStart = -100, nextBlink = 3.2;
  let tx = 0, ty = 0, targetEyeX = 0, targetEyeY = 0;
  let interaction = options.interaction ?? { mode: "idle", winkId: 0 };
  let winkAt = -100;
  let fieldAim = { x: 0.8, y: 0.1 };
  const rest = { yaw: 0, pitch: 0, eyeX: 0, eyeY: 0, peek: 0, smile: 0, surprise: 0, close: 0 };
  const current = { ...rest, wink: 0, gesture: 0 };
  const smooth = (value: number) => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
  let deformNeck: (() => void) | undefined;
  const eyeCenter = new THREE.Vector3(0.005, 1.6145, 0);
  const projectedEyeCenter = new THREE.Vector3();
  const trackingRegion = host.closest<HTMLElement>("[data-migue-gaze-region]") ?? host;

  function weight(mesh: THREE.Mesh, name: string, value: number) {
    const index = mesh.morphTargetDictionary?.[name];
    if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = value;
  }

  function prepareNeck() {
    if (!root || !pivot) return;
    root.updateMatrixWorld(true);
    const neck = root.getObjectByName("WEB_V18_Cuello_prueba_local") as THREE.Mesh | undefined;
    if (!neck?.isMesh) return;
    const position = neck.geometry.getAttribute("position") as THREE.BufferAttribute;
    const normal = neck.geometry.getAttribute("normal") as THREE.BufferAttribute;
    const base = new Float32Array(position.array), normals = new Float32Array(normal.array);
    const toWorld = neck.matrixWorld.clone(), fromWorld = toWorld.clone().invert();
    const normalToWorld = new THREE.Matrix3().getNormalMatrix(toWorld);
    const normalFromWorld = new THREE.Matrix3().getNormalMatrix(fromWorld);
    const point = new THREE.Vector3(), center = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const weights = new Float32Array(position.count);
    const head = pivot;
    head.getWorldPosition(center);
    for (let i = 0; i < position.count; i++) {
      point.fromArray(base, i * 3).applyMatrix4(toWorld);
      weights[i] = smooth((point.y - 1.36) / 0.029);
    }
    // Skin the small neck strip along the same rotation arc as the head.
    // The old 8-degree corrective morphs are unsuitable for the broad privacy turn.
    deformNeck = () => {
      for (let i = 0; i < position.count; i++) {
        rotation.identity().slerp(head.quaternion, weights[i] ?? 0);
        point.fromArray(base, i * 3).applyMatrix4(toWorld).sub(center)
          .applyQuaternion(rotation).add(center).applyMatrix4(fromWorld);
        position.setXYZ(i, point.x, point.y, point.z);
        point.fromArray(normals, i * 3).applyMatrix3(normalToWorld).normalize()
          .applyQuaternion(rotation).applyMatrix3(normalFromWorld).normalize();
        normal.setXYZ(i, point.x, point.y, point.z);
      }
      position.needsUpdate = true; normal.needsUpdate = true;
    };
  }

  function pose(blink: number) {
    if (pivot) {
      pivot.rotation.set(
        THREE.MathUtils.degToRad(current.pitch - 2.2 * current.gesture),
        THREE.MathUtils.degToRad(current.yaw - 3.5 * current.gesture),
        THREE.MathUtils.degToRad(-3 * current.gesture),
      );
      deformNeck?.();
    }
    const { eyeX, eyeY } = current;
    for (const mesh of morphs) {
      weight(mesh, "blink", Math.max(current.close, blink, mesh.name.endsWith("_R") ? current.wink : 0));
      weight(mesh, "smile", current.smile);
      weight(mesh, "surprise", current.surprise);
      weight(mesh, "wink_detail", current.gesture);
      weight(mesh, "peek", current.peek);
      weight(mesh, "gaze_left", Math.max(0, -eyeX));
      weight(mesh, "gaze_right", Math.max(0, eyeX));
      weight(mesh, "gaze_up", Math.max(0, -eyeY));
      weight(mesh, "gaze_down", Math.max(0, eyeY));
      weight(mesh, "gaze_curve_x", eyeX * eyeX - Math.abs(eyeX));
      weight(mesh, "gaze_curve_y", eyeY * eyeY - Math.abs(eyeY));
      weight(mesh, "gaze_curve_xy", -eyeX * eyeY);
    }
    if (root) root.position.y = paused ? 0 : Math.sin(time * 1.1) * 0.0013;
  }

  function targetPose(winking: boolean): typeof rest {
    if (winking) return { ...rest, smile: 0.65 };
    switch (interaction.mode) {
      case "username":
        return { ...rest, yaw: fieldAim.x * 8, pitch: fieldAim.y * 4, eyeX: fieldAim.x * 0.60, eyeY: fieldAim.y * 0.55, smile: 1 };
      case "password-hidden":
        return { ...rest, yaw: -30, pitch: 3, smile: 0.15, close: 1 };
      case "password-visible":
        return { ...rest, yaw: -20, pitch: 1, peek: 1, surprise: 0.85 };
      default:
        return { ...rest, yaw: tx * 8, pitch: ty * 4, eyeX: targetEyeX, eyeY: targetEyeY };
    }
  }

  const active = () => ready && !disposed && !paused && visible && !document.hidden;
  function draw() { if (!disposed && ready) renderer.render(scene, camera); }
  function animate(now: number) {
    raf = 0;
    if (!active()) return;
    const dt = Math.min((now - (last || now)) / 1000, 0.05);
    last = now; time += dt;
    const elapsed = time - winkAt;
    const winking = elapsed >= 0 && elapsed < 1.15;
    const target = targetPose(winking);
    for (const key of Object.keys(target) as (keyof typeof rest)[]) {
      const speed = key === "close" ? 15 : key.startsWith("eye") || key === "peek" ? 11 : 5.5;
      current[key] += (target[key] - current[key]) * (1 - Math.exp(-speed * dt));
    }
    const wink = winking ? smooth((elapsed - 0.12) / 0.18) * (1 - smooth((elapsed - 0.48) / 0.27)) : 0;
    const gesture = winking ? smooth(elapsed / 0.27) * (1 - smooth((elapsed - 0.60) / 0.48)) : 0;
    current.wink += (wink - current.wink) * (1 - Math.exp(-26 * dt));
    current.gesture += (gesture - current.gesture) * (1 - Math.exp(-15 * dt));
    if (time >= nextBlink) { blinkStart = time; nextBlink = time + 3.5 + Math.random() * 2.5; }
    const t = time - blinkStart;
    const closing = t >= 0 && t < 0.13 ? t / 0.13 : t >= 0.13 && t < 0.30 ? 1 - (t - 0.13) / 0.17 : 0;
    pose(winking ? 0 : Math.max(0, closing)); draw();
    raf = requestAnimationFrame(animate);
  }
  function refresh() {
    cancelAnimationFrame(raf); raf = 0; last = 0;
    if (document.hidden || !visible) reset();
    if (paused) { reset(); winkAt = -100; Object.assign(current, rest, { wink: 0, gesture: 0 }); pose(0); }
    if (!document.hidden && visible) draw();
    if (active()) raf = requestAnimationFrame(animate);
  }
  function resize() {
    if (disposed) return;
    reset();
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const span = 0.86;
    camera.left = -span * w / h / 2; camera.right = -camera.left;
    camera.top = span / 2; camera.bottom = -span / 2;
    camera.updateProjectionMatrix(); renderer.setSize(w, h, false); updateFocusAim(); draw();
  }
  function aimAt(clientX: number, clientY: number) {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    camera.updateMatrixWorld();
    projectedEyeCenter.copy(eyeCenter).project(camera);
    const originX = r.left + (projectedEyeCenter.x + 1) * r.width / 2;
    const originY = r.top + (1 - projectedEyeCenter.y) * r.height / 2;
    const reach = Math.max(110, r.height * 0.72);
    const dx = (clientX - originX) / reach, dy = (clientY - originY) / reach;
    const radius = Math.max(1, Math.hypot(dx, dy));
    return { x: dx / radius, y: dy / radius };
  }
  function updateFocusAim() {
    const field = trackingRegion.querySelector<HTMLElement>('[data-migue-input="username"]');
    if (!field) return;
    const r = field.getBoundingClientRect();
    fieldAim = aimAt(r.left + r.width / 2, r.top + r.height / 2);
  }
  function pointer(event: PointerEvent) {
    if (paused || !visible || event.pointerType !== "mouse") { reset(); return; }
    const field = trackingRegion.getBoundingClientRect();
    if (event.clientX < field.left || event.clientX > field.right ||
        event.clientY < field.top || event.clientY > field.bottom) { reset(); return; }
    const aim = aimAt(event.clientX, event.clientY);
    tx = aim.x; ty = aim.y;
    targetEyeX = tx * 0.60; targetEyeY = ty * 0.55;
  }
  function layoutChanged() { reset(); updateFocusAim(); }
  function reset() { tx = ty = targetEyeX = targetEyeY = 0; }
  function contextLost(event: Event) {
    event.preventDefault();
    if (!disposed) { options.unavailable(); dispose(); }
  }
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  const visibilityObserver = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; refresh(); });
  visibilityObserver.observe(host);
  document.addEventListener("pointermove", pointer, { passive: true });
  document.documentElement.addEventListener("pointerleave", reset);
  window.addEventListener("blur", reset);
  window.addEventListener("scroll", layoutChanged, { capture: true, passive: true });
  trackingRegion.addEventListener("pointerleave", reset);
  document.addEventListener("visibilitychange", refresh);
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  resize();

  function release(model: THREE.Object3D) {
    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
  }
  function dispose() {
    if (disposed) return;
    disposed = true; abort.abort(); cancelAnimationFrame(raf);
    sizeObserver.disconnect(); visibilityObserver.disconnect();
    document.removeEventListener("pointermove", pointer);
    document.documentElement.removeEventListener("pointerleave", reset);
    window.removeEventListener("blur", reset);
    window.removeEventListener("scroll", layoutChanged, true);
    trackingRegion.removeEventListener("pointerleave", reset);
    document.removeEventListener("visibilitychange", refresh);
    renderer.domElement.removeEventListener("webglcontextlost", contextLost);
    if (root) release(root);
    draco.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }

  void (async () => {
    try {
      const response = await fetch("/marca/migue/migue-casco-v6-calibrated.glb", { signal: abort.signal });
      if (!response.ok) throw new Error("Migue no disponible");
      const data = await response.arrayBuffer();
      if (disposed) return;
      const gltf = await loader.parseAsync(data, "/marca/migue/");
      if (disposed) { release(gltf.scene); return; }
      root = gltf.scene; pivot = root.getObjectByName("HeadPivot");
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          material.side = THREE.DoubleSide;
          if (object.name.startsWith("CASCO_") && material.name !== "Logo_oficial_San_Miguel_de_Tucuman" && material.name !== "Calcomania_blanca") material.toneMapped = false;
        }
        if (object.name === "CASCO_Logo_municipal" || object.name === "CASCO_Base_logo_blanca") {
          const original = object.material as THREE.MeshStandardMaterial;
          object.material = new THREE.MeshBasicMaterial({ map: original.map, color: 0xffffff, side: THREE.DoubleSide, transparent: original.transparent, toneMapped: false });
          original.dispose();
        }
        // Start from an explicit neutral pose, never the authoring preview weights.
        object.morphTargetInfluences?.fill(0);
        weight(object, "helmet_fit", 1);
        if (object.morphTargetInfluences) morphs.push(object);
        object.frustumCulled = false;
      });
      scene.add(root); prepareNeck(); ready = true; pose(0); resize(); refresh(); options.ready();
    } catch {
      if (!disposed) { options.unavailable(); dispose(); }
    }
  })();

  return {
    setInteraction(value: MigueInteraction) {
      if (disposed) return;
      if (value.winkId !== interaction.winkId && ready && !paused) winkAt = time;
      if (value.mode !== interaction.mode) reset();
      interaction = value; updateFocusAim();
    },
    setPaused(value: boolean) { if (!disposed) { paused = value; refresh(); } },
    dispose,
  };
}

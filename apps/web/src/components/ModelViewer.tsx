import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Lazy-loaded GLB/GLTF inspector (Three.js). */
export default function ModelViewer({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<string>('Loading model…');
  useEffect(() => {
    const el = host.current!;
    const w = el.clientWidth, h = 420;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.2));
    const dir = new THREE.DirectionalLight(0xffffff, 2); dir.position.set(3, 5, 4); scene.add(dir);
    scene.add(new THREE.GridHelper(10, 20, 0x30363d, 0x21262d));
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
    camera.position.set(2, 1.5, 3);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    let mixer: THREE.AnimationMixer | undefined;
    const clock = new THREE.Clock();
    let raf = 0;
    new GLTFLoader().load(url, (gltf) => {
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      const center = box.getCenter(new THREE.Vector3());
      root.position.sub(center);
      root.scale.setScalar(3 / size);
      scene.add(root);
      let tris = 0, meshes = 0;
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { meshes++; const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
      if (gltf.animations.length) { mixer = new THREE.AnimationMixer(root); mixer.clipAction(gltf.animations[0]).play(); }
      setInfo(`${meshes} meshes · ${Math.round(tris).toLocaleString()} triangles · ${gltf.animations.length} animation(s)`);
    }, undefined, (e) => setInfo('Failed to load model: ' + (e as Error).message));
    const loop = () => { raf = requestAnimationFrame(loop); mixer?.update(clock.getDelta()); controls.update(); renderer.render(scene, camera); };
    loop();
    return () => { cancelAnimationFrame(raf); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [url]);
  return <div><div ref={host} className="w-full overflow-hidden rounded-lg border border-border bg-bg" /><p className="mt-2 text-xs text-muted">{info} · drag to orbit, scroll to zoom</p></div>;
}

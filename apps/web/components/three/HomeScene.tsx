"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type Drag = { x: number; y: number };

const TAU = Math.PI * 2;

function Ring({ ratio, light, drag }: { ratio: number; light: boolean; drag: MutableRefObject<Drag> }) {
  const group = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const arc = useRef(0);
  const target = Math.min(Math.max(ratio, 0), 1) * TAU;

  const baseMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: light ? "#e6e6e6" : "#0c0c0c", roughness: 0.9, metalness: 0.05 }),
    [light],
  );
  const fillMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: light ? "#000000" : "#ffffff",
        emissive: light ? "#000000" : "#ffffff",
        emissiveIntensity: light ? 0 : 0.35,
        roughness: 0.35,
        metalness: 0.1,
      }),
    [light],
  );
  const baseGeo = useMemo(() => new THREE.TorusGeometry(1, 0.1, 24, 128), []);
  useEffect(() => () => [baseMat, fillMat, baseGeo].forEach((item) => item.dispose()), [baseMat, fillMat, baseGeo]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.rotation.x += (-0.42 + Math.sin(t * 0.35) * 0.08 + drag.current.y - g.rotation.x) * Math.min(1, delta * 6);
    g.rotation.y += (Math.sin(t * 0.25) * 0.22 + drag.current.x - g.rotation.y) * Math.min(1, delta * 6);

    const next = arc.current + (target - arc.current) * Math.min(1, delta * 2.4);
    if (fill.current && Math.abs(next - arc.current) > 0.002) {
      arc.current = next;
      fill.current.geometry.dispose();
      fill.current.geometry = new THREE.TorusGeometry(1, 0.125, 20, Math.max(8, Math.round((128 * next) / TAU)), Math.max(next, 0.0001));
    }
  });

  return (
    <group ref={group} position={[-0.62, -0.02, 0]} scale={1.1}>
      <mesh geometry={baseGeo} material={baseMat} />
      <mesh ref={fill} material={fillMat} rotation={[0, 0, -Math.PI / 2]} scale={[-1, 1, 1]}>
        <torusGeometry args={[1, 0.125, 20, 8, 0.0001]} />
      </mesh>
    </group>
  );
}

function detailFor(streak: number) {
  if (streak >= 30) return 3;
  if (streak >= 7) return 2;
  if (streak >= 3) return 1;
  return 0;
}

function Orb({ streak, light, drag }: { streak: number; light: boolean; drag: MutableRefObject<Drag> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const scale = 0.24 + Math.min(streak, 60) / 60 * 0.16;
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, detailFor(streak)), [streak]);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: streak > 0 ? (light ? "#111111" : "#f2f2f2") : light ? "#bdbdbd" : "#3a3a3a",
        roughness: 0.4,
        metalness: 0.2,
        flatShading: true,
      }),
    [streak, light],
  );
  useEffect(() => () => [geometry, material].forEach((item) => item.dispose()), [geometry, material]);
  useFrame((state, delta) => {
    const m = mesh.current;
    if (!m) return;
    m.rotation.y += delta * 0.35;
    m.rotation.x += (drag.current.y * 0.6 + 0.3 - m.rotation.x) * Math.min(1, delta * 4);
    m.position.y = 0.42 + Math.sin(state.clock.elapsedTime * 1.1) * 0.04;
  });
  return <mesh ref={mesh} geometry={geometry} material={material} position={[1.5, 0.42, 0]} scale={scale} />;
}

export default function HomeScene({
  ratio,
  streak,
  light,
  active,
  drag,
}: {
  ratio: number;
  streak: number;
  light: boolean;
  active: boolean;
  drag: MutableRefObject<Drag>;
}) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={[1, 2]}
      camera={{ position: [0, 0, 5], fov: 35 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      style={{ position: "absolute", inset: 0 }}
      aria-hidden="true"
    >
      <ambientLight intensity={light ? 0.9 : 0.12} />
      <directionalLight position={[0, 2.5, -3]} intensity={light ? 1 : 4} color="#ffffff" />
      <directionalLight position={[-3, -1, -2]} intensity={light ? 0.4 : 1.5} color="#ffffff" />
      <pointLight position={[1.5, 1.5, 3]} intensity={light ? 18 : 6} color="#ffffff" />
      <Ring ratio={ratio} light={light} drag={drag} />
      <Orb streak={streak} light={light} drag={drag} />
    </Canvas>
  );
}

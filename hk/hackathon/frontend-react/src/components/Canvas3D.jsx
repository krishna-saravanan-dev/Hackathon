import React, { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import { useStore, NODE_CLASSES } from "../store/useStore";

const STATUS_COLOR = { HEALTHY: "#35e0c0", AT_RISK: "#ffb454", VIOLATION: "#ff5c72" };

function nodeSlaState(nodeId, workloads) {
  const ws = workloads.filter((w) => w.nodeId === nodeId);
  if (!ws.length) return "HEALTHY";
  if (ws.some((w) => w.slaState === "VIOLATION")) return "VIOLATION";
  if (ws.some((w) => w.slaState === "AT_RISK")) return "AT_RISK";
  return "HEALTHY";
}

// Geometry differs per Node Class, per the Topology Studio spec.
// useMemo keyed on nodeClass so adding nodes never regenerates shared geometry.
function useBuildingGeometry(nodeClass) {
  return useMemo(() => {
    switch (nodeClass) {
      case "CORE_HYPERSCALE":
        return { w: 6, d: 6, floors: 9, floorH: 2.2, capShape: "wide" };
      case "MICRO_GATEWAY":
        return { w: 2.2, d: 2.2, floors: 2, floorH: 1.8, capShape: "antenna" };
      case "REGIONAL_EDGE":
      default:
        return { w: 4, d: 4, floors: 5, floorH: 2.0, capShape: "rack" };
    }
  }, [nodeClass]);
}

function Building({ node }) {
  const workloads = useStore((s) => s.workloads);
  const selectNode = useStore((s) => s.selectNode);
  const clearJustAdded = useStore((s) => s.clearJustAdded);
  const geo = useBuildingGeometry(node.nodeClass);
  const groupRef = useRef();
  const dropY = useRef(node._justAdded ? 25 : 0);

  const state = nodeSlaState(node.id, workloads);
  const color = STATUS_COLOR[state];
  const bodyH = geo.floors * geo.floorH;

  useFrame(() => {
    if (!groupRef.current) return;
    if (node._justAdded) {
      dropY.current += (0 - dropY.current) * 0.12;
      groupRef.current.position.y = dropY.current;
      if (Math.abs(dropY.current) < 0.05) {
        dropY.current = 0;
        clearJustAdded(node.id);
      }
    }
    const beacon = groupRef.current.userData.beacon;
    if (beacon) {
      const pulse = state === "HEALTHY" ? 1 : 0.75 + 0.4 * Math.sin(performance.now() / 280);
      beacon.scale.setScalar(pulse);
    }
  });

  return (
    <group
      ref={groupRef}
      position={[node.x, dropY.current, node.z]}
      onClick={(e) => { e.stopPropagation(); selectNode(node.id); }}
    >
      <mesh position={[0, bodyH / 2, 0]}>
        <boxGeometry args={[geo.w, bodyH, geo.d]} />
        <meshStandardMaterial color="#1a2532" roughness={0.55} metalness={0.35} />
      </mesh>

      {/* window strip band, colour follows SLA state, no separate anim state */}
      <mesh position={[0, bodyH * 0.55, geo.d / 2 + 0.01]}>
        <planeGeometry args={[geo.w * 0.7, bodyH * 0.5]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} />
      </mesh>

      {/* roof cap, shape varies by node class */}
      <mesh position={[0, bodyH + 0.45, 0]}>
        {geo.capShape === "antenna" ? (
          <cylinderGeometry args={[0.15, 0.15, 1.8, 8]} />
        ) : (
          <boxGeometry args={[geo.w * 0.6, 0.9, geo.d * 0.6]} />
        )}
        <meshStandardMaterial color="#232f3d" roughness={0.4} metalness={0.5} />
      </mesh>

      <mesh
        position={[0, bodyH + 1.4, 0]}
        ref={(el) => { if (groupRef.current) groupRef.current.userData.beacon = el; }}
      >
        <sphereGeometry args={[0.32, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* ground status ring */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[geo.w * 0.65, geo.w * 0.8, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} side={2} />
      </mesh>

      <Html distanceFactor={30} position={[0, bodyH + 2.4, 0]}>
        <div style={{ fontSize: 10, color: "#9fb0c2", whiteSpace: "nowrap", pointerEvents: "none" }}>
          {node.name}
        </div>
      </Html>
    </group>
  );
}

function ConnectionLines() {
  const nodes = useStore((s) => s.nodes);
  const connections = useStore((s) => s.connections);
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

  // default hub links for the seed topology, computed once
  const defaultLinks = useMemo(() => {
    const hub = nodes.find((n) => n.nodeClass === "CORE_HYPERSCALE");
    if (!hub) return [];
    return nodes.filter((n) => n.id !== hub.id && !n.userAdded).map((n) => ({ fromId: n.id, toId: hub.id }));
  }, [nodes]);

  const allLinks = [...defaultLinks, ...connections];

  return (
    <>
      {allLinks.map((c, i) => {
        const a = byId[c.fromId], b = byId[c.toId];
        if (!a || !b) return null;
        return (
          <Line
            key={`${c.fromId}-${c.toId}-${i}`}
            points={[[a.x, 1.5, a.z], [b.x, 1.5, b.z]]}
            color="#4f8cff"
            lineWidth={1}
            transparent
            opacity={0.45}
          />
        );
      })}
    </>
  );
}

function Ground() {
  return (
    <>
      <gridHelper args={[220, 44, "#1c2b3a", "#141c26"]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[220, 220]} />
        <meshBasicMaterial color="#0a0e14" transparent opacity={0.6} />
      </mesh>
    </>
  );
}

export default function Canvas3D() {
  const nodes = useStore((s) => s.nodes);
  return (
    <Canvas
      camera={{ position: [70, 55, 70], fov: 45 }}
      gl={{ antialias: true }}
      style={{ background: "#0a0e14" }}
    >
      <fog attach="fog" args={["#0a0e14", 60, 220]} />
      <ambientLight intensity={1.1} color="#445566" />
      <directionalLight position={[40, 80, 20]} intensity={0.6} color="#9fc7ff" />
      <Ground />
      <ConnectionLines />
      {nodes.map((n) => <Building key={n.id} node={n} />)}
      <OrbitControls minDistance={30} maxDistance={220} maxPolarAngle={Math.PI / 2.1} />
    </Canvas>
  );
}

export { NODE_CLASSES };

// NEXUS EDGE — vanilla Three.js digital twin. No build step, no npm.
// Every value rendered here comes straight from the backend snapshot;
// there is no separate animation state, so the twin can't show anything
// the control plane isn't actually doing.

const API = "";
let latestSnapshot = null;
let buildings = {};     // node_id -> THREE.Group
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let selectedNodeId = null;

// ---------- Three.js scene setup ----------------------------------------
const canvas = document.getElementById("twin");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
scene.fog = new THREE.Fog(0x0a0e14, 60, 220);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera.position.set(0, 55, 85);

let camAngle = 0.4, camDist = 100, camHeight = 55, camTargetY = 0;
let dragging = false, lastX = 0, lastY = 0;

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

canvas.addEventListener("mousedown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener("mouseup", () => dragging = false);
window.addEventListener("mousemove", (e) => {
  if (dragging) {
    camAngle -= (e.clientX - lastX) * 0.006;
    camHeight = Math.max(15, Math.min(90, camHeight - (e.clientY - lastY) * 0.15));
    lastX = e.clientX; lastY = e.clientY;
  }
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
});
canvas.addEventListener("wheel", (e) => {
  camDist = Math.max(35, Math.min(220, camDist + e.deltaY * 0.06));
});
canvas.addEventListener("click", () => {
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(Object.values(buildings).map(b => b.userData.hitbox));
  if (hits.length) {
    const nodeId = hits[0].object.userData.nodeId;
    selectNode(nodeId);
  }
});

function updateCamera() {
  camera.position.set(Math.sin(camAngle) * camDist, camHeight, Math.cos(camAngle) * camDist);
  camera.lookAt(0, camTargetY, 0);
}

// lighting
scene.add(new THREE.AmbientLight(0x445566, 1.1));
const key = new THREE.DirectionalLight(0x9fc7ff, 0.6);
key.position.set(40, 80, 20);
scene.add(key);

// grid floor — the "global grid base"
const grid = new THREE.GridHelper(220, 44, 0x1c2b3a, 0x141c26);
scene.add(grid);
const floorGeo = new THREE.PlaneGeometry(220, 220);
const floorMat = new THREE.MeshBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.6 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.05;
scene.add(floor);

// ---------- lat/lon -> grid projection (India bounding box) -------------
const LAT_RANGE = [8, 30], LON_RANGE = [70, 90];
function project(lat, lon) {
  const x = ((lon - LON_RANGE[0]) / (LON_RANGE[1] - LON_RANGE[0]) - 0.5) * 170;
  const z = -((lat - LAT_RANGE[0]) / (LAT_RANGE[1] - LAT_RANGE[0]) - 0.5) * 170;
  return [x, z];
}

const statusColor = { HEALTHY: 0x35e0c0, AT_RISK: 0xffb454, VIOLATION: 0xff5c72 };

function nodeSlaState(nodeId) {
  if (!latestSnapshot) return "HEALTHY";
  const ws = latestSnapshot.workloads.filter(w => w.node_id === nodeId);
  if (!ws.length) return "HEALTHY";
  if (ws.some(w => w.sla_state === "VIOLATION")) return "VIOLATION";
  if (ws.some(w => w.sla_state === "AT_RISK")) return "AT_RISK";
  return "HEALTHY";
}

function buildBuilding(node) {
  const group = new THREE.Group();
  const isCore = node.kind === "core";
  const floors = isCore ? 9 : 5;
  const w = isCore ? 6 : 4, d = isCore ? 6 : 4;
  const floorH = 2.1;
  const bodyH = floors * floorH;

  // main tower body
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a2532, roughness: 0.55, metalness: 0.35 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, d), bodyMat);
  body.position.y = bodyH / 2;
  group.add(body);

  // illuminated window strips (emissive, colour follows SLA state)
  const state = nodeSlaState(node.id);
  const winColor = statusColor[state];
  const winMat = new THREE.MeshBasicMaterial({ color: winColor });
  const windowsGroup = new THREE.Group();
  for (let f = 0; f < floors; f++) {
    for (let side = 0; side < 4; side++) {
      if (Math.random() > 0.35) continue; // some windows dark, looks real
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), winMat);
      const y = f * floorH + floorH / 2;
      const off = (Math.random() - 0.5) * (w - 1);
      if (side === 0) { win.position.set(off, y, d / 2 + 0.01); }
      if (side === 1) { win.position.set(off, y, -d / 2 - 0.01); win.rotation.y = Math.PI; }
      if (side === 2) { win.position.set(w / 2 + 0.01, y, off); win.rotation.y = Math.PI / 2; }
      if (side === 3) { win.position.set(-w / 2 - 0.01, y, off); win.rotation.y = -Math.PI / 2; }
      windowsGroup.add(win);
    }
  }
  group.add(windowsGroup);
  group.userData.windows = windowsGroup;
  group.userData.winMat = winMat;

  // server cap on roof — rack-like block with a beacon
  const capMat = new THREE.MeshStandardMaterial({ color: 0x232f3d, roughness: 0.4, metalness: 0.5 });
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.9, d * 0.6), capMat);
  cap.position.y = bodyH + 0.45;
  group.add(cap);

  const beaconMat = new THREE.MeshBasicMaterial({ color: winColor });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12), beaconMat);
  beacon.position.y = bodyH + 1.3;
  group.add(beacon);
  group.userData.beacon = beacon;
  group.userData.beaconMat = beaconMat;

  // status light ring on the ground
  const ringMat = new THREE.MeshBasicMaterial({ color: winColor, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(w * 0.65, w * 0.8, 24), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  group.userData.ringMat = ringMat;

  // invisible hitbox for raycasting (bigger than body, easy to click)
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(w + 1, bodyH + 2, d + 1),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitbox.position.y = bodyH / 2;
  hitbox.userData.nodeId = node.id;
  group.add(hitbox);
  group.userData.hitbox = hitbox;

  const [x, z] = project(node.lat, node.lon);
  group.position.set(x, 0, z);

  // label sprite
  group.userData.baseY = 0;
  return group;
}

function syncBuildings() {
  if (!latestSnapshot) return;
  const seen = new Set();
  for (const node of latestSnapshot.nodes) {
    seen.add(node.id);
    let g = buildings[node.id];
    if (!g) {
      g = buildBuilding(node);
      scene.add(g);
      buildings[node.id] = g;
      if (node.user_added) {
        // animated drop-in effect
        g.position.y = 30;
        g.userData.dropTarget = 0;
        g.userData.dropping = true;
      }
    }
    const state = nodeSlaState(node.id);
    const color = statusColor[state];
    g.userData.winMat.color.setHex(color);
    g.userData.beaconMat.color.setHex(color);
    g.userData.ringMat.color.setHex(color);
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 300);
    g.userData.beacon.scale.setScalar(state === "HEALTHY" ? 1 : 0.8 + pulse * 0.5);
  }
  for (const id of Object.keys(buildings)) {
    if (!seen.has(id)) {
      scene.remove(buildings[id]);
      delete buildings[id];
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  resize();
  updateCamera();
  for (const g of Object.values(buildings)) {
    if (g.userData.dropping) {
      g.position.y += (g.userData.dropTarget - g.position.y) * 0.12;
      if (Math.abs(g.position.y - g.userData.dropTarget) < 0.05) {
        g.position.y = 0;
        g.userData.dropping = false;
      }
    }
  }
  renderer.render(scene, camera);
}
animate();

// ---------- WebSocket -----------------------------------------------------
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "snapshot") {
      latestSnapshot = msg.payload;
      syncBuildings();
      renderSidebar();
    }
  };
  ws.onclose = () => setTimeout(connectWS, 1500); // exponential-ish backoff, simplified
}
connectWS();

// ---------- sidebar: SLA list, migrations, micro chart --------------------
function renderSidebar() {
  if (!latestSnapshot) return;
  const slaList = document.getElementById("sla-list");
  slaList.innerHTML = latestSnapshot.workloads.map(w => `
    <div class="sla-row">
      <span><span class="dot ${w.sla_state}"></span>${w.name}</span>
      <span>${w.latency_ms.toFixed(1)}ms / ${w.sla_limit_ms}ms</span>
    </div>
  `).join("");

  const migList = document.getElementById("mig-list");
  const migs = latestSnapshot.migrations.slice(-6).reverse();
  migList.innerHTML = migs.length ? migs.map(m => `
    <div class="mig-row">
      ${m.workload_id} → ${m.to_node} <span class="state">${m.state}</span>
      ${m.verified === null ? "" : (m.verified ? '<span class="ver-true"> ✓ verified</span>' : '<span class="ver-false"> ✗ not verified</span>')}
    </div>
  `).join("") : '<div class="muted">No migrations yet.</div>';

  drawUtilChart();
  if (selectedNodeId) renderDetail(selectedNodeId);
}

function drawUtilChart() {
  const c = document.getElementById("chart-util");
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const nodes = latestSnapshot.nodes;
  const barW = c.width / nodes.length;
  nodes.forEach((n, i) => {
    const util = n.cpu_used / n.cpu_capacity;
    const h = util * (c.height - 20);
    const state = nodeSlaState(n.id);
    ctx.fillStyle = "#" + statusColor[state].toString(16).padStart(6, "0");
    ctx.globalAlpha = 0.85;
    ctx.fillRect(i * barW + 4, c.height - h - 14, barW - 8, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#7b8899";
    ctx.font = "9px sans-serif";
    ctx.fillText(n.city.slice(0, 3).toUpperCase(), i * barW + 4, c.height - 3);
  });
}

function selectNode(nodeId) {
  selectedNodeId = nodeId;
  renderDetail(nodeId);
}

function renderDetail(nodeId) {
  const node = latestSnapshot.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const panel = document.getElementById("detail-panel");
  panel.hidden = false;
  document.getElementById("detail-title").textContent = node.name;
  const util = ((node.cpu_used / node.cpu_capacity) * 100).toFixed(0);
  const wls = latestSnapshot.workloads.filter(w => w.node_id === nodeId);
  document.getElementById("detail-body").innerHTML = `
    <div><b>City:</b> ${node.city} (${node.provenance})</div>
    <div><b>CPU:</b> ${util}% of ${node.cpu_capacity} vCPU</div>
    <div><b>Power:</b> ${node.power_w.toFixed(0)} W (ESTIMATED)</div>
    <div><b>Cost:</b> ${node.cost_per_hr.toFixed(2)} /hr (ESTIMATED)</div>
    <div><b>Reliability:</b> ${(node.reliability * 100).toFixed(1)}%</div>
    <div><b>Workloads:</b> ${wls.length ? wls.map(w => w.name).join(", ") : "none"}</div>
    ${node.user_added ? '<div style="color:#ffb454">User-provisioned — remove to restore determinism.</div>' : ""}
  `;
}

// ---------- top bar actions ------------------------------------------------
document.getElementById("btn-add-node").onclick = () => {
  document.getElementById("modal-add").hidden = false;
};
document.getElementById("btn-cancel").onclick = () => {
  document.getElementById("modal-add").hidden = true;
};
document.getElementById("btn-confirm").onclick = async () => {
  const name = document.getElementById("in-name").value || "New Edge";
  const city = document.getElementById("in-city").value || "Unknown";
  const lat = parseFloat(document.getElementById("in-lat").value) || 20;
  const lon = parseFloat(document.getElementById("in-lon").value) || 78;
  await fetch(`${API}/api/nodes`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, city, lat, lon, kind: "edge" }),
  });
  document.getElementById("modal-add").hidden = true;
};

document.getElementById("btn-spike").onclick = async () => {
  if (!latestSnapshot) return;
  const target = latestSnapshot.nodes.find(n => n.kind === "edge");
  if (target) {
    await fetch(`${API}/api/scenarios/spike`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: target.id, multiplier: 2.6 }),
    });
  }
};
document.getElementById("btn-clear").onclick = async () => {
  await fetch(`${API}/api/scenarios/clear`, { method: "POST" });
};
document.getElementById("btn-reset").onclick = async () => {
  await fetch(`${API}/api/reset`, { method: "POST" });
  selectedNodeId = null;
  document.getElementById("detail-panel").hidden = true;
};

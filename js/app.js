// js/app.js
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

// YOUR published Google Sheet CSV (public)
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdQ8324RdvqZwBjWEXJj-C9-GE1BIKfYNwNcKA4doOJC5Qi-zR0vWJOEfE3h_WGLYsMMaycNnRaDxY/pub?gid=0&single=true&output=csv";

/* ----------------------
   Configurable parameters
   ---------------------- */
const CONFIG = {
  table: { cols: 20, rows: 10, xGap: 160, yGap: 200, zOffset: -1500 },
  sphere: { radius: 1400 },
  helix: { radius: 800, pairAngleStep: 0.8, verticalSpacing: 60, strandSeparation: 60 },
  grid: { columns: 5, rows: 4, itemsPerLayer: 20, xGap: 300, yGap: 400, zGap: 400 }
};

/* ----------------------
   App state
   ---------------------- */
let camera, scene, renderer, controls;
let objects = []; // CSS3DObject instances
let targets = { table: [], sphere: [], helix: [], grid: [] };
let helixMeta = null; // stored for camera framing

init();
loadCSV();

/* ----------------------
   Initialization
   ---------------------- */
function init() {
  // camera: wide frustum and moderately far back start
  camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 20000);
  camera.position.set(0, 0, 4500);

  scene = new THREE.Scene();

  renderer = new CSS3DRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('container').appendChild(renderer.domElement);

  // TrackballControls: create, then tune when switching views
  controls = new TrackballControls(camera, renderer.domElement);
  controls.minDistance = 10;
  controls.maxDistance = 20000;
  controls.rotateSpeed = 2.0;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.8;
  controls.target.set(0, 0, 0);
  controls.update();

  // wire buttons now (they will work even before CSV loads)
  document.getElementById('btn-table').onclick = () => switchTo('table');
  document.getElementById('btn-sphere').onclick = () => switchTo('sphere');
  document.getElementById('btn-helix').onclick = () => switchTo('helix');
  document.getElementById('btn-grid').onclick = () => switchTo('grid');

  window.addEventListener('resize', onWindowResize);

  // start render loop once
  animate();
}

/* ----------------------
   CSV loading + parsing (uses PapaParse loaded globally)
   ---------------------- */
async function loadCSV() {
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
    const txt = await res.text();

    // Use PapaParse with header:true for safer key mapping
    Papa.parse(txt, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      complete: function(results) {
        const rows = results.data || [];
        // Clean keys case-insensitively, map fields robustly
        const parsed = rows.map(r => {
          const keys = mapKeysLower(r);
          return {
            name: keys['name'] || keys['Name'] || keys['full name'] || keys['fullname'] || keys['Name'.toLowerCase()] || r[Object.keys(r)[0]] || '',
            photo: keys['photo'] || keys['photo url'] || keys['photo_url'] || keys['photourl'] || keys['photo-url'] || '',
            age: keys['age'] || '',
            country: keys['country'] || '',
            interest: keys['interest'] || keys['interests'] || '',
            net: keys['net'] || keys['networth'] || keys['net worth'] || keys['net_worth'] || ''
          };
        });

        // If header line was not actual header and first row contains titles, caller earlier used header:false.
        // If parsing returns rows where photo doesn't look like URL for the first row, we can drop it.
        // But Papa header:true usually avoids that.
        buildTiles(parsed);
        buildTargets(parsed.length);
        // initial view -> table
        smartFrame('table');
        transform(targets.table);
      }
    });
  } catch (err) {
    console.error("CSV load error:", err);
  }
}

// helper: normalize keys to lowercase (returns mapping of lowercase->value)
function mapKeysLower(obj) {
  const out = {};
  Object.keys(obj).forEach(k => {
    out[k.trim().toLowerCase()] = (obj[k] || '').toString().trim();
  });
  return out;
}

/* ----------------------
   Build CSS3D tiles
   ---------------------- */
function netColor(net) {
  const num = Number((net || '').replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return 'red';
  if (num > 200000) return 'green';
  if (num >= 100000) return 'orange';
  return 'red';
}

function buildTiles(data) {
  // clear previous
  objects.forEach(o => scene.remove(o));
  objects = [];

  data.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = `tile ${netColor(p.net)}`;

    // set up inner HTML (same layout you requested)
    el.innerHTML = `
      <div class="top-row">
        <span class="country">${escapeHtml(p.country)}</span>
        <span class="age">${escapeHtml(p.age)}</span>
      </div>
      <div class="photo"><img src="${escapeAttr(p.photo)}" alt="${escapeAttr(p.name)}" /></div>
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="interest">${escapeHtml(p.interest)}</div>
    `;

    // prevent images from being draggable by the browser
    const img = el.querySelector('img');
    if (img) {
      img.ondragstart = () => false;
      img.style.pointerEvents = 'none'; // avoid interfering with controls
    }

    const obj = new CSS3DObject(el);

    // initial random spread (wider)
    obj.position.set(
      Math.random() * 8000 - 4000,
      Math.random() * 8000 - 4000,
      Math.random() * 8000 - 4000
    );

    scene.add(obj);
    objects.push(obj);
  });
}

// small helpers to avoid html injection & ensure valid attributes
function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s){ return escapeHtml(s); }

/* ----------------------
   Build target layouts
   ---------------------- */
function buildTargets(count) {
  // clear
  targets = { table: [], sphere: [], helix: [], grid: [] };

  // ---- TABLE (centered, pushed slightly back) ----
  const tCols = CONFIG.table.cols;
  const tRows = CONFIG.table.rows;
  const txGap = CONFIG.table.xGap;
  const tyGap = CONFIG.table.yGap;
  const tZ = CONFIG.table.zOffset;
  const tableWidth = tCols * txGap;
  const tableHeight = tRows * tyGap;

  for (let i = 0; i < count; i++) {
    const o = new THREE.Object3D();
    const col = i % tCols;
    const row = Math.floor(i / tCols) % tRows;
    o.position.set(
      col * txGap - tableWidth / 2 + txGap / 2,
      -row * tyGap + tableHeight / 2 - tyGap / 2,
      tZ
    );
    targets.table.push(o);
  }

  // ---- SPHERE (Fibonacci sphere) ----
  const sRadius = CONFIG.sphere.radius;
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(-1 + (2 * (i + 0.5)) / count);
    const theta = Math.sqrt(count * Math.PI) * phi;
    const o = new THREE.Object3D();
    o.position.set(
      sRadius * Math.cos(theta) * Math.sin(phi),
      sRadius * Math.sin(theta) * Math.sin(phi),
      sRadius * Math.cos(phi)
    );
    // orient to face outward
    o.lookAt(o.position.clone().multiplyScalar(2));
    targets.sphere.push(o);
  }

  // ---- HELIX (double helix) ----
  {
    const helixRadius = CONFIG.helix.radius;
    const angleStep = CONFIG.helix.pairAngleStep;
    const verticalSpacing = CONFIG.helix.verticalSpacing;
    const strandSep = CONFIG.helix.strandSeparation;

    const pairs = Math.ceil(count / 2);
    const helixYOffset = (pairs - 1) * verticalSpacing / 2;
    helixMeta = { radius: helixRadius, totalHeight: pairs * verticalSpacing };

    for (let i = 0; i < count; i++) {
      const strand = i % 2; // 0 or 1
      const pairIndex = Math.floor(i / 2);
      const baseAngle = pairIndex * angleStep;
      const strandPhase = strand === 0 ? 0 : Math.PI;
      const stagger = strand === 0 ? 0 : angleStep * 0.4;
      const angle = baseAngle + strandPhase + stagger;
      const radius = helixRadius + (strand === 0 ? -strandSep : strandSep);
      const helixY = pairIndex * verticalSpacing - helixYOffset;

      const o = new THREE.Object3D();
      o.position.set(radius * Math.cos(angle), helixY, radius * Math.sin(angle));
      // face outward slightly:
      o.lookAt(new THREE.Vector3(0, helixY, 0));
      targets.helix.push(o);
    }
  }

  // ---- GRID (centered layers along Z) ----
  {
    const cols = CONFIG.grid.columns;
    const rows = CONFIG.grid.rows;
    const itemsPerLayer = CONFIG.grid.itemsPerLayer;
    const xGap = CONFIG.grid.xGap;
    const yGap = CONFIG.grid.yGap;
    const zGap = CONFIG.grid.zGap;

    const layers = Math.ceil(count / itemsPerLayer);
    const totalDepth = (layers - 1) * zGap;

    for (let i = 0; i < count; i++) {
      const layerIndex = Math.floor(i / itemsPerLayer);
      const col = i % cols;
      const row = Math.floor(i / cols) % rows;
      const centeredZ = layerIndex * zGap - totalDepth / 2;
      const o = new THREE.Object3D();
      o.position.set(
        col * xGap - ((cols * xGap) / 2) + xGap / 2,
        -row * yGap + ((rows * yGap) / 2) - yGap / 2,
        centeredZ
      );
      targets.grid.push(o);
    }
  }
}

/* ----------------------
   Transform optimization
   - remove stacking tweens
   - single tween per object (position+rotation)
   - slight stagger to avoid same-frame pileups
   ---------------------- */
function transform(targetArray, duration = 1200) {
  if (!targetArray || objects.length === 0) return;

  // remove previous tweens so they don't stack
  TWEEN.removeAll();

  const perItemStagger = 6; // ms
  const maxStagger = 400; // ms

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const target = targetArray[i];
    if (!target) continue;

    const delay = Math.min(i * perItemStagger, maxStagger);

    // Tween the object (CSS3DObject has position & rotation properties)
    new TWEEN.Tween(obj)
      .to({
        position: {
          x: target.position.x,
          y: target.position.y,
          z: target.position.z
        },
        rotation: {
          x: target.rotation.x || 0,
          y: target.rotation.y || 0,
          z: target.rotation.z || 0
        }
      }, duration)
      .delay(delay)
      .easing(TWEEN.Easing.Cubic.InOut)
      .start();
  }

  // small dummy tween to keep time window predictable
  new TWEEN.Tween({})
    .to({}, duration + maxStagger)
    .start();
}

/* ----------------------
   Camera/control helpers
   - resetControlsAfterCameraChange: keeps TrackballControls from snapping
   - smartFrame: choose good camera distance & update controls
   ---------------------- */
function resetControlsAfterCameraChange() {
  if (!controls || !camera) return;
  // copy camera position into controls internals (safe guarded)
  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  if (controls.object) controls.object.position.copy(camera.position);
  try {
    if (controls._eye) controls._eye.copy(offset);
  } catch (e) {
    // some Trackball builds may differ; ignore safely
  }
  controls.update();
}

function smartFrame(viewName) {
  // set camera position & control ranges depending on view
  if (!camera || !controls) return;

  switch (viewName) {
    case 'table':
      camera.position.set(0, 0, 3500);
      controls.minDistance = 500;
      controls.maxDistance = 20000;
      break;
    case 'sphere':
      camera.position.set(0, 0, Math.max(CONFIG.sphere.radius * 3.0, 3000));
      controls.minDistance = 200;
      controls.maxDistance = 20000;
      break;
    case 'helix':
      {
        const meta = helixMeta || { radius: CONFIG.helix.radius, totalHeight: 1000 };
        const cam = Math.max(meta.radius * 3.2, meta.totalHeight * 1.1, 3500);
        camera.position.set(0, 0, cam);
        controls.minDistance = 5;
        controls.maxDistance = 40000;
      }
      break;
    case 'grid':
      camera.position.set(0, 0, 4000);
      controls.minDistance = 200;
      controls.maxDistance = 20000;
      break;
    default:
      camera.position.set(0, 0, 4500);
      controls.minDistance = 10;
      controls.maxDistance = 20000;
      break;
  }

  controls.target.set(0, 0, 0);
  resetControlsAfterCameraChange();
}

/* Switch view helper used by buttons */
function switchTo(viewName) {
  smartFrame(viewName);
  // pick targets by name
  const t = targets[viewName] || targets.table;
  transform(t);
}

/* ----------------------
   Utility + render loop
   ---------------------- */
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  TWEEN.update();
  if (controls) controls.update();
  renderer.render(scene, camera);
}

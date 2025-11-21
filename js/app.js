// webgl-version.js
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

const csvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdQ8324RdvqZwBjWEXJj-C9-GE1BIKfYNwNcKA4doOJC5Qi-zR0vWJOEfE3h_WGLYsMMaycNnRaDxY/pub?gid=0&single=true&output=csv";

let camera, scene, renderer, controls;
let objects = []; // THREE.Mesh plane objects (WebGL)
let tilesMeta = []; // metadata per tile (for updating textures when image loads)
let targets = { table: [], sphere: [], helix: [], grid: [] };
let needsRender = true;  // throttle render cycles
let lastFrame = 0;

init();
loadCSV();

function init() {
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 20000);
    camera.position.set(0, 0, 4500);

    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new TrackballControls(camera, renderer.domElement);
    controls.minDistance = 10;
    controls.maxDistance = 20000;
    controls.rotateSpeed = 2.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.target.set(0, 0, 0);

    // preserve your exact requested lines (unchanged)
    controls.addEventListener("start", () => forceFullRender = true);
    controls.addEventListener("end",   () => forceFullRender = true);
    controls.staticMoving = false;
    controls.dynamicDampingFactor = 0.1;

    // also trigger render on change (same semantics you had)
    controls.addEventListener('change', () => {
        needsRender = true;
    });

    // Ambient lighting not required for MeshBasicMaterial, but keep scene readable
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);

    animate();
    window.addEventListener('resize', onWindowResize);
}

// CSV loader (Papa should be global or imported)
async function loadCSV() {
    const res = await fetch(csvUrl);
    const txt = await res.text();

    Papa.parse(txt, {
        header: false,
        skipEmptyLines: true,
        complete: function (results) {
            let rows = results.data;
            rows.shift();

            const parsed = rows.map(parts => ({
                name: parts[0],
                photo: parts[1],
                age: parts[2],
                country: parts[3],
                interest: parts[4],
                net: parts[5]
            }));

            buildTiles(parsed);
            buildTargets(parsed.length);
            transform(targets.table);
        }
    });
}

function netColor(v) {
    const num = Number((v || '').replace(/[^0-9.]/g, ""));
    if (num < 100000) return 'red';
    if (num <= 200000) return 'orange';
    return 'green';
}

// --- Tile rendering settings (keeps visuals identical-ish) ---
const TILE_W = 220;   // visually matches your spacing
const TILE_H = 260;
const CANVAS_W = 512; // power-of-two for textures
const CANVAS_H = 614; // similar aspect

function buildTiles(data) {
    // Clear old
    objects.forEach(o => { scene.remove(o); if (o.material && o.material.map) o.material.map.dispose(); if (o.geometry) o.geometry.dispose(); });
    objects.length = 0;
    tilesMeta.length = 0;

    data.forEach((p, i) => {
        // create a canvas for each tile
        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const ctx = canvas.getContext('2d');

        // Initial draw (placeholder) to match CSS look
        drawTileToCanvas(ctx, p, netColor(p.net));

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;

        const geometry = new THREE.PlaneGeometry(TILE_W, TILE_H);
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geometry, material);

        // random scatter initial positions to mimic original
        mesh.position.x = Math.random() * 4000 - 2000;
        mesh.position.y = Math.random() * 4000 - 2000;
        mesh.position.z = Math.random() * 4000 - 2000;

        // Keep reference to canvas and texture for later updates when image loads
        tilesMeta.push({
            canvas, ctx, texture, data: p, colorClass: netColor(p.net)
        });

        scene.add(mesh);
        objects.push(mesh);

        // load image and redraw canvas when ready
        if (p.photo) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                drawTileToCanvas(ctx, p, netColor(p.net), img);
                texture.needsUpdate = true;
                needsRender = true;
            };
            img.onerror = () => {
                // keep what we have (placeholder)
            };
            img.src = p.photo;
        }
    });

    needsRender = true;
}

// Helper: draw the visual tile into 2D canvas (attempt to match your original HTML/CSS)
function drawTileToCanvas(ctx, p, colorClass, imageEl = null) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // clear
    ctx.clearRect(0, 0, w, h);

    // background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // colored top strip or border depending on netColor (mimic CSS classes)
    let accent = '#666';
    if (colorClass === 'red') accent = '#d9534f';
    else if (colorClass === 'orange') accent = '#f0ad4e';
    else if (colorClass === 'green') accent = '#5cb85c';

    // top row background
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, w, 64);

    // country & age text (top row)
    ctx.font = '28px Arial';
    ctx.fillStyle = '#333';
    ctx.textBaseline = 'middle';
    ctx.fillText((p.country || ''), 16, 22);
    ctx.fillText((p.age || ''), w - 60, 22);

    // Photo box
    const photoX = 16;
    const photoY = 80;
    const photoW = w - 32;
    const photoH = Math.round(photoW * 0.6); // similar aspect
    ctx.fillStyle = '#ddd';
    ctx.fillRect(photoX, photoY, photoW, photoH);

    if (imageEl) {
        // fit-crop the image into photo area with cover behavior
        const img = imageEl;
        const arImg = img.width / img.height;
        const arBox = photoW / photoH;
        let sx, sy, sw, sh;
        if (arImg > arBox) {
            // image wider → crop sides
            sh = img.height;
            sw = sh * arBox;
            sx = (img.width - sw) / 2;
            sy = 0;
        } else {
            // image taller → crop top/bottom
            sw = img.width;
            sh = sw / arBox;
            sx = 0;
            sy = (img.height - sh) / 2;
        }
        try {
            ctx.drawImage(img, sx, sy, sw, sh, photoX, photoY, photoW, photoH);
        } catch (e) {
            // drawing might fail cross-origin; keep placeholder
        }
    }

    // name
    ctx.font = '28px Arial';
    ctx.fillStyle = '#222';
    ctx.textBaseline = 'top';
    const nameY = photoY + photoH + 12;
    ctx.fillText(p.name || '', 16, nameY);

    // interest (wrap if needed)
    ctx.font = '20px Arial';
    ctx.fillStyle = '#555';
    const interestY = nameY + 34;
    wrapText(ctx, p.interest || '', 16, interestY, w - 32, 22);

    // bottom accent bar indicating net color
    ctx.fillStyle = accent;
    ctx.fillRect(0, h - 12, w, 12);

    // border & subtle round
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, w - 2, h - 2, 8);
}

// small utility: draw rounded rect
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.stroke();
}

// small utility: wrap text
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    if (!text) return;
    const words = text.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            ctx.fillText(line, x, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line, x, y);
}

// --- Targets construction (identical math to your original) ---
function buildTargets(count) {
    // Table
    for (let i = 0; i < count; i++) {
        let obj = new THREE.Object3D();
        obj.position.set((i % 20) * 220 - 2200, -(Math.floor(i / 20) % 10) * 260 + 1200, 0);
        targets.table.push(obj);
    }

    // Sphere
    for (let i = 0; i < count; i++) {
        let obj;
        const phi = Math.acos(-1 + (2 * (i + 0.5)) / count);
        const theta = Math.sqrt(count * Math.PI) * phi;
        obj = new THREE.Object3D();
        obj.position.set(
            1400 * Math.cos(theta) * Math.sin(phi),
            1400 * Math.sin(theta) * Math.sin(phi),
            1400 * Math.cos(phi)
        );
        obj.lookAt(new THREE.Vector3(obj.position.x * 2, obj.position.y * 2, obj.position.z * 2));
        targets.sphere.push(obj);
    }

    // Helix (preserve your helix meta math)
    const helixRadius = 800;
    const angleStep = 0.25;
    const verticalSpacing = 40;
    const totalSegments = Math.ceil(count / 2);
    const helixYOffset = (totalSegments - 1) * verticalSpacing / 2;
    window._helixMeta = { radius: helixRadius, totalHeight: totalSegments * verticalSpacing };

    for (let i = 0; i < count; i++) {
        const strand = i % 2;
        const pairIndex = Math.floor(i / 2);
        const baseAngle = pairIndex * angleStep;
        const strandPhase = strand === 0 ? 0 : Math.PI;
        const stagger = strand === 0 ? 0 : angleStep * 0.4;
        const angle = baseAngle + strandPhase + stagger;
        const helixHeight = pairIndex * verticalSpacing - helixYOffset;
        let obj = new THREE.Object3D();
        obj.position.set(helixRadius * Math.cos(angle), helixHeight, helixRadius * Math.sin(angle));
        obj.lookAt(new THREE.Vector3(0, helixHeight, 0));
        targets.helix.push(obj);
    }

    // Grid
    const layers = Math.ceil(count / 20);
    const zGap = 400;
    const itemsPerLayer = 20;
    const totalDepth = (layers - 1) * zGap;

    for (let i = 0; i < count; i++) {
        const layerIndex = Math.floor(i / itemsPerLayer);
        const centeredZ = layerIndex * zGap - totalDepth / 2;
        let obj = new THREE.Object3D();
        obj.position.set((i % 5) * 300 - 600, (Math.floor(i / 5) % 4) * 400 - 400, centeredZ);
        targets.grid.push(obj);
    }
}

// Transform (tween positions + rotations) — adapted to WebGL meshes
function transform(targetsArray, duration = 1200) {
    if (!targetsArray || !objects.length) return;
    TWEEN.removeAll();

    const setNeedsRender = () => needsRender = true;
    const maxStagger = 300;
    const perItemStagger = 6;

    objects.forEach((obj, i) => {
        const target = targetsArray[i];
        if (!target) return;

        const delay = Math.min(i * perItemStagger, maxStagger);

        // Position tween
        new TWEEN.Tween(obj.position)
            .to({
                x: target.position.x,
                y: target.position.y,
                z: target.position.z
            }, duration)
            .delay(delay)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onStart(setNeedsRender)
            .onUpdate(setNeedsRender)
            .start();

        // Rotation: copy target quaternion and slerp
        const targetQuat = new THREE.Quaternion().copy(target.quaternion);
        const startQuat = new THREE.Quaternion().copy(obj.quaternion);

        const qTween = { t: 0 };
        new TWEEN.Tween(qTween)
            .to({ t: 1 }, duration)
            .delay(delay)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onUpdate(() => {
                obj.quaternion.copy(startQuat).slerp(targetQuat, qTween.t);
                needsRender = true;
            })
            .start();
    });

    needsRender = true;
}

// Buttons (assumes these elements exist)
document.getElementById('btn-table').onclick = () => transform(targets.table);
document.getElementById('btn-sphere').onclick = () => transform(targets.sphere);
document.getElementById('btn-helix').onclick = () => transform(targets.helix);
document.getElementById('btn-grid').onclick = () => transform(targets.grid);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    needsRender = true;
}

let forceFullRender = true; // used by controls event handlers above

function animate(time) {
    requestAnimationFrame(animate);

    const delta = time - lastFrame;

    // Always update controls
    controls.update();

    // Always update tween animations
    if (TWEEN.getAll().length > 0) {
        TWEEN.update(time);
        needsRender = true;
    }

    // Throttle only the render calls (match your original throttle)
    if (delta > 16) {
        lastFrame = time;

        if (needsRender || forceFullRender) {
            renderer.render(scene, camera);
            needsRender = false;
            forceFullRender = false;
        }
    }
}

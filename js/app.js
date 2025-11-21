// js/app.js
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

// CSV URL (unchanged)
const csvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdQ8324RdvqZwBjWEXJj-C9-GE1BIKfYNwNcKA4doOJC5Qi-zR0vWJOEfE3h_WGLYsMMaycNnRaDxY/pub?gid=0&single=true&output=csv";

// Scene globals
let camera, scene, renderer, controls;
let objects = []; // THREE.Mesh plane objects (WebGL)
let tilesMeta = []; // metadata per tile (canvas, dom clone, texture, data)
let targets = { table: [], sphere: [], helix: [], grid: [] };
let needsRender = true;  // throttle render cycles
let lastFrame = 0;

let raycaster, mouse, lastHover = null;
let html2canvasAvailable = typeof html2canvas !== 'undefined';

// Tile visual constants (match your CSS)
const CSS_TILE_W = 180; // css pixels
const CSS_TILE_H = 240;
const DPR = Math.min(window.devicePixelRatio || 1, 2); // cap DPR for perf
const CANVAS_W = Math.round(CSS_TILE_W * DPR);
const CANVAS_H = Math.round(CSS_TILE_H * DPR);
const PLANE_W = 220; // keep plane dims to preserve layout math
const PLANE_H = 260;

init();
loadCSV();

// -------------------------------
// Initialization
// -------------------------------
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

    // preserve your exact requested lines (UNCHANGED)
    controls.addEventListener("start", () => forceFullRender = true);
    controls.addEventListener("end",   () => forceFullRender = true);
    controls.staticMoving = false;
    controls.dynamicDampingFactor = 0.1;

    controls.addEventListener('change', () => { needsRender = true; });

    // Ambient light (not required, but OK)
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);

    // Raycaster for hover
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('resize', onWindowResize);

    animate();
}

// -------------------------------
// CSV loader
// -------------------------------
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

// -------------------------------
// Helpers
// -------------------------------
function netColor(v) {
    const num = Number((v || '').replace(/[^0-9.]/g, ""));
    if (num < 100000) return 'red';
    if (num <= 200000) return 'orange';
    return 'green';
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
    });
}

// clear previous three objects & release textures
function clearSceneTiles() {
    objects.forEach(o => {
        scene.remove(o);
        if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
        }
        if (o.geometry) o.geometry.dispose();
    });
    objects.length = 0;
    tilesMeta.length = 0;
}

// -------------------------------
// Build tiles: create DOM clone, rasterize to canvas, make WebGL plane
// -------------------------------
function buildTiles(data) {
    clearSceneTiles();

    const templateRoot = document.getElementById('tile-template-root');
    if (!templateRoot) {
        console.warn('Missing #tile-template-root — ensure it exists in HTML');
    }

    data.forEach((p, i) => {
        // Create hidden DOM clone styled by your CSS (pixel-perfect)
        const dom = document.createElement('div');
        dom.className = `tile ${netColor(p.net)}`;
        dom.style.width = CSS_TILE_W + 'px';
        dom.style.height = CSS_TILE_H + 'px';
        dom.style.boxSizing = 'border-box';

        // Use data-src (we will convert to base64) to avoid immediate cross-origin image issues
        dom.innerHTML = `
            <div class="top-row">
                <span class="country">${escapeHtml(p.country || '')}</span>
                <span class="age">${escapeHtml(p.age || '')}</span>
            </div>
            <div class="photo"><img data-src="${p.photo || ''}" /></div>
            <div class="name">${escapeHtml(p.name || '')}</div>
            <div class="interest">${escapeHtml(p.interest || '')}</div>
        `;

        // append to hidden template root so CSS applies
        if (templateRoot) templateRoot.appendChild(dom);

        // Prepare canvas at device pixel ratio for crisp texture
        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const ctx = canvas.getContext('2d');

        // Initial placeholder draw (so texture is not empty)
        drawTileToCanvas(ctx, p, netColor(p.net), null, false);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        const geometry = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geometry, material);

        mesh.position.set(Math.random() * 4000 - 2000, Math.random() * 4000 - 2000, Math.random() * 4000 - 2000);

        tilesMeta.push({
            dom, canvas, ctx, texture, data: p, mesh, hover: false, loadedImage: null
        });

        scene.add(mesh);
        objects.push(mesh);

        // start image conversion & prefetch (async) — this will ultimately call rasterizeTileToCanvas
        convertTileImageToDataURL(i).then(dataUrl => {
            if (dataUrl) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    tilesMeta[i].loadedImage = img;
                    // If html2canvas will be used, we'll let rasterize handle using html2canvas; but having loadedImage helps fallback draw
                    rasterizeTileToCanvas(i, tilesMeta[i].hover || false);
                };
                img.onerror = () => {
                    // still attempt rasterization (html2canvas may still render correctly if it can)
                    rasterizeTileToCanvas(i, tilesMeta[i].hover || false);
                };
                img.src = dataUrl;
            } else {
                // no dataUrl — attempt rasterization anyway (fallback draw used if html2canvas fails)
                rasterizeTileToCanvas(i, tilesMeta[i].hover || false);
            }
        }).catch(() => {
            rasterizeTileToCanvas(i, tilesMeta[i].hover || false);
        });
    });

    needsRender = true;
}

// -------------------------------
// Convert image to base64 DataURL for given tile index.
// Strategy:
// 1) Try fetch(url) -> blob -> base64 (only works if server allows CORS).
// 2) If fails, fall back to a public proxy (CORS proxy) and fetch via proxy.
// 3) If still fails, return null (fallback drawing used).
// Note: using a proxy may have rate/availability limits; replace with your own proxy for production.
// -------------------------------
async function convertTileImageToDataURL(index) {
    const meta = tilesMeta[index];
    if (!meta) return null;
    const imgEl = meta.dom.querySelector('img[data-src]');
    if (!imgEl) return null;
    const url = imgEl.getAttribute('data-src') || '';
    if (!url) return null;

    // helper: blob -> dataURL
    const blobToDataURL = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });

    // try direct fetch first (fast & clean)
    try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        const dataUrl = await blobToDataURL(blob);
        // set img src in the DOM clone (so html2canvas will see it)
        imgEl.src = dataUrl;
        return dataUrl;
    } catch (err) {
        // direct fetch failed (likely CORS). Try public proxy as fallback.
    }

    // fallback: try public proxy (corsproxy.io)
    try {
        const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
        const res2 = await fetch(proxyUrl);
        if (!res2.ok) throw new Error('proxy fetch failed');
        const blob2 = await res2.blob();
        const dataUrl2 = await blobToDataURL(blob2);
        imgEl.src = dataUrl2;
        return dataUrl2;
    } catch (err) {
        // last fallback failed; we will return null and rely on manual draw fallback.
        console.warn('Image conversion failed for', url, err);
        return null;
    }
}

// -------------------------------
// Rasterization: DOM -> canvas using html2canvas if possible, otherwise manual draw
// -------------------------------
function rasterizeTileToCanvas(index, useHover = null) {
    const meta = tilesMeta[index];
    if (!meta) return Promise.resolve();

    const dom = meta.dom;
    const canvas = meta.canvas;
    const ctx = meta.ctx;
    const p = meta.data;
    const colorClass = netColor(p.net);

    // Apply hover class to DOM clone if specified; if null => leave current
    if (useHover === true) dom.classList.add('hover-effect');
    else if (useHover === false) dom.classList.remove('hover-effect');

    if (html2canvasAvailable) {
        const opts = {
            backgroundColor: null,
            scale: DPR,
            useCORS: false, // useCORS false because we've already tried to convert images to dataURL
            allowTaint: true
        };

        return html2canvas(dom, opts).then(rendered => {
            try {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(rendered, 0, 0, canvas.width, canvas.height);
                meta.texture.needsUpdate = true;
                needsRender = true;
            } catch (err) {
                // if drawImage fails (rare), fallback to manual draw
                if (meta.loadedImage) drawTileToCanvas(ctx, p, colorClass, meta.loadedImage, !!useHover);
                else drawTileToCanvas(ctx, p, colorClass, null, !!useHover);
                meta.texture.needsUpdate = true;
                needsRender = true;
            }
        }).catch(err => {
            // html2canvas failed -> fallback manual draw
            if (meta.loadedImage) drawTileToCanvas(ctx, p, colorClass, meta.loadedImage, !!useHover);
            else drawTileToCanvas(ctx, p, colorClass, null, !!useHover);
            meta.texture.needsUpdate = true;
            needsRender = true;
            return Promise.resolve();
        });
    } else {
        // html2canvas not present: fallback manual draw
        if (meta.loadedImage) drawTileToCanvas(ctx, p, colorClass, meta.loadedImage, !!useHover);
        else drawTileToCanvas(ctx, p, colorClass, null, !!useHover);
        meta.texture.needsUpdate = true;
        needsRender = true;
        return Promise.resolve();
    }
}

// -------------------------------
// drawTileToCanvas: manual fallback to draw visuals using 2D canvas
// Mirrors CSS and implements the hover effect (Option 1 — exact look).
// -------------------------------
function drawTileToCanvas(ctx, p, colorClass, imageEl = null, isHover = false) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const scale = w / CSS_TILE_W;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    // page background fallback
    ctx.fillStyle = 'rgba(17,17,17,1)';
    ctx.fillRect(0, 0, w, h);

    // base fills, borders
    let baseFill = 'rgba(255,255,255,0.03)';
    let borderColor = 'rgba(224,224,224,0.15)';
    if (colorClass === 'red') {
        baseFill = 'rgba(239,48,34,0.35)';
        borderColor = 'rgba(239,48,34,0.5)';
    } else if (colorClass === 'orange') {
        baseFill = 'rgba(253,202,53,0.35)';
        borderColor = 'rgba(253,202,53,0.5)';
    } else if (colorClass === 'green') {
        baseFill = 'rgba(58,159,72,0.35)';
        borderColor = 'rgba(58,159,72,0.5)';
    }

    if (isHover) {
        if (colorClass === 'red') borderColor = 'rgba(239,48,34,1)';
        else if (colorClass === 'orange') borderColor = 'rgba(253,202,53,1)';
        else if (colorClass === 'green') borderColor = 'rgba(58,159,72,1)';
    }

    const outerR = 10 * scale;
    const pad = 8 * scale;
    const cardX = pad;
    const cardY = pad;
    const cardW = w - pad * 2;
    const cardH = h - pad * 2;

    // Glow for hover (approximate CSS box-shadow: 0 0 30px rgba(..., 0.9))
    if (isHover) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowBlur = 30 * scale;
        ctx.shadowColor = (colorClass === 'red') ? 'rgba(239,48,34,0.9)' :
                          (colorClass === 'orange') ? 'rgba(253,202,53,0.9)' :
                          'rgba(58,159,72,0.9)';
        // invisible fill to produce shadow
        ctx.fillStyle = 'rgba(255,255,255,0)';
        roundRectFill(ctx, cardX, cardY, cardW, cardH, outerR);
        ctx.restore();
    } else {
        ctx.save();
        ctx.shadowBlur = 12 * scale;
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        roundRectFill(ctx, cardX, cardY, cardW, cardH, outerR);
        ctx.restore();
    }

    // Fill translucent card
    ctx.fillStyle = baseFill;
    roundRectFill(ctx, cardX, cardY, cardW, cardH, outerR);

    // Border
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = borderColor;
    roundRectStroke(ctx, cardX, cardY, cardW, cardH, outerR);

    // Top row
    ctx.fillStyle = '#f5f5f5';
    const topRowH = 28 * scale;
    roundRectFill(ctx, cardX + 4*scale, cardY + 6*scale, cardW - 8*scale, topRowH, 6*scale);

    ctx.fillStyle = '#333';
    ctx.font = `${14 * scale}px Arial`;
    ctx.textBaseline = 'middle';
    ctx.fillText((p.country || ''), cardX + 12*scale, cardY + 6*scale + topRowH / 2);
    const ageText = (p.age || '');
    const ageWidth = ctx.measureText(ageText).width;
    ctx.fillText(ageText, cardX + cardW - 12*scale - ageWidth, cardY + 6*scale + topRowH / 2);

    // Photo
    const photoW = 120 * scale;
    const photoH = 120 * scale;
    const photoX = cardX + (cardW - photoW) / 2;
    const photoY = cardY + 6*scale + topRowH + 12*scale;
    ctx.fillStyle = '#ddd';
    roundRectFill(ctx, photoX, photoY, photoW, photoH, 6*scale);

    if (imageEl) {
        try {
            // cover-crop
            const arImg = imageEl.width / imageEl.height;
            const arBox = photoW / photoH;
            let sx = 0, sy = 0, sw = imageEl.width, sh = imageEl.height;
            if (arImg > arBox) {
                sh = imageEl.height;
                sw = sh * arBox;
                sx = (imageEl.width - sw) / 2;
                sy = 0;
            } else {
                sw = imageEl.width;
                sh = sw / arBox;
                sx = 0;
                sy = (imageEl.height - sh) / 2;
            }
            ctx.save();
            roundRectClip(ctx, photoX, photoY, photoW, photoH, 6*scale);
            ctx.drawImage(imageEl, sx, sy, sw, sh, photoX, photoY, photoW, photoH);
            ctx.restore();
        } catch (err) {
            // ignore — keep placeholder
        }
    }

    // Name
    ctx.fillStyle = '#fff';
    ctx.font = `${15 * scale}px Arial`;
    ctx.textBaseline = 'top';
    const nameY = photoY + photoH + 8*scale;
    ctx.fillText(p.name || '', cardX + 12*scale, nameY);

    // Interest
    ctx.fillStyle = '#fff';
    ctx.font = `${16 * scale}px Arial`;
    const interestY = nameY + 22*scale;
    wrapText(ctx, p.interest || '', cardX + 12*scale, interestY, cardW - 24*scale, 20 * scale);

    ctx.restore();
}

function roundRectFill(ctx, x, y, w, h, r) {
    ctx.beginPath();
    const min = Math.min(w/2, h/2, r);
    ctx.moveTo(x + min, y);
    ctx.arcTo(x + w, y, x + w, y + h, min);
    ctx.arcTo(x + w, y + h, x, y + h, min);
    ctx.arcTo(x, y + h, x, y, min);
    ctx.arcTo(x, y, x + w, y, min);
    ctx.closePath();
    ctx.fill();
}

function roundRectStroke(ctx, x, y, w, h, r) {
    ctx.beginPath();
    const min = Math.min(w/2, h/2, r);
    ctx.moveTo(x + min, y);
    ctx.arcTo(x + w, y, x + w, y + h, min);
    ctx.arcTo(x + w, y + h, x, y + h, min);
    ctx.arcTo(x, y + h, x, y, min);
    ctx.arcTo(x, y, x + w, y, min);
    ctx.closePath();
    ctx.stroke();
}

function roundRectClip(ctx, x, y, w, h, r) {
    ctx.beginPath();
    const min = Math.min(w/2, h/2, r);
    ctx.moveTo(x + min, y);
    ctx.arcTo(x + w, y, x + w, y + h, min);
    ctx.arcTo(x + w, y + h, x, y + h, min);
    ctx.arcTo(x, y + h, x, y, min);
    ctx.arcTo(x, y, x + w, y, min);
    ctx.closePath();
    ctx.clip();
}

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

// -------------------------------
// Build targets (identical math)
// -------------------------------
function buildTargets(count) {
    targets = { table: [], sphere: [], helix: [], grid: [] };

    for (let i = 0; i < count; i++) {
        let obj = new THREE.Object3D();
        obj.position.set((i % 20) * 220 - 2200, -(Math.floor(i / 20) % 10) * 260 + 1200, 0);
        targets.table.push(obj);
    }

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

// -------------------------------
// Transform (tween positions + rotations)
// -------------------------------
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

// Buttons
document.getElementById('btn-table').onclick = () => transform(targets.table);
document.getElementById('btn-sphere').onclick = () => transform(targets.sphere);
document.getElementById('btn-helix').onclick = () => transform(targets.helix);
document.getElementById('btn-grid').onclick = () => transform(targets.grid);

// -------------------------------
// Pointer / Hover handling (strict ray hit)
// -------------------------------
function onPointerMove(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(objects);

    if (hits.length > 0) {
        const mesh = hits[0].object;
        if (lastHover !== mesh) {
            if (lastHover) setTileHover(lastHover, false);
            setTileHover(mesh, true);
            lastHover = mesh;
        }
    } else {
        if (lastHover) setTileHover(lastHover, false);
        lastHover = null;
    }
}

function setTileHover(mesh, isHover) {
    const meta = tilesMeta.find(m => m.mesh === mesh);
    if (!meta) return;
    if (meta.hover === isHover) return;
    meta.hover = isHover;

    // Update DOM clone class (for html2canvas fidelity)
    if (isHover) meta.dom.classList.add('hover-effect');
    else meta.dom.classList.remove('hover-effect');

    const idx = tilesMeta.indexOf(meta);
    rasterizeTileToCanvas(idx, isHover).then(() => {
        meta.texture.needsUpdate = true;
        needsRender = true;
    }).catch(() => {
        meta.texture.needsUpdate = true;
        needsRender = true;
    });
}

// -------------------------------
// Window resize
// -------------------------------
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    needsRender = true;
}

// -------------------------------
// Animation loop & throttle
// -------------------------------
let forceFullRender = true;

function animate(time) {
    requestAnimationFrame(animate);

    const delta = time - lastFrame;

    controls.update();

    if (TWEEN.getAll().length > 0) {
        TWEEN.update(time);
        needsRender = true;
    }

    if (delta > 16) {
        lastFrame = time;

        if (needsRender || forceFullRender) {
            renderer.render(scene, camera);
            needsRender = false;
            forceFullRender = false;
        }
    }
}

// -------------------------------
// Image proxy helper example (optional):
// For production, replace the public proxy with your own server-side proxy so you control reliability.
// -------------------------------

// End of file

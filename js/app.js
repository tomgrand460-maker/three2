// app.js
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
const CSS_TILE_W = 180; // css pixels (as in your .tile)
const CSS_TILE_H = 240;
const DPR = Math.min(window.devicePixelRatio || 1, 2); // limit for performance
const CANVAS_W = CSS_TILE_W * DPR;
const CANVAS_H = CSS_TILE_H * DPR;
const PLANE_W = 220; // keep plane dims to match layout spacing you previously used
const PLANE_H = 260; // (these were your previous TILE_W/TILE_H for plane geometry spacing)

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

    // Ambient light (optional, materials are basic)
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);

    // Raycaster for hover
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Mouse move listener for hover detection
    window.addEventListener('mousemove', onPointerMove);

    // Resize
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

// utility: clear previous objects and release textures
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

        dom.innerHTML = `
            <div class="top-row">
                <span class="country">${escapeHtml(p.country || '')}</span>
                <span class="age">${escapeHtml(p.age || '')}</span>
            </div>
            <div class="photo"><img src="${p.photo || ''}" /></div>
            <div class="name">${escapeHtml(p.name || '')}</div>
            <div class="interest">${escapeHtml(p.interest || '')}</div>
        `;

        // Ensure the image uses crossOrigin when possible (helps html2canvas & drawImage)
        const imgEl = dom.querySelector('img');
        if (imgEl) {
            imgEl.crossOrigin = 'anonymous';
        }

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

        // Plane geometry uses the plane sizes you had earlier (to preserve layout math)
        const geometry = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geometry, material);

        // initial scatter like your old code
        mesh.position.set(Math.random() * 4000 - 2000, Math.random() * 4000 - 2000, Math.random() * 4000 - 2000);

        // keep references
        tilesMeta.push({
            dom, canvas, ctx, texture, data: p, mesh, hover: false, lastRenderedHash: null
        });

        scene.add(mesh);
        objects.push(mesh);

        // attempt to pre-render via html2canvas if available, else draw image onto canvas directly
        rasterizeTileToCanvas(i);
    });

    needsRender = true;
}

// -------------------------------
// Rasterization: DOM -> canvas using html2canvas if possible, otherwise draw via drawTileToCanvas
// -------------------------------

function rasterizeTileToCanvas(index, useHover = null) {
    // index: tilesMeta index
    const meta = tilesMeta[index];
    if (!meta) return;

    const dom = meta.dom;
    const canvas = meta.canvas;
    const ctx = meta.ctx;
    const p = meta.data;
    const colorClass = netColor(p.net);

    // if html2canvas available, use it (best fidelity)
    if (html2canvasAvailable) {
        // html2canvas options: backgroundColor null to keep transparent backing
        // scale: DPR so result matches high DPI canvas size
        const opts = {
            backgroundColor: null,
            scale: DPR,
            useCORS: true,
            // onclone: (clonedDoc) => { } // if needed
        };

        // Apply hover class if requested (null => keep current)
        if (useHover === true) dom.classList.add('hover-effect');
        else if (useHover === false) dom.classList.remove('hover-effect');

        // html2canvas returns a canvas we can draw to the texture's canvas
        return html2canvas(dom, opts).then((rendered) => {
            try {
                // draw the rendered content into our target canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(rendered, 0, 0, canvas.width, canvas.height);
                meta.texture.needsUpdate = true;
                needsRender = true;
            } catch (err) {
                // If drawing fails (CORS taint), fallback to our manual draw
                console.warn('html2canvas drawImage failed, falling back to manual draw', err);
                if (useHover === true) drawTileToCanvas(ctx, p, colorClass, meta.loadedImage || null, true);
                else if (useHover === false) drawTileToCanvas(ctx, p, colorClass, meta.loadedImage || null, false);
                meta.texture.needsUpdate = true;
                needsRender = true;
            }
        }).catch((err) => {
            // html2canvas failed (often due to cross-origin images). Fallback.
            // Remove hover class if we applied it
            if (useHover === true) dom.classList.remove('hover-effect');
            // fallback manual draw using image if available
            if (meta.loadedImage) {
                drawTileToCanvas(ctx, p, colorClass, meta.loadedImage, !!useHover);
            } else {
                drawTileToCanvas(ctx, p, colorClass, null, !!useHover);
            }
            meta.texture.needsUpdate = true;
            needsRender = true;
            return Promise.resolve();
        });
    } else {
        // html2canvas not present — fallback manual draw using loaded image
        if (useHover === true) dom.classList.add('hover-effect');
        else if (useHover === false) dom.classList.remove('hover-effect');

        if (meta.loadedImage) {
            drawTileToCanvas(ctx, p, colorClass, meta.loadedImage, !!useHover);
        } else {
            drawTileToCanvas(ctx, p, colorClass, null, !!useHover);
        }
        meta.texture.needsUpdate = true;
        needsRender = true;
        return Promise.resolve();
    }
}

// When an image is loaded for a tile, store it and re-rasterize (used by image loader)
function onTileImageLoaded(index, img) {
    const meta = tilesMeta[index];
    if (!meta) return;
    meta.loadedImage = img;
    // Re-render using html2canvas if available (it may capture DOM-level effects); otherwise draw manually
    rasterizeTileToCanvas(index, meta.hover || false);
}

// -------------------------------
// drawTileToCanvas: manual fallback to draw visuals using 2D canvas
// This mirrors the CSS structure and the hover glow option EXACT CSS look (Option 1).
// -------------------------------
function drawTileToCanvas(ctx, p, colorClass, imageEl = null, isHover = false) {
    // We'll draw at ctx.canvas.width/height (already DPR scaled)
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // scale factor between CSS size and canvas pixels
    const scale = w / CSS_TILE_W;

    ctx.clearRect(0, 0, w, h);

    // Background (semi-transparent to match CSS background)
    // The CSS has backdrop-filter blur and a translucent background per color; approximate with a soft fill.
    ctx.save();
    ctx.fillStyle = 'rgba(17,17,17,1)'; // page bg fallback (your body bg #111)
    ctx.fillRect(0, 0, w, h);

    // rounded rect box background using colorClass translucent fill
    let baseFill = 'rgba(255,255,255,0.03)';
    let borderColor = 'rgba(224,224,224,0.15)';
    let shadowColor = 'rgba(0,0,0,0.2)';
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

    // If hover: stronger border + bigger glow — exactly matching your CSS hover specs (Option 1)
    if (isHover) {
        if (colorClass === 'red') {
            borderColor = 'rgba(239,48,34,1)';
        } else if (colorClass === 'orange') {
            borderColor = 'rgba(253,202,53,1)';
        } else if (colorClass === 'green') {
            borderColor = 'rgba(58,159,72,1)';
        }
    }

    // Draw card background rounded rect
    const outerR = 10 * scale;
    const pad = 8 * scale;
    const cardX = pad;
    const cardY = pad;
    const cardW = w - pad * 2;
    const cardH = h - pad * 2;

    // Draw soft glow by using radial gradient outside edges (simulates CSS box-shadow)
    if (isHover) {
        // Glow parameters (Option 1 exact CSS look: ~30px blur at CSS pixels -> scaled)
        const glowPx = 30 * scale;
        // create an offscreen canvas for glow? We'll draw multiple translucent rounded rect strokes to fake blur
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowBlur = glowPx;
        ctx.shadowColor = (colorClass === 'red') ? 'rgba(239,48,34,0.9)' :
                          (colorClass === 'orange') ? 'rgba(253,202,53,0.9)' :
                          'rgba(58,159,72,0.9)';
        // draw invisible rect to generate shadow
        ctx.fillStyle = 'rgba(255,255,255,0.0)';
        roundRectFill(ctx, cardX, cardY, cardW, cardH, outerR);
        ctx.restore();
    } else {
        // subtle default shadow
        ctx.save();
        ctx.shadowBlur = 12 * scale;
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.fillStyle = baseFill;
        roundRectFill(ctx, cardX, cardY, cardW, cardH, outerR);
        ctx.restore();
    }

    // Fill card with translucent background
    ctx.fillStyle = baseFill;
    roundRectFill(ctx, cardX, cardY, cardW, cardH, outerR);

    // Draw border
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = borderColor;
    roundRectStroke(ctx, cardX, cardY, cardW, cardH, outerR);

    // Top-row background (approx)
    ctx.fillStyle = '#f5f5f5';
    const topRowH = 28 * scale;
    roundRectFill(ctx, cardX + 4*scale, cardY + 6*scale, cardW - 8*scale, topRowH, 6*scale);

    // Country & age (top row)
    ctx.fillStyle = '#333';
    ctx.font = `${14 * scale}px Arial`;
    ctx.textBaseline = 'middle';
    ctx.fillText((p.country || ''), cardX + 12*scale, cardY + 6*scale + topRowH / 2);
    // age right aligned
    const ageText = (p.age || '');
    const ageWidth = ctx.measureText(ageText).width;
    ctx.fillText(ageText, cardX + cardW - 12*scale - ageWidth, cardY + 6*scale + topRowH / 2);

    // Photo box
    const photoX = cardX + (cardW - 120*scale) / 2;
    const photoY = cardY + 6*scale + topRowH + 12*scale;
    const photoW = 120 * scale;
    const photoH = 120 * scale;

    // Photo placeholder
    ctx.fillStyle = '#ddd';
    roundRectFill(ctx, photoX, photoY, photoW, photoH, 6*scale);

    // Draw image if present
    if (imageEl) {
        try {
            // Fit-cover behavior
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
            // drawing may fail due to CORS — keep placeholder
        }
    }

    // Name
    ctx.fillStyle = '#fff';
    ctx.font = `${15 * scale}px Arial`;
    ctx.textBaseline = 'top';
    const nameY = photoY + photoH + 8*scale;
    ctx.fillText(p.name || '', cardX + 12*scale, nameY);

    // Interest (wrap)
    ctx.fillStyle = '#fff';
    ctx.font = `${16 * scale}px Arial`;
    const interestY = nameY + 22*scale;
    wrapText(ctx, p.interest || '', cardX + 12*scale, interestY, cardW - 24*scale, 20 * scale);

    ctx.restore();
}

// rounded rect fill helper
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

// rounded rect stroke helper
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

// rounded rect clip helper
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

// Helper wrap text
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
// Build targets (kept identical)
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
// Transform (tween positions + rotations) — unchanged logic, just uses mesh objects
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

// -------------------------------
// UI Buttons
// -------------------------------
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
            // clear previous
            if (lastHover) {
                setTileHover(lastHover, false);
            }
            // set new
            setTileHover(mesh, true);
            lastHover = mesh;
        }
    } else {
        if (lastHover) {
            setTileHover(lastHover, false);
            lastHover = null;
        }
    }
}

// set hover and re-rasterize single tile
function setTileHover(mesh, isHover) {
    // find tile meta
    const meta = tilesMeta.find(m => m.mesh === mesh);
    if (!meta) return;
    if (meta.hover === isHover) return;
    meta.hover = isHover;

    // Update the associated DOM clone's hover state (class) — useful if html2canvas is used
    if (isHover) meta.dom.classList.add('hover-effect');
    else meta.dom.classList.remove('hover-effect');

    // Re-rasterize this tile only
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
// Image loading: try to prefetch each tile's image into an Image object to use in fallback drawing
// -------------------------------
function prefetchTileImages() {
    tilesMeta.forEach((meta, i) => {
        const url = meta.data.photo;
        if (!url) return;
        const img = new Image();
        img.crossOrigin = 'anonymous'; // request CORS — if server allows, great; otherwise onerror
        img.onload = () => onTileImageLoaded(i, img);
        img.onerror = () => {
            // image failed (likely CORS) — we still keep placeholder visuals
            console.warn('Image load failed (CORS or not found):', url);
        };
        img.src = url;
    });
}

// -------------------------------
// Window resize handler
// -------------------------------
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    needsRender = true;
}

// -------------------------------
// Animation loop & throttle (keeps your throttle logic)
// -------------------------------
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

    // Throttle render calls (original logic)
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
// Utilities
// -------------------------------

// simple HTML escape (protects text drawn on canvas)
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
    });
}

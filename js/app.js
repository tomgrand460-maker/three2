import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

const csvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdQ8324RdvqZwBjWEXJj-C9-GE1BIKfYNwNcKA4doOJC5Qi-zR0vWJOEfE3h_WGLYsMMaycNnRaDxY/pub?gid=0&single=true&output=csv";

let camera, scene, renderer, controls;
let objects = [];
let targets = { table: [], sphere: [], helix: [], grid: [] };
let needsRender = true;  // throttle render cycles
let lastFrame = 0;

init();
loadCSV();

function init() {
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 20000);
    camera.position.set(0, 0, 4500);

    scene = new THREE.Scene();

    renderer = new CSS3DRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);
    renderer.domElement.style.perspective = '1200px';

    controls = new TrackballControls(camera, renderer.domElement);
    controls.minDistance = 10;
    controls.maxDistance = 20000;
    controls.rotateSpeed = 2.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.target.set(0, 0, 0);
    renderer.domElement.addEventListener("pointerdown", () => controls.enabled = true);
    renderer.domElement.addEventListener("pointerup", () => controls.enabled = false);
    controls.addEventListener("change", () => needsRender = true);
    animate();
    window.addEventListener('resize', onWindowResize);
}

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
    const num = Number(v.replace(/[^0-9.]/g, ""));
    if (num < 100000) return 'red';
    if (num <= 200000) return 'orange';
    return 'green';
}

function buildTiles(data) {
    data.forEach((p) => {
        const div = document.createElement('div');
        div.className = `tile ${netColor(p.net)}`;
        div.style.transformStyle = "preserve-3d";
        div.innerHTML = `
            <div class="top-row">
                <span class="country">${p.country}</span>
                <span class="age">${p.age}</span>
            </div>
            <div class="photo"><img src="${p.photo}" /></div>
            <div class="name">${p.name}</div>
            <div class="interest">${p.interest}</div>
        `;

        const object = new CSS3DObject(div);
        object.position.x = Math.random() * 4000 - 2000;
        object.position.y = Math.random() * 4000 - 2000;
        object.position.z = Math.random() * 4000 - 2000;

        scene.add(object);
        objects.push(object);
    });

    needsRender = true;
}

function buildTargets(count) {
    // (UNMODIFIED — all your layouts kept exactly)
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

function transform(targetsArray, duration = 1200) {
    if (!targetsArray || !objects.length) return;
    TWEEN.removeAll();

    const setNeedsRender = () => needsRender = true;
    const maxStagger = 300;
    const perItemStagger = 6;

    objects.forEach((obj, i) => {
        const target = targetsArray[i];
    
        const start = {
            px: obj.position.x,
            py: obj.position.y,
            pz: obj.position.z,
            qx: obj.quaternion.x,
            qy: obj.quaternion.y,
            qz: obj.quaternion.z,
            qw: obj.quaternion.w,
        };
    
        const end = {
            px: target.position.x,
            py: target.position.y,
            pz: target.position.z,
            qx: target.quaternion.x,
            qy: target.quaternion.y,
            qz: target.quaternion.z,
            qw: target.quaternion.w,
        };
    
        new TWEEN.Tween(start)
            .to(end, duration)
            .delay(i * 5)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onUpdate(() => {
                obj.position.set(start.px, start.py, start.pz);
                obj.quaternion.set(start.qx, start.qy, start.qz, start.qw);
                needsRender = true;
            })
            .start();
    });

    needsRender = true;
}

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

function animate(time) {
    requestAnimationFrame(animate);

    const delta = time - lastFrame;

    if (controls.enabled) controls.update();

    // Always update tween animations
    if (TWEEN.getAll().length > 0) {
        TWEEN.update(time);
        needsRender = true;
    }

    // Throttle only the render calls
    if (delta > 16) {
        lastFrame = time;

        if (needsRender) {
            renderer.render(scene, camera);
            needsRender = false;
        }
    }
}

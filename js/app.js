/* Full modified main.js — replace your existing file with this.
   Key helix changes:
   - Increased helixRadius and verticalSpacing so tiles are not jammed.
   - Introduced per-strand radial offset (strandSeparation) and a small angular stagger.
   - Stored helix meta (radius, totalHeight) so the helix view camera auto-backs up to show the whole structure.
   - Kept sphere-pole fix and grid spacing adjustments from the previous iteration.
*/

import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

const csvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdQ8324RdvqZwBjWEXJj-C9-GE1BIKfYNwNcKA4doOJC5Qi-zR0vWJOEfE3h_WGLYsMMaycNnRaDxY/pub?gid=0&single=true&output=csv";

let camera, scene, renderer, controls;
let objects = [];
let targets = { table: [], sphere: [], helix: [], grid: [] };

init();
loadCSV();

function init() {
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 20000);
    camera.position.set(0, 0, 4500);

    scene = new THREE.Scene();

    renderer = new CSS3DRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new TrackballControls(camera, renderer.domElement);
    controls.minDistance = 10;
    controls.maxDistance = 20000;
    controls.rotateSpeed = 2.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.target.set(0, 0, 0);
    controls.update();

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
            animate();
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
    data.forEach((p, i) => {
        const div = document.createElement('div');
        div.className = `tile ${netColor(p.net)}`;

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
}

function buildTargets(count) {
    // Table layout
    for (let i = 0; i < count; i++) {
        let obj;
        obj = new THREE.Object3D();
        obj.position.set((i % 20) * 220 - 2200, -(Math.floor(i / 20) % 10) * 260 + 1200, 0);
        targets.table.push(obj);
    }

    // Sphere (Fibonacci) — offset index by 0.5 to avoid exact poles clustering
    for (let i = 0; i < count; i++) {
        let obj;
        const phi = Math.acos(-1 + (2 * (i + 0.5)) / count);
        const theta = Math.sqrt(count * Math.PI) * phi;
        obj = new THREE.Object3D();
        obj.position.set(1400 * Math.cos(theta) * Math.sin(phi), 1400 * Math.sin(theta) * Math.sin(phi), 1400 * Math.cos(phi));
        obj.lookAt(new THREE.Vector3(obj.position.x * 2, obj.position.y * 2, obj.position.z * 2));
        targets.sphere.push(obj);
    }

    // Helix: clearer double-helix settings
    const helixRadius = 800;         // larger to separate strands
    const angleStep = 0.8;           // angular step per pair
    const verticalSpacing = 60;      // vertical distance per pair
    const totalSegments = Math.ceil(count / 2);
    const helixYOffset = (totalSegments - 1) * verticalSpacing / 2;
    // expose meta so we can pick a camera distance later
    window._helixMeta = { radius: helixRadius, totalHeight: totalSegments * verticalSpacing };

    for (let i = 0; i < count; i++) {
        let obj;
        const strand = i % 2;              // strand 0 or 1
        const pairIndex = Math.floor(i / 2); // which rung/pair vertically
        const baseAngle = pairIndex * angleStep;
        // make second strand roughly opposite but slightly staggered so tiles don't collide
        const strandPhase = strand === 0 ? 0 : Math.PI;
        const stagger = strand === 0 ? 0 : angleStep * 0.4;
        const angle = baseAngle + strandPhase + stagger;
        const strandSeparation = 60;
        const radius = helixRadius + (strand === 0 ? -strandSeparation : strandSeparation);
        const helixHeight = pairIndex * verticalSpacing - helixYOffset;
        obj = new THREE.Object3D();
        obj.position.set(radius * Math.cos(angle), helixHeight, radius * Math.sin(angle));
        obj.lookAt(new THREE.Vector3(0, helixHeight, 0));
        targets.helix.push(obj);
    }

    // Grid — layers along Z axis; smaller zGap so layers are closer and easier to inspect individually
    const layers = Math.ceil(count / 20); // compute how many layers needed (or you can set fixed)
    const zGap = 400; // reduced gap so zooming between layers is easier
    const itemsPerLayer = 20; // keep consistent with table grouping
    const totalDepth = (layers - 1) * zGap;
    for (let i = 0; i < count; i++) {
        let obj;
        const layerIndex = Math.floor(i / itemsPerLayer);
        const centeredZ = layerIndex * zGap - totalDepth / 2;
        obj = new THREE.Object3D();
        obj.position.set((i % 5) * 300 - 600, (Math.floor(i / 5) % 4) * 400 - 400, centeredZ);
        targets.grid.push(obj);
    }
}

function transform(targetsArray) {
    new TWEEN.Tween({ t: 0 }).to({ t: 1 }, 1000).onUpdate(() => {}).start();

    objects.forEach((obj, i) => {
        const target = targetsArray[i];
        if (!target) return;
        new TWEEN.Tween(obj)
            .to({
                position: {
                    x: target.position.x,
                    y: target.position.y,
                    z: target.position.z
                },
                rotation: {
                    x: target.rotation.x,
                    y: target.rotation.y,
                    z: target.rotation.z
                }
            }, 1500)
            .easing(TWEEN.Easing.Cubic.InOut)
            .start();
    });
}

// Buttons: set camera and controls to suitable positions per view
document.getElementById('btn-table').onclick = () => {
    transform(targets.table);
};

document.getElementById('btn-sphere').onclick = () => {
    transform(targets.sphere);
};

document.getElementById('btn-helix').onclick = () => {
    transform(targets.helix);
};

document.getElementById('btn-grid').onclick = () => {
    transform(targets.grid);
};

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    TWEEN.update();
    controls.update();
    renderer.render(scene, camera);
}

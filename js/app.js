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
    // Wider frustum and allow very close near plane for deep zoom
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 20000);
    // Start further back so all scenes are initially visible
    camera.position.set(0, 0, 6000);

    scene = new THREE.Scene();

    renderer = new CSS3DRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new TrackballControls(camera, renderer.domElement);
    // reasonable defaults; specific views override these when switching
    controls.minDistance = 10;
    controls.maxDistance = 20000;
    controls.rotateSpeed = 2.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    // center target
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

    // Helix — reworked to create two clear strands separated in radius and aligned per 'step'
    // We'll compute using paired indices so consecutive items that belong to opposite strands align vertically
    const helixRadius = 400;         // smaller radius to make strands visibly distinct
    const angleStep = 0.6;           // angle step per segment (controls tightness)
    const verticalSpacing = 18;      // spacing between successive turns
    const totalSegments = Math.ceil(count / 2);
    const helixYOffset = (totalSegments - 1) * verticalSpacing / 2;

    for (let i = 0; i < count; i++) {
        let obj;
        const strand = i % 2;             // 0 or 1 strand
        const segIndex = Math.floor(i / 2); // pair indices to the same vertical level
        const angle = segIndex * angleStep;
        const angleShift = strand === 0 ? 0 : Math.PI; // alternate phase for second strand
        const helixHeight = segIndex * verticalSpacing - helixYOffset;
        obj = new THREE.Object3D();
        obj.position.set(helixRadius * Math.cos(angle + angleShift), helixHeight, helixRadius * Math.sin(angle + angleShift));
        // face outward horizontally
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
    // Table is wide and fairly shallow (z=0), back the camera out and allow zooming in close
    camera.position.set(0, 0, 9000);
    controls.target.set(0, 0, 0);
    controls.minDistance = 10;
    controls.maxDistance = 30000;
    controls.update();
    transform(targets.table);
};

document.getElementById('btn-sphere').onclick = () => {
    // Sphere radius ~1400: back camera enough to cover full sphere
    camera.position.set(0, 0, 4500);
    controls.target.set(0, 0, 0);
    controls.minDistance = 10;
    controls.maxDistance = 20000;
    controls.update();
    transform(targets.sphere);
};

document.getElementById('btn-helix').onclick = () => {
    // Helix height depends on number of segments; back camera so it's visible top-to-bottom
    camera.position.set(0, 0, 4500);
    controls.target.set(0, 0, 0);
    // allow close zoom so you can inspect the intertwined strands
    controls.minDistance = 5;
    controls.maxDistance = 20000;
    controls.update();
    transform(targets.helix);
};

document.getElementById('btn-grid').onclick = () => {
    // Grid stacks along Z; back out so you see all layers, but allow close zoom
    camera.position.set(0, 0, 7000);
    controls.target.set(0, 0, 0);
    controls.minDistance = 5;
    controls.maxDistance = 30000;
    controls.update();
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

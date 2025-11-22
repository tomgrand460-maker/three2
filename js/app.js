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

    controls = new TrackballControls(camera, renderer.domElement);
    controls.minDistance = 600;
    controls.maxDistance = 20000;
    controls.rotateSpeed = 2.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.target.set(0, 0, 0);
    controls.enabled = true;
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
        div.style.willChange = "transform";
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
        const outward = obj.position.clone().multiplyScalar(2);
        outward.y = helixHeight;
        obj.lookAt(outward);
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
    document.body.classList.add("transitioning"); 
    document.querySelectorAll('.tile').forEach(t => t.classList.remove('blur'));
    TWEEN.removeAll();

    for (let i = 0; i < objects.length; i++) {
        const object = objects[i];
        const target = targetsArray[i];

        // --- POSITION TWEEN ---
        new TWEEN.Tween(object.position)
            .to({
                x: target.position.x,
                y: target.position.y,
                z: target.position.z
            }, duration)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onUpdate(() => { needsRender = true; })
            .start();

        const qStart = object.quaternion.clone();
        const qEnd   = target.quaternion.clone();
        
        new TWEEN.Tween({ t: 0 })
            .to({ t: 1 }, duration)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onUpdate(({ t }) => {
                object.quaternion.copy(qStart).slerp(qEnd, t);
                needsRender = true;
            })
            .start();
    }

    setTimeout(() => {
        document.body.classList.remove("transitioning");
        document.querySelectorAll('.tile').forEach(t => t.classList.add('blur'));
    }, duration + 50);
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
    if (controls.enabled) {
        controls.update();
        const dist = camera.position.length();
        const min = 600;
        if (dist < min) {
            camera.position.setLength(min);
        }
    }
    if (TWEEN.getAll().length > 0) {
        TWEEN.update(time);
        needsRender = true;
    }
    renderer.render(scene, camera);
}

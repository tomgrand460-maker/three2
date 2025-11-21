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
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 5000);
    camera.position.z = 2000;

    scene = new THREE.Scene();

    renderer = new CSS3DRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new TrackballControls(camera, renderer.domElement);
    controls.minDistance = 500;
    controls.maxDistance = 6000;

    window.addEventListener('resize', onWindowResize);
}

async function loadCSV() {
    const res = await fetch(csvUrl);
    const txt = await res.text();

    Papa.parse(txt, {
        header: false,
        skipEmptyLines: true,
        complete: function (results) {
            const rows = results.data;

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
    for (let i = 0; i < count; i++) {
        let obj;

        obj = new THREE.Object3D();
        obj.position.set((i % 20) * 220 - 2200, -(Math.floor(i / 20) % 10) * 260 + 1200, 0);
        targets.table.push(obj);

        const phi = Math.acos(-1 + (2 * i) / count);
        const theta = Math.sqrt(count * Math.PI) * phi;
        obj = new THREE.Object3D();
        obj.position.set(1400 * Math.cos(theta) * Math.sin(phi), 1400 * Math.sin(theta) * Math.sin(phi), 1400 * Math.cos(phi));
        obj.lookAt(new THREE.Vector3(obj.position.x * 2, obj.position.y * 2, obj.position.z * 2));
        targets.sphere.push(obj);
        
        const helixRadius = 700;
        const angle = i * 0.25;
        const helixHeight = 30 * i - 2000;
        obj = new THREE.Object3D();
        const angleShift = (i % 2 === 0) ? 0 : Math.PI;
        obj.position.set(helixRadius * Math.cos(angle + angleShift), helixHeight, helixRadius * Math.sin(angle + angleShift));
        obj.lookAt(new THREE.Vector3(0, helixHeight, 0));
        targets.helix.push(obj);

        obj = new THREE.Object3D();
        obj.position.set((i % 5) * 300 - 600, (Math.floor(i / 5) % 4) * 320 - 400, (Math.floor(i / 20) % 10) * 400 - 2000);
        targets.grid.push(obj);
    }
}

function transform(targets) {
    new TWEEN.Tween({ t: 0 }).to({ t: 1 }, 1000).onUpdate(() => {}).start();

    objects.forEach((obj, i) => {
        new TWEEN.Tween(obj)
            .to({
                position: {
                    x: targets[i].position.x,
                    y: targets[i].position.y,
                    z: targets[i].position.z
                },
                rotation: {
                    x: targets[i].rotation.x,
                    y: targets[i].rotation.y,
                    z: targets[i].rotation.z
                }
            }, 1500)
            .easing(TWEEN.Easing.Cubic.InOut)
            .start();
    });
}

// BUTTONS

document.getElementById('btn-table').onclick = () => transform(targets.table);
document.getElementById('btn-sphere').onclick = () => transform(targets.sphere);
document.getElementById('btn-helix').onclick = () => transform(targets.helix);
document.getElementById('btn-grid').onclick = () => transform(targets.grid);

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

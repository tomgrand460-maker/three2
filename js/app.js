import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import TWEEN from 'three/addons/libs/tween.module.js';

let camera, scene, renderer, controls;
const objects = [];
const targets = { table: [], sphere: [], helix: [], grid: [] };

init();
animate();

function init() {

    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.z = 2000;

    scene = new THREE.Scene();

    const symbols = ["A","B","C","D","E","F","G","H","I","J"];

    // ELEMENTS
    for (let i = 0; i < symbols.length; i++) {

        const div = document.createElement("div");
        div.className = "item";

        const s = document.createElement("div");
        s.className = "symbol";
        s.textContent = symbols[i];
        div.appendChild(s);

        const obj = new CSS3DObject(div);
        obj.position.set(
            Math.random()*4000-2000,
            Math.random()*4000-2000,
            Math.random()*4000-2000
        );

        scene.add(obj);
        objects.push(obj);

        // TABLE
        const tablePos = new THREE.Object3D();
        tablePos.position.x = (i % 5) * 250 - 500;
        tablePos.position.y = Math.floor(i / 5) * -300 + 200;
        tablePos.lookAt(0, 0, 0);        // FIX: gives rotation
        targets.table.push(tablePos);
    }

    // SPHERE
    const vec = new THREE.Vector3();
    const l = objects.length;

    for (let i = 0; i < l; i++) {
        const phi = Math.acos(-1 + (2 * i) / l);
        const theta = Math.sqrt(l * Math.PI) * phi;

        const obj = new THREE.Object3D();
        obj.position.setFromSphericalCoords(600, phi, theta);
        vec.copy(obj.position).multiplyScalar(2);
        obj.lookAt(vec);                // FIX: ensures outward rotation

        targets.sphere.push(obj);
    }

    // HELIX
    for (let i = 0; i < l; i++) {
        const theta = i * 0.35;
        const y = -(i * 50) + 300;

        const obj = new THREE.Object3D();
        obj.position.setFromCylindricalCoords(600, theta, y);

        vec.set(obj.position.x * 2, y, obj.position.z * 2);
        obj.lookAt(vec);                 // FIX: ensures helix rotates correctly

        targets.helix.push(obj);
    }

    // GRID
    for (let i = 0; i < l; i++) {
        const obj = new THREE.Object3D();
        obj.position.set(
            (i % 5) * 250 - 500,
            (Math.floor(i / 5) % 2) * -300 + 150,
            Math.floor(i / 10) * 800 - 400
        );
        obj.lookAt(0, 0, 0);            // FIX: gives grid proper rotation
        targets.grid.push(obj);
    }

    renderer = new CSS3DRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById("container").appendChild(renderer.domElement);

    controls = new TrackballControls(camera, renderer.domElement);
    controls.addEventListener("change", render);

    document.getElementById("btn-table").onclick = () => transform(targets.table);
    document.getElementById("btn-sphere").onclick = () => transform(targets.sphere);
    document.getElementById("btn-helix").onclick = () => transform(targets.helix);
    document.getElementById("btn-grid").onclick = () => transform(targets.grid);

    transform(targets.table);

    window.addEventListener("resize", onWindowResize);
}

function transform(target) {
    TWEEN.removeAll();

    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        const t = target[i];

        // POSITION TWEEN
        new TWEEN.Tween(obj.position)
            .to(
                {
                    x: t.position.x,
                    y: t.position.y,
                    z: t.position.z
                },
                2000
            )
            .easing(TWEEN.Easing.Exponential.InOut)
            .start();

        // ROTATION TWEEN — fully fixed
        new TWEEN.Tween(obj.rotation)
            .to(
                {
                    x: t.rotation.x,
                    y: t.rotation.y,
                    z: t.rotation.z
                },
                2000
            )
            .easing(TWEEN.Easing.Exponential.InOut)
            .start();
    }

    new TWEEN.Tween({})
        .to({}, 2000)
        .onUpdate(render)
        .start();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    render();
}

function animate() {
    requestAnimationFrame(animate);
    TWEEN.update();
    controls.update();
}

function render() {
    renderer.render(scene, camera);
}

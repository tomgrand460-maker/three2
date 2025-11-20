import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import TWEEN from "three/addons/libs/tween.module.js";

/*
  CSV source (published Google Sheet)
  - you provided this URL:
*/
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdQ8324RdvqZwBjWEXJj-C9-GE1BIKfYNwNcKA4doOJC5Qi-zR0vWJOEfE3h_WGLYsMMaycNnRaDxY/pub?gid=0&single=true&output=csv";

/* color rules
   Red #ef3022; Orange #fdca35; Green #3a9f48
   Ranges:
     - < 100K => Red
     - >= 100K and <= 200K => Orange
     - > 200K => Green
*/
const COLORS = {
    red: "#ef3022",
    orange: "#fdca35",
    green: "#3a9f48"
};

let camera, scene, renderer, controls;
const objects = [];
const targets = { table: [], sphere: [], helix: [], grid: [] };

init(); // sets up camera/renderer/etc
// fetch and build tiles
fetchCSVAndBuild(CSV_URL).catch(err => console.error("CSV load error:", err));

animate();

/* ----------------- CSV parsing + building ----------------- */

async function fetchCSVAndBuild(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
    const text = await res.text();

    const rows = parseCSV(text);
    // Expect headerless rows with: Name,Photo,Age,Country,Interest,Net Worth
    // Build tiles from rows (skip empty lines)
    const people = rows
        .map(r => r.map(cell => cell.trim()))
        .filter(r => r.length >= 6 && r[0] !== "");

    buildTiles(people);
    layoutTargets(); // create targets after we know number of objects
    transform(targets.table); // initial layout
}

/* Robust CSV parser that handles quoted fields with commas */
function parseCSV(text) {
    const rows = [];
    let current = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (ch === '"' ) {
            if (inQuotes && next === '"') {
                // escaped quote
                field += '"';
                i++; // skip next
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            current.push(field);
            field = "";
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            // handle CRLF or LF
            // if CRLF, skip the next \n
            if (ch === '\r' && next === '\n') { i++; }
            current.push(field);
            rows.push(current);
            current = [];
            field = "";
        } else {
            field += ch;
        }
    }
    // push last field if any
    if (field !== "" || current.length > 0) {
        current.push(field);
        rows.push(current);
    }
    return rows;
}

/* create the CSS3D tiles */
function buildTiles(people) {
    // clear previous objects if any
    while (objects.length) {
        const o = objects.pop();
        scene.remove(o);
    }
    // create new objects
    for (let i = 0; i < people.length; i++) {
        const [name, photoUrl, age, country, interest, netWorthRaw] = people[i];

        const netWorth = parseNetWorth(netWorthRaw);

        const color = pickColor(netWorth);

        // create DOM element
        const el = document.createElement("div");
        el.className = "person";

        // color bar
        const cbar = document.createElement("div");
        cbar.className = "colorbar";
        cbar.style.background = color;
        el.appendChild(cbar);

        // country small top-left
        const countryEl = document.createElement("div");
        countryEl.className = "country";
        countryEl.textContent = country;
        el.appendChild(countryEl);

        // age small top-right
        const ageEl = document.createElement("div");
        ageEl.className = "age";
        ageEl.textContent = age;
        el.appendChild(ageEl);

        // photo (img)
        const img = document.createElement("img");
        img.className = "photo";
        img.alt = name;
        img.src = photoUrl;
        // For graceful fallback if image fails
        img.onerror = function () {
            img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
                `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='#222'/><text x='50%' y='50%' fill='#999' font-size='12' font-family='Arial' dominant-baseline='middle' text-anchor='middle'>No image</text></svg>`
            );
        };
        el.appendChild(img);

        // name below photo
        const nameEl = document.createElement("div");
        nameEl.className = "name";
        nameEl.textContent = name;
        el.appendChild(nameEl);

        // interest bottom
        const interestEl = document.createElement("div");
        interestEl.className = "interest";
        interestEl.textContent = interest;
        el.appendChild(interestEl);

        // border color highlight
        el.style.borderColor = hexToRgba(color, 0.85);
        el.style.background = "rgba(10,10,10,0.45)"; // keep slightly translucent

        // create CSS3DObject and add to scene
        const objCSS = new CSS3DObject(el);

        // place randomly to start
        objCSS.position.x = Math.random() * 4000 - 2000;
        objCSS.position.y = Math.random() * 4000 - 2000;
        objCSS.position.z = Math.random() * 4000 - 2000;

        scene.add(objCSS);
        objects.push(objCSS);
    }
}

/* parse net worth string "$251,260.80" -> number 251260.8 */
function parseNetWorth(raw) {
    if (!raw) return 0;
    // remove $ and commas and any whitespace
    const cleaned = raw.replace(/[\$,]/g, "").trim();
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

/* pick color based on ranges (user confirmed)
   - <100000 => red
   - 100000 <= and <= 200000 => orange
   - >200000 => green
*/
function pickColor(value) {
    if (value > 200000) return COLORS.green;
    if (value >= 100000 && value <= 200000) return COLORS.orange;
    return COLORS.red;
}

/* helper: convert hex to rgba string with alpha */
function hexToRgba(hex, alpha = 1) {
    const h = hex.replace("#", "");
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ----------------- three.js + CSS3D setup + layouts ----------------- */

function init() {
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.z = 2500;

    scene = new THREE.Scene();

    renderer = new CSS3DRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById("container").appendChild(renderer.domElement);

    controls = new TrackballControls(camera, renderer.domElement);
    controls.minDistance = 500;
    controls.maxDistance = 8000;
    controls.addEventListener("change", render);

    // wire up buttons (they'll work after CSV loads too)
    document.getElementById("btn-table").onclick = () => transform(targets.table);
    document.getElementById("btn-sphere").onclick = () => transform(targets.sphere);
    document.getElementById("btn-helix").onclick = () => transform(targets.helix);
    document.getElementById("btn-grid").onclick = () => transform(targets.grid);

    window.addEventListener("resize", onWindowResize);
}

function layoutTargets() {
    // Build targets after objects length is known
    targets.table = [];
    targets.sphere = [];
    targets.helix = [];
    targets.grid = [];

    const l = objects.length;

    // table: basic grid (5 columns)
    for (let i = 0; i < l; i++) {
        const object = new THREE.Object3D();
        object.position.x = ( ( i % 5 ) * 320 ) - 640;
        object.position.y = - ( Math.floor( i / 5 ) * 280 ) + 280;
        object.position.z = 0;
        targets.table.push(object);
    }

    // sphere
    for (let i = 0; i < l; i++) {
        const phi = Math.acos(-1 + (2 * i) / l);
        const theta = Math.sqrt(l * Math.PI) * phi;

        const object = new THREE.Object3D();
        object.position.setFromSphericalCoords(900, phi, theta);

        const vector = new THREE.Vector3().copy(object.position).multiplyScalar(2);
        object.lookAt(vector);

        targets.sphere.push(object);
    }

    // helix
    for (let i = 0; i < l; i++) {
        const theta = i * 0.175 + Math.PI;
        const y = - ( i * 10 ) + ( l * 5 );

        const object = new THREE.Object3D();
        object.position.setFromCylindricalCoords(900, theta, y);

        const vector = new THREE.Vector3(object.position.x * 2, object.position.y, object.position.z * 2);
        object.lookAt(vector);

        targets.helix.push(object);
    }

    // grid (3D stacks)
    for (let i = 0; i < l; i++) {
        const object = new THREE.Object3D();
        object.position.x = ( ( i % 6 ) * 400 ) - 1000;
        object.position.y = ( - ( Math.floor( i / 6 ) % 6 ) * 300 ) + 600;
        object.position.z = ( Math.floor( i / 36 ) ) * 1000 - 2000;
        targets.grid.push(object);
    }
}

/* transform helper: tween all objects to match target positions */
function transform( targetsArray, duration = 1500 ) {
    if (!targetsArray || targetsArray.length !== objects.length) {
        // if targets aren't ready yet, try building them
        layoutTargets();
    }

    TWEEN.removeAll();

    for ( let i = 0; i < objects.length; i ++ ) {
        const object = objects[ i ];
        const target = (targetsArray && targetsArray[i]) ? targetsArray[i] : targets.table[i];

        new TWEEN.Tween( object.position )
            .to( { x: target.position.x, y: target.position.y, z: target.position.z }, Math.random() * duration + duration )
            .easing( TWEEN.Easing.Exponential.InOut )
            .start();

        new TWEEN.Tween( object.rotation )
            .to( { x: target.rotation.x, y: target.rotation.y, z: target.rotation.z }, Math.random() * duration + duration )
            .easing( TWEEN.Easing.Exponential.InOut )
            .start();
    }

    new TWEEN.Tween( {} )
        .to( {}, duration * 2 )
        .onUpdate( render )
        .start();
}

/* ----------------- helpers + render loop ----------------- */

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);

    render();
}

function animate() {
    requestAnimationFrame( animate );

    TWEEN.update();
    controls.update();
}

function render() {
    renderer.render( scene, camera );
}

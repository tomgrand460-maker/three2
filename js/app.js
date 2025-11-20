/* FULL UPDATED JS FILE (LEGEND + TILE FIXES + FORMATS) */

import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import TWEEN from "three/addons/libs/tween.module.js";

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdQ8324RdvqZwBjWEXJj-C9-GE1BIKfYNwNcKA4doOJC5Qi-zR0vWJOEfE3h_WGLYsMMaycNnRaDxY/pub?gid=0&single=true&output=csv";

const COLORS = {
    red: "#ef3022",
    orange: "#fdca35",
    green: "#3a9f48"
};

let camera, scene, renderer, controls;
const objects = [];
const targets = { table: [], sphere: [], helix: [], grid: [] };

init();
fetchCSVAndBuild(CSV_URL);
animate();

async function fetchCSVAndBuild(url) {
    const res = await fetch(url);
    const text = await res.text();
    const rows = parseCSV(text);

    const people = rows
        .map(r => r.map(c => c.trim()))
        .filter(r => r.length >= 6 && r[0] !== "");

    buildTiles(people);
    layoutTargets();
    transform(targets.table);
}

function parseCSV(text) {
    const rows = [];
    let current = [], field = "", inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i], next = text[i + 1];

        if (ch === '"') {
            if (inQuotes && next === '"') { field += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
            current.push(field); field = "";
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && next === '\n') i++;
            current.push(field); rows.push(current);
            current = []; field = "";
        } else field += ch;
    }

    if (field || current.length) { current.push(field); rows.push(current); }
    return rows;
}

function buildTiles(people) {
    for (const obj of objects) scene.remove(obj);
    objects.length = 0;

    for (let i = 0; i < people.length; i++) {
        const [name, photoUrl, age, country, interest, netRaw] = people[i];
        const net = parseNetWorth(netRaw);
        const color = pickColor(net);

        const el = document.createElement("div");
        el.className = "person";
        el.style.borderColor = hexToRgba(color, 0.85);

        const bar = document.createElement("div");
        bar.className = "colorbar";
        bar.style.background = color;
        el.appendChild(bar);

        const c = document.createElement("div");
        c.className = "country";
        c.textContent = country;
        el.appendChild(c);

        const a = document.createElement("div");
        a.className = "age";
        a.textContent = age;
        el.appendChild(a);

        const img = document.createElement("img");
        img.className = "photo";
        img.src = photoUrl;
        img.alt = name;
        img.onerror = () => img.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='#222'/></svg>";
        el.appendChild(img);

        const n = document.createElement("div");
        n.className = "name";
        n.textContent = name;
        el.appendChild(n);

        const it = document.createElement("div");
        it.className = "interest";
        it.textContent = interest;
        el.appendChild(it);

        const obj = new CSS3DObject(el);
        obj.position.set(Math.random()*4000-2000, Math.random()*4000-2000, Math.random()*4000-2000);
        scene.add(obj);
        objects.push(obj);
    }
}

function parseNetWorth(raw) {
    const c = raw.replace(/[$,]/g, "");
    const n = parseFloat(c);
    return isNaN(n) ? 0 : n;
}

function pickColor(v) {
    if (v > 200000) return COLORS.green;
    if (v >= 100000 && v <= 200000) return COLORS.orange;
    return COLORS.red;
}

function hexToRgba(hex, a = 1) {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
}

/* ================== THREE.JS SETUP ================== */

function init() {
    camera = new THREE.PerspectiveCamera(40, window.innerWidth/window.innerHeight, 1, 10000);
    camera.position.z = 2500;

    scene = new THREE.Scene();

    renderer = new CSS3DRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById("container").appendChild(renderer.domElement);

    controls = new TrackballControls(camera, renderer.domElement);
    controls.minDistance = 500;
    controls.maxDistance = 8000;
    controls.addEventListener("change", render);

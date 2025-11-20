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
        el.style.background = "rgb

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { PALETTES, BACKGROUNDS, OTHER, MAX_GENRES } from './constants/palettes.js';
import { GEOMETRIES, NUM_SHAPES, getCachedGeometry } from './constants/geometries.js';
import { escapeHtml } from './util/escape.js';
import {
  buildYouTubeSearchUrl,
  buildSpotifySearchUrl,
  buildAppleMusicSearchUrl,
  buildDiscogsSearchUrl,
  safeHref,
} from './util/search-urls.js';
import {
  getArtifactKey,
  isHearted,
  getAll as getAllArtifacts,
  getCount as getArtifactCount,
  addArtifact,
  removeByKey as removeArtifactByKey,
  removeAt as removeArtifactAt,
  subscribe as subscribeArchive,
} from './archive/store.js';
import { csvSplitRows, csvSplitFields, parseCSV } from './ingestion/csv-parser.js';
import { parseXML, isXML } from './ingestion/xml-parser.js';

let activePalette = 'rams';
let activeBg = 'white';

const FLY_DEPTH = 200;

let scene, camera, renderer, composer, bloomPass, controls, clock;
let instanceGroups = [], labelSprites = [];
let headers = [], csvData = [], colorMap = {};
let raycaster, mouse = new THREE.Vector2(-99,-99);
let totalRows = 0;
let flySpeed = 0.15;
let showLabels = true;
let scaleMul = 1.0;
let flyOffset = 0;
let autoFly = true;
let layoutMode = 'layers'; // 'layers' | 'sphere' | 'helix' | 'grid' | 'stream' | 'schotter'
let figure8Mode = false;
let waveMode = false;
let labelFontScale = 1.0;
let selectedCard = null; // currently shown card entry

// ─── Filter & Sort ───
let masterData = [];
let activeFilters = {};
let activeSortCol = null;
let activeSortDir = 'asc';
let _filterDebounce = null;
let searchQuery = '';

function applyFilters(rows) {
  const cols = Object.keys(activeFilters);
  if (!cols.length) return rows;
  return rows.filter(row => cols.every(col => {
    const allowed = activeFilters[col];
    if (!allowed || allowed.size === 0) return true;
    return allowed.has((row[col] || '').toString());
  }));
}

function applySort(rows) {
  if (!activeSortCol) return rows;
  const col = activeSortCol, dir = activeSortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = (a[col] || ''), vb = (b[col] || '');
    const na = parseFloat(va), nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
    return va.localeCompare(vb) * dir;
  });
}

function updateFilterStatus() {
  const el = document.getElementById('filter-status');
  if (!el) return;
  const activeCount = Object.values(activeFilters).filter(s => s && s.size > 0).length;
  if (activeCount === 0) {
    el.textContent = '';
    document.getElementById('filter-toggle').classList.remove('active');
  } else {
    el.textContent = csvData.length + ' of ' + masterData.length + ' shown';
    document.getElementById('filter-toggle').classList.add('active');
  }
}

function onFilterChipClick(col, val, chipEl) {
  if (!activeFilters[col]) activeFilters[col] = new Set();
  if (activeFilters[col].has(val)) {
    activeFilters[col].delete(val);
    chipEl.classList.remove('on');
    if (activeFilters[col].size === 0) delete activeFilters[col];
  } else {
    activeFilters[col].add(val);
    chipEl.classList.add('on');
  }
  clearTimeout(_filterDebounce);
  _filterDebounce = setTimeout(rebuildViz, 150);
}

const MAX_FILTER_CHIPS = 20;

// ─── Year Dropdown State ───
let yearDropdownCol = null;

function populateYearDropdown(hdrs, rows) {
  const yearCol = findCol(hdrs, ['year']);
  yearDropdownCol = yearCol;

  const wrapper = document.getElementById('year-dropdown');
  const select = document.getElementById('year-select');

  if (!yearCol) {
    wrapper.style.display = 'none';
    return;
  }

  // Collect unique valid years
  const yearSet = new Set();
  rows.forEach(r => {
    const y = parseInt(r[yearCol]);
    const validYear = y > 1900 && y <= 2030;
    if (validYear) {
      yearSet.add(y);
    }
  });

  const sortedYears = [...yearSet].sort((a, b) => a - b);

  if (sortedYears.length < 2) {
    wrapper.style.display = 'none';
    return;
  }

  // Build options
  select.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All Years';
  select.appendChild(allOption);

  sortedYears.forEach(year => {
    const opt = document.createElement('option');
    opt.value = year;
    opt.textContent = year;
    select.appendChild(opt);
  });

  wrapper.style.display = 'flex';
  select.value = '';

  // Change handler
  select.addEventListener('change', () => {
    const selectedValue = select.value;

    if (selectedValue === '') {
      delete activeFilters[yearCol];
    } else {
      activeFilters[yearCol] = new Set([selectedValue]);
    }

    clearTimeout(_filterDebounce);
    _filterDebounce = setTimeout(rebuildViz, 150);
  });
}

function populateFilterPanel(hdrs, rows) {
  const sortSelect = document.getElementById('sort-col');
  sortSelect.innerHTML = '<option value="">\u2014 None \u2014</option>';
  hdrs.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = h.length > 20 ? h.slice(0, 20) + '..' : h;
    sortSelect.appendChild(opt);
  });

  const filterList = document.getElementById('filter-list');
  filterList.innerHTML = '';

  // Columns to skip in filter chips
  const skipCols = new Set();
  const durationCol = findCol(hdrs, ['time', 'duration', 'length']);
  if (durationCol) skipCols.add(durationCol);

  hdrs.forEach(col => {
    if (skipCols.has(col)) return;

    const valueFreq = {};
    rows.forEach(r => {
      const v = (r[col] || '').toString();
      valueFreq[v] = (valueFreq[v] || 0) + 1;
    });
    const uniqueVals = Object.keys(valueFreq);
    if (uniqueVals.length === rows.length || uniqueVals.length <= 1) return;
    if (uniqueVals.length > 500) return;

    const title = document.createElement('div');
    title.className = 'fp-col-name';
    title.textContent = col.length > 25 ? col.slice(0, 25) + '..' : col;
    filterList.appendChild(title);

    const chips = document.createElement('div');
    chips.className = 'fp-chips';

    const sorted = uniqueVals.sort((a, b) => valueFreq[b] - valueFreq[a]);
    const shown = sorted.slice(0, MAX_FILTER_CHIPS);

    shown.forEach(val => {
      const chip = document.createElement('button');
      chip.className = 'fp-chip';
      chip.dataset.col = col;
      chip.dataset.val = val;
      const display = val || '(empty)';
      const label = display.length > 20 ? display.slice(0, 20) + '..' : display;
      chip.innerHTML = escapeHtml(label) + '<span class="fp-chip-count">' + valueFreq[val] + '</span>';
      // Restore active state
      if (activeFilters[col] && activeFilters[col].has(val)) chip.classList.add('on');
      chip.addEventListener('click', () => onFilterChipClick(col, val, chip));
      chips.appendChild(chip);
    });

    filterList.appendChild(chips);
  });
}

// ─── Artifact Archive (hearted collection) ───
// The store itself lives in src/archive/store.js; this section only
// holds DOM-tied helpers (swoop animation, bag-panel renderer).

function createSwoopAnimation(nameText, startRect) {
  const bag = document.getElementById('ab-toggle');
  const bagRect = bag.getBoundingClientRect();

  const ghost = document.createElement('div');
  ghost.className = 'swoop-ghost';
  ghost.textContent = nameText;
  ghost.style.left = startRect.left + 'px';
  ghost.style.top = startRect.top + 'px';
  document.body.appendChild(ghost);

  const dx = bagRect.left + bagRect.width / 2 - startRect.left;
  const dy = bagRect.top + bagRect.height / 2 - startRect.top;

  ghost.animate([
    { opacity: 1, transform: 'scale(1) translate(0, 0)', offset: 0 },
    { opacity: 1, transform: 'scale(1.15) translate(0, -15px)', offset: 0.2 },
    { opacity: 0.6, transform: 'scale(0.4) translate(' + dx + 'px, ' + dy + 'px)', offset: 1 }
  ], {
    duration: 700,
    easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    fill: 'forwards'
  });

  setTimeout(() => {
    ghost.remove();
    const icon = document.querySelector('#artifact-bag .ab-icon');
    icon.style.transform = 'scale(1.5)';
    icon.style.color = '#e74c3c';
    setTimeout(() => { icon.style.transform = ''; icon.style.color = ''; }, 250);
  }, 700);
}

function updateBagUI() {
  const countEl = document.getElementById('ab-count');
  const listEl = document.getElementById('ab-list');
  const emptyEl = document.getElementById('ab-empty');

  const count = getArtifactCount();
  const hasAny = count > 0;

  countEl.textContent = count;
  countEl.classList.toggle('has-items', hasAny);

  const icon = document.querySelector('#artifact-bag .ab-icon');
  icon.textContent = hasAny ? '\u2665' : '\u2661';

  const footerEl = document.querySelector('#artifact-bag .ab-footer');
  listEl.innerHTML = '';
  if (!hasAny) {
    emptyEl.style.display = '';
    if (footerEl) footerEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  if (footerEl) footerEl.style.display = '';

  getAllArtifacts().forEach((a, i) => {
    const item = document.createElement('div');
    item.className = 'ab-item';
    item.innerHTML =
      '<span class="ab-item-name">' + escapeHtml(a.name) + '</span>' +
      '<span class="ab-item-artist">' + escapeHtml(a.artist) + '</span>' +
      '<button class="ab-item-remove" data-idx="' + i + '" title="Remove">&times;</button>';
    listEl.appendChild(item);
  });
}
let pinnedInstance = null; // { groupIdx, instanceId, entry, originPos, targetPos, pinTime, settled }
let unpinning = null; // { groupIdx, instanceId, startPos, startScale, originPos, unpinTime, data }

// ─── CSV Web Worker (inline via Blob URL) ───
//
// The parser functions live in src/ingestion/csv-parser.js. The
// worker still gets them by stringifying the imported function
// objects -- Function.prototype.toString returns the original
// source verbatim, so csvSplitRows / csvSplitFields end up as
// function declarations in the worker's global scope, and parseCSV's
// body resolves the bare references to them lexically.
const _workerCode = `
  ${csvSplitRows.toString()}
  ${csvSplitFields.toString()}
  ${parseCSV.toString()}
  self.onmessage = function(e) {
    try {
      self.postMessage({ type: 'progress', phase: 'parsing', pct: 55 });
      const result = parseCSV(e.data);
      self.postMessage({ type: 'done', headers: result.headers, rows: result.rows, totalRows: result.rows.length });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  };
`;
const _workerBlob = new Blob([_workerCode], { type: 'application/javascript' });
const _workerUrl = URL.createObjectURL(_workerBlob);

// ─── File validation ───
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xml'];

function validateFile(file) {
  if (!file) return 'No file provided.';
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) return `Invalid file type. Please upload a .csv or .xml file. Got: ${ext}`;
  if (file.size > MAX_FILE_SIZE_BYTES) return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 200 MB.`;
  if (file.size === 0) return 'File is empty.';
  return null;
}

// ─── Find columns ───
function findCol(hdrs, kws) {
  return hdrs.find(h => kws.some(k => h.toLowerCase() === k))
    || hdrs.find(h => kws.some(k => h.toLowerCase().includes(k)));
}

// ─── Mobile detection ───
const isMobile = () => window.innerWidth <= 768;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── Screen reader announcer ───
function announce(msg) {
  const el = document.getElementById('sr-announcer');
  if (el) { el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; }); }
}

// ─── Pre-allocated Vector3s (Phase 5c) ───
const _tmpVec3A = new THREE.Vector3();
const _tmpVec3B = new THREE.Vector3();
const _tmpVec3C = new THREE.Vector3();

// ─── Scene ───
function initScene(){
  scene=new THREE.Scene();
  const defaultBgColor = new THREE.Color(BACKGROUNDS[activeBg] || '#ffffff');
  scene.background = defaultBgColor;
  scene.fog = new THREE.FogExp2(defaultBgColor, 0.0004);
  camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.5,3000);
  const disableAntialias = isMobile();
  const gpuPreference = isMobile() ? 'default' : 'high-performance';
  renderer=new THREE.WebGLRenderer({ antialias: !disableAntialias, powerPreference: gpuPreference });
  renderer.setSize(innerWidth,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  composer=new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,camera));
  bloomPass=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),0,0.4,0.92);
  composer.addPass(bloomPass);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=0.06;
  controls.minDistance=3;controls.maxDistance=1500;
  controls.rotateSpeed=0.4;controls.zoomSpeed=0.6;controls.panSpeed=0.5;
  controls.autoRotateSpeed=0.3;
  scene.add(new THREE.AmbientLight(0xffffff,1.0));
  const d=new THREE.DirectionalLight(0xffffff,0.6);d.position.set(50,80,50);scene.add(d);
  raycaster=new THREE.Raycaster();clock=new THREE.Clock();
  // ResizeObserver for smooth resize handling (avoids iOS Safari address bar jank)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
      renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);
    });
    ro.observe(document.body);
  } else {
    window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight)});
  }
  renderer.domElement.setAttribute('role', 'application');
  renderer.domElement.setAttribute('aria-label', 'Galaxy Artifact 3D visualization');
  renderer.domElement.addEventListener('click',onClick);
  renderer.domElement.addEventListener('pointermove',onCursorHint);
  window.addEventListener('keydown',onKey);window.addEventListener('keyup',onKeyUp);

  // Mobile performance defaults (Phase 5d)
  if (isMobile()) {
    bloomPass.strength = 0;
    document.getElementById('r-bloom').value = '0';
  }
  // Reduced motion defaults (Phase 4c)
  if (prefersReducedMotion) {
    autoFly = false;
    waveMode = false;
    document.getElementById('t-autofly')?.classList.remove('on');
    document.getElementById('t-wave')?.classList.remove('on');
  }
}

// ─── Build ───
function build(hdrs, rows){
  headers=hdrs; csvData=rows;

  // Find key columns
  const yearCol = findCol(hdrs, ['year']);
  const genreCol = findCol(hdrs, ['genre','type','category','style']);
  const nameCol = findCol(hdrs, ['name','title','song','track']) || hdrs[0];
  const artistCol = findCol(hdrs, ['artist','band']);
  const albumCol = findCol(hdrs, ['album','release']);
  const timeCol = findCol(hdrs, ['time','duration','length']);

  // ─── Genre bucketing: top N + Other ───
  const genreFreq = {};
  rows.forEach(r => { const g = (genreCol ? r[genreCol] : '') || ''; genreFreq[g] = (genreFreq[g]||0)+1; });
  const sortedGenres = Object.entries(genreFreq).sort((a,b) => b[1]-a[1]);
  const topGenres = sortedGenres.slice(0, MAX_GENRES).map(e => e[0]);
  const genreSet = new Set(topGenres);

  // Assign colors
  colorMap = {};
  const pal = PALETTES[activePalette] || PALETTES.rams;
  topGenres.forEach((g,i) => { colorMap[g] = pal[i % pal.length]; });

  function getGenreBucket(row) {
    const g = genreCol ? row[genreCol] : '';
    return genreSet.has(g) ? g : '_other_';
  }

  // ─── Year range (numeric X axis) ───
  let years = [];
  if (yearCol) {
    rows.forEach(r => { const y = parseInt(r[yearCol]); if (y > 1900 && y <= 2030) years.push(y); });
  }
  const minYear = years.length ? Math.min(...years.slice(0,10000)) : 1960;
  const maxYear = years.length ? Math.max(...years.slice(0,10000)) : 2025;
  const yearRange = maxYear - minYear || 1;

  // ─── Layout constants ───
  const X_SPREAD = 150;  // year timeline width
  const Y_GAP = 8;       // vertical gap between genre rows
  const Z_SCATTER = FLY_DEPTH; // depth scatter (was 5)
  const SPHERE_RADIUS = 80;
  const HELIX_RADIUS = 25;
  const HELIX_PITCH = 0.6;

  // Genre row positions (top genres evenly spaced, Other at bottom)
  const genreY = {};
  const allBuckets = [...topGenres, '_other_'];
  allBuckets.forEach((g,i) => { genreY[g] = (allBuckets.length/2 - i) * Y_GAP; });

  // Sphere layout: latitude band per genre
  const genreLat = {};
  allBuckets.forEach((g, i) => {
    genreLat[g] = (0.5 - i / (allBuckets.length - 1 || 1)) * 160 * (Math.PI / 180);
  });

  // ─── Clear old ───
  instanceGroups.forEach(g => {
    // Don't dispose cached geometry — only material and InstancedMesh buffers
    g.mesh.material.dispose();
    g.mesh.dispose();
    scene.remove(g.mesh);
    g.data = null;
  });
  labelSprites.forEach(s => { s.material.map?.dispose(); s.material.dispose(); scene.remove(s); });
  instanceGroups=[]; labelSprites=[]; pinnedInstance=null; selectedCard=null; unpinning=null;
  flyOffset = 0;

  // ─── Group rows by (genre bucket, shapeIdx) ───
  const groups = {}; // key: `${bucket}|${shapeIdx}`
  rows.forEach((row,i) => {
    const bucket = getGenreBucket(row);
    const shapeIdx = i % NUM_SHAPES;
    const key = `${bucket}|${shapeIdx}`;
    if (!groups[key]) groups[key] = { bucket, shapeIdx, items: [] };
    groups[key].items.push({ row, idx: i });
  });

  const dummy = new THREE.Object3D();
  const centroid = new THREE.Vector3();
  let total = 0;
  let groupCounter = 0;

  Object.values(groups).forEach(group => {
    const { bucket, shapeIdx, items } = group;
    if (!items.length) return;

    const color = new THREE.Color(colorMap[bucket] || OTHER);
    const isOther = bucket === '_other_';
    const mat = new THREE.MeshPhysicalMaterial({
      color, metalness: 0.3, roughness: 0.35,
      emissive: color, emissiveIntensity: isOther ? 0.5 : 0.7,
      transparent: false, opacity: 1.0,
    });

    const geom = getCachedGeometry(shapeIdx);
    const im = new THREE.InstancedMesh(geom, mat, items.length);
    im.userData.groupIdx = groupCounter;
    im.userData.bucket = bucket;

    const gData = [];
    items.forEach((item, li) => {
      let x, y, z;

      // Year normalization helper
      let yearNorm = item.idx / rows.length; // fallback
      if (yearCol) {
        const yr = parseInt(item.row[yearCol]);
        if (yr > 1900 && yr <= 2030) yearNorm = (yr - minYear) / yearRange;
      }
      const bucketIdx = allBuckets.indexOf(bucket);
      const bucketFrac = bucketIdx / (allBuckets.length - 1 || 1);

      if (layoutMode === 'sphere') {
        const latSpread = (160 / (allBuckets.length || 1)) * (Math.PI / 180);
        const lat = genreLat[bucket] + (Math.random() - 0.5) * latSpread;
        const lon = yearNorm * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
        const r = SPHERE_RADIUS + (Math.random() - 0.5) * 10;
        x = r * Math.cos(lat) * Math.cos(lon);
        y = r * Math.sin(lat);
        z = r * Math.cos(lat) * Math.sin(lon);

      } else if (layoutMode === 'helix') {
        // DNA double helix — two intertwined strands
        const strand = li % 2; // alternate items between strands
        const theta = yearNorm * Math.PI * 12 + (Math.random() - 0.5) * 0.2;
        const helixY = (yearNorm - 0.5) * 120;
        const strandOffset = strand * Math.PI; // 180° apart
        const rJitter = HELIX_RADIUS + (Math.random() - 0.5) * 4;
        x = rJitter * Math.cos(theta + strandOffset);
        z = rJitter * Math.sin(theta + strandOffset);
        y = helixY + (Math.random() - 0.5) * 2;

      } else if (layoutMode === 'grid') {
        // Clean organized grid — rows by genre, columns by year
        const cols = Math.max(Math.ceil(Math.sqrt(rows.length / allBuckets.length)), 4);
        const colIdx = Math.floor(yearNorm * (cols - 1));
        const gridSpacing = 3.5;
        x = (colIdx - cols / 2) * gridSpacing + (Math.random() - 0.5) * 0.6;
        y = (allBuckets.length / 2 - bucketIdx) * gridSpacing * 1.8;
        z = (Math.random() - 0.5) * 2;

      } else if (layoutMode === 'schotter') {
        // Georg Nees' Schotter — order dissolves into chaos
        const cols = Math.max(Math.ceil(Math.sqrt(rows.length / allBuckets.length)), 6);
        const colIdx = Math.floor(yearNorm * (cols - 1));
        const gridSp = 3.2;
        const rowIdx = allBuckets.length - 1 - bucketIdx;
        const chaos = rowIdx / (allBuckets.length - 1 || 1); // 0=top(ordered), 1=bottom(chaotic)
        const chaosAmt = chaos * chaos; // quadratic ramp
        x = (colIdx - cols / 2) * gridSp + (Math.random() - 0.5) * chaosAmt * gridSp * 1.8;
        y = (allBuckets.length / 2 - bucketIdx) * gridSp * 1.6 + (Math.random() - 0.5) * chaosAmt * gridSp * 1.5;
        z = (Math.random() - 0.5) * chaosAmt * 12;

      } else if (layoutMode === 'stream') {
        // Flowing river — genre streams that weave and converge
        const streamX = (yearNorm - 0.5) * X_SPREAD;
        const streamPhase = bucketFrac * Math.PI * 2;
        const meander = Math.sin(yearNorm * Math.PI * 3 + streamPhase) * 12;
        const streamY = (allBuckets.length / 2 - bucketIdx) * 5 + meander;
        const depth = Math.sin(yearNorm * Math.PI * 5 + streamPhase * 0.7) * 8;
        x = streamX + (Math.random() - 0.5) * 3;
        y = streamY + (Math.random() - 0.5) * 2;
        z = depth + (Math.random() - 0.5) * 4;

      } else {
        // Layers (default)
        x = (yearNorm - 0.5) * X_SPREAD;
        if (yearCol) {
          const yr = parseInt(item.row[yearCol]);
          if (!(yr > 1900 && yr <= 2030)) x = (Math.random() - 0.5) * 10 - X_SPREAD/2 - 10;
        }
        y = genreY[bucket] + (Math.random() - 0.5) * Y_GAP * 0.5;
        z = (Math.random() - 0.5) * Z_SCATTER;
      }

      const s = isOther ? 0.6 : 0.8 + Math.random() * 0.4;
      dummy.position.set(x, y, z);
      dummy.scale.set(s, s, s);
      if (layoutMode === 'schotter') {
        // Nees-style: rotation increases with row (order → chaos)
        const rowIdx = allBuckets.length - 1 - bucketIdx;
        const chaos = (rowIdx / (allBuckets.length - 1 || 1));
        const chaosAmt = chaos * chaos;
        dummy.rotation.set(
          (Math.random() - 0.5) * chaosAmt * Math.PI,
          (Math.random() - 0.5) * chaosAmt * Math.PI * 0.5,
          (Math.random() - 0.5) * chaosAmt * Math.PI
        );
      } else {
        dummy.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
      }
      dummy.updateMatrix();
      im.setMatrixAt(li, dummy.matrix);

      // Per-instance animation params (gentle float for easier clicking)
      const phase = Math.random() * Math.PI * 2;
      const freq = 0.2 + Math.random() * 0.3;
      const amp = 0.1 + Math.random() * 0.25;

      const bp = new THREE.Vector3(x, y, z);
      centroid.add(bp); total++;
      gData.push({ row: item.row, idx: item.idx, localIdx: li, basePos: bp, baseScale: s,
        nameCol, artistCol, albumCol, genreCol, yearCol,
        phase, freq, amp });
    });

    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    instanceGroups.push({ mesh: im, data: gData, bucket });
    groupCounter++;
  });

  centroid.divideScalar(total || 1);

  // ─── Labels ───
  if (showLabels) {
    if (layoutMode === 'sphere') {
      allBuckets.forEach(bucket => {
        if (bucket === '_other_') return;
        const lat = genreLat[bucket];
        const labelR = SPHERE_RADIUS + 15;
        const sprite = makeLabel(bucket, colorMap[bucket] || OTHER);
        sprite.position.set(labelR * Math.cos(lat), labelR * Math.sin(lat), 0);
        scene.add(sprite); labelSprites.push(sprite);
      });
      const yearStep = yearRange > 30 ? 10 : 5;
      for (let yr = Math.ceil(minYear/yearStep)*yearStep; yr <= maxYear; yr += yearStep) {
        const lon = ((yr - minYear) / yearRange) * Math.PI * 2;
        const labelR = SPHERE_RADIUS + 12;
        const sprite = makeLabel(String(yr), '#bbb');
        sprite.position.set(labelR * Math.cos(lon), -2, labelR * Math.sin(lon));
        sprite.scale.set(8, 1.5, 1);
        scene.add(sprite); labelSprites.push(sprite);
      }

    } else if (layoutMode === 'helix') {
      // Year markers along the helix axis
      const yearStep = yearRange > 30 ? 10 : 5;
      for (let yr = Math.ceil(minYear/yearStep)*yearStep; yr <= maxYear; yr += yearStep) {
        const yNorm = (yr - minYear) / yearRange;
        const sprite = makeLabel(String(yr), '#bbb');
        sprite.position.set(HELIX_RADIUS + 8, (yNorm - 0.5) * 120, 0);
        sprite.scale.set(8, 1.5, 1);
        scene.add(sprite); labelSprites.push(sprite);
      }

    } else if (layoutMode === 'grid') {
      // Genre labels along left edge
      const gridSpacing = 3.5;
      const cols = Math.max(Math.ceil(Math.sqrt(rows.length / allBuckets.length)), 4);
      allBuckets.forEach((bucket, i) => {
        if (bucket === '_other_') return;
        const sprite = makeLabel(bucket, colorMap[bucket] || OTHER);
        sprite.position.set(-cols / 2 * gridSpacing - 10, (allBuckets.length / 2 - i) * gridSpacing * 1.8, 0);
        scene.add(sprite); labelSprites.push(sprite);
      });

    } else if (layoutMode === 'schotter') {
      // Genre labels along left edge, Nees-style
      const gridSp = 3.2;
      const cols = Math.max(Math.ceil(Math.sqrt(rows.length / allBuckets.length)), 6);
      allBuckets.forEach((bucket, i) => {
        if (bucket === '_other_') return;
        const sprite = makeLabel(bucket, colorMap[bucket] || OTHER);
        sprite.position.set(-cols / 2 * gridSp - 10, (allBuckets.length / 2 - i) * gridSp * 1.6, 0);
        scene.add(sprite); labelSprites.push(sprite);
      });

    } else if (layoutMode === 'stream') {
      // Genre labels at the start of each stream
      allBuckets.forEach((bucket, i) => {
        if (bucket === '_other_') return;
        const streamPhase = (i / (allBuckets.length - 1 || 1)) * Math.PI * 2;
        const meander = Math.sin(streamPhase) * 12;
        const sprite = makeLabel(bucket, colorMap[bucket] || OTHER);
        sprite.position.set(-X_SPREAD / 2 - 14, (allBuckets.length / 2 - i) * 5 + meander, 0);
        scene.add(sprite); labelSprites.push(sprite);
      });
      const yearStep = yearRange > 30 ? 10 : 5;
      for (let yr = Math.ceil(minYear/yearStep)*yearStep; yr <= maxYear; yr += yearStep) {
        const xPos = ((yr - minYear) / yearRange - 0.5) * X_SPREAD;
        const sprite = makeLabel(String(yr), '#bbb');
        sprite.position.set(xPos, -allBuckets.length * 2.5 - 8, 0);
        sprite.scale.set(8, 1.5, 1);
        scene.add(sprite); labelSprites.push(sprite);
      }

    } else {
      // Layers (default)
      allBuckets.forEach(bucket => {
        if (bucket === '_other_') return;
        const sprite = makeLabel(bucket, colorMap[bucket] || OTHER);
        sprite.position.set(-X_SPREAD/2 - 14, genreY[bucket], 0);
        scene.add(sprite); labelSprites.push(sprite);
      });
      if (groups[Object.keys(groups).find(k => k.startsWith('_other_'))]) {
        const sprite = makeLabel(`Other (${sortedGenres.length - MAX_GENRES} genres)`, OTHER);
        sprite.position.set(-X_SPREAD/2 - 14, genreY['_other_'], 0);
        scene.add(sprite); labelSprites.push(sprite);
      }
      const yearStep = yearRange > 30 ? 10 : 5;
      for (let y = Math.ceil(minYear/yearStep)*yearStep; y <= maxYear; y += yearStep) {
        const xPos = ((y - minYear) / yearRange - 0.5) * X_SPREAD;
        const sprite = makeLabel(String(y), '#bbb');
        sprite.position.set(xPos, genreY['_other_'] - Y_GAP, 0);
        sprite.scale.set(8, 1.5, 1);
        scene.add(sprite); labelSprites.push(sprite);
      }
    }
  }

  // Camera
  if (layoutMode === 'sphere') {
    controls.target.set(0, 0, 0);
    camera.position.set(0, SPHERE_RADIUS * 0.5, SPHERE_RADIUS * 2.2);
  } else if (layoutMode === 'helix') {
    controls.target.set(0, 0, 0);
    camera.position.set(60, 20, 60);
  } else if (layoutMode === 'grid') {
    controls.target.copy(centroid);
    camera.position.set(centroid.x, centroid.y + 30, centroid.z + 60);
  } else if (layoutMode === 'schotter') {
    controls.target.copy(centroid);
    camera.position.set(centroid.x, centroid.y + 20, centroid.z + 55);
  } else if (layoutMode === 'stream') {
    controls.target.copy(centroid);
    camera.position.set(centroid.x, centroid.y + 20, centroid.z + X_SPREAD * 0.4);
  } else {
    controls.target.copy(centroid);
    camera.position.set(centroid.x, centroid.y + 10, centroid.z + X_SPREAD * 0.5);
  }
  controls.update();

  // HUD
  const ct = totalRows > rows.length ? `${rows.length.toLocaleString()} of ${totalRows.toLocaleString()}` : rows.length.toLocaleString();
  document.getElementById('hud-sub').textContent = `${ct} tracks`;
  const infoEl = document.getElementById('info');
  infoEl.textContent = '';
  const infoLines = layoutMode === 'sphere'
    ? [
        yearCol ? `\u27F3 ${minYear} \u2014 ${yearCol} \u2014 ${maxYear} (longitude)` : '',
        genreCol ? `\u2195 ${genreCol} (latitude, top ${topGenres.length})` : '',
        'scroll zoom \u00b7 drag orbit \u00b7 click to inspect',
      ].filter(Boolean)
    : [
        yearCol ? `\u2190 ${minYear} \u2500\u2500\u2500 ${yearCol} \u2500\u2500\u2500 ${maxYear} \u2192` : '',
        genreCol ? `\u2195 ${genreCol} (top ${topGenres.length})` : '',
        'scroll zoom \u00b7 drag orbit \u00b7 click to inspect',
      ].filter(Boolean);
  infoLines.forEach((line, i) => {
    if (i > 0) infoEl.appendChild(document.createElement('br'));
    infoEl.appendChild(document.createTextNode(line));
  });
}

function makeLabel(text, color){
  const baseFontSize = 28;
  const fontSize = Math.round(baseFontSize * labelFontScale);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '500 ' + fontSize + 'px Space Mono, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color || '#999';
  ctx.globalAlpha = 0.85;
  const maxChars = Math.max(10, Math.round(26 / labelFontScale));
  const displayText = text.length > maxChars ? text.slice(0, maxChars) + '..' : text;
  ctx.fillText(displayText, 8, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({map: tex, transparent: true, opacity: 0.7, depthWrite: false});
  const baseScaleX = 12;
  const baseScaleY = 1.5;
  const s = new THREE.Sprite(mat);
  s.scale.set(baseScaleX * labelFontScale, baseScaleY * labelFontScale, 1);
  return s;
}

// ─── Floating Animation ───
const _floatDummy = new THREE.Object3D();
function updateFloat(t) {
  const isSphere = layoutMode === 'sphere';
  const isRadial = isSphere || layoutMode === 'helix';
  const spinAngle = isRadial && autoFly && !figure8Mode ? flyOffset * 0.3 : 0;
  const cosS = Math.cos(spinAngle), sinS = Math.sin(spinAngle);

  instanceGroups.forEach(g => {
    let needsUpdate = false;
    g.data.forEach((d, li) => {
      let px, py, pz;

      if (isRadial) {
        const bx = d.basePos.x, bz = d.basePos.z;
        const rx = bx * cosS - bz * sinS;
        const rz = bx * sinS + bz * cosS;
        if (waveMode) {
          px = rx; py = d.basePos.y; pz = rz;
        } else {
          px = rx + Math.sin(t * d.freq + d.phase) * d.amp * 0.3;
          py = d.basePos.y + Math.cos(t * d.freq * 0.7 + d.phase + 1.0) * d.amp * 0.3;
          pz = rz;
        }
      } else {
        if (waveMode) {
          px = d.basePos.x; py = d.basePos.y; pz = d.basePos.z;
        } else {
          let floatScale = 1;
          if (layoutMode === 'grid') floatScale = 0.15;
          else if (layoutMode === 'schotter') floatScale = 0.1 + (1 - d.basePos.y / 30) * 0.4;
          px = d.basePos.x + Math.sin(t * d.freq + d.phase) * d.amp * floatScale;
          py = d.basePos.y + Math.cos(t * d.freq * 0.7 + d.phase + 1.0) * d.amp * 0.6 * floatScale;
          pz = d.basePos.z;
        }
        if (autoFly && layoutMode !== 'grid' && layoutMode !== 'schotter') {
          pz = ((d.basePos.z + flyOffset) % FLY_DEPTH + FLY_DEPTH) % FLY_DEPTH - FLY_DEPTH / 2;
        }
      }

      // Wave physics displacement
      if (waveMode) {
        const omega = Math.min(Math.abs(flySpeed) * 2.0, 6.0);
        const waveK = 0.08;
        const dist = Math.sqrt(d.basePos.x * d.basePos.x + d.basePos.z * d.basePos.z);
        // Standing wave along X
        const standing = Math.sin(waveK * d.basePos.x - omega * t)
                       + Math.sin(waveK * d.basePos.x + omega * t);
        // Radial ripple from center
        const ripple = Math.sin(waveK * dist - omega * t + d.phase);
        // Transverse displacement (Y)
        const waveAmp = d.amp * Math.abs(flySpeed) * 1.5;
        py += (standing * 0.4 + ripple * 0.6) * waveAmp;
        // Longitudinal displacement (X/Z)
        const longAmp = waveAmp * 0.2;
        const normX = dist > 0.01 ? d.basePos.x / dist : 0;
        const normZ = dist > 0.01 ? d.basePos.z / dist : 0;
        const longWave = Math.cos(waveK * dist - omega * t + d.phase);
        px += normX * longWave * longAmp;
        pz += normZ * longWave * longAmp;
        // Second harmonic interference
        py += Math.sin(waveK * 2 * dist - omega * 1.5 * t + d.phase * 2) * waveAmp * 0.25;
      }

      const isPinned = pinnedInstance && pinnedInstance.groupIdx === g.mesh.userData.groupIdx && pinnedInstance.instanceId === li;
      const isUnpinning = unpinning && unpinning.groupIdx === g.mesh.userData.groupIdx && unpinning.instanceId === li;

      if (isPinned) {
        // Recompute target each frame so artifact stays centered in front of camera
        camera.getWorldDirection(_tmpVec3A);
        _tmpVec3B.crossVectors(_tmpVec3A, camera.up).normalize();
        _tmpVec3C.copy(camera.position).add(_tmpVec3A.multiplyScalar(12)).add(_tmpVec3B.multiplyScalar(-2));

        // Smooth swoop: lerp from origin to target over ~0.6 seconds
        const elapsed = t - pinnedInstance.pinTime;
        const progress = Math.min(elapsed / 0.6, 1.0);
        // Ease-out cubic for graceful deceleration
        const ease = 1 - Math.pow(1 - progress, 3);

        if (progress >= 1.0) {
          _floatDummy.position.copy(_tmpVec3C);
        } else {
          _floatDummy.position.lerpVectors(pinnedInstance.originPos, _tmpVec3C, ease);
        }
        const baseS = d.baseScale * scaleMul;
        const targetS = d.baseScale * 5.0 * scaleMul;
        const ps = baseS + (targetS - baseS) * ease;

        _floatDummy.scale.set(ps, ps, ps);
        _floatDummy.rotation.set(t * 0.4, t * 0.6, t * 0.2);
        _floatDummy.updateMatrix();
        g.mesh.setMatrixAt(li, _floatDummy.matrix);
        // Store world position for card placement (must clone since _floatDummy.position is reused)
        if (!pinnedInstance.worldPos) pinnedInstance.worldPos = new THREE.Vector3();
        pinnedInstance.worldPos.copy(_floatDummy.position);
        pinnedInstance.settled = progress >= 1.0;
      } else if (isUnpinning) {
        // Graceful return: lerp from pinned position back to natural position
        const elapsed = t - unpinning.unpinTime;
        const progress = Math.min(elapsed / 0.5, 1.0);
        const ease = progress * progress * (3 - 2 * progress); // smoothstep

        const naturalPos = new THREE.Vector3(px, py, pz);
        const currentPos = new THREE.Vector3().lerpVectors(unpinning.startPos, naturalPos, ease);
        const naturalS = d.baseScale * scaleMul;
        const ps = unpinning.startScale + (naturalS - unpinning.startScale) * ease;

        _floatDummy.position.copy(currentPos);
        _floatDummy.scale.set(ps, ps, ps);
        _floatDummy.rotation.set(t * 0.4 * (1 - ease), t * 0.6 * (1 - ease) + t * 0.15 * ease + d.phase * ease, t * 0.2 * (1 - ease));
        _floatDummy.updateMatrix();
        g.mesh.setMatrixAt(li, _floatDummy.matrix);

        if (progress >= 1.0) unpinning = null;
      } else {
        const isHov = hoveredInstance && hoveredInstance.groupIdx === g.mesh.userData.groupIdx && hoveredInstance.instanceId === li;
        const s = d.baseScale * scaleMul * (isHov ? 1.35 : 1.0);
        _floatDummy.position.set(px, py, pz);
        _floatDummy.scale.set(s, s, s);
        if (waveMode) {
          const wRot = Math.sin(t * Math.abs(flySpeed) + d.phase) * 0.5;
          _floatDummy.rotation.set(wRot, t * 0.15 + d.phase, wRot * 0.3);
        } else {
          _floatDummy.rotation.set(0, t * 0.15 + d.phase, 0);
        }
        _floatDummy.updateMatrix();
        g.mesh.setMatrixAt(li, _floatDummy.matrix);
      }
      needsUpdate = true;
    });
    if (needsUpdate) g.mesh.instanceMatrix.needsUpdate = true;
  });
}

// ─── Fly ───
const keys={};
function onKey(e){
  const tag = e.target.tagName;
  const isFormField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  if (isFormField) return;

  // Escape closes any open panel/card (Phase 4b)
  if (e.key === 'Escape') {
    e.preventDefault();

    const albumCard = document.getElementById('album-card');
    const albumCardVisible = albumCard.style.display === 'block';
    if (albumCardVisible) { unpinInstance(); return; }

    const mobileMenu = document.getElementById('mobile-menu');
    const mobileMenuOpen = mobileMenu && mobileMenu.classList.contains('open');
    if (mobileMenuOpen) {
      const closeBtn = mobileMenu.querySelector('.mm-close');
      closeBtn.click();
      return;
    }

    const ctrlPanel = document.getElementById('ctrl-panel');
    const ctrlPanelOpen = ctrlPanel.classList.contains('open');
    if (ctrlPanelOpen) {
      ctrlPanel.classList.remove('open');
      document.getElementById('ctrl-toggle').setAttribute('aria-expanded', 'false');
      return;
    }

    const filterPanel = document.getElementById('filter-panel');
    const filterPanelOpen = filterPanel.classList.contains('open');
    if (filterPanelOpen) {
      filterPanel.classList.remove('open');
      document.getElementById('filter-toggle').setAttribute('aria-expanded', 'false');
      return;
    }

    const searchResults = document.getElementById('search-results');
    const searchOpen = searchResults.classList.contains('open');
    if (searchOpen) {
      searchResults.classList.remove('open');
      document.getElementById('search-input').setAttribute('aria-expanded', 'false');
      return;
    }
    return;
  }
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','q','e'].includes(e.key)){e.preventDefault();keys[e.key]=true}
}
function onKeyUp(e){const t=e.target.tagName;if(t==='INPUT'||t==='SELECT'||t==='TEXTAREA')return;keys[e.key]=false}
// Pre-allocated vectors for fly() (Phase 5c)
const _flyFwd = new THREE.Vector3();
const _flyRt = new THREE.Vector3();
const _flyUp = new THREE.Vector3(0, 1, 0);
function fly(){
  if (figure8Mode && autoFly) return;
  const sp=Math.abs(flySpeed) || 0.1;
  camera.getWorldDirection(_flyFwd);_flyFwd.y=0;_flyFwd.normalize();
  _flyRt.crossVectors(_flyFwd,camera.up).normalize();
  if(keys.ArrowUp||keys.w){camera.position.addScaledVector(_flyFwd,sp);controls.target.addScaledVector(_flyFwd,sp)}
  if(keys.ArrowDown||keys.s){camera.position.addScaledVector(_flyFwd,-sp);controls.target.addScaledVector(_flyFwd,-sp)}
  if(keys.ArrowLeft||keys.a){camera.position.addScaledVector(_flyRt,-sp);controls.target.addScaledVector(_flyRt,-sp)}
  if(keys.ArrowRight||keys.d){camera.position.addScaledVector(_flyRt,sp);controls.target.addScaledVector(_flyRt,sp)}
  if(keys.q){camera.position.addScaledVector(_flyUp,sp);controls.target.addScaledVector(_flyUp,sp)}
  if(keys.e){camera.position.addScaledVector(_flyUp,-sp);controls.target.addScaledVector(_flyUp,-sp)}
}

// ─── Click (Album Card + Pin) ───
function unpinInstance() {
  if (pinnedInstance) {
    // Capture current state for graceful return
    const d = instanceGroups[pinnedInstance.groupIdx]?.data[pinnedInstance.instanceId];
    if (d && pinnedInstance.worldPos) {
      unpinning = {
        groupIdx: pinnedInstance.groupIdx,
        instanceId: pinnedInstance.instanceId,
        startPos: pinnedInstance.worldPos.clone(),
        startScale: d.baseScale * 5.0 * scaleMul,
        unpinTime: clock.getElapsedTime(),
      };
    }
  }
  pinnedInstance = null;
  selectedCard = null;
  // Fade card out
  const card = document.getElementById('album-card');
  card.style.transition = 'opacity 0.35s ease';
  card.style.opacity = '0';
  setTimeout(() => {
    card.style.display = 'none';
    card.style.opacity = '';
    card.style.transition = '';
    card.classList.remove('pinned');
  }, 350);
}

function onClick(e) {
  // Ignore clicks on the card itself
  if (e.target.closest('#album-card')) return;

  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(instanceGroups.map(g => g.mesh));
  const card = document.getElementById('album-card');

  if (hits.length) {
    const h = hits[0], gi = h.object.userData.groupIdx;
    const entry = instanceGroups[gi]?.data[h.instanceId];
    if (!entry) { unpinInstance(); return; }

    // If clicking the same pinned artifact, unpin it
    if (pinnedInstance && pinnedInstance.groupIdx === gi && pinnedInstance.instanceId === h.instanceId) {
      unpinInstance();
      return;
    }

    // Pin this artifact — capture current position; target is computed per-frame relative to camera
    selectedCard = entry;
    const originPos = h.point.clone();
    const pinTime = clock.getElapsedTime();
    unpinning = null; // cancel any in-progress return animation
    pinnedInstance = { groupIdx: gi, instanceId: h.instanceId, entry, originPos, pinTime, settled: false };

    populateAlbumCard(entry);
  } else {
    // Click on empty space — unpin
    unpinInstance();
  }
}

// ─── Cursor hint (pointer on hoverable orbs) + hover scale (Design Manifesto: tactile realism) ───
let _cursorHintPending = false;
let hoveredInstance = null; // { groupIdx, instanceId }
function onCursorHint(e) {
  // Skip hover hints for touch input
  if (e.pointerType === 'touch') return;
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  // Throttle raycasting to once per frame (Phase 5b)
  if (!_cursorHintPending) {
    _cursorHintPending = true;
    requestAnimationFrame(() => {
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(instanceGroups.map(g => g.mesh));
      renderer.domElement.style.cursor = hits.length ? 'pointer' : '';
      if (hits.length) {
        hoveredInstance = { groupIdx: hits[0].object.userData.groupIdx, instanceId: hits[0].instanceId };
      } else {
        hoveredInstance = null;
      }
      _cursorHintPending = false;
    });
  }
}

// ─── Populate album card (shared by click + search pin) ───
function populateAlbumCard(entry) {
  const card = document.getElementById('album-card');
  const r = entry.row;
  card.querySelector('.ac-name').textContent = r[entry.nameCol] || '';
  const parts = [];
  if (entry.artistCol && r[entry.artistCol]) parts.push(r[entry.artistCol]);
  if (entry.albumCol && r[entry.albumCol]) parts.push(r[entry.albumCol]);
  if (entry.yearCol && r[entry.yearCol]) parts.push(r[entry.yearCol]);
  card.querySelector('.ac-sub').textContent = parts.join(' · ');
  const gc = colorMap[entry.genreCol ? r[entry.genreCol] : ''] || OTHER;
  const ge = card.querySelector('.ac-genre');
  ge.textContent = entry.genreCol ? r[entry.genreCol] : '';
  ge.style.background = gc + '22';
  ge.style.color = gc;
  const artist = (entry.artistCol && r[entry.artistCol]) || '';
  const song = r[entry.nameCol] || '';
  card.querySelector('.ac-yt').href = safeHref(buildYouTubeSearchUrl(song, artist));
  card.querySelector('.ac-spotify').href = safeHref(buildSpotifySearchUrl(song, artist));
  card.querySelector('.ac-apple').href = safeHref(buildAppleMusicSearchUrl(song, artist));
  card.querySelector('.ac-discogs').href = safeHref(buildDiscogsSearchUrl(song, artist));
  const heartBtn = card.querySelector('.ac-heart');
  heartBtn.classList.toggle('hearted', isHearted(entry));
  heartBtn.classList.remove('jumping');
  card.classList.add('pinned');
  card.style.display = 'block';
}

// ─── Close card ───
document.getElementById('album-card').querySelector('.ac-close').addEventListener('click', (e) => {
  e.stopPropagation();
  unpinInstance();
});

// ─── Album card swipe-to-close (mobile bottom sheet) ───
{
  const acCard = document.getElementById('album-card');
  const acHandle = acCard.querySelector('.ac-handle');
  const CARD_DISMISS_THRESHOLD = 80;

  let acDragStartY = 0;
  let acDragDeltaY = 0;
  let acDragging = false;

  function resetCardDragState() {
    acDragging = false;
    acCard.style.transition = '';
    acCard.style.transform = '';
  }

  acHandle.addEventListener('pointerdown', (e) => {
    if (!isMobile()) return;

    acDragging = true;
    acDragStartY = e.clientY;
    acDragDeltaY = 0;
    acCard.style.transition = 'none';
    acHandle.setPointerCapture(e.pointerId);
  });

  acHandle.addEventListener('pointermove', (e) => {
    if (!acDragging) return;

    const rawDelta = e.clientY - acDragStartY;
    acDragDeltaY = Math.max(0, rawDelta);
    acCard.style.transform = `translateY(${acDragDeltaY}px)`;
  });

  acHandle.addEventListener('pointerup', () => {
    if (!acDragging) return;

    acDragging = false;
    acCard.style.transition = '';

    const swipedFarEnough = acDragDeltaY > CARD_DISMISS_THRESHOLD;
    if (swipedFarEnough) {
      acCard.style.transform = '';
      unpinInstance();
    } else {
      acCard.style.transform = 'translateY(0)';
      setTimeout(() => {
        acCard.style.transform = '';
      }, 300);
    }
  });

  acHandle.addEventListener('pointercancel', resetCardDragState);
}

// ─── Heart click ───
document.getElementById('album-card').querySelector('.ac-heart').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!selectedCard) return;

  const heartBtn = e.currentTarget;
  const entry = selectedCard;
  const key = getArtifactKey(entry);
  const r = entry.row;

  if (isHearted(entry)) {
    removeArtifactByKey(key);
    heartBtn.classList.remove('hearted');
  } else {
    const artifact = {
      key,
      name: r[entry.nameCol] || '',
      artist: (entry.artistCol && r[entry.artistCol]) || '',
      album: (entry.albumCol && r[entry.albumCol]) || '',
      genre: (entry.genreCol && r[entry.genreCol]) || '',
      year: (entry.yearCol && r[entry.yearCol]) || '',
      heartedAt: new Date().toISOString(),
    };
    addArtifact(artifact);
    heartBtn.classList.add('hearted');

    // Jump animation
    heartBtn.classList.add('jumping');
    setTimeout(() => heartBtn.classList.remove('jumping'), 600);

    // Swoop animation
    const nameEl = document.querySelector('#album-card .ac-name');
    const nameRect = nameEl.getBoundingClientRect();
    createSwoopAnimation(artifact.name, nameRect);
  }
});

// ─── Artifact Bag panel ───
document.getElementById('ab-toggle').addEventListener('click', () => {
  document.getElementById('artifact-bag').classList.toggle('open');
});

document.getElementById('ab-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.ab-item-remove');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx);
  removeArtifactAt(idx);
  if (selectedCard && !isHearted(selectedCard)) {
    document.querySelector('.ac-heart')?.classList.remove('hearted');
  }
});

document.getElementById('ab-export').addEventListener('click', () => {
  const all = getAllArtifacts();
  if (!all.length) return;
  const exportData = {
    format: 'artifact-archive-v1',
    exportedAt: new Date().toISOString(),
    count: all.length,
    artifacts: all.map(a => ({
      name: a.name, artist: a.artist, album: a.album,
      genre: a.genre, year: a.year, heartedAt: a.heartedAt,
    }))
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'artifact-archive-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

// Re-render the bag UI on every store mutation, plus once on startup.
subscribeArchive(updateBagUI);
updateBagUI();

// ─── Page Visibility ───
let isPageVisible = true;
document.addEventListener('visibilitychange', () => {
  isPageVisible = !document.hidden;
  if (isPageVisible && clock) {
    clock.getDelta(); // discard stale delta to prevent animation jump
    requestAnimationFrame(animate);
  }
});

// ─── Animate ───
function animate(){
  if (!isPageVisible) return;
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // Accumulate fly offset
  if (autoFly) {
    flyOffset += flySpeed * 0.02;
  }

  fly();

  // Figure-8 camera path (lemniscate of Bernoulli)
  if (figure8Mode && autoFly) {
    const theta = flyOffset * 0.15;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    const denom = 1 + sinT * sinT;
    const radius = layoutMode === 'sphere' ? 160 : 80;
    const depth = layoutMode === 'sphere' ? 160 : 90;
    const yAmp = layoutMode === 'sphere' ? 40 : 15;
    const yBase = layoutMode === 'sphere' ? 20 : 10;
    // Path point on the lemniscate
    const pathX = radius * cosT / denom;
    const pathY = yAmp * sinT * cosT / denom + yBase;
    const pathZ = depth * sinT;
    // Look-ahead point
    const lt = theta + 0.15;
    const sinL = Math.sin(lt), cosL = Math.cos(lt);
    const denomL = 1 + sinL * sinL;
    const lookX = radius * cosL / denomL;
    const lookY = yAmp * sinL * cosL / denomL + yBase;
    const lookZ = depth * sinL;
    // Preserve user zoom: maintain distance between camera and target
    const currentDist = camera.position.distanceTo(controls.target);
    const pathTarget = new THREE.Vector3(lookX, lookY, lookZ);
    const pathDir = new THREE.Vector3(lookX - pathX, lookY - pathY, lookZ - pathZ).normalize();
    const pathOrigin = pathTarget.clone().sub(pathDir.multiplyScalar(currentDist));
    camera.position.lerp(pathOrigin, 0.03);
    controls.target.lerp(pathTarget, 0.03);
  }

  updateFloat(t);

  // Keep pinned card next to pinned artifact on screen
  if (pinnedInstance && pinnedInstance.worldPos) {
    const card = document.getElementById('album-card');
    // Fade card in after swoop completes
    const elapsed = t - pinnedInstance.pinTime;
    const cardFade = Math.min(Math.max((elapsed - 0.3) / 0.3, 0), 1);
    card.style.opacity = cardFade;

    if (isMobile()) {
      // Mobile: bottom sheet position (CSS handles layout)
      card.style.left = '';
      card.style.top = '';
      card.style.bottom = '';
    } else {
      // Desktop: floating near the 3D object
      const projected = pinnedInstance.worldPos.clone().project(camera);
      const sx = (projected.x * 0.5 + 0.5) * innerWidth;
      const sy = (-projected.y * 0.5 + 0.5) * innerHeight;
      card.style.left = Math.min(Math.max(sx + 80, 10), innerWidth - 400) + 'px';
      card.style.top = Math.min(Math.max(sy - 80, 10), innerHeight - 200) + 'px';
      card.style.bottom = 'auto';
    }
  }

  // Rotate labels with radial layouts
  const isRadialLayout = layoutMode === 'sphere' || layoutMode === 'helix';
  if (isRadialLayout && autoFly && !figure8Mode) {
    const spin = flyOffset * 0.3;
    const cs = Math.cos(spin), ss = Math.sin(spin);
    labelSprites.forEach(s => {
      if (s.userData.baseX === undefined) { s.userData.baseX = s.position.x; s.userData.baseZ = s.position.z; }
      s.position.x = s.userData.baseX * cs - s.userData.baseZ * ss;
      s.position.z = s.userData.baseX * ss + s.userData.baseZ * cs;
    });
  }

  controls.update();
  composer.render();
}

// ─── Load ───
function loadData(text) {
  const { headers: h, rows: r } = isXML(text) ? parseXML(text) : parseCSV(text);
  if (!r.length) return;
  totalRows = r.length;
  headers = h;
  masterData = r;
  activeFilters = {};
  activeSortCol = null;
  activeSortDir = 'asc';
  populateFilterPanel(h, masterData);
  populateYearDropdown(h, masterData);
  rebuildViz();
  announce(totalRows.toLocaleString() + ' tracks loaded');
}

function handleFile(f) {
  const status = document.getElementById('upload-status');
  const bar = document.getElementById('upload-progress');
  const fill = document.getElementById('upload-progress-fill');
  const fileInput = document.getElementById('file-input');

  function setProgress(pct) {
    bar.style.display = 'block';
    fill.style.width = Math.min(100, Math.round(pct)) + '%';
  }
  function hideProgress() {
    setTimeout(() => { bar.style.display = 'none'; fill.style.width = '0%'; }, 600);
  }
  function showError(msg) {
    status.style.display = 'block';
    status.textContent = `/// ${msg} ///`;
    hideProgress();
    setTimeout(() => { status.style.display = 'none'; }, 5000);
  }

  const error = validateFile(f);
  if (error) { showError(error); return; }

  status.style.display = 'block';
  status.textContent = `/// Reading ${(f.size / 1048576).toFixed(1)} MB... ///`;
  setProgress(0);

  const rd = new FileReader();
  rd.onprogress = e => { if (e.lengthComputable) setProgress((e.loaded / e.total) * 50); };
  rd.onerror = () => { showError('Failed to read file'); };
  rd.onload = e => {
    const text = e.target.result;
    fileInput.value = ''; // allow re-uploading the same file

    if (isXML(text)) {
      // XML: must use main thread (DOMParser unavailable in workers)
      status.textContent = '/// Parsing XML... ///';
      setProgress(55);
      setTimeout(() => {
        try {
          const { headers: h, rows: r } = parseXML(text);
          if (!r.length) { showError('No records found in XML'); return; }
          setProgress(90);
          totalRows = r.length;
          headers = h;
          masterData = r;
          activeFilters = {}; activeSortCol = null; activeSortDir = 'asc';
          populateFilterPanel(h, masterData);
          populateYearDropdown(h, masterData);
          rebuildViz();
          setProgress(100);
          status.textContent = `/// ${totalRows.toLocaleString()} tracks loaded ///`;
          hideProgress();
          setTimeout(() => { status.style.display = 'none'; }, 3000);
        } catch (err) { showError(err.message); }
      }, 30);
    } else {
      // CSV: offload to Web Worker
      status.textContent = '/// Parsing CSV... ///';
      setProgress(50);
      const worker = new Worker(_workerUrl);
      const timeout = setTimeout(() => {
        worker.terminate();
        showError('Parsing timed out (>60s)');
      }, 60000);

      worker.onmessage = ev => {
        const msg = ev.data;
        if (msg.type === 'progress') {
          setProgress(msg.pct);
        } else if (msg.type === 'done') {
          clearTimeout(timeout);
          if (!msg.rows.length) { showError('No rows found in CSV'); worker.terminate(); return; }
          totalRows = msg.totalRows;
          setProgress(90);
          headers = msg.headers;
          masterData = msg.rows;
          activeFilters = {}; activeSortCol = null; activeSortDir = 'asc';
          populateFilterPanel(headers, masterData);
          populateYearDropdown(headers, masterData);
          rebuildViz();
          setProgress(100);
          status.textContent = `/// ${totalRows.toLocaleString()} tracks loaded ///`;
          hideProgress();
          setTimeout(() => { status.style.display = 'none'; }, 3000);
          worker.terminate();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          showError(msg.message);
          worker.terminate();
        }
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        showError('CSV parser crashed');
        worker.terminate();
      };
      worker.postMessage(text);
    }
  };
  rd.readAsText(f);
}

// Upload button + drag-and-drop
document.getElementById('upload-btn').addEventListener('click', () => document.getElementById('file-input').click());
document.getElementById('file-input').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

// Drag-and-drop with visual feedback (counter pattern prevents child-element flicker)
let _dragCounter = 0;
document.body.addEventListener('dragenter', e => {
  e.preventDefault();
  _dragCounter++;
  document.body.classList.add('drag-over');
});
document.body.addEventListener('dragleave', e => {
  e.preventDefault();
  _dragCounter--;
  if (_dragCounter <= 0) { _dragCounter = 0; document.body.classList.remove('drag-over'); }
});
document.body.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
document.body.addEventListener('drop', e => {
  e.preventDefault();
  _dragCounter = 0;
  document.body.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

// Auto-load default library on startup (with download progress)
async function loadDefaultLibrary() {
  const loadEl = document.getElementById('loading');
  try {
    const resp = await fetch('music_library.csv');
    if (!resp.ok) throw new Error('fetch failed');
    const contentLength = resp.headers.get('Content-Length');
    let text;
    if (contentLength && resp.body) {
      const total = parseInt(contentLength, 10);
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const pct = Math.round((received / total) * 100);
        loadEl.textContent = `/// Loading library ${pct}% ///`;
      }
      const buf = new Uint8Array(received);
      let pos = 0;
      for (const chunk of chunks) { buf.set(chunk, pos); pos += chunk.length; }
      text = new TextDecoder().decode(buf);
    } else {
      // Fallback: no Content-Length (e.g. local file:// or gzipped)
      text = await resp.text();
    }
    loadData(text);
    loadEl.classList.add('hidden');
  } catch {
    loadEl.textContent = '/// Error loading library ///';
  }
}

// ─── Customize Panel ───
function rebuildViz() {
  if (!headers.length || !masterData.length) return;
  let filtered = applyFilters(masterData);
  // Apply search query filter
  if (searchQuery && searchQuery.length >= 2) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(row =>
      headers.some(col => (row[col] || '').toString().toLowerCase().includes(q))
    );
  }
  filtered = applySort(filtered);
  csvData = filtered;
  if (filtered.length === 0) {
    instanceGroups.forEach(g => {
      g.mesh.material.dispose();
      g.mesh.dispose(); scene.remove(g.mesh);
    });
    labelSprites.forEach(s => { s.material.map?.dispose(); s.material.dispose(); scene.remove(s); });
    instanceGroups = []; labelSprites = []; pinnedInstance = null; selectedCard = null; unpinning = null;
    document.getElementById('hud-sub').textContent = 'No matching artifacts';
    updateFilterStatus();
    return;
  }
  build(headers, csvData);
  updateFilterStatus();
}

document.getElementById('ctrl-toggle').addEventListener('click', () => {
  const panel = document.getElementById('ctrl-panel');
  panel.classList.toggle('open');
  document.getElementById('ctrl-toggle').setAttribute('aria-expanded', panel.classList.contains('open'));
});

// Layout chips
const layoutRow = document.getElementById('layout-row');
['layers', 'sphere', 'helix', 'grid', 'stream', 'schotter'].forEach(mode => {
  const btn = document.createElement('button');
  btn.className = 'chip' + (mode === layoutMode ? ' on' : '');
  btn.textContent = mode;
  btn.addEventListener('click', () => {
    layoutMode = mode;
    layoutRow.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    btn.classList.add('on');
    rebuildViz();
  });
  layoutRow.appendChild(btn);
});

// Palette chips
const palRow = document.getElementById('pal-row');
Object.keys(PALETTES).forEach(name => {
  const btn = document.createElement('button');
  btn.className = 'chip' + (name === activePalette ? ' on' : '');
  btn.textContent = name;
  btn.addEventListener('click', () => {
    activePalette = name;
    palRow.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    btn.classList.add('on');
    rebuildViz();
  });
  palRow.appendChild(btn);
});

// Background chips
const bgRow = document.getElementById('bg-row');
Object.entries(BACKGROUNDS).forEach(([name, hex]) => {
  const btn = document.createElement('button');
  btn.className = 'chip' + (name === activeBg ? ' on' : '');
  btn.textContent = name;
  btn.addEventListener('click', () => {
    activeBg = name;
    bgRow.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    btn.classList.add('on');
    const col = new THREE.Color(hex);
    scene.background = col;
    scene.fog.color = col;
    const lightBgs = new Set(['white', 'snow']);
    const isDark = !lightBgs.has(name);
    document.body.classList.toggle('dark-mode', isDark);
    document.getElementById('hud').style.color = isDark ? '#ddd' : '';
    document.getElementById('info').style.color = isDark ? '#999' : '';
    document.querySelector('#hud h1').style.color = isDark ? '#eee' : '#333';
    document.querySelector('#hud .sub').style.color = isDark ? '#aaa' : '#666';
    document.querySelector('#artifact-bag .ab-toggle').style.color = isDark ? '#aaa' : '#444';
  });
  bgRow.appendChild(btn);
});

// Sliders
document.getElementById('r-bloom').addEventListener('input', e => {
  bloomPass.strength = parseFloat(e.target.value);
});
document.getElementById('r-scale').addEventListener('input', e => {
  scaleMul = parseFloat(e.target.value);
});
document.getElementById('r-speed').addEventListener('input', e => {
  flySpeed = parseFloat(e.target.value);
});
document.getElementById('r-fog').addEventListener('input', e => {
  scene.fog.density = parseFloat(e.target.value);
});
let _labelSizeDebounce = null;
document.getElementById('r-label-size').addEventListener('input', e => {
  labelFontScale = parseFloat(e.target.value);
  clearTimeout(_labelSizeDebounce);
  _labelSizeDebounce = setTimeout(rebuildViz, 120);
});

// Toggles
document.getElementById('t-labels').addEventListener('click', function() {
  this.classList.toggle('on');
  showLabels = this.classList.contains('on');
  rebuildViz();
});
document.getElementById('t-orbit').addEventListener('click', function() {
  this.classList.toggle('on');
  controls.autoRotate = this.classList.contains('on');
});
document.getElementById('t-autofly').addEventListener('click', function() {
  this.classList.toggle('on');
  autoFly = this.classList.contains('on');
});
document.getElementById('t-figure8').addEventListener('click', function() {
  this.classList.toggle('on');
  figure8Mode = this.classList.contains('on');
  if (figure8Mode) {
    if (!autoFly) { autoFly = true; document.getElementById('t-autofly').classList.add('on'); }
  }
});
document.getElementById('t-wave').addEventListener('click', function() {
  this.classList.toggle('on');
  waveMode = this.classList.contains('on');
});
// ─── Filter/Sort Panel ───
document.getElementById('filter-toggle').addEventListener('click', () => {
  const panel = document.getElementById('filter-panel');
  panel.classList.toggle('open');
  document.getElementById('filter-toggle').setAttribute('aria-expanded', panel.classList.contains('open'));
});
document.getElementById('sort-col').addEventListener('change', (e) => {
  activeSortCol = e.target.value || null;
  rebuildViz();
});
document.getElementById('sort-dir').addEventListener('click', function() {
  activeSortDir = activeSortDir === 'asc' ? 'desc' : 'asc';
  this.textContent = activeSortDir.toUpperCase();
  this.classList.toggle('on', activeSortDir === 'asc');
  if (activeSortCol) rebuildViz();
});
document.getElementById('filter-clear').addEventListener('click', () => {
  activeFilters = {};
  activeSortCol = null;
  activeSortDir = 'asc';
  document.getElementById('sort-col').value = '';
  document.getElementById('sort-dir').textContent = 'ASC';
  document.getElementById('sort-dir').classList.add('on');
  document.querySelectorAll('#filter-list .fp-chip').forEach(c => c.classList.remove('on'));
  // Reset year dropdown to "All"
  const yearSelect = document.getElementById('year-select');
  if (yearSelect) {
    yearSelect.value = '';
  }
  rebuildViz();
});

// ─── Search Bar ───
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
let _searchDebounce = null;

const searchCount = document.getElementById('search-count');

function searchArtifacts(query) {
  if (!query || query.length < 2 || !masterData.length) {
    searchResults.classList.remove('open');
    searchResults.innerHTML = '';
    searchCount.textContent = '';
    searchCount.classList.remove('visible');
    searchInput.setAttribute('aria-expanded', 'false');
    return;
  }
  const q = query.toLowerCase();
  const matches = [];

  for (let i = 0; i < masterData.length; i++) {
    const row = masterData[i];
    let matched = false;
    let matchCol = '';
    for (const col of headers) {
      const val = (row[col] || '').toString();
      if (val.toLowerCase().includes(q)) {
        matched = true;
        matchCol = col;
        break;
      }
    }
    if (matched) matches.push({ row, index: i, matchCol });
  }

  // Update count badge in search bar
  searchCount.textContent = matches.length + ' found';
  searchCount.classList.add('visible');

  searchResults.innerHTML = '';
  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sr-empty';
    empty.textContent = 'No artifacts found';
    searchResults.appendChild(empty);
    searchCount.textContent = 'no matches';
    searchResults.classList.add('open');
    searchInput.setAttribute('aria-expanded', 'true');
    announce('No search results found');
    return;
  }

  const nameCol = findCol(headers, ['song','track','name','title']);
  const artistCol = findCol(headers, ['artist','band','performer']);
  const albumCol = findCol(headers, ['album']);

  matches.forEach(m => {
    const item = document.createElement('div');
    item.className = 'sr-item';

    const name = (nameCol && m.row[nameCol]) || '(untitled)';
    const artist = (artistCol && m.row[artistCol]) || '';
    const album = (albumCol && m.row[albumCol]) || '';
    const sub = [artist, album].filter(Boolean).join(' \u00b7 ');

    const nameDiv = document.createElement('div');
    nameDiv.className = 'sr-name';
    nameDiv.appendChild(highlightMatch(name, q));
    item.appendChild(nameDiv);
    if (sub) {
      const subDiv = document.createElement('div');
      subDiv.className = 'sr-sub';
      subDiv.appendChild(highlightMatch(sub, q));
      item.appendChild(subDiv);
    }

    item.addEventListener('click', () => {
      searchResults.classList.remove('open');
      pinArtifactByRow(m.row);
    });

    item.setAttribute('role', 'option');
    searchResults.appendChild(item);
  });

  const hint = document.createElement('div');
  hint.className = 'sr-hint';
  hint.textContent = matches.length + ' result' + (matches.length !== 1 ? 's' : '');
  searchResults.appendChild(hint);
  searchResults.classList.add('open');
  searchInput.setAttribute('aria-expanded', 'true');
  announce(matches.length + ' search result' + (matches.length !== 1 ? 's' : '') + ' found');
}

function highlightMatch(text, query) {
  // DOM-based approach to prevent XSS (Phase 2a)
  const container = document.createDocumentFragment();
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    container.appendChild(document.createTextNode(text));
  } else {
    if (idx > 0) container.appendChild(document.createTextNode(text.slice(0, idx)));
    const mark = document.createElement('span');
    mark.className = 'sr-match';
    mark.textContent = text.slice(idx, idx + query.length);
    container.appendChild(mark);
    if (idx + query.length < text.length) container.appendChild(document.createTextNode(text.slice(idx + query.length)));
  }
  return container;
}

function pinArtifactByRow(targetRow) {
  for (const g of instanceGroups) {
    for (let i = 0; i < g.data.length; i++) {
      const d = g.data[i];
      if (d.row === targetRow) {
        const gi = g.mesh.userData.groupIdx;
        if (pinnedInstance && pinnedInstance.groupIdx === gi && pinnedInstance.instanceId === i) return;
        unpinInstance();
        selectedCard = d;
        const pos = d.basePos.clone();
        pinnedInstance = { groupIdx: gi, instanceId: i, entry: d, originPos: pos, pinTime: clock.getElapsedTime(), settled: false };
        unpinning = null;

        const card = document.getElementById('album-card');
        const r = d.row;
        card.querySelector('.ac-name').textContent = r[d.nameCol] || '';
        const parts = [];
        if (d.artistCol && r[d.artistCol]) parts.push(r[d.artistCol]);
        if (d.albumCol && r[d.albumCol]) parts.push(r[d.albumCol]);
        if (d.yearCol && r[d.yearCol]) parts.push(r[d.yearCol]);
        card.querySelector('.ac-sub').textContent = parts.join(' \u00b7 ');
        const gc = colorMap[d.genreCol ? r[d.genreCol] : ''] || OTHER;
        const ge = card.querySelector('.ac-genre');
        ge.textContent = d.genreCol ? r[d.genreCol] : '';
        ge.style.background = gc + '22'; ge.style.color = gc;
        const artist = (d.artistCol && r[d.artistCol]) || '';
        const song = r[d.nameCol] || '';
        card.querySelector('.ac-yt').href = safeHref(buildYouTubeSearchUrl(song, artist));
        card.querySelector('.ac-spotify').href = safeHref(buildSpotifySearchUrl(song, artist));
        card.querySelector('.ac-apple').href = safeHref(buildAppleMusicSearchUrl(song, artist));
        card.querySelector('.ac-discogs').href = safeHref(buildDiscogsSearchUrl(song, artist));
            const heartBtn = card.querySelector('.ac-heart');
        heartBtn.classList.toggle('hearted', isHearted(d));
        heartBtn.classList.remove('jumping');
        card.classList.add('pinned');
        card.style.display = 'block';
        return;
      }
    }
  }
}

searchInput.addEventListener('input', () => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    const q = searchInput.value.trim();
    searchArtifacts(q);
    searchQuery = q;
    rebuildViz();
  }, 200);
});

searchInput.addEventListener('focus', () => {
  const q = searchInput.value.trim();
  if (q.length >= 2) {
    // Re-open existing results if they were just hidden
    if (searchResults.children.length > 0) {
      searchResults.classList.add('open');
    } else {
      searchArtifacts(q);
    }
  }
});

document.addEventListener('click', (e) => {
  const clickedOutsideSearch = !e.target.closest('#search-bar') && !e.target.closest('#search-results');
  if (clickedOutsideSearch) {
    searchResults.classList.remove('open');
    searchInput.setAttribute('aria-expanded', 'false');

    // Collapse mobile search bar when tapping outside
    const searchBar = document.getElementById('search-bar');
    const isExpanded = searchBar.classList.contains('expanded');
    if (isExpanded && isMobile()) {
      searchBar.classList.remove('expanded');
      searchInput.blur();
    }
  }
});

// ─── Mobile Search Toggle ───
const searchToggleBtn = document.getElementById('search-toggle');
searchToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const searchBar = document.getElementById('search-bar');
  const isExpanded = searchBar.classList.contains('expanded');
  if (isExpanded) {
    searchBar.classList.remove('expanded');
    searchInput.blur();
  } else {
    searchBar.classList.add('expanded');
    searchInput.focus();
  }
});

// ─── Mobile Menu ───
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');
const mobileBackdrop = document.getElementById('mobile-menu-backdrop');
const HAMBURGER_ICON = '\u2630';
const CLOSE_ICON = '\u2715';
const MENU_DISMISS_THRESHOLD = 100;
const BACKDROP_FADE_DISTANCE = 300;
const BACKDROP_TRANSITION_MS = 300;

if (mobileMenuBtn && mobileMenu) {
  let menuContentReparented = false;

  function openMobileMenu() {
    const alreadyOpen = mobileMenu.classList.contains('open');
    if (alreadyOpen) return;

    mobileMenu.classList.add('open');
    mobileMenuBtn.setAttribute('aria-expanded', 'true');
    mobileMenuBtn.textContent = CLOSE_ICON;
    mobileBackdrop.style.display = 'block';
    requestAnimationFrame(() => {
      mobileBackdrop.classList.add('visible');
    });

    if (!menuContentReparented) {
      populateMobileMenu();
      menuContentReparented = true;
    }
  }

  function closeMobileMenu() {
    const alreadyClosed = !mobileMenu.classList.contains('open');
    if (alreadyClosed) return;

    mobileMenu.classList.remove('open');
    mobileMenu.style.transform = '';
    mobileMenuBtn.setAttribute('aria-expanded', 'false');
    mobileMenuBtn.textContent = HAMBURGER_ICON;
    mobileBackdrop.classList.remove('visible');

    setTimeout(() => {
      mobileBackdrop.style.display = 'none';
    }, BACKDROP_TRANSITION_MS);

    if (menuContentReparented) {
      restoreDesktopPanels();
      menuContentReparented = false;
    }
  }

  // Toggle menu on hamburger tap
  mobileMenuBtn.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.contains('open');
    if (isOpen) {
      closeMobileMenu();
    } else {
      openMobileMenu();
    }
  });

  // Close button inside menu header
  const menuCloseBtn = mobileMenu.querySelector('.mm-close');
  menuCloseBtn.addEventListener('click', closeMobileMenu);

  // Backdrop tap to close
  mobileBackdrop.addEventListener('click', closeMobileMenu);

  // ─── Swipe-to-close on drag handle ───
  const menuDragHandle = mobileMenu.querySelector('.mm-handle');
  let dragStartY = 0;
  let dragDeltaY = 0;
  let dragging = false;

  function resetMenuDragState() {
    dragging = false;
    mobileMenu.style.transition = '';
    mobileBackdrop.style.opacity = '';
    mobileMenu.style.transform = 'translateY(0)';
  }

  menuDragHandle.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStartY = e.clientY;
    dragDeltaY = 0;
    mobileMenu.style.transition = 'none';
    menuDragHandle.setPointerCapture(e.pointerId);
  });

  menuDragHandle.addEventListener('pointermove', (e) => {
    if (!dragging) return;

    const rawDelta = e.clientY - dragStartY;
    dragDeltaY = Math.max(0, rawDelta);
    mobileMenu.style.transform = `translateY(${dragDeltaY}px)`;

    const backdropFade = Math.max(0, 1 - dragDeltaY / BACKDROP_FADE_DISTANCE);
    mobileBackdrop.style.opacity = backdropFade;
  });

  menuDragHandle.addEventListener('pointerup', () => {
    if (!dragging) return;

    dragging = false;
    mobileMenu.style.transition = '';
    mobileBackdrop.style.opacity = '';

    const swipedFarEnough = dragDeltaY > MENU_DISMISS_THRESHOLD;
    if (swipedFarEnough) {
      closeMobileMenu();
    } else {
      mobileMenu.style.transform = 'translateY(0)';
    }
  });

  menuDragHandle.addEventListener('pointercancel', resetMenuDragState);

  // ─── Tab switching ───
  const allTabs = mobileMenu.querySelectorAll('.mm-tab');
  const allPanels = mobileMenu.querySelectorAll('.mm-panel');

  allTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      allTabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      allPanels.forEach(p => {
        p.classList.remove('active');
      });

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      const targetPanelId = tab.dataset.panel;
      const targetPanel = document.getElementById(targetPanelId);
      targetPanel.classList.add('active');
    });
  });

  // ─── Reparent panel content between desktop and mobile ───
  function populateMobileMenu() {
    const mmCustomize = document.getElementById('mm-customize');
    const mmFilter = document.getElementById('mm-filter');
    if (!mmCustomize || !mmFilter) return;

    const ctrlPanel = document.getElementById('ctrl-panel');
    const filterPanel = document.getElementById('filter-panel');

    while (ctrlPanel.firstChild) {
      mmCustomize.appendChild(ctrlPanel.firstChild);
    }
    while (filterPanel.firstChild) {
      mmFilter.appendChild(filterPanel.firstChild);
    }
  }

  function restoreDesktopPanels() {
    const mmCustomize = document.getElementById('mm-customize');
    const mmFilter = document.getElementById('mm-filter');
    const ctrlPanel = document.getElementById('ctrl-panel');
    const filterPanel = document.getElementById('filter-panel');

    while (mmCustomize.firstChild) {
      ctrlPanel.appendChild(mmCustomize.firstChild);
    }
    while (mmFilter.firstChild) {
      filterPanel.appendChild(mmFilter.firstChild);
    }
  }
}

// ─── WebGL detection ───
function checkWebGL() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) {
    document.getElementById('loading').textContent = '/// WebGL not supported — please use a modern browser ///';
    return false;
  }
  return true;
}

if (checkWebGL()) { initScene(); animate(); loadDefaultLibrary(); }

// ─── Service Worker registration ───
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

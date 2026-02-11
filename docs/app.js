import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// --- DOM Elements ---
const $ = (id) => document.getElementById(id);
const fileEl = $("file");
const dropzone = $("dropzone");
const btnEl = $("btn");
const statusEl = $("status");
const outnameEl = $("outname");
const innameEl = $("inname");
const canvas2d = $("preview2d"); // index.htmlの2D用canvas
const ctx2d = canvas2d ? canvas2d.getContext("2d") : null;

// 3D/Loading要素（HTMLに後述の追加が必要）
const loadingEl = $("loading");
const container = $("preview3d");

// --- State ---
let loadedImage = null;
let loadedName = "image";
let scene, camera, renderer, controls, currentMesh;
let updateTimer = null;

// --- 3D Scene Setup ---
function init3D() {
    if (!container) return; // コンテナがない場合はスキップ

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 150);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(50, 50, 100);
    scene.add(dirLight);

    animate();
}

function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer) renderer.render(scene, camera);
}

// Window resize
window.addEventListener('resize', () => {
    if (!camera || !renderer || !container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
});

// 初期化実行
init3D();

// --- Event Listeners ---
function setStatus(s) { statusEl.textContent = s; }

fileEl.addEventListener("change", async () => {
    const f = fileEl.files?.[0];
    if (f) await handleFile(f);
});

// Drag & Drop
["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.style.borderColor = "#3b82f6"; });
});
["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.style.borderColor = "#888"; });
});
dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f?.type.startsWith("image/")) await handleFile(f);
});

// 設定変更時にプレビューを更新 (Debounce)
const inputIds = ["widthPx", "baseMm", "reliefMm", "blackCut", "whiteCut", "toneGamma", "mapInvert", "flipX", "flipY", "rot180"];
inputIds.forEach(id => {
    $(id).addEventListener("change", () => {
        if (!loadedImage) return;
        if (updateTimer) clearTimeout(updateTimer);
        updateTimer = setTimeout(updatePreviews, 400);
    });
});

// rot180 は flipX+flipY のマクロとして扱う
// - チェックON  : flipX/flipY もON
// - チェックOFF : flipX/flipY もOFF（要求仕様）
$("rot180").addEventListener("change", () => {
    const on = $("rot180").checked;
    $("flipX").checked = on;
    $("flipY").checked = on;
});

// Download STL
btnEl.addEventListener("click", async () => {
    if (!loadedImage) return;
    btnEl.disabled = true;
    try {
        setStatus("Generating binary STL...");
        const params = getParams();
        const { thickness, pxMm, H, W } = await computeThicknessMap(loadedImage, params);
        const stlBytes = buildBinarySTL(thickness, pxMm, W, H);
        const blob = new Blob([stlBytes], { type: "application/octet-stream" });
        downloadBlob(blob, `${loadedName}_W${params.widthMm}mm.stl`);
        setStatus("Download started.");
    } catch (e) {
        setStatus("Error: " + e.message);
    } finally {
        btnEl.disabled = false;
    }
});

// --- Core Logic ---

async function handleFile(f) {
    loadedName = f.name.replace(/\.[^.]+$/, "");
    if (innameEl) innameEl.textContent = `Input: ${f.name}`;
    try {
        const url = URL.createObjectURL(f);
        loadedImage = await new Promise((res) => {
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); res(img); };
            img.src = url;
        });
        btnEl.disabled = false;
        setStatus("Image loaded.");
        updatePreviews();
    } catch (e) {
        setStatus("Load failed.");
    }
}

async function updatePreviews() {
    if (!loadedImage) return;
    if (loadingEl) loadingEl.style.opacity = "1";
    setStatus("Updating...");

    await new Promise(r => requestAnimationFrame(r)); // UI描画を待機

    const params = getParams();
    const { thickness, pxMm, H, W } = await computeThicknessMap(loadedImage, params);

    // 1. 2Dプレビュー描画 (canvas)
    draw2D(thickness, W, H, params);

    // 2. 3Dプレビュー更新 (Three.js)
    const stlBytes = buildBinarySTL(thickness, pxMm, W, H);
    const blob = new Blob([stlBytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    new STLLoader().load(url, (geometry) => {
        if (currentMesh) {
            scene.remove(currentMesh);
            currentMesh.geometry.dispose();
            currentMesh.material.dispose();
        }
        geometry.center();
        geometry.computeVertexNormals();
        currentMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
        scene.add(currentMesh);
        URL.revokeObjectURL(url);
        if (loadingEl) loadingEl.style.opacity = "0";
        setStatus("Ready.");
        if (outnameEl) {
            outnameEl.textContent = `Target: ${loadedName}_W${params.widthMm}mm.stl`;
        }
    });
}

function draw2D(thickness, W, H, p) {
    if (!ctx2d) return;
    canvas2d.width = W;
    canvas2d.height = H;
    const imgData = ctx2d.createImageData(W, H);
    const data = imgData.data;
    for (let i = 0; i < thickness.length; i++) {
        // 最小厚さを0、最大厚さを255としてグレースケール表示
        const val = ((thickness[i] - p.baseMm) / p.reliefMm) * 255;
        const idx = i * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = val;
        data[idx + 3] = 255;
    }
    ctx2d.putImageData(imgData, 0, 0);
}

function getParams() {
    let flipX = $("flipX").checked;
    let flipY = $("flipY").checked;
    if ($("rot180").checked) { flipX = true; flipY = true; }
    return {
        widthMm: parseFloat($("widthMm").value) || 100,
        widthPx: Math.max(10, parseInt($("widthPx").value) || 400),
        baseMm: parseFloat($("baseMm").value) || 0.8,
        reliefMm: parseFloat($("reliefMm").value) || 2.0,
        blackCut: parseFloat($("blackCut").value) || 0,
        whiteCut: parseFloat($("whiteCut").value) || 1,
        toneGamma: parseFloat($("toneGamma").value) || 1.0,
        mapInvert: $("mapInvert").checked,
        flipX, flipY
    };
}

async function computeThicknessMap(img, p) {
    const W = p.widthPx;
    const H = Math.round(img.height * (W / img.width));
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const octx = off.getContext("2d");
    octx.drawImage(img, 0, 0, W, H);
    const { data } = octx.getImageData(0, 0, W, H);

    const thickness = new Float32Array(W * H);
    const pxMm = p.widthMm / W;
    const invRange = 1 / Math.max(1e-9, (p.whiteCut - p.blackCut));

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
            // Luminance
            let Y = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
            Y = Math.max(0, Math.min(1, (Y - p.blackCut) * invRange));
            if (p.toneGamma !== 1) Y = Math.pow(Y, 1 / p.toneGamma);

            const v = p.mapInvert ? (1.0 - Y) : Y;
            const t = p.baseMm + p.reliefMm * v;

            let ox = x, oy = y;
            if (p.flipX) ox = (W - 1 - x);
            if (p.flipY) oy = (H - 1 - y);
            thickness[oy * W + ox] = t;
        }
    }
    return { thickness, pxMm, W, H };
}

function srgbToLinear(u) {
    return (u <= 0.04045) ? (u / 12.92) : Math.pow((u + 0.055) / 1.055, 2.4);
}

function buildBinarySTL(thickness, pxMm, W, H) {
    const vx = (x) => x * pxMm;
    const vy = (y) => (H - 1 - y) * pxMm;
    const vz = (x, y) => thickness[y * W + x];

    const triCount = (W - 1) * (H - 1) * 4 + (W - 1) * 4 + (H - 1) * 4; // 大まかな計算
    const buf = new ArrayBuffer(84 + 50 * (W - 1) * (H - 1) * 12); // 十分なバッファ
    const view = new DataView(buf);
    view.setUint32(80, 0, true); // 後で書き換える

    let off = 84, count = 0;
    const writeTri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
        off += 12; // Skip normal
        view.setFloat32(off, ax, true); view.setFloat32(off + 4, ay, true); view.setFloat32(off + 8, az, true);
        view.setFloat32(off + 12, bx, true); view.setFloat32(off + 16, by, true); view.setFloat32(off + 20, bz, true);
        view.setFloat32(off + 24, cx, true); view.setFloat32(off + 28, cy, true); view.setFloat32(off + 32, cz, true);
        off += 38; count++;
    };

    for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
            // Top
            writeTri(vx(x), vy(y), vz(x, y), vx(x), vy(y + 1), vz(x, y + 1), vx(x + 1), vy(y), vz(x + 1, y));
            writeTri(vx(x + 1), vy(y), vz(x + 1, y), vx(x), vy(y + 1), vz(x, y + 1), vx(x + 1), vy(y + 1), vz(x + 1, y + 1));
            // Bottom
            writeTri(vx(x), vy(y), 0, vx(x + 1), vy(y), 0, vx(x), vy(y + 1), 0);
            writeTri(vx(x + 1), vy(y), 0, vx(x + 1), vy(y + 1), 0, vx(x), vy(y + 1), 0);
        }
    }
    // Sides
    for (let x = 0; x < W - 1; x++) {
        writeTri(vx(x), vy(0), vz(x, 0), vx(x + 1), vy(0), vz(x + 1, 0), vx(x), vy(0), 0);
        writeTri(vx(x + 1), vy(0), vz(x + 1, 0), vx(x + 1), vy(0), 0, vx(x), vy(0), 0);
        writeTri(vx(x), vy(H - 1), vz(x, H - 1), vx(x), vy(H - 1), 0, vx(x + 1), vy(H - 1), vz(x + 1, H - 1));
        writeTri(vx(x + 1), vy(H - 1), vz(x + 1, H - 1), vx(x), vy(H - 1), 0, vx(x + 1), vy(H - 1), 0);
    }
    for (let y = 0; y < H - 1; y++) {
        writeTri(vx(0), vy(y), vz(0, y), vx(0), vy(y), 0, vx(0), vy(y + 1), vz(0, y + 1));
        writeTri(vx(0), vy(y + 1), vz(0, y + 1), vx(0), vy(y), 0, vx(0), vy(y + 1), 0);
        writeTri(vx(W - 1), vy(y), vz(W - 1, y), vx(W - 1), vy(y + 1), vz(W - 1, y + 1), vx(W - 1), vy(y), 0);
        writeTri(vx(W - 1), vy(y + 1), vz(W - 1, y + 1), vx(W - 1), vy(y + 1), 0, vx(W - 1), vy(y), 0);
    }

    view.setUint32(80, count, true);
    return buf.slice(0, off);
}

function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
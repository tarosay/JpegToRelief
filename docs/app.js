const $ = (id) => document.getElementById(id);

const fileEl = $("file");
const dropzone = $("dropzone");
const btnEl = $("btn");
const statusEl = $("status");
const outnameEl = $("outname");
const canvas = $("preview");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

let loadedImage = null;
let loadedName = "image";

function setStatus(s) { statusEl.textContent = s; }

fileEl.addEventListener("change", async () => {
    const f = fileEl.files?.[0];
    if (!f) return;
    await setImageFile(f);
});

// Drag & Drop
["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.style.borderColor = "#111";
    });
});

["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.style.borderColor = "#888";
    });
});

dropzone.addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
        setStatus("Not an image file.");
        return;
    }
    await setImageFile(f);
});


$("rot180").addEventListener("change", () => {
    if ($("rot180").checked) { $("flipX").checked = true; $("flipY").checked = true; }
});

["widthPx", "blackCut", "whiteCut", "toneGamma", "mapInvert", "flipX", "flipY", "rot180"].forEach(id => {
    $(id).addEventListener("change", () => loadedImage && renderPreview());
});

btnEl.addEventListener("click", async () => {
    if (!loadedImage) return;
    btnEl.disabled = true;
    try {
        setStatus("Generating...");
        const params = getParams();
        const { thickness, pxMm, H, W } = await computeThicknessMap(loadedImage, params);

        // STL生成（Binary STL）
        const stlBytes = buildBinarySTL(thickness, pxMm, W, H);
        const blob = new Blob([stlBytes], { type: "application/octet-stream" });

        const outBase = `${loadedName}_W${params.widthMm}mm`;
        const outFile = `${outBase}.stl`;
        outnameEl.textContent = `Output: ${outFile}`;

        downloadBlob(blob, outFile);
        setStatus("Done.");
    } catch (e) {
        console.error(e);
        setStatus("ERROR: " + (e?.message ?? String(e)));
    } finally {
        btnEl.disabled = false;
    }
});

function getParams() {
    let flipX = $("flipX").checked;
    let flipY = $("flipY").checked;
    const rot180 = $("rot180").checked;
    if (rot180) { flipX = true; flipY = true; }

    return {
        widthMm: numberVal("widthMm", 100),
        widthPx: Math.max(10, Math.floor(numberVal("widthPx", 600))),
        baseMm: numberVal("baseMm", 0.8),
        reliefMm: numberVal("reliefMm", 1.5),
        blackCut: numberVal("blackCut", 0.02),
        whiteCut: numberVal("whiteCut", 0.98),
        toneGamma: numberVal("toneGamma", 1.15),
        mapInvert: $("mapInvert")?.checked ?? true,
        flipX, flipY,
    };
}
function numberVal(id, def) {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : def;
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (e) => reject(e);
        img.src = url;
    });
}

async function renderPreview() {
    const params = getParams();
    const { thickness, W, H } = await computeThicknessMap(loadedImage, params);

    // 正規化して8bitで表示（プレビュー用）
    let tmin = Infinity, tmax = -Infinity;
    for (let i = 0; i < thickness.length; i++) {
        const t = thickness[i];
        if (t < tmin) tmin = t;
        if (t > tmax) tmax = t;
    }
    const scale = 1 / Math.max(1e-9, (tmax - tmin));

    // preview canvas size keep aspect
    const maxW = 600;
    const pw = maxW;
    const ph = Math.round(H * (pw / W));
    canvas.width = pw;
    canvas.height = ph;

    const imgData = ctx.createImageData(pw, ph);
    // nearest for preview
    for (let y = 0; y < ph; y++) {
        const sy = Math.min(H - 1, Math.floor(y * (H / ph)));
        for (let x = 0; x < pw; x++) {
            const sx = Math.min(W - 1, Math.floor(x * (W / pw)));
            const t = thickness[sy * W + sx];
            const n = (t - tmin) * scale;
            const g = Math.max(0, Math.min(255, Math.round(n * 255)));
            const o = (y * pw + x) * 4;
            imgData.data[o + 0] = g;
            imgData.data[o + 1] = g;
            imgData.data[o + 2] = g;
            imgData.data[o + 3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);

    const outBase = `${loadedName}_W${params.widthMm}mm`;
    outnameEl.textContent = `Output: ${outBase}.stl`;
}

async function computeThicknessMap(img, p) {
    // draw resized image to offscreen canvas
    const W = p.widthPx;
    const H = Math.max(1, Math.round(img.height * (W / img.width)));

    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.drawImage(img, 0, 0, W, H);
    const { data } = octx.getImageData(0, 0, W, H);

    const thickness = new Float32Array(W * H);

    const blackCut = p.blackCut;
    const whiteCut = p.whiteCut;
    const invRange = 1 / Math.max(1e-9, (whiteCut - blackCut));
    const toneGamma = p.toneGamma;

    // pixel size in mm
    const pxMm = p.widthMm / W;

    // For each pixel: sRGB->linear, luminance Y, tone, thickness
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const sr = data[i] / 255;
            const sg = data[i + 1] / 255;
            const sb = data[i + 2] / 255;

            const lr = srgbToLinear(sr);
            const lg = srgbToLinear(sg);
            const lb = srgbToLinear(sb);

            // luminance (Rec.709)
            let Y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;

            // clip normalize
            Y = Math.max(0, Math.min(1, (Y - blackCut) * invRange));

            // tone curve (1.0 = linear)
            if (Math.abs(toneGamma - 1.0) > 1e-9) {
                Y = Math.pow(Y, 1.0 / toneGamma);
            }

            const v = (p.mapInvert ?? true) ? (1.0 - Y) : Y;
            let t = p.baseMm + p.reliefMm * v;

            // apply orientation in array domain so PNG/STL consistency is guaranteed
            let ox = x, oy = y;
            if (p.flipX) ox = (W - 1 - ox);
            if (p.flipY) oy = (H - 1 - oy);

            thickness[oy * W + ox] = t;
        }
    }

    return { thickness, pxMm, W, H };
}

function srgbToLinear(u) {
    return (u <= 0.04045) ? (u / 12.92) : Math.pow((u + 0.055) / 1.055, 2.4);
}

function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Build Binary STL for a solid surface:
 * - top surface: z = thickness
 * - bottom: z = 0
 * - side walls around perimeter
 *
 * Note: normals are set to (0,0,0) (allowed). Most slicers recompute normals.
 */
function buildBinarySTL(thickness, pxMm, W, H) {
    // helper: vertex at grid
    const vx = (x) => (W - 1 - x) * pxMm;
    const vy = (y) => y * pxMm;
    const vzTop = (x, y) => thickness[y * W + x];

    // Count triangles:
    // top: (W-1)*(H-1)*2
    // bottom: same
    // sides: perimeter quads *2
    const topTris = (W - 1) * (H - 1) * 2;
    const bottomTris = topTris;
    const sideTris = ((W - 1) * 2 + (H - 1) * 2) * 2;
    const triCount = topTris + bottomTris + sideTris;

    const header = new Uint8Array(80); // zeros
    const buf = new ArrayBuffer(84 + triCount * 50);
    const view = new DataView(buf);

    // header
    new Uint8Array(buf, 0, 80).set(header);
    view.setUint32(80, triCount, true);

    let off = 84;

    function writeTri(ax, ay, az, bx, by, bz, cx, cy, cz) {
        // normal (0,0,0)
        view.setFloat32(off + 0, 0, true);
        view.setFloat32(off + 4, 0, true);
        view.setFloat32(off + 8, 0, true);

        view.setFloat32(off + 12, ax, true);
        view.setFloat32(off + 16, ay, true);
        view.setFloat32(off + 20, az, true);

        view.setFloat32(off + 24, bx, true);
        view.setFloat32(off + 28, by, true);
        view.setFloat32(off + 32, bz, true);

        view.setFloat32(off + 36, cx, true);
        view.setFloat32(off + 40, cy, true);
        view.setFloat32(off + 44, cz, true);

        view.setUint16(off + 48, 0, true); // attribute
        off += 50;
    }

    // Top surface
    for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
            const a = [vx(x), vy(y), vzTop(x, y)];
            const b = [vx(x + 1), vy(y), vzTop(x + 1, y)];
            const c = [vx(x), vy(y + 1), vzTop(x, y + 1)];
            const d = [vx(x + 1), vy(y + 1), vzTop(x + 1, y + 1)];
            // (a,c,b) and (b,c,d) same as Python版
            writeTri(...a, ...c, ...b);
            writeTri(...b, ...c, ...d);
        }
    }

    // Bottom surface (reverse)
    for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
            const a = [vx(x), vy(y), 0];
            const b = [vx(x + 1), vy(y), 0];
            const c = [vx(x), vy(y + 1), 0];
            const d = [vx(x + 1), vy(y + 1), 0];
            // (a,b,c) and (b,d,c)
            writeTri(...a, ...b, ...c);
            writeTri(...b, ...d, ...c);
        }
    }

    // Side walls: top edge y=0
    for (let x = 0; x < W - 1; x++) {
        const aT = [vx(x), vy(0), vzTop(x, 0)];
        const bT = [vx(x + 1), vy(0), vzTop(x + 1, 0)];
        const aB = [vx(x), vy(0), 0];
        const bB = [vx(x + 1), vy(0), 0];
        writeTri(...aT, ...bT, ...aB);
        writeTri(...bT, ...bB, ...aB);
    }
    // bottom edge y=H-1
    for (let x = 0; x < W - 1; x++) {
        const aT = [vx(x), vy(H - 1), vzTop(x, H - 1)];
        const bT = [vx(x + 1), vy(H - 1), vzTop(x + 1, H - 1)];
        const aB = [vx(x), vy(H - 1), 0];
        const bB = [vx(x + 1), vy(H - 1), 0];
        // mirror of Python winding used earlier:
        writeTri(...bT, ...aT, ...aB);
        writeTri(...aB, ...bB, ...bT);
    }
    // left edge x=0
    for (let y = 0; y < H - 1; y++) {
        const aT = [vx(0), vy(y), vzTop(0, y)];
        const bT = [vx(0), vy(y + 1), vzTop(0, y + 1)];
        const aB = [vx(0), vy(y), 0];
        const bB = [vx(0), vy(y + 1), 0];
        writeTri(...bT, ...aT, ...aB);
        writeTri(...aB, ...bB, ...bT);
    }
    // right edge x=W-1
    for (let y = 0; y < H - 1; y++) {
        const aT = [vx(W - 1), vy(y), vzTop(W - 1, y)];
        const bT = [vx(W - 1), vy(y + 1), vzTop(W - 1, y + 1)];
        const aB = [vx(W - 1), vy(y), 0];
        const bB = [vx(W - 1), vy(y + 1), 0];
        writeTri(...aT, ...bT, ...aB);
        writeTri(...bT, ...bB, ...aB);
    }

    return buf;
}
async function setImageFile(f) {
    loadedName = f.name.replace(/\.[^.]+$/, "");
    loadedImage = await loadImageFromFile(f);
    btnEl.disabled = false;
    setStatus("Image loaded.");
    await renderPreview();
}

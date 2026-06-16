/**
 * Generates assets/icon.ico with 16, 32, 48, and 256-pixel sizes.
 * Run via: node scripts/build-icon.js  (or automatically via prebuild)
 */
const fs   = require('fs');
const path = require('path');
const { createCirclePng } = require('../src/main/icon-generator');

// G2G Automation brand color — vivid blue
const [R, G, B] = [37, 99, 235]; // #2563eb
const SIZES = [16, 32, 48, 256];

// ── ICO builder ───────────────────────────────────────────────────────────────
// ICO files can embed raw PNG blobs (Windows Vista+).

function buildIco(pngBuffers, sizes) {
    const count      = pngBuffers.length;
    const headerSize = 6;
    const entrySize  = 16;
    const dirSize    = headerSize + count * entrySize;

    // Calculate data offsets
    let offset = dirSize;
    const offsets = pngBuffers.map((buf) => { const o = offset; offset += buf.length; return o; });

    const parts = [];

    // ── ICO header ──────────────────────────────────────────────────────────
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: 1 = icon
    header.writeUInt16LE(count, 4);
    parts.push(header);

    // ── Directory entries ────────────────────────────────────────────────────
    for (let i = 0; i < count; i++) {
        const entry = Buffer.alloc(16);
        const sz = sizes[i];
        entry[0] = sz >= 256 ? 0 : sz;  // 0 means 256 in ICO spec
        entry[1] = sz >= 256 ? 0 : sz;
        entry[2] = 0;                    // color count (0 = use bit depth)
        entry[3] = 0;                    // reserved
        entry.writeUInt16LE(1, 4);       // color planes
        entry.writeUInt16LE(32, 6);      // bits per pixel (RGBA)
        entry.writeUInt32LE(pngBuffers[i].length, 8);
        entry.writeUInt32LE(offsets[i], 12);
        parts.push(entry);
    }

    // ── PNG payloads ─────────────────────────────────────────────────────────
    parts.push(...pngBuffers);

    return Buffer.concat(parts);
}

// ── Generate & write ──────────────────────────────────────────────────────────

const pngs   = SIZES.map((s) => createCirclePng(R, G, B, s));
const icoOut = path.join(__dirname, '../assets/icon.ico');

fs.writeFileSync(icoOut, buildIco(pngs, SIZES));

const kb = (fs.statSync(icoOut).size / 1024).toFixed(1);
console.log(`✅  Icon written → assets/icon.ico  (${kb} KB, sizes: ${SIZES.join(', ')}px)`);

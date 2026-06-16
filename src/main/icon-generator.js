/**
 * Generates minimal 16x16 RGBA PNG buffers in pure Node.js (no extra deps).
 * Used to produce system-tray status icons at runtime.
 */
const zlib = require('zlib');

// ── CRC-32 table (used by PNG chunk format) ───────────────────────────────────

const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
    const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf  = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ── PNG builder ───────────────────────────────────────────────────────────────

function buildPng(width, height, pixelFn) {
    const rows = [];
    for (let y = 0; y < height; y++) {
        const row = Buffer.alloc(1 + width * 4);
        row[0] = 0; // filter: None
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = pixelFn(x, y, width, height);
            const i = 1 + x * 4;
            row[i] = r; row[i + 1] = g; row[i + 2] = b; row[i + 3] = a;
        }
        rows.push(row);
    }

    const rawData   = Buffer.concat(rows);
    const compressed = zlib.deflateSync(rawData, { level: 9 });

    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width,  0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 6; // color type: RGBA

    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
        pngChunk('IHDR', ihdrData),
        pngChunk('IDAT', compressed),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates a 16x16 PNG buffer with a solid anti-aliased circle.
 * @param {number} r Red   (0–255)
 * @param {number} g Green (0–255)
 * @param {number} b Blue  (0–255)
 * @param {number} size Canvas size in pixels (default 16)
 */
function createCirclePng(r, g, b, size = 16) {
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 1.5;

    return buildPng(size, size, (px, py) => {
        const dx = px - cx + 0.5;
        const dy = py - cy + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Anti-aliased edge: smooth alpha between radius-0.5 and radius+0.5
        const alpha = Math.max(0, Math.min(1, radius + 0.5 - dist));
        return [r, g, b, Math.round(alpha * 255)];
    });
}

// Pre-built status icon buffers
const STATUS_ICONS = {
    idle:     createCirclePng(100, 116, 139), // slate-500
    running:  createCirclePng(245, 158,  11), // amber-400
    watching: createCirclePng( 34, 197,  94), // green-500
    error:    createCirclePng(239,  68,  68), // red-500
};

module.exports = { createCirclePng, STATUS_ICONS };

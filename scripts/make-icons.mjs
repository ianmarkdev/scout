// Draws the extension icons (a rounded square with a white bookmark/clip shape) as PNGs,
// using only Node built-ins. Run: npm run icons
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ACCENT = [59, 79, 216];

function crc32(buffer) {
    let crc = ~0;

    for (const byte of buffer) {
        crc ^= byte;
        for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }

    return ~crc >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));

    return Buffer.concat([length, body, crc]);
}

/** Coverage (0..1) of pixel (x, y) by the icon shape, 4×4 supersampled. */
function pixel(size, x, y) {
    let bg = 0;
    let fg = 0;

    for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
            const u = (x + (sx + 0.5) / 4) / size;
            const v = (y + (sy + 0.5) / 4) / size;
            const r = 0.22;
            const dx = Math.max(r - u, 0, u - (1 - r));
            const dy = Math.max(r - v, 0, v - (1 - r));

            if (dx * dx + dy * dy > r * r) continue;

            bg++;

            // Bookmark: a rectangle with a V notch cut from the bottom.
            const inRect = u >= 0.32 && u <= 0.68 && v >= 0.2 && v <= 0.8;
            const notch = v > 0.8 - (0.18 - Math.abs(u - 0.5) * 0.5) && v <= 0.8;

            if (inRect && !notch) fg++;
        }
    }

    return [bg / 16, fg / 16];
}

function png(size) {
    const rows = [];

    for (let y = 0; y < size; y++) {
        const row = Buffer.alloc(1 + size * 4);

        for (let x = 0; x < size; x++) {
            const [bg, fg] = pixel(size, x, y);
            const mix = bg === 0 ? 0 : fg / bg;
            const offset = 1 + x * 4;

            for (let c = 0; c < 3; c++) row[offset + c] = Math.round(ACCENT[c] * (1 - mix) + 255 * mix);
            row[offset + 3] = Math.round(bg * 255);
        }

        rows.push(row);
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(rows))),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

for (const size of [16, 32, 48, 128]) {
    writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size));
}

console.log('Icons written to icons/.');

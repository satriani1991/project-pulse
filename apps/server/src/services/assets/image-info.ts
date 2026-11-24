import fs from 'node:fs';
import type { AssetType } from '@pulse/shared';
import { AUDIO_EXT, FONT_EXT, IMAGE_EXT, MODEL_EXT, VIDEO_EXT } from '@pulse/shared';

/** Read image dimensions from file headers (PNG, GIF, JPEG, WEBP, BMP, SVG) without native dependencies. */
export function imageSize(file: string): { width: number; height: number } | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return parseImageSize(buf.subarray(0, n));
  } catch { return undefined; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function parseImageSize(b: Buffer): { width: number; height: number } | undefined {
  if (b.length < 24) return svgSize(b);
  // PNG
  if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // GIF
  if (b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  // BMP
  if (b.toString('ascii', 0, 2) === 'BM') return { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) };
  // WEBP
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  }
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return undefined;
  }
  return svgSize(b);
}

function svgSize(b: Buffer) {
  const s = b.toString('utf8', 0, Math.min(b.length, 4096));
  if (!/<svg[\s>]/i.test(s)) return undefined;
  const tag = /<svg[^>]*>/i.exec(s)?.[0] ?? '';
  const num = (attr: string) => { const m = new RegExp(`\\s${attr}=["']([\\d.]+)(px)?["']`, 'i').exec(tag); return m ? Math.round(parseFloat(m[1])) : undefined; };
  const w = num('width'), h = num('height');
  if (w && h) return { width: w, height: h };
  const vb = /viewBox=["']([\d.\s,-]+)["']/i.exec(tag)?.[1].trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4) return { width: Math.round(vb[2]), height: Math.round(vb[3]) };
  return undefined;
}

const SCRIPT_EXT = ['js', 'mjs', 'ts', 'tsx', 'jsx', 'glsl', 'frag', 'vert', 'wgsl'];

/** Classify an asset by extension and conventional folder / file names. */
export function assetType(rel: string, ext: string): AssetType | undefined {
  const lower = rel.toLowerCase();
  const inDir = (re: RegExp) => re.test('/' + lower);
  if (IMAGE_EXT.includes(ext)) {
    if (inDir(/\/(vfx|fx|particles?|effects?)\//)) return 'vfx';
    if (ext === 'gif' || inDir(/\/(anim(ation)?s?|sprites?|spritesheets?|sheets?)\//) || /(sprite|sheet|anim|_strip|frames?)[^/]*$/.test(lower)) return 'animation';
    return 'image';
  }
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return inDir(/\/(vfx|fx|effects?)\//) ? 'vfx' : 'video';
  if (MODEL_EXT.includes(ext)) return 'model';
  if (FONT_EXT.includes(ext)) return 'font';
  if (['atlas', 'plist'].includes(ext)) return 'animation';
  if (SCRIPT_EXT.includes(ext)) return 'script';
  return undefined;
}

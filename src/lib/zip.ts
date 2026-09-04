/**
 * Minimal zip reader/writer for skill bundles, browser-only (uses
 * TextEncoder/Decoder and DecompressionStream). Written archives use the
 * "store" method (no compression): skills are a handful of small text files.
 */
import type { SkillFile } from "./types";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n: number) => [n & 255, (n >>> 8) & 255];
const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** Build a zip Blob from named text entries (names may include folders). */
export function zipBlob(entries: { name: string; content: string }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

  for (const { name, content } of entries) {
    const nameB = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...nameB,
    ]);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameB,
      ]),
    );
    parts.push(local, data);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ]);
  return new Blob([...parts, ...central, end] as BlobPart[], { type: "application/zip" });
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  void w.write(bytes as BufferSource);
  void w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/**
 * Read text files out of a zip. Skips folders, __MACOSX and .DS_Store. If
 * every entry sits inside one top-level folder, that folder is stripped.
 */
export async function unzip(buf: ArrayBuffer): Promise<SkillFile[]> {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  const dec = new TextDecoder();
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out: SkillFile[] = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = dec.decode(b.subarray(off + 46, off + 46 + nlen));
    off += 46 + nlen + elen + clen;
    if (name.endsWith("/") || name.startsWith("__MACOSX") || /(^|\/)\.DS_Store$/.test(name)) continue;
    const lnlen = dv.getUint16(lho + 26, true);
    const lelen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lelen;
    let data: Uint8Array = b.subarray(start, start + csize);
    if (method === 8) data = await inflateRaw(data);
    else if (method !== 0) continue;
    out.push({ name, content: dec.decode(data) });
  }
  const roots = new Set(out.map((f) => f.name.split("/")[0]));
  const strip = roots.size === 1 && out.every((f) => f.name.includes("/"));
  return out.map((f) => ({
    name: strip ? f.name.slice(f.name.indexOf("/") + 1) : f.name,
    content: f.content,
  }));
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

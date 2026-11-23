/**
 * Zabalí dist/ do release/hemitube-<verze>.zip (verze z dist/manifest.json).
 * Vlastní ZIP zapisovač (deflate přes node:zlib) → žádná další závislost, funguje na všech OS.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { verifyDist } from './verify-dist.mjs';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const RELEASE = join(ROOT, 'release');

function listFiles(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

/** Datum a čas ve formátu MS-DOS (pevně daný kvůli reprodukovatelnému buildu). */
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

export function createZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const crc = crc32(data) >>> 0;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // verze potřebná k rozbalení
    header.writeUInt16LE(0x0800, 6); // UTF-8 názvy
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, nameBuffer, body);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(useDeflate ? 8 : 0, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBuffer.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBuffer);

    offset += header.length + nameBuffer.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('dist/ neexistuje – nejdřív spusť npm run build.');
  process.exit(1);
}
const problems = verifyDist(DIST);
if (problems.length > 0) {
  console.error(`dist/ neprošel kontrolou:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const entries = listFiles(DIST).map((path) => ({ name: relative(DIST, path).split(sep).join('/'), data: readFileSync(path) }));
mkdirSync(RELEASE, { recursive: true });
const target = join(RELEASE, `hemitube-${version}.zip`);
writeFileSync(target, createZip(entries));
console.log(`${relative(ROOT, target)} (${entries.length} souborů, ${(statSync(target).size / 1024).toFixed(1)} kB)`);

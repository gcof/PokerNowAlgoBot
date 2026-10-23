/* Deterministic ZIP, built only from an explicit runtime allowlist. No dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const runtime = ['manifest.json', 'config.js', 'core.js', 'strategy.js', 'adapter.js', 'safety.js', 'bot.js'];
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data), packed = zlib.deflateRawSync(data);
    const crc = crc32(data), header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, packed);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); offset += header.length + name.length + packed.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
function build(outDir = path.join(root, 'dist')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const textFile = filename => Buffer.from(fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n'));
  const entries = runtime.map(name => ({ name, data: textFile(path.join(root, 'extension', name)) }));
  for (const name of ['LICENSE', 'README.md', 'README.ru.md']) entries.push({ name, data: textFile(path.join(root, name)) });
  const filename = `pokernow-algo-bot-v${pkg.version}.zip`, bytes = zip(entries);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, filename), bytes);
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), `${hash}  ${filename}\n`);
  return { filename, sha256: hash, bytes: bytes.length, files: entries.map(e => e.name) };
}
if (require.main === module) console.log(JSON.stringify(build(), null, 2));
module.exports = { build, zip, crc32, runtime };

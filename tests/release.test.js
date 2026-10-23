const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { build, crc32, runtime } = require('../scripts/build.js');
test('ZIP build is repeatable, hashed and limited to public runtime/docs', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pokernow-release-'));
  try {
    const first = build(out), bytes = fs.readFileSync(path.join(out, first.filename)), second = build(out);
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(fs.readFileSync(path.join(out, 'SHA256SUMS'), 'utf8'), `${first.sha256}  ${first.filename}\n`);
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
    assert.deepEqual(first.files, [...runtime, 'LICENSE', 'README.md', 'README.ru.md']);
    assert.equal(first.files.some(f => /png|test|\.git|local/i.test(f)), false);
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  } finally {
    const resolved = path.resolve(out), temp = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temp)) throw new Error('Refusing cleanup outside temp');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

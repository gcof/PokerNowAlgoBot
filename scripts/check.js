const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json'), manifest = require('../extension/manifest.json');
const { runtime } = require('./build.js');
function assert(ok, message) { if (!ok) throw new Error(message); }
assert(/^\d+\.\d+\.\d+$/.test(pkg.version) && pkg.version === manifest.version, 'Release and manifest versions must match');
assert(JSON.stringify(manifest.permissions) === '["storage"]', 'Unexpected extension permissions');
assert(manifest.content_scripts[0].js.every(name => runtime.includes(name)), 'Runtime file missing from ZIP allowlist');
assert(JSON.stringify(manifest.content_scripts[0].js) === JSON.stringify(runtime.filter(n => n.endsWith('.js'))), 'Runtime load order differs from release file list');
for (const folder of ['extension', 'tests', 'scripts']) {
  for (const name of fs.readdirSync(path.join(root, folder)).filter(n => n.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(root, folder, name), 'utf8');
    new vm.Script(source, { filename: folder + '/' + name });
    assert(!/\/(?:players|games)\/[A-Za-z0-9_-]{16,}/.test(source), 'Concrete table/account identifier in ' + folder + '/' + name);
    assert(!/[A-Z]:\\(?:Users|Poker)\\/i.test(source), 'Machine-specific path in ' + folder + '/' + name);
  }
}
for (const file of ['README.md', 'README.ru.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert(!/\/(?:players|games)\/[A-Za-z0-9_-]{16,}/.test(text), 'Concrete table/account identifier in ' + file);
  assert(!/[A-Z]:\\(?:Users|Poker)\\/i.test(text), 'Machine-specific path in ' + file);
}
console.log('Syntax, versions, runtime allowlist, permissions and portability checks passed.');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../extension/config.js');
const manifest = require('../extension/manifest.json');
test('manifest and runtime allow changing PokerNow table URLs', () => {
  assert.deepEqual(manifest.content_scripts[0].matches,
    ['www.pokernow.com', 'pokernow.com'].flatMap(h => config.gamePaths.map(p => 'https://' + h + p)));
  for (const pathname of ['/games/example-table', '/games/new-table']) assert.equal(config.isAllowedGame({ hostname: 'www.pokernow.com', pathname }), true);
  assert.equal(config.isAllowedGame({ hostname: 'evil.example', pathname: config.gamePaths[0] }), false);
  assert.equal(config.isAllowedGame({ hostname: 'www.pokernow.com', pathname: '/players/other' }), false);
});
test('URL scope accepts only HTTPS PokerNow tables and normalizes trailing slashes', () => {
  assert.equal(config.isAllowedGame(new URL('https://pokernow.com/games/example/')), true);
  assert.equal(config.tablePath(new URL('https://pokernow.com/games/example/')), '/games/example');
  for (const url of ['http://pokernow.com/games/example', 'https://pokernow.com.evil.test/games/example',
    'https://pokernow.com/games/', 'https://pokernow.com/games/example/more', 'https://pokernow.com/mtt/example']) {
    assert.equal(config.isAllowedGame(new URL(url)), false, url);
  }
});

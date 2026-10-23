(function (root) {
  'use strict';
  const gamePaths = Object.freeze(['/games/*']);
  const hosts = Object.freeze(['pokernow.com', 'www.pokernow.com']);
  function tablePath(location) {
    return /^\/games\/[^/]+\/?$/.test(location.pathname) ? location.pathname.replace(/\/$/, '') : null;
  }
  function isAllowedGame(location) {
    return hosts.includes(location.hostname) && (!location.protocol || location.protocol === 'https:') && tablePath(location) !== null;
  }
  const api = Object.freeze({ gamePaths, hosts, tablePath, isAllowedGame });
  root.PokerNowAlgoBotConfig = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

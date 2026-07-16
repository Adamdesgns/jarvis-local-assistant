// Pure skin + state helpers. Dual export: node:test requires it via
// module.exports; the browser loads it as a classic <script> and reads
// window.JarvisSkins. No DOM access at load — safe to require in tests.
(function () {
  const SKINS = ['classic', 'command-center'];

  function resolveSkin(name) {
    const dataSkin = SKINS.includes(name) ? name : 'classic';
    return { dataSkin, pauseCanvas: dataSkin === 'command-center' };
  }

  // Maps a setCoreState() state to the Command Center state, --state colour,
  // and status line. Mirrors the prototype's STATES table.
  const STATE_MAP = {
    ready:      { ccState: 'STANDBY',   color: '#58d8ff', message: 'All systems ready' },
    listening:  { ccState: 'LISTENING', color: '#8bf7ff', message: 'Listening for your command' },
    processing: { ccState: 'THINKING',  color: '#ffd36a', message: 'Analyzing request' },
    speaking:   { ccState: 'SPEAKING',  color: '#7affc7', message: 'Response channel active' },
    exploding:  { ccState: 'WORKING',   color: '#ff9d57', message: 'Searching your computer' },
    error:      { ccState: 'ERROR',     color: '#ff705e', message: 'Action requires attention' },
    offline:    { ccState: 'OFFLINE',   color: '#6f7c82', message: 'Local services unavailable' }
  };

  function mapState(jarvisState) {
    return STATE_MAP[jarvisState] || STATE_MAP.offline;
  }

  const api = { SKINS, resolveSkin, mapState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JarvisSkins = api;
})();

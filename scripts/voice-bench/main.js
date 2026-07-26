// Voice audition bench — renders every candidate voice through the SAME path
// JARVIS will ship on, so what Adam hears is what the app will sound like.
//
//   npx electron scripts/voice-bench
//
// Why Electron and not plain node: Kokoro on this machine's CPU measured
// RTF ~1.2 (slower than real time), but on the discrete GPU via WebGPU it is
// RTF 0.10 — fourteen times faster. WebGPU only exists in the renderer, so the
// bench must run there. An earlier node-based version of this bench rendered in
// q8, which we now know mangles output (2.9-3.5s of audio for a sentence fp16
// renders as 4.1s). Auditioning voices on q8 would have meant judging them on
// broken audio.
//
// Runs headless (show:false). Adam's apps do not get launched unprompted and
// this is a tool, not JARVIS.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const OUT_DIR = path.join(os.homedir(), 'OneDrive', 'JARVIS Promo', 'voice-bench');

// Force the discrete GPU. On an Optimus laptop Chromium defaults to the
// integrated adapter to save battery, which costs 5x here (RTF 0.50 on the
// Intel iGPU vs 0.10 on the RTX).
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('force_high_performance_gpu');

ipcMain.handle('bench:save', (_event, name, buffer) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.from(buffer));
  return fs.statSync(file).size;
});

ipcMain.handle('bench:readme', (_event, text) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'README.txt'), text);
  return OUT_DIR;
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      // nodeIntegration MUST stay off: transformers.js picks the onnxruntime-node
      // backend whenever it sees a node process, and that backend has no WebGPU.
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.webContents.on('console-message', (_event, _level, message) => {
    console.log(message);
    if (message.startsWith('BENCH-DONE')) { win.destroy(); app.quit(); }
  });

  await win.loadFile(path.join(__dirname, 'index.html'));
  setTimeout(() => { console.log('BENCH-TIMEOUT'); try { win.destroy(); } catch {} app.quit(); }, 600000);
});

app.on('window-all-closed', () => app.quit());

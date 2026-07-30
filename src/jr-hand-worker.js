'use strict';

// The hand-reading half of camera rock-paper-scissors: a CLASSIC dedicated
// worker, and classic on purpose. Three facts line up to make this the one
// shape that works offline under the page's strict CSP (script-src 'self',
// no wasm-unsafe-eval, fetch() cannot touch file:// at all):
//
//   1. A dedicated worker loaded from a file:// script is not governed by
//      the document's <meta> CSP, so WebAssembly may compile here.
//   2. importScripts() accepts same-origin file:// URLs, which loads the
//      vendored IIFE bundle and this repo's own classifier.
//   3. MediaPipe's emscripten glue explicitly detects file:// URLs and uses
//      XHR instead of fetch ("Cordova or Electron apps are typically loaded
//      from a file:// url" — vision_wasm_internal.js), so the .wasm and the
//      .task model both load from disk. Nothing here ever touches the
//      network: every URL below is a relative path into the packaged app.
//
// Frames arrive as transferred ImageBitmaps; what leaves is a single word
// ('rock'|'paper'|'scissors') or null. No frame is ever stored, forwarded,
// or drawn — closed and discarded the moment it is classified.

importScripts('../assets/vendor/mediapipe/vision_bundle.js');
importScripts('../core/hand-shapes.js');

var landmarker = null;

function loadBytes(relativeUrl) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', new URL(relativeUrl, self.location.href).href);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function () {
      if (xhr.response && xhr.response.byteLength > 0) resolve(xhr.response);
      else reject(new Error('empty response for ' + relativeUrl));
    };
    xhr.onerror = function () { reject(new Error('could not read ' + relativeUrl)); };
    xhr.send();
  });
}

async function init() {
  var base = '../assets/vendor/mediapipe/';
  var model = await loadBytes(base + 'hand_landmarker.task');
  var fileset = {
    wasmLoaderPath: new URL(base + 'wasm/vision_wasm_internal.js', self.location.href).href,
    wasmBinaryPath: new URL(base + 'wasm/vision_wasm_internal.wasm', self.location.href).href
  };
  landmarker = await Vision.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: new Uint8Array(model) },
    runningMode: 'VIDEO',
    numHands: 1
  });
}

self.onmessage = function (event) {
  var msg = event.data || {};
  if (msg.type === 'init') {
    init().then(function () {
      self.postMessage({ type: 'ready' });
    }).catch(function (error) {
      self.postMessage({ type: 'error', message: String(error && error.message || error) });
    });
    return;
  }
  if (msg.type === 'frame') {
    var shape = null;
    try {
      if (landmarker && msg.bitmap) {
        var result = landmarker.detectForVideo(msg.bitmap, msg.ts);
        var landmarks = result && result.landmarks && result.landmarks[0];
        shape = landmarks ? self.JrHandShapes.classifyHand(landmarks) : null;
      }
    } catch (error) {
      shape = null; // a bad frame is a null read, never a crash
    }
    if (msg.bitmap && typeof msg.bitmap.close === 'function') msg.bitmap.close();
    self.postMessage({ type: 'read', shape: shape, ts: msg.ts });
  }
};

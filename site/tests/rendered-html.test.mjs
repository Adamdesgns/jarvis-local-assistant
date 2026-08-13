import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the JARVIS flagship page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>JARVIS — Interactive Demo<\/title>/i);
  assert.match(html, /Your own JARVIS/);
  assert.match(html, /INTERACTIVE DEMO/);
  assert.match(html, /OBSIDIAN PLASMA/);
  assert.match(html, /PRICING AVAILABLE UPON REQUEST/);
  assert.match(html, /lucedalelogo@yahoo\.com/);
  assert.match(html, /instagram\.com\/adamdsgns/);
  assert.match(html, /x\.com\/adamdsgns/);
  assert.match(html, /facebook\.com\/adamdsgns/);
  assert.match(html, /href="\/jarvis-jr"/);
  assert.match(html, /Minecraft and Roblox expertise/);
  assert.doesNotMatch(html, /href=""|href="#"/i);
  assert.doesNotMatch(html, /Your site is taking shape|SkeletonPreview/);
});

test("server-renders the separate JARVIS JR page", async () => {
  const response = await render("/jarvis-jr");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /A JARVIS/);
  assert.match(html, /built for/);
  assert.match(html, /CALL DAD/);
  assert.match(html, /MINECRAFT/);
  assert.match(html, /ROBLOX/);
  assert.match(html, /CAMERA RPS/);
  assert.match(html, /THE TWO-PC LIVE CHECK IS STILL PENDING/);
  assert.match(html, /github\.com\/Adamdesgns\/jarvis-jr\/releases\/latest/);
  assert.match(html, /lucedalelogo@yahoo\.com/);
});

test("ships required local brand assets", async () => {
  const root = new URL("../", import.meta.url);
  await Promise.all([
    access(new URL("public/jarvis-core.svg", root)),
    access(new URL("public/jarvis-social-card.png", root)),
    access(new URL("public/jarvis-jr-icon.png", root)),
    access(new URL("public/fonts/SpaceGrotesk.woff2", root)),
    access(new URL("public/orbs/orb-engine.js", root)),
    access(new URL("public/orbs/plasma.js", root)),
  ]);
  const component = await readFile(new URL("app/JarvisDemo.tsx", root), "utf8");
  assert.match(component, /This preview is fictional/);
  assert.match(component, /camera experience shown on this site is a fictional preview/i);
  assert.match(component, /Windows SmartScreen/i);
});

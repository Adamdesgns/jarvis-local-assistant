import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const output = new URL("../netlify-static/", import.meta.url);

await rm(output, { recursive: true, force: true });
await cp(new URL("../dist/client/", import.meta.url), output, { recursive: true });

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("netlify", Date.now().toString());
const { default: worker } = await import(workerUrl.href);

async function render(pathname, destination) {
  const response = await worker.fetch(
    new Request(`https://jarvis-private-ai.netlify.app${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  if (!response.ok) throw new Error(`Could not render ${pathname}: ${response.status}`);
  const target = new URL(destination, output);
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, await response.text(), "utf8");
}

await render("/", "index.html");
await render("/jarvis-jr", "jarvis-jr/index.html");
await writeFile(new URL("_redirects", output), "/jarvis-jr/  /jarvis-jr/index.html  200\n", "utf8");

console.log(`Netlify static site ready at ${output.pathname}`);

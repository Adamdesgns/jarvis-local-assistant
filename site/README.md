# JARVIS Interactive Demo

A standalone marketing site and safe interactive simulation for JARVIS, the free private local Windows assistant.

## Production

- Live site: https://jarvis-private-ai.netlify.app
- Canonical source: `site/` in `Adamdesgns/jarvis-local-assistant`
- Netlify is currently a manual deployment with no connected repository.
- Do not deploy changes without Adam's explicit approval.

## Run locally

```powershell
npm install
npm run dev -- --port 5174
```

Then open `http://localhost:5174/`.

## Checks

```powershell
npm run lint
npm test
```

## Product boundaries

- The demo never touches the installed JARVIS app, microphone, files, cameras, devices, or saved settings.
- All tasks, memories, file paths, performance readings, and command responses are fictional.
- Camera and device experiences are positioned as request-priced custom builds, not shipping features of the free app.
- The Plasma renderer and Space Grotesk font are copied from the JARVIS source tree and run entirely in the browser.

Set `NEXT_PUBLIC_SITE_URL` to the final public URL before production deployment so social preview links resolve correctly.

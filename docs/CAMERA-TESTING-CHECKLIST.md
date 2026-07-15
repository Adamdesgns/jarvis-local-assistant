# Camera Module — Real-Account Testing Checklist

For Adam. Written July 15, 2026, before the camera module's first release.

This is the part that could not be tested without your real Ring, Blink, and
Nest accounts. Everything below runs on **your** laptop with **your** cameras.
Do the sections in order. Each numbered step is one thing to click or type.
If a step fails, stop and copy the exact words JARVIS showed — that tells us
which layer broke.

Before you start:
- The Cameras module is hidden by default. Turn it on: open JARVIS → the
  module list on the left → click **Cameras** so it appears on screen.
- Cameras need the streaming helper `go2rtc.exe`. It ships inside JARVIS. You
  do not install anything. If live view says "streaming helper is missing,"
  the install is incomplete — tell me.

---

## Section 0 — Local (RTSP) camera — do this FIRST

This uses no cloud account, so it proves the plumbing before we touch Ring or
Nest. If you own any cheap local camera (Reolink, Amcrest, Wyze-with-RTSP,
Tapo, etc.), use it. If you don't, skip to Section 1.

1. In the Cameras module, click **＋ ADD** (top right of the module).
2. Leave the tab on **LOCAL (RTSP)**.
3. Click **SCAN NETWORK**. Wait about 5 seconds.
   - Expected: it either lists cameras it found, or says none answered.
   - Either way is fine — a scan finding nothing is not a failure.
4. In the address box, type your camera's RTSP address. It looks like
   `rtsp://username:password@192.168.1.20:554/stream1`. Your camera's app or
   manual gives the exact path.
5. Type a name like `Front Door` in the name box.
6. Click **SAVE CAMERA**.
   - Expected: the form closes and a tile appears with a picture within a few
     seconds.
7. On the tile, click **▶ LIVE**.
   - Expected: within a few seconds it shows moving video and the button
     changes to **■ STOP**. ⬅ **This is the most important local test.**
8. Click **■ STOP**. Video stops, the still picture returns.
9. Click **↻** (refresh). A fresh still picture appears with a timestamp.
10. Click **× ** (remove) on the tile. Confirm the tile disappears.

If step 7 never shows video, note whether the button stayed on
"… CONNECTING" or showed "Live view failed: …" and the message.

---

## Section 1 — Ring (needs your Ring account)

Ring is the most fully-featured brand here: live view, snapshots, motion and
doorbell alerts, and arm/disarm.

**Sign in**
1. **＋ ADD** → click the **RING** tab.
2. Type your Ring email and password.
3. Click **SIGN IN**.
   - Expected: it says Ring is sending you a code, and a code box appears.
4. Get the code Ring texts or emails you. Type it in the code box.
5. Click **VERIFY CODE**.
   - Expected: "Ring is connected." The form closes and your Ring cameras
     appear as tiles.

**Snapshots and live view**
6. Each Ring tile should load a still picture on its own.
7. Click **▶ LIVE** on a Ring camera.
   - Expected: live video within ~10 seconds. ⬅ **Flag this result to me
     specifically** — Ring live view goes straight to Ring's cloud over
     WebRTC, and cloud WebRTC without a STUN/TURN server is the single thing
     I could not verify without your account. If it stalls on
     "… CONNECTING," that is the likely cause and I have a fix ready.
8. Click **■ STOP**.

**Doorbell / motion alert (if you have a Ring doorbell)**
9. Press your Ring doorbell (or walk in front of a motion camera).
10. Within a few seconds, expect a Windows notification titled
    **JARVIS · DOORBELL** (or **· MOTION**) and the tile stamped with the
    alert text.
11. Do it again within 1 minute — expect **no** second notification (alerts
    are deduped for 60 seconds on purpose).

**AI description of the alert (optional, needs a vision model)**
12. This only adds a sentence like "a person in a blue coat at the door" if
    you have a local vision model. If you want it: open a Command Prompt and
    run `ollama pull gemma3:4b` once. It is a large download.
13. In JARVIS Settings, confirm **AI CAMERA ALERTS** is on (it is on by
    default). Trigger the doorbell again — the notification text should now
    describe the picture instead of just "someone pressed the doorbell."

**Arm / disarm — please test carefully**
14. Below the tiles, find the systems strip with your Ring location and an
    **ARM** button.
15. Click **ARM** once. It changes to **CONFIRM ARM?** for 5 seconds.
16. Click it again to confirm.
    - Expected: the state flips to **ARMED**. ⬅ **This is a bug I just fixed**
      (the code was mangling Ring's location ID). Please confirm arming and
      disarming both actually change the state in the **real Ring app**, not
      just in JARVIS.
17. Click **DISARM**, confirm, and check the Ring app shows disarmed.

---

## Section 2 — Blink (needs your Blink account)

Blink cameras are battery-powered, so snapshots are deliberately slow and
rate-limited (JARVIS won't wake the camera more than once every 10 minutes on
its own).

1. **＋ ADD** → **BLINK** tab.
2. Type your Blink email and password → **SIGN IN**.
   - Expected: "Blink emailed you a PIN," and a PIN box appears.
3. Open the email from Blink, type the PIN, click **VERIFY PIN**.
   - Expected: "Blink is connected," tiles appear for each Blink camera,
     doorbell, and Mini/Owl.
4. Click **↻** on a tile. Give it several seconds — Blink has to wake the
   camera and take a new picture. Expect a fresh photo, or a message that a
   recent picture is shown.
5. Arm/disarm: use the systems strip → **ARM** → **CONFIRM ARM?** → confirm.
   Check the state matches the **real Blink app**.

**Known limitation to expect (not a bug):** Blink does **not** push live
motion or doorbell alerts into JARVIS in this version — only Ring does. So do
not wait for a Blink notification; there won't be one yet. Blink live video is
also not offered (snapshots only). See "Known limitations" at the bottom.

---

## Section 3 — Nest (Advanced setup, needs Google + your Nest account)

Nest is the most involved because Google makes you register. Nest here is
**live-view only** — no snapshots, no motion alerts. That is expected.

**One-time Google setup (about 15 minutes, ~$5 Google fee)**
1. **＋ ADD** → **NEST (ADVANCED)** tab.
2. Click **OPEN GOOGLE CONSOLE**. Your browser opens Google's Device Access
   console.
3. In Google's console, pay the one-time $5 fee and create a **Device Access
   project**. Copy its **project ID**.
4. Still in Google's Cloud console, create an **OAuth client** (type: Web
   application). When it asks for an authorized redirect URI, this is the one
   thing to get right — see the note below. Copy the **client ID** and
   **client secret**.
5. Back in JARVIS, paste all three values into the three boxes.
6. Click **START GOOGLE SIGN-IN**. Your browser opens Google's approval page.
7. Approve JARVIS. The browser tab should say "JARVIS is connected to Nest."
8. Back in JARVIS, expect "Nest is connected."
9. Nest camera tiles appear labeled **LIVE VIEW ONLY**.
10. Click **▶ LIVE** on a Nest camera → expect live video within ~10 seconds.
    Then **■ STOP**.

**Redirect URI note — read before step 4.** JARVIS listens on a temporary
`http://127.0.0.1:<random port>/callback` address that changes each time. Some
Google OAuth client types reject a redirect URI that isn't pre-registered,
and the port is not known in advance. **If step 7 fails with a redirect_uri
error, stop and tell me the exact error** — we may need to switch the Nest
sign-in to Google's "loopback IP" client type or a fixed port. I could not
verify this end-to-end without your Google project.

---

## What I already checked (you don't need to)

- All 60 automated tests pass, including a new one for the Ring arm/disarm fix.
- Secrets (passwords, tokens, RTSP URLs with passwords) are stored encrypted
  and never written into the plain settings file — covered by tests.
- The streaming helper is configured localhost-only (no exposure to your
  network) — covered by tests.
- Removing an account deletes its stored secret — covered by tests.

## Bug I fixed in this pass

- **Ring arm/disarm was broken.** The code converted Ring's location ID with
  `Number(...)`, which turned Ring's letters-and-dashes ID into "not a
  number," so arming always failed to find the location. Blink's IDs are
  numeric so Blink was unaffected. Fixed to pass the ID through unchanged, and
  added a regression test. **Still needs your Ring account to confirm the real
  system actually arms (Section 1, steps 14–17).**

## Known limitations (by design, not bugs — but confirm you're OK with them)

1. **Blink has no motion/doorbell alerts and no live video** — snapshots and
   arm/disarm only. Only Ring pushes live alerts in this version.
2. **Nest is live-view only** — no snapshots, no motion alerts (Google
   requires a separate Pub/Sub setup we didn't build yet).
3. **RTSP/local and Nest cameras** send no motion alerts (no cloud events to
   listen to).
4. **Cloud camera analysis is off by default.** Camera pictures only leave
   your PC if you turn on "CLOUD CAMERA ANALYSIS" in Settings. Local vision
   (`gemma3:4b` via Ollama) is the default and stays on-device.

## Highest-risk items to watch (rank order)

1. **Ring live view** over cloud WebRTC (Section 1 step 7) — untestable
   without your account; possible STUN/TURN gap.
2. **Nest OAuth redirect URI** (Section 3 step 7) — possible Google client-type
   mismatch on the random loopback port.
3. **Ring arm/disarm** on the real system (Section 1 steps 14–17) — code fix
   applied, needs live confirmation.

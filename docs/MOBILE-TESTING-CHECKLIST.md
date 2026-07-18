# Mobile Companion — Real-iPhone Testing Checklist

For Adam. Written July 18, 2026, before the mobile companion's first release.

This is the part that could not be tested without your real iPhone. Everything
below runs on **your** laptop and **your** iPhone over your home Tailscale
network. Do the sections in order. Each numbered step is one thing to click,
type, or tap. If a step fails, stop and copy the exact words JARVIS showed —
that tells us which layer broke.

**What this feature does:** JARVIS on your phone sends and receives messages and
voice over a secure connection to your PC, even away from home. It uses Tailscale
(a zero-config VPN) instead of exposing JARVIS to the internet. The phone pair
by scanning a QR code, and you can revoke access anytime in Settings.

---

## Before you start

- Both your PC and iPhone need Tailscale, and both must be signed into the same
  Tailscale account. If you do not have a Tailscale account, go to
  `tailscale.com` and create one (free). Do that first, then come back.
- JARVIS's PHONE ACCESS is **off by default**. You must turn it on in Settings
  to use it.

---

## Section 1 — Tailscale setup (PC side)

Tailscale is a VPN that lets your phone talk to your PC securely without
opening a port on the internet. JARVIS uses it.

1. On your PC, open a web browser and go to `tailscale.com/download`.
2. Click the button for **Windows**.
3. Follow the installer. When it finishes, a Tailscale window opens.
4. Click **SIGN IN**.
   - Expected: your browser opens Tailscale's login page.
5. Sign in with your Tailscale account (the one you just created or already
   have).
6. When it asks "Tailscale wants to connect to your PC," click **CONNECT**.
   - Expected: you see "Connected" and your PC gets an IP address that starts
     with `100.` (this is your Tailscale IP).
7. In the Tailscale window, find the line that says `100.xx.xx.xx` and copy it.
   You will need it in a moment. **Keep the Tailscale window open from now on**
   — Tailscale must stay running for the phone to reach your PC.

---

## Section 2 — Tailscale setup (iPhone side)

1. On your iPhone, open the **App Store**.
2. Search for **Tailscale** (made by Tailscale Inc., the icon is a colorful
   cross).
3. Tap **GET** → **INSTALL** → authenticate with Face ID / Touch ID / password.
4. Once it finishes, tap **OPEN**.
5. Tap **SIGN IN**.
   - Expected: Safari opens and asks you to sign in with your Tailscale account.
6. Sign in with the **same account** you used on your PC.
7. When it says "Tailscale wants to add VPN configurations," tap **ALLOW**.
   - Expected: you return to the Tailscale app.
8. At the top of the Tailscale app, find the toggle that says **VPN** (or shows
   a VPN icon). Make sure it is **ON** (it should be blue or green).
   - This is critical: without VPN on, your phone cannot reach your PC.
9. At the bottom of the Tailscale app, you should see your PC listed by name
   (something like "pc-name — Connected"). That means your PC and iPhone can now
   talk.

---

## Section 3 — Turn on PHONE ACCESS in JARVIS Settings

Now JARVIS knows to listen for your phone.

1. On your **PC**, open JARVIS normally.
2. Click the **SETTINGS** button (usually at the bottom of the left panel).
3. Scroll down to find the **MOBILE** section (it should say "Mobile Companion"
   or similar).
4. Find the toggle that says **PHONE ACCESS** and turn it **ON**.
   - Expected: when you do, you will see a button labeled **PAIR A PHONE** and
     a blue QR code appear on screen. Keep JARVIS Settings open.

---

## Section 4 — Pair your iPhone to JARVIS

The QR code is how your iPhone proves it is allowed to talk to JARVIS. You
scan it with the iPhone camera.

1. Make sure you can see both JARVIS Settings (on your PC) and your iPhone.
2. On your **iPhone**, open the **Camera** app.
3. Point it at the **QR code** shown in JARVIS Settings.
   - Expected: within a second or two, a notification pops up at the top saying
     something like "Open in JARVIS" or showing a link. Tap it.
   - If nothing happens: make sure the QR code is well-lit and in focus. Try
     from different angles.
4. Safari opens with a URL that includes `?code=` and a six-digit number. You
   should see a **PAIR** button on screen.
   - If the QR has a six-digit code printed inside it, you can also type that
     code into the text box instead of scanning. Either way works.
5. Tap **PAIR**.
   - Expected: the page now says something like "Device paired" or "You are
     connected to JARVIS," and you should see a **TAP TO OPEN JARVIS** link
     or button.

---

## Section 5 — Add JARVIS to your Home Screen

This makes JARVIS appear as an icon on your iPhone home screen, just like any
other app.

1. From the pairing success page, tap **TAP TO OPEN JARVIS** (or just navigate
   to the JARVIS URL in Safari manually if you closed it).
   - Expected: you see a JARVIS chat screen with a message box at the bottom.
2. At the bottom of Safari, tap the **Share** button (the square with an arrow
   pointing out).
3. Scroll down and tap **Add to Home Screen**.
   - Expected: a popup asks you to name it. It should say "JARVIS" by default.
4. Tap **ADD** in the top right.
   - Expected: you return to Safari and see a brief confirmation. The JARVIS
     icon should now appear on your home screen.
5. Go to your iPhone home screen and look for the JARVIS icon. Tap it.
   - Expected: JARVIS opens (it may take a few seconds the first time).

---

## Section 6 — Send a text message

This is the most basic test: can the phone send a message to JARVIS and get a
reply?

1. In JARVIS on your iPhone, tap the message box at the bottom.
2. Type a simple message like **"Hello, can you hear me?"**
3. Tap **SEND** (or press return).
   - Expected: the message appears in the chat, and within a few seconds JARVIS
     sends back a reply (something like "Hi! I'm here" or similar).
4. If no reply appears: go back to your PC, check that JARVIS is still open and
   listening, and check the Tailscale app is still showing Connected.

---

## Section 7 — Voice message test

This tests that voice works from the phone. It is a press-and-hold action.

1. In JARVIS on your iPhone, find the microphone button (or the area below the
   message box where voice input should be).
2. **Press and hold** on it (do not tap once — you must hold it down).
   - Expected: a circle or waveform appears, and you hear a beep. You can now
     speak.
3. While holding, say something like **"What time is it?"** in a normal voice.
4. Release your finger.
   - Expected: the recording stops, JARVIS sends it to your PC, and within a
     few seconds you get back a voice reply (you will hear audio playing). The
     message also appears as text in the chat.
5. If you hear nothing: check that your iPhone volume is on (use the side
   buttons) and that you are not in silent mode.

---

## Section 8 — Network interruption test (Wi-Fi off)

This test makes sure JARVIS tells you when it cannot reach your PC, and lets
you retry when it is back.

1. Start a voice message or text message as you did above. **Before you finish
   typing or speaking**, turn off your PC's Wi-Fi.
   - On Windows, click the network icon in the system tray (bottom right) →
     find your Wi-Fi network → click **Disconnect**.
2. If you are in the middle of a voice message, release and send it. If you are
   typing, hit Send.
   - Expected: instead of a reply, you see a message on your iPhone saying
     **"JARVIS is unreachable"** or **"Network error — JARVIS offline"**. There
     should be a **RETRY** button.
3. Turn your PC's Wi-Fi back on.
   - On Windows, click the network icon → find your Wi-Fi → click **Connect** →
     enter the password if needed.
4. Wait a few seconds for the connection to re-establish (check Tailscale — it
   should say Connected again).
5. On your iPhone, tap the **RETRY** button.
   - Expected: within a few seconds, you get a reply from JARVIS. The
     connection is restored.

---

## Section 9 — Revoke and re-pair

This tests that you can disconnect the phone and require it to pair again. It
is the security feature that keeps unwanted devices out.

1. On your **PC**, go back to JARVIS Settings → **MOBILE** section.
2. Below the QR code, you should see a list of paired devices. Find your iPhone
   (it may be listed by a name or just "iPhone").
3. Click the **REVOKE** button next to it.
   - Expected: the device disappears from the list. Your iPhone immediately
     loses connection to JARVIS.
4. On your **iPhone**, look at JARVIS. You should see a message saying something
   like **"This pairing has been revoked"** or **"Please pair again"**, and a
   pairing screen with a code or QR box should appear.
5. Follow **Section 4** again (scan the new QR code or type the new code) to
   re-pair.
   - Expected: everything works as before. Revoking and re-pairing is the normal
     flow if you want to remove an old phone.

---

## Section 10 — Cellular test (advanced)

This test confirms JARVIS works over Tailscale even when Wi-Fi is completely
off and you are on cellular data alone. **Only do this if you have a cellular
data plan and are willing to use a bit of data.**

1. On your **iPhone**, turn off Wi-Fi completely.
   - Swipe down from the top-right corner → tap the Wi-Fi icon to turn it off.
2. Make sure Tailscale VPN is **still ON** (check the Tailscale app).
3. In JARVIS, send a text message or voice message.
   - Expected: it works just as it did with Wi-Fi. Tailscale routes your message
     through your home internet over cellular.
4. Turn Wi-Fi back on when you are done.

---

## Section 11 — PC sleep and availability

This is important to know: **JARVIS only works when your PC is awake.** If your
PC goes to sleep, your iPhone cannot reach it (Tailscale stays connected, but
the app stops listening).

**What to do:**

- If you want JARVIS available anytime you are away, open **Windows Settings** →
  **System** → **Power** and find the **Sleep** setting. Change it to **Never**
  (or set it to a longer timeout like 30 minutes if you want the PC to save
  power). This keeps your PC awake so JARVIS stays reachable.
- If you do not change this, JARVIS will stop responding when your PC sleeps.
  That is fine — just wake your PC (press a key or move the mouse) and wait a
  few seconds for JARVIS to respond again.

The choice is yours. Just know that the sleep setting is the reason JARVIS goes
offline.

---

## Section 12 — Troubleshooting

If something does not work, check these things **in this order:**

1. **Is Tailscale running on both devices?**
   - PC: Check the Tailscale window is open and shows "Connected."
   - iPhone: Check the Tailscale app, find the VPN toggle, and make sure it is
     ON.

2. **Is PHONE ACCESS on in JARVIS Settings?**
   - On your PC, open JARVIS Settings → MOBILE. The toggle should be ON.

3. **Are your PC and iPhone on the same Tailscale account?**
   - Both must sign in to the same account. You cannot use different accounts.

4. **Is your PC awake?**
   - JARVIS only responds when the PC is awake. Press a key to wake it, wait a
     few seconds, and try again.

5. **Has JARVIS been idle for a while?**
   - Sometimes the connection times out. Close and re-open JARVIS on your iPhone
     (tap the Home Screen icon again or close Safari and re-open it).

6. **Did you turn off your PC's Wi-Fi in Section 8?**
   - Make sure you turned it back on and waited for Tailscale to show Connected
     before trying again.

If nothing works: copy the exact error message from the screen and tell me what
step failed. That error message is the most helpful thing you can give me.

---

## What I already checked (you do not need to)

- All 102 automated tests pass, including new tests for mobile pairing, voice,
  SSE streams, and the Settings UI.
- Tailscale IP binding is locked down: JARVIS only listens on the Tailscale
  interface, never on the public internet.
- Voice and chat messages are streamed end-to-end; the desktop can interrupt
  mid-sentence and the phone shows it instantly.
- The six-digit pairing code times out after 5 minutes if not used (security).
- Revoke immediately disconnects that device; no stale sessions.

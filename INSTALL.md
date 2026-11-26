# How to Install JARVIS

Setup takes about 15 minutes. You only do it once.

Stuck at any step? Email **steamercook@yahoo.com** (see [Get help](#get-help) at the bottom).

---

## What you need

| | |
|---|---|
| **Computer** | Windows 10 or Windows 11, 64-bit |
| **Memory** | 8 GB RAM works. 16 GB is better if you want local chat (Step 4) |
| **Free space** | About 1 GB for JARVIS and voice. About 7 GB more for local chat |
| **Internet** | Needed during setup only, to download the free voice and chat models |
| **Microphone** | Any built-in, USB or headset mic |
| **Cost** | Free. No account, no subscription |

---

## Step 1: Download JARVIS (1 min)

1. Go to the **[latest release page](https://github.com/Adamdesgns/jarvis-local-assistant/releases/latest)**.
2. Scroll down to **Assets**.
3. Click the file that ends in **`.exe`** (for example `JARVIS-Setup-0.20.0.exe`). It saves to your **Downloads** folder.

---

## Step 2: Install it (2 min)

1. Open your **Downloads** folder and double-click the JARVIS `.exe`.
2. Windows may show a blue box that says **"Windows protected your PC."**
   This is normal. JARVIS is free and isn't paid-signed, so Windows doesn't recognize the publisher.
   - Click **More info**.
   - Click **Run anyway**.
3. Follow the installer and click **Install**. You don't need admin rights.
4. JARVIS opens when the installer finishes. You'll find a shortcut in the Start menu as well.

**First launch:** JARVIS asks you to name your assistant. Type a name, or click **KEEP "JARVIS"**. You can change it later in Settings → GENERAL.

---

## Step 3: Turn on voice (5–10 min, one time)

This installs the free speech engine that runs on your own PC. Nothing you say leaves your computer.

1. Click the **⚙** (gear) button at the top to open **Settings**.
2. Click **INSTALL / REPAIR LOCAL VOICE**.
3. Wait. A progress line shows what's happening. The first time takes a few minutes.
   - If you don't have Python, JARVIS installs **Python 3.12** for you automatically.
   - If Windows asks to allow Python or the microphone, click **Yes / Allow**.
4. Once it finishes, click **VOICE DIAGNOSTICS**. Every row should say **PASS**.
5. Click **TEST MICROPHONE** and say "Testing my microphone." JARVIS shows the words it heard.
6. Click **TEST THE WAKE WORD** and say **"Hey Jarvis."** It should detect you.

**Done.** Say **"Hey Jarvis"** any time, then say your command.

> If you gave your assistant a different name, say **"Hey" + that name** instead.

---

## Step 4 (optional): Turn on local chat (5–15 min)

Without this, JARVIS still handles tasks, reminders, notes and files. Local chat lets you talk to him freely, all on your PC, for free.

1. Download and install **[Ollama for Windows](https://ollama.com/download/windows)** (just click Next until it's done).
2. Back in JARVIS, open **Settings** (⚙).
3. Click **CONNECT / REPAIR OLLAMA**.
4. JARVIS downloads its chat model (about 5 GB). Leave it running until it says **"connected and ready."**

---

## Step 5 (optional): Cloud brain

Only if you want it. You can paste your own **Claude (Anthropic)** or **OpenAI** API key in Settings for smarter answers and "look at my screen."

- API keys use **prepaid credit** from that company. A ChatGPT or Claude subscription doesn't cover it.
- Your key is encrypted on your PC. You can remove it any time.

---

## Try these

- "Hey Jarvis, what's on my list today?"
- "Hey Jarvis, remind me to call the shop tomorrow at 9."
- "Hey Jarvis, find my resume."
- "Hey Jarvis, stop." (He stops talking right away.)

---

## Quick fixes

| Problem | Fix |
|---|---|
| Windows won't let me open the installer | Click **More info → Run anyway** (Step 2) |
| Voice says it's not ready | Settings → **VOICE DIAGNOSTICS** → **REPAIR VOICE**, then test again |
| He doesn't hear "Hey Jarvis" | Check Windows **Settings → Privacy → Microphone** is on for desktop apps. Speak a little closer to the mic |
| "Ollama is offline" | Open Ollama from the Start menu, then click **CONNECT / REPAIR OLLAMA** |
| Panels ended up somewhere odd | **＋ Modules** button (top) → **RESET DEFAULT LAYOUT** |
| I want to start over | Settings → **BACKUP & RESTORE → EXPORT MY DATA** first, then uninstall from Windows **Installed apps** and reinstall |

More fixes: [SUPPORT.md](SUPPORT.md)

---

## Get help

Email **[steamercook@yahoo.com](mailto:steamercook@yahoo.com?subject=JARVIS%20help)**.

To get it fixed fast, include:

1. **Your JARVIS version.** It's at the bottom of the Settings window.
2. **What you did** and **what happened** (a screenshot helps).
3. **For voice problems:** open Settings → **VOICE DIAGNOSTICS** → **COPY DIAGNOSTIC REPORT**, and paste it into the email. It holds no personal info or passwords.

You can also [open an issue on GitHub](https://github.com/Adamdesgns/jarvis-local-assistant/issues).

---

## Uninstall

Windows **Settings → Apps → Installed apps → JARVIS Local Assistant → Uninstall**.
Your data is in `%APPDATA%\jarvis-local-assistant`. Delete that folder too if you want everything gone.

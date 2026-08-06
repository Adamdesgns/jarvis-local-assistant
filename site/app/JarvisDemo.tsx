"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useRef, useState } from "react";

type Theme = "amber" | "obsidian";
type CoreState = "ready" | "listening" | "processing" | "speaking";
type ModuleName = "tasks" | "files" | "system" | "memory";
type OrbInstance = {
  destroy?: () => void;
  setAudioLevel?: (level: number) => void;
  setPalette?: (palette: "gold" | "obsidian") => void;
  setState?: (state: CoreState) => void;
};
type OrbRegistry = { resolveExact: (name: string) => { create: (canvas: HTMLCanvasElement) => OrbInstance } | null };

const responses: Record<string, { reply: string; module?: ModuleName }> = {
  manual: { reply: "I found Compressor_Manual.pdf in your approved Workshop folder. The drain procedure is on page 14. Nothing outside that folder was searched.", module: "files" },
  brief: { reply: "Good morning. Two tasks are due today, your service checklist was updated yesterday, and this PC is running normally.", module: "tasks" },
  local: { reply: "Wake word, speech recognition, tasks, memory, and your local brain can stay on this PC. Cloud features only run when you deliberately add your own API key.", module: "system" },
  camera: { reply: "Custom camera walls can be scoped for a private JARVIS build. This preview is fictional and is not connected to any real camera or device." },
};

const starterTasks = [
  { id: 1, label: "Review the morning briefing", meta: "GENERAL · TODAY 8:00 AM", done: false },
  { id: 2, label: "Check the compressor drain", meta: "WORKSHOP · REPEATS DAILY", done: false },
  { id: 3, label: "Archive July service notes", meta: "SHOP · THIS WEEK", done: true },
];

const contactEmail = "lucedalelogo@yahoo.com";
const socialLinks = [
  { label: "Instagram", detail: "@adamdsgns", href: "https://www.instagram.com/adamdsgns/" },
  { label: "X", detail: "@adamdsgns", href: "https://x.com/adamdsgns" },
  {
    label: "Facebook",
    detail: "@adamdsgns",
    href: "https://www.facebook.com/adamdsgns",
  },
] as const;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const found = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (found?.dataset.loaded === "true") return resolve();
    const script = found || document.createElement("script");
    script.src = src;
    script.async = false;
    script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
    if (!found) document.head.appendChild(script);
  });
}

function PlasmaOrb({ theme, coreState }: { theme: Theme; coreState: CoreState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<OrbInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadScript("/orbs/orb-engine.js");
      await loadScript("/orbs/plasma.js");
      if (cancelled || !canvasRef.current) return;
      const engine = (window as Window & { OrbEngine?: OrbRegistry }).OrbEngine;
      const skin = engine?.resolveExact("plasma");
      if (!skin) return;
      instanceRef.current = skin.create(canvasRef.current);
      instanceRef.current.setPalette?.("gold");
      instanceRef.current.setState?.("ready");
    })().catch(() => undefined);
    return () => { cancelled = true; instanceRef.current?.destroy?.(); instanceRef.current = null; };
  }, []);

  useEffect(() => { instanceRef.current?.setPalette?.(theme === "obsidian" ? "obsidian" : "gold"); }, [theme]);
  useEffect(() => {
    instanceRef.current?.setState?.(coreState);
    instanceRef.current?.setAudioLevel?.(coreState === "speaking" ? 0.72 : coreState === "listening" ? 0.35 : 0);
  }, [coreState]);

  return <canvas ref={canvasRef} className="plasma-canvas" aria-label="Animated JARVIS plasma orb" />;
}

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><span /></span>;
}

export function JarvisDemo() {
  const [theme, setTheme] = useState<Theme>("amber");
  const [coreState, setCoreState] = useState<CoreState>("ready");
  const [command, setCommand] = useState("");
  const [reply, setReply] = useState("Good evening. Your private local assistant is online.");
  const [activeModule, setActiveModule] = useState<ModuleName>("tasks");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tasks, setTasks] = useState(starterTasks);
  const [tourOpen, setTourOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const switchTheme = (next: Theme) => {
    setTheme(next);
    setCoreState("processing");
    setReply(next === "obsidian" ? "Obsidian Plasma engaged. Same private core, different atmosphere." : "Original amber restored. Command center standing by.");
    window.setTimeout(() => setCoreState("ready"), 700);
  };

  const runCommand = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    setCommand(clean);
    setCoreState("listening");
    setReply(`› ${clean}`);
    const lower = clean.toLowerCase();
    const key = lower.includes("manual") ? "manual" : lower.includes("brief") ? "brief" : lower.includes("camera") ? "camera" : "local";
    window.setTimeout(() => { setCoreState("processing"); setReply("Working locally…"); }, 360);
    window.setTimeout(() => {
      const result = responses[key];
      setReply(result.reply);
      if (result.module) setActiveModule(result.module);
      setCoreState("speaking");
    }, 1120);
    window.setTimeout(() => setCoreState("ready"), 2600);
  };

  const submitCommand = (event: FormEvent) => { event.preventDefault(); runCommand(command); };
  const statusCopy = {
    ready: ["AWAITING DIRECTIVE", "READY"], listening: ["VOICE CHANNEL", "LISTENING"],
    processing: ["LOCAL CORE", "THINKING"], speaking: ["RESPONSE CHANNEL", "SPEAKING"],
  }[coreState];

  return (
    <main className="site" data-theme={theme}>
      <header className="site-nav">
        <a className="brand" href="#top" aria-label="JARVIS home"><Mark /><span><b>JARVIS</b><small>PRIVATE LOCAL ASSISTANT</small></span></a>
        <nav aria-label="Primary navigation"><a href="#inside">Inside JARVIS</a><a href="#builds">Custom builds</a><a href="#privacy">Privacy</a><a href="/jarvis-jr">JARVIS JR</a><a href="#contact">Contact</a></nav>
        <a className="nav-cta" href="https://github.com/Adamdesgns/jarvis-local-assistant/releases/latest" target="_blank" rel="noreferrer">Get JARVIS <span>↗</span></a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> FREE · PRIVATE · WINDOWS</div>
          <h1>Your own JARVIS.<br /><em>On your PC.</em></h1>
          <p className="hero-lede">Voice, files, tasks, memory, and document intelligence—without an account, a subscription, or your life becoming someone else&apos;s data.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => { document.getElementById("command-center")?.scrollIntoView({ behavior: "smooth", block: "center" }); window.setTimeout(() => inputRef.current?.focus(), 650); }}>Enter command center <span>→</span></button>
            <a className="text-action" href="https://github.com/Adamdesgns/jarvis-local-assistant" target="_blank" rel="noreferrer">View the source ↗</a>
          </div>
          <div className="trust-row"><span><b>NO</b> ACCOUNT</span><i /><span><b>NO</b> TELEMETRY</span><i /><span><b>NO</b> SUBSCRIPTION</span></div>
        </div>
        <div className="hero-orb" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
          <div className="hero-orb-canvas"><PlasmaOrb theme={theme} coreState={coreState} /></div>
          <div className="orb-state"><small>{statusCopy[0]}</small><b>{statusCopy[1]}</b></div>
          <div className="orb-caption"><span /> LOCAL CORE ONLINE</div>
        </div>
        <div className="hero-rail"><span>01</span><p>PRIVATE BY<br />ARCHITECTURE</p><span>02</span><p>LOCAL BY<br />DEFAULT</p><span>03</span><p>YOURS BY<br />DESIGN</p></div>
      </section>

      <section className="command-section" id="inside">
        <div className="section-heading">
          <div><span className="section-number">01 / INTERACTIVE DEMO</span><h2>Don&apos;t just read about it.<br /><em>Give it a directive.</em></h2></div>
          <p>This is a safe browser simulation. It cannot hear you, inspect your computer, or connect to real cameras and devices.</p>
        </div>
        <div className="demo-shell" id="command-center">
          <div className="demo-topbar">
            <div className="demo-brand"><Mark /><b>JARVIS</b><small>PRIVATE LOCAL ASSISTANT</small></div>
            <div className="core-online"><span /> LOCAL CORE ONLINE</div>
            <div className="demo-controls"><button onClick={() => setDrawerOpen(!drawerOpen)} className={drawerOpen ? "active" : ""}>＋ MODULES</button><button onClick={() => setTourOpen(!tourOpen)}>◎ TOUR</button><button onClick={() => switchTheme(theme === "amber" ? "obsidian" : "amber")} aria-label="Switch orb palette">◐</button></div>
          </div>
          <div className="demo-workspace">
            <div className={`module-drawer ${drawerOpen ? "open" : ""}`}>
              <header><span>INTERFACE</span><b>MODULE LIBRARY</b><button onClick={() => setDrawerOpen(false)}>×</button></header>
              {([ ["tasks", "Today’s Tasks", "Work queue and reminders"], ["files", "File Explorer", "Approved folders only"], ["system", "PC Performance", "Local system status"], ["memory", "Memory", "Notes you control"] ] as [ModuleName, string, string][]).map(([name, label, desc]) => (
                <button key={name} onClick={() => { setActiveModule(name); setDrawerOpen(false); }} className={activeModule === name ? "selected" : ""}><i>{activeModule === name ? "✓" : "+"}</i><span><b>{label}</b><small>{desc}</small></span></button>
              ))}
              <div className="drawer-note">Drag-and-resize layouts live in the Windows app. This demo keeps the controls simple.</div>
            </div>
            {tourOpen && <aside className="tour-card"><span>GUIDED START · 01</span><button onClick={() => setTourOpen(false)} aria-label="Close tour">×</button><b>Try a real workflow</b><p>Ask JARVIS to find a manual. It will search only the folders you approved.</p><button className="tour-run" onClick={() => runCommand("Find my compressor manual")}>RUN THE DEMO →</button></aside>}
            <section className="demo-orb-stage"><div className="orb-grid" /><div className="demo-orb-wrap"><PlasmaOrb theme={theme} coreState={coreState} /></div><div className="demo-orb-status"><small>{statusCopy[0]}</small><b>{statusCopy[1]}</b></div></section>
            <section className="demo-module" data-module={activeModule}>
              <header><div><span>{activeModule === "tasks" ? "WORK QUEUE" : activeModule === "files" ? "LIVE SEARCH" : activeModule === "system" ? "TELEMETRY" : "KNOWLEDGE"}</span><h3>{activeModule === "tasks" ? "TODAY’S TASKS" : activeModule === "files" ? "FILE EXPLORER" : activeModule === "system" ? "PC PERFORMANCE" : "MEMORY"}</h3></div><b>—　×</b></header>
              {activeModule === "tasks" && <div className="task-list"><div className="module-stat"><b>{tasks.filter((task) => !task.done).length}</b> OPEN <span>LOCAL DATA</span></div>{tasks.map((task) => <button key={task.id} className={task.done ? "done" : ""} onClick={() => setTasks(tasks.map((item) => item.id === task.id ? { ...item, done: !item.done } : item))}><i>{task.done ? "✓" : ""}</i><span><b>{task.label}</b><small>{task.meta}</small></span></button>)}</div>}
              {activeModule === "files" && <div className="file-list"><div className="approved-label"><span>✓</span> APPROVED LOCATION · WORKSHOP</div><button><i>PDF</i><span><b>Compressor_Manual.pdf</b><small>C:\Workshop\Manuals · PAGE 14 MATCH</small></span></button><button><i>DOC</i><span><b>Service_Checklist.docx</b><small>C:\Workshop\Service</small></span></button><p>JARVIS cannot search outside folders you approve.</p></div>}
              {activeModule === "system" && <div className="system-grid"><div><span>CPU LOAD</span><b>18<small>%</small></b><i style={{ "--meter": "18%" } as React.CSSProperties} /></div><div><span>MEMORY</span><b>42<small>%</small></b><i style={{ "--meter": "42%" } as React.CSSProperties} /></div><div><span>LOCAL BRAIN</span><b className="system-word">READY</b></div><div><span>NETWORK CALLS</span><b className="system-word">0</b></div></div>}
              {activeModule === "memory" && <div className="memory-list"><div><b>“The shop opens at 7:00 AM.”</b><small>GENERAL · STORED LOCALLY</small></div><div><b>“Use the service checklist for every inspection.”</b><small>SHOP · STORED LOCALLY</small></div><p>Edit it. Search it. Forget it. Your memory stays under your control.</p></div>}
            </section>
            <div className="palette-switcher"><span>ORB PALETTE</span><button className={theme === "amber" ? "selected" : ""} onClick={() => switchTheme("amber")}><i className="amber-swatch" /> ORIGINAL AMBER</button><button className={theme === "obsidian" ? "selected" : ""} onClick={() => switchTheme("obsidian")}><i className="obsidian-swatch" /> OBSIDIAN PLASMA</button></div>
          </div>
          <div className="response-dock">
            <div className="jarvis-reply"><b>JARVIS</b><p>{reply}</p><button title="Copy simulated response">□</button></div>
            <form onSubmit={submitCommand}><button type="button" className="mic-button" onClick={() => runCommand("Give me my morning briefing")} aria-label="Simulate voice command">⌁</button><span>›</span><input ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Type a directive or say “Hey Jarvis”…" /><button type="submit">EXECUTE <span>↵</span></button></form>
            <div className="prompt-row"><span>TRY:</span><button onClick={() => runCommand("Find my compressor manual")}>Find my manual</button><button onClick={() => runCommand("Give me my morning briefing")}>Brief me</button><button onClick={() => runCommand("What stays local?")}>What stays local?</button><button onClick={() => runCommand("Show a custom camera wall")}>Custom camera wall</button></div>
          </div>
        </div>
      </section>

      <section className="capabilities" id="privacy">
        <div className="section-heading compact">
          <div><span className="section-number">02 / THE FREE ASSISTANT</span><h2>Useful on day one.<br /><em>Private every day after.</em></h2></div>
          <p>The free Windows app is the real product—not a trial. Local voice and open-ended local conversation need optional setup on your PC.</p>
        </div>
        <div className="capability-grid">
          {[
            ["01", "VOICE", "Say “Hey Jarvis” or press to talk. Wake word and speech recognition run on your machine."],
            ["02", "FILES", "Search only folders you approve. Read PDF, Word, Excel, CSV, and text."],
            ["03", "DOCUMENTS", "Ask your own documents questions and get answers cited to the page."],
            ["04", "TASKS + MEMORY", "Briefings, reminders, routines, and searchable notes you can edit or forget."],
            ["05", "YOUR CHOICE OF BRAIN", "Use Ollama locally, or add your own Claude or OpenAI key when you choose."],
            ["06", "SAFETY", "Sensitive actions ask first. Deletions go to the Recycle Bin. No silent spending or sending."],
          ].map(([num, title, copy]) => <article key={num}><span>{num}</span><div className="cap-icon"><i /><i /></div><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="custom-builds" id="builds">
        <div className="build-glow" />
        <div className="build-kicker">03 / BEYOND THE FREE APP</div>
        <div className="build-copy">
          <h2>One private assistant.<br /><em>Built around your world.</em></h2>
          <p>JARVIS is free. When you need more, we design custom private builds around your home, shop, office, electronics, cameras, and workflows.</p>
          <a href={`mailto:${contactEmail}?subject=Custom%20JARVIS%20build`}>Scope a custom build <span>→</span></a>
          <small>PRICING AVAILABLE UPON REQUEST</small>
        </div>
        <div className="build-map">
          <div className="map-core"><img src="/jarvis-core.svg" alt="" width="150" height="150" /><span>YOUR<br />JARVIS</span></div>
          {[
            ["SMART HOME", "LIGHTS · CLIMATE · ACCESS"],
            ["CAMERA WALL", "PRIVATE MULTI-VIEW"],
            ["SHOP + OFFICE", "FILES · ROUTINES · STATUS"],
            ["ELECTRONICS", "CUSTOM CONTROLS"],
          ].map(([title, copy], index) => <div className={`map-node node-${index + 1}`} key={title}><i /><span><b>{title}</b><small>{copy}</small></span></div>)}
        </div>
        <div className="custom-disclaimer">CUSTOM CAPABILITIES ARE SCOPED AND VALIDATED PER BUILD. THE CAMERA EXPERIENCE SHOWN ON THIS SITE IS A FICTIONAL PREVIEW.</div>
      </section>

      <section className="privacy-strip">
        <div><span>PRIVATE BY ARCHITECTURE</span><h2>The assistant that<br /><em>doesn&apos;t phone home.</em></h2></div>
        <div className="privacy-points">
          <article><span>01</span><p><b>Your data lives in one local folder.</b><br />Back it up, export it, or delete it.</p></article>
          <article><span>02</span><p><b>Cloud is an opt-in, not a trapdoor.</b><br />Only features you choose send data to the provider you choose.</p></article>
          <article><span>03</span><p><b>The code is open.</b><br />JARVIS is MIT-licensed and available to inspect on GitHub.</p></article>
        </div>
      </section>

      <section className="jr-bridge">
        <div className="jr-bridge-mark"><img src="/jarvis-jr-icon.png" alt="" /><span>JR</span></div>
        <div><span>MEET THE FAMILY EDITION</span><h2>JARVIS has a<br /><em>younger partner.</em></h2><p>JARVIS JR is a private assistant built for kids—with parent controls, Minecraft and Roblox expertise, games that use the camera, and a Call Dad button connected to the grown-up JARVIS.</p></div>
        <a href="/jarvis-jr">Meet JARVIS JR <span>→</span></a>
      </section>

      <section className="final-cta" id="contact">
        <div className="cta-orb"><PlasmaOrb theme={theme} coreState="ready" /></div>
        <span className="section-number">FREE · WINDOWS · LOCAL-FIRST</span>
        <h2>Your computer.<br /><em>Your data. Your JARVIS.</em></h2>
        <p>Download the free Windows assistant, or talk with us about a private custom build.</p>
        <div className="cta-actions"><a className="primary-action" href="https://github.com/Adamdesgns/jarvis-local-assistant/releases/latest" target="_blank" rel="noreferrer">Download free <span>↗</span></a><a className="text-action" href={`mailto:${contactEmail}?subject=JARVIS%20question`}>Email Adam →</a></div>
        <div className="contact-links" aria-label="Social contact links">
          {socialLinks.map((link) => <a key={link.label} href={link.href} target="_blank" rel="noreferrer" aria-label={`${link.label}: ${link.detail}`}><span>{link.label}</span><small>{link.detail}</small><b>↗</b></a>)}
        </div>
        <a className="contact-email" href={`mailto:${contactEmail}?subject=JARVIS%20question`}>{contactEmail}</a>
        <small>JARVIS IS FREE AND CURRENTLY UNSIGNED. WINDOWS SMARTSCREEN MAY SHOW “UNKNOWN PUBLISHER.” VERIFY THE PUBLISHED SHA-256 CHECKSUM.</small>
      </section>

      <footer>
        <div className="brand"><Mark /><span><b>JARVIS</b><small>PRIVATE LOCAL ASSISTANT</small></span></div>
        <p>Built for people who would rather own their tools than rent their attention.</p>
        <div className="footer-links"><a href="/jarvis-jr">JARVIS JR →</a><a href="https://github.com/Adamdesgns/jarvis-local-assistant" target="_blank" rel="noreferrer">GITHUB ↗</a><a href={`mailto:${contactEmail}`}>EMAIL ↗</a>{socialLinks.map((link) => <a key={link.label} href={link.href} target="_blank" rel="noreferrer">{link.label.toUpperCase()} ↗</a>)}</div>
        <small>© 2026 JARVIS · MIT LICENSED</small>
      </footer>
    </main>
  );
}

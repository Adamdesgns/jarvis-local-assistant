"use client";
/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages */

import { useEffect, useState } from "react";
import styles from "./JarvisJrDemo.module.css";

type DemoTab = "call" | "games";
type CallState = "ready" | "calling" | "incoming" | "connected";
type Throw = "ROCK" | "PAPER" | "SCISSORS";

const CONTACT_EMAIL = "lucedalelogo@yahoo.com";
const RELEASE_URL = "https://github.com/Adamdesgns/jarvis-jr/releases/latest";

const controls = [
  ["Homework help", true],
  ["Games", true],
  ["Call Dad", true],
  ["Files & documents", false],
  ["Web browser", false],
  ["House cameras", false],
] as const;

const beats: Record<Throw, Throw> = { ROCK: "PAPER", PAPER: "SCISSORS", SCISSORS: "ROCK" };
const hand: Record<Throw, string> = { ROCK: "✊", PAPER: "✋", SCISSORS: "✌️" };

export function JarvisJrDemo() {
  const [tab, setTab] = useState<DemoTab>("call");
  const [callState, setCallState] = useState<CallState>("ready");
  const [countdown, setCountdown] = useState(20);
  const [seconds, setSeconds] = useState(0);
  const [allowed, setAllowed] = useState(() => Object.fromEntries(controls) as Record<string, boolean>);
  const [round, setRound] = useState<{ kid: Throw; jarvis: Throw; copy: string } | null>(null);

  useEffect(() => {
    if (callState === "calling") {
      const timer = window.setTimeout(() => setCallState("connected"), 1300);
      return () => window.clearTimeout(timer);
    }
    if (callState === "incoming") {
      const timer = window.setInterval(() => {
        setCountdown((value) => {
          if (value <= 4) {
            window.clearInterval(timer);
            setSeconds(0);
            setCallState("connected");
            return 0;
          }
          return value - 4;
        });
      }, 650);
      return () => window.clearInterval(timer);
    }
  }, [callState]);

  useEffect(() => {
    if (callState !== "connected") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [callState]);

  const play = (kid: Throw) => {
    const jarvis = beats[kid];
    setRound({ kid, jarvis, copy: `${hand[jarvis]} I saw ${kid.toLowerCase()}. ${jarvis.toLowerCase()} wins this one.` });
  };

  const endDemoCall = () => { setSeconds(0); setCallState("ready"); };

  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <main className={styles.jrPage}>
      <header className={styles.nav}>
        <a className={styles.brand} href="/jarvis-jr" aria-label="JARVIS JR home"><img src="/jarvis-jr-icon.png" alt="" /><span><b>JARVIS JR</b><small>PRIVATE ASSISTANT FOR KIDS</small></span></a>
        <nav aria-label="JARVIS JR navigation"><a href="#play">Play</a><a href="#parents">For parents</a><a href="#family-calls">Call Dad</a><a href="/">Grown-up JARVIS</a></nav>
        <a className={styles.download} href={RELEASE_URL} target="_blank" rel="noreferrer">Download free ↗</a>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}><i /> FREE · WINDOWS · AGES 5–12</span>
          <h1>A JARVIS<br />built for <em>kids.</em></h1>
          <p>Homework help. Games. Minecraft and Roblox expertise. Strong parent controls. And one unmistakable button when they need you.</p>
          <div className={styles.actions}><button onClick={() => { setTab("call"); document.getElementById("jr-demo")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Try Call Dad <span>→</span></button><a href={RELEASE_URL} target="_blank" rel="noreferrer">Get JARVIS JR ↗</a></div>
          <div className={styles.trust}><span>NO ACCOUNT</span><span>NO SUBSCRIPTION</span><span>PARENT PIN</span></div>
        </div>

        <div className={styles.demo} id="jr-demo">
          <div className={styles.demoTop}><div><span className={styles.statusDot} /> JARVIS JR ONLINE</div><small>SAFE WEBSITE DEMO</small></div>
          <div className={styles.tabs}><button className={tab === "call" ? styles.activeTab : ""} onClick={() => setTab("call")}>📞 CALL DAD</button><button className={tab === "games" ? styles.activeTab : ""} onClick={() => setTab("games")}>✦ PLAY</button></div>

          {tab === "call" ? <div className={styles.callPanel}>
            {callState === "ready" && <>
              <div className={styles.orb}><span>JR</span><i /><i /><i /></div>
              <span className={styles.online}><i /> DAD&apos;S JARVIS IS ONLINE</span>
              <button className={styles.callDad} onClick={() => setCallState("calling")}>📞 <span>CALL DAD</span></button>
              <button className={styles.incomingPreview} onClick={() => { setCountdown(20); setCallState("incoming"); }}>Preview Dad calling me</button>
            </>}
            {callState === "calling" && <div className={styles.calling}><div className={styles.pulse}>📞</div><b>CALLING DAD…</b><span>Private paired connection</span></div>}
            {callState === "incoming" && <div className={styles.calling}><div className={styles.pulse}>DAD</div><b>DAD IS CALLING</b><strong>Answering by itself in {countdown}…</strong><span>This website preview speeds up the real 20-second countdown.</span><div><button onClick={() => { setSeconds(0); setCallState("connected"); }}>ANSWER</button><button onClick={endDemoCall}>NOT NOW</button></div></div>}
            {callState === "connected" && <div className={styles.connected}><div className={styles.videoGrid}><div><span>DAD</span><b>👨</b><small>JARVIS · PAIRED PC</small></div><div><span>ME</span><b>🧒</b><small>JARVIS JR · THIS PC</small></div></div><p><i /> PRIVATE FAMILY CALL · {time}</p><button onClick={endDemoCall}>END CALL</button></div>}
            <p className={styles.demoNote}>Simulation only. This page never turns on your camera or microphone.</p>
          </div> : <div className={styles.gamePanel}>
            <span className={styles.cameraPill}><i /> GAME CAMERA · ON THIS PC ONLY</span>
            <h2>Rock. Paper. Scissors.</h2>
            <p>In the Windows app, JARVIS JR watches your hand through the webcam, locks your throw, then reveals his own.</p>
            <div className={styles.throws}>{(["ROCK", "PAPER", "SCISSORS"] as Throw[]).map((choice) => <button key={choice} onClick={() => play(choice)}><b>{hand[choice]}</b><span>I threw {choice.toLowerCase()}</span></button>)}</div>
            <div className={styles.gameReply}>{round ? <><strong>JARVIS JR</strong><p>{round.copy}</p></> : <p>Pick a hand to simulate what the camera sees.</p>}</div>
            <small>Website simulation—no camera permission requested.</small>
          </div>}
        </div>
      </section>

      <section className={styles.games} id="play">
        <div className={styles.sectionLead}><span>01 / PLAY + LEARN</span><h2>Gaming genius.<br /><em>Still JARVIS.</em></h2><p>Specific answers, real strategy, and a built-in honesty rule: if he is not certain about a recipe, number, or game mechanic, he says so.</p></div>
        <div className={styles.gameCards}>
          <article><span>⛏</span><small>RESIDENT EXPERT</small><h3>MINECRAFT</h3><p>Crafting, redstone, farms, mobs, builds, survival strategy, and the exact question your kid is stuck on.</p><button onClick={() => setRound({ kid: "ROCK", jarvis: "PAPER", copy: "For a first-night shelter: get wood, make a crafting table, then secure light, food, and a bed before exploring." })}>Ask a sample question →</button></article>
          <article><span>⬡</span><small>RESIDENT EXPERT</small><h3>ROBLOX</h3><p>Game mechanics, strategy, ideas, and clear explanations without turning JARVIS into a noisy hype channel.</p><a href="#jr-demo" onClick={() => setTab("games")}>Open the game demo →</a></article>
          <article><span>✊</span><small>BUILT-IN GAME</small><h3>CAMERA RPS</h3><p>Say the chant, throw a real hand, and JARVIS JR reads it locally through the webcam before revealing his move.</p><a href="#jr-demo" onClick={() => setTab("games")}>Play the simulation →</a></article>
          <article><span>×○</span><small>BUILT-IN GAME</small><h3>TIC TAC TOE</h3><p>Easy, normal, and hard modes that genuinely change how he plays. Scores and best streaks survive a restart.</p><a href={RELEASE_URL} target="_blank" rel="noreferrer">Play in the app ↗</a></article>
        </div>
      </section>

      <section className={styles.parents} id="parents">
        <div className={styles.parentCopy}><span>02 / THE PARENT LAYER</span><h2>You decide what<br /><em>JR can reach.</em></h2><p>A parent sets the PIN, birthdate, and exact capability checklist first. Controls are checked in the app—not left to the AI to remember.</p><ul><li>Age-aware replies that adjust as they grow</li><li>Dangerous or grown-up topics blocked before the AI answers</li><li>Files, browser, terminal, cameras, and apps off by default</li><li>Its own installer and local data—separate from adult JARVIS</li></ul></div>
        <div className={styles.controlPanel}>
          <header><span>🔒 PARENT PIN VERIFIED</span><b>WHAT JR CAN USE</b></header>
          {controls.map(([label]) => <button key={label} onClick={() => setAllowed((current) => ({ ...current, [label]: !current[label] }))}><span><b>{label}</b><small>{allowed[label] ? "ALLOWED BY PARENT" : "OFF · NOT CONSTRUCTED"}</small></span><i className={allowed[label] ? styles.toggleOn : ""}><em /></i></button>)}
          <p>This is an interactive preview. Changes stay on this page.</p>
        </div>
      </section>

      <section className={styles.familyCalls} id="family-calls">
        <div><span>03 / JARVIS ↔ JARVIS JR</span><h2>One button.<br /><em>Dad&apos;s right there.</em></h2><p>Install JARVIS on Dad&apos;s PC and JARVIS JR on the kid&apos;s PC, pair them once, and the kid gets a clear Call Dad button. Calls travel over the family&apos;s private Tailscale connection—not a public social account.</p><small>FAMILY CALLS SHIPS IN v0.19.0. BOTH PCS MUST BE INSTALLED, PAIRED, AND ONLINE. THE TWO-PC LIVE CHECK IS STILL PENDING.</small></div>
        <div className={styles.callSteps}><article><b>01</b><span>PAIR ONCE</span><p>A parent enters a short code behind the PIN.</p></article><article><b>02</b><span>SEE DAD ONLINE</span><p>The button lights up only when the paired PC answers.</p></article><article><b>03</b><span>CALL OR ANSWER</span><p>Big controls, visible camera state, and a clear hang-up.</p></article></div>
      </section>

      <section className={styles.finalCta}>
        <img src="/jarvis-jr-icon.png" alt="JARVIS JR amber orb" />
        <span>FREE · PRIVATE · BUILT FOR WINDOWS</span><h2>Give them a JARVIS<br />of their <em>own.</em></h2>
        <p>Download JARVIS JR, or email Adam with a question about the family setup.</p>
        <div><a href={RELEASE_URL} target="_blank" rel="noreferrer">Download JARVIS JR ↗</a><a href={`mailto:${CONTACT_EMAIL}?subject=JARVIS%20JR%20question`}>Email Adam →</a></div>
        <a className={styles.backLink} href="/">← Explore grown-up JARVIS</a>
        <small>FREE AND CURRENTLY UNSIGNED. WINDOWS SMARTSCREEN MAY SHOW “UNKNOWN PUBLISHER.”</small>
      </section>

      <footer className={styles.footer}><div className={styles.brand}><img src="/jarvis-jr-icon.png" alt="" /><span><b>JARVIS JR</b><small>PRIVATE ASSISTANT FOR KIDS</small></span></div><p>Built for kids. Controlled by parents. Connected to family.</p><div><a href="/">JARVIS</a><a href={RELEASE_URL} target="_blank" rel="noreferrer">GITHUB</a><a href={`mailto:${CONTACT_EMAIL}`}>EMAIL</a></div></footer>
    </main>
  );
}

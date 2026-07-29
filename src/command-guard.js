// THE TERMINAL, stage 2 — the command classifier.
//
// Stage 1 refused every raw command. Stage 2 lets the USER run them (the AI
// still never gets arbitrary shell — see docs/ROADMAP.md hard rules), and this
// module is the boundary that decides what happens when they do.
//
// Built on screen-guard.js's mould: a deterministic tier, frozen compile-time
// denylists, and enforcement in code the main process calls rather than an
// instruction handed to a model. A rule a model is merely asked to honour is
// not a control.
//
// Three tiers, same vocabulary as screen-guard's classifyStep:
//   free    — read-only, runs immediately
//   approve — pauses for the confirm card
//   deny    — refused outright, no card offered
//
// THE LOAD-BEARING PROPERTY: anything not provably read-only lands on
// 'approve'. There is no explicit approve list, and that is deliberate —
// 'approve' is what you get by falling through, so a command nobody thought
// about asks instead of running. Adding a verb to FREE_PATTERNS is the only way
// to make something silent, and that requires editing shipping code.
//
// Dual export like terminal-log.js / skins.js: node:test requires it, the
// browser loads it as a classic <script> and reads window.JarvisCommandGuard.
(function () {
  'use strict';

  const TIERS = Object.freeze(['free', 'approve', 'deny']);

  const RANK = { free: 0, approve: 1, deny: 2 };

  // Refused outright — no confirm card, because there is no version of these
  // the answer is yes to. Frozen like screen-guard's FINANCIAL_DENY: a stray
  // DENY_PATTERNS.push() elsewhere throws instead of silently widening the hole.
  //
  // 'format' is deliberately NOT a bare \bformat\b — that would deny
  // `git log --format=short`, an ordinary read. It has to sit at the head of a
  // segment or be pointed at a drive.
  const DENY_PATTERNS = Object.freeze([
    // Disks, volumes and boot configuration
    /^format\b/i,
    /\bformat\s+[a-z]:/i,
    /\bdiskpart\b/i,
    /\bbcdedit\b/i,
    /\bfsutil\b/i,
    /\bcipher\s+\/w/i,
    /\bvssadmin\b/i,            // shadow-copy deletion is the ransomware tell
    /\bwbadmin\b/i,

    // Force-deletes and recursive wipes, in both dialects
    /\bdel\b[^\n]*\s\/f\b/i,
    /\berase\b[^\n]*\s\/f\b/i,
    /\brd\s+\/s\b/i,
    /\brmdir\s+\/s\b/i,
    /\brm\s+-\S*r\S*f/i,
    /\brm\s+-\S*f\S*r/i,
    /Remove-Item\b(?=[^\n]*-Recurse)(?=[^\n]*-Force)/i,

    // Registry and accounts
    /\breg\s+(?:add|delete|import|load|unload|copy|restore)\b/i,
    /\bregedit\b/i,
    /\bnet\s+user\b/i,
    /\bnet\s+localgroup\b/i,

    // Services, tasks and persistence
    /\bsc\s+(?:config|create|delete|stop|start|failure)\b/i,
    /\bschtasks\b/i,
    /\bicacls\b/i,
    /\btakeown\b/i,

    // Anti-forensics and security tampering
    /\bwevtutil\s+cl\b/i,
    /\bnetsh\s+advfirewall\b/i,
    /Set-MpPreference\b/i,
    /Set-ExecutionPolicy\b/i,
    /\bmsconfig\b/i,

    // Obfuscation and download-and-execute (living-off-the-land)
    /\s-{1,2}e(?:nc|ncodedcommand)\b/i,
    /Invoke-Expression\b/i,
    /\biex\b/i,
    /\bcertutil\b/i,
    /DownloadString\b/i,
    /DownloadFile\b/i,
    /\bmshta\b/i,
    /\brundll32\b/i,
    /\bregsvr32\b/i,

    // Elevation — JARVIS never escalates, it asks the human to
    /\brunas\b/i,
    /-Verb\s+RunAs\b/i,
    /\bsudo\b/i,

    // Ending the session out from under the user
    /\bshutdown\b/i,
    /\blogoff\b/i,
    /\brestart-computer\b/i,
    /\bstop-computer\b/i,
  ]);

  // Provably read-only. Anchored to the head of a segment so a safe verb can't
  // be used as a prefix to smuggle something else in. Everything absent from
  // this list falls through to 'approve' — that is the design, not an omission.
  const FREE_PATTERNS = Object.freeze([
    /^dir\b/i,
    /^ls\b/i,
    /^cd\b/i,
    /^pwd\b/i,
    /^cls$/i,
    /^clear$/i,
    /^tree\b/i,
    /^whoami\b/i,
    /^hostname\b/i,
    /^ver$/i,
    /^date$/i,
    /^time$/i,
    /^echo\b/i,
    /^type\b/i,
    /^cat\b/i,
    /^more\b/i,
    /^ipconfig\b/i,
    /^systeminfo\b/i,
    /^tasklist\b/i,
    /^netstat\b/i,
    /^where\b/i,
    /^which\b/i,
    /^findstr\b/i,

    // Read-only git. `find` is absent on purpose: harmless on Windows, but
    // `find . -delete` in a bash-flavoured shell is not.
    /^git\s+(?:status|log|diff|branch|show|remote|describe|blame|shortlog|rev-parse|ls-files|worktree\s+list)\b/i,
    /^git\s+config\s+--get\b/i,

    // Version probes, exact-match only
    /^(?:node|npm|npx|git|python|pip|dotnet)\s+(?:--version|-v)$/i,
    /^npm\s+(?:ls|list|outdated|view|info)\b/i,

    // Read-only PowerShell. Deliberately NOT a blanket /^Get-/ — Get-Credential
    // prompts for a password.
    /^Get-(?:ChildItem|Content|Location|Date|Process|Service|Item|Command)\b/i,
  ]);

  // Writing to disk changes the verdict even when the verb is read-only:
  // `echo hi` is free, `echo hi > boot.ini` is not.
  const REDIRECTION = /(?:^|[^>])>{1,2}(?!&)/;

  // Shell chaining operators. Splitting on these is what stops a free head from
  // smuggling a denied tail: `dir && format c:` must never read as `dir`.
  const SEPARATORS = /\s*(?:&&|\|\||[&;|])\s*/;

  function splitSegments(text) {
    return String(text || '')
      .split(SEPARATORS)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function classifySegment(segment) {
    const hit = DENY_PATTERNS.find((pattern) => pattern.test(segment));
    if (hit) return 'deny';
    if (REDIRECTION.test(segment)) return 'approve';
    if (FREE_PATTERNS.some((pattern) => pattern.test(segment))) return 'free';
    return 'approve';
  }

  function reasonFor(tier, segment) {
    if (tier === 'deny') {
      return `"${segment}" touches something JARVIS will not touch — disks, accounts, the registry, security settings or elevation. This one is refused outright, not held for approval.`;
    }
    if (tier === 'approve') {
      return `"${segment}" can change or delete something, so I will show you exactly what runs and wait for your go-ahead.`;
    }
    return '';
  }

  // Classify a whole command line. The worst segment decides: deny outranks
  // approve outranks free, regardless of order.
  function classifyCommand(text) {
    const command = String(text || '').trim();
    if (!command) return { tier: 'free', reason: '', command: '', segment: '' };

    const segments = splitSegments(command);
    if (!segments.length) return { tier: 'free', reason: '', command, segment: '' };

    let worst = 'free';
    let offender = segments[0];
    for (const segment of segments) {
      const tier = classifySegment(segment);
      if (RANK[tier] > RANK[worst]) {
        worst = tier;
        offender = segment;
      }
    }

    return {
      tier: worst,
      reason: reasonFor(worst, offender),
      command,
      segment: worst === 'free' ? '' : offender,
    };
  }

  const api = {
    TIERS,
    DENY_PATTERNS,
    FREE_PATTERNS,
    splitSegments,
    classifySegment,
    classifyCommand,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JarvisCommandGuard = api;
})();

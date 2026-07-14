// Lightweight update check against a public GitHub repo's latest release.
// No auto-install: it only reports whether a newer version was published.

function compareVersions(a, b) {
  const parse = (v) => String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate(currentVersion, repo, fetchImpl = fetch) {
  const fallback = { current: currentVersion, latest: null, updateAvailable: false, url: '' };
  // Skip the unset placeholder and anything that is not a real owner/repo.
  if (!repo || repo === 'OWNER/REPO' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return fallback;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'JARVIS-Local-Assistant' }
    });
    if (!response.ok) return fallback;
    const payload = await response.json();
    const latest = String(payload.tag_name || '').replace(/^v/i, '');
    if (!latest) return fallback;
    return {
      current: currentVersion,
      latest,
      updateAvailable: compareVersions(latest, currentVersion) > 0,
      url: payload.html_url || `https://github.com/${repo}/releases/latest`
    };
  } catch {
    // A failed check must never break startup or the UI.
    return fallback;
  }
}

module.exports = { compareVersions, checkForUpdate };

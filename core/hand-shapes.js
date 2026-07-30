'use strict';

// Pure classification of a MediaPipe hand — rock, paper, or scissors — from
// the 21 landmarks HandLandmarker emits. Pure on purpose: the camera, the
// worker, and MediaPipe itself are all unpluggable, but THIS is the part
// that decides who threw what, so it is the part the tests own. Fixture
// arrays in test/hand-shapes.test.js exercise it with no camera anywhere.
//
// Landmark indices (MediaPipe hand model, fixed): 0 wrist; 4 thumb tip;
// 8/6 index tip/pip; 12/10 middle tip/pip; 16/14 ring tip/pip;
// 20/18 pinky tip/pip.
//
// A finger counts as extended when its TIP sits meaningfully farther from
// the wrist than its PIP (middle joint) does. Distance-from-wrist, not
// y-direction, deliberately: a kid throws with the hand sideways, upside
// down, or lunging at the lens, and none of that changes the tip/pip ratio.
// The thumb is ignored entirely — kids throw rock with the thumb out and
// scissors with it tucked, and it carries no signal the four fingers don't.
const FINGERS = Object.freeze([
  { tip: 8, pip: 6 },   // index
  { tip: 12, pip: 10 }, // middle
  { tip: 16, pip: 14 }, // ring
  { tip: 20, pip: 18 }  // pinky
]);

// Tip must beat the pip's wrist-distance by 15%. Below that a half-curled
// finger reads as curled — strict on purpose, so a sloppy scissors with the
// ring finger drifting open still reads as scissors rather than paper.
const EXTENDED_RATIO = 1.15;

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function fingerExtended(landmarks, finger) {
  const wrist = landmarks[0];
  return dist(landmarks[finger.tip], wrist) > dist(landmarks[finger.pip], wrist) * EXTENDED_RATIO;
}

// 'rock' | 'paper' | 'scissors' | null. Null means "no confident read" and
// is a first-class answer: the round's stability gate simply waits for
// frames that do read, and the UI falls back to the buttons if none do.
function classifyHand(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;
  for (const point of landmarks) {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return null;
  }
  const extended = FINGERS.map((finger) => fingerExtended(landmarks, finger));
  const count = extended.filter(Boolean).length;
  if (count === 0) return 'rock';
  // Index + middle and nothing else: the one unambiguous scissors.
  if (count === 2 && extended[0] && extended[1]) return 'scissors';
  // Three or four fingers open reads as paper — a kid's paper often keeps
  // the pinky lazy, and no scissors extends the ring past the ratio gate.
  if (count >= 3) return 'paper';
  return null;
}

// Debounce across frames: fires only after `need` consecutive identical
// non-null reads. A null frame (occlusion, blur) neither counts nor resets —
// resetting on flicker would make a real read near-impossible in kid
// lighting — but a DIFFERENT shape starts the count over, so a hand caught
// mid-change can never bank frames from both shapes.
function createStableRead({ need = 3 } = {}) {
  let current = null;
  let run = 0;
  return {
    push(shape) {
      if (shape === null || shape === undefined) return null;
      if (shape === current) {
        run += 1;
      } else {
        current = shape;
        run = 1;
      }
      return run >= need ? current : null;
    },
    reset() {
      current = null;
      run = 0;
    }
  };
}

module.exports = { classifyHand, createStableRead, FINGERS, EXTENDED_RATIO };

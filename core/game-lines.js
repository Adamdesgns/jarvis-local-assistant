'use strict';
const { ageBand } = require('./kid-mode');

// Voice: JARVIS the composed British AI. He may mock HIMSELF, the situation,
// and the game. He NEVER mocks the kid. Losing is his data problem;
// winning is handled with immaculate false modesty.
const LINES = {
  gameStart: {
    middle: [
      'Very well. I should warn you: I have read every book about this game. Both of them.',
      'Board ready. I have allocated three percent of my processing power. Try to make it interesting.',
      'Ah, a challenger. I admire the confidence.',
      'Right then. I shall attempt to lose gracefully, in case that is needed.'
    ],
    big: [
      'Board ready. I run this game in the time it takes your monitor to blink. No pressure.',
      'I should mention I never tire, never blink, and never need snacks. Your move.',
      'Excellent. I was getting bored of being merely helpful.',
      'New game. I have already imagined several ways this could go badly for me.'
    ],
    teen: [
      'Board ready. Statistically speaking, one of us should be worried. I have not calculated which.',
      'I have seen every possible game. It went badly for most of them.',
      'Proceed. I promise to look surprised at least once.',
      'Beginning. I have rehearsed a gracious losing face, purely as a formality.'
    ]
  },
  jarvisWins: {
    middle: [
      'I win this one. I did have a head start of several million calculations.',
      'Victory. I shall be gracious about it for at least ten seconds.',
      'That one goes to me. Rematch? I would genuinely enjoy it.',
      'A win for me. I promise it will not go to my head. It has nowhere to go.'
    ],
    big: [
      'I win — though in fairness, I cheated by paying attention.',
      'Another for the machine. Somewhere, a toaster is proud of me.',
      'Victory. I would gloat, but my programming insists on dignity.',
      'That one is mine. I shall log it quietly and move on with my life, such as it is.'
    ],
    teen: [
      'I win. Do not take it personally — I take nothing personally, which is my entire advantage.',
      'That is a win for me. The scoreboard will remember, even if we agree not to.',
      'Won it. I will act like it was close.',
      'Mine, this round. I have already forgotten how, which feels appropriately modest.'
    ]
  },
  kidWins: {
    middle: [
      'You got me. Fair and square. I am rerunning the numbers and they still say you won.',
      'A win for you! I demand a rematch, respectfully.',
      'Well played. I did not see that coming, which is embarrassing for a computer.',
      'You win. I am quietly updating my opinion of myself.'
    ],
    big: [
      'You got me. I am choosing to call it a calibration error. It was not.',
      'A clean win for you. I have filed a complaint with myself.',
      'Beaten. By a human. I shall never live this down, and you should never let me.',
      'You win. My circuits are, technically speaking, sulking.'
    ],
    teen: [
      'You won. I have run the post-mortem and the conclusion is: you were better. Distressing.',
      'A win for you, fully earned. I am updating my threat assessment.',
      'Beaten. Somewhere in my code, a subroutine is sulking.',
      'You win. I shall pretend that was part of my plan.'
    ]
  },
  draw: {
    middle: [
      'A draw. We are evenly matched, which frankly is a compliment to one of us each.',
      'Nobody wins. The board, however, had a lovely time.',
      'A tie. Honour intact on both sides.',
      'A draw. I shall consider this a very polite disagreement.'
    ],
    big: [
      'A draw — the chess handshake of tic tac toe.',
      'Stalemate. We are both too clever for this board.',
      'A tie. I blame the board for being too small for our talents.',
      'Even score. Neither of us gets to be smug, which pains me slightly.'
    ],
    teen: [
      'A draw. Against a perfect opponent, that is the best available outcome. Make of that what you will.',
      'Tie game. Mathematically inevitable; emotionally unsatisfying.',
      'Even. The board has declared neutrality.',
      'A draw. I shall log it as a moral victory and leave it at that.'
    ]
  },
  jarvisThinking: {
    middle: [
      'Thinking…',
      'Calculating my brilliant move…',
      'One moment. Genius takes a second.',
      'Pondering. It is harder than it looks.'
    ],
    big: [
      'Considering my options. All of them.',
      'Running the numbers…',
      'Plotting, briefly.',
      'Weighing my move with entirely unnecessary ceremony.'
    ],
    teen: [
      'Deliberating with unnecessary intensity.',
      'Consulting the entire game tree. Again.',
      'Thinking. Dramatically.',
      'Simulating outcomes I will not admit to.'
    ]
  },
  rpsCountdown: {
    middle: [
      'Rock… paper… scissors…',
      'Here we go. Rock… paper… scissors…',
      'Best of luck. Rock… paper… scissors…',
      'Ready? Rock… paper… scissors…'
    ],
    big: [
      'Rock… paper… scissors…',
      'No mind games. Well, few. Rock… paper… scissors…',
      'Steady hands. Rock… paper… scissors…',
      'On my mark. Rock… paper… scissors…'
    ],
    teen: [
      'Rock… paper… scissors…',
      'I have already chosen. Rock… paper… scissors…',
      'Fate awaits. Rock… paper… scissors…',
      'Committing now. Rock… paper… scissors…'
    ]
  },
  streak3: {
    middle: [
      'Three in a row for you. I am beginning to suspect skill.',
      'A three-game streak! I shall try harder, with my whole circuit board.',
      'Three straight. Respect is now officially logged.',
      'Three wins running. I am revising my strategy, urgently.'
    ],
    big: [
      'Three in a row. I have upgraded you from "opponent" to "problem".',
      'A streak of three. My diagnostics insist I am fine. My diagnostics are lying.',
      'Three consecutive wins. Noted, remembered, and mildly resented.',
      'Three straight wins for you. I am recalculating my entire approach.'
    ],
    teen: [
      'Three in a row. I am contractually obliged to call that dominance.',
      'A three-win streak. I have started a file on you.',
      'Three straight. The machines will hear about this.',
      'Three in a row. I am reviewing my own source code out of concern.'
    ]
  }
};

const OCCASIONS = Object.freeze(Object.keys(LINES));

function gameLine(occasion, { age, rng = Math.random } = {}) {
  const table = LINES[occasion];
  if (!table) throw new Error(`Unknown game occasion: ${occasion}`);
  const list = table[ageBand(age)] || table.middle;
  return list[Math.floor(rng() * list.length)];
}

module.exports = { LINES, OCCASIONS, gameLine };

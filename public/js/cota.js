// Circuit of the Americas (Austin) centreline for Podium 2027 race views.
// Generated from an analytic layout (straights, arcs, eased esses); no external data.
// Use with SVGPathElement.getTotalLength()/getPointAtLength(s * total) to place car dots.
// Fractions (s) are measured from the start/finish line in the direction of travel (anticlockwise).

export const COTA_VIEWBOX = "0 0 1000 600";
export const COTA_LENGTH_M = 5513;
export const COTA_LAPS = 56;
export const COTA_DIRECTION = "anticlockwise";

export const COTA_PATH_D =
  "M 860 290 C 860 236.7 860 183.3 860 130 C 860 116.9 851.5 105.3 839 101.4 C 826.5 97.5 812.9 102.1 805.4 112.8 C 802.7 116.6 800.1 120.4 797.4 124.3 C 790.7 133.8 782 141.8 771.9 147.7 C 740.4 165.8 729.4 146.8 698 164.9 C 660.8 186.4 684.3 227.1 647.2 248.5 C 610 270 585 226.7 547.9 248.1 C 510.7 269.6 535.7 312.9 498.6 334.3 C 467.1 352.5 444.6 313.5 413.2 331.6 C 381.8 349.8 403.8 387.9 372.3 406 C 340.9 424.2 318.9 386.1 287.5 404.2 C 256 422.4 262 432.8 230.6 450.9 C 213.4 460.8 213.4 460.8 196.3 470.7 C 185.3 477.1 176.6 486.7 171.5 498.3 C 167.9 506.3 168.6 515.6 173.4 523 C 178.2 530.4 186.4 534.9 195.2 534.9 C 352.5 534.9 509.7 534.9 667 534.9 C 672.5 534.9 677.7 532.2 680.8 527.7 C 684 523.1 684.7 517.4 682.9 512.2 C 681.1 507.3 679.3 502.4 677.5 497.5 C 675.1 490.9 677.1 483.4 682.5 478.8 C 685.9 476.1 689.2 473.3 692.5 470.5 C 697.5 466.3 699.4 459.4 697.1 453.2 C 695.6 449.1 694.2 445.1 692.7 441 C 691.4 437.4 689.5 434.1 687 431.2 C 686.5 430.5 685.8 429.9 685.1 429.3 C 681 425.9 676.9 422.5 672.9 419 C 650.1 400 643.5 367.8 656.8 341.3 C 670.1 314.8 699.9 300.9 728.8 307.7 C 757.6 314.6 778 340.3 778 370 C 778 382 778 394 778 406 C 778 430.3 797.7 450 822 450 C 824.7 450 827.3 450 830 450 C 846.6 450 860 436.6 860 420 C 860 376.7 860 333.3 860 290 Z";

// Apex positions as fractions of the lap (hand: L = left-hander, R = right-hander).
export const COTA_TURNS = [
  { n: 1, label: "T1", s: 0.0860, hand: "L" },
  { n: 2, label: "T2", s: 0.1162, hand: "R" },
  { n: 3, label: "T3", s: 0.1573, hand: "L" },
  { n: 4, label: "T4", s: 0.2013, hand: "R" },
  { n: 5, label: "T5", s: 0.2462, hand: "L" },
  { n: 6, label: "T6", s: 0.2911, hand: "R" },
  { n: 7, label: "T7", s: 0.3298, hand: "L" },
  { n: 8, label: "T8", s: 0.3682, hand: "R" },
  { n: 9, label: "T9", s: 0.4066, hand: "L" },
  { n: 10, label: "T10", s: 0.4641, hand: "L" },
  { n: 11, label: "T11", s: 0.4836, hand: "L" },
  { n: 12, label: "T12", s: 0.7068, hand: "L" },
  { n: 13, label: "T13", s: 0.7251, hand: "R" },
  { n: 14, label: "T14", s: 0.7394, hand: "L" },
  { n: 15, label: "T15", s: 0.7547, hand: "L" },
  { n: 17, label: "T17", s: 0.8181, hand: "R" },
  { n: 19, label: "T19", s: 0.9045, hand: "L" },
  { n: 20, label: "T20", s: 0.9333, hand: "L" },
];

// Two drag-reduction straights (2026+ regulations call them Straight Mode zones; same straights):
// zone 1 along the back straight from ~250 m after T11 to the T12 braking zone,
// zone 2 up the pit straight from ~80 m after T20, through the start/finish line, to the T1 braking zone.
// A zone whose end is > 1 wraps through s = 0.
export const COTA_DRS_ZONES = [
  [0.5402, 0.6871],
  [0.9580, 1.0514],
];

// Sector boundaries (approximate timing-line positions: end of S1 after T9, end of S2 after T15).
export const COTA_SECTORS = [0.4186, 0.7727];

export const wrapS = (s) => ((s % 1) + 1) % 1;
export const sectorAt = (s) => { const f = wrapS(s); return f < COTA_SECTORS[0] ? 1 : f < COTA_SECTORS[1] ? 2 : 3; };
export const inDrsZone = (s) => {
  const f = wrapS(s);
  return COTA_DRS_ZONES.some(([a, b]) => (b <= 1 ? f >= a && f <= b : f >= a || f <= b - 1));
};

// Ticker facts for the race screen: widely published circuit facts, phrased for the room.
export const COTA_FACTS = [
  "The Circuit of the Americas opened in 2012 as the first purpose-built Grand Prix circuit in the United States.",
  "56 laps of 5.513 km: about 308 km of racing.",
  "The run up to Turn 1 climbs about 40 metres, the steepest approach to a first corner on the calendar.",
  "Turn 1 is a blind hairpin at the crest: the widest braking zone opens up lines for an overtake.",
  "Turns 3 to 6 are fast esses inspired by Silverstone's Maggotts and Becketts.",
  "The back straight from Turn 11 to Turn 12 is over a kilometre long: the main overtaking zone.",
  "Turns 16 to 18 are a long multi-apex left that loads the front-right tyre.",
  "COTA runs anticlockwise, with 11 left-handers and 9 right-handers.",
  "Austin's autumn heat makes tyre degradation and cooling the story of most races here.",
  "The circuit is bumpy in the braking zones: teams soften the set-up and lose some aero efficiency.",
]

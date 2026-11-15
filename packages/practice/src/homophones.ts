/**
 * Words that sound the same. A transcript can't tell which one the reader meant, so reading
 * "their" where the passage has "there" counts as read correctly.
 */
const SETS = `
to too two | there their they're theyre | here hear | your you're youre | its it's | whose who's whos
by buy bye | know no | knew new | knows nose | right write rite | see sea | for four fore | one won
son sun | whole hole | hour our | through threw | wait weight | way weigh | weak week | wear where ware
which witch | wood would | be bee | bare bear | brake break | cell sell | cent scent sent | die dye
dear deer | fair fare | flour flower | hair hare | heal heel | heard herd | him hymn | idle idol
knight night | knot not | made maid | mail male | main mane | meat meet | morning mourning | none nun
oar or ore | pair pear pare | pause paws | peace piece | plain plane | pray prey | principal principle
rain reign rein | road rode rowed | role roll | root route | sail sale | scene seen | sew so sow
sight site cite | sole soul | some sum | stair stare | steal steel | tail tale | tide tied | toe tow
vain vein vane | waist waste | weather whether | allowed aloud | altar alter | ate eight | bored board
coarse course | council counsel | great grate | groan grown | guest guessed | higher hire | passed past
patience patients | presence presents | profit prophet | raise rays | rap wrap | ring wring | soar sore
stationary stationery | straight strait | suite sweet | throne thrown | wholly holy | bough bow
practise practice | license licence | defence defense | offence offense | pretence pretense
in inn | i eye aye | you ewe | we wee | all awl | air heir | ball bawl | beat beet | blew blue
ceiling sealing | cereal serial | creak creek | days daze | dew due | earn urn | feat feet | fir fur
find fined | hall haul | hi high | hoarse horse | lessen lesson | loan lone | manner manor | mind mined
miner minor | missed mist | pail pale | peak peek | pole poll | poor pour pore | sea see | seam seem
shone shown | side sighed | soared sword | tacks tax | team teem | tern turn | told tolled | wade weighed
wail whale | warn worn | whine wine | yoke yolk | lain lane | lie lye | base bass | berth birth
`;

const CANON = new Map<string, string>();
for (const set of SETS.split(/[|\n]/)) {
  const words = set.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/'/g, ""));
  for (const w of words) if (!CANON.has(w)) CANON.set(w, words[0]);
}

/**
 * One spelling for every word that sounds like this one, or undefined when the word has no
 * sound-alike listed; plurals follow their singular ("boughs", "bows").
 */
export function soundAlike(word: string): string | undefined {
  const whole = CANON.get(word);
  if (whole) return whole;
  if (word.length > 3 && word.endsWith("s")) {
    const stem = CANON.get(word.slice(0, -1));
    if (stem) return `${stem}s`;
  }
  return undefined;
}

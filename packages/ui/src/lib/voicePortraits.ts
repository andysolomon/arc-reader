import { voiceServiceColor, voiceSourceForEngine } from "../../../tokens/src/voices";
import type { Voice } from "./types";

export type PortraitVoice = Pick<Voice, "name" | "hue" | "engine"> & Partial<Pick<Voice, "id" | "tags" | "description" | "archetype" | "gender" | "age" | "kind">>;
export type Hair = "wave" | "crop" | "bob" | "curls" | "sweep" | "bun" | "long" | "coils" | "quiff" | "bald" | "braid" | "ponytail" | "pixie" | "locs" | "sidepart" | "mohawk";
export type Expression = "warm" | "calm" | "bright" | "serious" | "soft" | "expressive";
export type Accessory = "none" | "glasses" | "earrings" | "headphones" | "scarf" | "beard" | "bowtie" | "round-glasses" | "stubble" | "hairclip" | "pendant" | "bandana" | "cap";
export type Character = "human" | "demon" | "pirate" | "fairy" | "elf" | "ogre" | "wizard" | "mermaid" | "ghost" | "knight" | "queen" | "monster" | "dragon" | "robot";
export interface Portrait {
  presentation: "male" | "female" | "neutral";
  hair: Hair;
  expression: Expression;
  accessory: Accessory;
  character: Character;
  skin: string;
  hairColor: string;
  background: string;
  halo: string;
  clothing: string;
  accent: string;
  /** Art direction, not a claim about the real speaker's appearance. */
  concept: string;
}

const palettes = {
  apricot: ["#F3D5B8", "#FFEAD4", "#A8503C", "#F8C87A"],
  sage: ["#C9D8C6", "#E4EBDD", "#38645C", "#D4BA77"],
  sky: ["#C7DDE7", "#E2F0EF", "#345777", "#E8B577"],
  lilac: ["#D9CDE7", "#EDE4F3", "#68507F", "#E9B6B5"],
  rose: ["#E9C8CB", "#F9E1DA", "#9B4960", "#F4C695"],
  gold: ["#E8D5A1", "#F9EDC9", "#71613B", "#C56B42"],
  ocean: ["#BBD9D6", "#DCF0E9", "#2C636D", "#E7B76D"],
  dusk: ["#BFC7DC", "#DCE1EE", "#41445F", "#C8A6D8"],
} as const;
const skins = ["#F3C8A5", "#DFA579", "#B97851", "#89543E", "#613D32", "#EBC0A9", "#C58C6B", "#A56B50"];
const hairColors = ["#302A31", "#51362E", "#8B4A32", "#C18B48", "#DFCFB3", "#68606B", "#382C24", "#9B5A43"];
// Character art direction for explicitly described voices, not assumptions about real speakers.
const hairstyles: Record<Portrait["presentation"], Hair[]> = {
  male: ["crop", "sweep", "curls", "quiff", "sidepart", "locs", "mohawk"],
  female: ["wave", "bob", "curls", "bun", "long", "coils", "braid", "ponytail", "pixie"],
  neutral: ["crop", "sweep", "curls", "quiff", "sidepart", "pixie", "locs"],
};
const expressions: Expression[] = ["warm", "calm", "bright", "serious", "soft", "expressive"];
const accessories: Record<Portrait["presentation"], Accessory[]> = {
  male: ["none", "glasses", "headphones", "scarf", "beard", "bowtie", "round-glasses", "stubble", "bandana", "cap"],
  female: ["none", "glasses", "earrings", "headphones", "scarf", "round-glasses", "hairclip", "pendant", "bandana"],
  neutral: ["none", "glasses", "headphones", "scarf", "round-glasses", "bandana", "cap"],
};
type Palette = keyof typeof palettes;
type Direction = [hair: Hair, expression: Expression, palette: Palette, skin: number, hairColor: number, accessory: Accessory, concept: string, character?: Character];

/** Each built-in voice has its own art direction. Keys include the engine, not the display name. */
export const VOICE_PORTRAITS: Record<string, Direction> = {
  "kittentts:expr-voice-2-f": ["wave", "warm", "apricot", 2, 1, "earrings", "An inviting fireside storyteller"],
  "kittentts:expr-voice-2-m": ["sweep", "calm", "sage", 0, 1, "scarf", "An unhurried companion with a soft knitted scarf"],
  "kittentts:expr-voice-3-f": ["bob", "bright", "sky", 5, 0, "earrings", "A clear, sunlit presence with a neat bob"],
  "kittentts:expr-voice-3-m": ["crop", "serious", "gold", 3, 0, "glasses", "An attentive documentary guide"],
  "kittentts:expr-voice-4-f": ["bun", "soft", "lilac", 1, 6, "scarf", "A gentle reader wrapped in lavender"],
  "kittentts:expr-voice-4-m": ["bald", "calm", "dusk", 4, 0, "beard", "A grounded bass voice with a generous silhouette"],
  "kittentts:expr-voice-5-f": ["coils", "expressive", "rose", 3, 0, "headphones", "A lively podcast host with big curls"],
  "kittentts:expr-voice-5-m": ["quiff", "warm", "ocean", 6, 1, "headphones", "An easygoing studio host"],
  "supertonic3:M1": ["sweep", "warm", "sky", 1, 6, "none", "A welcoming everyday guide"],
  "supertonic3:F3": ["long", "warm", "apricot", 6, 2, "scarf", "A warm conversational narrator"],
  "supertonic3:M3": ["sidepart", "serious", "ocean", 2, 0, "round-glasses", "A precise reader with oversized round spectacles"],
  "supertonic3:F4": ["curls", "bright", "gold", 3, 1, "earrings", "A bright, open expression framed by curls"],
  "supertonic3:M4": ["wave", "calm", "dusk", 0, 5, "beard", "A measured reader with silver at the temples"],
  "supertonic3:F5": ["bob", "soft", "sage", 5, 0, "none", "A quiet companion with soft sage tones"],
  "supertonic3:M5": ["mohawk", "expressive", "rose", 7, 6, "headphones", "An energetic host with a striking mohawk"],
  "openai:alloy": ["crop", "calm", "sky", 6, 5, "none", "A balanced, clean-lined guide"],
  "openai:ash": ["sidepart", "warm", "sage", 3, 0, "scarf", "A reassuring voice with a neat side part and forest-green scarf"],
  "openai:ballad": ["long", "soft", "lilac", 0, 2, "earrings", "A lyrical reader with flowing auburn hair"],
  "openai:coral": ["curls", "bright", "rose", 2, 1, "hairclip", "A smiling conversationalist with curls and bright hair clips"],
  "openai:echo": ["crop", "serious", "ocean", 4, 0, "beard", "A resonant, composed storyteller"],
  "openai:fable": ["wave", "expressive", "gold", 1, 2, "bowtie", "A theatrical storyteller with a rust bow tie"],
  "openai:nova": ["pixie", "bright", "lilac", 5, 0, "headphones", "A quick, luminous studio voice with a cropped pixie cut"],
  "openai:onyx": ["bald", "serious", "dusk", 3, 0, "scarf", "A deep narrator with a midnight collar"],
  "openai:sage": ["bun", "calm", "sage", 7, 5, "glasses", "A thoughtful documentary companion"],
  "openai:shimmer": ["wave", "bright", "apricot", 0, 3, "headphones", "A light, friendly voice in honey tones"],
  "openai:verse": ["coils", "expressive", "ocean", 4, 0, "earrings", "An expressive performer with sculptural curls"],
  "openai:coral~georgia": ["ponytail", "warm", "apricot", 5, 2, "earrings", "A relaxed smile beneath an auburn ponytail"],
  "fish:fish:933563129e564b19a115bedd57b7406a": ["sweep", "warm", "sage", 1, 1, "glasses", "A friendly, bookish narrator"],
  "fish:fish:d7988a7138db47cc8a4876a36625dff6": ["crop", "calm", "sky", 3, 0, "scarf", "An easygoing conversational companion"],
  "fish:fish:0724e14ccf884007a641908722575fdf": ["coils", "expressive", "apricot", 4, 0, "none", "An animated storyteller with a welcoming smile"],
  "phonon:phonon:Zoey": ["ponytail", "warm", "rose", 6, 1, "glasses", "A welcoming reader with a high ponytail and glasses"],
  "phonon:phonon:Juniper": ["curls", "calm", "sage", 2, 2, "glasses", "A thoughtful woodland-toned narrator"],
  "phonon:phonon:Everly": ["braid", "soft", "lilac", 0, 3, "scarf", "A dreamy reading companion with a loose braid and scarf"],
  "phonon:phonon:Harper": ["bob", "serious", "ocean", 3, 0, "glasses", "A crisp editorial presence"],
  "phonon:phonon:Hadley": ["bun", "bright", "gold", 5, 2, "earrings", "A cheerful companion with a tidy topknot"],
  "phonon:phonon:Delia": ["coils", "warm", "apricot", 4, 0, "scarf", "A warm, softly smiling storyteller"],
  "phonon:phonon:Easton": ["quiff", "bright", "sky", 1, 1, "none", "An upbeat guide with an open expression"],
  "phonon:phonon:Micah": ["curls", "soft", "sage", 7, 0, "none", "A relaxed, gentle companion"],
  "phonon:phonon:Trevor": ["crop", "expressive", "apricot", 0, 2, "headphones", "An animated conversational host"],
  "phonon:phonon:Russell": ["bald", "warm", "gold", 2, 1, "stubble", "A seasoned storyteller with close-cropped stubble"],
  "phonon:phonon:Preston": ["sweep", "serious", "dusk", 5, 6, "bowtie", "A composed, neatly tailored guide"],
  "phonon:phonon:Miles": ["locs", "calm", "ocean", 4, 0, "headphones", "A cool studio companion with long locs"],
  "phonon:phonon:Maeve": ["braid", "calm", "ocean", 0, 2, "earrings", "A reflective reader with an auburn side braid"],
  "phonon:phonon:Freya": ["long", "warm", "gold", 5, 4, "hairclip", "A sunny narrator with long pale hair and golden hair clips"],
  "phonon:phonon:Pippa": ["pixie", "expressive", "rose", 1, 1, "earrings", "A lively expression beneath a playful pixie cut"],
  "phonon:phonon:Elodie-Rose": ["bun", "soft", "rose", 3, 0, "pendant", "An elegant storyteller with a topknot and rose-gold pendant"],
  "phonon:phonon:Imogen": ["bob", "serious", "lilac", 0, 6, "round-glasses", "A thoughtful literary companion with a bob and round spectacles"],
  "phonon:phonon:Lottie": ["curls", "bright", "apricot", 5, 3, "headphones", "A bright companion with bouncy curls"],
  "phonon:phonon:Bryony": ["wave", "warm", "sage", 7, 2, "scarf", "A grounded, welcoming reader"],
  "phonon:phonon:Alfie": ["sidepart", "expressive", "gold", 0, 2, "none", "A playful conversational presence with a swept side part"],
  "phonon:phonon:Hugh": ["sweep", "calm", "ocean", 1, 5, "beard", "A silver-haired, steady narrator"],
  "phonon:phonon:Edwin": ["bald", "serious", "sage", 6, 5, "glasses", "An attentive, scholarly guide"],
  "phonon:phonon:Spencer": ["crop", "warm", "dusk", 3, 0, "bowtie", "A polished, friendly reading companion"],
  "phonon:phonon:Toby": ["curls", "bright", "sky", 5, 1, "bandana", "An approachable reader with tousled curls and a bandana"],
  "phonon:phonon:Teddy": ["wave", "soft", "apricot", 2, 6, "cap", "A cozy storyteller beneath a soft cap"],
  "phonon:phonon:Azgorath": ["quiff", "serious", "rose", 2, 0, "none", "An ember-red demon with sweeping horns", "demon"],
  "phonon:phonon:Captain Silas Blackwater": ["long", "expressive", "ocean", 2, 0, "beard", "A weathered captain with a tricorn and eye patch", "pirate"],
  "phonon:phonon:Fairy Godmother": ["bun", "warm", "lilac", 5, 4, "glasses", "A silver-haired fairy with tiny wings and a star", "fairy"],
  "phonon:phonon:Fennick the Young Elf": ["sweep", "bright", "sage", 1, 2, "none", "A bright young elf with leaflike ears", "elf"],
  "phonon:phonon:Grub the Ogre": ["bald", "warm", "sage", 3, 0, "none", "A moss-green ogre with small tusks and a big heart", "ogre"],
  "phonon:phonon:Master Aldric": ["long", "calm", "dusk", 0, 4, "beard", "An ancient wizard under a star-studded hat", "wizard"],
  "phonon:phonon:Morwenna of the Deep": ["long", "serious", "ocean", 3, 0, "earrings", "A sea sorceress with turquoise hair and a shell crown", "mermaid"],
  "phonon:phonon:Old Mortlake": ["sweep", "serious", "dusk", 0, 4, "none", "A spectral elder with hollow eyes and a high collar", "ghost"],
  "phonon:phonon:Sir Bramwell": ["crop", "warm", "sky", 2, 1, "beard", "A kindly knight in a silver helmet and armor", "knight"],
  "phonon:phonon:The Snow Queen": ["long", "serious", "sky", 5, 4, "earrings", "An icy sovereign with a crystal crown", "queen"],
  "phonon:phonon:The Thing Under the Stairs": ["coils", "expressive", "dusk", 4, 0, "none", "A curious furry creature with mismatched eyes", "monster"],
  "phonon:phonon:Vyrmathrax the Ancient": ["bald", "serious", "gold", 3, 0, "none", "An ancient jade dragon with gold horns", "dragon"],
  "local:local": ["crop", "warm", "sky", 0, 5, "none", "A friendly little offline reading robot", "robot"],
};

/** Distinct silhouettes for the featured Studio recipes; retained when saved as profiles.
 * Only applied while the recipe's explicit gender still matches its art direction. */
export const STUDIO_PORTRAITS: Record<string, [gender: Portrait["presentation"], hair: Hair, accessory: Accessory]> = {
  "feat_00_the_librarian": ["female", "bun", "round-glasses"],
  "feat_01_the_documentarian": ["male", "crop", "round-glasses"],
  "feat_02_the_calm_guide": ["female", "braid", "round-glasses"],
  "feat_03_the_storyteller": ["male", "quiff", "beard"],
  "feat_04_the_neighbor": ["female", "pixie", "none"],
  "feat_05_the_helpdesk": ["female", "bob", "headphones"],
  "feat_06_the_mate": ["male", "sidepart", "stubble"],
  "feat_07_the_companion": ["female", "pixie", "round-glasses"],
  "feat_08_captain_crusty": ["male", "mohawk", "bandana"],
  "feat_09_junior_quacks": ["neutral", "sweep", "bandana"],
  "feat_10_the_champion": ["male", "sweep", "headphones"],
  "feat_11_the_pixie": ["female", "bun", "headphones"],
  "feat_12_the_ogre": ["male", "quiff", "round-glasses"],
  "feat_13_the_podcaster": ["female", "pixie", "hairclip"],
  "feat_14_the_hype_host": ["male", "sweep", "round-glasses"],
  "feat_15_the_vlogger": ["female", "ponytail", "hairclip"],
  "feat_16_the_anchor": ["male", "locs", "cap"],
  "feat_17_the_commentator": ["male", "locs", "bowtie"],
  "feat_18_the_game_host": ["male", "quiff", "glasses"],
  "feat_19_the_promo_voice": ["male", "locs", "bandana"],
  "feat_20_the_luxe": ["female", "wave", "pendant"],
  "feat_21_the_upbeat": ["female", "long", "pendant"],
  "feat_22_the_teacher": ["female", "curls", "pendant"],
  "feat_23_the_explainer": ["male", "curls", "beard"],
  "ml_spanish_narrator": ["female", "ponytail", "round-glasses"],
  "ml_spanish_explainer": ["male", "locs", "glasses"],
  "ml_spanish_companion": ["female", "bob", "pendant"],
  "ml_french_narrator": ["female", "ponytail", "bandana"],
  "ml_french_explainer": ["male", "curls", "bowtie"],
  "ml_french_companion": ["female", "pixie", "bandana"],
  "ml_german_narrator": ["female", "long", "none"],
  "ml_german_explainer": ["male", "sidepart", "cap"],
  "ml_german_companion": ["female", "coils", "pendant"],
  "ml_italian_narrator": ["female", "coils", "hairclip"],
  "ml_italian_explainer": ["male", "quiff", "bandana"],
  "ml_italian_companion": ["female", "ponytail", "scarf"],
  "ml_portuguese_narrator": ["female", "long", "bandana"],
  "ml_portuguese_explainer": ["male", "locs", "beard"],
  "ml_portuguese_companion": ["female", "long", "round-glasses"],
  "ml_russian_narrator": ["female", "coils", "round-glasses"],
  "ml_russian_explainer": ["male", "mohawk", "glasses"],
  "ml_russian_companion": ["female", "wave", "bandana"],
  "ml_hindi_narrator": ["female", "braid", "bandana"],
  "ml_hindi_explainer": ["male", "curls", "cap"],
  "ml_hindi_companion": ["female", "long", "glasses"],
  "ml_japanese_narrator": ["female", "wave", "round-glasses"],
  "ml_japanese_explainer": ["male", "quiff", "bowtie"],
  "ml_japanese_companion": ["female", "pixie", "glasses"],
  "ml_korean_narrator": ["female", "long", "headphones"],
  "ml_korean_explainer": ["male", "quiff", "stubble"],
  "ml_korean_companion": ["female", "curls", "scarf"],
};

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

function personality(text: string, fallback: Expression): Expression {
  if (/\b(energetic|expressive|animated|theatrical|playful)\b/i.test(text)) return "expressive";
  if (/\b(bright|upbeat|cheerful|lively)\b/i.test(text)) return "bright";
  if (/\b(soft|gentle|whisper|soothing)\b/i.test(text)) return "soft";
  if (/\b(calm|measured|steady|relaxed)\b/i.test(text)) return "calm";
  if (/\b(deep|crisp|documentary|authoritative|serious)\b/i.test(text)) return "serious";
  if (/\b(warm|friendly|narrator|storyteller)\b/i.test(text)) return "warm";
  return fallback;
}

function characterFor(text: string): Character {
  const characters: [RegExp, Character][] = [
    [/\bdragon\b/i, "dragon"], [/\b(ogre|orc)\b/i, "ogre"], [/\bpirate\b/i, "pirate"],
    [/\b(wizard|sorcerer)\b/i, "wizard"], [/\bfairy\b/i, "fairy"], [/\b(elf|elven)\b/i, "elf"],
    [/\b(mermaid|sea witch)\b/i, "mermaid"], [/\b(ghost|spectral)\b/i, "ghost"],
    [/\bknight\b/i, "knight"], [/\b(snow queen|ice queen)\b/i, "queen"],
    [/\bdemon\b/i, "demon"], [/\bmonster\b/i, "monster"], [/\b(robot|robotic)\b/i, "robot"],
  ];
  return characters.find(([pattern]) => pattern.test(text))?.[1] ?? "human";
}

function presentationFor(gender: string | null | undefined, text: string): Portrait["presentation"] {
  // An explicit neutral/nonbinary value wins over prose. Auto/unknown permits a description fallback.
  const explicit = gender?.trim().toLowerCase();
  const source = explicit && !/^(auto|unknown|unspecified)$/.test(explicit) ? explicit : text;
  if (explicit === "neutral" || /\b(non[- ]?binary|gender[- ]neutral|androgynous)\b/i.test(source)) return "neutral";
  const male = /\b(male|man|masculine|boy)\b/i.test(source);
  const female = /\b(female|woman|feminine|girl)\b/i.test(source);
  return male === female ? "neutral" : male ? "male" : "female";
}

export function voicePresentation(voice: PortraitVoice): Portrait["presentation"] {
  return presentationFor(voice.gender, `${voice.tags?.join(" ") ?? ""} ${voice.description ?? ""}`);
}

export function voicePortrait(voice: PortraitVoice): Portrait {
  const direction = voice.id ? VOICE_PORTRAITS[`${voice.engine}:${voice.id}`] : undefined;
  // A gallery recipe keeps its identity when saved as a profile or moved to another Studio engine.
  const identity = voice.archetype ? `archetype:${voice.archetype}` : `${voice.engine ? voiceSourceForEngine(voice.engine) : "voice"}:${voice.id ?? voice.name}`;
  const pick = (part: string, length: number) => hash(`${identity}:${part}`) % length;
  const text = `${voice.tags?.join(" ") ?? ""} ${voice.description ?? ""}`;
  const presentation = direction ? "neutral" : voicePresentation(voice);
  const age = voice.age?.trim() && voice.age.toLowerCase() !== "auto" ? voice.age : text;
  const young = /\b(child|teenager|teen|young boy|young girl)\b/i.test(age);
  const elderly = /\b(elderly|senior)\b/i.test(age);
  const studioDirection = voice.archetype ? STUDIO_PORTRAITS[voice.archetype] : undefined;
  const studio = studioDirection?.[0] === presentation ? studioDirection : undefined;
  const hairOptions = hairstyles[presentation];
  const accessoryOptions = young ? accessories[presentation].filter((value) => value !== "beard" && value !== "stubble") : accessories[presentation];
  const expression = direction?.[1] ?? personality(text, expressions[pick("expression", expressions.length)]);
  const paletteName = direction?.[2] ?? ({ warm: "apricot", calm: "sage", bright: "gold", serious: "dusk", soft: "lilac", expressive: "rose" } as const)[expression];
  const [background, halo, clothing, accent] = palettes[paletteName];
  // The backdrop identifies the rendering service; the character keeps its own palette.
  const serviceColor = voice.engine ? voiceServiceColor(voiceSourceForEngine(voice.engine)) : undefined;
  return {
    presentation,
    hair: direction?.[0] ?? studio?.[1] ?? hairOptions[pick("hair", hairOptions.length)],
    expression,
    accessory: direction?.[5] ?? (studio && !(young && ["beard", "stubble"].includes(studio[2])) ? studio[2] : undefined) ?? accessoryOptions[pick("accessory", accessoryOptions.length)],
    character: direction ? direction[7] ?? "human" : characterFor(`${voice.name} ${text}`),
    skin: skins[direction?.[3] ?? pick("skin", skins.length)],
    hairColor: hairColors[direction?.[4] ?? (elderly ? 4 + pick("hairColor", 2) : pick("hairColor", hairColors.length))],
    background: serviceColor ?? background,
    halo: serviceColor ? `color-mix(in oklab, ${serviceColor} 25%, white)` : halo,
    clothing, accent,
    concept: direction?.[6] ?? `An original ${expression} reading companion`,
  };
}

/** Profiles retain their portrait when their speech engine changes. */
export function voiceAvatarIdentity(voice: PortraitVoice): string {
  return voice.archetype ? `archetype:${voice.archetype}` : `${voice.kind === "profile" ? "profile" : voice.engine ?? "voice"}:${voice.id ?? voice.name}`;
}

export function hasCuratedPortrait(voice: PortraitVoice): boolean {
  return !!(VOICE_PORTRAITS[`${voice.engine}:${voice.id}`] || (voice.archetype && STUDIO_PORTRAITS[voice.archetype]));
}

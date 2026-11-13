import type { Portrait } from "../lib/voicePortraits";

const ink = "#332D35";
const cream = "#FFF1DA";

/** Original vector portraits: broad silhouettes stay legible down to the 22px player chip. */
export function VoicePortrait({ portrait: p }: { portrait: Portrait }) {
  const { character, expression, hair, accessory } = p;
  const skin = character === "demon" ? "#C46A59" : character === "ogre" ? "#9BAE6F" : character === "ghost" ? "#CDD9D6" : p.skin;
  const hairColor = character === "mermaid" ? "#285E66" : p.hairColor;
  const long = hair === "long" || hair === "wave" || hair === "bob";
  const smile = expression === "warm" || expression === "bright" || expression === "expressive";
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" fill="none" aria-hidden="true" focusable="false" style={{ display: "block", borderRadius: "inherit" }}>
    <path fill={p.background} d="M0 0h100v100H0z" />
    <path fill={p.halo} d="M12 100V48a38 38 0 0 1 76 0v52Z" />
    <circle cx="84" cy="24" r="3" fill={p.accent} />
    <path d="M15 35v8m-4-4h8" stroke={p.clothing} strokeWidth="2" strokeLinecap="round" opacity=".35" />
    {character === "robot" ? <Robot p={p} /> : character === "dragon" ? <Dragon p={p} /> : character === "monster" ? <Monster p={p} /> : <>
      {character === "fairy" && <path d="M30 77C-1 46 2 95 35 93M70 77c31-31 28 18-5 16" fill="#F5EDF7" stroke={p.accent} strokeWidth="2" />}
      {long && <path d={hair === "bob" ? "M24 48c-2-42 54-43 53 0l4 30q-29 14-59 0Z" : "M25 49C17 7 78 5 77 46c-4 21 11 28 8 43H16c-5-17 12-21 9-40Z"} fill={hairColor} />}
      {hair === "coils" && <path d="M21 57C6 48 15 35 19 32c-7-13 9-21 17-19C44 1 56 9 60 11c16-6 27 6 23 16 14 9 12 22 2 28l-3 17H23Z" fill={hairColor} />}
      {hair === "bun" && <><circle cx="53" cy="18" r="14" fill={hairColor} /><path d="M38 17q15-10 26 1" stroke={cream} strokeOpacity=".18" strokeWidth="3" strokeLinecap="round" /></>}
      <path d="M9 104c2-23 13-28 30-31h22c18 3 29 8 31 31" fill={p.clothing} />
      <path d="m38 75 12 17 13-17" fill={p.accent} />
      <path d="M41 64h18v15q-9 10-18 0Z" fill={skin} />
      <path d="M41 66q9 7 18 0v7q-10 6-18 0Z" fill={ink} opacity=".12" />
      <path d="m37 75 13 17-15-6-4-8m32-3L50 92l16-6 4-8" fill={cream} opacity=".2" />
      <path d={character === "elf" || character === "ogre" ? "M33 45 14 34q0 23 20 23m33-12 19-11q0 23-20 23" : "M32 45c-12-6-13 13 0 14m36-14c12-6 13 13 0 14"} fill={skin} />
      <path d={expression === "serious" ? "M28 39q0-21 22-21t22 21l-3 21-10 13H41L30 60Z" : "M28 39q0-21 22-21t22 21l-2 17c-2 13-12 19-20 19s-18-6-20-19Z"} fill={skin} />
      <path d="M31 48v8c1 8 5 12 10 15-8-3-12-8-13-17Z" fill={ink} opacity=".09" />
      <HairFront hair={hair} color={hairColor} />
      {character === "demon" && <path d="M31 30C12 24 20 9 21 8c1 10 10 9 16 16m32 6C88 24 80 9 79 8c-1 10-10 9-16 16" fill="#50313D" />}
      <g stroke={ink} strokeWidth="2.2" strokeLinecap="round">
        {expression === "expressive" ? <><path d="m35 40 9-3m12 1 8 3" /><ellipse cx="40" cy="48" rx="2.5" ry="3.5" fill={ink} stroke="none" /><ellipse cx="60" cy="48" rx="2.5" ry="3.5" fill={ink} stroke="none" /></> : expression === "soft" || expression === "calm" ? <><path d="M35 41q5-2 9 0m12 0q5-2 9 0" opacity=".6" /><path d="M36 49q4-3 8 0m12 0q4-3 8 0" /></> : <><path d={expression === "serious" ? "m35 40 9 2m12 0 9-2" : "M35 40q5-3 9 0m12 0q5-3 9 0"} opacity=".7" /><path d="M40 47v3m20-3v3" strokeWidth="3.8" /></>}
      </g>
      <path d="m50 49-2 8h4" stroke={ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".3" />
      {smile && <g fill="#C66B65" opacity=".35"><ellipse cx="35" cy="57" rx="4" ry="2.5" /><ellipse cx="65" cy="57" rx="4" ry="2.5" /></g>}
      {expression === "bright" || expression === "expressive" ? <><path d="M41 61h18c-1 10-16 10-18 0" fill={ink} /><path d="M43 61h14v3H43Z" fill={cream} /></> : <path d={smile ? "M43 63q7 6 14 0" : expression === "soft" ? "M45 64q5 3 10 0" : "M44 64h12"} stroke={ink} strokeWidth="2" strokeLinecap="round" />}
      {character === "ogre" && <path d="m39 66 1-10 6 11m15-1-1-10-6 11" fill={cream} />}
      {accessory === "beard" && <path d="M30 54q4 4 6 9l6-5h16l6 5q3-5 6-9c1 17-10 24-20 24S29 71 30 54m12 7q8 12 16 0Z" fill={hairColor} fillRule="evenodd" />}
      {accessory === "glasses" && <g stroke={ink} strokeWidth="2" fill="none"><rect x="31" y="43" width="16" height="12" rx="5" /><rect x="53" y="43" width="16" height="12" rx="5" /><path d="M47 47h6m-25-1h3m38 0h3" /></g>}
      {accessory === "earrings" && <g stroke={p.accent} strokeWidth="3"><circle cx="28" cy="61" r="3" /><circle cx="72" cy="61" r="3" /></g>}
      {accessory === "scarf" && <><path d="M31 75q18 13 38 0l3 10q-22 12-43-1Z" fill={p.accent} /><path d="m55 86 13-1 5 19H57Z" fill={p.accent} /><path d="m34 81 18 5m9 5 7-1" stroke={p.clothing} strokeWidth="2" opacity=".35" /></>}
      {accessory === "bowtie" && <><path d="m50 85-12-7v14Zm0 0 12-7v14Z" fill={p.accent} /><circle cx="50" cy="85" r="3" fill={cream} /></>}
      {accessory === "headphones" && <><path d="M24 51v-9a26 26 0 0 1 52 0v9" stroke={p.clothing} strokeWidth="6" /><rect x="20" y="44" width="9" height="19" rx="4" fill={p.accent} /><rect x="71" y="44" width="9" height="19" rx="4" fill={p.accent} /></>}
      <Costume p={p} />
    </>}
  </svg>;
}

function HairFront({ hair, color }: { hair: Portrait["hair"]; color: string }) {
  const paths: Record<Portrait["hair"], string> = {
    wave: "M27 49C17 20 36 12 51 15c24-5 31 18 22 36l-6-18q-16 7-27-5-1 15-13 21Z",
    crop: "M27 44V31c0-24 48-24 47 0v14l-8-15q-15 5-31 0Z",
    bob: "M24 54V33c0-27 52-27 52 0v21h-7V34H32v20Z",
    curls: "M27 48c-13-6-10-19-3-22-3-12 9-19 19-14 7-10 19-4 21 1 14-5 24 9 16 18 8 8 0 16-7 17l-5-17q-8 7-17 0-9 7-16 0Z",
    sweep: "M26 46C16 25 29 13 47 14c11-8 30 0 30 17l-5 17-6-21q-12 16-36 11Z",
    bun: "M27 48C16 18 35 17 50 17s33 1 23 31l-8-19q-15 10-30 0Z",
    long: "M25 50C16 15 39 12 50 16c13-5 36 0 25 36l-8-18q-12-3-17-12-3 11-17 15l-3 18Z",
    coils: "M25 43c-8-8-5-17 3-19-1-12 12-15 19-9 8-10 19-5 21 3 11-2 18 9 11 17 4 9-2 15-8 14l-4-17q-6 8-15 2-11 8-18 0l-5 17Z",
    quiff: "M26 46C16 30 24 18 35 18c5-12 17-12 23-7 18-4 25 9 20 19l-6 17-5-18q-14 9-35 4Z",
    bald: "M28 39q-5 3-1 12l5-12Zm44 0q5 3 1 12l-5-12Z",
  };
  return <path d={paths[hair]} fill={color} />;
}

function Costume({ p }: { p: Portrait }) {
  switch (p.character) {
    case "pirate": return <><path d="M13 32 26 13l14 7q10-16 20 0l14-7 13 19q-35 10-74 0Z" fill={ink} stroke={p.accent} strokeWidth="2" /><path d="m48 23 6 6m0-6-6 6" stroke={cream} strokeWidth="2" /><path d="m30 39 39 16" stroke={ink} strokeWidth="2.5" /><path d="M32 43h15v7q-7 10-15 0Z" fill={ink} /></>;
    case "wizard": return <><path d="m26 31 23-29 23 29" fill={p.clothing} /><path d="M18 34q30-13 63 0" stroke={p.clothing} strokeWidth="8" strokeLinecap="round" /><path d="m48 11 1.5 4.5H54l-3.5 3 1 4.5-3.5-3-4 3 1-4.5-3-3h4.5Z" fill={p.accent} /><path d="M35 65q15 17 30 0L50 95Z" fill={p.hairColor} /></>;
    case "queen": return <><path d="m29 29-4-16 15 8L50 4l10 17 15-8-4 16Z" fill="#EDF7FA" stroke="#91BACA" strokeWidth="1.5" /><path d="m50 12 4 9-4 7-4-7Z" fill="#91BACA" /><path d="m31 72-12 6 15 18 9-10m26-14 12 6-15 18-9-10" fill="#EDF7FA" /></>;
    case "mermaid": return <><path d="M31 28q-8-18 6-14 4-16 13-2 10-14 14 2 13-4 5 14Z" fill={p.accent} /><path d="m38 19 4 8m8-10v10m12-8-4 8" stroke={p.clothing} strokeWidth="1.5" /></>;
    case "knight": return <><path d="M24 48V29c0-26 52-26 52 0v19l-8 8V33H32v23Z" fill="#8CABB8" /><path d="M50 10v20M28 31h44" stroke="#DCEAF0" strokeWidth="4" /><path d="m27 77 23 15 23-15 12 25H15Z" fill="#8CABB8" /><path d="m32 83 18 12 18-12" stroke="#DCEAF0" strokeWidth="3" /></>;
    case "fairy": return <><path d="M80 65 89 89" stroke={p.accent} strokeWidth="3" /><path d="m77 53 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill={p.accent} /></>;
    case "ghost": return <><path d="m32 83-12-21 19 12 11 21 11-21 19-12-12 21" fill={p.clothing} /><path d="m34 54 10 2m12 0 10-2" stroke="#7B8D94" strokeWidth="3" strokeLinecap="round" /></>;
    default: return null;
  }
}

function Robot({ p }: { p: Portrait }) {
  return <><path d="M18 103V87q0-16 18-16h28q18 0 18 16v16" fill={p.clothing} /><path d="M50 13v11" stroke={p.clothing} strokeWidth="4" /><circle cx="50" cy="12" r="5" fill={p.accent} /><rect x="18" y="38" width="64" height="22" rx="7" fill={p.accent} /><rect x="25" y="25" width="50" height="47" rx="15" fill={cream} /><rect x="31" y="34" width="38" height="26" rx="9" fill={p.clothing} /><path d="M39 44v5m22-5v5" stroke={cream} strokeWidth="4" strokeLinecap="round" /><path d="M44 54q6 4 12 0" stroke={p.accent} strokeWidth="2" strokeLinecap="round" /><rect x="39" y="81" width="22" height="12" rx="4" fill={p.accent} /><path d="M44 87h12" stroke={p.clothing} strokeWidth="2" /></>;
}

function Dragon({ p }: { p: Portrait }) {
  return <><path d="M10 100V69l21 15m59 16V69L69 84" fill="#597763" /><path d="M26 41 13 25l21 5m40 11 13-16-21 5" fill="#597763" /><path d="M32 30C13 22 24 5 28 5q-1 12 12 15m28 10C87 22 76 5 72 5q1 12-12 15" fill={p.accent} /><path d="M23 105V48q0-29 27-29t27 29v57" fill="#37665B" /><path d="m50 20-6 11 6 7 6-7Zm0 19-6 11 6 7 6-7Z" fill="#739879" /><path d="m31 45 13 4m12 0 13-4" stroke={ink} strokeWidth="3" strokeLinecap="round" /><path d="M33 51h10q-5 11-10 0m24 0h10q-5 11-10 0" fill={p.accent} /><rect x="29" y="59" width="42" height="25" rx="12" fill="#739879" /><path d="M38 68h1m22 0h1" stroke={ink} strokeWidth="4" strokeLinecap="round" /><path d="M39 77q11 5 22 0" stroke={ink} strokeWidth="2" /><path d="m34 78 3 10 5-8m24-2-3 10-5-8" fill={cream} /><path d="m38 87-5 18h34l-5-18" fill={p.accent} /><path d="M38 94h24m-26 7h28" stroke="#37665B" strokeWidth="2" opacity=".5" /></>;
}

function Monster({ p }: { p: Portrait }) {
  return <><path d="m17 100 4-20-10-4 9-12-9-5 12-12-4-13 14 2 2-18 15 10 12-16 5 18 16-6-4 18 12 4-10 16 10 10-11 5 5 23Z" fill={p.clothing} /><path d="m29 30-3-17 14 14m25 0 9-16-1 22" fill={p.accent} /><ellipse cx="39" cy="51" rx="12" ry="14" fill={cream} /><ellipse cx="65" cy="48" rx="9" ry="11" fill={cream} /><circle cx="42" cy="53" r="4" fill={ink} /><circle cx="63" cy="49" r="4" fill={ink} /><path d="M31 72q19-9 39-1-3 23-21 20-14-1-18-19" fill={ink} /><path d="m38 71 4 10 5-11m9 0 4 9 4-8" fill={cream} /><path d="m29 89-3 7m45-9 4 8M18 54l8 2" stroke={p.halo} strokeWidth="2" strokeLinecap="round" opacity=".45" /></>;
}

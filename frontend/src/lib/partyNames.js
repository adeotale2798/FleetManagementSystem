import Sanscript from "@indic-transliteration/sanscript";

const DEVANAGARI = /[\u0900-\u097f]/;
const WORD_OVERRIDES = {
  agarbatti: "अगरबत्ती",
  aniket: "अनिकेत",
  chandani: "चंदानी",
  chandmal: "चंदमल",
  chandnamal: "चंदनमल",
  general: "जनरल",
  hiralal: "हीरालाल",
  jadhav: "जधव",
  kasva: "कस्वा",
  kaswa: "कस्वा",
  patil: "पाटिल",
  rahul: "राहुल",
  bogande: "बोगांडे",
};

export function partyName(name, verifiedHindi, outputLanguage = "hi") {
  const original = name || "";
  if (outputLanguage === "en" || outputLanguage === "english") return original;
  if (DEVANAGARI.test(verifiedHindi || "")) return verifiedHindi;

  return original.split(/([^\p{L}\p{M}]+)/u).map((part) => {
    if (!part || /[^\p{L}\p{M}]/u.test(part) || DEVANAGARI.test(part)) return part;
    if (/^[A-Z](?:\.[A-Z])?\.?$/.test(part)) return part;
    const word = part.toLocaleLowerCase();
    if (WORD_OVERRIDES[word]) return WORD_OVERRIDES[word];
    const itrans = word.replace(/aa/g, "A").replace(/ee|ii/g, "I").replace(/oo|uu/g, "U");
    return Sanscript.t(itrans, "itrans", "devanagari", { syncope: true });
  }).join("");
}

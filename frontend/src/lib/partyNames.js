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
  new: "न्यू",
  patil: "पाटिल",
  rahul: "राहुल",
  bogande: "बोगांडे",
  trader: "ट्रेडर",
  traders: "ट्रेडर्स",
};

function partyNameDictionaryEntries(dictionary) {
  if (Array.isArray(dictionary)) {
    return dictionary
      .filter((entry) => typeof entry?.english === "string"
        && entry.english.trim() && typeof entry?.hindi === "string"
        && DEVANAGARI.test(entry.hindi))
      .map((entry) => [entry.english.trim().replace(/\s+/g, " ").toLocaleLowerCase(), entry.hindi.trim()]);
  }
  if (dictionary && typeof dictionary === "object") {
    return Object.entries(dictionary)
      .filter(([english, hindi]) => english.trim() && typeof hindi === "string" && DEVANAGARI.test(hindi))
      .map(([english, hindi]) => [english.trim().replace(/\s+/g, " ").toLocaleLowerCase(), hindi.trim()]);
  }
  return [];
}

export function partyName(name, verifiedHindi, outputLanguage = "hi", dictionary = []) {
  const original = name || "";
  if (outputLanguage === "en" || outputLanguage === "english") return original;
  if (DEVANAGARI.test(verifiedHindi || "")) return verifiedHindi;

  const dictionaryEntries = partyNameDictionaryEntries(dictionary);
  const dictionaryByTerm = new Map(dictionaryEntries);
  const normalizedName = original.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (dictionaryByTerm.has(normalizedName)) return dictionaryByTerm.get(normalizedName);

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const translatedPhrases = dictionaryEntries
    .filter(([english]) => /\s/.test(english))
    .sort(([first], [second]) => second.length - first.length)
    .reduce((current, [english, hindi]) => {
      const phrase = english.split(/\s+/).map(escapeRegExp).join("\\s+");
      return current.replace(
        new RegExp(`(^|[^\\p{L}\\p{M}])${phrase}(?=$|[^\\p{L}\\p{M}])`, "giu"),
        (_match, boundary) => `${boundary}${hindi}`,
      );
    }, original);

  return translatedPhrases.split(/([^\p{L}\p{M}]+)/u).map((part) => {
    if (!part || /[^\p{L}\p{M}]/u.test(part) || DEVANAGARI.test(part)) return part;
    if (/^[A-Z](?:\.[A-Z])?\.?$/.test(part)) return part;
    const word = part.toLocaleLowerCase();
    if (dictionaryByTerm.has(word)) return dictionaryByTerm.get(word);
    if (WORD_OVERRIDES[word]) return WORD_OVERRIDES[word];
    const itrans = word.replace(/aa/g, "A").replace(/ee|ii/g, "I").replace(/oo|uu/g, "U");
    return Sanscript.t(itrans, "itrans", "devanagari", { syncope: true });
  }).join("");
}

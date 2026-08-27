import { BOOKS, findBook, shortBookLabel } from "./books.js";

// Schlachter 2000 is copyrighted and only vendored locally (gitignored, see
// .gitignore) - it won't exist on the public deploy. Schlachter 1951 is a
// "free non-commercial distribution" edition, committed, and used as the
// public fallback. Resolved once (see resolveSchlachterEdition) so the rest
// of the app can treat "schlachter" as a single translation whose exact
// edition depends on what's actually available.
const SCHLACHTER_2000_URL = "data/schlachter2000.json";
const SCHLACHTER_1951_URL = "data/schlachter1951.json";
let schlachterEdition = null; // "2000" | "1951", set by resolveSchlachterEdition

async function resolveSchlachterEdition() {
  if (schlachterEdition) return schlachterEdition;
  try {
    const res = await fetch(SCHLACHTER_2000_URL, { method: "HEAD" });
    schlachterEdition = res.ok ? "2000" : "1951";
  } catch {
    schlachterEdition = "1951";
  }
  return schlachterEdition;
}

function schlachterMeta() {
  return schlachterEdition === "2000"
    ? { label: "Schlachter 2000", fileCode: "sch2000" }
    : { label: "Schlachter 1951", fileCode: "sch1951" };
}

// Returns the resolved Schlachter edition's display label, or a generic
// placeholder if it hasn't been resolved yet (before the first fetch).
export function getSchlachterLabel() {
  return schlachterEdition ? schlachterMeta().label : "Schlachter";
}

const SOURCES = {
  schlachter: { lang: "de" }, // label/fileCode resolved dynamically via schlachterMeta()
  kjv: { url: "data/kjv.json", label: "KJV", lang: "en", fileCode: "kjv" },
};

const cache = new Map();

const REF_RE = /^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/;

// Parses "Book Chapter:Verse[-Verse]" (single chapter only). Returns null on
// unparseable input or an unrecognized book name.
export function parseReference(input) {
  const match = REF_RE.exec(input.trim());
  if (!match) return null;
  const [, bookInput, chapter, verseStart, verseEnd] = match;
  const book = findBook(bookInput);
  if (!book) return null;
  return {
    book,
    chapter: Number(chapter),
    verseStart: Number(verseStart),
    verseEnd: verseEnd ? Number(verseEnd) : Number(verseStart),
  };
}

async function loadTranslation(translation) {
  const url = translation === "schlachter"
    ? ((await resolveSchlachterEdition()) === "2000" ? SCHLACHTER_2000_URL : SCHLACHTER_1951_URL)
    : SOURCES[translation].url;
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${translation} data (${res.status})`);
  const data = await res.json();
  cache.set(url, data);
  return data;
}

// KJV source marks paragraph breaks with "# " and supplied (non-original)
// words in "[brackets]" - strip both for plain verse-card text.
function cleanKjvText(text) {
  return text
    .replace(/#\s*/g, "")
    .replace(/\[([^\]]*)\]/g, "$1")
    .trim();
}

// Schlachter 2000 source has two things to strip for plain verse-card text:
// (1) "[word]" used either as a compound-word split, e.g. "[Stifts-]Hütte"
// (just drop the brackets to rejoin it), or wrapping a footnoted word; (2) a
// footnote marker itself - a single lowercase letter glued directly to the
// end of a word or closing punctuation with no space, e.g. "Denken«.b" or
// "[sehr]a hat" - sequential a, b, c... per chapter. Strip the letter first
// (while "]" is still there to anchor case (2)), then the brackets.
function cleanSchlachter2000Text(text) {
  return text
    .replace(/([.!?:;,»«)\]])([a-z])(?=[\s.,;:!?)]|$)/g, "$1")
    .replace(/\[([^\]]*)\]/g, "$1");
}

function lookupSchlachter2000Verse(data, book, chapter, verse) {
  const text = data.bible?.[book.schlachter]?.[String(chapter)]?.[String(verse)];
  return text ? cleanSchlachter2000Text(text) : null;
}

// 1951 source: array of 66 books (same canonical order as BOOKS), each
// { chapters: [[verse1, verse2, ...], ...] }, positionally indexed (no
// verse-number keys) - plain text, nothing to clean.
function lookupSchlachter1951Verse(data, book, chapter, verse) {
  const bookIndex = BOOKS.indexOf(book);
  return data[bookIndex]?.chapters?.[chapter - 1]?.[verse - 1] ?? null;
}

function lookupSchlachterVerse(data, book, chapter, verse) {
  return schlachterEdition === "2000"
    ? lookupSchlachter2000Verse(data, book, chapter, verse)
    : lookupSchlachter1951Verse(data, book, chapter, verse);
}

function lookupKjvVerse(data, book, chapter, verse) {
  const text = data[`${book.kjv} ${chapter}:${verse}`];
  return text ? cleanKjvText(text) : null;
}

function capitalizeFirst(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A verse pulled out of its paragraph sometimes ends mid-sentence - on a
// comma, colon, semicolon, or (Schlachter) an em dash - which reads as a
// dangling connector with nothing following it on the card. Sentence-enders
// (., !, ?) and closing quotes/parens are left as-is.
function stripDanglingPunctuation(text) {
  return text.replace(/[,;:–]+$/, "");
}

// Resolves a parsed reference to its verse text for the given translation.
// Concatenates a verse range with a single space. Returns null if any verse
// in the range doesn't exist (e.g. chapter/verse out of bounds).
export async function getVerseText(translation, ref) {
  const data = await loadTranslation(translation);
  const lookup = translation === "schlachter" ? lookupSchlachterVerse : lookupKjvVerse;
  const parts = [];
  for (let v = ref.verseStart; v <= ref.verseEnd; v++) {
    const text = lookup(data, ref.book, ref.chapter, v);
    if (text == null) return null;
    parts.push(text);
  }
  return capitalizeFirst(stripDanglingPunctuation(parts.join(" ")));
}

// Translation is intentionally left off - it's not part of the default
// customize-quote source text, but can still be added manually if wanted.
export function formatReferenceLabel(ref, translation) {
  const range = ref.verseStart === ref.verseEnd ? `${ref.verseStart}` : `${ref.verseStart}-${ref.verseEnd}`;
  const bookName = translation === "schlachter" ? ref.book.de : ref.book.kjv;
  return `${bookName} ${ref.chapter}:${range}`;
}

// Rewrites a resolved reference into its short form (e.g. "Mat 17:27" or,
// for Schlachter, "5 Mo 6:4") - used to normalize whatever the user typed
// once it's successfully parsed (see updateVerse in main.js).
export function formatShortReference(ref, translation) {
  const range = ref.verseStart === ref.verseEnd ? `${ref.verseStart}` : `${ref.verseStart}-${ref.verseEnd}`;
  return `${shortBookLabel(ref.book, translation)} ${ref.chapter}:${range}`;
}

// e.g. "Mat-17-27-sch2000-versgenerator-de-standard" (size is an
// EXPORT_PRESETS key from export.js: standard/highres/hd/4k)
export function formatFileName(ref, translation, size) {
  const bookCode = ref.book.id.replace(/[A-Za-z]+/, (m) => m[0] + m.slice(1).toLowerCase());
  const verseRange = ref.verseStart === ref.verseEnd ? `${ref.verseStart}` : `${ref.verseStart}-${ref.verseEnd}`;
  const source = translation === "schlachter" ? schlachterMeta() : SOURCES[translation];
  return `${bookCode}-${ref.chapter}-${verseRange}-${source.fileCode}-versgenerator-${SOURCES[translation].lang}-${size}`;
}

export const TRANSLATIONS = SOURCES;

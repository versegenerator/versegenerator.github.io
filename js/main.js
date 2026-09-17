import { parseReference, getVerseText, formatReferenceLabel, formatShortReference, formatFileName, SCHLACHTER_ATTRIBUTION } from "./bible.js";
import { nextPhoto, peekNextPhoto } from "./photos.js";
import { renderCard, computeLayout, ASPECT_RATIOS, THEME, WALLPAPER_SAFE_ZONE, FONT_STACKS } from "./canvas.js";
import {
  renderReloadIcon, renderMountainIcon, renderWaterDropIcon,
  renderColorWheelIcon, renderHalfCircleIcon, renderMinusIcon, renderPlusIcon,
  renderZoomOutIcon, renderZoomInIcon, renderChevronDownIcon, renderDownloadIcon,
} from "./icons.js";
import { saveCard } from "./export.js";

const PREVIEW_WIDTH = 640;
const DEFAULT_REFERENCE = "Matthäus 17:27";
const SETTINGS_KEY = "versgenerator.settings";
// Shown to a brand-new visitor with no saved photo yet - after that, whatever
// photo was last shown is persisted and restored as-is (see loadInitialPhoto).
const DEFAULT_MOUNTAIN_PHOTO = "neil-rosenstech-OxnhDqLcjU4-unsplash.jpg";

// Upload isn't working reliably yet - hidden from the UI (toggle option
// removed, drop zone/file-picker listeners not attached) but the
// implementation (handleUploadedFile, wireUpload, selectSource's "upload"
// handling) is left intact to pick back up later. Flip this back on once
// it's fixed.
const UPLOAD_ENABLED = false;

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

const saved = loadSettings();

const state = {
  ref: null,
  translation: saved.translation ?? "schlachter",
  // null (not "") marks "not resolved yet this session" - distinct from a
  // legitimately empty lookup - see applyResolvedVerse's isFirstResolve.
  verseText: null,
  refLabel: null,
  // The customizable quote/source actually shown on the card - normally
  // mirrors verseText/refLabel, but can diverge once edited via the
  // "Customize quote" panel (see applyResolvedVerse, wireCustomizeQuote).
  quoteText: saved.quoteText ?? "",
  sourceText: saved.sourceText ?? "",
  // The Bible-translation credit only (the photo credit is separate and
  // never editable - see photoCreditText/combinedCreditLine). Mirrors
  // bibleCreditBaseline automatically; only diverges once the "Bible
  // credit" field is edited, which only appears once the quote/source is
  // itself customized (see updateCreditField) - meant for fixing/removing
  // the attribution when the customized text is no longer actually from
  // Schlachter 2000.
  creditText: saved.creditText ?? "",
  image: null,
  focalPoint: saved.focalPoint ?? { x: 50, y: 50 },
  zoom: saved.zoom ?? THEME.defaultZoom,
  bw: saved.bw ?? false,
  aspectKey: saved.aspectKey ?? "portrait",
  // "mountain" | "water" | "upload" - fall back to "mountain" if a
  // previous session persisted "upload" while it's disabled (see
  // UPLOAD_ENABLED above).
  imageSource: (!UPLOAD_ENABLED && saved.imageSource === "upload") ? "mountain" : (saved.imageSource ?? "mountain"),
  textTheme: saved.textTheme ?? "light", // "light" = black text on white; "dark" = white text on black
  fontStyle: saved.fontStyle ?? "modern", // "modern" | "classic" - see FONT_STACKS
  textScale: saved.textScale ?? THEME.defaultTextScale,
  stripeBottomRatio: saved.stripeBottomRatio ?? THEME.defaultStripeBottomRatio,
  photoCreditText: "",
  // The exact photo currently shown, persisted so a reload restores it
  // as-is - only "Change picture" (or switching source) picks a new one.
  photoUrl: saved.photoUrl ?? null,
  photoCredit: saved.photoCredit ?? null,
};

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    reference: el.refInput.value,
    translation: state.translation,
    aspectKey: state.aspectKey,
    bw: state.bw,
    imageSource: state.imageSource,
    textTheme: state.textTheme,
    fontStyle: state.fontStyle,
    zoom: state.zoom,
    textScale: state.textScale,
    stripeBottomRatio: state.stripeBottomRatio,
    focalPoint: state.focalPoint,
    photoUrl: state.photoUrl,
    photoCredit: state.photoCredit,
    quoteText: state.quoteText,
    sourceText: state.sourceText,
    creditText: state.creditText,
  }));
}

// Geometry of the last drawn stripe, used to hit-test drag gestures.
let lastLayout = null;

const el = {
  panelToggle: document.getElementById("panel-toggle"),
  panelContent: document.getElementById("panel-content"),
  refInput: document.getElementById("reference-input"),
  translationSelect: document.getElementById("translation-select"),
  refError: document.getElementById("reference-error"),
  filterButtons: document.getElementById("filter-buttons"),
  sourceButtons: document.getElementById("source-buttons"),
  uploadInput: document.getElementById("upload-input"),
  aspectSelect: document.getElementById("aspect-select"),
  textThemeButtons: document.getElementById("text-theme-buttons"),
  fontButtons: document.getElementById("font-buttons"),
  zoomSlider: document.getElementById("zoom-slider"),
  textSizeSlider: document.getElementById("text-size-slider"),
  photoError: document.getElementById("photo-error"),
  photoCredit: document.getElementById("photo-credit"),
  customizeToggle: document.getElementById("customize-quote-toggle"),
  customizePanel: document.getElementById("customize-quote-panel"),
  customizeQuoteInput: document.getElementById("customize-quote-text"),
  customizeSourceInput: document.getElementById("customize-quote-source"),
  customizeCreditRow: document.getElementById("customize-credit-row"),
  customizeCreditInput: document.getElementById("customize-quote-credit"),
  mobileRefGroup: document.getElementById("mobile-ref-group"),
  canvas: document.getElementById("preview-canvas"),
  saveStandardRow: document.getElementById("save-standard"),
  saveWideRow: document.getElementById("save-wide"),
  saveStandardBtn: document.getElementById("save-standard-btn"),
  saveHighresBtn: document.getElementById("save-highres-btn"),
  saveHdBtn: document.getElementById("save-hd-btn"),
  save4kBtn: document.getElementById("save-4k-btn"),
  gridOverlay: document.getElementById("grid-overlay"),
  wallpaperSafeOverlay: document.getElementById("wallpaper-safe-overlay"),
  side: document.querySelector(".side"),
  mobileToast: document.getElementById("mobile-toast"),
  mobileToolbar: document.getElementById("mobile-toolbar"),
  mobileRefInput: document.getElementById("mobile-reference-input"),
  mobileTranslationSelect: document.getElementById("mobile-translation-select"),
  mobileAspectSelect: document.getElementById("mobile-aspect-select"),
  mobileFontGroup: document.getElementById("mobile-font-group"),
  mobileThemeGroup: document.getElementById("mobile-theme-group"),
  mobileTextsizeGroup: document.getElementById("mobile-textsize-group"),
  mobileSourceGroup: document.getElementById("mobile-source-group"),
  mobileFilterGroup: document.getElementById("mobile-filter-group"),
  mobileZoomGroup: document.getElementById("mobile-zoom-group"),
  mobileSave: document.getElementById("mobile-save"),
  mobileSaveBtn: document.getElementById("mobile-save-btn"),
  mobileSaveLabel: document.getElementById("mobile-save-label"),
  mobileSaveDropdownBtn: document.getElementById("mobile-save-dropdown-btn"),
  mobileSaveMenu: document.getElementById("mobile-save-menu"),
};

const ctx = el.canvas.getContext("2d");

// Rule-of-thirds grid, shown while zooming/resizing text/dragging, fading
// out 1.5s after the interaction stops. Purely a DOM overlay - never drawn
// into the canvas, so it can never leak into an exported image.
const GRID_FADE_DELAY = 700;
let gridFadeTimer = null;
function showGrid() {
  el.gridOverlay.classList.add("visible");
  if (state.aspectKey === "wallpaper") el.wallpaperSafeOverlay.classList.add("visible");
  clearTimeout(gridFadeTimer);
  gridFadeTimer = setTimeout(() => {
    el.gridOverlay.classList.remove("visible");
    el.wallpaperSafeOverlay.classList.remove("visible");
  }, GRID_FADE_DELAY);
}

// The mobile toolbar has no room for inline error text (see showError) - a
// toast banner over the photo stands in for it there. Desktop already shows
// the same message inline, so the toast is CSS-hidden outside mobile widths.
const TOAST_FADE_DELAY = 4000;
let toastFadeTimer = null;
function showToast(message) {
  clearTimeout(toastFadeTimer);
  if (!message) {
    el.mobileToast.hidden = true;
    return;
  }
  el.mobileToast.textContent = message;
  el.mobileToast.hidden = false;
  toastFadeTimer = setTimeout(() => {
    el.mobileToast.hidden = true;
  }, TOAST_FADE_DELAY);
}

function showError(node, message) {
  showToast(message);
  if (!message) {
    node.hidden = true;
    return;
  }
  node.textContent = message;
  node.hidden = false;
}

function isQuoteCustomized() {
  return state.quoteText !== state.verseText || state.sourceText !== state.refLabel;
}

// Dims the reference input / translation controls while a custom quote or
// source is active, signaling they're no longer what's driving the card.
function updateCustomizedDimming() {
  const customized = isQuoteCustomized();
  el.refInput.classList.toggle("dims-when-customized", customized);
  el.translationSelect.classList.toggle("dims-when-customized", customized);
  el.mobileRefGroup.classList.toggle("dims-when-customized", customized);
}

// The Bible-translation credit - required attribution when Schlachter 2000
// is active (see SCHLACHTER_ATTRIBUTION in bible.js), empty otherwise. Only
// this part is user-editable (see updateCreditField) - the photo credit
// (state.photoCreditText) is never edited, it's always auto-derived.
function bibleCreditBaseline() {
  return state.translation === "schlachter" ? SCHLACHTER_ATTRIBUTION : "";
}

// The card's single-line watermark: fixed photo credit plus the (possibly
// user-edited) Bible credit.
function combinedCreditLine() {
  return [state.photoCreditText, state.creditText].filter(Boolean).join(" · ");
}

// The "Bible credit" field only appears once the quote/source has been
// customized - it exists to fix up or remove the auto-attached translation
// attribution when the customized text no longer matches what's actually
// shown (e.g. a different translation pasted into the quote). The photo
// credit itself is never editable. While hidden, creditText continuously
// mirrors the live baseline so it's never stale by the time the field
// reappears.
function updateCreditField() {
  const customized = isQuoteCustomized();
  if (!customized) {
    state.creditText = bibleCreditBaseline();
  } else {
    // Migrates creditText persisted before the Bible-credit field was
    // scoped down from the full combined line to just this part - strip a
    // leading photo-credit prefix if one's still there.
    const oldPrefix = state.photoCreditText ? `${state.photoCreditText} · ` : "";
    if (oldPrefix && state.creditText.startsWith(oldPrefix)) {
      state.creditText = state.creditText.slice(oldPrefix.length);
    }
  }
  el.customizeCreditRow.hidden = !customized;
  if (!el.customizePanel.hidden) el.customizeCreditInput.value = state.creditText;
}

// Updates the auto-derived verse baseline (verseText/refLabel) and syncs
// the customizable quote/source to match - unless this is the very first
// resolution of the session and a customization was already persisted from
// a prior session, in which case that's kept instead of the freshly
// looked-up text (a reload restoring the same reference shouldn't silently
// wipe out an earlier customization).
function applyResolvedVerse(text, refLabel) {
  const isFirstResolve = state.verseText === null;
  const changed = !isFirstResolve && (text !== state.verseText || refLabel !== state.refLabel);
  state.verseText = text;
  state.refLabel = refLabel;
  if (isFirstResolve) {
    if (!state.quoteText) state.quoteText = text;
    if (!state.sourceText) state.sourceText = refLabel;
  } else if (changed) {
    state.quoteText = text;
    state.sourceText = refLabel;
  }
  if (!el.customizePanel.hidden) {
    el.customizeQuoteInput.value = state.quoteText;
    el.customizeSourceInput.value = state.sourceText;
  }
  updateCustomizedDimming();
  updateCreditField();
}

// "Customize quote": an inline panel below the photo credit line, toggled
// open/closed by its own link. Always opens pre-filled with whatever's
// currently shown (state.quoteText/sourceText); editing either field
// overrides the card directly (see cardParams) and dims the reference
// controls (see updateCustomizedDimming) until a new reference or
// translation resolves and resets it (see applyResolvedVerse). The "Credit"
// field only shows up once quote/source is customized (see
// updateCreditField) - it's there to fix the credit watermark if the
// customized text is no longer actually from Schlachter 2000.
function wireCustomizeQuote() {
  el.customizeToggle.addEventListener("click", () => {
    const opening = el.customizePanel.hidden;
    el.customizePanel.hidden = !opening;
    if (opening) {
      el.customizeQuoteInput.value = state.quoteText;
      el.customizeSourceInput.value = state.sourceText;
      el.customizeCreditInput.value = state.creditText;
    }
  });

  const onTextEdit = () => {
    state.quoteText = el.customizeQuoteInput.value;
    state.sourceText = el.customizeSourceInput.value;
    updateCustomizedDimming();
    updateCreditField();
    render();
    saveSettings();
  };
  el.customizeQuoteInput.addEventListener("input", onTextEdit);
  el.customizeSourceInput.addEventListener("input", onTextEdit);

  el.customizeCreditInput.addEventListener("input", () => {
    state.creditText = el.customizeCreditInput.value;
    render();
    saveSettings();
  });
}

function currentRatio() {
  return ASPECT_RATIOS[state.aspectKey];
}

function resizePreviewCanvas() {
  const ratio = currentRatio();
  el.canvas.width = PREVIEW_WIDTH;
  el.canvas.height = Math.round((PREVIEW_WIDTH * ratio.h) / ratio.w);
}

function cardParams() {
  return {
    image: state.image,
    focalPoint: state.focalPoint,
    zoom: state.zoom,
    bw: state.bw,
    verseText: state.quoteText,
    refLabel: state.sourceText,
    stripeOpacity: THEME.defaultStripeOpacity,
    textTheme: state.textTheme,
    fontFamily: FONT_STACKS[state.fontStyle].fontFamily,
    textScale: state.textScale,
    stripeBottomRatio: state.stripeBottomRatio,
    sidePaddingRatio: state.aspectKey === "wallpaper" ? THEME.wallpaperSidePaddingRatio : undefined,
    credit: combinedCreditLine(),
  };
}

function render() {
  if (!state.image || !state.quoteText) return;
  enforceSchlachterTextCap();
  lastLayout = renderCard(ctx, el.canvas.width, el.canvas.height, cardParams());
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// `credit` is { name, link } (link may be null - see photos.js) or null for
// a locally uploaded photo (no attribution to show). Builds both the DOM
// credit line and the plain-text watermark baseline drawn onto the canvas.
async function applyPhoto(image, credit, { resetFraming = true } = {}) {
  state.image = image;
  if (resetFraming) {
    // A new photo has a different composition - start centered, full zoom.
    state.focalPoint = { x: 50, y: 50 };
    state.zoom = THEME.defaultZoom;
    el.zoomSlider.value = 100;
    saveSettings();
  }
  if (credit) {
    el.photoCredit.hidden = false;
    el.photoCredit.innerHTML = credit.link
      ? `Photo by <a href="${credit.link}" target="_blank" rel="noopener">${credit.name}</a> on Unsplash`
      : `Photo by ${credit.name} on Unsplash`;
    state.photoCreditText = `Photo: ${credit.name} — Unsplash`;
  } else {
    el.photoCredit.hidden = true;
    el.photoCredit.innerHTML = "";
    state.photoCreditText = "";
  }
  updateCreditField();
  render();
}

// The next photo for a source, already decoding, so "Change picture" has no
// loading time - started right after the previous photo finishes applying.
const prefetched = new Map(); // source -> { url, credit, imagePromise }

function prefetchNext(source) {
  peekNextPhoto(source).then((photo) => {
    if (!photo) return;
    const imagePromise = loadImage(photo.url);
    imagePromise.catch(() => {}); // avoid an unhandled rejection if it's never consumed
    prefetched.set(source, { url: photo.url, credit: photo.credit, imagePromise });
  });
}

function setSourceButtonsDisabled(disabled) {
  for (const b of el.sourceButtons.querySelectorAll("button")) b.disabled = disabled;
}

// Loads and applies a new random photo for the given source ("mountain" or
// "water"), used on first-ever visit, clicking the already-selected source
// button again, and switching sources. `preferFile`, if given, forces that
// specific file as the pick (only meaningful for the very first photo of a
// fresh cycle - see nextPhoto in photos.js).
async function loadPhotoForSource(source, { preferFile } = {}) {
  setSourceButtonsDisabled(true);
  try {
    const photo = await nextPhoto(source, { preferFile });
    const pre = prefetched.get(source);
    const image = pre && pre.url === photo.url ? await pre.imagePromise : await loadImage(photo.url);
    prefetched.delete(source);
    showError(el.photoError, "");
    state.photoUrl = photo.url;
    state.photoCredit = photo.credit;
    await applyPhoto(image, photo.credit);
    prefetchNext(source);
  } catch (err) {
    if (err.message === "no-results") {
      showError(el.photoError, `No ${source} photos yet - add some to data/${source}/ and rerun build-manifests.py.`);
    } else {
      showError(el.photoError, "Couldn't load that photo.");
    }
  } finally {
    setSourceButtonsDisabled(false);
  }
}

// Reloading the page should show whatever photo was left on, not a new
// random one - restores it as-is (framing included) and falls back to
// picking a fresh photo only if it no longer loads (e.g. file was removed).
async function restorePhoto(source, url, credit) {
  try {
    const image = await loadImage(url);
    showError(el.photoError, "");
    await applyPhoto(image, credit, { resetFraming: false });
    prefetchNext(source);
  } catch {
    loadPhotoForSource(source);
  }
}

async function updateVerse() {
  const input = el.refInput.value.trim();
  if (!input) {
    state.ref = null;
    applyResolvedVerse("(verse missing)", "");
    showError(el.refError, "");
    render();
    return;
  }
  const ref = parseReference(input);
  if (!ref) {
    showError(el.refError, "Couldn't parse that reference. Try e.g. \"John 3:16\".");
    return;
  }
  try {
    const text = await getVerseText(state.translation, ref);
    if (text == null) {
      showError(el.refError, "That verse doesn't exist in this translation.");
      return;
    }
    state.ref = ref;
    applyResolvedVerse(text, formatReferenceLabel(ref, state.translation));
    showError(el.refError, "");
    // Normalizes whatever the user typed ("Matthäus 17:27", "mat 17:27",
    // "MAT 17:27"...) to a short, language-matched form once it resolves.
    const shortRef = formatShortReference(ref, state.translation);
    el.refInput.value = shortRef;
    el.mobileRefInput.value = shortRef;
    render();
  } catch (err) {
    showError(el.refError, "Couldn't load Bible data.");
  }
}

// 16:9 gets its own HD/4K save buttons; every other ratio gets the
// standard/high-resolution pair - except phone wallpaper, where "standard"
// is already sized for a retina phone screen, so the high-res option is
// redundant.
function updateSaveRowVisibility() {
  const isWide = state.aspectKey === "wide";
  el.saveStandardRow.hidden = isWide;
  el.saveWideRow.hidden = !isWide;
  el.saveHighresBtn.hidden = state.aspectKey === "wallpaper";
}

// Builds a connected segmented toggle (same look for aspect ratio, text
// theme, and photo filter). `options` is [{ key, label }]. `renderIcon`, if
// given, returns an element for that option or a falsy value to skip it;
// `iconPosition` ("start", the default, or "end") controls which side of
// the label it lands on.
function buildToggleGroup(container, options, selectedKey, onSelect, { renderIcon, styleButton, iconPosition = "start" } = {}) {
  container.innerHTML = "";
  for (const opt of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.key = opt.key;
    button.setAttribute("aria-pressed", opt.key === selectedKey ? "true" : "false");
    const icon = renderIcon ? renderIcon(opt) : null;
    if (icon && iconPosition === "start") button.appendChild(icon);
    button.appendChild(document.createTextNode(opt.label));
    if (icon && iconPosition === "end") button.appendChild(icon);
    if (styleButton) styleButton(button, opt);
    button.addEventListener("click", () => {
      for (const b of container.children) {
        b.setAttribute("aria-pressed", b.dataset.key === opt.key ? "true" : "false");
      }
      onSelect(opt.key);
    });
    container.appendChild(button);
  }
}


function updateWallpaperSafeZoneVisibility() {
  el.wallpaperSafeOverlay.hidden = state.aspectKey !== "wallpaper";
}

// Non-wallpaper ratios have no reserved zones, so their whole canvas height
// is usable for the stripe; wallpaper mode reserves a chunk of it for
// lock-screen chrome (see WALLPAPER_SAFE_ZONE), leaving proportionally less
// room - the height-factor calculation below needs to scale text against
// this *usable* height, not the raw canvas height, or it treats wallpaper's
// much-taller canvas as if all of it were free for text.
function usableHeightFraction(key) {
  return key === "wallpaper" ? 1 - WALLPAPER_SAFE_ZONE.topRatio - WALLPAPER_SAFE_ZONE.bottomRatio : 1;
}

// Shared by the desktop toggle group and the mobile aspect <select> - the
// only two controls for this. Preview/export width is held fixed per ratio,
// so canvas *height* changes with the ratio - scale text to track that
// (usable) height change so it keeps roughly the same relative size instead
// of the same textScale looking bigger/smaller as the frame gets
// shorter/taller.
function selectAspect(key) {
  const oldRatio = ASPECT_RATIOS[state.aspectKey];
  const newRatio = ASPECT_RATIOS[key];
  const oldUsable = (oldRatio.h / oldRatio.w) * usableHeightFraction(state.aspectKey);
  const newUsable = (newRatio.h / newRatio.w) * usableHeightFraction(key);
  const heightFactor = newUsable / oldUsable;
  setTextScale(Math.round(state.textScale * heightFactor * 100), { showThirds: false });

  state.aspectKey = key;
  // Keeps the stripe clear of the reserved bottom zone by default - still
  // freely draggable from there like any other ratio.
  if (key === "wallpaper") state.stripeBottomRatio = THEME.wallpaperSafeStripeBottomRatio;
  resizePreviewCanvas();
  updateSaveRowVisibility();
  updateWallpaperSafeZoneVisibility();
  updateMobileSaveMenu();
  render();
  saveSettings();
  el.aspectSelect.value = key;
  el.mobileAspectSelect.value = key;
}

function setFilter(isBw) {
  state.bw = isBw;
  render();
  saveSettings();
  buildFilterButtons();
  buildMobileRow2();
}

function buildFilterButtons() {
  const options = [
    { key: "color", label: "Original" },
    { key: "bw", label: "Silvertone" },
  ];
  buildToggleGroup(el.filterButtons, options, state.bw ? "bw" : "color", (key) => setFilter(key === "bw"));
}

// Switches the active image source and syncs the toggle UI to match.
// `loadPhoto: false` is used right before loading a just-dropped file, so
// we don't fetch-then-immediately-discard a random "upload" photo (there
// isn't one). Rebuilds the toggle groups (rather than just updating
// aria-pressed) so the reload icon - see buildSourceButtons - relocates to
// whichever button is now selected, on both desktop and mobile.
function selectSource(key, { loadPhoto = true } = {}) {
  state.imageSource = key;
  buildSourceButtons();
  buildMobileRow2();
  saveSettings();
  if (loadPhoto && key !== "upload") loadPhotoForSource(key);
}

// There's no separate "change picture" button - the currently-selected
// source button doubles as one (reload icon, re-clicking it cycles to a
// new photo for that source; buildToggleGroup already fires onSelect on
// every click regardless of whether that option was already selected).
function buildSourceButtons() {
  const options = [
    { key: "mountain", label: "Mountain" },
    { key: "water", label: "Water" },
  ];
  if (UPLOAD_ENABLED) options.push({ key: "upload", label: "Upload" });
  buildToggleGroup(el.sourceButtons, options, state.imageSource, (key) => {
    selectSource(key);
    // Clicking "Upload" also opens a file picker - drag-and-drop alone
    // isn't discoverable enough as the only way in.
    if (key === "upload") el.uploadInput.click();
  }, {
    renderIcon: (opt) => (opt.key === state.imageSource ? renderReloadIcon() : null),
    iconPosition: "end",
  });
}

function setTextTheme(key) {
  state.textTheme = key;
  render();
  saveSettings();
  buildTextThemeButtons();
  buildMobileRow3();
}

function buildTextThemeButtons() {
  const options = [
    { key: "light", label: "Black on white text" },
    { key: "dark", label: "White on black text" },
  ];
  buildToggleGroup(el.textThemeButtons, options, state.textTheme, setTextTheme);
}

function setFontStyle(key) {
  state.fontStyle = key;
  render();
  saveSettings();
  buildFontButtons();
  buildMobileRow3();
}

// Each option's own label previews its font, so the choice is visible
// before picking it rather than just named.
function buildFontButtons() {
  const options = Object.entries(FONT_STACKS).map(([key, font]) => ({ key, label: font.label, font }));
  buildToggleGroup(el.fontButtons, options, state.fontStyle, setFontStyle, {
    styleButton: (button, opt) => {
      button.style.fontFamily = opt.font.fontFamily;
    },
  });
}

function setZoom(percent, { showThirds = true } = {}) {
  const clamped = Math.min(THEME.maxZoom * 100, Math.max(THEME.minZoom * 100, percent));
  state.zoom = clamped / 100;
  el.zoomSlider.value = clamped;
  if (showThirds) showGrid();
  render();
  saveSettings();
}

// Schlachter 2000's license caps how much of the image the quoted text may
// cover (see THEME.schlachterMaxStripeHeightRatio) - finds the largest
// text-size percent whose stripe still fits that limit, for the current
// canvas size and quote text. Binary search: stripe height only grows (or
// plateaus) as text size increases, so it's safe despite the discrete jumps
// each time a line wraps.
function maxTextScaleForStripeLimit() {
  const canvasWidth = el.canvas.width;
  const canvasHeight = el.canvas.height;
  const sidePaddingRatio = state.aspectKey === "wallpaper" ? THEME.wallpaperSidePaddingRatio : undefined;
  const fits = (percent) => {
    const layout = computeLayout(ctx, canvasWidth, canvasHeight, {
      verseText: state.quoteText,
      textScale: percent / 100,
      stripeBottomRatio: state.stripeBottomRatio,
      sidePaddingRatio,
      fontFamily: FONT_STACKS[state.fontStyle].fontFamily,
    });
    return layout.stripeHeight <= canvasHeight * THEME.schlachterMaxStripeHeightRatio;
  };
  const lo = Math.round(THEME.minTextScale * 100);
  const hi = Math.round(THEME.maxTextScale * 100);
  if (fits(hi)) return hi;
  if (!fits(lo)) return lo;
  let low = lo, high = hi;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid; else high = mid - 1;
  }
  return low;
}

// Called from render() itself (see above) so the cap holds no matter what
// triggered the redraw - a text-size tap, a longer customized quote, a
// font/aspect switch, or choosing Schlachter as the translation - not just
// direct interaction with the text-size control.
function enforceSchlachterTextCap() {
  if (state.translation !== "schlachter") return;
  const maxPercent = maxTextScaleForStripeLimit();
  const currentPercent = Math.round(state.textScale * 100);
  if (currentPercent <= maxPercent) return;
  state.textScale = maxPercent / 100;
  el.textSizeSlider.value = maxPercent;
  saveSettings();
}

function setTextScale(percent, { showThirds = true } = {}) {
  const clamped = Math.min(THEME.maxTextScale * 100, Math.max(THEME.minTextScale * 100, percent));
  state.textScale = clamped / 100;
  el.textSizeSlider.value = clamped;
  if (showThirds) showGrid();
  render();
  saveSettings();
}

// --- Mobile toolbar (< 900px) -----------------------------------------
// A separate, icon-only DOM tree replacing the desktop .side panel there
// (see the max-width: 900px media query in style.css). Each control reuses
// the same state-mutating setter as its desktop counterpart above, so the
// two stay in sync regardless of which one a change came from.

const ZOOM_STEP = 10; // percentage points per tap (slider is 100-300)
const TEXT_SIZE_STEP = 5; // percentage points per tap (slider is 20-160)

// One connected pair/group of icon-only buttons, e.g. Mountain/Water. No
// visible label - `ariaLabel` is the only thing identifying each option to
// assistive tech, so it needs to be a real description, not just the key.
function buildMobileIconGroup(options, selectedKey, onSelect) {
  const group = document.createElement("div");
  group.className = "mobile-icon-group";
  for (const opt of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", opt.key === selectedKey ? "true" : "false");
    button.setAttribute("aria-label", opt.ariaLabel);
    button.appendChild(opt.renderIcon());
    button.addEventListener("click", () => onSelect(opt.key));
    group.appendChild(button);
  }
  return group;
}

// A -/+ pair with no "selected" state - each tap just nudges a value by a
// fixed step (see ZOOM_STEP/TEXT_SIZE_STEP), replacing the desktop sliders'
// continuous drag with something that fits a 30px-tall icon row.
function buildMobileStepper({
  decLabel, incLabel, onDecrement, onIncrement,
  renderDecIcon = renderMinusIcon, renderIncIcon = renderPlusIcon,
}) {
  const group = document.createElement("div");
  group.className = "mobile-icon-group";
  const dec = document.createElement("button");
  dec.type = "button";
  dec.setAttribute("aria-label", decLabel);
  dec.appendChild(renderDecIcon());
  dec.addEventListener("click", onDecrement);
  const inc = document.createElement("button");
  inc.type = "button";
  inc.setAttribute("aria-label", incLabel);
  inc.appendChild(renderIncIcon());
  inc.addEventListener("click", onIncrement);
  group.appendChild(dec);
  group.appendChild(inc);
  return group;
}

// Text-size buttons preview the effect directly - a big "A" with a small
// -/+ mark, light weight for smaller and bold for bigger - rather than
// generic minus/plus icons like the zoom stepper.
function buildTextSizeGlyphButton(symbol, weight, ariaLabel, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", ariaLabel);
  const span = document.createElement("span");
  span.className = "mobile-textsize-glyph";
  span.style.fontWeight = String(weight);
  const a = document.createElement("span");
  a.className = "mobile-textsize-glyph-a";
  a.textContent = "A";
  const sym = document.createElement("span");
  sym.className = "mobile-textsize-glyph-symbol";
  sym.textContent = symbol;
  span.appendChild(a);
  span.appendChild(sym);
  button.appendChild(span);
  button.addEventListener("click", onClick);
  return button;
}

function buildTextSizeStepper() {
  const group = document.createElement("div");
  group.className = "mobile-icon-group";
  group.appendChild(buildTextSizeGlyphButton("-", 300, "Smaller text", () => (
    setTextScale(Math.round(state.textScale * 100) - TEXT_SIZE_STEP, { showThirds: false })
  )));
  group.appendChild(buildTextSizeGlyphButton("+", 800, "Bigger text", () => (
    setTextScale(Math.round(state.textScale * 100) + TEXT_SIZE_STEP, { showThirds: false })
  )));
  return group;
}

// Row 2 of the grid: aspect select (static), then source/filter/zoom -
// each in its own grid cell so it lines up under row 1's matching column.
function buildMobileRow2() {
  el.mobileSourceGroup.innerHTML = "";
  el.mobileSourceGroup.appendChild(buildMobileIconGroup([
    { key: "mountain", ariaLabel: "Mountain photos (tap again to change picture)", renderIcon: () => renderMountainIcon() },
    { key: "water", ariaLabel: "Water photos (tap again to change picture)", renderIcon: () => renderWaterDropIcon() },
  ], state.imageSource, selectSource));

  el.mobileFilterGroup.innerHTML = "";
  el.mobileFilterGroup.appendChild(buildMobileIconGroup([
    { key: "color", ariaLabel: "Original", renderIcon: () => renderColorWheelIcon() },
    { key: "bw", ariaLabel: "Silvertone", renderIcon: () => renderHalfCircleIcon() },
  ], state.bw ? "bw" : "color", (key) => setFilter(key === "bw")));

  el.mobileZoomGroup.innerHTML = "";
  el.mobileZoomGroup.appendChild(buildMobileStepper({
    decLabel: "Zoom out",
    incLabel: "Zoom in",
    onDecrement: () => setZoom(Math.round(state.zoom * 100) - ZOOM_STEP, { showThirds: false }),
    onIncrement: () => setZoom(Math.round(state.zoom * 100) + ZOOM_STEP, { showThirds: false }),
    renderDecIcon: () => renderZoomOutIcon(22),
    renderIncIcon: () => renderZoomInIcon(22),
  }));
}

// Row 1 of the grid: reference input (static), then font/theme/text-size -
// each in its own grid cell so it lines up above row 2's matching column.
function buildMobileRow3() {
  el.mobileFontGroup.innerHTML = "";
  el.mobileFontGroup.appendChild(buildMobileIconGroup(
    Object.entries(FONT_STACKS).map(([key, font]) => ({
      key,
      ariaLabel: `${font.label} font`,
      renderIcon: () => {
        const span = document.createElement("span");
        span.textContent = "A";
        span.style.fontFamily = font.fontFamily;
        span.style.fontWeight = "800";
        span.style.fontSize = "1.2rem";
        return span;
      },
    })),
    state.fontStyle,
    setFontStyle,
  ));

  el.mobileThemeGroup.innerHTML = "";
  el.mobileThemeGroup.appendChild(buildMobileIconGroup([
    {
      key: "light",
      ariaLabel: "Black on white text",
      renderIcon: () => {
        const span = document.createElement("span");
        span.textContent = "A";
        span.className = "mobile-theme-swatch mobile-theme-swatch-light";
        return span;
      },
    },
    {
      key: "dark",
      ariaLabel: "White on black text",
      renderIcon: () => {
        const span = document.createElement("span");
        span.textContent = "A";
        span.className = "mobile-theme-swatch mobile-theme-swatch-dark";
        return span;
      },
    },
  ], state.textTheme, setTextTheme));

  el.mobileTextsizeGroup.innerHTML = "";
  el.mobileTextsizeGroup.appendChild(buildTextSizeStepper());
}

// Unicode glyphs standing in for a proportion swatch - a native <select>'s
// options can only hold plain text, not SVG/DOM icons. Used on both the
// desktop and mobile aspect-ratio dropdowns.
const ASPECT_GLYPHS = {
  portrait: "▯",
  square: "□",
  landscape: "▭",
  wide: "▬",
};

function buildAspectSelect(selectEl) {
  selectEl.innerHTML = "";
  for (const [key, ratio] of Object.entries(ASPECT_RATIOS)) {
    const opt = document.createElement("option");
    opt.value = key;
    const glyph = ASPECT_GLYPHS[key];
    opt.textContent = glyph ? `${glyph} ${ratio.label}` : ratio.label;
    selectEl.appendChild(opt);
  }
  selectEl.value = state.aspectKey;
  selectEl.addEventListener("change", () => selectAspect(selectEl.value));
}

// Mirrors updateSaveRowVisibility's per-ratio logic, just expressed as one
// primary preset (the pill's direct-click action) plus an optional
// secondary one (the dropdown's only entry): wallpaper has no secondary
// (the primary preset is already sized for a retina phone screen), 16:9
// gets HD/4K, everything else gets standard/high-resolution.
function mobileSaveOptions() {
  if (state.aspectKey === "wallpaper") return { primary: "standard", primaryLabel: "Save", secondary: null };
  if (state.aspectKey === "wide") return { primary: "hd", primaryLabel: "Save HD", secondary: "4k", secondaryLabel: "Save 4K" };
  return { primary: "standard", primaryLabel: "Save", secondary: "highres", secondaryLabel: "Save high resolution version" };
}

function closeMobileSaveMenu() {
  el.mobileSaveMenu.hidden = true;
  el.mobileSaveDropdownBtn.setAttribute("aria-expanded", "false");
}

// Rebuilt whenever the aspect ratio changes (see selectAspect) since the
// dropdown's one option depends on it.
function updateMobileSaveMenu() {
  const { primaryLabel, secondary, secondaryLabel } = mobileSaveOptions();
  el.mobileSaveLabel.textContent = primaryLabel;
  el.mobileSaveMenu.innerHTML = "";
  el.mobileSaveDropdownBtn.hidden = !secondary;
  if (!secondary) {
    closeMobileSaveMenu();
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = secondaryLabel;
  button.addEventListener("click", () => {
    doSave(secondary);
    closeMobileSaveMenu();
  });
  el.mobileSaveMenu.appendChild(button);
}

// The pill's own label describes what a plain click does (e.g. "Save HD"
// for 16:9 - see mobileSaveOptions), kept in sync by updateMobileSaveMenu
// whenever the aspect ratio changes. Picking the dropdown's option fires
// immediately too (there's no "select then confirm" step), but never
// changes the pill's own label - it always reflects the *primary* action.
function wireMobileSave() {
  el.mobileSaveBtn.insertBefore(renderDownloadIcon(), el.mobileSaveLabel);
  el.mobileSaveDropdownBtn.appendChild(renderChevronDownIcon());

  el.mobileSaveBtn.addEventListener("click", () => doSave(mobileSaveOptions().primary));
  el.mobileSaveDropdownBtn.addEventListener("click", () => {
    const willOpen = el.mobileSaveMenu.hidden;
    el.mobileSaveMenu.hidden = !willOpen;
    el.mobileSaveDropdownBtn.setAttribute("aria-expanded", String(willOpen));
  });
  document.addEventListener("click", (e) => {
    if (!el.mobileSave.contains(e.target)) closeMobileSaveMenu();
  });
}

// Keeps the desktop and mobile reference/translation controls mirrored, so
// whichever one is visible (only one is, per the 900px breakpoint) always
// reflects the same value - e.g. after resizing the window or rotating a
// device mid-session.
function wireMirroredInput(input, other, onChange) {
  input.addEventListener("change", () => {
    other.value = input.value;
    onChange();
  });
}

// Converts a pointer client position to canvas-internal pixel coordinates
// (the canvas's on-screen CSS size can differ from its width/height attrs).
function canvasPoint(clientX, clientY) {
  const rect = el.canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * el.canvas.width,
    y: ((clientY - rect.top) / rect.height) * el.canvas.height,
  };
}

// Pixel size the image is currently drawn at (cover-fit x zoom), needed to
// convert a pointer-drag delta into a focalPoint delta for free panning.
function drawnImageSize() {
  const { image, zoom } = state;
  const coverScale = Math.max(el.canvas.width / image.naturalWidth, el.canvas.height / image.naturalHeight);
  const scale = coverScale * zoom;
  return { width: image.naturalWidth * scale, height: image.naturalHeight * scale };
}

function wireDrag() {
  // "stripe": dragging the text stripe up/down. "image": freely panning the photo.
  let dragMode = null;
  let grabOffsetY = 0; // stripe mode: pointerY - stripeY at drag start, in canvas px
  let lastPoint = null; // image mode: previous pointer position, for delta panning

  el.canvas.addEventListener("pointerdown", (e) => {
    if (!state.image) return;
    const point = canvasPoint(e.clientX, e.clientY);
    if (lastLayout && point.y >= lastLayout.stripeY && point.y <= lastLayout.stripeY + lastLayout.stripeHeight) {
      dragMode = "stripe";
      grabOffsetY = point.y - lastLayout.stripeY;
    } else {
      dragMode = "image";
      lastPoint = point;
    }
    el.canvas.setPointerCapture(e.pointerId);
    showGrid();
  });

  el.canvas.addEventListener("pointermove", (e) => {
    if (!dragMode) return;
    const point = canvasPoint(e.clientX, e.clientY);
    if (dragMode === "image") {
      panImage(point.x - lastPoint.x, point.y - lastPoint.y);
      lastPoint = point;
    } else if (dragMode === "stripe" && lastLayout) {
      const stripeY = point.y - grabOffsetY;
      const bottom = stripeY + lastLayout.stripeHeight;
      state.stripeBottomRatio = Math.min(1, Math.max(0, bottom / el.canvas.height));
    }
    showGrid();
    render();
  });

  // Moves the image by (dx, dy) canvas pixels, following the pointer 1:1 -
  // free dragging, not a jump-to-click. No-op on an axis with no pan slack
  // (image exactly fills that dimension).
  function panImage(dx, dy) {
    const { width: drawWidth, height: drawHeight } = drawnImageSize();
    const slackX = el.canvas.width - drawWidth; // <= 0
    const slackY = el.canvas.height - drawHeight; // <= 0
    const { x, y } = state.focalPoint;
    state.focalPoint = {
      x: slackX === 0 ? x : Math.min(100, Math.max(0, x + (dx / slackX) * 100)),
      y: slackY === 0 ? y : Math.min(100, Math.max(0, y + (dy / slackY) * 100)),
    };
  }

  el.canvas.addEventListener("pointerup", () => {
    if (dragMode) saveSettings();
    dragMode = null;
  });
  el.canvas.addEventListener("pointercancel", () => {
    dragMode = null;
  });
}

// Loads a local File as the card's photo: switches to "Upload" (no fallback
// fetch needed, we already have the image) and shows no attribution.
async function handleUploadedFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  selectSource("upload", { loadPhoto: false });
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    await applyPhoto(image, null);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The canvas is *always* a stealth drop zone for a local image file - no
// visible affordance except a highlight while a file is actually being
// dragged over it, and no need to pre-select "Upload" first (dropping a
// file switches the source toggle to "Upload" itself). Clicking the
// "Upload" toggle button (wired in buildSourceButtons) opens a real file
// picker as the more discoverable alternative to drag-and-drop alone.
function wireUpload() {
  const isFileDrag = (e) => !!e.dataTransfer?.types.includes("Files");

  // Chrome requires preventDefault on dragenter *and* dragover for a drop
  // to be accepted; without it the browser's default action (navigating to
  // the file) wins over our "drop" listener.
  el.canvas.addEventListener("dragenter", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  });
  el.canvas.addEventListener("dragover", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    el.canvas.classList.add("drop-active");
  });
  el.canvas.addEventListener("dragleave", () => {
    el.canvas.classList.remove("drop-active");
  });
  el.canvas.addEventListener("drop", async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    el.canvas.classList.remove("drop-active");
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
    await handleUploadedFile(file);
  });

  el.uploadInput.addEventListener("change", async () => {
    await handleUploadedFile(el.uploadInput.files?.[0]);
    el.uploadInput.value = ""; // allow picking the same file again later
  });
}

function doSave(presetKey) {
  if (!state.image || !state.quoteText || !state.ref) return;
  const fileNameBase = formatFileName(state.ref, state.translation, presetKey);
  saveCard(presetKey, currentRatio(), cardParams(), fileNameBase);
}

function wireEvents() {
  el.panelToggle.addEventListener("click", () => {
    el.panelContent.hidden = !el.panelContent.hidden;
    el.panelToggle.textContent = el.panelContent.hidden ? "Show settings" : "Hide settings";
  });

  wireMirroredInput(el.refInput, el.mobileRefInput, async () => {
    await updateVerse();
    saveSettings();
  });
  wireMirroredInput(el.mobileRefInput, el.refInput, async () => {
    await updateVerse();
    saveSettings();
  });

  // Selects the existing reference on focus, so typing immediately replaces
  // it instead of requiring a manual select-all first.
  el.refInput.addEventListener("focus", () => el.refInput.select());
  el.mobileRefInput.addEventListener("focus", () => el.mobileRefInput.select());

  const onTranslationChange = (select, other) => async () => {
    other.value = select.value;
    state.translation = select.value;
    await updateVerse();
    saveSettings();
  };
  el.translationSelect.addEventListener("change", onTranslationChange(el.translationSelect, el.mobileTranslationSelect));
  el.mobileTranslationSelect.addEventListener("change", onTranslationChange(el.mobileTranslationSelect, el.translationSelect));

  el.zoomSlider.addEventListener("input", () => setZoom(Number(el.zoomSlider.value)));
  el.textSizeSlider.addEventListener("input", () => setTextScale(Number(el.textSizeSlider.value)));

  el.saveStandardBtn.addEventListener("click", () => doSave("standard"));
  el.saveHighresBtn.addEventListener("click", () => doSave("highres"));
  el.saveHdBtn.addEventListener("click", () => doSave("hd"));
  el.save4kBtn.addEventListener("click", () => doSave("4k"));

  wireMobileSave();
  wireCustomizeQuote();
}

function loadInitialPhoto() {
  // "upload" has nothing to restore - wait for a dropped file.
  if (state.imageSource === "upload") return;
  if (state.photoUrl) return restorePhoto(state.imageSource, state.photoUrl, state.photoCredit);
  const preferFile = state.imageSource === "mountain" ? DEFAULT_MOUNTAIN_PHOTO : undefined;
  return loadPhotoForSource(state.imageSource, { preferFile });
}

// Canvas text doesn't wait for webfonts the way DOM text does - drawing
// before a font finishes loading silently falls back to the default
// sans-serif and never repaints once the font arrives. Force both weights
// we actually draw with, for both font stacks (so switching "modern"/
// "classic" doesn't flash a fallback either), to load before first render.
async function ensureFontsLoaded() {
  if (!document.fonts) return;
  try {
    await Promise.all(Object.values(FONT_STACKS).flatMap((font) => [
      document.fonts.load(`${THEME.verseWeight} 16px ${font.fontFamily}`),
      document.fonts.load(`italic ${THEME.refWeight} 16px ${font.fontFamily}`),
    ]));
  } catch {
    // Font failed to load (offline, blocked, etc.) - fall back silently.
  }
}

async function init() {
  el.translationSelect.value = state.translation;
  el.mobileTranslationSelect.value = state.translation;
  el.zoomSlider.value = Math.round(state.zoom * 100);
  el.textSizeSlider.value = Math.round(state.textScale * 100);

  resizePreviewCanvas();
  buildAspectSelect(el.aspectSelect);
  buildAspectSelect(el.mobileAspectSelect);
  buildFilterButtons();
  buildSourceButtons();
  buildTextThemeButtons();
  buildFontButtons();
  buildMobileRow2();
  buildMobileRow3();
  updateSaveRowVisibility();
  updateMobileSaveMenu();
  updateWallpaperSafeZoneVisibility();
  wireDrag();
  if (UPLOAD_ENABLED) wireUpload();
  wireEvents();
  el.refInput.value = saved.reference ?? DEFAULT_REFERENCE;
  el.mobileRefInput.value = el.refInput.value;
  updateVerse();
  await ensureFontsLoaded();
  loadInitialPhoto();
}

init();

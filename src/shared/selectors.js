/**
 * Všechny selektory a názvy prvků YouTube na jednom místě.
 *
 * Když YouTube změní web a něco přestane fungovat, oprav to tady.
 * Každá položka je pole alternativ; použije se první, která na stránce existuje.
 * Původ: poznatky z RYD (dislajky), avi12/youtube-auto-hd (menu, režim kina)
 * a Better YouTube Theatre Mode (kontejner přehrávače). Položky označené [P]
 * jsou předpoklady ověřené jen ručně v prohlížeči.
 */
export const SELECTORS = Object.freeze({
  // Stránka sledování (desktop). ytd-watch-grid je novější varianta layoutu.
  watchFlexy: ['ytd-watch-flexy:not([hidden])', 'ytd-watch-grid:not([hidden])'],
  masthead: ['#masthead-container'],

  // Přehrávač. #inline-preview-player je náhled při najetí myší na miniaturu.
  player: ['#movie_player', '#shorts-player', '.html5-video-player:not(#inline-preview-player)'],
  sizeButton: ['.ytp-size-button'],

  // Menu nastavení přehrávače (záloha pro volbu kvality).
  settingsButton: ['.ytp-settings-button'],
  settingsMenuItem: ['.ytp-settings-menu .ytp-menuitem', '.ytp-popup .ytp-menuitem'],
  menuItemContent: ['.ytp-menuitem-content'],
  qualityDropDownTrigger: ['.ytp-drop-down-label'],
  qualityDropDownOption: ['.ytp-drop-down-menu-button'],
  premiumLabel: ['.ytp-premium-label'],

  // Tlačítka Líbí se / Nelíbí se na stránce sledování.
  watchActions: [
    'ytd-watch-metadata #top-level-buttons-computed',
    'ytd-menu-renderer.ytd-watch-metadata > div',
    '#top-level-buttons-computed',
  ],
  segmentedLikeDislike: ['ytd-segmented-like-dislike-button-renderer', 'segmented-like-dislike-button-view-model'],
  dislikeButtonHost: ['dislike-button-view-model', '#segmented-dislike-button', '#dislike-button'],
  likeButtonHost: ['like-button-view-model', '#segmented-like-button', '#like-button'],
  buttonShape: ['button.ytSpecButtonShapeNextHost', 'button.yt-spec-button-shape-next', 'button'],
  // Živý chat: nativní tlačítko sbalení (je skryté, ale kliknutí na něj chat sbalí/rozbalí). Ověřeno 2026-11.
  liveChatToggle: ['ytd-live-chat-frame #show-hide-button button'],
  // Text v tlačítku (u „Líbí se“ obsahuje počet). Ověřeno 2026-11: camelCase třídy.
  buttonText: ['.ytSpecButtonShapeNextButtonTextContent', '.yt-spec-button-shape-next__button-text-content'],
  touchFeedback: ['yt-touch-feedback-shape'],

  // Shorts (ověřeno 2026-11 v Brave 158): renderer už nemá atribut is-active → aktivní se pozná podle
  // polohy uprostřed okna. Nový layout NEMÁ tlačítko „Nelíbí se“ → vkládáme vlastní prvek za „Líbí se“.
  // ytd-reel-video-renderer-cow = varianta z A/B testu YouTube (ověřeno 2026-11), střídá se s původní.
  shortsRenderer: ['ytd-reel-video-renderer', 'ytd-reel-video-renderer-cow'],
  shortsActionBar: ['reel-action-bar-view-model', '#actions'],
  shortsButtonLabel: [
    '.ytSpecButtonShapeWithLabelLabel [role="text"]',
    '.ytSpecButtonShapeWithLabelLabel span',
    '.yt-spec-button-shape-with-label__label span',
  ],
  shortsButtonLabelBox: ['.ytSpecButtonShapeWithLabelLabel', '.yt-spec-button-shape-with-label__label'],
  shortsButtonWithLabel: ['.ytSpecButtonShapeWithLabelHost', 'label'],

  // Modul „Skrýt Shorts“: každý selektor se skryje samostatným CSS pravidlem (neplatný selektor tak
  // nerozbije ostatní). Ověřeno 2026-11 v Brave 158 na vyhledávání, kanálu a menu; police na hlavní
  // stránce a v doporučených podle známých prvků [P] (v čistém profilu bez historie se nezobrazují).
  shortsHide: [
    // police Shorts (vyhledávání, hlavní stránka, odběry, doporučená videa)
    'grid-shelf-view-model:has(ytm-shorts-lockup-view-model)',
    'ytd-rich-shelf-renderer[is-shorts]',
    'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
    'ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model)',
    'ytd-reel-shelf-renderer',
    'ytm-shorts-lockup-view-model-v2',
    'ytm-shorts-lockup-view-model',
    // jednotlivá videa s odkazem na /shorts/
    'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
    'ytd-video-renderer:has(a[href^="/shorts/"])',
    'ytd-grid-video-renderer:has(a[href^="/shorts/"])',
    'ytd-compact-video-renderer:has(a[href^="/shorts/"])',
    'yt-lockup-view-model:has(a[href^="/shorts/"])',
    // položka v postranním menu (title je „Shorts“ i v češtině) a karta na kanálu
    'ytd-guide-entry-renderer:has(a[title="Shorts"])',
    'ytd-mini-guide-entry-renderer:has(a[title="Shorts"])',
    'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
    'yt-tab-shape[tab-title="Shorts"]',
    // [P] totéž podle odkazu (nezávisle na jazyce YouTube); text výše zůstává jako záloha
    'ytd-guide-entry-renderer:has(a[href^="/shorts"])',
    'ytd-mini-guide-entry-renderer:has(a[href^="/shorts"])',
    'yt-tab-shape:has(a[href$="/shorts"])',
  ],
  // Filtry nad výsledky („Vše · Shorts · Videa…“) nemají atribut → hledají se podle textu.
  shortsChips: ['yt-chip-cloud-chip-renderer', 'chip-view-model', 'chip-shape'],
});

/**
 * Modul „Skrýt rozptýlení“: položka → selektory (každý se skryje samostatným pravidlem).
 * Ověřeno 2026-11 v Brave 158 na /watch a na hlavní stránce.
 */
export const DISTRACTION_SELECTORS = Object.freeze({
  endScreens: ['.ytp-ce-element', '.ytp-endscreen-content', '.ytp-autonav-endscreen-upnext-container'],
  cards: ['.ytp-cards-teaser', '.ytp-cards-button', '.iv-branding', '.ytp-paid-content-overlay'],
  related: ['ytd-watch-flexy #related'],
  homeFeed: ['ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'],
  comments: ['ytd-watch-flexy #comments'],
});

/** Text filtru/karty Shorts (stejný v češtině i angličtině). */
export const SHORTS_LABEL = 'Shorts';

/** Atributy a třídy, které YouTube přepíná a my je čteme. */
export const YT = Object.freeze({
  theaterAttr: 'theater',
  fullscreenAttr: 'fullscreen',
  videoIdAttr: 'video-id',
  adShowingClass: 'ad-showing', // [P] třída na #movie_player během reklamy
  playerClass: 'html5-video-player',
  liveChatExpandedAttr: 'live-chat-present-and-expanded', // na ytd-watch-flexy, když je chat rozbalený // společná třída přehrávače (stránka sledování, Shorts i embed)
  // Varianta tlačítka „jen ikona“ → „ikona + text“. YouTube střídá dvě schémata tříd
  // (kebab-case starší, camelCase ověřené 2026-11); dvojice [jen ikona, ikona + text].
  iconClassPairs: [
    ['ytSpecButtonShapeNextIconButton', 'ytSpecButtonShapeNextIconLeading'],
    ['yt-spec-button-shape-next--icon-button', 'yt-spec-button-shape-next--icon-leading'],
  ],
  // Záložní třídy textu, když na stránce není tlačítko „Líbí se“, ze kterého je převezmeme.
  buttonTextClasses: 'ytSpecButtonShapeNextButtonTextContent ytSpecButtonShapeNextElevatedContent',
});

/** Vrátí první prvek, který odpovídá některé z alternativ. */
export function q(key, root = document) {
  if (!root) return null;
  for (const selector of SELECTORS[key]) {
    const element = root.querySelector(selector);
    if (element) return element;
  }
  return null;
}

/** Vrátí všechny prvky odpovídající kterékoli z alternativ (bez duplicit, v pořadí dokumentu). */
export function qAll(key, root = document) {
  if (!root) return [];
  return [...root.querySelectorAll(SELECTORS[key].join(','))];
}

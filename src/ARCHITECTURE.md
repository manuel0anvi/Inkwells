# 📋 Journal v5 - Modular Architecture

Architektur-Übersicht nach Refactoring (März 2026).

## 📁 Verzeichnisstruktur

```
src/
├── core/                        # Globale State & Utilities (JS)
│   ├── state.js                 # CFG, S (state), E, QA, uid, fmt
│   ├── dialogs.js               # showAlert, showConfirm, toast, txtModal
│   ├── data.js                  # getNb, getPage, makePage, getSections
│   └── zoom.js                  # Zoom system, getZoom, setZoom, _applyZoom
│
├── ui/                          # User Interface Components (JS)
│   ├── homeGrid.js              # renderHomeGrid, notebook cards, NB modal
│   ├── sidebar.js               # renderSideTree, section navigation
│   └── toolbar.js               # Mode switching, color picker, text formatting
│
├── canvas/                      # Drawing & Input System (JS)
│   ├── drawing.js               # makeCanvas, redrawStrokes, drawStroke
│   └── input.js                 # Pointer handling, drawing, erasing
│
├── css/                         # Modular Stylesheets
│   ├── base.css                 # Root variables, reset, typography
│   ├── titlebar.css             # App titlebar, window controls
│   ├── layout.css               # Main layout, home screen, grid
│   ├── sidebar.css              # Navigation, sections, tree structure
│   ├── toolbar.css              # Toolbar, buttons, color controls
│   ├── pages.css                # Page rendering, canvas, text editing
│   ├── modals.css               # Dialogs, overlays, menus, popovers
│   └── responsive.css           # Media queries, mobile, touch optimizations
│
├── app.js                       # Main app orchestration
├── index.html                   # HTML structure + script loader
└── style.css                    # Main stylesheet (imports all css/ modules)
```

## 🔄 Module & Ihre Aufgaben

### `core/state.js`
- **Globale Konstanten:** CFG (page sizes), BG_TYPES, NB_COLORS, PEN_SIZES
- **Globaler State:** S (notebooks, active notebook/page, mode settings)
- **DOM Helpers:** E() (getElementById), QA() (querySelectorAll), uid() (unique ID generator), fmt() (date formatting)

### `core/dialogs.js`
- **Custom Dialogs:** showAlert, showConfirm, showInsertChoice
- **Notify UI:** toast, txtModal
- **Background UI:** buildBgRow, setTitleBar, showHome, showJournal

### `core/data.js`
- **Data Queries:** getNb, getPage, notebookPages, visiblePages, pagesOfSec
- **Data Builders:** makePage, clonePage, insertPageInto, pageIsEmpty, pagePreview
- **Data Helpers:** getSections, activeSection, findSecForPage, setSectionOfPage,
  pageNumberOf, movePageBefore, colorForSection, sectionPalette,
  normalizeNotebook, syncSectionIds

> **Abschnitte sind Etiketten, keine Kapitel.** Die Reihenfolge eines Hefts
> steht in `nb.pages`, die Zugehörigkeit einer Seite in `page.secId`. Ein
> Abschnitt ist damit ein *Ausschnitt* aus einer durchgehenden Folge, und
> `nb.activeSecId` sagt, worauf die Ansicht gerade eingeschränkt ist (leer
> = alle Seiten). Die Seitenzahl ist immer die Stelle im Heft — sie ändert
> sich beim Filtern nicht.
>
> `sec.pgIds` gibt es weiterhin, aber nur noch **abgeleitet**
> (`syncSectionIds`). Es hält ältere Stände lesefähig: die hielten einen
> Abschnitt ohne `pgIds` für leer und legten ungefragt Füllseiten an.
> Gelesen wird die Zugehörigkeit nirgends mehr daraus — außer beim
> Empfangen im Live-Betrieb, wo sie genau auf diesem Weg mitreist.
>
> **Ein Heft startet ohne Abschnitte.** Früher legte `getSections()`
> ungefragt einen namens „Allgemein" an, der alle Seiten enthielt — nötig,
> solange die Anzeige an `pgIds` hing. Als Etikett sagt er nichts aus und
> steht in der Navigation als Auswahl, die dasselbe zeigt wie „Alle
> Seiten"; `dropCatchAllSection()` räumt ihn beim Laden weg.
>
> Ältere Hefte stellt `normalizeNotebook()` beim Laden um; erkennbar an
> `nb.schemaVersion`. Es läuft auch über schon umgestellte Hefte, weil die
> Abschaffung des Zwangsabschnitts später kam als die Umstellung selbst.

### `core/zoom.js`
- **Zoom Management:** getZoom, setZoom, zoomIn, zoomOut, zoomReset
- **Zoom Helpers:** getCanvasDpr, isVerticalMode, getVerticalFitZoom
- **DOM Updates:** _applyZoom, refreshSizer, rerenderCanvasesForZoom
- **Listeners:** window.resize handler

### `ui/homeGrid.js`
- **Home Screen:** renderHomeGrid (notebook cards)
- **Context Menu:** showCtxMenu, hideCtxMenu, hideCtxOut
- **Notebook Modal:** openNbModal, event listeners

### `ui/sidebar.js`
- **Navigation Tree:** renderSideTree (Ausschnitte + Überschriften)
- **Page Management:** scrollToHdg, setActivePg, renumberVisiblePages
- **Abschnittsverwaltung:** openSecMgr, renderSecMgrBody/-Side/-Pages —
  links die Abschnitte als Filter, rechts die Seiten des Hefts mit
  anklickbarem Etikett. `_secMgrFilter`: `'*'` alle, `''` ohne Abschnitt,
  sonst eine `secId`. openSectionEditor setzt Name und Farbe.
- **Umsortieren:** ensureSecMgrDnd, messeZeilen, zielStelle, reorderPageDom.
  Die Zeilenmitten werden **einmal beim Aufnehmen** gemessen; `dragover`
  sucht nur noch binär darin. Die Ablegemarke ist ein innerer Schatten, weil
  eine eingeschobene Zeile die Messung ungültig machen würde.

> **Der Baum wird nicht bei jeder Kleinigkeit neu gebaut.** renderSideTree()
> läuft über alle gezeigten Seiten und fragt für jede das DOM ab. Beim
> Scrollen genügt `markActiveNavItem()` (nur die Markierung), beim Tippen
> `scheduleSideTree()` (gebremst). Vorher hing an beidem ein vollständiger
> Neuaufbau — bei hundert Seiten der Engpass.

### `ui/toolbar.js`
- **Mode Switching:** switchMode (pen1, pen2, hl, eraser, cursor)
- **Color Picker:** updatePenUI, openCustomColorPopover, syncGlobalCustomColor
- **Text Formatting:** toggleHeading (H1/H2/H3), updateHdrBtns, curBlockTag
- **Text Color:** positionTextColorDropdown, text color UI

### `canvas/drawing.js`
- **Canvas Creation:** makeCanvas (w, h)
- **Stroke Rendering:** redrawStrokes, drawStroke, drawHLGroup
- **Canvas Context:** getLiveCtx, clearLiveCanvas

### `canvas/input.js`
- **Pointer Events:** attachInput (handlers for pointerdown/move/up)
- **Drawing:** buildStroke, liveDrawIncr (live feedback)
- **Erasing:** pointToLineDistance, strokeErase
- **Caret Placement:** placeCaret, placeCaretAnywhere

### `app.js` (Remaining)
- **Page Navigation:** openNotebook, openSection, renderOpenSection
- **Page Layout:** appendPageDOM, checkPageOverflow, applyTextLayoutForBg
- **Page Flow:** setupScrollAutoPage, maybeAutoPage, addAutoPage
- **Objects:** placeObject, deselect, updateCursor
- **File Operations:** buildPdf, syncAll, insertFile
- **Window Controls:** minimize, maximize, close buttons
- **Touch Handling:** Pinch zoom, pan gestures

## 📊 Statistik

### JavaScript
| Datei | Zeilen | Rolle |
|-------|--------|-------|
| state.js | 48 | Global state & constants |
| dialogs.js | 104 | UI dialogs & notifications |
| data.js | 39 | Data access layer |
| zoom.js | 132 | Zoom system & rendering |
| homeGrid.js | 50 | Home screen UI |
| sidebar.js | 117 | Navigation tree |
| toolbar.js | 275 | Toolbar & formatting |
| drawing.js | 76 | Canvas rendering |
| input.js | 255 | Input handling |
| **app.js** | **~2000** | Main orchestration |

### CSS
| Datei | Zeilen | Rolle |
|-------|--------|-------|
| base.css | 39 | Reset, variables, typography |
| titlebar.css | 91 | Titlebar & window controls |
| layout.css | 195 | Main viewport, grid layout |
| sidebar.css | 285 | Navigation, sections |
| toolbar.css | 344 | Toolbar, buttons, controls |
| pages.css | 302 | Pages, canvas, text editing |
| modals.css | 461 | Dialogs & overlays (größtes Modul) |
| responsive.css | 131 | Media queries, mobile |

**Total JS:** ~1100 Zeilen modularisiert ✅  
**Total CSS:** ~1848 Zeilen aufgeteilt in 8 Module ✅

## 🔧 Script-Ladreihenfolge (index.html)

```html
<!-- Basis -->
<script src="core/state.js"></script>      <!-- Global state (S, CFG, E, QA) -->
<script src="core/dialogs.js"></script>    <!-- Dialogs benötigen: state -->
<script src="core/data.js"></script>       <!-- Data benötigt: state -->
<script src="core/zoom.js"></script>       <!-- Zoom benötigt: state, E, QA -->

<!-- UI -->
<script src="ui/homeGrid.js"></script>     <!-- benötigt: state, dialogs, data -->
<script src="ui/sidebar.js"></script>      <!-- benötigt: state, dialogs, data -->
<script src="ui/toolbar.js"></script>      <!-- benötigt: state -->

<!-- Canvas -->
<script src="canvas/drawing.js"></script>  <!-- benötigt: state -->
<script src="canvas/input.js"></script>    <!-- benötigt: state, drawing, zoom -->

<!-- Main -->
<script src="app.js"></script>             <!-- benötigt: alles oben -->
```

## 🎨 CSS-Ladreihenfolge (style.css)

```css
/* Foundation: Colors, reset, typography */
@import 'css/base.css';                   /* :root, *, html, body */

/* UI Subcomponents (in order of DOM hierarchy) */
@import 'css/titlebar.css';               /* .titlebar, .tbar-* */
@import 'css/layout.css';                 /* .view, .journal-layout, .editor-col */
@import 'css/sidebar.css';                /* .side-panel, .side-tree, .sec-* */
@import 'css/toolbar.css';                /* .toolbar, .tb-*, buttons */
@import 'css/pages.css';                  /* .j-page, .j-canvas, .j-text */
@import 'css/modals.css';                 /* .overlay, .modal, popovers */

/* Responsive & touch optimizations (last, can override) */
@import 'css/responsive.css';             /* @media queries, touch rules */
```

**Wichtig:** Die Ladreihenfolge gewährleistet, dass Basis-Styles zuerst kommen, dann Komponenten, dann Responsive-Overrides.

## 💡 Nächste Optimierungen (optional)

- Extrahiere `page/layout.js` – appendPageDOM, applyTextLayoutForBg
- Extrahiere `features/fileOps.js` – buildPdf, insertFile, syncAll
- Extrahiere `features/objects.js` – placeObject, deselect
- Extrahiere `window/controls.js` – minimize, maximize, close

Dies würde app.js auf ~800 Zeilen Kernlogik reduzieren.

## ✅ Status

- [x] State + Constants modularisiert
- [x] UI Components aufgeteilt
- [x] Canvas System moduliert  
- [x] Zoom System ausgelagert
- [x] **CSS in 8 Module aufgeteilt** ✨
- [x] Script-Ladreihenfolge optimiert
- [x] Dokumentation (ARCHITECTURE.md) aktualisiert
- [ ] app.js von Duplikaten bereinigt (optional)
- [ ] Weitere Page/Object Module falls nötig

---
**Hinweis:** Die app.js enthält noch Duplikate der ausgelagerten Code-Blöcke. Dies funktioniert, aber index.html sichert sich, dass die Module zuerst geladen werden.

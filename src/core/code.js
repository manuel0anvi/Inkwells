'use strict';

/* ══════════════════════════════════════════════════════════════════════
   CODE IM SEITENTEXT

   Ein Codeblock ist ein <pre class="j-code" data-lang="python"> im
   contenteditable – genau wie eine Tabelle gewöhnliches HTML ist
   (core/tables.js). Das ist keine Bequemlichkeit, sondern die
   Voraussetzung dafür, dass er überhaupt mitspielt:

     · Der gemeinsame Text geht als HTML durch Yjs (ui/collab.js).
     · Gespeichert wird derselbe Text (page.textContent).
     · Die Schreibmarken rechnen über flatTextParts (canvas/text.js).
       <PRE> steht dort schon in FLAT_BLOCK_TAGS, und die Zeilenumbrüche
       im Code sind echte \n im Text – Marken und Sperrbänder sitzen also
       ohne Zutun richtig.

   ── Was im Heft steht und was nur darüberliegt ──────────────────────
   Im Heft steht NUR der nackte Code. Die Farben sind
   <span class="j-tok-…">, sie entstehen erst beim Anzeigen und werden
   von ohneGriffe() in app.js wieder abgezogen.

   >>> Warum das so sein MUSS <<<
   Färbte man den Text im Heft ein, ginge bei jedem Tastendruck ein neues
   Farbgerüst durch Yjs. Ein einziges getipptes Zeichen ändert die
   Einfärbung der ganzen Zeile – aus einem Anschlag würde ein Unterschied
   über hunderte Zeichen, und der Abgleich zweier Leute erstickte daran.
   Dieselbe Überlegung wie bei den Greifstreifen der Tabelle.

   >>> Und warum die Schreibmarke dabei nicht springt <<<
   Weil das Einfärben den FLACHEN Text nicht anfasst: <span> zählt in
   flatTextParts als inline, die Zeichen bleiben dieselben, nur ihre
   Verpackung ändert sich. flatCaretPos() vor dem Einfärben und
   setFlatCaret() danach treffen deshalb exakt dieselbe Stelle.

   ── Der Einfärber ───────────────────────────────────────────────────
   Selbst geschrieben und klein gehalten. Eine Bibliothek von einem
   fremden Server verbietet die Inhaltsrichtlinie (src/index.html), und
   sie mitzuliefern hiesse ein halbes Megabyte für etwas, das hier aus
   Zeichenketten, Kommentaren, Zahlen und einer Wortliste je Sprache
   besteht.
   ══════════════════════════════════════════════════════════════════════ */

(function () {

  /* ── Die Sprachen ─────────────────────────────────────────────────
     Die Liste muss mit SPRACHEN in core/sanitize.js übereinstimmen –
     dort entscheidet sich, was als data-lang durchkommt. */
  const SPRACHEN = {
    text:       { name: 'Text',       woerter: '' },
    java:       { name: 'Java',       woerter: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yield true false null' },
    python:     { name: 'Python',     woerter: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None match case self' },
    c:          { name: 'C',          woerter: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while include define ifdef ifndef endif pragma NULL true false' },
    cpp:        { name: 'C++',        woerter: 'alignas alignof and asm auto bool break case catch char class const constexpr continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator or private protected public register return short signed sizeof static static_cast struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile while include define' },
    csharp:     { name: 'C#',         woerter: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await' },
    javascript: { name: 'JavaScript', woerter: 'await async break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield true false null undefined NaN' },
    typescript: { name: 'TypeScript', woerter: 'await async break case catch class const continue debugger declare default delete do else enum export extends finally for function if implements import in instanceof interface let namespace new of private protected public readonly return static super switch this throw try type typeof var void while yield true false null undefined any string number boolean unknown never' },
    html:       { name: 'HTML',       woerter: '' },
    css:        { name: 'CSS',        woerter: '' },
    sql:        { name: 'SQL',        woerter: 'select from where insert into values update set delete create table drop alter add primary key foreign references not null unique default index view join inner left right outer full on group by having order asc desc limit offset union all distinct as and or in between like exists count sum avg min max case when then else end begin commit rollback' },
    bash:       { name: 'Shell',      woerter: 'if then else elif fi for while do done case esac in function return break continue local export source echo cd ls mkdir rm cp mv cat grep sed awk chmod chown sudo apt ping ifconfig ip route netstat ssh scp' },
    json:       { name: 'JSON',       woerter: 'true false null' },
    xml:        { name: 'XML',        woerter: '' },
    php:        { name: 'PHP',        woerter: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null' }
  };

  const SPRACH_LISTE = Object.keys(SPRACHEN);

  /* Wie ein Kommentar in welcher Sprache anfängt. */
  const ZEILEN_KOMMENTAR = {
    python: '#', bash: '#', sql: '--',
    java: '//', c: '//', cpp: '//', csharp: '//',
    javascript: '//', typescript: '//', php: '//', css: null,
    html: null, xml: null, json: null, text: null
  };

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const marke = (klasse, text) => '<span class="j-tok-' + klasse + '">' + esc(text) + '</span>';

  /* ══════════════════════════════════════════════════════════════════
     EINE SCHLEIFE, DIE SICH NICHT AUFHÄNGEN KANN

     Jeder Durchgang unten schiebt einen Zeiger von links nach rechts.
     Kommt ein Zweig einmal nicht voran, dreht sich die Schleife ewig –
     und weil das Einfärben nach jeder Tipp-Pause läuft, stünde die
     ganze App. Genau das ist beim Bauen passiert: das `#` von
     "#include" startete den Wort-Zweig, war aber selbst kein
     Wortzeichen, und der Zeiger blieb stehen.

     Der Fehler ist behoben, aber die Sicherung bleibt. Sie kostet einen
     Vergleich je Zeichen und macht aus einem eingefrorenen Fenster im
     schlimmsten Fall ein falsch eingefärbtes Wort.
     ══════════════════════════════════════════════════════════════════ */
  function schrittWache() {
    let vorher = -1;
    return (jetzt) => {
      const steht = jetzt <= vorher;
      vorher = jetzt;
      return steht;
    };
  }

  /* ══════════════════════════════════════════════════════════════════
     DER EINFÄRBER

     Ein einziger Durchgang von links nach rechts. Er kennt fünf Dinge:
     Kommentar, Zeichenkette, Zahl, Wort und alles Übrige. Was ein Wort
     ist, entscheidet die Wortliste der Sprache.

     Auszeichnungssprachen (HTML, XML) gehen einen eigenen Weg – dort
     gibt es keine Schlüsselwörter, sondern Tags und Attribute.
     ══════════════════════════════════════════════════════════════════ */
  function faerbe(code, sprache) {
    const s = SPRACHEN[sprache] ? sprache : 'text';
    if (s === 'text') return esc(code);
    if (s === 'html' || s === 'xml') return faerbeAuszeichnung(code);
    if (s === 'css') return faerbeCss(code);

    const woerter = new Set(SPRACHEN[s].woerter.split(/\s+/).filter(Boolean));
    const komm = ZEILEN_KOMMENTAR[s];
    const blockKomm = s !== 'python' && s !== 'bash' && s !== 'sql';

    let out = '';
    let i = 0;
    const steht = schrittWache();

    while (i < code.length) {
      if (steht(i)) { out += esc(code[i]); i++; continue; }
      const c = code[i];

      // Zeilenkommentar
      if (komm && code.startsWith(komm, i)) {
        let j = code.indexOf('\n', i);
        if (j < 0) j = code.length;
        out += marke('komm', code.slice(i, j));
        i = j;
        continue;
      }

      // Blockkommentar
      if (blockKomm && c === '/' && code[i + 1] === '*') {
        let j = code.indexOf('*/', i + 2);
        j = j < 0 ? code.length : j + 2;
        out += marke('komm', code.slice(i, j));
        i = j;
        continue;
      }

      // Zeichenkette – auch dreifach, wie in Python
      if (c === '"' || c === "'" || c === '`') {
        const drei = code.startsWith(c + c + c, i);
        const ende = drei ? c + c + c : c;
        let j = i + ende.length;
        while (j < code.length) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code.startsWith(ende, j)) { j += ende.length; break; }
          // Eine einfache Zeichenkette endet spätestens am Zeilenende
          if (!drei && code[j] === '\n') break;
          j++;
        }
        out += marke('text', code.slice(i, Math.min(j, code.length)));
        i = Math.min(j, code.length);
        continue;
      }

      // Zahl
      if (/[0-9]/.test(c) && !/[\w$]/.test(code[i - 1] || '')) {
        let j = i;
        while (j < code.length && /[0-9a-fA-FxXbBoO._]/.test(code[j])) j++;
        out += marke('zahl', code.slice(i, j));
        i = j;
        continue;
      }

      // Wort: Schlüsselwort, Funktionsaufruf oder gewöhnlich
      if (/[A-Za-z_$@#]/.test(c)) {
        let j = i;
        /* Ein führendes # (Präprozessor in C) oder @ (Annotation in Java,
           Dekorator in Python) gehört zum Wort, ist aber selbst kein
           Wortzeichen. Ohne diese Zeile stand der Zeiger still und die
           Schleife drehte sich ewig – bei jedem "#include". */
        if (c === '#' || c === '@') j++;
        while (j < code.length && /[\w$]/.test(code[j])) j++;

        // Ein einzelnes # oder @ ohne Wort dahinter: einfach ausgeben
        if (j === i) { out += esc(c); i++; continue; }

        const wort = code.slice(i, j);
        // In der Wortliste steht "include", geschrieben wird "#include"
        const kern = wort.replace(/^[#@]/, '');

        if (woerter.has(kern)) out += marke('key', wort);
        else if (code[j] === '(') out += marke('fn', wort);
        // Grossgeschrieben heisst fast immer Klasse oder Konstante
        else if (/^[A-Z]/.test(wort)) out += marke('typ', wort);
        else out += esc(wort);
        i = j;
        continue;
      }

      out += esc(c);
      i++;
    }

    return out;
  }

  /** HTML und XML: Tags, Attribute, Werte, Kommentare. */
  function faerbeAuszeichnung(code) {
    let out = '';
    let i = 0;
    const steht = schrittWache();
    while (i < code.length) {
      if (steht(i)) { out += esc(code[i]); i++; continue; }
      if (code.startsWith('<!--', i)) {
        let j = code.indexOf('-->', i);
        j = j < 0 ? code.length : j + 3;
        out += marke('komm', code.slice(i, j));
        i = j;
        continue;
      }
      if (code[i] === '<') {
        let j = code.indexOf('>', i);
        j = j < 0 ? code.length : j + 1;
        out += faerbeTag(code.slice(i, j));
        i = j;
        continue;
      }
      let j = code.indexOf('<', i);
      if (j < 0) j = code.length;
      out += esc(code.slice(i, j));
      i = j;
    }
    return out;
  }

  function faerbeTag(roh) {
    // <name attr="wert" …>
    const m = roh.match(/^<\/?\s*([A-Za-z][\w:-]*)/);
    if (!m) return esc(roh);
    let out = marke('satz', roh.slice(0, m.index + m[0].length - m[1].length))
      + marke('key', m[1]);
    const rest = roh.slice(m.index + m[0].length);
    let i = 0;
    const steht = schrittWache();
    while (i < rest.length) {
      if (steht(i)) { out += esc(rest[i]); i++; continue; }
      const a = rest.slice(i).match(/^\s*([\w:-]+)/);
      if (a) {
        out += esc(rest.slice(i, i + a[0].length - a[1].length)) + marke('attr', a[1]);
        i += a[0].length;
        const w = rest.slice(i).match(/^(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/);
        if (w) {
          out += esc(w[1]) + marke('text', w[2]);
          i += w[0].length;
        }
        continue;
      }
      out += esc(rest[i]);
      i++;
    }
    return out;
  }

  /* CSS: innerhalb der geschweiften Klammern stehen Eigenschaften,
     ausserhalb Wähler. Diese eine Unterscheidung genügt und ist am
     Zeichenstrom leicht mitzuführen – der frühere Versuch, das aus dem
     Text davor zu erraten, lag bei jeder zweiten Zeile daneben. */
  function faerbeCss(code) {
    let out = '';
    let i = 0;
    let inRegel = false;
    const steht = schrittWache();

    while (i < code.length) {
      if (steht(i)) { out += esc(code[i]); i++; continue; }
      if (code.startsWith('/*', i)) {
        let j = code.indexOf('*/', i + 2);
        j = j < 0 ? code.length : j + 2;
        out += marke('komm', code.slice(i, j));
        i = j;
        continue;
      }
      if (code[i] === '{') { inRegel = true; out += esc('{'); i++; continue; }
      if (code[i] === '}') { inRegel = false; out += esc('}'); i++; continue; }

      if (inRegel) {
        const eig = code.slice(i).match(/^([-\w]+)(\s*:\s*)([^;}\n]*)/);
        if (eig) {
          out += marke('attr', eig[1]) + esc(eig[2]) + marke('text', eig[3]);
          i += eig[0].length;
          continue;
        }
      } else {
        const waehler = code.slice(i).match(/^([.#:]?[\w-]+|@[\w-]+)/);
        if (waehler) {
          out += marke('key', waehler[0]);
          i += waehler[0].length;
          continue;
        }
      }

      out += esc(code[i]);
      i++;
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════
     EINFÄRBEN, OHNE DIE MARKE ZU VERLIEREN

     Der flache Text ändert sich dabei nicht (siehe der Kasten oben),
     deshalb genügt: Stelle merken, färben, Stelle wieder setzen.
     ══════════════════════════════════════════════════════════════════ */
  function faerbeBlock(pre) {
    if (!pre) return;
    const sprache = pre.dataset.lang || 'text';
    const roh = pre.textContent || '';
    const neu = faerbe(roh, sprache);
    // Nichts zu tun? Dann auch nicht anfassen – das spart das Setzen der Marke
    if (pre.innerHTML === neu) return;
    pre.innerHTML = neu;
  }

  /** Alle Blöcke eines Textfeldes einfärben, die Marke bleibt stehen. */
  function faerbeAlle(textDiv) {
    if (!textDiv) return;
    const bloecke = textDiv.querySelectorAll('pre.j-code');
    if (!bloecke.length) return;

    let marke = null;
    const drin = document.activeElement === textDiv;
    if (drin && typeof flatCaretPos === 'function') {
      try { marke = flatCaretPos(textDiv); } catch (err) { marke = null; }
    }

    for (const pre of bloecke) faerbeBlock(pre);

    if (marke !== null && typeof setFlatCaret === 'function') {
      try { setFlatCaret(textDiv, marke); } catch (err) { /* dann bleibt sie, wo sie ist */ }
    }
  }

  /* ── Die Farben wieder abziehen ────────────────────────────────────
     Für ohneGriffe() in app.js: was ins Heft geht, ist nackter Code. */
  function ohneFarben(wurzel) {
    for (const pre of wurzel.querySelectorAll('pre.j-code')) {
      const roh = pre.textContent || '';
      if (pre.innerHTML !== roh) pre.textContent = roh;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     EINEN BLOCK EINSETZEN
     ══════════════════════════════════════════════════════════════════ */
  function codeUnterMarke() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    if (!node || typeof node.closest !== 'function') return null;
    const pre = node.closest('pre.j-code');
    return (pre && pre.closest('.j-text')) ? pre : null;
  }

  function insertCode(sprache = 'python') {
    let textDiv = document.activeElement;
    if (!textDiv || !textDiv.classList || !textDiv.classList.contains('j-text')) {
      textDiv = (typeof tabelleOhneMarke === 'function') ? tabelleOhneMarke() : null;
      if (!textDiv) {
        if (typeof toast === 'function') toast(t('codeNeedsCaret') || 'Erst in den Text klicken.', true);
        return false;
      }
    }
    if (S.readOnly) { if (typeof toast === 'function') toast(t('sharedNoRight'), true); return false; }

    // Kein Block im Block, und keiner in einer Tabellenzelle
    if (codeUnterMarke()) return false;

    const pgEl = textDiv.closest('[data-pgid]');
    const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
    if (!info) return false;

    if (typeof pushPageHistory === 'function') pushPageHistory(info.page);

    const pre = document.createElement('pre');
    pre.className = 'j-code';
    pre.dataset.lang = SPRACHEN[sprache] ? sprache : 'python';
    /* Eine Leerzeile als Inhalt: ein ganz leeres <pre> hat keine Höhe und
       man kann nicht hineinklicken. */
    pre.textContent = '\n';

    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(pre);
      // Ein Absatz dahinter, sonst kommt man unter dem Block nicht mehr heraus
      const danach = document.createElement('p');
      danach.appendChild(document.createElement('br'));
      pre.after(danach);
    } else {
      textDiv.appendChild(pre);
    }

    // Marke in den Block
    try {
      const r = document.createRange();
      r.setStart(pre.firstChild || pre, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (err) { /* dann steht sie, wo sie steht */ }

    if (typeof uebernimmText === 'function') uebernimmText(info.page, textDiv);
    if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
    zeigeCodeLeiste(pre);
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE LEISTE AM BLOCK

     Dieselbe Machart wie die Leiste an der Tabelle (core/tables.js): ein
     Element am document.body, das mitwandert. Sie steht bewusst NICHT im
     Text – dort würde sie mitgespeichert und über Yjs mitreisen.
     ══════════════════════════════════════════════════════════════════ */
  let leiste = null;
  let leistePre = null;

  function baueLeiste() {
    if (leiste) return leiste;
    leiste = document.createElement('div');
    leiste.className = 'j-code-bar';
    leiste.style.display = 'none';

    const wahl = document.createElement('select');
    wahl.className = 'j-code-lang';
    for (const id of SPRACH_LISTE) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = SPRACHEN[id].name;
      wahl.appendChild(o);
    }
    wahl.addEventListener('change', () => {
      if (!leistePre || !leistePre.isConnected) return;
      if (S.readOnly) return;
      leistePre.dataset.lang = wahl.value;
      faerbeBlock(leistePre);
      meldeAenderung(leistePre);
      /* Der nächste Block bekommt dieselbe Sprache – siehe letzteSprache
         in ui/insert.js. */
      if (typeof Settings !== 'undefined' && Settings.update) {
        Settings.update({ codeSprache: wahl.value }).catch(() => { /* nicht wichtig */ });
      }
    });
    leiste.appendChild(wahl);

    const knopf = (titel, zeichen, tun) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'j-code-btn';
      b.title = titel;
      b.textContent = zeichen;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', (e) => { e.preventDefault(); tun(); });
      leiste.appendChild(b);
      return b;
    };

    knopf(t('codeToggleTheme') || 'Hell oder dunkel', '◐', () => {
      if (!leistePre || !leistePre.isConnected || S.readOnly) return;
      leistePre.classList.toggle('j-code-hell');
      meldeAenderung(leistePre);
    });

    knopf(t('codeCopy') || 'Code kopieren', '⧉', async () => {
      if (!leistePre) return;
      try {
        await navigator.clipboard.writeText(leistePre.textContent || '');
        if (typeof toast === 'function') toast(t('codeCopied') || 'Code kopiert.');
      } catch (err) {
        if (typeof toast === 'function') toast(t('codeCopyFailed') || 'Kopieren ging nicht.', true);
      }
    });

    document.body.appendChild(leiste);
    return leiste;
  }

  /** Änderung ins Heft, an die anderen und auf den Merkzettel. */
  function meldeAenderung(pre) {
    const textDiv = pre && pre.closest ? pre.closest('.j-text') : null;
    if (!textDiv) return;
    const pgEl = textDiv.closest('[data-pgid]');
    const info = pgEl ? getPage(pgEl.dataset.pgid) : null;
    if (info && typeof uebernimmText === 'function') uebernimmText(info.page, textDiv);
  }

  function zeigeCodeLeiste(pre) {
    if (!pre || !pre.isConnected) { versteckeCodeLeiste(); return; }
    const bar = baueLeiste();
    leistePre = pre;

    bar.querySelector('.j-code-lang').value = pre.dataset.lang || 'text';
    bar.style.display = 'flex';

    const r = pre.getBoundingClientRect();
    if (!r.width && !r.height) { versteckeCodeLeiste(); return; }
    bar.style.left = Math.round(r.left) + 'px';
    bar.style.top = Math.round(r.top - bar.offsetHeight - 4) + 'px';
  }

  function versteckeCodeLeiste() {
    if (leiste) leiste.style.display = 'none';
    leistePre = null;
  }

  /* Steht die Marke in einem Block? Dann die Leiste zeigen, sonst weg.
     Am selben Anlass wie die Tabellenleiste. */
  document.addEventListener('selectionchange', () => {
    const pre = codeUnterMarke();
    if (pre) zeigeCodeLeiste(pre);
    else versteckeCodeLeiste();
  });

  const nachziehen = () => { if (leistePre) zeigeCodeLeiste(leistePre); };
  document.addEventListener('scroll', nachziehen, true);
  window.addEventListener('resize', nachziehen, { passive: true });

  window.InkwellsCode = {
    faerbe, faerbeAlle, faerbeBlock, ohneFarben,
    insertCode, codeUnterMarke, versteckeCodeLeiste,
    SPRACHEN, SPRACH_LISTE
  };
})();

'use strict';

/* ══════════════════════════════════════════════════════════════════════
   CODE AUF DEM BLATT

   Ein Codeblock ist ein OBJEKT auf der Seite (page.objects), kein Text
   im Fluss. Er liegt damit auf demselben Weg wie ein Bild oder eine
   Formel: verschieben, ziehen, vervielfältigen, löschen, vor oder hinter
   den Text – all das kann canvas/objects.js schon, und es gilt hier ohne
   eine einzige zusätzliche Zeile.

   >>> Warum nicht als <pre> mitten im Text <<<
   So war es zuerst gebaut, und es hatte einen unangenehmen Preis: die
   Einfärbung sass dann IM Seitentext. Jedes getippte Zeichen färbt die
   ganze Zeile um – aus einem Anschlag wurde ein Unterschied über
   hunderte Zeichen, der durch Yjs zu allen anderen reisen musste. Dagegen
   half nur, die Farben vor jedem Speichern wieder abzuziehen, und daran
   hingen vier weitere Stellen (ohneGriffe, der Sanitizer, das Einfärben
   nach jeder Tipp-Pause, Enter und Tab im Block).

   Als Objekt ist davon nichts mehr nötig. Was reist, ist `obj.code` –
   eine schlichte Zeichenkette. Die Farben entstehen erst beim Zeichnen
   des Körpers und stehen nirgends sonst.

   ── Was ein Code-Objekt trägt ───────────────────────────────────────
     code   der Quelltext, unverändert wie eingefügt
     lang   die Sprache (siehe SPRACHEN) – geraten oder selbst gewählt
     hell   helle statt dunkler Fassung
     natW/natH  die gemessene Größe; w/h ist die gezogene

   ── Der Einfärber ───────────────────────────────────────────────────
   Selbst geschrieben und klein gehalten. Eine Bibliothek von einem
   fremden Server verbietet die Inhaltsrichtlinie (src/index.html), und
   sie mitzuliefern hiesse ein halbes Megabyte für etwas, das hier aus
   Zeichenketten, Kommentaren, Zahlen und einer Wortliste je Sprache
   besteht.

   Der Dialog zum Eingeben liegt in ui/code.js.
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
     WELCHE SPRACHE IST DAS?

     Geraten wird über Merkmale, die für eine Sprache eigentümlich sind –
     nicht über einzelne Schlüsselwörter, die es überall gibt („if",
     „return", „class" stehen in fast jeder). Jedes Merkmal gibt Punkte,
     die höchste Summe gewinnt.

     Bleibt alles bei null, wird nichts geraten: dann steht „Text" da,
     und der Nutzer stellt es selbst um. Falsch geraten ist ärgerlicher
     als gar nicht geraten – die Farben sähen dann überall falsch aus.
     ══════════════════════════════════════════════════════════════════ */
  const MERKMALE = [
    ['python', [/^\s*def\s+\w+\s*\(.*\)\s*:/m, 3], [/^\s*from\s+[\w.]+\s+import\b/m, 3],
      [/^\s*import\s+\w+$/m, 2], [/\bprint\s*\(/, 1], [/^\s*elif\b/m, 3], [/\bself\b/, 2],
      [/^\s*#!.*python/m, 4], [/:\s*$/m, 1]],
    ['java', [/\bpublic\s+(static\s+)?(class|void|int|String)\b/, 3],
      [/System\.out\.print/, 4], [/^\s*package\s+[\w.]+;/m, 3],
      [/^\s*import\s+java\./m, 4], [/\bnew\s+[A-Z]\w*\s*\(/, 1], [/@Override/, 3]],
    ['csharp', [/\busing\s+System\b/, 4], [/Console\.Write/, 4],
      [/\bnamespace\s+\w+/, 3], [/\bpublic\s+\w+\s+\w+\s*\{\s*get;/, 3]],
    ['c', [/^\s*#include\s*[<"]/m, 4], [/\bprintf\s*\(/, 3], [/\bint\s+main\s*\(/, 3],
      [/\bmalloc\s*\(/, 2], [/->\w/, 1]],
    ['cpp', [/\bstd::/, 4], [/\bcout\s*<</, 4], [/^\s*#include\s*<iostream>/m, 4],
      [/\bnamespace\s+std\b/, 3], [/\btemplate\s*</, 3]],
    ['javascript', [/\bfunction\s*\w*\s*\(/, 1], [/=>\s*[{(]/, 2], [/\bconst\s+\w+\s*=/, 2],
      [/\bconsole\.log\s*\(/, 3], [/\bdocument\.(getElementById|querySelector)/, 3],
      [/\brequire\s*\(['"]/, 2], [/`[^`]*\$\{/, 2]],
    ['typescript', [/:\s*(string|number|boolean|void|any)\b/, 3], [/\binterface\s+\w+\s*\{/, 3],
      [/\bexport\s+(type|interface)\b/, 3]],
    ['html', [/<!DOCTYPE\s+html/i, 5], [/<\/(div|span|p|body|html|head|table)>/i, 3],
      [/<(div|span|body|html|head)\b[^>]*>/i, 2]],
    ['xml', [/<\?xml\b/, 5], [/xmlns[:=]/, 3]],
    ['css', [/^\s*[.#]?[\w-]+\s*\{[^}]*:[^}]*;/m, 3], [/@media\b/, 3],
      [/\b(color|margin|padding|background|display)\s*:/, 2]],
    ['sql', [/\bSELECT\b[\s\S]*\bFROM\b/i, 4], [/\bINSERT\s+INTO\b/i, 4],
      [/\bCREATE\s+TABLE\b/i, 4], [/\bWHERE\b.*=/i, 1]],
    ['bash', [/^#!.*\/(ba)?sh/m, 5], [/^\s*(sudo|apt|chmod|chown|ifconfig|ping)\b/m, 3],
      [/\$\{?\w+\}?/, 1], [/^\s*echo\s+/m, 2], [/\bfi$/m, 2]],
    ['json', [/^\s*[{[][\s\S]*"[\w-]+"\s*:/, 3], [/^\s*\{[\s\S]*\}\s*$/, 1]],
    ['php', [/<\?php/, 5], [/\$\w+\s*=/, 2], [/\becho\s+["'$]/, 2]]
  ];

  function errateSprache(code) {
    const text = String(code || '');
    if (!text.trim()) return 'text';

    let besteSprache = 'text';
    let bestePunkte = 0;

    for (const eintrag of MERKMALE) {
      const sprache = eintrag[0];
      let punkte = 0;
      for (let i = 1; i < eintrag.length; i++) {
        const [muster, wert] = eintrag[i];
        if (muster.test(text)) punkte += wert;
      }
      if (punkte > bestePunkte) { bestePunkte = punkte; besteSprache = sprache; }
    }

    /* Unter drei Punkten ist es geraten und nicht erkannt. Lieber „Text"
       als eine falsche Sprache – die färbte überall daneben. */
    return bestePunkte >= 3 ? besteSprache : 'text';
  }

  /* ══════════════════════════════════════════════════════════════════
     WIE GROSS DER KASTEN WIRD

     Gemessen wird mit einem unsichtbaren Zwilling in derselben Schrift –
     dasselbe Verfahren wie measureFormula in core/formula.js. Raten
     ginge auch (Zeichen mal Breite), aber bei fester Schrittweite ist
     Messen genauso billig und stimmt immer.

     Daran hängt, was der Nutzer als „das Schwarze geht weiter/zurück"
     sieht: nimmt der Code eine Zeile zu, wächst der Kasten um eine
     Zeilenhöhe.
     ══════════════════════════════════════════════════════════════════ */
  const CODE_ZEILE_PX = 19;      // Zeilenhöhe im Kasten
  const CODE_RAND_PX = 12;       // Luft ringsum
  const CODE_KOPF_PX = 24;       // die Leiste mit dem Sprachnamen
  const CODE_NRN_PX = 34;        // Spalte für die Zeilennummern
  const CODE_MIN_W = 180;
  const CODE_MAX_W = 900;

  let messProbe = null;

  function messeCode(code, sprache) {
    const zeilen = String(code || '').replace(/\n$/, '').split('\n');

    if (!messProbe) {
      messProbe = document.createElement('div');
      messProbe.setAttribute('aria-hidden', 'true');
      messProbe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;'
        + 'white-space:pre;font-family:"DM Mono",Consolas,"Courier New",monospace;'
        + 'font-size:13px;line-height:' + CODE_ZEILE_PX + 'px';
      document.body.appendChild(messProbe);
    }

    // Die längste Zeile bestimmt die Breite
    messProbe.textContent = zeilen.reduce((a, b) => (b.length > a.length ? b : a), '');
    const textBreite = Math.ceil(messProbe.getBoundingClientRect().width);

    const w = Math.max(CODE_MIN_W, Math.min(CODE_MAX_W,
      textBreite + CODE_NRN_PX + CODE_RAND_PX * 2 + 8));
    const h = CODE_KOPF_PX + zeilen.length * CODE_ZEILE_PX + CODE_RAND_PX * 2;

    return { w, h, zeilen: zeilen.length };
  }

  /* ══════════════════════════════════════════════════════════════════
     DER KASTEN, WIE MAN IHN SIEHT

     Zeilennummern links, gefärbter Code rechts, darüber eine schmale
     Leiste mit dem Sprachnamen – so, wie man es aus einer
     Entwicklungsumgebung kennt.

     Das steckt im KÖRPER eines Objekts (canvas/objects.js) und nicht im
     Seitentext. Damit ist es weder für den Sanitizer noch für Yjs ein
     Thema: was reist, ist obj.code, eine schlichte Zeichenkette.
     ══════════════════════════════════════════════════════════════════ */
  function renderCodeBody(obj) {
    const code = String(obj.code || '');
    const sprache = SPRACHEN[obj.lang] ? obj.lang : 'text';
    const zeilen = code.replace(/\n$/, '').split('\n');

    const nrn = zeilen.map((_, i) => i + 1).join('\n');
    const gefaerbt = faerbe(code.replace(/\n$/, ''), sprache);

    /* ── Der Kasten wird NICHT skaliert ────────────────────────────────
       Eine Formel wird beim Ziehen als Ganzes vergrössert – dort ist das
       richtig, sie ist ein Bild aus Zeichen. Bei Code wäre es falsch:
       wer den Kasten aufzieht, will MEHR CODE SEHEN und keine grössere
       Schrift. Der Kasten ist deshalb ein Fenster auf den Code, und was
       nicht hineinpasst, wird darin geschoben – in beide Richtungen,
       genau wie in einer Entwicklungsumgebung.

       Er füllt den Rahmen des Objekts vollständig aus; die Grösse steht
       am .obj-wrap (canvas/objects.js). */
    return '<div class="j-code-obj' + (obj.hell ? ' hell' : '') + '">'
      + '<div class="j-code-obj-kopf">' + esc(SPRACHEN[sprache].name) + '</div>'
      + '<div class="j-code-obj-flaeche">'
      + '<div class="j-code-obj-nrn">' + esc(nrn) + '</div>'
      + '<pre class="j-code-obj-text">' + gefaerbt + '</pre>'
      + '</div></div>';
  }

  /* ══════════════════════════════════════════════════════════════════
     EINEN CODE-KASTEN AUF DIE SEITE SETZEN
     ══════════════════════════════════════════════════════════════════ */
  function insertCodeObject(code, sprache, hell) {
    const info = (typeof getPage === 'function' && S.activePgId) ? getPage(S.activePgId) : null;
    if (!info) return false;
    if (S.readOnly) { if (typeof toast === 'function') toast(t('sharedNoRight'), true); return false; }

    const pgEl = document.querySelector('[data-pgid="' + info.page.id + '"]');
    if (!pgEl) return false;

    if (typeof pushPageHistory === 'function') pushPageHistory(info.page);

    const mass = messeCode(code, sprache);
    const pw = info.page.w || CFG.PAGE_W;
    const ph = info.page.h || CFG.PAGE_H;

    /* ── Massvoll einsetzen, nicht so gross wie der Code ist ───────────
       Gemessen wird die volle Grösse (siehe messeCode) – eingesetzt wird
       eine handliche. Ein Programm mit achtzig Zeilen ergäbe sonst einen
       Kasten, der das ganze Blatt einnimmt und alles andere verdeckt;
       eine einzige lange Zeile machte ihn breiter als die Seite, und an
       seine Griffe käme man gar nicht mehr heran.

       Was nicht hineinpasst, wird IM Kasten geschoben: die Fläche rollt
       in beide Richtungen (css/pages.css). Wer ihn grösser haben will,
       zieht ihn an den Ecken auf – das ist eine Handbewegung und besser,
       als ihn jedes Mal wieder kleiner ziehen zu müssen. */
    const HANDLICH_W = 460;
    const HANDLICH_H = 300;

    mass.w = Math.min(mass.w, HANDLICH_W, Math.max(160, pw - 48));
    mass.h = Math.min(mass.h, HANDLICH_H, Math.max(80, ph - 120));

    /* Dorthin, wo man gerade ist – aber immer ganz auf dem Blatt.
       Dieselbe Rechnung wie beim Bild aus der Zwischenablage. */
    let y = (typeof markeAufSeite === 'function' && markeAufSeite(info.page)) || 96;
    y = Math.min(Math.max(y, 72), Math.max(72, ph - mass.h - 24));
    const x = Math.max(24, Math.min(72, Math.max(24, pw - mass.w - 24)));

    const obj = {
      id: uid(),
      kind: 'code',
      code: String(code || ''),
      lang: SPRACHEN[sprache] ? sprache : 'text',
      hell: !!hell,
      x, y,
      w: mass.w, h: mass.h,
      natW: mass.w, natH: mass.h,
      rot: 0,
      layer: 'front'
    };

    (info.page.objects || (info.page.objects = [])).push(obj);

    const objLayer = pgEl.querySelector('.j-objects');
    if (objLayer && typeof placeObject === 'function') placeObject(objLayer, obj, info.page);

    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
    return obj;
  }

  /**
   * Einen bestehenden Kasten neu setzen, nachdem sein Code geändert wurde.
   *
   * Die natürliche Größe wird neu gemessen; hat jemand den Kasten gezogen,
   * bleibt sein Massstab erhalten. Genau das ist „das Schwarze geht
   * weiter oder zurück": mehr Zeilen, höherer Kasten.
   */
  function updateCodeObject(obj, code, sprache, hell) {
    if (!obj) return;

    /* Hat jemand den Kasten selbst gezogen? Dann bleibt seine Grösse,
       wie er sie eingestellt hat – nur der Inhalt wechselt. Sonst folgt
       der Kasten dem Code: das ist das „das Schwarze geht weiter oder
       zurück", wenn Zeilen dazukommen oder wegfallen.

       Von Hand gezogen heisst: die Grösse weicht von der ab, die zuletzt
       gerechnet wurde. Ein paar Pixel Spiel, damit Rundungen beim
       Zeichnen nicht als Absicht gelten. */
    const vonHand = obj.natW && obj.natH
      && (Math.abs((obj.w || 0) - obj.natW) > 2 || Math.abs((obj.h || 0) - obj.natH) > 2);

    obj.code = String(code || '');
    if (sprache !== undefined) obj.lang = SPRACHEN[sprache] ? sprache : 'text';
    if (hell !== undefined) obj.hell = !!hell;

    const mass = messeCode(obj.code, obj.lang);
    /* Dieselbe Obergrenze wie beim Einsetzen: ein Programm mit achtzig
       Zeilen soll den Kasten nicht über die ganze Seite wachsen lassen.
       Darüber hinaus wird im Kasten geschoben. */
    mass.w = Math.min(mass.w, 460);
    mass.h = Math.min(mass.h, 300);

    obj.natW = mass.w;
    obj.natH = mass.h;
    if (!vonHand) { obj.w = mass.w; obj.h = mass.h; }
  }

  /* ══════════════════════════════════════════════════════════════════
     IM KASTEN SELBST SCHREIBEN

     Ein Doppelklick macht den Code beschreibbar – an Ort und Stelle,
     ohne dass ein Fenster aufgeht. Das Fenster bleibt für das ERSTE
     Einsetzen: dort wird eine ganze Datei hereingebracht, und dafür ist
     ein grosses Feld das Richtige. Zum Ändern einer Zeile wäre es im
     Weg.

     >>> Warum das <pre> und nicht der ganze Kasten <<<
     Die Zeilennummern dürfen nicht mitbeschrieben werden. Sie sind
     Anzeige und werden bei jedem Anschlag neu gerechnet.

     >>> Warum die Farben beim Schreiben stehen bleiben <<<
     Neu einzufärben heisst, den Inhalt des <pre> auszutauschen – und
     damit die Schreibmarke zu verlieren. Sie liesse sich zurückrechnen,
     aber bei jedem Anschlag den ganzen Baum neu zu bauen ist beim Tippen
     das Letzte, was man will. Gefärbt wird deshalb, wenn die Finger
     stillstehen (300 ms) und beim Verlassen.
     ══════════════════════════════════════════════════════════════════ */
  const FAERBE_PAUSE_MS = 300;

  /** Wo steht die Marke, gezählt in Zeichen vom Anfang des Elements? */
  function markeStelle(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return null;
    const vor = r.cloneRange();
    vor.selectNodeContents(el);
    vor.setEnd(r.startContainer, r.startOffset);
    return vor.toString().length;
  }

  /** ...und wieder hin. */
  function setzeMarke(el, stelle) {
    if (stelle === null || stelle === undefined) return;
    const lauf = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let gezaehlt = 0;
    for (let n = lauf.nextNode(); n; n = lauf.nextNode()) {
      const laenge = n.nodeValue.length;
      if (gezaehlt + laenge >= stelle) {
        const r = document.createRange();
        r.setStart(n, Math.max(0, stelle - gezaehlt));
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
      gezaehlt += laenge;
    }
    // Hinter alles, wenn die Stelle über das Ende hinausgeht
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /**
   * Macht den Code eines Kastens beschreibbar.
   *
   * @param {HTMLElement} wrap   die Hülle des Objekts (.obj-wrap)
   * @param {object} obj
   * @param {object} page
   * @param {Function} [nachGroesse]  aufgerufen, wenn der Kasten wächst
   */
  function bearbeiteImKasten(wrap, obj, page, nachGroesse) {
    if (!wrap || !obj || S.readOnly) return;

    const pre = wrap.querySelector('.j-code-obj-text');
    const nrn = wrap.querySelector('.j-code-obj-nrn');
    if (!pre) return;
    if (pre.getAttribute('contenteditable') === 'true') return;   // schon offen

    /* Solange geschrieben wird, gehört der Kasten mir – sonst schiebt
       ihn ein anderer unter der Marke weg (canvas/objects.js). */
    const pgEl = wrap.closest('[data-pgid]');
    if (pgEl && window.Collab && typeof Collab.beansprucheObjekt === 'function') {
      Collab.beansprucheObjekt(pgEl.dataset.pgid, wrap.dataset.objid);
    }

    if (typeof pushPageHistory === 'function') pushPageHistory(page);

    /* ── Der Inhalt bleibt, wie er ist ─────────────────────────────────
       Hier stand `pre.textContent = obj.code` – der Inhalt wurde also
       gegen den nackten Code getauscht. Das hatte zwei Folgen, und beide
       waren gemeldet:

         · Die Schreibmarke sprang an den Anfang der Zeile. Sie stand
           beim Doppelklick genau dort, wo man hingezeigt hatte – und
           wurde mit dem Inhalt weggeworfen.
         · Alles wurde weiss. Die Farben sind Spans im Inhalt; mit ihm
           waren sie weg und kamen erst beim nächsten Einfärben zurück.

       Beides ist unnötig. In einem contenteditable lässt sich zwischen
       gefärbten Spans genauso schreiben; was man tippt, nimmt kurz die
       Farbe der Umgebung an, und das nächste Einfärben rückt es gerade.
       Ein weisser Block, in dem die Marke am Anfang steht, ist deutlich
       schlechter als eine Farbe, die eine Drittelsekunde nachhinkt. */
    wrap.classList.add('code-schreibt');
    pre.setAttribute('contenteditable', 'true');
    pre.setAttribute('spellcheck', 'false');
    pre.classList.add('schreibt');
    /* Ohne preventScroll springt die Seite zum Kasten, auch wenn er
       längst zu sehen ist. */
    try { pre.focus({ preventScroll: true }); } catch (err) { pre.focus(); }

    let uhr = null;

    const nummernNachziehen = () => {
      if (!nrn) return;
      const zahl = (pre.textContent || '').replace(/\n$/, '').split('\n').length;
      nrn.textContent = Array.from({ length: zahl }, (_, i) => i + 1).join('\n');
    };

    const uebernehmen = () => {
      obj.code = pre.textContent || '';
      updateCodeObject(obj, obj.code);
      wrap.style.width = obj.w + 'px';
      wrap.style.height = obj.h + 'px';
      if (typeof nachGroesse === 'function') nachGroesse();
      if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    };

    const neuFaerben = () => {
      if (pre.getAttribute('contenteditable') !== 'true') return;
      const stelle = markeStelle(pre);
      pre.innerHTML = faerbe((obj.code || '').replace(/\n$/, ''), obj.lang || 'text');
      setzeMarke(pre, stelle);
    };

    const beiEingabe = () => {
      nummernNachziehen();
      uebernehmen();
      /* Erst wenn die Finger stillstehen. Bei jedem Anschlag den Inhalt
         auszutauschen hiesse, bei jedem Anschlag die Marke neu zu
         setzen – das ruckelt und verliert bei schnellem Tippen Zeichen. */
      clearTimeout(uhr);
      uhr = setTimeout(neuFaerben, FAERBE_PAUSE_MS);
    };

    const schliessen = () => {
      if (pre.getAttribute('contenteditable') !== 'true') return;
      clearTimeout(uhr);
      pre.removeAttribute('contenteditable');
      pre.classList.remove('schreibt');
      wrap.classList.remove('code-schreibt');
      pre.removeEventListener('input', beiEingabe);
      pre.removeEventListener('keydown', beiTaste);
      document.removeEventListener('pointerdown', beiKlick, true);
      uebernehmen();
      pre.innerHTML = faerbe((obj.code || '').replace(/\n$/, ''), obj.lang || 'text');
      if (pgEl && window.Collab && typeof Collab.gibObjektFrei === 'function') {
        Collab.gibObjektFrei(pgEl.dataset.pgid, wrap.dataset.objid);
      }
    };

    /* ── Beendet wird beim Klick NACH DRAUSSEN, nicht bei blur ─────────
       An 'blur' zu hängen war falsch: schon ein Klick auf die
       Zeilennummern oder in die Luft neben dem Text nahm dem <pre> den
       Fokus, das Schreiben endete, und der nächste Klick wurde von der
       Verschiebe-Logik verschluckt. Man musste erneut doppelklicken –
       und landete wieder am Zeilenanfang. Genau so gemeldet.

       Innerhalb des Kastens darf man klicken, wohin man will. */
    const beiKlick = (ev) => {
      if (wrap.contains(ev.target)) return;
      schliessen();
    };

    const beiTaste = (e) => {
      // Esc beendet das Schreiben, Enter gehört in den Code
      if (e.key === 'Escape') { e.preventDefault(); schliessen(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '    ');
      }
    };

    pre.addEventListener('input', beiEingabe);
    pre.addEventListener('keydown', beiTaste);
    document.addEventListener('pointerdown', beiKlick, true);
  }
  window.InkwellsCode = {
    faerbe, errateSprache, messeCode, renderCodeBody,
    insertCodeObject, updateCodeObject, bearbeiteImKasten,
    SPRACHEN, SPRACH_LISTE
  };

  /* canvas/objects.js ruft renderCodeBody wie renderFormulaBody – also
     ohne Vorsilbe. Die Formel steht dort als gewöhnliche Funktion auf
     oberster Ebene und ist damit von selbst global; hier liegt alles in
     einer Hülle, deshalb ausdrücklich. */
  window.renderCodeBody = renderCodeBody;
})();

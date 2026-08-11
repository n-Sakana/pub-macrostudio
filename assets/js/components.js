(function (global) {
  "use strict";

  // The vocabulary of controls this app has.
  //
  // Information and actions come in kinds, and the same kind looks the
  // same wherever it appears. That is the whole rule. What it replaces is
  // a screen deciding for itself that its one paragraph deserved an
  // accent rail, or that its optional field would read better folded away
  // behind a grey row - decisions that were reasonable one at a time and
  // left eleven different ways of saying the same thing.
  //
  // KINDS is the list. Every entry names the class the kind is drawn
  // with, and every factory below stamps data-component onto what it
  // builds, so the claim "this screen only uses standard components" can
  // be checked by machine (tests\test-design-tokens.js) and by anyone
  // with the inspector open.
  //
  // The first five kinds already had one implementation each and keep it;
  // this file names them so the set is complete and so nothing new is
  // built beside them.
  var KINDS = {
    // 主たる実行
    primaryAction: "button button--primary",
    // 戻る／補助操作
    secondaryAction: "button",
    // 単一選択
    singleChoice: "choice-card",
    // 複数選択
    multiChoice: "option-row",
    // 動的リストからの選択
    listChoice: "picker-row",
    // 2状態の設定切替
    toggleSwitch: "toggle",
    // 編集可能な入力
    input: "field",
    // 任意入力
    optionalInput: "field field--optional",
    // 補足説明
    note: "note",
    // 状態表示
    status: "status-chip",
    // 警告／エラー
    alert: "alert"
  };

  var TONES = ["neutral", "active", "done", "warn"];

  function element(tagName, className, text) {
    var node = global.document.createElement(tagName);

    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function icon(name, className) {
    return global.MacroStudioIcons.create(name, className);
  }

  function mark(node, kind) {
    node.setAttribute("data-component", kind);
    return node;
  }

  // ---- 補足説明 ----
  //
  // Standing context for what is next to it. Never a box, never a rail,
  // never a colour: it is quieter than the body text and that is all the
  // emphasis it gets, because it is not news.
  function note(text, lead) {
    return mark(
      element("p", KINDS.note + (lead ? " note--lead" : ""), text),
      "note");
  }

  // ---- 状態表示 ----
  function status(text, tone) {
    var chip = element("span", KINDS.status, text);

    chip.setAttribute(
      "data-tone",
      TONES.indexOf(tone) >= 0 ? tone : "neutral");
    return mark(chip, "status");
  }

  // ---- 警告／エラー ----
  //
  // `facts` is the checker's own account of the refusal: what the
  // contract wanted, what arrived instead, and the one edit that settles
  // it. When the check that failed does not produce one, the box is the
  // title and the message, as before.
  function alert(options) {
    var settings = options || {};
    var tone = settings.tone === "warn" ? "warn" : "error";
    var box = element("div", KINDS.alert + " alert--" + tone);
    var title = element("h3", "alert-title");
    var facts;
    var steps;

    box.setAttribute("role", "alert");
    title.appendChild(icon("alert", "flow-icon--small"));
    title.appendChild(element("span", "", settings.title || ""));
    box.appendChild(title);
    if (settings.body) {
      box.appendChild(element("p", "alert-body", settings.body));
    }
    if (settings.facts && settings.facts.length > 0) {
      facts = element("dl", "alert-facts");
      settings.facts.forEach(function (fact) {
        facts.appendChild(element("dt", "alert-fact-name", fact.name));
        facts.appendChild(element("dd", "alert-fact-value", fact.value));
      });
      box.appendChild(facts);
    }
    if (settings.steps && settings.steps.length > 0) {
      steps = element("ul", "alert-steps");
      settings.steps.forEach(function (line) {
        steps.appendChild(element("li", "", line));
      });
      box.appendChild(steps);
    }
    if (settings.footer) {
      box.appendChild(element("p", "alert-check", settings.footer));
    }
    return mark(box, "alert");
  }

  // ---- 編集可能な入力 / 任意入力 ----
  //
  // One factory for both, because they differ in one thing: whether the
  // reader has to fill it in. An optional field is a field. It keeps the
  // border, the background and the text colour of a field that must be
  // filled in, and says 任意 in words on its own heading.
  //
  // Greying it out would say something else, and something untrue: that
  // it cannot be used. `disabled` is reserved for exactly that, and here
  // it only ever means "the app is busy".
  function field(options) {
    var settings = options || {};
    var optional = settings.optional === true;
    var box = element(
      "div",
      optional ? KINDS.optionalInput : KINDS.input);
    var head = element("div", "field-head");
    var label = element("label", "field-label", settings.label || "");
    var input = element("textarea", "field-input");

    input.id = settings.id || "";
    input.rows = settings.rows || 3;
    input.value = settings.value || "";
    input.disabled = settings.disabled === true;
    if (settings.placeholder) {
      input.placeholder = settings.placeholder;
    }
    if (settings.name) {
      input.setAttribute("data-workflow-input", settings.name);
    }
    label.setAttribute("for", input.id);
    head.appendChild(label);
    if (optional) {
      head.appendChild(element("span", "field-optional-tag", "任意"));
    }
    box.appendChild(head);
    if (settings.note) {
      box.appendChild(note(settings.note, true));
    }
    box.appendChild(input);
    return mark(box, optional ? "optionalInput" : "input");
  }

  // ---- 2状態の設定切替 ----
  //
  // The ordinary track-and-thumb switch every other app has taught. One
  // label names the thing being permitted; the state is carried three
  // ways at once - the thumb's position, aria-checked, and a word next to
  // the label - so no single signal has to be seen for the reader to know
  // where they are. It is a real button: Space and Enter flip it, and the
  // focus ring is the shared one.
  //
  // What ON means is never left to guesswork: the label is the thing
  // switched on, and the caller writes the state words (許可する／
  // 許可しないなど) in the vocabulary of that setting.
  function toggleSwitch(options) {
    var settings = options || {};
    var checked = settings.checked === true;
    var box = element("div", KINDS.toggleSwitch);
    var control = element("button", "toggle-control");
    var track = element("span", "toggle-track");
    var words = element("span", "toggle-words");
    var stateWord = checked
      ? String(settings.onWord || "オン")
      : String(settings.offWord || "オフ");

    control.type = "button";
    control.setAttribute("role", "switch");
    control.setAttribute("aria-checked", checked ? "true" : "false");
    control.setAttribute(
      "aria-label",
      String(settings.label || "") + "（いまは" + stateWord + "）");
    control.disabled = settings.disabled === true;
    if (settings.action) {
      control.setAttribute("data-action", settings.action);
    }
    Object.keys(settings.data || {}).forEach(function (key) {
      control.setAttribute("data-" + key, settings.data[key]);
    });
    track.setAttribute("aria-hidden", "true");
    track.appendChild(element("span", "toggle-thumb"));
    control.appendChild(track);
    words.appendChild(element("span", "toggle-label", settings.label || ""));
    words.appendChild(element("span", "toggle-state", stateWord));
    control.appendChild(words);
    box.appendChild(control);
    if (settings.description) {
      box.appendChild(note(settings.description, true));
    }
    return mark(box, "toggleSwitch");
  }

  // ---- 総合判定 ----
  //
  // One answer for the whole workbook, in words the reader came to get:
  // does this need repairing or not. The internal grade still travels
  // with the component - as the tone and as data-grade - but it is not
  // the display. A bare letter was the display once, and "判定は B" told
  // nobody anything until they found the legend.
  function verdict(options) {
    var settings = options || {};
    var letter = String(settings.grade || "");
    var box = element(
      "div",
      "verdict verdict--" + letter.toLowerCase());
    var body = element("div", "verdict-body");

    box.setAttribute("aria-live", "polite");
    box.setAttribute("data-grade", letter);
    box.appendChild(element(
      "p",
      "verdict-label",
      settings.label || "総合判定"));
    box.appendChild(element("p", "verdict-answer", settings.answer || ""));
    if (settings.headline) {
      body.appendChild(element(
        "p",
        "verdict-headline",
        settings.headline));
    }
    if (settings.reason) {
      body.appendChild(element("p", "verdict-reason", settings.reason));
    }
    if (settings.next) {
      body.appendChild(element("p", "verdict-next", settings.next));
    }
    box.appendChild(body);
    return mark(box, "verdict");
  }

  global.MacroStudioComponents = {
    kinds: KINDS,
    tones: TONES,
    note: note,
    status: status,
    alert: alert,
    field: field,
    toggleSwitch: toggleSwitch,
    verdict: verdict
  };
}(window));

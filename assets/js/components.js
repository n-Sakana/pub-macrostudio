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
    // モード切替
    modeSwitch: "mode-switch",
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

  // ---- モード切替 ----
  //
  // Two states of one setting, side by side, both named and both saying
  // what they permit. The one in force carries a tick, the word いま有効
  // and the accent colour - three signals, so no single one of them has
  // to be seen for the reader to know where they are.
  //
  // What this is not: a switch with one label and an on/off position.
  // Nobody can tell which side of that is on, and nobody can tell what on
  // would mean.
  function modeSwitch(options) {
    var settings = options || {};
    var box = element("div", KINDS.modeSwitch);
    var group = element("div", "mode-switch-options");

    group.setAttribute("role", "radiogroup");
    if (settings.label) {
      group.setAttribute("aria-label", settings.label);
    }
    (settings.options || []).forEach(function (entry) {
      var chosen = entry.selected === true;
      var button = element("button", "mode-switch-option");
      var name = element("span", "mode-switch-name");

      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", chosen ? "true" : "false");
      button.disabled = settings.disabled === true;
      if (settings.action) {
        button.setAttribute("data-action", settings.action);
      }
      Object.keys(entry.data || {}).forEach(function (key) {
        button.setAttribute("data-" + key, entry.data[key]);
      });
      if (chosen) {
        name.appendChild(icon("check", "flow-icon--small"));
      }
      name.appendChild(element("span", "", entry.name));
      button.appendChild(name);
      button.appendChild(element(
        "span",
        "mode-switch-state",
        chosen ? "いま有効" : "切り替える"));
      if (entry.effect) {
        button.appendChild(element(
          "span",
          "mode-switch-effect",
          entry.effect));
      }
      group.appendChild(button);
    });
    box.appendChild(group);
    return mark(box, "modeSwitch");
  }

  // ---- 総合判定 ----
  //
  // One letter, one headline, one reason. A whole workbook gets one of
  // these, which is why it is a single component and not a row of them.
  function verdict(options) {
    var settings = options || {};
    var letter = String(settings.grade || "");
    var box = element(
      "div",
      "verdict verdict--" + letter.toLowerCase());
    var body = element("div", "verdict-body");

    box.setAttribute("aria-live", "polite");
    box.appendChild(element("div", "verdict-letter", letter));
    body.appendChild(element("p", "verdict-headline", settings.headline || ""));
    if (settings.reason) {
      body.appendChild(element("p", "verdict-reason", settings.reason));
    }
    if (settings.scale) {
      body.appendChild(element("p", "verdict-scale", settings.scale));
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
    modeSwitch: modeSwitch,
    verdict: verdict
  };
}(window));

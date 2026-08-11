"use strict";

// The in-app maximize on the review screen.
//
// The code area can take the whole client area and come back. The
// control is the one icon-only button in the flow - maximize and
// restore are settled conventions - so it has to carry its name in
// words (aria-label and tooltip) and its state in aria-pressed. The
// mechanism is a class on <body> and nothing else: toggling it must not
// re-render, because a re-render would cost the scroll position, the
// selection and a half-typed manual edit. The full behaviour - the
// frame hiding, Esc, and leaving the screen restoring - is checked in
// the real window by the flow smoke; this file fixes the contract the
// smoke relies on.

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var contracts = require("./helpers/contracts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

var root = path.resolve(__dirname, "..");

function createElementShim(tagName) {
  var element = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    id: "",
    rows: 0,
    checked: false,
    disabled: false,
    hidden: false,
    title: "",
    type: "",
    children: [],
    attributes: {}
  };

  function names() {
    return element.className.split(/\s+/).filter(function (name) {
      return name.length > 0;
    });
  }

  element.appendChild = function (child) {
    element.children.push(child);
    if (child) {
      child.parentNode = element;
    }
    return child;
  };
  element.removeChild = function (child) {
    var index = element.children.indexOf(child);

    if (index >= 0) {
      element.children.splice(index, 1);
    }
    return child;
  };
  element.setAttribute = function (name, value) {
    element.attributes[name] = String(value);
  };
  element.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(element.attributes, name)
      ? element.attributes[name]
      : null;
  };
  element.classList = {
    add: function (name) {
      if (names().indexOf(name) < 0) {
        element.className = names().concat([name]).join(" ");
      }
    },
    remove: function (name) {
      element.className = names().filter(function (item) {
        return item !== name;
      }).join(" ");
    },
    contains: function (name) {
      return names().indexOf(name) >= 0;
    },
    toggle: function (name, on) {
      var wanted = on === undefined ? names().indexOf(name) < 0 : on;

      if (wanted) {
        element.classList.add(name);
      } else {
        element.classList.remove(name);
      }
      return wanted;
    }
  };
  return element;
}

function walk(element, visit) {
  visit(element);
  (element.children || []).forEach(function (child) {
    walk(child, visit);
  });
}

function collect(element, test) {
  var found = [];

  walk(element, function (node) {
    if (node.getAttribute && test(node)) {
      found.push(node);
    }
  });
  return found;
}

function textOf(element) {
  var text = "";

  walk(element, function (node) {
    text += node.textContent + "\n";
  });
  return text;
}

var bodyElement = createElementShim("body");
var windowObject = {};
var context = vm.createContext({
  window: windowObject,
  document: {
    createElement: createElementShim,
    createTextNode: function (text) {
      return {
        nodeType: 3,
        tagName: "#text",
        className: "",
        textContent: String(text === undefined || text === null
          ? ""
          : text),
        children: [],
        getAttribute: function () { return null; }
      };
    },
    body: bodyElement,
    addEventListener: function () {},
    getElementById: function () { return null; },
    querySelector: function () { return null; }
  },
  Promise: Promise,
  Uint8Array: Uint8Array,
  Math: Math,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
});

windowObject.window = windowObject;
windowObject.document = context.document;
windowObject.setTimeout = setTimeout;
windowObject.clearTimeout = clearTimeout;
windowObject.console = {error: function () {}};
windowObject.hostBridge = {
  request: function () { return Promise.resolve(null); },
  on: function () { return function () {}; }
};
["icons.js", "components.js",
  "handover.js", "diff.js",
  "diff-view.js",
  "vba-highlight.js",
  "preset-document.js",
  "response-package.js",
  "diagnosis-package.js",
  "screens.js",
  "state.js",
  "screens/workflow.js",
  "app.js"
].forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets", "js", name), "utf8"),
    context,
    {filename: name});
});

var host = windowObject;
var app = host.MacroStudioApp;
var state = host.MacroStudioState;
var response = host.MacroStudioResponse;

state.reset();
state.setBook(
  {
    name: "book.xlsm",
    path: "C:\\work\\book.xlsm",
    ext: ".xlsm",
    totalLines: 4
  },
  [{
    name: "Main",
    type: "standard",
    typeLabel: "標準モジュール",
    ext: "bas",
    lineCount: 2,
    code: "Option Explicit\r\nSub A(): End Sub\r\n",
    attributes: ""
  }]);
state.setTargetEnvironment({displayName: "test", revision: "1"}, "ENV");
state.commitDiagnosisRequest({
  requestId: response.createRequestId(),
  runFolder: "C:\\work\\MacroStudio\\book_20260801_010203",
  outputTimestamp: "20260801_010203"
});
state.commitDiagnosis(contracts.diagnosis(host.MacroStudioDiagnosis, {
  requestId: state.getState().diagnosisRequestId,
  modules: state.getState().modules
}), "diagnosis.md");
state.setRepairPreset({
  file: "02_改修\\sample.md",
  name: "ひな形",
  content: "preset",
  parsed: {
    engine: "AI", questions: [], behaviorCandidates: [], preserveItems: [],
    output: {body: "rules"}, splitOutput: null
  }
});
state.setFindingSelected("1", true);
state.commitRepairRequest({
  requestId: response.createRequestId(),
  outputTimestamp: "20260801_010203"
});

var repairId = state.getState().repairRequestId;
var reply = [
  response.summaryBeginLine(repairId),
  "直しました。",
  response.summaryEndLine(repairId),
  response.beginLine(repairId, "standard", "Main"),
  "Option Explicit\r\nSub A()\r\n    Beep\r\nEnd Sub\r\n",
  response.endLine(repairId, "standard", "Main"),
  response.completeLine(repairId, 1)
].join("\r\n");
var described = response.describe(
  response.parse(reply, repairId),
  state.getState().modules,
  state.getState().diagnosis);

assert(described.ok, "The fixture reply must be importable.");
state.importPackage(described);
state.selectModule("Main");

// ---- the button, on the diff toolbar ----

function maxButtonsOf(screen) {
  return collect(screen, function (node) {
    return node.getAttribute("data-action") === "toggle-code-max";
  });
}

var screen = app.createReviewScreen(state.getState());
var buttons = maxButtonsOf(screen);

assert(buttons.length === 1,
  "The diff toolbar carries exactly one maximize control: " +
    buttons.length);
var button = buttons[0];

assert(button.tagName === "BUTTON" &&
  button.getAttribute("aria-pressed") === "false",
"The control is a real button and says it is not pressed yet.");
assert(button.getAttribute("aria-label") === "コードを画面全体に広げる" &&
  button.title === "コードを画面全体に広げる",
"Icon-only means the name lives in words, on aria-label and tooltip.");
assert(collect(button, function (node) {
  return node.classList && node.classList.contains("button-label");
}).length === 0,
"No text label: the icon is the settled convention for this operation.");

// ---- toggling is a class, never a re-render ----

var notifies = 0;
var unsubscribe = state.subscribe(function () {
  notifies += 1;
});

assert(app.isCodeMaximized() === false,
  "The screen starts at its normal size.");
assert(app.toggleCodeMax() === true && app.isCodeMaximized() === true,
  "Toggling maximizes.");
assert(bodyElement.classList.contains("code-maximized"),
  "The whole mechanism is a class on body - the CSS hides the frame.");
assert(notifies === 0,
  "Maximizing must not go through the state, or the re-render would " +
    "cost the scroll position and the selection: " + notifies);
assert(app.toggleCodeMax() === true && app.isCodeMaximized() === false &&
  !bodyElement.classList.contains("code-maximized"),
"Toggling again restores.");
assert(notifies === 0, "Restoring does not re-render either.");
unsubscribe();

// ---- the rebuilt screen reflects the state it was built under ----

app.toggleCodeMax(true);
var maximized = app.createReviewScreen(state.getState());
var pressed = maxButtonsOf(maximized)[0];

assert(pressed.getAttribute("aria-pressed") === "true" &&
  pressed.getAttribute("aria-label") === "元の表示に戻す" &&
  pressed.title === "元の表示に戻す",
"A screen rebuilt while maximized draws the restore state and name.");
app.toggleCodeMax(false);

// ---- the manual-edit toolbar carries the same control ----

state.beginPasteEdit();
var editScreen = app.createReviewScreen(state.getState());

assert(maxButtonsOf(editScreen).length === 1,
  "The manual-edit view keeps the same maximize control, so a " +
    "half-typed edit can be widened without losing anything.");
state.cancelPasteEdit();

console.log("test-code-max: PASS");
console.log("one icon-only maximize control per toolbar with its name in " +
  "words, aria-pressed state, a body-class mechanism that never " +
  "re-renders, and the restore state surviving a rebuild");

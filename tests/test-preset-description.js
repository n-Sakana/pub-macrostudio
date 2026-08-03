"use strict";

// The line under a preset's name on the purpose screen.
//
// It used to be scavenged from "## 改修指示", which is written for the chat
// AI: the card ended up showing a request addressed to somebody else, and
// it was cut wherever the file happened to wrap its prose. The line now has
// a section of its own, "## 説明", and the card shows nothing else.

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

// A document just real enough to build the purpose screen into, so the
// rule is checked where it is used and not only where it is written.
function createElementShim(tagName) {
  var element = {
    tagName: String(tagName).toUpperCase(),
    className: "",
    textContent: "",
    innerHTML: "",
    children: [],
    attributes: {},
    disabled: false,
    type: ""
  };

  function names() {
    return element.className.split(/\s+/).filter(function (name) {
      return name.length > 0;
    });
  }

  element.appendChild = function (child) {
    element.children.push(child);
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
  element.querySelector = function () {
    return null;
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
      if (on) {
        element.classList.add(name);
      } else {
        element.classList.remove(name);
      }
    }
  };
  return element;
}

function collectByClass(element, className, found) {
  var hits = found || [];

  if (element.classList && element.classList.contains(className)) {
    hits.push(element);
  }
  element.children.forEach(function (child) {
    collectByClass(child, className, hits);
  });
  return hits;
}

var windowObject = {};
var context = vm.createContext({
  window: windowObject,
  document: {
    createElement: createElementShim,
    addEventListener: function () {
    },
    getElementById: function () {
      return null;
    },
    querySelector: function () {
      return null;
    }
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
windowObject.console = { error: function () {} };
windowObject.hostBridge = {
  request: function () {
    return Promise.resolve(null);
  },
  on: function () {
    return function () {
    };
  }
};

["icons.js",
  "handover.js", "diff.js",
  "diff-view.js",
  "vba-highlight.js",
  "preset-document.js",
  "prompt-template.js",
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
    { filename: name });
});

var app = windowObject.MacroStudioApp;
var presetApi = windowObject.MacroStudioPreset;
var stateApi = windowObject.MacroStudioState;
var workflow = windowObject.MacroStudioWorkflow;

function readUtf8(filePath) {
  var text = fs.readFileSync(filePath, "utf8");

  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  return text;
}

function build(description) {
  return "# 名前\n\n" +
    (description === null ? "" : "## 説明\n\n" + description + "\n\n") +
    "## 改修指示\n\n直してください。\n\n" +
    "## 出力指示\n\n本文で返してください。\n";
}

function parseRepair(content) {
  return presetApi.parse(content, "repair");
}

// ---- the section, on its own ----

assert(
  parseRepair(build("画面に出る 1 行です。")).description ===
    "画面に出る 1 行です。",
  "The description section must become the card line.");
assert(
  parseRepair(build(null)).valid &&
    parseRepair(build(null)).description === "",
  "A preset without the section stays valid and has no card line.");
assert(
  parseRepair(build("今の動きを変えないまま、コードを\n読みやすく直します。"))
    .description === "今の動きを変えないまま、コードを読みやすく直します。",
  "A wrapped description must be joined without a space.");
assert(
  parseRepair(build("Win32\nAPI を使いません。")).description ===
    "Win32 API を使いません。",
  "A wrap between two Latin words must become a space.");
assert(
  parseRepair(build("Win32 API\nを使いません。")).description ===
    "Win32 APIを使いません。",
  "A wrap next to Japanese must not become a space.");

var empty = parseRepair(build("   "));

assert(
  !empty.valid &&
    empty.message === presetApi.messages.emptySection.replace(
      "{title}",
      "説明"),
  "An empty description must be rejected: " + empty.message);

var twoParagraphs = parseRepair(build("一段落です。\n\n二段落です。"));

assert(
  !twoParagraphs.valid &&
    twoParagraphs.message === presetApi.messages.manyDescriptions,
  "Two paragraphs must be rejected: " + twoParagraphs.message);

// The request is written for the chat AI, so it may no longer reach the
// card by any route.
assert(
  typeof app.getPresetSummary === "undefined",
  "The card line must not be derived from the request any more.");

// ---- every shipped preset ----

var presetDir = path.join(root, "presets", "02_改修");
var presets = fs.readdirSync(presetDir).filter(function (name) {
  return path.extname(name).toLowerCase() === ".md";
}).map(function (name) {
  return {
    file: path.join("02_改修", name),
    content: readUtf8(path.join(presetDir, name))
  };
});
var entries = presetApi.describeAll(presets, "repair").filter(function (entry) {
  return entry.valid;
});

assert(
  entries.length === 6,
  "The shipped presets must be readable for this check.");

entries.forEach(function (entry) {
  var text = entry.description;
  var firstLine = entry.instruction
    ? entry.instruction.body
      .replace(/\r\n/g, "\n")
      .split("\n")[0]
      .trim()
    : null;

  assert(
    text.length > 0,
    "No 説明 in " + entry.file);
  assert(
    text.charAt(text.length - 1) === "。",
    "The card line of " + entry.file +
      " does not end on a full stop: " + text);
  ["、", "・", "，", ",", "「", "（"].forEach(function (mark) {
    assert(
      text.charAt(text.length - 1) !== mark,
      "The card line of " + entry.file + " ends on " + mark);
  });
  assert(
    text.indexOf("\n") < 0 && text.indexOf("\r") < 0,
    "The card line of " + entry.file + " carries a line break.");
  assert(
    text.indexOf("。") === text.length - 1,
    "The card line of " + entry.file + " is more than one sentence: " +
      text);
  // Whatever the request happens to say is the AI's business, so a card
  // line that repeats its opening is a sign of the old derivation.
  if (firstLine !== null) {
    assert(
      text !== firstLine,
      "The card line of " + entry.file + " is the request's first line.");
  }

  // The file name is not read by any code, which is how it drifted away
  // from the title in the first place. Keeping them equal is what makes
  // the next drift visible in the folder.
  assert(
    path.basename(entry.file).replace(/^[0-9]+_/, "").replace(/\.md$/i, "") ===
      entry.name,
    "The file name of " + entry.file + " does not match its title: " +
      entry.name);
});

// The refactoring card, whose wording the owner fixed by hand.
var refactor = null;

entries.forEach(function (entry) {
  if (entry.instruction &&
      entry.instruction.body.indexOf("読みやすく") >= 0) {
    refactor = entry;
  }
});
assert(refactor !== null, "No shipped preset states the refactor request.");
assert(
  refactor.instruction.body.indexOf("読みやすく・壊れにくく") < 0,
  "The middle dot between the two adjectives must stay removed.");

// ---- the screen actually shows it ----
//
// Checking the parser alone is not enough: the card builder has to read
// the field. The repair route is built here and its lines read back.
var screen;
var lines;
var declared;

function prepareFindings(presetList) {
  var diagnosisId = "11111111-1111-4111-8111-111111111111";
  stateApi.reset();
  stateApi.setAppInfo({
    version: "test",
    presets: {diagnose: [], repair: presetList}
  });
  stateApi.setBook({
    name: "book.xlsm", path: "book.xlsm", ext: ".xlsm", totalLines: 1
  }, [{
    name: "Main", type: "standard", typeLabel: "標準モジュール",
    ext: "bas", lineCount: 1, code: "Option Explicit", attributes: ""
  }]);
  stateApi.setTargetEnvironment({
    displayName: "test", revision: "1", constraints: []
  }, "ENV");
  stateApi.commitDiagnosisRequest({requestId: diagnosisId});
  stateApi.commitDiagnosis(contracts.diagnosis(
    windowObject.MacroStudioDiagnosis,
    {requestId: diagnosisId, modules: stateApi.getState().modules}),
  "diagnosis.md");
}

prepareFindings(presets);
// The templates live on their own page now; the diagnosis page before it
// carries no template at all.
screen = workflow.createNextStepScreen(stateApi.getState());
lines = collectByClass(screen, "choice-description").map(
  function (node) {
    return node.textContent;
  });
declared = entries.map(function (entry) {
  return entry.description;
});

assert(
  lines.length === declared.length,
  "The repair purpose screen showed " + lines.length +
    " lines for " + declared.length + " presets.");
lines.forEach(function (text, index) {
  assert(
    text === declared[index],
    "The repair purpose screen shows " + text +
      " instead of the declared " + declared[index]);
});

// A preset with no 説明 shows its name alone rather than borrowing a
// sentence from the request.
prepareFindings([{ file: "02_改修\\plain.md", content: build(null) }]);
assert(
  collectByClass(
    workflow.createNextStepScreen(stateApi.getState()),
    "choice-description").length === 0,
  "A preset without 説明 must show no line at all.");

// A context without Web Crypto still gets an id, reports the fallback
// exactly once, and does not let a failed best-effort log stop selection.
var bridgeCalls = [];
windowObject.hostBridge.request = function (action, params) {
  bridgeCalls.push({ action: action, params: params || {} });
  if (action === "readPreset") {
    return Promise.resolve({ content: presets[0].content });
  }
  if (action === "readRequestTemplate") {
    return Promise.resolve({
      content: readUtf8(path.join(root, "templates", "repair-template.txt"))
    });
  }
  if (action === "writeRequestFiles") {
    return Promise.resolve({
      requestPath: "C:\\work\\run\\repair-request.md",
      folderPath: "C:\\work\\run"
    });
  }
  if (action === "writeLog") {
    return Promise.reject(new Error("log unavailable"));
  }
  return Promise.resolve(null);
};
prepareFindings(presets);

workflow.selectRepairPreset(presets[0].file).then(function (result) {
  stateApi.setExtraRequest("fallback test");
  stateApi.goTo(windowObject.MacroStudioScreens.repairInputScreen, false);
  return workflow.prepareRepairRequest().then(function () { return result; });
}).then(function (result) {
  var warnings = bridgeCalls.filter(function (call) {
    return call.action === "writeLog" && call.params.level === "WARN";
  });

  assert(result !== null, "A failed fallback log must not stop selection.");
  assert(
    warnings.length === 1 &&
      warnings[0].params.message.indexOf("Math.random") >= 0,
    "The insecure request id fallback must write one WARN and only one.");
  assert(
    windowObject.MacroStudioResponse.isRequestId(
      stateApi.getState().repairRequestId),
    "The fallback request generation must still store a valid request id.");

  console.log("test-preset-description: PASS");
  console.log(
    "every shipped preset declares its own card line, the screen shows " +
    "that line and nothing else, file names match titles, and request id " +
    "fallback logging is best-effort");
}).catch(function (error) {
  global.setTimeout(function () {
    throw error;
  }, 0);
});

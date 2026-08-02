"use strict";

// A workbook whose whole file is encrypted cannot be read at all. It used
// to arrive as a successful read of zero modules, so the screen announced
// that every module had been read and then offered nothing to go on with.
// It now arrives as E-ATTACH-04 and has to be shown on the screen, not as
// a toast that fades, because nothing can proceed until a different file
// is chosen.

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

var root = path.resolve(__dirname, "..");

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

function collect(element, className, found) {
  var hits = found || [];

  if (element.classList && element.classList.contains(className)) {
    hits.push(element);
  }
  element.children.forEach(function (child) {
    collect(child, className, hits);
  });
  return hits;
}

function readText(element) {
  var text = element.textContent || "";

  element.children.forEach(function (child) {
    text += readText(child);
  });
  return text;
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
  "response-package.js",
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
var stateApi = windowObject.MacroStudioState;

// ---- the encrypted workbook is refused, on the screen ----

var ENCRYPTED = "E-ATTACH-04";

function buildBookScreen(error) {
  stateApi.reset();
  stateApi.setAppInfo({
    version: "test",
    presets: { diagnose: [], repair: [] }
  });
  if (error) {
    stateApi.setLastError(error);
  }
  return windowObject.MacroStudioWorkflow.createBookScreen(
    stateApi.getState());
}

var blocked = buildBookScreen({
  code: ENCRYPTED,
  message: app.getHostErrorMessage({ code: ENCRYPTED }),
  path: "C:\\books\\secret.xlsm"
});
var cards = collect(blocked, "inline-error-card");

assert(
  cards.length === 1,
  "An encrypted workbook must be reported on the screen itself.");

var cardText = readText(cards[0]);

assert(
  cardText.indexOf(ENCRYPTED) >= 0,
  "The card must carry the error code: " + cardText);
assert(
  cardText.indexOf("secret.xlsm") >= 0,
  "The card must name the file it refused: " + cardText);
assert(
  cardText.indexOf("パスワード") >= 0 &&
    cardText.indexOf("暗号化") >= 0,
  "The card must say the file is encrypted with a password: " + cardText);
// Removing the protection is the only way forward, so the card has to
// say so rather than leaving the reader stuck.
assert(
  cardText.indexOf("Excel") >= 0 && cardText.indexOf("コピー") >= 0,
  "The card must say to open it in Excel and save an unprotected copy: " +
    cardText);
assert(
  cardText.indexOf("読み取れています") < 0 &&
    cardText.indexOf("全モジュール") < 0,
  "A file that could not be read must never claim it was: " + cardText);

// A workbook with no macros keeps its own wording, and an ordinary
// failure is not turned into a screen card.
var noMacro = collect(
  buildBookScreen({
    code: "E-ATTACH-03",
    message: "",
    path: "C:\\books\\plain.xlsx"
  }),
  "inline-error-card");

assert(noMacro.length === 1, "E-ATTACH-03 must keep its screen card.");
assert(
  readText(noMacro[0]).indexOf("マクロがありません") >= 0,
  "E-ATTACH-03 must keep its own wording.");
// A file that never read as a workbook container is not recoverable inside
// this run either - the same file will not read on a retry - so it gets a
// card of its own rather than a toast that fades and leaves the screen
// looking untouched. The card must not describe it as a workbook that
// merely has no macros: that would assert it IS a workbook.
var unreadable = collect(
  buildBookScreen({
    code: "E-ATTACH-02",
    message: "",
    path: "C:\\books\\broken.xlsm"
  }),
  "inline-error-card");

assert(
  unreadable.length === 1,
  "An unreadable file must stay on the screen, not fade as a toast.");
assert(
  readText(unreadable[0]).indexOf("マクロ") < 0,
  "An unreadable file must not be called a workbook without macros: " +
    readText(unreadable[0]));
assert(
  readText(unreadable[0]).indexOf("読み取れませんでした") >= 0,
  "An unreadable file must say it could not be read: " +
    readText(unreadable[0]));
assert(
  collect(buildBookScreen(null), "inline-error-card").length === 0,
  "Without an error there is no card.");

// ---- a refusal does not throw away the workbook already in hand ----
//
// A refused file is never read, so whatever was loaded before is still the
// workbook this run is about, and [次へ] stays live for it. From the screen
// that looked wrong: a red card with a working [次へ] under it reads as
// "it failed, carry on anyway". The two obvious fixes are both worse -
// disabling [次へ] punishes the reader for a file they already abandoned,
// and dropping the loaded workbook throws away real work over a mistyped
// pick. So the card says which workbook is still loaded.
function buildBookScreenWithBook(error) {
  stateApi.reset();
  stateApi.setAppInfo({
    version: "test",
    presets: { diagnose: [], repair: [] }
  });
  stateApi.setBook({
    name: "受注管理.xlsm",
    path: "C:\\work\\受注管理.xlsm",
    ext: ".xlsm",
    totalLines: 4
  }, [{
    name: "Main",
    type: "standard",
    typeLabel: "標準モジュール",
    ext: "bas",
    lineCount: 2,
    code: "Option Explicit\r\nSub A()\r\nEnd Sub\r\n",
    attributes: ""
  }]);
  if (error) {
    stateApi.setLastError(error);
  }
  return windowObject.MacroStudioWorkflow.createBookScreen(
    stateApi.getState());
}

var keptScreen = buildBookScreenWithBook({
  code: "E-ATTACH-02",
  message: app.getHostErrorMessage({ code: "E-ATTACH-02" }),
  path: "C:\\books\\broken.xlsm"
});
var keptCard = collect(keptScreen, "inline-error-card")[0];

assert(keptCard, "The refusal is still reported on the screen.");
var keptText = readText(keptCard);
assert(
  keptText.indexOf("broken.xlsm") >= 0,
  "The card still names the file it refused: " + keptText);
assert(
  keptText.indexOf("受注管理.xlsm") >= 0,
  "The card must name the workbook that is still loaded, because that is " +
    "what [次へ] would carry on with: " + keptText);
assert(
  stateApi.getState().book !== null &&
    stateApi.getState().book.name === "受注管理.xlsm",
  "A refused file must not discard the workbook already read.");
assert(
  collect(
    buildBookScreen({
      code: "E-ATTACH-02",
      message: app.getHostErrorMessage({ code: "E-ATTACH-02" }),
      path: "C:\\books\\broken.xlsm"
    }),
    "inline-error-kept").length === 0,
  "With no workbook loaded there is nothing to keep, so nothing is said.");

// The message the host error resolves to is the one shown.
assert(
  app.getHostErrorMessage({ code: ENCRYPTED }).indexOf("暗号化") >= 0,
  "The encrypted workbook needs a message of its own.");

console.log("test-attach-blocked: PASS");
console.log(
  "an encrypted workbook is refused on the screen itself, with the way " +
  "out, and never claims to have read it; a refusal names the workbook " +
  "still loaded instead of disabling the way forward or dropping it");

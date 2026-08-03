/* Browser-side WebView2 host mock for the MacroStudio βv2.00 screenshot rig.
 *
 * Injected before any page script, because assets/js/host-bridge.js grabs
 * window.chrome.webview at load time.
 *
 * Implements the contract src/03_MessageRouter.cs speaks:
 *   page -> host : chrome.webview.postMessage({id, action, params})
 *   host -> page : {id, status:"ok", data} | {id, status:"error", ...}
 *                | {event:"<name>", data}
 *
 * The fourteen actions are exactly the ones 03_MessageRouter.cs dispatches.
 * Result shapes come from src/04_HostServices.cs, not from guesswork, so a
 * screen that reads a field the real host returns finds it here too.
 *
 * Deliberately not clever: an unknown action returns an error, exactly as
 * the real host would, so an unreachable screen fails visibly instead of
 * being faked. Nothing is stubbed past the host boundary - every screen is
 * reached by clicking the real controls.
 *
 * It also RECORDS what the app hands the host (diagnose-request.md,
 * source-code.md, source-code-for-ai.md, diagnosis.md, repair-request.md,
 * the diff HTML, result.md, run-manifest.json), so the rig can save the
 * product's own artifacts to disk, and it answers buildBook late so the
 * building screen can be photographed.
 */
(function () {
  "use strict";

  var F = window.__MS_FIXTURES__;
  var listeners = {};
  var clipboardText = "";
  var calls = [];
  var captured = {};
  var buildDelayMs = 0;
  var pickedLocation = null;
  var buildFails = false;

  function emit(payload) {
    (listeners.message || []).slice().forEach(function (h) {
      h({data: payload});
    });
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function ok(id, data) {
    emit({id: id, status: "ok", data: data === undefined ? null : data});
  }

  function fail(id, code, message, data) {
    emit({
      id: id,
      status: "error",
      code: code,
      message: message,
      data: data === undefined ? null : data
    });
  }

  // The run folder the real host would create, and the temp folder the one
  // file handed to the chat lives in (SPEC 8.1).
  function runFolder() {
    return F.runFolder;
  }

  function handoffFolder() {
    return F.handoffFolder;
  }

  function handle(message) {
    var id = message.id;
    var action = message.action;
    var params = message.params || {};
    var found;
    var stage;
    var requestName;

    calls.push(action);

    switch (action) {
    case "getAppInfo":
      ok(id, {version: F.version, presets: clone(F.presets)});
      return;

    case "getTargetEnvironment":
      ok(id, {content: F.targetEnvironment});
      return;

    case "pickBook":
      ok(id, {path: F.book.path});
      return;

    case "pickLocation":
      // The real dialog returns null when the reader cancels.
      ok(id, pickedLocation === null ? null : {path: pickedLocation});
      return;

    case "attachBook":
      // Fresh copy each time: the app writes status onto these objects.
      ok(id, {
        book: clone(F.book),
        modules: clone(F.modules),
        warning: F.warning === true,
        read: clone(F.read),
        inventory: clone(F.inventory)
      });
      return;

    case "readPreset":
      found = null;
      ["diagnose", "repair"].forEach(function (group) {
        (F.presets[group] || []).forEach(function (entry) {
          if (entry.file === params.file) {
            found = entry.content;
          }
        });
      });
      if (found === null) {
        fail(id, "E-PRESET-01", "Mock has no preset: " + params.file);
        return;
      }
      ok(id, {content: found});
      return;

    case "readRequestTemplate":
      found = F.requestTemplates[params.name];
      if (found === undefined) {
        fail(id, "E-GEN-02", "Mock has no template: " + params.name);
        return;
      }
      ok(id, {content: found});
      return;

    case "writeRequestFiles":
      stage = String(params.stage || "");
      requestName = stage === "diagnose"
        ? "diagnose-request.md"
        : "repair-request.md";
      captured[stage + "Request"] = params.request;
      if (params.code !== null && params.code !== undefined) {
        captured.sourceCode = params.code;
      }
      // aiCode is the replaced code on the fixed-path route; when it is
      // absent the host writes `code` to the same handoff file.
      captured.aiCode = params.aiCode === null ||
        params.aiCode === undefined
        ? captured.sourceCode
        : params.aiCode;
      captured.outputTimestamp = params.outputTimestamp;
      ok(id, {
        folderPath: runFolder(),
        requestPath: runFolder() + "\\" + requestName,
        handoffFolderPath: handoffFolder(),
        aiCodePath: handoffFolder() + "\\" + F.aiCodeName,
        aiCodeName: F.aiCodeName,
        codePath: runFolder() + "\\source-code.md"
      });
      return;

    case "writeDiagnosisFile":
      captured.diagnosisMarkdown = params.markdown;
      ok(id, {path: runFolder() + "\\diagnosis.md"});
      return;

    case "writeRunManifest":
      captured.runManifest = params.manifest;
      ok(id, {path: runFolder() + "\\run-manifest.json"});
      return;

    case "writeClipboard":
      clipboardText = String(params.text || "");
      captured.lastCopied = clipboardText;
      ok(id, {copied: true});
      return;

    case "readClipboard":
      ok(id, {text: clipboardText});
      return;

    case "buildBook":
      captured.build = {
        outputTimestamp: params.outputTimestamp,
        outputName: params.outputName,
        diffName: params.diffName,
        diffHtml: params.diffHtml,
        resultMarkdown: params.resultMarkdown,
        modules: (params.modules || []).map(function (m) {
          return {
            name: m.name,
            isNew: m.isNew === true,
            codeLength: (m.code || "").length
          };
        })
      };
      window.setTimeout(function () {
        if (buildFails) {
          fail(id, "E-BUILD-02",
            "The build could not be completed.", null);
          return;
        }
        ok(id, {
          outputPath: runFolder() + "\\" + params.outputName,
          diffPath: runFolder() + "\\" + params.diffName,
          resultPath: runFolder() + "\\result.md",
          results: (params.modules || []).map(function (m) {
            return {name: m.name, result: "written", message: ""};
          })
        });
      }, buildDelayMs);
      return;

    case "revealPath":
      captured.revealed = params.path;
      ok(id, null);
      return;

    case "writeLog":
      // Kept so a scene that fails says why. The real host writes these to
      // the run log; here they are the only place a swallowed error shows.
      if (!captured.logs) {
        captured.logs = [];
      }
      captured.logs.push(String(params.level || "") + ": " +
        String(params.message || ""));
      ok(id, null);
      return;

    default:
      fail(id, "E-SYS-02", "Mock host has no action: " + action);
      return;
    }
  }

  window.chrome = window.chrome || {};
  window.chrome.webview = {
    addEventListener: function (name, handler) {
      if (!listeners[name]) {
        listeners[name] = [];
      }
      listeners[name].push(handler);
    },
    removeEventListener: function (name, handler) {
      var hs = listeners[name];
      var i;
      if (!hs) {
        return;
      }
      i = hs.indexOf(handler);
      if (i >= 0) {
        hs.splice(i, 1);
      }
    },
    postMessage: function (message) {
      // The real host answers asynchronously; keep that shape so busy
      // states are exercised rather than skipped.
      window.setTimeout(function () {
        handle(message);
      }, 0);
    }
  };

  // Rig-only control surface. The app never reads this.
  window.__msMock = {
    setClipboard: function (t) {
      clipboardText = String(t);
    },
    getClipboard: function () {
      return clipboardText;
    },
    setBuildDelay: function (ms) {
      buildDelayMs = Number(ms) || 0;
    },
    setPickedLocation: function (p) {
      pickedLocation = p === null || p === undefined ? null : String(p);
    },
    setBuildFails: function (v) {
      buildFails = v === true;
    },
    captured: function () {
      return captured;
    },
    calls: function () {
      return calls.slice();
    }
  };
}());

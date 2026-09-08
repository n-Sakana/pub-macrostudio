(function (global) {
  "use strict";

  var nextId = 0;
  var pending = Object.create(null);
  var eventHandlers = Object.create(null);
  var timeoutMilliseconds = 120000;
  var webview = global.chrome && global.chrome.webview
    ? global.chrome.webview
    : null;

  function makeError(code, message, data, action) {
    var error = new Error(message || "Host request failed.");
    error.code = code || "E-SYS-02";
    error.data = data === undefined ? null : data;
    error.action = action || "";
    return error;
  }

  function clearTimers(entry) {
    if (entry.timer !== null) {
      global.clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.slowTimer !== null) {
      global.clearTimeout(entry.slowTimer);
      entry.slowTimer = null;
    }
  }

  function removePending(id) {
    var entry = pending[id];
    if (!entry) {
      return null;
    }

    delete pending[id];
    clearTimers(entry);
    return entry;
  }

  function handleMessage(event) {
    var message = event.data || {};
    if (message.id !== undefined && message.id !== null) {
      var entry = removePending(String(message.id));
      if (!entry) {
        return;
      }

      if (message.status === "error") {
        entry.reject(makeError(
          message.code,
          message.message,
          message.data,
          entry.action
        ));
      } else {
        entry.resolve(message.data);
      }
      return;
    }

    if (!message.event) {
      return;
    }

    var handlers = eventHandlers[message.event];
    if (!handlers) {
      return;
    }

    handlers.slice().forEach(function (handler) {
      try {
        handler(message.data);
      } catch (error) {
        global.console.error("Host event handler failed:", error);
      }
    });
  }

  if (webview) {
    webview.addEventListener("message", handleMessage);
  }

  // Most host actions answer quickly, so a fixed clock is a fair way to
  // give up on them. Some actions - rebuilding a large workbook is the
  // one - keep working long past that clock, and the host's answer is
  // the only thing that says whether they finished. Those are sent with
  // `timeoutMilliseconds: 0` and an `onSlow` callback: nothing is
  // decided by the clock, the wait is only reported, and the late answer
  // still resolves against the same request id.
  function send(action, params, additionalObjects, options) {
    var settings = options || {};

    return new Promise(function (resolve, reject) {
      if (!webview) {
        reject(makeError(
          "E-SYS-02",
          "The MacroStudio host is not available.",
          null,
          action
        ));
        return;
      }
      if (!action) {
        reject(makeError(
          "E-SYS-02",
          "The host action is empty.",
          null,
          ""
        ));
        return;
      }
      if (additionalObjects &&
          typeof webview.postMessageWithAdditionalObjects !== "function") {
        reject(makeError(
          "E-SYS-02",
          "This WebView2 runtime cannot pass dropped files.",
          null,
          action
        ));
        return;
      }

      nextId += 1;
      var id = nextId;
      var key = String(id);
      var limit = settings.timeoutMilliseconds === undefined
        ? timeoutMilliseconds
        : Number(settings.timeoutMilliseconds);
      var slowAfter = settings.slowAfterMilliseconds === undefined
        ? timeoutMilliseconds
        : Number(settings.slowAfterMilliseconds);
      var timer = limit > 0
        ? global.setTimeout(function () {
          var entry = removePending(key);
          if (entry) {
            entry.reject(makeError(
              "E-SYS-02",
              "Host request timed out: " + action,
              null,
              action
            ));
          }
        }, limit)
        : null;
      var slowTimer = typeof settings.onSlow === "function" &&
        slowAfter > 0
        ? global.setTimeout(function () {
          var entry = pending[key];
          if (!entry) {
            return;
          }
          entry.slowTimer = null;
          try {
            settings.onSlow(action);
          } catch (error) {
            global.console.error("Host slow handler failed:", error);
          }
        }, slowAfter)
        : null;

      pending[key] = {
        action: action,
        resolve: resolve,
        reject: reject,
        timer: timer,
        slowTimer: slowTimer
      };

      var message = {
        id: id,
        action: action,
        params: params || {}
      };

      try {
        if (additionalObjects) {
          webview.postMessageWithAdditionalObjects(
            message,
            additionalObjects);
        } else {
          webview.postMessage(message);
        }
      } catch (error) {
        removePending(key);
        reject(makeError(
          "E-SYS-02",
          error.message,
          null,
          action
        ));
      }
    });
  }

  function request(action, params, options) {
    return send(action, params, null, options);
  }

  function resolveDroppedFiles(files) {
    return send("resolveDroppedFiles", {}, files, null).then(
      function (result) {
        return result && result.paths ? result.paths : [];
      });
  }

  function canResolveDroppedFiles() {
    return Boolean(
      webview &&
      typeof webview.postMessageWithAdditionalObjects === "function");
  }

  function on(eventName, handler) {
    if (!eventHandlers[eventName]) {
      eventHandlers[eventName] = [];
    }
    eventHandlers[eventName].push(handler);

    return function () {
      off(eventName, handler);
    };
  }

  function off(eventName, handler) {
    var handlers = eventHandlers[eventName];
    if (!handlers) {
      return;
    }

    var index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
    if (handlers.length === 0) {
      delete eventHandlers[eventName];
    }
  }

  global.hostBridge = {
    request: request,
    resolveDroppedFiles: resolveDroppedFiles,
    canResolveDroppedFiles: canResolveDroppedFiles,
    on: on,
    off: off
  };
}(window));

(function (global) {
  "use strict";

  // One sprite for the whole flow, with the β1.10 shapes unchanged. It
  // lives here, and not in the app shell, because the screen renderers
  // need the same chevron and the same check mark as the shell does, and
  // a renderer must not have to load the shell to draw one.
  var PATHS = {
    file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3z"/><path d="M3 8V5h7l2 3"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="2"/>' +
      '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    template: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
    code: '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>',
    arrowLeft: '<path d="m15 18-6-6 6-6"/>',
    arrowRight: '<path d="m9 18 6-6-6-6"/>',
    arrowUp: '<path d="m6 15 6-6 6 6"/>',
    arrowDown: '<path d="m6 9 6 6 6-6"/>',
    restart: '<path d="M4 4v6h6"/><path d="M5.5 15a8 8 0 1 0 .8-7.7L4 10"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    // The workbook the reader is asked to drop.
    drop: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>' +
      '<path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/>' +
      '<path d="M12 8h.01"/>',
    // Something the reader has to act on. It sits next to the words, so
    // that a refusal is not carried by colour alone.
    alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v5"/>' +
      '<path d="M12 18h.01"/>'
  };

  function has(name) {
    return Object.prototype.hasOwnProperty.call(PATHS, name);
  }

  function markup(name) {
    return '<svg viewBox="0 0 24 24">' +
      (has(name) ? PATHS[name] : PATHS.file) +
      "</svg>";
  }

  function create(name, className) {
    var node = global.document.createElement("span");

    node.className = "flow-icon " + (className || "");
    node.setAttribute("aria-hidden", "true");
    node.innerHTML = markup(name);
    return node;
  }

  global.MacroStudioIcons = {
    create: create,
    markup: markup,
    has: has,
    names: function () {
      return Object.keys(PATHS);
    }
  };
}(window));

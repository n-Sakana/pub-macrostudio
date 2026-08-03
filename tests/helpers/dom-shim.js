"use strict";

function classNames(node) {
  return String(node.className || "").split(/\s+/).filter(Boolean);
}

function matches(node, selector) {
  var attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (selector.charAt(0) === ".") {
    return classNames(node).indexOf(selector.slice(1)) >= 0;
  }
  if (attribute) {
    var value = node.getAttribute(attribute[1]);
    return value !== null &&
      (attribute[2] === undefined || value === attribute[2]);
  }
  return node.tagName === selector.toUpperCase();
}

function descendants(node, selector, found) {
  var result = found || [];
  (node.children || []).forEach(function (child) {
    if (matches(child, selector)) {
      result.push(child);
    }
    descendants(child, selector, result);
  });
  return result;
}

// Enough of a text node for the walkers below: it reads as a childless
// element with no class and no attributes, so text() picks up its
// content and neither collect() nor querySelectorAll trips over it.
function createTextNode(text) {
  return {
    nodeType: 3,
    tagName: "#text",
    className: "",
    textContent: String(text === undefined || text === null ? "" : text),
    children: [],
    parentNode: null,
    getAttribute: function () { return null; },
    hasAttribute: function () { return false; }
  };
}

function createElement(tagName) {
  var node = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    className: "",
    textContent: "",
    value: "",
    checked: false,
    disabled: false,
    hidden: false,
    id: "",
    type: "",
    rows: 0,
    children: [],
    parentNode: null,
    attributes: {}
  };

  node.appendChild = function (child) {
    child.parentNode = node;
    node.children.push(child);
    return child;
  };
  node.removeChild = function (child) {
    var index = node.children.indexOf(child);
    if (index >= 0) {
      node.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  };
  node.setAttribute = function (name, value) {
    node.attributes[name] = String(value);
    if (name === "id") {
      node.id = String(value);
    }
  };
  node.getAttribute = function (name) {
    if (name === "id" && node.id) {
      return node.id;
    }
    return Object.prototype.hasOwnProperty.call(node.attributes, name)
      ? node.attributes[name]
      : null;
  };
  node.hasAttribute = function (name) {
    return node.getAttribute(name) !== null;
  };
  node.querySelectorAll = function (selector) {
    return descendants(node, selector);
  };
  node.querySelector = function (selector) {
    return descendants(node, selector)[0] || null;
  };
  node.focus = function () {};
  node.classList = {
    add: function (name) {
      if (classNames(node).indexOf(name) < 0) {
        node.className = classNames(node).concat([name]).join(" ");
      }
    },
    remove: function (name) {
      node.className = classNames(node).filter(function (item) {
        return item !== name;
      }).join(" ");
    },
    contains: function (name) {
      return classNames(node).indexOf(name) >= 0;
    },
    toggle: function (name, enabled) {
      if (enabled) {
        node.classList.add(name);
      } else {
        node.classList.remove(name);
      }
    }
  };
  return node;
}

function text(node) {
  var value = node.textContent || "";
  (node.children || []).forEach(function (child) {
    value += text(child);
  });
  return value;
}

function collect(node, predicate, found) {
  var result = found || [];
  if (predicate(node)) {
    result.push(node);
  }
  (node.children || []).forEach(function (child) {
    collect(child, predicate, result);
  });
  return result;
}

module.exports = {
  createElement: createElement,
  createTextNode: createTextNode,
  text: text,
  collect: collect,
  matches: matches
};

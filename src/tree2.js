/*global define, ace*/
define("tree2", function () {
  var $ = require('elements');
  var modes = require('modes');
  var editor = require('editor');
  var domBuilder = require('dombuilder');
  var modelist = ace.require('ace/ext/modelist');
  var whitespace = ace.require('ace/ext/whitespace');
  var contextMenu = require('context-menu');
  var prefs = require('prefs');
  var binary = require('binary');
  require('zoom');
  var roots = [];
  var selected = null;
  var active = null;
  var activePath;

  $.tree.addEventListener("click", onClick, false);
  $.tree.addEventListener("contextmenu", onContextMenu, false);

  return {
    addRoot: addRoot,
    removeRoot: removeRoot
  };

  function addRoot(repo, hash, name) {
    createCommitNode(repo, hash, name, null, function (err, node) {
      if (err) throw err;
      if (!node) throw new Error("Invalid commit hash: " + hash);
      roots[name] = node;
      updateNode(node);
      $.tree.appendChild(node.el);
    });
  }

  function removeRoot(root) {
    roots.splice(roots.indexOf(root), 1);
    $.tree.removeChild(root.el);
  }

  function createCommitNode(repo, hash, name, parent, callback) {
    var commit;
    repo.loadAs("commit", hash, onCommit);

    function onCommit(err, result) {
      if (!result) return callback(err);
      commit = result;
      commit.hash = hash;
      // Store the hash to the root tree
      repo.root = commit.tree;
      // Create a tree node now
      createNode(repo, "", name, parent, onTreeNode);
    }

    function onTreeNode(err, node) {
      if (!node) return callback(err);
      // Store the commit data on the tree
      node.commit = commit;

      // Insert an icon to show this is a commit.
      domBuilder(["i.icon-fork.tight$forkEl"], node);
      node.rowEl.insertBefore(node.forkEl, node.nameEl);

      callback(null, node);
    }
  }

  function createNode(repo, path, name, parent, callback) {
    var fullPath = parent ? parent.fullPath + "/" + name : name;
    repo.pathToEntry(repo.root, path, onEntry);

    function onEntry(err, node) {
      if (!node) return callback(err);

      // Store the path within this repo for future reference
      node.path = path;
      node.name = name;
      node.fullPath = fullPath;
      node.parent = parent;

      // Build the skeleton dom elements
      domBuilder(["li$el",
        [".row$rowEl", ["i$iconEl"], ["span$nameEl", name] ],
      ], node);

      // Create a back-reference for the event-delegation code to find
      node.rowEl.js = node;

      // Trees add a ul element
      if (modes.isTree(node.mode)) {
        node.el.appendChild(domBuilder(["ul$ulEl"], node));
      }

      callback(null, node);
    }
  }

  // Add a child node in the correct sorted position
  function addChild(parent, child) {
    var children = parent.children;
    for (var i = 0, l = children.length; i < l; i++) {
      var other = children[i];
      if (other.name + "/" < child.name + "/") break;
    }
    if (i < l) {
      parent.ulEl.insertBefore(child.el, children[i].el);
      children.splice(i, 0, child);
    }
    else {
      parent.ulEl.appendChild(child.el);
      children.push(child);
    }
  }

  function updateNode(node) {
    node.nameEl.textContent = node.name;
    // Calculate the icon based on the node mode
    var icon = node.mode === modes.tree ?
      node.children ? "folder-open" : "folder" :
      modes.isFile(node.mode) ? "doc" :
      node.mode === modes.sym ? "link" : "asterisk";
    node.iconEl.setAttribute("class", "icon-" + icon);
    node.iconEl.setAttribute("title", modes.toType(node.mode) + " " + node.hash);
    if (node.commit) {
      node.forkEl.setAttribute("title", "commit " + node.commit.hash);
      node.nameEl.setAttribute("title", node.commit.message);
    }
    var classes = ["row"];
    if (selected === node)  classes.push("selected");
    if (active === node) classes.push("activated");
    node.rowEl.setAttribute("class", classes.join(" "));
  }

  function findJs(node) {
    while (!node.js && node !== $.tree) node = node.parentElement;
    return node.js;
  }

  function onClick(evt) {
    var node = findJs(evt.target);
    if (!node) return;
    evt.preventDefault();
    evt.stopPropagation();
    if (node.mode === modes.tree) return toggleTree(node);
    toggleNode(node);
  }

  function onContextMenu(evt) {
    var node = findJs(evt.target);
    var actions = [];
    if (node) {
      var type;
      actions.push({icon:"doc", label:"Create File"});
      actions.push({icon:"folder", label:"Create Folder"});
      actions.push({icon:"link", label:"Create SymLink"});
      actions.push({sep:true});
      actions.push({icon:"globe", label:"Serve over HTTP"});
      actions.push({icon:"hdd", label:"Live Export to Disk"});
      if (node.mode === modes.tree) {
        type = "Folder";
      }
      else if (modes.isFile(node.mode)) {
        type = "File";
        actions.push({sep:true});
        if (node.mode === modes.exec) {
          actions.push({icon:"asterisk", label:"Make not Executable"});
        }
        else {
          actions.push({icon:"asterisk", label:"Make Executable"});
        }
      }
      else if (node.mode === modes.sym) {
        type = "SymLink";
      }
      if (node.commit) {
        actions.push({sep:true});
        actions.push({icon:"bookmark", label:"Create a Commit"});
        actions.push({icon:"download-cloud", label:"Pull from Remote"});
        actions.push({icon:"upload-cloud", label:"Push to Remote"});
      }
      actions.push({sep:true});
      if (node.parent) {
        actions.push({icon:"pencil", label:"Rename " + type});
        actions.push({icon:"trash", label:"Delete " + type});
      }
      else {
        actions.push({icon:"pencil", label:"Rename Repo"});
        actions.push({icon:"trash", label:"Remove Repo"});
      }
    }
    else {
      actions.push({icon:"git", label: "Create Empty Git Repo"});
      actions.push({icon:"github", label: "Mount Github Repo"});
    }
    if (!actions.length) return;
    evt.preventDefault();
    evt.stopPropagation();
    contextMenu(evt, node, actions);
  }

  function toggleTree(node) {
    var openPaths = prefs.get("openPaths", {});

    // If it's open, remove all children.
    if (node.children) {
      node.children.forEach(function (child) {
        node.ulEl.removeChild(child.el);
      });
      node.children = null;
      delete openPaths[node.fullPath];
      prefs.set("openPaths", openPaths);
      updateNode(node);
      return;
    }

    openPaths[node.fullPath] = true;
    prefs.set("openPaths", openPaths);
    node.children = [];
    updateNode(node);

    Object.keys(node.tree).map(function (name) {
      var entry = node.tree[name];
      var path = node.path + "/" + name;
      var fullPath = node.fullPath + "/" + name;
      if (fullPath === activePath) {
        return onChild(null, active);
      }
      if (entry.mode !== modes.commit) return createNode(node.repo, path, name, node, onChild);
      var submodule = node.repo.submodules[path.substr(1)];
      if (!submodule) throw new Error("Invalid submodule " + path);
      createCommitNode(submodule, entry.hash, name, node, onChild);
    });

    function onChild(err, child) {
      if (err) throw err;
      if (!child) throw new Error("Broken child");
      updateNode(child);
      addChild(node, child);
    }
  }

  function toggleNode(node) {
    var old = active;
    if (node === active) {
      active = null;
      activePath = null;
    }
    else {
      active = node;
      activePath = node.fullPath;
    }
    if (old) updateNode(old);
    if (active) updateNode(active);
    activateNode(active);
  }

  function activateNode(node, soft) {
    if (!node || node.doc) return onDoc();

    node.repo.loadAs("blob", node.hash, function (err, buffer) {
      if (err) throw err;

      var mode = modelist.getModeForPath(node.name);
      var code;

      try {
        code = binary.toUnicode(buffer);
      }
      catch (err) {
        // Data is not unicode!
        return;
      }
      node.doc = ace.createEditSession(code, mode.mode);
      whitespace.detectIndentation(node.doc);
      return onDoc();
    });

    function onDoc() {
      editor.setNode(node);
      if (!soft) editor.focus();
    }
  }




});
// Copyright (c) 2008-2009 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the License.txt file included with this file.
"use strict";

(function () {
    const modules = {};
    const BASE = "chrome://liberator/content/";

    modules.modules = modules;

    const loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                                     .getService(Components.interfaces.mozIJSSubScriptLoader);
    function load(script) {
        for (let [i, base] of prefix.entries()) {
            try {
                loader.loadSubScript(base + script, modules);
                return;
            }
            catch (e) {
                if (i + 1 < prefix.length)
                    continue;
                if (Components.utils.reportError)
                    Components.utils.reportError(e);
                dump("liberator: Error loading script " + script + ": " + e + "\n");
                dump(e.stack + "\n");
            }
        }
    }

    let prefix = [BASE];

    Components.utils.import("resource://liberator/template-tag.js", modules);

    // TODO: This list is much too long, we should try to minimize
    // the number of required components for easier porting to new applications
    ["base.js",
     "modules.js",
     "abbreviations.js",
     "autocommands.js",
     "buffer.js",
     "commandline.js",
     "commands.js",
     "completion.js",
     "configbase.js",
     "config.js",
     "liberator.js",
     "editor.js",
     "events.js",
     "finder.js",
     "hints.js",
     "io.js",
     "javascript.js",
     "mappings.js",
     "marks.js",
     "modes.js",
     "options.js",
     "services.js",
     "statusline.js",
     "style.js",
     "template.js",
     "util.js",
     ].forEach(load);

    prefix.unshift("chrome://" + modules.Config.prototype.name.toLowerCase() + "/content/");
    modules.Config.prototype.scripts.forEach(load);

})();

// vim: set fdm=marker sw=4 ts=4 et:

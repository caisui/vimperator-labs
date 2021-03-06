// Copyright (c) 2008-2009 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the License.txt file included with this file.
"use strict";

/* Adds support for data: URIs with chrome privileges
 * and fragment identifiers.
 *
 * "chrome-data:" <content-type> [; <flag>]* "," [<data>]
 *
 * By Kris Maglione, ideas from Ed Anuff's nsChromeExtensionHandler.
 */

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const NS_BINDING_ABORTED = 0x804b0002;
const nsIProtocolHandler = Ci.nsIProtocolHandler;

const ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

XPCOMUtils.defineLazyGetter(this, "systemPrincipal", () => Services.scriptSecurityManager.getSystemPrincipal());
XPCOMUtils.defineLazyGetter(this, "nsIStandardURL", () => {
    const CC = Components.Constructor;
    if (Ci.nsIStandardURLMutator) {
        const C1 = CC("@mozilla.org/network/standard-url-mutator;1", "nsIStandardURLMutator", "init");
        return (...arg) => C1(...arg).finalize().QueryInterface(Ci.nsIURI).QueryInterface(Ci.nsIStandardURL);
    } else {
        const C2 = CC("@mozilla.org/network/standard-url;1", "nsIStandardURL", "init");
        return (...arg) => C2(...arg).QueryInterface(Ci.nsIURI);
    }
});

function dataURL(type, data) { return "data:" + (type || "application/xml;encoding=UTF-8") + "," + encodeURIComponent(data); }
XPCOMUtils.defineLazyGetter(this, "newChannelFromURI", () => ioService.newChannelFromURI2
    ?  function newChannelFromURI(uri) {
        return ioService.newChannelFromURI2(
                uri,
                null,      // aLoadingNode
                systemPrincipal,
                null,      // aTriggeringPrincipal
                Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_DATA_IS_NULL,
                Ci.nsIContentPolicy.TYPE_OTHER);
    } : ioService.newChannelFromURI.bind(ioService)
)
function makeChannel(url, orig) {
    if (typeof url == "function")
        url = dataURL.apply(null, url());
    let uri = ioService.newURI(url, null, null);
    var channel = newChannelFromURI(uri);
    channel.owner = systemPrincipal;
    channel.originalURI = orig;
    return channel;
}
function fakeChannel(orig) { return makeChannel("chrome://liberator/content/does/not/exist", orig); }
function redirect(to, orig) {
    //xxx: escape
    let html = '<html><head><meta http-equiv="Refresh" content="' + ("0;" + to).replace(/"/g, "&quot;") + '"/></head></html>';
    return makeChannel(dataURL('text/html', html), ioService.newURI(to, null, null));
}

function ChromeData() {}
ChromeData.prototype = {
    contractID:       "@mozilla.org/network/protocol;1?name=chrome-data",
    classID:          Components.ID("{c1b67a07-18f7-4e13-b361-2edcc35a5a0d}"),
    classDescription: "Data URIs with chrome privileges",
    QueryInterface:   XPCOMUtils.generateQI([Ci.nsIProtocolHandler]),
    _xpcom_factory: {
        createInstance: function (outer, iid) {
            if (!ChromeData.instance)
                ChromeData.instance = new ChromeData();
            if (outer != null)
                throw Components.results.NS_ERROR_NO_AGGREGATION;
            return ChromeData.instance.QueryInterface(iid);
        }
    },

    scheme: "chrome-data",
    defaultPort: -1,
    allowPort: (port, scheme) => false,
    protocolFlags: nsIProtocolHandler.URI_NORELATIVE
         | nsIProtocolHandler.URI_NOAUTH
         | nsIProtocolHandler.URI_IS_UI_RESOURCE,

    newURI: function (spec, charset, baseURI) {
        var uri = nsIStandardURL(Ci.nsIStandardURL.URLTYPE_STANDARD, this.defaultPort, spec, charset, null);
        return uri;
    },

    newChannel: function (uri) {
        try {
            if (uri.scheme == this.scheme)
                return makeChannel(uri.spec.replace(/^.*?:\/*(.*)(?:#.*)?/, "data:$1"), uri);
        }
        catch (e) {}
        return fakeChannel();
    }
};

function Liberator() {
    this.wrappedJSObject = this;

    const self = this;
    this.HELP_TAGS = {};
    this.FILE_MAP = {};
    this.OVERLAY_MAP = {};
}
Liberator.prototype = {
    contractID:       "@mozilla.org/network/protocol;1?name=liberator",
    classID:          Components.ID("{9c8f2530-51c8-4d41-b356-319e0b155c44}"),
    classDescription: "Liberator utility protocol",
    QueryInterface:   XPCOMUtils.generateQI([Ci.nsIProtocolHandler]),
    _xpcom_factory: {
        createInstance: function (outer, iid) {
            if (!Liberator.instance)
                Liberator.instance = new Liberator();
            if (outer != null)
                throw Components.results.NS_ERROR_NO_AGGREGATION;
            return Liberator.instance.QueryInterface(iid);
        }
    },

    init: function (obj) {
        for (let prop of  ["HELP_TAGS", "FILE_MAP", "OVERLAY_MAP"]) {
            this[prop] = this[prop].constructor();
            for (let [k, v] of Object.entries(obj[prop] || {}))
                this[prop][k] = v
        }
    },

    scheme: "liberator",
    defaultPort: -1,
    allowPort: (port, scheme) => false,
    protocolFlags: 0
         | nsIProtocolHandler.URI_IS_UI_RESOURCE
         | nsIProtocolHandler.URI_IS_LOCAL_RESOURCE,

    newURI: function (spec, charset, baseURI) {
        var uri = nsIStandardURL(Ci.nsIStandardURL.URLTYPE_STANDARD, this.defaultPort, spec, charset, baseURI);
        return uri;
    },

    newChannel: function (uri) {
        try {
            let url;
            let path = "pathQueryRef";
            if (!(path in uri)) path = "path";
            switch(uri.host) {
                case "help":
                    url = this.FILE_MAP[uri[path].replace(/^\/|#.*/g, "")];
                    return makeChannel(url, uri);
                case "help-overlay":
                    url = this.OVERLAY_MAP[uri[path].replace(/^\/|#.*/g, "")];
                    return makeChannel(url, uri);
                case "help-tag":
                    let tag = uri[path].substr(1);
                    if (tag in this.HELP_TAGS)
                        return redirect("liberator://help/" + this.HELP_TAGS[tag] + "#" + tag, uri);
            }
        }
        catch (e) { Cu.reportError(e); }
        return fakeChannel(uri);
    }
};

var components = [ChromeData, Liberator];

if(XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
else {
    function NSGetModule(compMgr, fileSpec) { return XPCOMUtils.generateModule(components); }
}

// vim: set fdm=marker sw=4 ts=4 et:

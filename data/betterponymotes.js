// ==UserScript==
// @description View Reddit ponymotes across the site
// @downloadURL http://rainbow.mlas1.us/betterponymotes.user.js
// @grant GM_log
// @grant GM_getValue
// @grant GM_setValue
// @include http://*/*
// @include https://*/*
// @name BetterPonymotes
// @namespace http://rainbow.mlas1.us/
// @require bpm-data.js?p=2&dver=60_3
// @require pref-setup.js?p=2&cver=35
// @run-at document-start
// @updateURL http://rainbow.mlas1.us/betterponymotes.user.js
// @version 35.60.3
// ==/UserScript==

/*******************************************************************************
**
** Copyright (C) 2012 Typhos
**
** This Source Code Form is subject to the terms of the Mozilla Public
** License, v. 2.0. If a copy of the MPL was not distributed with this
** file, You can obtain one at http://mozilla.org/MPL/2.0/.
**
*******************************************************************************/

"use strict";

var BPM_CODE_VERSION = "35";
var BPM_DATA_VERSION = "60_3";
var BPM_RESOURCE_PREFIX = "http://rainbow.mlas1.us";
var BPM_OPTIONS_PAGE = BPM_RESOURCE_PREFIX + "/options.html";

var _bpm_this = this;

/*
 * Inspects the environment for global variables.
 *
 * On some platforms- particularly some userscript engines- the global this
 * object !== window, and the two may have significantly different properties.
 */
function _bpm_global(name) {
    return _bpm_this[name] || window[name] || undefined;
}

/*
 * Misc. utility functions.
 */
var bpm_utils = {
    /*
     * A string referring to the current platform BPM is running on. This is a
     * best guess, made by inspecting global variables, and needed because this
     * script runs unmodified on all supported platforms.
     */
    platform: (function() {
        // FIXME: "self" is a standard object, though self.on is specific to
        // Firefox content scripts. I'd prefer something a little more clearly
        // affiliated, though.
        //
        // Need to check GM_log first, because stuff like chrome.extension
        // exists even in userscript contexts.
        if(_bpm_global("GM_log") !== undefined) {
            return "userscript";
        } else if(self.on !== undefined) {
            return "firefox-ext";
        } else if(_bpm_global("chrome") !== undefined && chrome.extension !== undefined) {
            return "chrome-ext";
        } else if(_bpm_global("opera") !== undefined && opera.extension !== undefined) {
            return "opera-ext";
        } else {
            // bpm_log doesn't exist, so this is as good a guess as we get
            console.log("BPM: ERROR: Unknown platform!");
            return "unknown";
        }
    })(),

    /*
     * A reference to the MutationObserver object. It's unprefixed on Firefox,
     * but not on Chrome. Safari presumably has this as well. Defined to be
     * null on platforms that don't support it.
     */
    MutationObserver: (_bpm_global("MutationObserver") || _bpm_global("WebKitMutationObserver") || _bpm_global("MozMutationObserver") || null),

    /*
     * Wrapper to safely set up MutationObserver-based code with DOMNodeInserted
     * fallback. MutationObserver is frequently broken on Firefox Nightly due
     * to Addon SDK bugs.
     */
    observe: function(setup_mo, init_mo, setup_dni) {
        if(bpm_utils.MutationObserver !== null) {
            var observer = setup_mo();

            try {
                init_mo(observer);
                return;
            } catch(e) {
                // Failed with whatever the error of the week is
                bpm_log("BPM: ERROR: Can't use MutationObserver. Falling back to DOMNodeInserted. (info: L" + e.lineNumber + ": ", e.name + ": " + e.message + ")");
            }
        }

        setup_dni();
    },

    /*
     * Generates a random string made of [a-z] characters, default 24 chars
     * long.
     */
    _random_letters: "abcdefghijklmnopqrstuvwxyz",
    random_id: function(length) {
        if(length === undefined) {
            length = 24;
        }

        var index, tmp = "";
        for(var i = 0; i < length; i++) {
            index = Math.floor(Math.random() * bpm_utils._random_letters.length - 1);
            tmp += bpm_utils._random_letters[index];
        }
        return tmp;
    },

    /*
     * Makes a nice <style> element out of the given CSS.
     */
    style_tag: function(css) {
        var tag = document.createElement("style");
        tag.type = "text/css";
        tag.textContent = css;
        return tag;
    },

    /*
     * Makes a nice <link> element to the given URL (for CSS).
     */
    stylesheet_link: function(url) {
        var tag = document.createElement("link");
        tag.href = url;
        tag.rel = "stylesheet";
        tag.type = "text/css";
        return tag;
    },

    /*
     * Copies all properties on one object to another.
     */
    copy_properties: function(to, from) {
        for(var key in from) {
            to[key] = from[key];
        }
    },

    /*
     * Determines whether the given element has a particular class name.
     */
    has_class: function(element, class_name) {
        return (" " + element.className + " ").indexOf(" " + class_name + " ") > -1;
    },

    /*
     * Determines whether this element, or any ancestor, have the given id.
     */
    id_above: function(element, id) {
        if(element.id === id) {
            return true;
        } else if(element.parentNode !== null) {
            return bpm_utils.id_above(element.parentNode, id);
        } else {
            return false;
        }
    },

    /*
     * Determines whether this element, or any ancestor, have the given class.
     */
    class_above: function(element, class_name) {
        if(element.className === undefined) {
            return false;
        }

        if(bpm_utils.has_class(element, class_name)) {
            return true;
        }

        if(element.parentNode !== null) {
            return bpm_utils.class_above(element.parentNode, class_name);
        }
    },

    /*
     * str.endswith()
     */
    ends_with: function(text, s) {
        return text.slice(-s.length) === s;
    },

    /*
     * Wraps a function with an error-detecting variant. Useful for callbacks
     * and the like, since some browsers (Firefox...) have a way of swallowing
     * exceptions.
     */
    catch_errors: function(f) {
        return function() {
            try {
                return f.apply(this, arguments);
            } catch(e) {
                bpm_log("BPM: ERROR: Exception on line " + e.lineNumber + ": ", e.name + ": " + e.message);
                throw e;
            }
        };
    },

    /*
     * Escapes an emote name (or similar) to match the CSS classes.
     *
     * Must be kept in sync with other copies, and the Python code.
     */
    sanitize: function(s) {
        return s.toLowerCase().replace("!", "_excl_").replace(":", "_colon_").replace("#", "_hash_").replace("/", "_slash_");
    },

    /*
     * Helper function to make elements "draggable", i.e. clicking and dragging
     * them will move them around.
     */
    enable_drag: function(element, start_callback, callback) {
        var start_x, start_y;
        var dragging = false;

        element.addEventListener("mousedown", bpm_utils.catch_errors(function(event) {
            start_x = event.clientX;
            start_y = event.clientY;
            dragging = true;
            document.body.className += " bpm-noselect";
            start_callback(event);
        }), false);

        window.addEventListener("mouseup", bpm_utils.catch_errors(function(event) {
            dragging = false;
            document.body.className = document.body.className.replace(/\bbpm-noselect\b/, "");
        }), false);

        window.addEventListener("mousemove", bpm_utils.catch_errors(function(event) {
            if(dragging) {
                callback(event, start_x, start_y, event.clientX, event.clientY);
            }
        }), false);
    },

    /*
     * Runs the given callback when the DOM is ready, i.e. when DOMContentLoaded
     * fires. If that has already happened, runs the callback immediately.
     */
    with_dom: function(callback) {
        if(document.readyState === "interactive" || document.readyState === "complete") {
            callback();
        } else {
            document.addEventListener("DOMContentLoaded", bpm_utils.catch_errors(function(event) {
                callback();
            }), false);
        }
    },

    /*
     * Determines, fairly reliably, whether or not BPM is currently running in
     * a frame.
     */
    is_frame: function() {
        // Firefox is funny about window/.self/.parent/.top, such that comparing
        // references is unreliable. frameElement is the only test I've found so
        // far that works consistently.
        return (window !== window.top || (window.frameElement !== null && window.frameElement !== undefined));
    },

    _msg_script: function(id, message) {
        /*
         * BetterPonymotes hack to enable cross-origin frame communication in
         * broken browsers.
         */
        // Locate iframe, send message, remove class.
        var iframe = document.getElementsByClassName(id)[0];
        iframe.contentWindow.postMessage(message, "*");
        iframe.className = iframe.className.replace(RegExp("\\b" + id + "\\b"), "");
        // Locate this script tag and remove it.
        var script = document.getElementById(id);
        script.parentNode.removeChild(script);
    },

    /*
     * Send a message to an iframe via postMessage(), working around any browser
     * shortcomings to do so.
     *
     * "message" must be JSON-compatible.
     *
     * Note that the targetOrigin of the postMessage() call is "*", no matter
     * what. Don't send anything even slightly interesting.
     */
    message_iframe: function(frame, message) {
        if(frame.contentWindow === null || frame.contentWindow === undefined) {
            // Chrome and Opera don't permit *any* access to these variables for
            // some stupid reason, despite them being available on the page.
            // Inject a <script> tag that does the dirty work for us.
            var id = "__betterponymotes_esh_" + this.random_id();
            frame.className += " " + id;
            var script = document.createElement("script");
            script.type = "text/javascript";
            script.id = id;
            document.head.appendChild(script);
            script.textContent = "(" + this._msg_script.toString() + ")('" + id + "', " + JSON.stringify(message) + ");";
        } else {
            // Right now, only Firefox lets us access this API.
            frame.contentWindow.postMessage(message, "*");
        }
    }
};

/*
 * Log function. You should use this in preference to console.log(), which isn't
 * always available.
 */
// Chrome is picky about bind().
var bpm_log = bpm_utils.platform === "userscript" ? GM_log : console.log.bind(console);

/*
 * Emote lookup utilities. These are rather helpful, since our data format is
 * optimized for space and memory, not easy of access.
 */
var bpm_data = {
    /*
     * Tries to locate an emote, either builtin or global.
     */
    lookup_emote: function(name, custom_emotes) {
        return (this.lookup_core_emote(name) ||
                this.lookup_custom_emote(name, custom_emotes) ||
                null);
    },

    /*
     * Looks up a builtin emote's information. Returns an object with a couple
     * of properties, or null if the emote doesn't exist.
     */
    lookup_core_emote: function(name) {
        // NRRSSSS+tags where N=nsfw, RR=subreddit, SSSS=size
        var info = emote_map[name];
        if(info === undefined) {
            return null;
        }

        var is_nsfw = parseInt(info.slice(0, 1), 10);
        var source_id = parseInt(info.slice(1, 3), 10);
        var size = parseInt(info.slice(3, 7), 16); // Hexadecimal
        var tags = [];
        var start = 7;
        // One byte per tag, hexadecimal
        var str;
        while((str = info.slice(start, start+2)) !== "") {
            tags.push(parseInt(str, 16));
            start += 2;
        }
        return {
            name: name,
            is_nsfw: Boolean(is_nsfw),
            source_id: source_id,
            source_name: sr_id2name[source_id],
            max_size: size,
            tags: tags,
            css_class: "bpmote-" + bpm_utils.sanitize(name.slice(1))
        };
    },

    /*
     * Looks up a custom emote's information. The returned object is rather
     * sparse, but roughly compatible with core emote's properties.
     */
    lookup_custom_emote: function(name, custom_emotes) {
        if(custom_emotes[name] === undefined) {
            return null;
        }

        return {
            name: name,
            is_nsfw: false,
            source_id: null,
            source_name: "custom subreddit",
            max_size: null,
            tags: [],
            css_class: "bpm-cmote-" + bpm_utils.sanitize(name.slice(1)),
        };
    }
};

/*
 * Browser compatibility object. (Mostly implemented per-browser.)
 */
var bpm_browser = {
    /*
     * Returns an object that CSS-related tags can be attached to before the DOM
     * is built. May be undefined or null if there is no such object.
     */
    css_parent: function() {
        return document.head;
    },

    /*
     * Appends a <style> tag for the given CSS.
     */
    add_css: function(css) {
        if(css) {
            var tag = bpm_utils.style_tag(css);
            this.css_parent().insertBefore(tag, this.css_parent().firstChild);
        }
    },

    /*
     * Sends a set_pref message to the backend. Don't do this too often, as
     * some browsers incur a significant overhead for each call.
     */
    set_pref: function(key, value) {
        this._send_message("set_pref", {"pref": key, "value": value});
    },

    /*
     * Sends a message to the backend requesting a copy of the preferences.
     */
    request_prefs: function() {
        this._send_message("get_prefs");
    },

    /*
     * Sends a message to the backend requesting the custom CSS data.
     */
    request_custom_css: function() {
        this._send_message("get_custom_css");
    }

    // Missing attributes/methods:
    //    function css_parent()
    //    function _send_message(method, data)
    //    function link_css(filename)
    // Assumed globals:
    //    var sr_id2name
    //    var sr_name2id
    //    var emote_map
};

switch(bpm_utils.platform) {
case "firefox-ext":
    bpm_utils.copy_properties(bpm_browser, {
        _send_message: function(method, data) {
            if(data === undefined) {
                data = {};
            }
            data["method"] = method;
            self.postMessage(data);
        },

        link_css: function(filename) {
            // FIXME: Hardcoding this sucks. It's likely to continue working for
            // a good long while, but we should prefer make a request to the
            // backend for the prefix (not wanting to do that is the reason for
            // hardcoding it). Ideally self.data.url() would be accessible to
            // content scripts, but it's not...
            var url = "resource://jid1-thrhdjxskvsicw-at-jetpack/betterponymotes/data" + filename;
            var tag = bpm_utils.stylesheet_link(url);
            // Seems to work in Firefox, and we get to put our tags in a pretty
            // place!
            this.css_parent().insertBefore(tag, this.css_parent().firstChild);
        }
    });

    self.on("message", bpm_utils.catch_errors(function(message) {
        switch(message.method) {
        case "prefs":
            bpm_prefs.got_prefs(message.prefs);
            break;

        case "custom_css":
            bpm_browser.add_css(message.css);
            bpm_prefs.got_custom_emotes(message.emotes);
            break;

        default:
            bpm_log("BPM: ERROR: Unknown request from Firefox background script: '" + message.method + "'");
            break;
        }
    }));
    break;

case "chrome-ext":
    bpm_utils.copy_properties(bpm_browser, {
        css_parent: function() {
            return document.documentElement;
        },

        _send_message: function(method, data) {
            if(data === undefined) {
                data = {};
            }
            data["method"] = method;
            chrome.extension.sendMessage(data, this._message_handler.bind(this));
        },

        _message_handler: function(message) {
            switch(message.method) {
            case "prefs":
                bpm_prefs.got_prefs(message.prefs);
                break;

            case "custom_css":
                bpm_browser.add_css(message.css);
                bpm_prefs.got_custom_emotes(message.emotes);
                break;

            default:
                bpm_log("BPM: ERROR: Unknown request from Chrome background script: '" + message.method + "'");
                break;
            }
        },

        link_css: function(filename) {
            var tag = bpm_utils.stylesheet_link(chrome.extension.getURL(filename));
            // document.head does not exist at this point in Chrome (it's null).
            // Trying to access it seems to blow it away. Strange. This will
            // have to suffice (though it gets them "backwards").
            this.css_parent().insertBefore(tag, this.css_parent().firstChild);
        }
    });
    break;

case "opera-ext":
    bpm_utils.copy_properties(bpm_browser, {
        _send_message: function(method, data) {
            if(data === undefined) {
                data = {};
            }
            data["method"] = method;
            opera.extension.postMessage(data);
        },

        link_css: function(filename) {
            this._get_file(filename, function(data) {
                var tag = bpm_utils.style_tag(data);
                this.css_parent().insertBefore(tag, this.css_parent().firstChild);
            }.bind(this));
        }
    });

    // Opera Next (12.50) has a better API to load the contents of an
    // embedded file than making a request to the backend process. Use
    // that if available.
    if(opera.extension.getFile) {
        bpm_utils.copy_properties(bpm_browser, {
            _is_opera_next: true, // Close enough

            _get_file: function(filename, callback) {
                var file = opera.extension.getFile(filename);
                if(file) {
                    var reader = new FileReader();
                    reader.onload = bpm_utils.catch_errors(function() {
                        callback(reader.result);
                    });
                    reader.readAsText(file);
                } else {
                    bpm_log("BPM: ERROR: Opera getFile() failed on '" + filename + "'");
                }
            }
        });
    } else {
        bpm_utils.copy_properties(bpm_browser, {
            _is_opera_next: false,
            _file_callbacks: {},

            _get_file: function(filename, callback) {
                this._file_callbacks[filename] = callback;
                this._send_message("get_file", {"filename": filename});
            }
        });
    }

    opera.extension.addEventListener("message", bpm_utils.catch_errors(function(event) {
        var message = event.data;
        switch(message.method) {
        case "file_loaded":
            bpm_browser._file_callbacks[message.filename](message.data);
            delete bpm_browser._file_callbacks[message.filename];
            break;

        case "prefs":
            bpm_prefs.got_prefs(message.prefs);
            break;

        case "custom_css":
            bpm_browser.add_css(message.css);
            bpm_prefs.got_custom_emotes(message.emotes);
            break;

        default:
            bpm_log("BPM: ERROR: Unknown request from Opera background script: '" + message.method + "'");
            break;
        }
    }), false);
    break;

case "userscript":
    bpm_utils.copy_properties(bpm_browser, {
        prefs: null,

        set_pref: function(key, value) {
            this.prefs[key] = value;
            this._sync_prefs();
        },

        _sync_prefs: function() {
            GM_setValue("prefs", JSON.stringify(this.prefs));
        },

        request_prefs: function() {
            var tmp = GM_getValue("prefs");
            if(tmp === undefined) {
                tmp = "{}";
            }

            this.prefs = JSON.parse(tmp);
            bpm_backendsupport.setup_prefs(this.prefs, sr_name2id);
            this._sync_prefs();

            bpm_prefs.got_prefs(this.prefs);
            bpm_prefs.got_custom_emotes({}); // No support
        },

        request_custom_css: function() {
        },

        link_css: function(filename) {
            var url = BPM_RESOURCE_PREFIX + filename + "?p=2&dver=" + BPM_DATA_VERSION;
            var tag = bpm_utils.stylesheet_link(url);
            this.css_parent().insertBefore(tag, this.css_parent().firstChild);
        }
    });
    break;
}

/*
 * Preferences interface.
 */
var bpm_prefs = {
    /*
     * Preferences object and caches:
     *    - prefs: actual preferences object
     *    - custom_emotes: map of extracted custom CSS emotes
     *    - sr_array: array of enabled subreddits. sr_array[sr_id] === enabled
     */
    prefs: null,
    custom_emotes: null,
    sr_array: null,
    waiting: [],
    sync_timeouts: {},

    _ready: function() {
        return (this.prefs !== null && this.custom_emotes !== null);
    },

    _run_callbacks: function() {
        for(var i = 0; i < this.waiting.length; i++) {
            this.waiting[i](this);
        }
    },

    /*
     * Runs the given callback when preferences are available, possibly
     * immediately.
     */
    when_available: function(callback) {
        if(this._ready()) {
            callback(this);
        } else {
            this.waiting.push(callback);
        }
    },

    /*
     * Called from browser code when preferences have been received.
     */
    got_prefs: function(prefs) {
        this.prefs = prefs;
        this._make_sr_array();
        this.de_map = this._make_emote_map(prefs.disabledEmotes);
        this.we_map = this._make_emote_map(prefs.whitelistedEmotes);

        if(this._ready()) {
            this._run_callbacks();
        }
    },

    /*
     * Called from browser code when the custom CSS emote list has been
     * received.
     */
    got_custom_emotes: function(emotes) {
        this.custom_emotes = emotes;

        if(this._ready()) {
            this._run_callbacks();
        }
    },

    _make_sr_array: function() {
        this.sr_array = [];
        for(var id in sr_id2name) {
            this.sr_array[id] = this.prefs.enabledSubreddits2[sr_id2name[id]];
        }
        if(this.sr_array.indexOf(undefined) > -1) {
            // Holes in the array mean holes in sr_id2name, which can't possibly
            // happen. If it does, though, any associated emotes will be hidden.
            //
            // Also bad would be items in prefs not in sr_id2name, but that's
            // more or less impossible to handle.
            bpm_log("BPM: ERROR: sr_array has holes; installation or prefs are broken!");
        }
    },

    _make_emote_map: function(list) {
        var map = {};
        for(var i = 0; i < list.length; i++) {
            map[list[i]] = 1;
        }
        return map;
    },

    /*
     * Sync the given preference key. This may be called rapidly, as it will
     * enforce a small delay between the last sync_key() invocation and any
     * actual browser call is made.
     */
    sync_key: function(key) {
        // Schedule pref write for one second in the future, clearing out any
        // previous timeout. Prevents excessive backend calls, which can generate
        // some lag (on Firefox, at least).
        if(this.sync_timeouts[key] !== undefined) {
            clearTimeout(this.sync_timeouts[key]);
        }

        this.sync_timeouts[key] = setTimeout(bpm_utils.catch_errors(function() {
            bpm_browser.set_pref(key, this.prefs[key]);
            delete this.sync_timeouts[key];
        }.bind(this)), 1000);
    }
};

/*
 * Core Reddit emote converter code.
 */
var bpm_converter = {
    /*
     * Process the given list of elements (assumed to be <a> tags), converting
     * any that are emotes.
     */
    process: function(prefs, elements) {
        for(var i = 0; i < elements.length; i++) {
            var element = elements[i];
            if(element.className.indexOf("bpm-") > -1) {
                // Already processed: has bpm-emote or bpm-unknown on it. It
                // doesn't really matter if this function runs on emotes more
                // than once (it's safe), but that may change, and the class
                // spam is annoying.
                continue;
            }

            // There is an important distinction between element.href and
            // element.getAttribute("href")- the former is mangled by the
            // browser to be a complete URL, which we don't want.
            var href = element.getAttribute("href");
            if(href && href[0] === "/") {
                // Don't normalize case for emote lookup
                var parts = href.split("-");
                var emote_name = parts[0];
                var emote_info = bpm_data.lookup_emote(emote_name, prefs.custom_emotes);

                if(emote_info !== null) {
                    var sr_enabled = (emote_info.source_id !== null ? prefs.sr_array[emote_info.source_id] : true);
                    var emote_size = emote_info.max_size || 0;

                    // Click blocker CSS/JS
                    element.className += " bpm-emote";
                    // Used in alt-text. (Note: dashes are invalid here)
                    element.dataset["bpm_emotename"] = emote_name;
                    element.dataset["bpm_srname"] = emote_info.source_name;

                    if(!prefs.we_map[emote_name]) {
                        var nsfw_class = prefs.prefs.hideDisabledEmotes ? " bpm-hidden" : " bpm-nsfw";
                        var disabled_class = prefs.prefs.hideDisabledEmotes ? " bpm-hidden" : " bpm-disabled";
                        // Ordering matters a bit here- placeholders for NSFW emotes
                        // come before disabled emotes.
                        if(emote_info.is_nsfw && !prefs.prefs.enableNSFW) {
                            element.className += nsfw_class;
                            if(!element.textContent) {
                                // Any existing text (there really shouldn't be any)
                                // will look funny with our custom CSS, but there's
                                // not much we can do.
                                element.textContent = "NSFW " + emote_name;
                            }
                            continue;
                        }

                        if(!sr_enabled || prefs.de_map[emote_name]) {
                            element.className += disabled_class;
                            if(!element.textContent) {
                                element.textContent = "Disabled " + emote_name;
                            }
                            continue;
                        }

                        if(prefs.prefs.maxEmoteSize && emote_size > prefs.prefs.maxEmoteSize) {
                            element.className += disabled_class;
                            if(!element.textContent) {
                                element.textContent = "Large emote " + emote_name;
                            }
                            continue;
                        }
                    }

                    element.className += " " + emote_info.css_class;

                    // Apply flags in turn. We pick on the naming a bit to prevent
                    // spaces and such from slipping in.
                    for(var p = 1; p < parts.length; p++) {
                        // Normalize case
                        var flag = parts[p].toLowerCase();
                        if(/^[\w:!#\/]+$/.test(flag)) {
                            element.className += " bpflag-" + bpm_utils.sanitize(flag);
                        }
                    }
                } else if(prefs.prefs.showUnknownEmotes) {
                    /*
                     * If there's:
                     *    1) No text
                     *    2) href matches regexp (no slashes, mainly)
                     *    3) No size (missing bg image means it won't display)
                     *    4) No :after or :before tricks to display the image
                     *       (some subreddits do emotes with those selectors)
                     * Then it's probably an emote, but we don't know what it is.
                     * Thanks to nallar for his advice/code here.
                     */
                    if(!element.textContent && /^\/[\w\-:!]+$/.test(emote_name) && !element.clientWidth) {
                        var after = window.getComputedStyle(element, ":after").backgroundImage;
                        var before = window.getComputedStyle(element, ":before").backgroundImage;
                        // "" in Opera, "none" in Firefox and Chrome.
                        if((!after || after === "none") && (!before || before === "none")) {
                            // Unknown emote? Good enough
                            element.className += " bpm-unknown";
                            element.textContent = "Unknown emote " + emote_name;
                        }
                    }
                }
            }
        }
    },

    // Known spoiler "emotes". Not all of these are known to BPM, and it's not
    // really worth moving this to a data file somewhere.
    // - /spoiler is from r/mylittlepony (and copied around like mad)
    // - /s is from r/falloutequestria (and r/mylittleanime has a variant)
    // - #s is from r/doctorwho
    // - /b and /g are from r/dresdenfiles
    spoiler_links: ["/spoiler", "/s", "#s", "/b", "/g"],

    /*
     * Converts alt-text on a list of <a> elements as appropriate.
     */
    // NOTE/FIXME: Alt-text isn't really related to emote conversion as-is, but
    // since it runs on a per-emote basis, it kinda goes here anyway.
    display_alt_text: function(elements) {
        for(var i = 0; i < elements.length; i++) {
            var element = elements[i];

            // Already processed- ignore, so we don't do annoying things like
            // expanding the emote sourceinfo.
            if(bpm_utils.has_class(element, "bpm-processed-at")) {
                continue;
            }

            // Can't rely on .bpm-emote and data-emote to exist for spoiler
            // links, as many of them aren't known.
            var href = element.getAttribute("href");
            if(href && this.spoiler_links.indexOf(href.split("-")[0]) > -1) {
                continue;
            }

            var processed = false;

            if(element.title) {
                processed = true;

                // Work around due to RES putting tag links in the middle of
                // posts. (Fucking brilliant!)
                if(bpm_utils.has_class(element, "userTagLink") ||
                   bpm_utils.has_class(element, "voteWeight")) {
                    continue;
                }

                // As a note: alt-text kinda has to be a block-level element. If
                // you make it inline, it has the nice property of putting it where
                // the emote was in the middle of a paragraph, but since the emote
                // itself goes to the left, it just gets split up. This also makes
                // long chains of emotes with alt-text indecipherable.
                //
                // Inline *is*, however, rather important sometimes- particularly
                // -inp emotes. As a bit of a hack, we assume the emote code has
                // already run, and check for bpflag-in/bpflag-inp.
                var at_element;
                if(element.className.indexOf("bpflag-in") > -1 || element.className.indexOf("bpflag-inp") > -1) {
                    at_element = document.createElement("span");
                } else {
                    at_element = document.createElement("div");
                }

                at_element.className = "bpm-alttext";
                at_element.textContent = element.title;

                // Try to move to the other side of RES's image expand buttons,
                // because otherwise they end awfully
                var before = element.nextSibling;
                while((before !== null && before.className !== undefined) &&
                      (bpm_utils.has_class(before, "expando-button") ||
                       bpm_utils.has_class(before, "bpm-sourceinfo"))) {
                    before = before.nextSibling;
                }

                if(before !== null && bpm_utils.has_class(before, "bpm-alttext")) {
                    // Already processed (before node is our previous alt text)
                    continue;
                }
                element.parentNode.insertBefore(at_element, before);
            }

            // If it's an emote, replace the actual alt-text with source
            // information
            if(bpm_utils.has_class(element, "bpm-emote")) {
                processed = true;
                var emote_name = element.dataset["bpm_emotename"];
                var sr_name = element.dataset["bpm_srname"];
                element.title = emote_name + " from " + sr_name;
            }

            if(processed) {
                // Mark as such.
                element.className += " bpm-processed-at";
            }
        }
    },

    /*
     * Processes emotes and alt-text on a list of .md objects.
     */
    process_posts: function(prefs, posts) {
        for(var i = 0; i < posts.length; i++) {
            var links = posts[i].getElementsByTagName("a");
            // NOTE: must run alt-text AFTER emote code, always. See note in
            // display_alt_text
            this.process(prefs, links);
            if(prefs.prefs.showAltText) {
                this.display_alt_text(links);
            }
        }
    }
};

/*
 * Emote search, the search box, and all support code.
 */
var bpm_search = {
    // Search box elements
    container: null,
    dragbox: null,
    search: null,
    count: null,
    close: null,
    results: null,
    resize: null,
    global_icon: null, // Global << thing
    firstrun: false, // Whether or not we've made any search at all yet

    /*
     * Sets up the search box for use on a page, either Reddit or the top-level
     * frame, globally.
     */
    init: function(prefs) {
        this.inject_html();
        this.init_search_box(prefs);
    },

    /*
     * Sets up search for use in a frame. No search box is generated, but it
     * listens for postMessage() calls from the parent frame.
     */
    init_frame: function(prefs) {
        window.addEventListener("message", bpm_utils.catch_errors(function(event) {
            // Not worried about event source (it might be null in Firefox, as
            // a note). Both of these methods are quite harmless, so it's
            // probably ok to let them be publically abusable.
            //
            // I'm not sure how else we can do it, anyway- possibly by going
            // through the backend, but not in userscripts. (Maybe we can abuse
            // GM_setValue().)
            var message = event.data;
            switch(message.__betterponymotes_method) {
                case "__bpm_inject_emote":
                    // Call toString() just in case
                    this.insert_emote(message.__betterponymotes_emote.toString());
                    break;

                case "__bpm_track_form":
                    this.grab_target_form();
                    break;

                // If it's not our message, it'll be undefined. (We don't care.)
            }
        }.bind(this)), false);
    },

    /*
     * Builds and injects the search box HTML.
     */
    inject_html: function() {
        // Placeholder div to create HTML in
        var div = document.createElement("div");
        // I'd sort of prefer display:none, but then I'd have to override it
        div.style.visibility = "hidden";
        div.id = "bpm-stuff"; // Just so it's easier to find in an elements list

        var html = [
            // tabindex is hack to make Esc work. Reddit uses this index in a couple
            // of places, so probably safe.
            '<div id="bpm-search-box" tabindex="100">',
            '  <div id="bpm-toprow">',
            '     <span id="bpm-dragbox"></span>',
            '     <input id="bpm-search" type="search" placeholder="Search"/>',
            '    <span id="bpm-result-count"></span>',
            '    <span id="bpm-close"></span>',
            '  </div>',
            '  <div id="bpm-search-results"></div>',
            '  <div id="bpm-bottomrow">',
            '    <span id="bpm-help-hover">help',
            '      <div id="bpm-search-help">',
            '        <p>Searching for <code>"aj"</code> will show you all emotes with <code>"aj"</code> in their names.',
            '        <p>Searching for <code>"aj happy"</code> will show you all emotes with both <code>"aj"</code> and <code>"happy"</code> in their names.',
            '        <p>The special syntax <code>"sr:subreddit"</code> will limit your results to emotes from that subreddit.',
            '        <p>Using more than one subreddit will show you emotes from all of them.',
            '        <p>Searching for <code>"+tag"</code> will show you emotes with the given tag.',
            '      </div>',
            '    </span>',
            '    <span id="bpm-resize"></span>',
            '  </div>',
            '</div>',
            '<div id="bpm-global-icon" title="Hold Ctrl (Command/Meta) to drag"></div>'
            ].join("\n");
        div.innerHTML = html;
        document.body.appendChild(div);

        // This seems to me a rather lousy way to build HTML, but oh well
        this.container = document.getElementById("bpm-search-box");
        this.dragbox = document.getElementById("bpm-dragbox");
        this.search = document.getElementById("bpm-search");
        this.count = document.getElementById("bpm-result-count");
        this.close = document.getElementById("bpm-close");
        this.results = document.getElementById("bpm-search-results");
        this.resize = document.getElementById("bpm-resize");

        this.global_icon = document.getElementById("bpm-global-icon");
    },

    /*
     * Sets up the emote search box.
     */
    init_search_box: function(prefs) {
        /*
         * Intercept mouseover for the entire search widget, so we can remember
         * which form was being used before.
         */
        this.container.addEventListener("mouseover", bpm_utils.catch_errors(function(event) {
            this.grab_target_form();
        }.bind(this)), false);

        // Close it on demand
        this.close.addEventListener("click", bpm_utils.catch_errors(function(event) {
            this.hide();
        }.bind(this)), false);

        // Another way to close it
        this.container.addEventListener("keyup", bpm_utils.catch_errors(function(event) {
            if(event.keyCode === 27) { // Escape key
                this.hide();
            }
        }.bind(this)), false);

        // Listen for keypresses and adjust search results. Delay 500ms after
        // end of typing to make it more responsive.
        var timeout = null;
        this.search.addEventListener("input", bpm_utils.catch_errors(function(event) {
            if(timeout !== null) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(bpm_utils.catch_errors(function() {
                // Re-enable searching as early as we can, just in case
                timeout = null;
                this.update_search(prefs);
            }.bind(this)), 500);
        }.bind(this)), false);

        // Listen for clicks
        this.results.addEventListener("click", bpm_utils.catch_errors(function(event) {
            if((" " + event.target.className + " ").indexOf(" bpm-result ") > -1) {
                // .dataset would probably be nicer, but just in case...
                var emote_name = event.target.getAttribute("data-emote");
                this.insert_emote(emote_name);
            }
        }.bind(this)), false);

        // Set up default positions
        this.container.style.left = prefs.prefs.searchBoxInfo[0] + "px";
        this.container.style.top = prefs.prefs.searchBoxInfo[1] + "px";
        this.container.style.width = prefs.prefs.searchBoxInfo[2] + "px";
        this.container.style.height = prefs.prefs.searchBoxInfo[3] + "px";
        // 98 is a magic value from the CSS.
        // 98 = height(topbar) + margins(topbar) + margins(results) + padding(results)
        //    = 20             + 30*2            + 30               + 8
        this.results.style.height = prefs.prefs.searchBoxInfo[3] - 98 + "px"; // Styling
        this.global_icon.style.left = prefs.prefs.globalIconPos[0] + "px";
        this.global_icon.style.top = prefs.prefs.globalIconPos[1] + "px";

        // Enable dragging the window around
        var search_box_x, search_box_y;
        bpm_utils.enable_drag(this.dragbox, function(event) {
            search_box_x = parseInt(this.container.style.left, 10);
            search_box_y = parseInt(this.container.style.top, 10);
        }.bind(this), function(event, start_x, start_y, x, y) {
            // Don't permit it to move out the left/top side of the window
            var sb_left = Math.max(x - start_x + search_box_x, 0);
            var sb_top = Math.max(y - start_y + search_box_y, 0);

            this.container.style.left = sb_left + "px";
            this.container.style.top = sb_top + "px";

            prefs.prefs.searchBoxInfo[0] = sb_left;
            prefs.prefs.searchBoxInfo[1] = sb_top;
            bpm_prefs.sync_key("searchBoxInfo"); // FIXME: this will be called way too often
        }.bind(this));

        // Enable dragging the resize element around (i.e. resizing it)
        var search_box_width, search_box_height, results_height;
        bpm_utils.enable_drag(this.resize, function(event) {
            search_box_width = parseInt(this.container.style.width, 10);
            search_box_height = parseInt(this.container.style.height, 10);
            results_height = parseInt(this.results.style.height, 10);
        }.bind(this), function(event, start_x, start_y, x, y) {
            // 420px wide prevents the search box from collapsing too much, and 98px
            // is the height of the top bar + margins*3. An extra five pixels prevents
            // the results div from disappearing completely (which can be bad).
            var sb_width = Math.max(x - start_x + search_box_width, 420);
            var sb_height = Math.max(y - start_y + search_box_height, 98+5);

            this.container.style.width = sb_width + "px";
            this.container.style.height = sb_height + "px";
            this.results.style.height = sb_height - 98 + "px";

            prefs.prefs.searchBoxInfo[2] = sb_width;
            prefs.prefs.searchBoxInfo[3] = sb_height;
            bpm_prefs.sync_key("searchBoxInfo"); // FIXME again
        }.bind(this));
    },

    /*
     * Displays the search box.
     */
    show: function(prefs) {
        this.container.style.visibility = "visible";
        this.search.focus();

        // If we haven't run before, go search for things
        if(!this.firstrun) {
            this.firstrun = true;
            this.search.value = prefs.prefs.lastSearchQuery;
            this.update_search(prefs);
        }
    },

    hide: function() {
        this.container.style.visibility = "hidden";
        // TODO: possibly clear out the search results, since it's a large pile
        // of HTML.
    },

    /*
     * Previously focused elements. Only one of these can be non-null.
     */
    target_form: null,
    target_frame: null,

    /*
     * Caches the currently focused element, if it's something we can inject
     * emotes into.
     */
    grab_target_form: function() {
        var active = document.activeElement;

        while(active.tagName === "IFRAME") {
            // Focus is within the frame. Find the real element (recursing just
            // in case).
            if(active.contentWindow === null || active.contentWindow === undefined) {
                // Chrome is broken and does not permit us to access these
                // from content scripts.
                this.target_form = null;
                this.target_frame = active;

                bpm_utils.message_iframe(active, {
                    "__betterponymotes_method": "__bpm_track_form"
                });
                return;
            }

            try {
                active = active.contentDocument.activeElement;
            } catch(e) {
                // Addon SDK is broken
                bpm_utils.message_iframe(active, {
                    "__betterponymotes_method": "__bpm_track_form"
                });

                this.target_form = null;
                this.target_frame = active;
                return;
            }
        }

        // Ignore our own stuff and things that are not text boxes
        if(!bpm_utils.id_above(active, "bpm-search-box") && active !== this.target_form &&
           active.selectionStart !== undefined && active.selectionEnd !== undefined) {
            this.target_form = active;
            this.target_frame = null;
        }
    },

    /*
     * Updates the search results window according to the current query.
     */
    update_search: function(prefs) {
        // Split search query on spaces, remove empty strings, and lowercase terms
        var terms = this.search.value.split(" ").map(function(v) { return v.toLowerCase(); });
        terms = terms.filter(function(v) { return v; });
        prefs.prefs.lastSearchQuery = terms.join(" ");
        bpm_prefs.sync_key("lastSearchQuery");

        var sr_terms = [];
        var tag_term_sets = [];
        var match_terms = [];
        for(var t = 0; t < terms.length; t++) {
            var term = terms[t];
            // If it starts with "sr:" it's subreddit syntax, otherwise it's a
            // normal search term.
            if(term.indexOf("sr:") === 0) {
                sr_terms.push([term.slice(3)]);
            } else if(term[0] == "+") {
                var id = tag_name2id[term];
                if(id !== undefined) {
                    tag_term_sets.push([id]); // Exact match
                } else {
                    var match_aliases = [];
                    // Locate anything that works
                    for(var alias in tag_name2id) {
                        id = tag_name2id[alias];
                        // Cut off +
                        if(alias.slice(1).indexOf(term.slice(1)) > -1 &&
                           match_aliases.indexOf(id) < 0) {
                            match_aliases.push(id);
                        }
                    }
                    if(match_aliases.length) {
                        tag_term_sets.push(match_aliases);
                    }
                }
            } else {
                match_terms.push(term);
            }
        }

        // If there's nothing to search on, reset and stop
        if(!sr_terms.length && !tag_term_sets.length && !match_terms.length) {
            this.results.innerHTML = "";
            this.count.textContent = "";
            return;
        }

        var results = [];
        no_match:
        for(var emote_name in emote_map) {
            var emote_info = bpm_data.lookup_emote(emote_name);

            // Ignore hidden emotes
            if(emote_info.tags.indexOf(tag_name2id["+hidden"]) > -1) {
                continue no_match;
            }

            // Cache lowercased version
            var lc_emote = emote_name.toLowerCase();
            // Match if ALL search terms match
            for(var t = 0; t < match_terms.length; t++) {
                if(lc_emote.indexOf(match_terms[t]) < 0) {
                    continue no_match; // outer loop, not inner
                }
            }

            // Match if AT LEAST ONE subreddit terms match
            if(sr_terms.length) {
                // Generally this name is already lowercase, though not for bpmextras
                var source_sr_name = emote_info.source_name.toLowerCase();
                var is_match = false;
                for(var t = 0; t < sr_terms.length; t++) {
                    if(source_sr_name.indexOf(sr_terms[t]) > -1) {
                        is_match = true;
                        break;
                    }
                }
                if(!is_match) {
                    continue no_match;
                }
            }

            // Match if ALL tag sets match
            for(var tt_i = 0; tt_i < tag_term_sets.length; tt_i++) {
                // Match if AT LEAST ONE of these match
                var tag_set = tag_term_sets[tt_i];
                var any = false;
                for(var ts_i = 0; ts_i < tag_set.length; ts_i++) {
                    if(emote_info.tags.indexOf(tag_set[ts_i]) > -1) {
                        any = true;
                        break;
                    }
                }
                if(!any) {
                    continue no_match;
                }
            }

            results.push(emote_info);
        }
        results.sort();

        // We go through all of the results regardless of search limit (as that
        // doesn't take very long), but stop building HTML when we reach enough
        // shown emotes.
        //
        // As a result, NSFW/disabled emotes don't count toward the result.
        var html = "";
        var shown = 0, hidden = 0;
        for(var i = 0; i < results.length; i++) {
            var emote_info = results[i];

            // if((blacklisted) && !whitelisted)
            if((!prefs.sr_array[emote_info.source_id] || (emote_info.is_nsfw && !prefs.prefs.enableNSFW) ||
                prefs.de_map[emote_info.name] ||
                (prefs.prefs.maxEmoteSize &&  emote_info.max_size > prefs.prefs.maxEmoteSize)) &&
               !prefs.we_map[emote_info.name]) {
                // TODO: enable it anyway if a pref is set? Dunno what exactly
                // we'd do
                hidden += 1;
                continue;
            }

            if(shown >= prefs.prefs.searchLimit) {
                continue;
            } else {
                shown += 1;
            }

            // Use <span> so there's no chance of emote parse code finding
            // this.
            html += "<span data-emote=\"" + emote_info.name + "\" class=\"bpm-result " +
                    emote_info.css_class + "\" title=\"" + emote_info.name + " from " + emote_info.source_name + "\"></span>";
        }

        this.results.innerHTML = html;

        var hit_limit = shown + hidden < results.length;
        // Format text: "X results (out of N, Y hidden)"
        var text = shown + " results";
        if(hit_limit || hidden) { text += " ("; }
        if(hit_limit)           { text += "out of " + results.length; }
        if(hit_limit && hidden) { text += ", "; }
        if(hidden)              { text += hidden + " hidden"; }
        if(hit_limit || hidden) { text += ")"; }
        this.count.textContent = text;
    },

    /*
     * Injects an emote into the (previously) focused element.
     */
    insert_emote: function(emote_name) {
        if(this.target_frame !== null) {
            bpm_utils.message_iframe(this.target_frame, {
                "__betterponymotes_method": "__bpm_inject_emote",
                "__betterponymotes_emote": emote_name
            });

            return;
        } else if(this.target_form === null) {
            return;
        }

        var start = this.target_form.selectionStart;
        var end = this.target_form.selectionEnd;
        if(start !== undefined && end !== undefined) {
            var emote_len;
            if(start !== end) {
                // Make selections into alt-text.
                // "[](" + ' "' + '")'
                emote_len = 7 + emote_name.length + (end - start);
                this.target_form.value = (
                    this.target_form.value.slice(0, start) +
                    "[](" + emote_name + " \"" +
                    this.target_form.value.slice(start, end) + "\")" +
                    this.target_form.value.slice(end));
            } else {
                // "[](" + ")"
                emote_len = 4 + emote_name.length;
                this.target_form.value = (
                    this.target_form.value.slice(0, start) +
                    "[](" + emote_name + ")" +
                    this.target_form.value.slice(end));
            }
            this.target_form.selectionStart = end + emote_len;
            this.target_form.selectionEnd = end + emote_len;

            // Trigger preview update in RES, which *specifically* listens for keyup.
            var event = document.createEvent("Event");
            event.initEvent("keyup", true, true);
            this.target_form.dispatchEvent(event);
        }
    },

    /*
     * Injects the "emotes" button onto Reddit.
     */
    inject_search_button: function(prefs, spans) {
        for(var i = 0; i < spans.length; i++) {
            // Matching the "formatting help" button is tricky- there's no great
            // way to find it. This seems to work, but I expect false positives from
            // reading the Reddit source code.
            if(spans[i].className.indexOf("help-toggle") > -1) {
                var existing = spans[i].getElementsByClassName("bpm-search-toggle");
                /*
                 * Reddit's JS uses cloneNode() when making reply forms. As such,
                 * we need to be able to handle two distinct cases- wiring up the
                 * top-level reply box that's there from the start, and wiring up
                 * clones of that form with our button already in it.
                 */
                if(existing.length) {
                    this.wire_emotes_button(prefs, existing[0]);
                } else {
                    var button = document.createElement("button");
                    // Default is "submit", which is not good (saves the comment).
                    // Safari has some extremely weird bug where button.type
                    // seems to be readonly. Writes fail silently.
                    button.setAttribute("type", "button");
                    button.className = "bpm-search-toggle";
                    button.textContent = "emotes";
                    // Since we come before the save button in the DOM, we tab
                    // first, but this is generally annoying. Correcting this
                    // ideally would require either moving, or editing the save
                    // button, which I'd rather not do.
                    //
                    // So instead it's just untabbable.
                    button.tabIndex = 100;
                    this.wire_emotes_button(prefs, button);
                    // Put it at the end- Reddit's JS uses get(0) when looking for
                    // elements related to the "formatting help" linky, and we don't
                    // want to get in the way of that.
                    spans[i].appendChild(button);
                }
            }
        }
    },

    /*
     * Sets up the global ">>" emotes icon.
     */
    setup_global_icon: function(prefs) {
        this.global_icon.addEventListener("mouseover", bpm_utils.catch_errors(function(event) {
            this.grab_target_form();
        }.bind(this)), false);

        // Enable dragging the global button around
        var global_icon_x, global_icon_y;
        bpm_utils.enable_drag(this.global_icon, function(event) {
            global_icon_x = parseInt(this.global_icon.style.left, 10);
            global_icon_y = parseInt(this.global_icon.style.top, 10);
        }.bind(this), function(event, start_x, start_y, x, y) {
            if(!event.ctrlKey && !event.metaKey) {
                return;
            }

            // Don't permit it to move out the left/top side of the window
            var gi_left = Math.max(x - start_x + global_icon_x, 0);
            var gi_top = Math.max(y - start_y + global_icon_y, 0);

            this.global_icon.style.left = gi_left + "px";
            this.global_icon.style.top = gi_top + "px";

            prefs.prefs.globalIconPos[0] = gi_left;
            prefs.prefs.globalIconPos[1] = gi_top;
            bpm_prefs.sync_key("globalIconPos"); // FIXME yet again
        }.bind(this));

        this.global_icon.style.visibility = "visible";

        this.global_icon.addEventListener("click", bpm_utils.catch_errors(function(event) {
            // Don't open at the end of a drag (only works if you release the
            // mouse button before the ctrl/meta key though...)
            if(!event.ctrlKey && !event.metaKey) {
                this.show(prefs);
            }
        }.bind(this)), false);
    },

    /*
     * Sets up one particular "emotes" button.
     */
    wire_emotes_button: function(prefs, button) {
        button.addEventListener("mouseover", bpm_utils.catch_errors(function(event) {
            this.grab_target_form();
        }.bind(this)), false);

        button.addEventListener("click", bpm_utils.catch_errors(function(event) {
            var sb_element = document.getElementById("bpm-search-box");
            if(sb_element.style.visibility !== "visible") {
                this.show(prefs);
            } else {
                this.hide();
            }
        }.bind(this)), false);
    }
};

/*
 * Global emote conversion.
 */
var bpm_global = {
    // As a note, this regexp is a little forgiving in some respects and strict in
    // others. It will not permit text in the [] portion, but alt-text quotes don't
    // have to match each other.
    //
    //                   <   emote      >   <    alt-text     >
    emote_regexp: /\[\]\((\/[\w:!#\/\-]+)\s*(?:["']([^"]*)["'])?\)/g,

    tag_blacklist: {
        // Meta tags that we should never touch
        "HTML": 1, "HEAD": 1, "TITLE": 1, "BASE": 1, "LINK": 1, "META": 1, "STYLE": 1, "SCRIPT": 1,
        // Some random things I'm a little worried about
        "SVG": 1, "MATH": 1
    },

    /*
     * Searches elements recursively for [](/emotes), and converts them.
     */
    process: function(prefs, root) {
        // Opera does not seem to expose NodeFilter to content scripts, so we
        // cannot specify NodeFilter.SHOW_TEXT. Its value is defined to be 4 in the
        // DOM spec, though, so that works.
        //
        // Opera also throws an error if we do not specify all four arguments,
        // though Firefox and Chrome will accept just the first two.
        var walker = document.createTreeWalker(root, /*NodeFilter.SHOW_TEXT*/ 4, undefined, undefined);
        var node;
        // TreeWalker's seem to stop returning nodes if you delete a node while
        // iterating over it.
        var deletion_list = [];

        while((node = walker.nextNode()) !== null) {
            var parent = node.parentNode;

            if(!this.tag_blacklist[parent.tagName]) {
                this.emote_regexp.lastIndex = 0;

                var new_elements = [];
                var end_of_prev = 0; // End index of previous emote match
                var match;

                while((match = this.emote_regexp.exec(node.data)) !== null) {
                    // Don't normalize case for emote lookup
                    var parts = match[1].split("-");
                    var emote_name = parts[0];
                    var emote_info = bpm_data.lookup_emote(emote_name, prefs.custom_emotes);

                    if(emote_info === null) {
                        continue;
                    }
                    var sr_enabled = (emote_info.source_id !== null ? prefs.sr_array[emote_info.source_id] : true);
                    var emote_size = emote_info.max_size || 0;

                    // Check that it hasn't been disabled somehow
                    if(!prefs.we_map[emote_name] &&
                        (!sr_enabled || prefs.de_map[emote_name] ||
                         (emote_info.is_nsfw && !prefs.prefs.enableNSFW) ||
                         (prefs.prefs.maxEmoteSize && emote_size > prefs.prefs.maxEmoteSize))) {
                        continue;
                    }

                    // Keep text between the last emote and this one (or the start
                    // of the text element)
                    var before_text = node.data.slice(end_of_prev, match.index);
                    if(before_text) {
                        new_elements.push(document.createTextNode(before_text));
                    }

                    // Build emote. (Global emotes are always -in)
                    var element = document.createElement("span");
                    element.className = "bpflag-in " + emote_info.css_class;

                    // Don't need to do validation on flags, since our matching
                    // regexp is strict enough to begin with (although it will
                    // match ":", something we don't permit elsewhere).
                    for(var p = 1; p < parts.length; p++) {
                        var flag = parts[p].toLowerCase();
                        element.className += " bpflag-" + bpm_utils.sanitize(flag);
                    }

                    if(match[2] !== undefined) {
                        // Alt-text. (Quotes aren't captured by the regexp)
                        element.title = match[2];
                    }
                    new_elements.push(element);

                    // Next text element will start after this emote
                    end_of_prev = match.index + match[0].length;
                }

                // If length == 0, then there were no emote matches to begin with,
                // and we should just leave it alone
                if(new_elements.length) {
                    // There were emotes, so grab the last bit of text at the end
                    var before_text = node.data.slice(end_of_prev);
                    if(before_text) {
                        new_elements.push(document.createTextNode(before_text));
                    }

                    // Insert all our new nodes
                    for(var i = 0; i < new_elements.length; i++) {
                        parent.insertBefore(new_elements[i], node);
                    }

                    // Remove original text node
                    deletion_list.push(node);
                }
            }
        }

        for(var i = 0; i < deletion_list.length; i++) {
            var node = deletion_list[i];
            node.parentNode.removeChild(node);
        }
    },

    /*
     * Main function when running globally.
     */
    run: function(prefs) {
        if(!prefs.prefs.enableGlobalEmotes) {
            return;
        }

        // We run this here, instead of down in the main bit, to avoid applying large
        // chunks of CSS when this script is disabled.
        bpm_core.init_css();

        if(prefs.prefs.enableGlobalSearch) {
            // Never inject the search box into frames. Too many sites fuck up
            // entirely if we do. Instead, we do some cross-frame communication.
            if(bpm_utils.is_frame()) {
                bpm_search.init_frame(prefs);
            } else {
                bpm_search.init(prefs);
                bpm_search.setup_global_icon(prefs);
            }
        }

        this.process(prefs, document.body);

        bpm_utils.observe(function() {
            return new bpm_utils.MutationObserver(bpm_utils.catch_errors(function(mutations, observer) {
                for(var m = 0; m < mutations.length; m++) {
                    var added = mutations[m].addedNodes;
                    if(added === null || !added.length) {
                        continue; // Nothing to do
                    }

                    for(var a = 0; a < added.length; a++) {
                        // Check that the "node" is actually the kind of node
                        // we're interested in (as opposed to Text nodes for
                        // one thing)
                        this.process(prefs, added[a]);
                    }
                }
            }.bind(this)));
        }.bind(this), function(observer) {
            observer.observe(document, {"childList": true, "subtree": true});
        }, function() {
            document.body.addEventListener("DOMNodeInserted", bpm_utils.catch_errors(function(event) {
                var element = event.target;
                this.process(prefs, element);
            }.bind(this)), false);
        }.bind(this));
    }
};

/*
 * main() and such.
 */
var bpm_core = {
    /*
     * Attaches all of our CSS.
     */
    init_css: function() {
        bpm_browser.link_css("/bpmotes.css");
        bpm_browser.link_css("/emote-classes.css");

        bpm_prefs.when_available(function(prefs) {
            if(prefs.prefs.enableExtraCSS) {
                // TODO: The only reason we still keep extracss separate is because
                // we don't have a flag_map for it yet. Maybe this works better,
                // though- this file tends to take a surprisingly long time to add...
                if(bpm_utils.platform === "opera-ext" && bpm_browser._is_opera_next) {
                    bpm_browser.link_css("/extracss-next.css");
                } else {
                    bpm_browser.link_css("/extracss.css");
                }
            }

            if(prefs.prefs.enableNSFW) {
                bpm_browser.link_css("/combiners-nsfw.css");
            }
        }.bind(this));
    },

    /*
     * Main function when running on Reddit.
     */
    run: function(prefs) {
        // Inject our filter SVG for Firefox. Chrome renders this thing as a
        // massive box, but "display: none" (or putting it in <head>) makes
        // Firefox hide all of the emotes we apply the filter to- as if *they*
        // had display:none. Furthermore, "height:0;width:0" isn't quite enough
        // either, as margins or something make the body move down a fair bit
        // (leaving a white gap). "position:fixed" is a workaround for that.
        //
        // We also can't include either the SVG or the CSS as a normal resource
        // because Firefox throws security errors. No idea why.
        //
        // Can't do this before the DOM is built, because we use document.body
        // by necessity.
        //
        // Christ. I hope people use the fuck out of -i after this nonsense.
        if(bpm_utils.platform === "firefox-ext") { // TODO: detect userscript on Firefox
            var svg_src = [
                '<svg version="1.1" baseProfile="full" xmlns="http://www.w3.org/2000/svg"',
                ' style="height: 0; width: 0; position: fixed">',
                '  <filter id="bpm-invert">',
                '    <feColorMatrix in="SourceGraphic" type="hueRotate" values="180"/>',
                '  </filter>',
                '</svg>'
            ].join("\n");
            var div = document.createElement("div");
            div.innerHTML = svg_src;
            document.body.insertBefore(div.firstChild, document.body.firstChild);

            bpm_browser.add_css(".bpflag-i { filter: url(#bpm-invert); }");
        }

        // Initial pass- show all emotes currently on the page.
        var posts = document.getElementsByClassName("md");
        bpm_converter.process_posts(prefs, posts);

        bpm_search.init(prefs);
        // Find the one reply box that's there on page load. This may not always work...
        bpm_search.inject_search_button(prefs, document.getElementsByClassName("help-toggle"));

        // Add emote click blocker
        document.body.addEventListener("click", bpm_utils.catch_errors(function(event) {
            if(bpm_utils.has_class(event.target, "bpm-emote")) {
                event.preventDefault();
            }
        }.bind(this)), false);

        if(bpm_utils.platform === "chrome-ext") {
            // Fix for Chrome, which sometimes doesn't rerender unknown
            // emote elements. The result is that until the element is
            // "nudged" in some way- merely viewing it in the Console/platform
            // Elements tabs will do- it won't display.
            //
            // RES seems to reliably set things off, but that won't
            // always be installed. Perhaps some day we'll trigger it
            // implicitly through other means and be able to get rid of
            // this, but for now it seems not to matter.
            var tag = document.createElement("style");
            tag.type = "text/css";
            document.head.appendChild(tag);
        }

        // As a relevant note, it's a terrible idea to set this up before
        // the DOM is built, because monitoring it for changes seems to slow
        // the process down horribly.

        // What we do here: for each mutation, inspect every .md we can
        // find- whether the node in question is deep within one, or contains
        // some.
        bpm_utils.observe(function() {
            return new bpm_utils.MutationObserver(bpm_utils.catch_errors(function(mutations, observer) {
                for(var m = 0; m < mutations.length; m++) {
                    var added = mutations[m].addedNodes;
                    if(added === null || !added.length) {
                        continue; // Nothing to do
                    }

                    for(var a = 0; a < added.length; a++) {
                        // Check that the "node" is actually the kind of node
                        // we're interested in (as opposed to Text nodes for
                        // one thing)
                        var root = added[a];
                        if(root.getElementsByTagName === undefined) {
                            continue;
                        }

                        if(bpm_utils.class_above(root, "md")) {
                            // Inside of a formatted text block, take all the
                            // links we can find
                            bpm_converter.process_posts(prefs, [root]);
                        } else {
                            // Outside of formatted text, try to find some
                            // underneath us
                            var posts = root.getElementsByClassName("md");
                            bpm_converter.process_posts(prefs, posts);
                        }

                        var spans = root.getElementsByTagName("span");
                        bpm_search.inject_search_button(prefs, spans);
                    }
                }
            }.bind(this)));
        }.bind(this), function(observer) {
            // FIXME: For some reason observe(document.body, [...]) doesn't work
            // on Firefox. It just throws an exception. document works.
            observer.observe(document, {"childList": true, "subtree": true});
        }, function() {
            // MutationObserver doesn't exist outisde Fx/Chrome, so
            // fallback to basic DOM events.
            document.body.addEventListener("DOMNodeInserted", bpm_utils.catch_errors(function(event) {
                var root = event.target;

                if(root.getElementsByTagName) {
                    if(bpm_utils.class_above(root, "md")) {
                        bpm_converter.process_posts(prefs, [root]);
                    } else {
                        var posts = root.getElementsByClassName("md");
                        bpm_converter.process_posts(prefs, posts);
                    }

                    bpm_search.inject_search_button(prefs, root.getElementsByClassName("help-toggle"));
                }
            }.bind(this)), false);
        }.bind(this));
    },

    /*
     * Manages communication with our options page on platforms that work this
     * way (userscripts).
     */
    setup_options_link: function() {
        function _check(prefs) {
            var tag = document.getElementById("ready");
            var ready = tag.textContent.trim();

            if(ready === "true") {
                window.postMessage({
                    "__betterponymotes_target": "__bpm_options_page",
                    "__betterponymotes_method": "__bpm_prefs",
                    "__betterponymotes_prefs": bpm_prefs.prefs
                }, BPM_RESOURCE_PREFIX);
                return true;
            } else {
                return false;
            }
        }

        // Impose a limit, in case something is broken.
        var checks = 0;
        function recheck(prefs) {
            if(checks < 10) {
                checks++;
                if(!_check(prefs)) {
                    window.setTimeout(bpm_utils.catch_errors(function() {
                        recheck();
                    }), 200);
                }
            } else {
                bpm_log("BPM: ERROR: options page is unavailable after 2 seconds. Assuming broken.");
                // TODO: put some kind of obvious error <div> on the page or
                // something
            }
        }

        // Listen for messages that interest us
        window.addEventListener("message", bpm_utils.catch_errors(function(event) {
            var message = event.data;
            // Verify source and intended target (we receive our own messages,
            // and don't want to get anything from rogue frames).
            if(event.origin !== BPM_RESOURCE_PREFIX || event.source !== window ||
               message.__betterponymotes_target !== "__bpm_extension") {
                return;
            }

            switch(message.__betterponymotes_method) {
                case "__bpm_set_pref":
                    var key = message.__betterponymotes_pref;
                    var value = message.__betterponymotes_value;

                    if(bpm_prefs.prefs[key] !== undefined) {
                        bpm_prefs.prefs[key] = value;
                        bpm_prefs.sync_key(key);
                    } else {
                        bpm_log("BPM: ERROR: Invalid pref write from options page: '" + key + "'");
                    }
                    break;

                default:
                    bpm_log("BPM: ERROR: Unknown request from options page: '" + message.__betterponymotes_method + "'");
                    break;
            }
        }.bind(this)), false);

        bpm_utils.with_dom(function() {
            bpm_prefs.when_available(function(prefs) {
                // Wait for options.js to be ready (checking every 200ms), then
                // send it down.
                recheck();
            });
        });
    },

    /*
     * main()
     */
    main: function() {
        bpm_browser.request_prefs();
        bpm_browser.request_custom_css();

        if(document.location.href === BPM_OPTIONS_PAGE) {
            this.setup_options_link();
        }

        if(bpm_utils.ends_with(document.location.hostname, "reddit.com")) {
            // Most environments permit us to create <link> tags before
            // DOMContentLoaded (though Chrome forces us to use documentElement).
            // Scriptish is one that does not- there's no clear way to
            // manipulate the partial DOM, so we delay.
            var init_later = false;
            if(bpm_browser.css_parent()) {
                this.init_css();
            } else {
                init_later = true;
            }

            // This script is generally run before the DOM is built. Opera may break
            // that rule, but I don't know how and there's nothing we can do anyway.
            bpm_utils.with_dom(function() {
                if(init_later) {
                    this.init_css();
                }

                bpm_prefs.when_available(function(prefs) {
                    this.run(prefs);
                }.bind(this));
            }.bind(this));
        } else {
            bpm_utils.with_dom(function() {
                bpm_prefs.when_available(function(prefs) {
                    bpm_global.run(prefs);
                }.bind(this));
            }.bind(this));
        }
    }
};

bpm_core.main();

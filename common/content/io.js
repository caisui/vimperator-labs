// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Some code based on Venkman
//
// This work is licensed for reuse under an MIT license. Details are
// given in the License.txt file included with this file.
"use strict";


/** @scope modules */

const VERSION = Services.appinfo.platformVersion;

plugins.contexts = {};
const Script = Class("Script", {
    init: function (file) {
        let self = plugins.contexts[file.path];
        if (self) {
            if (self.onUnload)
                self.onUnload();
            return self;
        }
        plugins.contexts[file.path] = this;
        this.NAME = file.leafName.replace(/\..*/, "").replace(/-([a-z])/g, (m, n1) => n1.toUpperCase());
        this.PATH = file.path;
        this.toString = this.toString;
        this.__context__ = this;
        this.__proto__ = plugins;

        // This belongs elsewhere
        for (let dir of io.getRuntimeDirectories("plugin")) {
            if (dir.contains(file, false))
                plugins[this.NAME] = this;
        }
        return this;
    }
});

/**
 * @class File A class to wrap nsIFile objects and simplify operations
 * thereon.
 *
 * @param {nsIFile|string} path Expanded according to {@link IO#expandPath}
 * @param {boolean} checkPWD Whether to allow expansion relative to the
 *          current directory. @default true
 */
const File = Class("File", {
    init: function (path, checkPWD) {
        if (arguments.length < 2)
            checkPWD = true;

        let file = services.create("file");

        if (path instanceof Ci.nsIFile)
            file = path;
        else if (/file:\/\//.test(path))
            file = services.create("file:").getFileFromURLSpec(path);
        else {
            let expandedPath = File.expandPath(path);

            if (!File.isAbsolutePath(expandedPath) && checkPWD)
                file = File.joinPaths(io.getCurrentDirectory().path, expandedPath);
            else
                file.initWithPath(expandedPath);
        }
        let self = XPCNativeWrapper(file);
        self.__proto__ = File.prototype;
        return self;
    },

    /**
     * Iterates over the objects in this directory.
     */
    iterDirectory: function* () {
        if (!this.isDirectory())
            throw Error("Not a directory");
        let entries = this.directoryEntries;
        while (entries.hasMoreElements())
            yield File(entries.getNext().QueryInterface(Ci.nsIFile));
    },
    /**
     * Returns the list of files in this directory.
     *
     * @param {boolean} sort Whether to sort the returned directory
     *     entries.
     * @returns {nsIFile[]}
     */
    readDirectory: function (sort) {
        if (!this.isDirectory())
            throw Error("Not a directory");

        let array = Array.from(this.iterDirectory());
        if (sort)
            array.sort((a, b) => b.isDirectory() - a.isDirectory() ||  String(a.path).localeCompare(b.path));
        return array;
    },

    /**
     * Reads this file's entire contents in "text" mode and returns the
     * content as a string.
     *
     * @param {string} encoding The encoding from which to decode the file.
     *          @default options["fileencoding"]
     * @returns {string}
     */
    read: function (encoding) {
        let ifstream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
        let icstream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);

        if (!encoding)
            encoding = options.fileencoding;

        ifstream.init(this, -1, 0, 0);
        icstream.init(ifstream, encoding, 4096, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER); // 4096 bytes buffering

        let buffer = [];
        let str = {};
        while (icstream.readString(4096, str) != 0)
            buffer.push(str.value);

        icstream.close();
        ifstream.close();
        return buffer.join("");
    },

    /**
     * Writes the string <b>buf</b> to this file.
     *
     * @param {string} buf The file content.
     * @param {string|number} mode The file access mode, a bitwise OR of
     *     the following flags:
     *       {@link #MODE_RDONLY}:   0x01
     *       {@link #MODE_WRONLY}:   0x02
     *       {@link #MODE_RDWR}:     0x04
     *       {@link #MODE_CREATE}:   0x08
     *       {@link #MODE_APPEND}:   0x10
     *       {@link #MODE_TRUNCATE}: 0x20
     *       {@link #MODE_SYNC}:     0x40
     *     Alternatively, the following abbreviations may be used:
     *       ">"  is equivalent to {@link #MODE_WRONLY} | {@link #MODE_CREATE} | {@link #MODE_TRUNCATE}
     *       ">>" is equivalent to {@link #MODE_WRONLY} | {@link #MODE_CREATE} | {@link #MODE_APPEND}
     * @default ">"
     * @param {number} perms The file mode bits of the created file. This
     *     is only used when creating a new file and does not change
     *     permissions if the file exists.
     * @default 0644
     * @param {string} encoding The encoding to used to write the file.
     * @default options["fileencoding"]
     */
    write: function (buf, mode, perms, encoding) {
        let ofstream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
        function getStream(defaultChar) {
            let stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
            stream.init(ofstream, encoding, 0, defaultChar);
            return stream;
        }

        if (!encoding)
            encoding = options.fileencoding;

        if (mode == ">>")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_APPEND;
        else if (!mode || mode == ">")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_TRUNCATE;

        if (!perms)
            perms = 0o644;

        ofstream.init(this, mode, perms, 0);
        let ocstream = getStream(0);
        try {
            ocstream.writeString(buf);
        }
        catch (e) {
            // liberator.log(e);
            if (e.result == Cr.NS_ERROR_LOSS_OF_SIGNIFICANT_DATA) {
                ocstream = getStream("?".charCodeAt(0));
                ocstream.writeString(buf);
                return false;
            }
            else
                throw e;
        }
        finally {
            try {
                ocstream.close();
            }
            catch (e) {}
            ofstream.close();
        }
        return true;
    }
}, {
    /**
     * @property {number} Open for reading only.
     * @final
     */
    MODE_RDONLY: 0x01,

    /**
     * @property {number} Open for writing only.
     * @final
     */
    MODE_WRONLY: 0x02,

    /**
     * @property {number} Open for reading and writing.
     * @final
     */
    MODE_RDWR: 0x04,

    /**
     * @property {number} If the file does not exist, the file is created.
     *     If the file exists, this flag has no effect.
     * @final
     */
    MODE_CREATE: 0x08,

    /**
     * @property {number} The file pointer is set to the end of the file
     *     prior to each write.
     * @final
     */
    MODE_APPEND: 0x10,

    /**
     * @property {number} If the file exists, its length is truncated to 0.
     * @final
     */
    MODE_TRUNCATE: 0x20,

    /**
     * @property {number} If set, each write will wait for both the file
     *     data and file status to be physically updated.
     * @final
     */
    MODE_SYNC: 0x40,

    /**
     * @property {number} With MODE_CREATE, if the file does not exist, the
     *     file is created. If the file already exists, no action and NULL
     *     is returned.
     * @final
     */
    MODE_EXCL: 0x80,

    expandPathList(list) { return list.split(",").map(this.expandPath).join(","); },

    expandPath: function (path, relative) {

        // expand any $ENV vars - this is naive but so is Vim and we like to be compatible
        // TODO: Vim does not expand variables set to an empty string (and documents it).
        // Kris reckons we shouldn't replicate this 'bug'. --djk
        // TODO: should we be doing this for all paths?
        function expand(path) { return path.replace(
            !liberator.has("Windows") ? /\$(\w+)\b|\${(\w+)}/g
                                 : /\$(\w+)\b|\${(\w+)}|%(\w+)%/g,
            (m, n1, n2, n3) => services.get("environment").get(n1 || n2 || n3) || m
        );
        }
        path = expand(path);

        // expand ~
        // Yuck.
        if (!relative && RegExp("~(?:$|[/" + util.escapeRegex(IO.PATH_SEP) + "])").test(path)) {
            // Try $HOME first, on all systems
            let home = services.get("environment").get("HOME");

            // Windows has its own idiosyncratic $HOME variables.
            if (!home && liberator.has("Windows"))
                home = services.get("environment").get("USERPROFILE") ||
                       services.get("environment").get("HOMEDRIVE") + services.get("environment").get("HOMEPATH");

            path = home + path.substr(1);
        }

        // TODO: Vim expands paths twice, once before checking for ~, once
        // after, but doesn't document it. Is this just a bug? --Kris
        path = expand(path);
        return path.replace(/\//g, IO.PATH_SEP);
    },

    getPathsFromPathList: function (list) {
        if (!list)
            return [];
        // empty list item means the current directory
        return list.replace(/,$/, "").split(",")
                   .map(dir => dir == "" ? io.getCurrentDirectory().path : dir);
    },

    replacePathSep: path => path.replace("/", IO.PATH_SEP, "g"),

    joinPaths: function (head, tail) {
        let path = this(head);
        try {
            path.appendRelativePath(this.expandPath(tail, true)); // FIXME: should only expand env vars and normalise path separators
            // TODO: This code breaks the external editor at least in Ubuntu
            // because /usr/bin/gvim becomes /usr/bin/vim.gnome normalized and for
            // some strange reason it will start without a gui then (which is not
            // optimal if you don't start firefox from a terminal ;)
            // Why do we need this code?
            // if (path.exists() && path.normalize)
            //    path.normalize();
        }
        catch (e) {
            // XXX: __noSuchMethod__ is obsoleted
            return { exists: () => false, __noSuchMethod__: function () { throw e; } };
        }
        return path;
    },

    isAbsolutePath: function (path) {
        try {
            services.create("file").initWithPath(path);
            return true;
        }
        catch (e) {
            return false;
        }
    }
});

class BaseReader {
    constructor() {
        this.open = open;
        this.path = "undefined(string)";
    }
    close() {
        this.open = false;
    }
    *[Symbol.iterator]() {
        throw new Error("iterator not impliment");
    }
    getCommands() {
        const gene = this._getCommands();
        let loop = true;
        return {
            close() {
                loop = false;
            },
            [Symbol.iterator]() {
                return {
                    next() {
                        return loop ? gene.next() : {done:true};
                    }
                }
            }
        };
    }
    *_getCommands() {
        var hereDocEnd = null;
        for(let [i, line] of this) {
            line = line.replace(/\r$/, "");

            if (hereDocEnd) {
                if (line === hereDocEnd) {
                    yield {cmd, count, bang, args};
                    hereDocEnd = null;
                } else {
                    args += line + "\n";
                }
                continue;
            }

            if (/^\s*(".*)?$/.test(line))
                continue;

            var [count, cmd, bang, args] = commands.parseCommand(line);
            var command = cmd = commands.get(cmd);

            if (!command) {
                let lineNumber = i + 1;

                liberator.echoerr("Error detected while processing: " + this.path, commandline.FORCE_MULTILINE);
                commandline.echo("line " + lineNumber + ":", commandline.HL_LINENR, commandline.APPEND_TO_MESSAGES);
                liberator.echoerr("Not an editor command: " + line);
            } else {
                if (command.hereDoc) {
                    var m = args.match(/(.*)<<\s*(\S+)$/);
                    if (m) {
                        args = m[1];
                        hereDocEnd = m[2]
                    }
                }
                if (!hereDocEnd)
                    yield {cmd, count, bang, args};
            }
        }

        if (hereDocEnd) {
            yield {cmd, count, bang, args};
        }
    }
}

class StringReader extends BaseReader {
    constructor(str, path) {
        super();
        this.str = str;
        if (path) this.path = path;
    }
    *[Symbol.iterator]() {
        const re = /(.*)(?:\r\n|[\r\n])/g;
        let num = 1;
        while (this.open) {
            var m = re.exec(this.str);
            if (!m) break;
            yield [num++, m[1]];
        }
    }
    static fromFile(file) {
        var sr = new StringReader(file.read());
        sr.path = file.path;
        return sr;
    }
}
class CommandLineReader extends BaseReader {
    constructor(cmdline) {
        super();
        this.cmdline = cmdline || commandline;
    }
    *[Symbol.iterator]() {
        var value, wait = true;
        let {cmdline} = this;

        let num = 1;
        while (this.open && num < 2**4) {
            wait = true;
            cmdline.input("  ", v => {
                value = v;
                wait = false;
            }, {
                completer: completion.ex,
                onCancel() {
                    value = void 0;
                    wait = false;
                },
            });

            // TODO: use Promise
            var thread = services.get("tm").mainThread;
            while (wait) {
                thread.processNextEvent(true);
            }

            if (value === undefined) {
                this.close();
                break;
            }

            yield [num++, value];
        }
    }
}

// TODO: why are we passing around strings rather than file objects?
/**
 * Provides a basic interface to common system I/O operations.
 * @instance io
 */
const IO = Module("io", {
    requires: ["config", "services"],

    init: function () {
        this._processDir = services.get("dirsvc").get("CurWorkD", Ci.nsIFile);
        this._cwd = this._processDir;
        this._oldcwd = null;

        this._lastRunCommand = ""; // updated whenever the users runs a command with :!
        this._scriptNames = [];

        if (services.get("vc").compare(VERSION, "26.0a1") < 0) {
            this.downloadListener = {
                onDownloadStateChange: function (state, download) {
                    if (download.state == services.get("downloads").DOWNLOAD_FINISHED) {
                        let url   = download.source.spec;
                        let title = download.displayName;
                        let file  = download.targetFile.path;
                        let size  = download.size;

                        liberator.echomsg("Download of " + title + " to " + file + " finished");
                        autocommands.trigger("DownloadPost", { url: url, title: title, file: file, size: size });
                    }
                },
                onStateChange:    function () {},
                onProgressChange: function () {},
                onSecurityChange: function () {}
            };
            services.get("downloads").addListener(this.downloadListener);
        } else {
            let downloadListener = this.downloadListener = {
                onDownloadChanged: function (download) {
                    if (download.succeeded) {
                        let {
                            source: { url },
                            target: {path: file},
                            totalBytes: size,
                        } = download;
                        let title = File(file).leafName;
                        liberator.echomsg("Download of " + title + " to " + file + " finished");
                        autocommands.trigger("DownloadPost", { url: url, title: title, file: file, size: size });
                    }
                },
            };
            let {Downloads} = Cu.import("resource://gre/modules/Downloads.jsm", {});
            Downloads.getList(Downloads.ALL)
                .then(function (downloadList) {
                    downloadList.addView(downloadListener);
                });
        }
    },

    destroy: function () {
        if (services.get("vc").compare(VERSION, "26.0a1") < 0) {
            services.get("downloads").removeListener(this.downloadListener);
        } else {
            let {Downloads} = Cu.import("resource://gre/modules/Downloads.jsm", {});
            let downloadListener = this.downloadListener;
            Downloads.getList(Downloads.ALL)
                .then(function (downloadList) {
                    downloadList.removeView(downloadListener);
                });
        }
        for (let [, plugin] of Iterator(plugins.contexts))
            if (plugin.onUnload)
                plugin.onUnload();
    },

    /**
     * @property {function} File class.
     * @final
     */
    File: File,

    StringReader, CommandLineReader, BaseReader,

    /**
     * @property {Object} The current file sourcing context. As a file is
     *     being sourced the 'file' and 'line' properties of this context
     *     object are updated appropriately.
     */
    sourcing: null,

    /**
     * Expands "~" and environment variables in <b>path</b>.
     *
     * "~" is expanded to to the value of $HOME. On Windows if this is not
     * set then the following are tried in order:
     *   $USERPROFILE
     *   ${HOMDRIVE}$HOMEPATH
     *
     * The variable notation is $VAR (terminated by a non-word character)
     * or ${VAR}. %VAR% is also supported on Windows.
     *
     * @param {string} path The unexpanded path string.
     * @param {boolean} relative Whether the path is relative or absolute.
     * @returns {string}
     */
    expandPath: File.expandPath,

    // TODO: there seems to be no way, short of a new component, to change
    // the process's CWD - see https://bugzilla.mozilla.org/show_bug.cgi?id=280953
    /**
     * Returns the current working directory.
     *
     * It's not possible to change the real CWD of the process so this
     * state is maintained internally. External commands run via
     * {@link #system} are executed in this directory.
     *
     * @returns {nsIFile}
     */
    getCurrentDirectory: function () {
        let dir = File(this._cwd.path);

        // NOTE: the directory could have been deleted underneath us so
        // fallback to the process's CWD
        if (dir.exists() && dir.isDirectory())
            return dir;
        else
            return this._processDir;
    },

    /**
     * Sets the current working directory.
     *
     * @param {string} newDir The new CWD. This may be a relative or
     *     absolute path and is expanded by {@link #expandPath}.
     */
    setCurrentDirectory: function (newDir) {
        newDir = newDir || "~";

        if (newDir == "-") {
            [this._cwd, this._oldcwd] = [this._oldcwd, this.getCurrentDirectory()];
        } else {
            let dir = File(newDir);

            if (!dir.exists() || !dir.isDirectory()) {
                liberator.echoerr("Directory does not exist: " + dir.path);
                return null;
            }

            dir.normalize();
            [this._cwd, this._oldcwd] = [dir, this.getCurrentDirectory()];
        }

        return this.getCurrentDirectory();
    },

    /**
     * Returns all directories named <b>name<b/> in 'runtimepath'.
     *
     * @param {string} name
     * @returns {nsIFile[])
     */
    getRuntimeDirectories: function (name) {
        let dirs = File.getPathsFromPathList(options.runtimepath);

        dirs = dirs.map(dir => File.joinPaths(dir, name))
                   .filter(dir => dir.exists() && dir.isDirectory() && dir.isReadable());
        return dirs;
    },

    /**
     * Returns the first user RC file found in <b>dir</b>.
     *
     * @param {string} dir The directory to search.
     * @param {boolean} always When true, return a path whether
     *     the file exists or not.
     * @default $HOME.
     * @returns {nsIFile} The RC file or null if none is found.
     */
    getRCFile: function (dir, always) {
        dir = dir || "~";

        let rcFile1 = File.joinPaths(dir, "." + config.name.toLowerCase() + "rc");
        let rcFile2 = File.joinPaths(dir, "_" + config.name.toLowerCase() + "rc");

        if (liberator.has("Windows"))
            [rcFile1, rcFile2] = [rcFile2, rcFile1];

        if (rcFile1.exists() && rcFile1.isFile())
            return rcFile1;
        else if (rcFile2.exists() && rcFile2.isFile())
            return rcFile2;
        else if (always)
            return rcFile1;
        return null;
    },

    // TODO: make secure
    /**
     * Creates a temporary file.
     *
     * @returns {File}
     */
    createTempFile: function () {
        let file = services.get("dirsvc").get("TmpD", Ci.nsIFile);

        file.append(config.tempFile);
        file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0o600);

        return File(file);
    },

    /**
     * Runs an external program.
     *
     * @param {string} program The program to run.
     * @param {string[]} args An array of arguments to pass to <b>program</b>.
     * @param {boolean} blocking Whether to wait until the process terminates.
     */
    blockingProcesses: [],
    run: function (program, args, blocking) {
        args = args || [];
        blocking = !!blocking;

        let file;

        if (File.isAbsolutePath(program))
            file = File(program, true);
        else {
            let dirs = services.get("environment").get("PATH").split(liberator.has("Windows") ? ";" : ":");
            // Windows tries the CWD first TODO: desirable?
            if (liberator.has("Windows"))
                dirs = [io.getCurrentDirectory().path].concat(dirs);

lookup:
            for (let dir of dirs) {
                file = File.joinPaths(dir, program);
                try {
                    if (file.exists())
                        break;

                    // TODO: couldn't we just palm this off to the start command?
                    // automatically try to add the executable path extensions on windows
                    if (liberator.has("Windows")) {
                        let extensions = services.get("environment").get("PATHEXT").split(";");
                        for (let extension of extensions) {
                            file = File.joinPaths(dir, program + extension);
                            if (file.exists())
                                break lookup;
                        }
                    }
                }
                catch (e) {}
            }
        }

        if (!file || !file.exists()) {
            liberator.callInMainThread(function() {
                if (services.get("threadManager").isMainThread) // does not really seem to work but at least doesn't crash Firefox
                    liberator.echoerr("Command not found: " + program);
            }, this);
            return -1;
        }

        let process = services.create("process");

        process.init(file);
        process.run(false, args.map(String), args.length);
        try {
            if (blocking)
                while (process.isRunning)
                    liberator.threadYield(false, true);
        }
        catch (e) {
            process.kill();
            throw e;
        }

        return process.exitValue;
    },

    // FIXME: multiple paths?
    /**
     * Sources files found in 'runtimepath'. For each relative path in
     * <b>paths</b> each directory in 'runtimepath' is searched and if a
     * matching file is found it is sourced. Only the first file found (per
     * specified path) is sourced unless <b>all</b> is specified, then
     * all found files are sourced.
     *
     * @param {string[]} paths An array of relative paths to source.
     * @param {boolean} all Whether all found files should be sourced.
     */
    sourceFromRuntimePath: function (paths, all) {
        let dirs = File.getPathsFromPathList(options.runtimepath);
        let found = false;

        liberator.log("Searching for \"" + paths.join(" ") + "\" in \"" + options.runtimepath + "\"");

        outer:
        for (let dir of dirs) {
            for (let path of paths) {
                let file = File.joinPaths(dir, path);

                if (file.exists() && file.isFile() && file.isReadable()) {
                    io.source(file.path, false);
                    found = true;

                    if (!all)
                        break outer;
                }
            }
        }

        if (!found)
            liberator.log("not found in 'runtimepath': \"" + paths.join(" ") + "\"");

        return found;
    },

    /**
     * Reads Ex commands, JavaScript or CSS from <b>filename</b>.
     *
     * @param {string} filename The name of the file to source.
     * @param {boolean} silent Whether errors should be reported.
     */
    source: function (filename, silent) {
        let wasSourcing = this.sourcing;
        try {
            var file = File(filename);
            this.sourcing = {
                file: file.path,
                line: 0
            };

            if (!file.exists() || !file.isReadable() || file.isDirectory()) {
                if (!silent) {
                    if (file.exists() && file.isDirectory())
                        liberator.echomsg("Cannot source a directory: " + filename);
                    else
                        liberator.echomsg("Could not source: " + filename);

                    liberator.echoerr("Cannot open file: " + filename);
                }

                return;
            }

            // liberator.echomsg("Sourcing \"" + filename + "\" ...");

            let str = file.read();
            let uri = services.get("io").newFileURI(file);

            // handle pure JavaScript files specially
            if (/\.js$/.test(filename)) {
                try {
                    // Workaround for SubscriptLoader caching.
                    let suffix = '?' + encodeURIComponent(services.get("UUID").generateUUID().toString());
                    liberator.loadScript(uri.spec + suffix, Script(file));
                    if (liberator.initialized)
                        liberator.initHelp();
                }
                catch (e) {
                    let err = new Error();
                    for (let [k, v] of Iterator(e))
                        err[k] = v;
                    err.echoerr = xml`${file.path}:${e.lineNumber}: ${e}`;
                    throw err;
                }
            }
            else if (/\.css$/.test(filename))
                storage.styles.registerSheet(uri.spec, false, true);
            else {
                let reader = io.StringReader.fromFile(file);
                let ex = {
                    setFrom: file,
                    iter: reader.getCommands(),
                };
                for (let obj of ex.iter) {
                    if (obj.cmd.name === "finish") {
                        ex.iter.close();
                        break;
                    }
                    obj.cmd.execute(obj.args, obj.bang, obj.count, ex);
                }
            }

            if (this._scriptNames.indexOf(file.path) == -1)
                this._scriptNames.push(file.path);

            liberator.log("Sourced: " + filename);
        }
        catch (e) {
            console.error(e);
            liberator.echoerr(e, null, "Sourcing file failed: ");
        }
        finally {
            this.sourcing = wasSourcing;
        }
    },

    // TODO: when https://bugzilla.mozilla.org/show_bug.cgi?id=68702 is
    // fixed use that instead of a tmpfile
    /**
     * Runs <b>command</b> in a subshell and returns the output in a
     * string. The shell used is that specified by the 'shell' option.
     *
     * @param {string} command The command to run.
     * @param {string} input Any input to be provided to the command on stdin.
     * @returns {string}
     */
    system: function (command, input) {
        liberator.echomsg("Executing: " + command);

        function escape(str) { return '"' + str.replace(/[\\"$]/g, "\\$&") + '"'; }

        return this.withTempFiles(function (stdin, stdout, cmd) {
            if (input)
                stdin.write(input);

            // TODO: implement 'shellredir'
            if (liberator.has("Windows")) {
                if (options.shell == "cmd.exe") {
                    command = "cd /D " + this._cwd.path + " && " + command + " > " + stdout.path + " 2>&1" + " < " + stdin.path;
                } else {
                    // in this case, assume the shell is unix-like
                    command = "cd " + escape(this._cwd.path) + " && " + command + " > " + escape(stdout.path) + " 2>&1" + " < " + escape(stdin.path);
                }
                var res = this.run(options.shell, options.shellcmdflag.split(/\s+/).concat(command), true);
            }
            else {
                cmd.write("cd " + escape(this._cwd.path) + "\n" +
                        ["exec", ">" + escape(stdout.path), "2>&1", "<" + escape(stdin.path),
                         escape(options.shell), options.shellcmdflag, escape(command)].join(" "));
                res = this.run("/bin/sh", ["-e", cmd.path], true);
            }

            let output = stdout.read();
            if (res > 0)
                output += "\nshell returned " + res;
            // if there is only one \n at the end, chop it off
            else if (output && output.indexOf("\n") == output.length - 1)
                output = output.substr(0, output.length - 1);

            return output;
        }) || "";
    },

    /**
     * Creates a temporary file context for executing external commands.
     * <b>func</b> is called with a temp file, created with
     * {@link #createTempFile}, for each explicit argument. Ensures that
     * all files are removed when <b>func</b> returns.
     *
     * @param {function} func The function to execute.
     * @param {Object} self The 'this' object used when executing func.
     * @returns {boolean} false if temp files couldn't be created,
     *     otherwise, the return value of <b>func</b>.
     */
    withTempFiles: function (func, self) {
        let args = util.map(util.range(0, func.length), this.createTempFile);
        if (!args.every(util.identity))
            return false;

        try {
            return func.apply(self || this, args);
        }
        finally {
            args.forEach(f => f.remove(false));
        }
    }
}, {
    /**
     * @property {string} The value of the $VIMPERATOR_RUNTIME environment
     *     variable.
     */
    get runtimePath() {
        const rtpvar = config.name.toUpperCase() + "_RUNTIME";
        let rtp = services.get("environment").get(rtpvar);
        if (!rtp) {
            rtp = "~/" + (liberator.has("Windows") ? "" : ".") + config.name.toLowerCase();
            services.get("environment").set(rtpvar, rtp);
        }
        return rtp;
    },

    /**
     * @property {string} The current platform's path separator.
     */
    get PATH_SEP() {
        delete this.PATH_SEP;
        let f = services.get("dirsvc").get("CurProcD", Ci.nsIFile);
        f.append("foo");
        return this.PATH_SEP = f.path.substr(f.parent.path.length, 1);
    }
}, {
    commands: function () {
        commands.add(["cd", "chd[ir]"],
            "Change the current directory",
            function (args) {
                let arg = args.literalArg;

                if (!arg) {
                    arg = "~";
                } else if (arg == "-") {
                    liberator.assert(io._oldcwd, "No previous directory");
                    arg = io._oldcwd.path;
                }

                arg = File.expandPath(arg);

                // go directly to an absolute path or look for a relative path
                // match in 'cdpath'
                if (File.isAbsolutePath(arg)) {
                    if (io.setCurrentDirectory(arg))
                        liberator.echomsg(io.getCurrentDirectory().path);
                } else {
                    let dirs = File.getPathsFromPathList(options.cdpath);
                    let found = false;

                    for (let dir of dirs) {
                        dir = File.joinPaths(dir, arg);

                        if (dir.exists() && dir.isDirectory() && dir.isReadable()) {
                            io.setCurrentDirectory(dir.path);
                            liberator.echomsg(io.getCurrentDirectory().path);
                            found = true;
                            break;
                        }
                    }

                    if (!found)
                        liberator.echoerr("Can't find directory " + JSON.stringify(arg) + " in cdpath\n" + "Command failed");
                }
            }, {
                argCount: "?",
                completer: context => completion.directory(context, true),
                literal: 0
            });

        // NOTE: this command is only used in :source
        commands.add(["fini[sh]"],
            "Stop sourcing a script file",
            function () { liberator.echoerr(":finish used outside of a sourced file"); },
            { argCount: "0" });

        commands.add(["pw[d]"],
            "Print the current directory name",
            function () { liberator.echomsg(io.getCurrentDirectory().path); },
            { argCount: "0" });

        // "mkv[imperatorrc]" or "mkm[uttatorrc]"
        commands.add([config.name.toLowerCase().replace(/(.)(.*)/, "mk$1[$2rc]")],
            "Write current key mappings and changed options to the config file",
            function (args) {
                liberator.assert(args.length <= 1, "Only one file name allowed");

                let filename = args[0] || io.getRCFile(null, true).path;
                let file = File(filename);

                liberator.assert(!file.exists() || args.bang,
                    "File exists: " + filename + ". Add ! to override.");

                let lines = Array.from(iter(commands))
                                 .filter(cmd => cmd.serial)
                                 .map(cmd => cmd.serial().map(commands.commandToString));
                lines = util.Array.flatten(lines);

                // source a user .vimperatorrc file
                lines.unshift('"' + liberator.version + "\n");

                // For the record, I think that adding this line is absurd. --Kris
                // I can't disagree. --djk
                lines.push(commands.commandToString({
                    command: "source",
                    bang: true,
                    arguments: [filename + ".local"]
                }));

                lines.push("\n\" vim: set ft=" + config.name.toLowerCase() + ":");

                try {
                    file.write(lines.join("\n"));
                }
                catch (e) {
                    liberator.echoerr("Could not write to " + file.path + ": " + e.message);
                }
            }, {
                argCount: "*", // FIXME: should be "?" but kludged for proper error message
                bang: true,
                completer: context => completion.file(context, true)
            });

        commands.add(["runt[ime]"],
            "Source the specified file from each directory in 'runtimepath'",
            function (args) { io.sourceFromRuntimePath(args, args.bang); }, {
                argCount: "+",
                bang: true
            }
        );

        commands.add(["scrip[tnames]"],
            "List all sourced script names",
            function () {
                let list = template.tabular([{ header: "<SNR>", style: "text-align: right; padding-right: 1em;" }, "Filename"],
                    iter(io._scriptNames.map((file, i) => [i + 1, file])));

                commandline.echo(list, commandline.HL_NORMAL, commandline.FORCE_MULTILINE);
            },
            { argCount: "0" });

        commands.add(["so[urce]"],
            "Read Ex commands from a file",
            function (args) {
                io.source(args.literalArg, args.bang);
            }, {
                literal: 0,
                bang: true,
                completer: context => completion.file(context, true)
            });

        commands.add(["!", "run"],
            "Run a command",
            function (args) {
                let arg = args.literalArg;

                // :!! needs to be treated specially as the command parser sets the
                // bang flag but removes the ! from arg
                if (args.bang)
                    arg = "!" + arg;

                // replaceable bang and no previous command?
                liberator.assert(!/((^|[^\\])(\\\\)*)!/.test(arg) || io._lastRunCommand, "No previous command");

                // NOTE: Vim doesn't replace ! preceded by 2 or more backslashes and documents it - desirable?
                // pass through a raw bang when escaped or substitute the last command
                arg = arg.replace(/(\\)*!/g,
                    m => /^\\(\\\\)*!$/.test(m) ? m.replace("\\!", "!") : m.replace("!", io._lastRunCommand)
                );

                io._lastRunCommand = arg;

                let output = io.system(arg);

                commandline.command = "!" + arg;
                commandline.echo(template.genericOutput("Command Output: " + arg, xml`<span highlight="CmdOutput">${String(output)}</span>`));

                autocommands.trigger("ShellCmdPost", {});
            }, {
                argCount: "?",
                bang: true,
                completer: context => completion.shellCommand(context),
                literal: 0
            });

        // define if command
        let extra = {
            argCount: 1,
            literal: 0,
            hereDoc: true,
            completer: completion.javascript,
        };
        commands.add(["if"], "if expression", function ifexpression(args, mod) {
            try {
                var ex = Object.create(mod);
                if (!ex.iter) {
                    let o = new io.CommandLineReader;
                    ex.iter = o.getCommands();
                }

                var scope = Object.create(userContext);
                var useElse = false;
                var obj, cmd;

                if (!mod.skip) {
                    var res = liberator.eval(args.string, scope);
                    if (!res) {
                        LOOP: for (let obj of ex.iter) {
                            switch (obj.cmd.name) {
                            case "if":
                                var extra = Object.create(mod);
                                extra.skip = true;
                                ifexpression(obj.args, extra);
                                break;
                            case "elseif":
                                res = liberator.eval(obj.args, scope);
                                if (res) break LOOP;
                                break;
                            case "else":
                                res = true;
                                useElse = true;
                                break LOOP;
                            case "endif":
                                return;
                            }
                        }
                        if (!res) throw Error("E171:");
                    }

                    // execute
                    LOOP: for (let obj of ex.iter) {
                        switch(obj.cmd.name) {
                        //case "if":
                        //    cmd.execute(args, Object.create(mod));
                        //    break;
                        case "elseif":
                            if (useElse) throw Error("E584:");
                            break LOOP;
                        case "else":
                            if (useElse) throw Error("E583:");
                            useElse = true;
                            break LOOP;
                        case "endif":
                            return;
                        case "finish":
                            ex.iter.close();
                            return;
                        default:
                            obj.cmd.execute(obj.args, obj.bang, obj.count, ex);
                            break;
                        }
                    }
                }

                for (let obj of ex.iter) {
                    switch (obj.cmd.name) {
                    case "if":
                        ex.skip = true;
                        obj.cmd.execute(obj.args, obj.bang, obj.count, ex);
                        break;
                    case "elseif":
                        if (useElse) throw Error("E583");
                        break;
                    case "else":
                        if (useElse) throw Error("E583");
                        useElse = true;
                        break;
                    case "endif":
                        return;
                    }
                }
                throw Error("E171:");
            } catch (ex) {
                console.error(ex);
                Cu.reportError(ex);
                liberator.echoerr(ex);
                throw ex;
            }
        }, extra);
        commands.add(["elsei[f]"], "elseif expression",function (args) { throw Error("E581"); }, extra);
        commands.add(["el[se]"],   "else expression",  function (args) { throw Error("E581"); }, { arcCount: 0});
        commands.add(["en[dif]"],  "endif expression", function (args) { throw Error("E580"); }, { arcCount: 0});
    },
    completion: function () {
        JavaScript.setCompleter([this.File, File.expandPath],
            [function (context, obj, args) {
                context.quote[2] = "";
                completion.file(context, true);
            }]);

        completion.charset = function (context) {
            context.anchored = false;
            if (services.get("vc").compare(Application.version, "32") < 0) {
                context.generate = function () {
                    let names = util.Array(
                        "more1 more2 more3 more4 more5 static".split(" ").map(key =>
                            options.getPref("intl.charsetmenu.browser." + key).split(', '))
                    ).flatten().uniq();
                    let bundle = document.getElementById("liberator-charset-bundle");
                    return names.map(name => [name, bundle.getString(name.toLowerCase() + ".title")]);
                };
            }
            else {
                context.generate = function () {
                    let {CharsetMenu} = Cu.import("resource://gre/modules/CharsetMenu.jsm", {});
                    let data = CharsetMenu.getData();
                    return data.pinnedCharsets.concat(data.otherCharsets).map(o => [o.value, o.label]);
                };
            }
        };

        completion.directory = function directory(context, full) {
            this.file(context, full);
            context.filters.push(({ item: f }) => f.isDirectory());
        };

        completion.environment = function environment(context) {
            let command = liberator.has("Windows") ? "set" : "env";
            let lines = io.system(command).split("\n");
            lines.pop();

            context.title = ["Environment Variable", "Value"];
            context.generate = () => lines.map(line => (line.match(/([^=]+)=(.+)/) || []).slice(1));
        };

        // TODO: support file:// and \ or / path separators on both platforms
        // if "tail" is true, only return names without any directory components

        const aFolder = Services.vc.compare(Services.appinfo.version, "53") < 0
            ? "resource://gre/res/html/folder.png"
            : "resource://content-accessible/html/folder.png";
        completion.file = function file(context, full) {
            // dir == "" is expanded inside readDirectory to the current dir
            let [dir] = context.filter.match(/^(?:.*[\/\\])?/);

            if (!full)
                context.advance(dir.length);

            context.title = [full ? "Path" : "Filename", "Type"];
            context.keys = {
                text: !full ? "leafName" : f => dir + f.leafName,
                description: f => f.isDirectory() ? "Directory" : "File",
                isdir: f => f.exists() && f.isDirectory(),
                icon: f => f.isDirectory() ? aFolder : "moz-icon://" + f.leafName
            };
            context.compare = (a, b) =>
                        b.isdir - a.isdir || String(a.text).localeCompare(b.text);

            context.match = function (str) {
                let filter = this.filter;
                if (!filter)
                    return true;

                if (this.ignoreCase) {
                    filter = filter.toLowerCase();
                    str = str.toLowerCase();
                }
                return str.substr(0, filter.length) === filter;
            };

            // context.background = true;
            context.key = dir;
            context.generate = function generate_file() {
                try {
                    return File(dir).readDirectory();
                }
                catch (e) {}
                return [];
            };
        };

        completion.shellCommand = function shellCommand(context) {
            context.title = ["Shell Command", "Path"];
            context.generate = function () {
                let dirNames = services.get("environment").get("PATH").split(RegExp(liberator.has("Windows") ? ";" : ":"));
                let commands = [];

                for (let dirName of dirNames) {
                    let dir = io.File(dirName);
                    if (dir.exists() && dir.isDirectory()) {
                        commands.push(
                            Array.from(dir.iterDirectory())
                                 .filter(file => file.isFile() && file.isExecutable())
                                 .map(file => [file.leafName, dir.path])
                        );
                    }
                }

                return util.Array.flatten(commands);
            };
        };

        completion.addUrlCompleter("f", "Local files", completion.file);
    },
    options: function () {
        var shell, shellcmdflag;
        if (liberator.has("Windows")) {
            shell = "cmd.exe";
            // TODO: setting 'shell' to "something containing sh" updates
            // 'shellcmdflag' appropriately at startup on Windows in Vim
            shellcmdflag = "/c";
        }
        else {
            shell = services.get("environment").get("SHELL") || "sh";
            shellcmdflag = "-c";
        }

        options.add(["fileencoding", "fenc"],
            "Sets the character encoding of read and written files",
            "string", "UTF-8", {
                completer: context => completion.charset(context)
            });
        options.add(["cdpath", "cd"],
            "List of directories searched when executing :cd",
            "stringlist", "," + (services.get("environment").get("CDPATH").replace(/[:;]/g, ",") || ","),
            { setter: value => File.expandPathList(value) });

        options.add(["runtimepath", "rtp"],
            "List of directories searched for runtime files",
            "stringlist", IO.runtimePath,
            { setter: value => File.expandPathList(value) });

        options.add(["shell", "sh"],
            "Shell to use for executing :! and :run commands",
            "string", shell,
            { setter: value => File.expandPath(value) });

        options.add(["shellcmdflag", "shcf"],
            "Flag passed to shell when executing :! and :run commands",
            "string", shellcmdflag);
    }
});

// vim: set fdm=marker sw=4 ts=4 et:

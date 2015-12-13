"use strict";

const fs = require("fs");
const path = require("path");
const nopt = require("nopt");
const aribts = require("aribts");
const syobocal = require("syobocal");
const settings = require("./settings");

class Renamer {
    constructor(options) {
        options = options || {};

        this.options = {
            input: options.input,
            parent: options.parent || path.dirname(options.input),
            dir: options.dir,
            file: options.file,
            check: options.check
        };

        this.output = {
            dir: "",
            file: "",
            path: ""
        };

        this.info = null;
        this.program = null;
        this.macro = null;
    }

    execute() {
        return this.checkInput().then(() => {
            return this.getInfo();
        }).then(() => {
            return this.convertInfo();
        }).then(() => {
            return this.getProgram();
        }).then(() => {
            return this.getMacro();
        }).then(() => {
            return this.setMacro();
        }).then(() => {
            return this.checkDrop();
        }).then(() => {
            return this.makeFolder();
        }).then(() => {
            return this.rename();
        });
    }

    checkInput() {
        console.log("Check Input...");

        return new Promise((resolve, reject) => {
            if (this.options.input === void 0) {
                reject(new Error("Input path"));
            }

            fs.stat(this.options.input, err => {
                if (err) {
                    reject(new Error("Can't find input"));
                    return;
                }

                resolve();
            });
        });
    }

    getInfo() {
        console.log("Get Info...");

        return new Promise((resolve, reject) => {
            var readStream = fs.createReadStream(this.options.input);
            var tsStream = new aribts.TsStream();

            var tsUtil = new aribts.TsUtil();

            var flag = false;
            var packet = 0;
            var time = null;
            var ids = null;

            readStream.pipe(tsStream);

            function close() {
                tsStream.removeAllListeners("pat", "eit", "sdt", "tdt", "tot");
                readStream.unpipe(tsStream);
                tsStream.end();
            }

            tsStream.on("data", () => {
                if (packet++ < 1000000) return;

                reject(new Error("Can't find information in first 1000000 packets"));

                flag = true;
                close();
            });

            tsStream.on("end", () => {
                if (flag) return;

                reject(new Error("Can't find information"));
            });

            tsStream.on("eit", (pid, data) => {
                tsUtil.addEit(pid, data);

                if (time === null) {
                    if (tsUtil.isTime()) {
                        time = tsUtil.getTime();
                    } else {
                        return;
                    }
                }

                if (ids === null) {
                    if (tsUtil.isOriginalNetworkId() && tsUtil.isTransportStreamId() && tsUtil.isServiceIds()) {
                        ids = {
                            onid: tsUtil.getOriginalNetworkId(),
                            tsid: tsUtil.getTransportStreamId(),
                            sid: tsUtil.getServiceIds()[0]
                        };
                    } else {
                        return;
                    }
                }

                if (tsUtil.getTime().getTime() - time.getTime() < 30 * 1000) return;
                if (tsUtil.getTime().getTime() - time.getTime() > 60 * 1000) {
                    reject(new Error("Can't find information in 1 minutes"));

                    flag = true;
                    close();

                    return;
                }

                if (!tsUtil.isPresent(ids.onid, ids.tsid, ids.sid)) return;
                if (!tsUtil.isServices(ids.onid, ids.tsid, ids.sid)) return;

                var present = tsUtil.getPresent(ids.onid, ids.tsid, ids.sid);
                var services = tsUtil.getServices()[ids.sid];

                var objInfo = {};

                objInfo.startTime = present.start_time;
                objInfo.eventName = present.short_event.event_name;
                objInfo.serviceName = services.service.service_name;

                this.info = objInfo;

                resolve();

                flag = true;
                close();
            });

            tsStream.on("pat", (pid, data) => {
                tsUtil.addPat(pid, data);
            });

            tsStream.on("sdt", (pid, data) => {
                tsUtil.addSdt(pid, data);
            });

            tsStream.on("tdt", (pid, data) => {
                tsUtil.addTdt(pid, data);
            });

            tsStream.on("tot", (pid, data) => {
                tsUtil.addTot(pid, data);
            });
        });
    }

    convertInfo() {
        console.log("Convert Info...");

        return new Promise(resolve => {
            var info = this.info;

            // Replace full to half
            info.eventName = Renamer.toHalf(info.eventName);
            info.serviceName = Renamer.toHalf(info.serviceName);

            // Replace brackets
            info.eventName = info.eventName.replace(/\[.+?\]/g, "");
            info.eventName = info.eventName.replace(/【\.+?\】/g, "");
            info.eventName = info.eventName.replace(/<\.+?\>/g, "");

            // Replace others
            settings.replace.forEach(target => {
                info.eventName = info.eventName.split(target.find).join(target.replace);
            });

            // Find service
            settings.service.some(target => {
                if (!info.serviceName.includes(target.serviceName)) return false;

                info.channelUserName = target.channelUserName;
                info.channelId = target.channelId;

                return true;
            });

            resolve();
        });
    }

    getProgram() {
        console.log("Get Program...");

        var info = this.info;
        var syobocalRss2 = new syobocal.Rss2();

        return syobocalRss2.request({
            start: new Date(info.startTime.getTime() - 60 * 60 * 1000),
            end: new Date(info.startTime.getTime() + 60 * 60 * 1000),
            usr: "node_syobocal"
        }).then(programs => {
            return new Promise((resolve, reject) => {
                var filter = programs.filter(program => Renamer.toHalf(program.Title).includes(info.eventName.slice(0, 5)));

                if (info.hasOwnProperty("channelId")) {
                    filter = filter.filter(program => program.ChID === info.channelId);
                }

                if (filter.length === 0) {
                    reject(new Error("Can't find program"));
                    return;
                }

                var selected = filter.reduce((prev, current) => {
                    var prev_diff = Math.abs(info.startTime.getTime() - prev.StTime.getTime());
                    var current_diff = Math.abs(info.startTime.getTime() - current.StTime.getTime());

                    return prev_diff > current_diff ? current : prev;
                });

                var objProgram = {};

                objProgram.title = selected.Title;
                objProgram.shortTitle = selected.ShortTitle;
                objProgram.subTitle = selected.SubTitle;
                objProgram.count = selected.Count;
                objProgram.startTime = selected.StTime;
                objProgram.endTime = selected.EdTime;
                objProgram.channelName = selected.ChName;
                objProgram.channelUserName = info.channelUserName;

                this.program = objProgram;

                resolve();
            });
        });
    }

    getMacro() {
        console.log("Get Macro...");

        return new Promise(resolve => {
            var program = this.program;

            var objMacro = {};

            objMacro.title = program.title;
            objMacro.shortTitle = program.shortTitle || program.title;
            objMacro.subTitle = program.subTitle;

            objMacro.count = program.count === null ? "" : program.count.toString();
            objMacro.count2 = program.count === null ? "" : ("0" + program.count).slice(-2);
            objMacro.count3 = program.count === null ? "" : ("00" + program.count).slice(-3);
            objMacro.count4 = program.count === null ? "" : ("000" + program.count).slice(-4);

            objMacro.YYYY = program.startTime.getFullYear().toString();
            objMacro.YY = program.startTime.getFullYear().toString().slice(-2);
            objMacro.M = (program.startTime.getMonth() + 1).toString();
            objMacro.MM = ("0" + (program.startTime.getMonth() + 1)).slice(-2);
            objMacro.D = program.startTime.getDate().toString();
            objMacro.DD = ("0" + program.startTime.getDate()).slice(-2);
            objMacro.h = program.startTime.getHours().toString();
            objMacro.hh = ("0" + program.startTime.getHours()).slice(-2);
            objMacro.m = program.startTime.getMinutes().toString();
            objMacro.mm = ("0" + program.startTime.getMinutes()).slice(-2);
            objMacro.s = program.startTime.getSeconds().toString();
            objMacro.ss = ("0" + program.startTime.getSeconds()).slice(-2);

            objMacro._YYYY = program.endTime.getFullYear().toString();
            objMacro._YY = program.endTime.getFullYear().toString().slice(-2);
            objMacro._M = (program.endTime.getMonth() + 1).toString();
            objMacro._MM = ("0" + (program.endTime.getMonth() + 1)).slice(-2);
            objMacro._D = program.endTime.getDate().toString();
            objMacro._DD = ("0" + program.endTime.getDate()).slice(-2);
            objMacro._h = program.endTime.getHours().toString();
            objMacro._hh = ("0" + program.endTime.getHours()).slice(-2);
            objMacro._m = program.endTime.getMinutes().toString();
            objMacro._mm = ("0" + program.endTime.getMinutes()).slice(-2);
            objMacro._s = program.endTime.getSeconds().toString();
            objMacro._ss = ("0" + program.endTime.getSeconds()).slice(-2);

            objMacro.channelName = program.channelName;
            objMacro.channelUserName = program.channelUserName || "";

            this.macro = objMacro;

            resolve();
        });
    }

    setMacro() {
        console.log("Set Macro...");

        return new Promise(resolve => {
            var dir = this.replaceMacro(this.options.dir);
            var file = this.replaceMacro(this.options.file);

            if (dir !== "") {
                dir = Renamer.escape(dir);
            }

            if (file === "") {
                file = path.basename(this.options.input, path.extname(this.options.input));
            } else {
                file = Renamer.escape(file).replace(/\\/g, Renamer.toFull);
            }

            this.output.dir = dir;
            this.output.file = file;
            this.output.path = path.join(this.options.parent, dir, file + path.extname(this.options.input));

            console.log(` - output.dir: ${this.output.dir}`);
            console.log(` - output.file: ${this.output.file}`);

            resolve();
        });
    }

    checkDrop() {
        console.log("Check Drop...");

        if (!this.options.check) {
            return new Promise(resolve => {
                console.log(" - skip");

                resolve();
            });
        } else {
            return new Promise((resolve, reject) => {
                var readStream = fs.createReadStream(this.options.input);
                var tsStream = new aribts.TsStream();

                var flag = false;
                var size = fs.statSync(this.options.input).size;
                var count = 0;
                var bytesRead = 0;

                readStream.pipe(tsStream);

                console.log("");

                function log() {
                    console.log("\u001b[2A");
                    console.log(` - ${bytesRead} of ${size} [${Math.floor(bytesRead / size * 100)}%]`);
                }

                tsStream.on("data", data => {
                    bytesRead += data.length;

                    if (++count % 10000 === 0) {
                        log();
                    }
                });

                tsStream.on("drop", pid => {
                    if (pid < 0x30) return;

                    reject(new Error(`Find drop, PID 0x${pid.toString(16)}`));

                    flag = true;
                    tsStream.removeAllListeners("drop");
                    readStream.unpipe(tsStream);
                    tsStream.end();
                });

                tsStream.on("end", () => {
                    log();

                    if (flag) return;

                    resolve();
                });
            });
        }
    }

    makeFolder() {
        console.log("Make Folder...");

        var parsed = path.parse(this.output.path);
        var folders = parsed.dir.replace(parsed.root, "").split(path.sep);

        var promise = Promise.resolve(parsed.root);

        folders.forEach(folder => {
            promise = promise.then(current => {
                return new Promise((resolve, reject) => {
                    current = path.join(current, folder);

                    fs.stat(current, err => {
                        if (err) {
                            fs.mkdir(current, err2 => {
                                if (err2) {
                                    reject(new Error(`Can't make output folder - ${err2.message}`));

                                    return;
                                }

                                resolve(current);
                            });

                            return;
                        }

                        resolve(current);
                    });
                });
            });
        });

        return promise;
    }

    rename() {
        console.log("Rename...");

        return new Promise((resolve, reject) => {
            fs.rename(this.options.input, this.output.path, err => {
                if (err) {
                    reject(new Error(`Can't rename - ${err.message}`));

                    return;
                }

                resolve();
            });
        });
    }

    replaceMacro(str) {
        var macro = this.macro;

        var reg = /\${(.*?)}/g;
        var reg2 = /\$\((.*?)\)/g;

        function rep(p0, p1) {
            if (!macro.hasOwnProperty(p1)) return p0;

            return macro[p1];
        }

        function rep2(p0, p1) {
            var exists = true;

            p1 = p1.replace(reg, p3 => {
                p3 = p3.replace(reg, rep);

                if (p3 === "") exists = false;

                return p3;
            });

            if (!exists) return "";

            return p1;
        }

        str = str.replace(reg2, rep2);
        str = str.replace(reg, rep);

        return str;
    }

    static escape(str, flag) {
        return str.replace(flag ? /([/\?\*:\|"<>\\])/g : /([/\?\*:\|"<>])/g, Renamer.toFull);
    }

    static toHalf(str) {
        return str.replace(/[\uff01-\uff5e]/g, function(s) {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        }).split("\u3000").join(" ");
    }

    static toFull(str) {
        return str.replace(/[\!-\~]/g, function(s) {
            return String.fromCharCode(s.charCodeAt(0) + 0xFEE0);
        }).split(" ").join("\u3000");
    }
}

(() => {
    var options = Object.assign({
        input: "",
        parent: "",
        dir: "${title}",
        file: "${title}$( 第${count2}話)$( 「${subTitle}」)$( (${channelUserName}))",
        check: false
    }, nopt({
        input: path,
        parent: path,
        dir: String,
        file: String,
        check: Boolean
    }, {
        i: ["--input"],
        p: ["--parent"],
        d: ["--dir"],
        f: ["--file"],
        c: ["--check"]
    }));

    if (options.input === "") {
        console.log("usage: node ./ts-renamer -i input.ts -p parent -d dir -f file [-c]");

        return;
    }

    var renamer = new Renamer(options);

    renamer.execute().then(() => {
        console.log("Successful");
    }).catch(err => {
        console.error("Error: " + err.message);
    });
})();

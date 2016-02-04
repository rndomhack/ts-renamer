"use strict";

const fs = require("fs");
const path = require("path");
const aribts = require("aribts");
const syobocal = require("syobocal");
const settings = require("../settings/settings");

class Renamer {
    constructor(options) {
        options = options || {};

        this.options = {
            input: options.input,
            parent: options.parent || path.dirname(options.input),
            dir: options.dir,
            file: options.file,
            checkDup: options.checkDup,
            checkDrop: options.checkDrop,
            checkService: options.checkService
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
        var promise = this.checkInput();

        promise = promise.then(() => {
            return this.getInfo();
        }).then(() => {
            return this.convertInfo();
        }).then(() => {
            return this.getProgram();
        }).then(() => {
            return this.getMacro();
        }).then(() => {
            return this.setMacro();
        });

        if (this.options.checkDup) {
            promise = promise.then(() => {
                return this.checkDuplication();
            });
        } else {
            promise = promise.then(() => {
                return this.checkOutput();
            });
        }

        if (this.options.checkDrop) {
            promise = promise.then(() => {
                return this.checkDrop();
            });
        }

        promise = promise.then(() => {
            return this.makeFolder();
        }).then(() => {
            return this.rename();
        });

        return promise;
    }

    checkInput() {
        console.log("Check Input...");

        return new Promise((resolve, reject) => {
            if (this.options.input === void 0) {
                reject(new Error("Invalid input"));
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
                tsStream.removeAllListeners("pat");
                tsStream.removeAllListeners("eit");
                tsStream.removeAllListeners("sdt");
                tsStream.removeAllListeners("tdt");
                tsStream.removeAllListeners("tot");
                readStream.unpipe(tsStream);
                tsStream.end();
            }

            tsStream.on("data", () => {
                if (packet++ < 5000000) return;

                reject(new Error("Can't find information in first 5000000 packets"));

                flag = true;
                close();
            });

            tsStream.on("end", () => {
                if (flag) return;

                reject(new Error("Can't find information"));
            });

            tsStream.on("eit", (pid, data) => {
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

                if (tsUtil.getTime().getTime() - time.getTime() < 60 * 1000) return;
                if (tsUtil.getTime().getTime() - time.getTime() > 120 * 1000) {
                    reject(new Error("Can't find information in 1 minutes"));

                    flag = true;
                    close();

                    return;
                }

                tsUtil.addEit(pid, data);

                if (!tsUtil.isPresent(ids.onid, ids.tsid, ids.sid)) return;
                if (!tsUtil.isServices(ids.onid, ids.tsid, ids.sid)) return;

                var present = tsUtil.getPresent(ids.onid, ids.tsid, ids.sid);
                var service = tsUtil.getServices()[ids.sid];

                console.log(" - Info");
                console.log(`   - event_name  : ${present.short_event.event_name}`);
                console.log(`   - service_name: ${service.service.service_name}`);

                var objInfo = {};

                objInfo.startTime = present.start_time;
                objInfo.eventName = present.short_event.event_name;
                objInfo.serviceName = service.service.service_name;

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

        return new Promise((resolve, reject) => {
            var info = this.info;

            // Replace full to half
            info.eventName = Renamer.toHalf(info.eventName);
            info.serviceName = Renamer.toHalf(info.serviceName);

            // Replace brackets
            info.eventName = info.eventName.replace(/\[.+?\]/g, "");
            info.eventName = info.eventName.replace(/【.+?】/g, "");
            info.eventName = info.eventName.replace(/<.+?>/g, "");
            info.eventName = info.eventName.replace(/\(.+?\)/g, "");
            info.eventName = info.eventName.replace(/「(.+?)」/g, " $1 ");
            info.eventName = info.eventName.replace(/『(.+?)』/g, " $1 ");

            // Replace others
            settings.replace.forEach(target => {
                info.eventName = info.eventName.split(target.find).join(target.replace);
            });

            // Trim space
            info.eventName = info.eventName.trim();

            // Find service
            var check = settings.service.some(target => {
                if (!info.serviceName.includes(target.serviceName)) return false;

                info.channelUserName = target.channelUserName;
                info.channelId = target.channelId;

                return true;
            });

            if (this.options.checkService && !check) {
                reject(new Error("Can't find service"));

                return;
            }


            resolve();
        });
    }

    getProgram() {
        console.log("Get Program...");

        var info = this.info;
        var syobocalRss2 = new syobocal.Rss2();
        var syobocalJson = new syobocal.Json();

        return syobocalRss2.request({
            start: new Date(info.startTime.getTime() - 60 * 60 * 1000),
            end: new Date(info.startTime.getTime() + 60 * 60 * 1000),
            usr: "node_syobocal"
        }).then(programs => {
            var space = info.eventName.indexOf(" ");
            var trim = info.eventName.slice(0, space > 0 && space < 5 ? space : 5);

            console.log(` - Search "${trim}"`);

            var filter = programs.filter(program => Renamer.toHalf(program.Title).replace(/ /g, "").includes(trim));

            if (info.hasOwnProperty("channelId")) {
                filter = filter.filter(program => program.ChID === info.channelId);
            }

            if (filter.length === 0) {
                throw new Error("Can't find program");
            }

            var program = filter.reduce((prev, current) => {
                var prev_diff = Math.abs(info.startTime.getTime() - prev.StTime.getTime());
                var current_diff = Math.abs(info.startTime.getTime() - current.StTime.getTime());

                return prev_diff > current_diff ? current : prev;
            });

            return syobocalJson.getTitleFull({
                TID: program.TID
            }).then(title => {
                return {
                    title: title[program.TID],
                    program: program
                };
            });
        }).then(obj => {
            var title = obj.title;
            var program = obj.program;

            console.log(" - Program");
            console.log(`   - Title   : ${program.Title}`);
            console.log(`   - SubTitle: ${program.SubTitle}`);
            console.log(`   - Count   : ${program.Count}`);
            console.log(`   - ChName  : ${program.ChName}`);

            var objProgram = {};

            objProgram.title = title.Title;
            objProgram.shortTitle = title.ShortTitle;
            objProgram.titleYomi = title.TitleYomi;
            objProgram.titleEnglish = title.TitleEN;
            objProgram.firstStartYear = title.FirstYear;
            objProgram.firstStartMonth = title.FirstMonth;
            objProgram.firstEndYear = title.FirstEndYear;
            objProgram.firstEndMonth = title.FirstEndMonth;

            objProgram.subTitle = program.SubTitle;
            objProgram.count = program.Count;
            objProgram.startTime = program.StTime;
            objProgram.endTime = program.EdTime;
            objProgram.channelName = program.ChName;
            objProgram.channelUserName = info.channelUserName;

            this.program = objProgram;
        });
    }

    getMacro() {
        console.log("Get Macro...");

        return new Promise(resolve => {
            var program = this.program;

            var objMacro = {};

            objMacro.title = program.title;
            objMacro.shortTitle = program.shortTitle || program.title;
            objMacro.subTitle = program.subTitle === null ? "" : program.subTitle;

            objMacro.titleYomi = program.titleYomi;
            objMacro.titleEnglish = program.titleEnglish;

            objMacro.firstStartYYYY = program.firstStartYear === null ? "" : program.firstStartYear.toString();
            objMacro.firstStartYY = program.firstStartYear === null ? "" : program.firstStartYear.toString().slice(-2);
            objMacro.firstStartM = program.firstStartMonth === null ? "" : program.firstStartMonth.toString();
            objMacro.firstStartMM = program.firstStartMonth === null ? "" : ("0" + program.firstStartMonth).slice(-2);
            objMacro.firstStartQuarter = program.firstStartMonth === null ? "" : Math.floor((program.firstStartMonth - 1) / 3) + 1;
            objMacro.firstStartSeason = program.firstStartMonth === null ? "" : ["春", "夏", "秋", "冬"][Math.floor((program.firstStartMonth - 1) / 3)];

            objMacro.firstEndYYYY = program.firstEndYear === null ? "" : program.firstEndYear.toString();
            objMacro.firstEndYY = program.firstEndYear === null ? "" : program.firstEndYear.toString().slice(-2);
            objMacro.firstEndM = program.firstEndMonth === null ? "" : program.firstEndMonth.toString();
            objMacro.firstEndMM = program.firstEndMonth === null ? "" : ("0" + program.firstEndMonth).slice(-2);
            objMacro.firstEndQuarter = program.firstEndMonth === null ? "" : Math.floor((program.firstEndMonth - 1) / 3) + 1;
            objMacro.firstEndSeason = program.firstEndMonth === null ? "" : ["春", "夏", "秋", "冬"][Math.floor((program.firstEndMonth - 1) / 3)];

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

            console.log(" - Output");
            console.log(`   - dir : ${this.output.dir}`);
            console.log(`   - file: ${this.output.file}`);

            resolve();
        });
    }

    checkDuplication() {
        console.log("Check Duplication...");

        return new Promise((resolve, reject) => {

            fs.stat(this.output.path, err => {
                if (!err) {
                    reject(new Error("File already exists"));
                    return;
                }

                resolve();
            });
        });
    }

    checkOutput() {
        console.log("Check Output...");

        return new Promise(resolve => {
            fs.stat(this.output.path, err => {
                if (!err) {
                    this.output.file += `_${Math.random().toString(16).slice(2)}`;
                    this.output.path = path.join(this.options.parent, this.output.dir, this.output.file + path.extname(this.options.input));

                    console.log(" - Output");
                    console.log(`   - dir : ${this.output.dir}`);
                    console.log(`   - file: ${this.output.file}`);

                    resolve();
                    return;
                }

                resolve();
            });
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
        var reg2 = /\(\[(.*?)\]\)/g;

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

module.exports = Renamer;

"use strict";

const fs = require("fs");
const path = require("path");
const stream = require("stream");
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
            packetSize: options.packet_size,
            checkService: options.check_service,
            checkDuplication: options.check_dup,
            checkDrop: options.check_drop
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
        let promise = this.checkInput();

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

        if (this.options.checkDuplication) {
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
            const readableStream = fs.createReadStream(this.options.input, {
                start: Math.floor(fs.statSync(this.options.input).size / 2)
            });

            const tsReadableConnector = new aribts.TsReadableConnector();
            const tsPacketParser = new aribts.TsPacketParser({ packetSize: this.options.packetSize });
            const tsSectionParser = new aribts.TsSectionParser();
            const tsSectionAnalyzer = new aribts.TsSectionAnalyzer();
            const tsEventManager = new aribts.TsEventManager();

            let onid = -1;
            let tsid = -1;
            let sid = -1;
            let services = null;

            function check() {
                if (onid === -1 || tsid === -1 || sid === -1) return;
                if (services === null || !services.hasOwnProperty(sid)) return;

                tsSectionParser.unpipe(tsSectionAnalyzer);
                tsSectionParser.pipe(tsEventManager);
            }

            tsSectionParser.once("finish", () => {
                reject(new Error("Can't find information"));
            });

            tsSectionParser.on("sit", tsSection => {
                const objSection = tsSection.decode();

                if (objSection.services.length === 0) return;

                const tsDescriptors = objSection.services[0].descriptors.decode();
                const info = {};

                for (const tsDescriptor of tsDescriptors) {
                    switch (tsDescriptor.getDescriptorTag()) {
                        case 0x48: {
                            // Service event
                            const objDescriptor = tsDescriptor.decode();

                            info.serviceName = new aribts.TsChar(objDescriptor.service_name).decode();

                            break;
                        }

                        case 0x4D: {
                            // Short event
                            const objDescriptor = tsDescriptor.decode();

                            info.eventName = new aribts.TsChar(objDescriptor.event_name).decode();

                            break;
                        }

                        case 0xC3: {
                            // Partial transport stream time
                            const objDescriptor = tsDescriptor.decode();

                            info.startTime = new aribts.TsDate(objDescriptor.event_start_time).decode();

                            break;
                        }
                    }
                }

                if (!info.hasOwnProperty("serviceName") || !info.hasOwnProperty("eventName") || !info.hasOwnProperty("startTime")) return;

                this.info = info;

                console.log(" - Info");
                console.log(`   - serviceName: ${this.info.serviceName}`);
                console.log(`   - eventName  : ${this.info.eventName}`);
                console.log(`   - startTime  : ${this.info.startTime}`);

                resolve();

                readableStream.unpipe(tsReadableConnector);
                tsReadableConnector.end();
            });

            tsSectionAnalyzer.on("programNumbers", programNumbers => {
                sid = programNumbers[0];
                check();
            });

            tsSectionAnalyzer.on("originalNetworkId", originalNetworkId => {
                onid = originalNetworkId;
                check();
            });

            tsSectionAnalyzer.on("transportStreamId", transportStreamId => {
                tsid = transportStreamId;
                check();
            });

            tsSectionAnalyzer.on("services", _services => {
                services = _services;
                check();
            });

            tsEventManager.on("present", tsEvent => {
                const eventInfo = tsEvent.getInfo();

                if (eventInfo.originalNetworkId !== onid) return;
                if (eventInfo.transportStreamId !== tsid) return;
                if (eventInfo.serviceId !== sid) return;
                if (!tsEvent.hasShortEvent()) return;

                this.info = {
                    serviceName: services[sid].serviceName,
                    eventName: tsEvent.getShortEvent().eventName,
                    startTime: eventInfo.startTime
                };

                console.log(" - Info");
                console.log(`   - serviceName: ${this.info.serviceName}`);
                console.log(`   - eventName  : ${this.info.eventName}`);
                console.log(`   - startTime  : ${this.info.startTime}`);

                resolve();

                readableStream.unpipe(tsReadableConnector);
                tsReadableConnector.end();
            });

            readableStream.pipe(tsReadableConnector);

            tsReadableConnector.pipe(tsPacketParser);
            tsPacketParser.pipe(tsSectionParser);
            tsSectionParser.pipe(tsSectionAnalyzer);
        });
    }

    convertInfo() {
        console.log("Convert Info...");

        return new Promise((resolve, reject) => {
            const info = this.info;

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
            const check = settings.service.some(target => {
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

        const info = this.info;
        const syobocalRss2 = new syobocal.Rss2();
        const syobocalJson = new syobocal.Json();

        return syobocalRss2.request({
            start: new Date(info.startTime.getTime() - 60 * 60 * 1000),
            end: new Date(info.startTime.getTime() + 60 * 60 * 1000),
            usr: "node_syobocal"
        }).then(programs => {
            const space = info.eventName.indexOf(" ");
            const trim = info.eventName.slice(0, space > 0 && space < 5 ? space : 5);

            console.log(` - Search "${trim}"`);

            let filter = programs.filter(program => Renamer.toHalf(program.Title).replace(/ /g, "").includes(trim));

            if (info.hasOwnProperty("channelId")) {
                filter = filter.filter(program => program.ChID === info.channelId);
            }

            if (filter.length === 0) {
                throw new Error("Can't find program");
            }

            const program = filter.reduce((prev, current) => {
                const prev_diff = Math.abs(info.startTime.getTime() - prev.StTime.getTime());
                const current_diff = Math.abs(info.startTime.getTime() - current.StTime.getTime());

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
            this.program = {
                title: obj.title.Title,
                shortTitle: obj.title.ShortTitle,
                titleYomi: obj.title.TitleYomi,
                titleEnglish: obj.title.TitleEN,
                firstStartYear: obj.title.FirstYear,
                firstStartMonth: obj.title.FirstMonth,
                firstEndYear: obj.title.FirstEndYear,
                firstEndMonth: obj.title.FirstEndMonth,
                subTitle: obj.program.SubTitle,
                count: obj.program.Count,
                startTime: obj.program.StTime,
                endTime: obj.program.EdTime,
                channelName: obj.program.ChName,
                channelUserName: info.channelUserName
            };

            console.log(" - Program");
            console.log(`   - title      : ${this.program.title}`);
            console.log(`   - subTitle   : ${this.program.subTitle}`);
            console.log(`   - count      : ${this.program.count}`);
            console.log(`   - channelName: ${this.program.channelName}`);
        });
    }

    getMacro() {
        console.log("Get Macro...");

        return new Promise(resolve => {
            const program = this.program;

            this.macro = {
                title: program.title,
                shortTitle: program.shortTitle || program.title,
                subTitle: program.subTitle === null ? "" : program.subTitle,
                titleYomi: program.titleYomi,
                titleEnglish: program.titleEnglish,
                firstStartYYYY: program.firstStartYear === null ? "" : program.firstStartYear.toString(),
                firstStartYY: program.firstStartYear === null ? "" : program.firstStartYear.toString().slice(-2),
                firstStartM: program.firstStartMonth === null ? "" : program.firstStartMonth.toString(),
                firstStartMM: program.firstStartMonth === null ? "" : ("0" + program.firstStartMonth).slice(-2),
                firstStartQuarter: program.firstStartMonth === null ? "" : (Math.floor((program.firstStartMonth - 1) / 3) + 1).toString(),
                firstStartSeason: program.firstStartMonth === null ? "" : ["春", "夏", "秋", "冬"][Math.floor((program.firstStartMonth - 1) / 3)],
                firstEndYYYY: program.firstEndYear === null ? "" : program.firstEndYear.toString(),
                firstEndYY: program.firstEndYear === null ? "" : program.firstEndYear.toString().slice(-2),
                firstEndM: program.firstEndMonth === null ? "" : program.firstEndMonth.toString(),
                firstEndMM: program.firstEndMonth === null ? "" : ("0" + program.firstEndMonth).slice(-2),
                firstEndQuarter: program.firstEndMonth === null ? "" : (Math.floor((program.firstEndMonth - 1) / 3) + 1).toString(),
                firstEndSeason: program.firstEndMonth === null ? "" : ["春", "夏", "秋", "冬"][Math.floor((program.firstEndMonth - 1) / 3)],
                count: program.count === null ? "" : program.count.toString(),
                count2: program.count === null ? "" : ("0" + program.count).slice(-2),
                count3: program.count === null ? "" : ("00" + program.count).slice(-3),
                count4: program.count === null ? "" : ("000" + program.count).slice(-4),
                YYYY: program.startTime.getFullYear().toString(),
                YY: program.startTime.getFullYear().toString().slice(-2),
                M: (program.startTime.getMonth() + 1).toString(),
                MM: ("0" + (program.startTime.getMonth() + 1)).slice(-2),
                D: program.startTime.getDate().toString(),
                DD: ("0" + program.startTime.getDate()).slice(-2),
                h: program.startTime.getHours().toString(),
                hh: ("0" + program.startTime.getHours()).slice(-2),
                m: program.startTime.getMinutes().toString(),
                mm: ("0" + program.startTime.getMinutes()).slice(-2),
                s: program.startTime.getSeconds().toString(),
                ss: ("0" + program.startTime.getSeconds()).slice(-2),
                _YYYY: program.endTime.getFullYear().toString(),
                _YY: program.endTime.getFullYear().toString().slice(-2),
                _M: (program.endTime.getMonth() + 1).toString(),
                _MM: ("0" + (program.endTime.getMonth() + 1)).slice(-2),
                _D: program.endTime.getDate().toString(),
                _DD: ("0" + program.endTime.getDate()).slice(-2),
                _h: program.endTime.getHours().toString(),
                _hh: ("0" + program.endTime.getHours()).slice(-2),
                _m: program.endTime.getMinutes().toString(),
                _mm: ("0" + program.endTime.getMinutes()).slice(-2),
                _s: program.endTime.getSeconds().toString(),
                _ss: ("0" + program.endTime.getSeconds()).slice(-2),
                channelName: program.channelName,
                channelUserName: program.channelUserName || ""
            };

            resolve();
        });
    }

    setMacro() {
        console.log("Set Macro...");

        return new Promise(resolve => {
            let dir = this.replaceMacro(this.options.dir);
            let file = this.replaceMacro(this.options.file);

            if (dir !== "") {
                dir = Renamer.escape(dir).replace(/[\/\\]/g, path.sep);
            }

            if (file === "") {
                file = path.basename(this.options.input, path.extname(this.options.input));
            } else {
                file = Renamer.escape(file, true);
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

        return new Promise((resolve, reject) => {
            const size = fs.statSync(this.options.input).size;
            let bytesRead = 0;

            const readableStream = fs.createReadStream(this.options.input);
            const transformStream = new stream.Transform({
                transform: function (chunk, encoding, done) {
                    bytesRead += chunk.length;

                    process.stdout.write("\r\u001b[K");
                    process.stdout.write(` - Check ${bytesRead} of ${size} [${Math.floor(bytesRead / size * 100)}%]`);

                    this.push(chunk);
                    done();
                },
                flush: function (done) {
                    process.stdout.write("\r\u001b[K");
                    process.stdout.write(` - Done ${bytesRead} of ${size} [${Math.floor(bytesRead / size * 100)}%]\n`);

                    done();
                }
            });

            const tsReadableConnector = new aribts.TsReadableConnector();
            const tsPacketParser = new aribts.TsPacketParser();
            const tsPacketAnalyzer = new aribts.TsPacketAnalyzer();

            tsPacketAnalyzer.once("finish", () => {
                resolve();
            });

            tsPacketAnalyzer.once("packetDrop", pid => {
                if (pid < 0x30) return;

                reject(new Error(`Find drop (PID 0x${pid.toString(16)})`));

                readableStream.unpipe(transformStream);
                transformStream.end();
            });

            readableStream.pipe(transformStream);
            transformStream.pipe(tsReadableConnector);

            tsReadableConnector.pipe(tsPacketParser);
            tsPacketParser.pipe(tsPacketAnalyzer);
        });
    }

    makeFolder() {
        console.log("Make Folder...");

        const parsed = path.parse(this.output.path);
        const folders = parsed.dir.replace(parsed.root, "").split(path.sep).filter(value => value !== "");

        let promise = Promise.resolve(parsed.root);

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
        const macro = this.macro;

        const reg = /\${(.*?)}/g;
        const reg2 = /\(\[(.*?)\]\)/g;

        function rep(p0, p1) {
            if (!macro.hasOwnProperty(p1)) return p0;

            return Renamer.escape(macro[p1], true);
        }

        function rep2(p0, p1) {
            let exists = true;

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
        return str.replace(flag ? /([\/\\\?\*:\|"<>])/g : /([\?\*:\|"<>])/g, Renamer.toFull);
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

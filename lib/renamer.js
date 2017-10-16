"use strict";

const fs = require("fs");
const path = require("path");
const stream = require("stream");
const util = require("util");

const aribts = require("aribts");
const syobocal = require("syobocal");
const settings = require("../settings/settings");

const mkdir = util.promisify(fs.mkdir);
const rename = util.promisify(fs.rename);
const stat = util.promisify(fs.stat);
const unlink = util.promisify(fs.unlink);

async function exists(_path) {
    try {
        await stat(_path);
    } catch (err) {
        return false;
    }

    return true;
}

class Lib {
    static escape(str, flag) {
        return str.replace(flag ? /([\/\\\?\*:\|"<>])/g : /([\?\*:\|"<>])/g, Lib.toFull);
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

class Renamer {
    constructor(options) {
        options = options || {};

        this.options = {
            input: options.input,
            parent: options.parent || path.dirname(options.input),
            dir: options.dir,
            file: options.file,
            errorDir: options.error_dir,
            errorFile: options.error_file,
            packetSize: options.packet_size,
            checkService: options.check_service,
            checkTime: options.check_time,
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

    async execute() {
        await this.checkInput();

        try {
            await this.getInfo();
            this.convertInfo();
            await this.getProgram();

            if (this.options.checkTime) {
                await this.checkTime();
            }

            this.getMacro();
            this.setMacro();

            if (this.options.checkDuplication) {
                await this.checkDuplication();
            } else {
                await this.checkOutput();
            }

            if (this.options.checkDrop) {
                await this.checkDrop();
            }
        } catch (err) {
            if (this.options.errorFile) {
                console.error(`Error: ${err.message}`);
                console.error(" - Continue");

                this.getErrorMacro(err);
                this.setErrorMacro();
                await this.checkOutput();
            } else {
                throw err;
            }
        }

        await this.makeDirectory();
        await this.rename();
    }

    async checkInput() {
        console.log("Check Input...");

        if (this.options.input === void 0) {
            throw new Error("Invalid input");
        }

        if (!await exists(this.options.input)) {
            throw new Error("Can't find input");
        }
    }

    async getInfo() {
        console.log("Get Info...");

        const stats = await stat(this.options.input);

        await new Promise((resolve, reject) => {
            const readableStream = fs.createReadStream(this.options.input, {
                start: Math.floor(stats.size / 2)
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

        const info = this.info;

        // Replace full to half
        info.eventName = Lib.toHalf(info.eventName);
        info.serviceName = Lib.toHalf(info.serviceName);

        // Replace brackets
        info.eventName = info.eventName.replace(/\[.+?\]/g, "");
        info.eventName = info.eventName.replace(/【.+?】/g, "");
        info.eventName = info.eventName.replace(/<.+?>/g, "");
        info.eventName = info.eventName.replace(/\(.+?\)/g, "");
        info.eventName = info.eventName.replace(/「(.+?)」/g, " $1 ");
        info.eventName = info.eventName.replace(/『(.+?)』/g, " $1 ");

        // Replace others
        for (const replace of settings.replace) {
            info.eventName = info.eventName.split(replace.find).join(replace.replace);
        }

        // Trim space
        info.eventName = info.eventName.trim();

        // Find service
        let flag = false;

        for (const service of settings.service) {
            if (!info.serviceName.includes(service.serviceName)) continue;

            info.channelUserName = service.channelUserName;
            info.channelId = service.channelId;

            flag = true;
            break;
        }

        if (this.options.checkService && !flag) {
            throw new Error("Can't find service");
        }
    }

    async getProgram() {
        console.log("Get Program...");

        const info = this.info;
        const syobocalRss2 = new syobocal.Rss2();
        const syobocalJson = new syobocal.Json();

        const programs = await syobocalRss2.request({
            start: new Date(info.startTime.getTime() - 60 * 60 * 1000),
            end: new Date(info.startTime.getTime() + 60 * 60 * 1000),
            usr: "node_syobocal"
        });

        const space = info.eventName.indexOf(" ");
        const trim = info.eventName.slice(0, space > 0 && space < 5 ? space : 5);

        console.log(` - Search "${trim}"`);

        let filter = programs.filter(program => Lib.toHalf(program.Title).replace(/ /g, "").includes(trim));

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

        const titles = await syobocalJson.getTitleFull({
            TID: program.TID
        });

        const title = titles[program.TID];

        this.program = {
            title: title.Title,
            shortTitle: title.ShortTitle,
            titleYomi: title.TitleYomi,
            titleEnglish: title.TitleEN,
            firstStartYear: title.FirstYear,
            firstStartMonth: title.FirstMonth,
            firstEndYear: title.FirstEndYear,
            firstEndMonth: title.FirstEndMonth,
            subTitle: program.SubTitle,
            count: program.Count,
            startTime: program.StTime,
            endTime: program.EdTime,
            channelName: program.ChName,
            channelUserName: info.channelUserName
        };

        console.log(" - Program");
        console.log(`   - title      : ${this.program.title}`);
        console.log(`   - subTitle   : ${this.program.subTitle}`);
        console.log(`   - count      : ${this.program.count}`);
        console.log(`   - channelName: ${this.program.channelName}`);
    }

    async checkTime() {
        console.log("Check Time...");

        const stats = await stat(this.options.input);

        const actualStartTime = await new Promise((resolve, reject) => {
            const readableStream = fs.createReadStream(this.options.input);

            const tsReadableConnector = new aribts.TsReadableConnector();
            const tsPacketParser = new aribts.TsPacketParser({ packetSize: this.options.packetSize });
            const tsSectionParser = new aribts.TsSectionParser();
            const tsSectionAnalyzer = new aribts.TsSectionAnalyzer();

            let _startPcr = null;
            let _endPcr = null;

            tsPacketParser.once("finish", () => {
                reject(new Error("Can't find start"));
            });

            tsPacketParser.on("data", packet => {
                const objAF = packet.decodeAdaptationField();

                if (objAF === null) return;
                if (objAF.PCR_flag === 0) return;

                if (_startPcr === null) {
                    _startPcr = objAF.program_clock_reference_base;
                }

                _endPcr = objAF.program_clock_reference_base;
            });

            tsSectionAnalyzer.on("time", time => {
                let _startTime = time.getTime();

                if (_startPcr !== null) {
                    _startTime -= Math.floor((_endPcr - _startPcr + (_startPcr > _endPcr ? 0x200000000 : 0)) / 90);
                }

                resolve(_startTime);

                readableStream.unpipe(tsReadableConnector);
                tsReadableConnector.end();
            });

            readableStream.pipe(tsReadableConnector);

            tsReadableConnector.pipe(tsPacketParser);
            tsPacketParser.pipe(tsSectionParser);
            tsSectionParser.pipe(tsSectionAnalyzer);
        });

        const programStartTime = this.program.startTime.getTime();

        const startPcr = await new Promise((resolve, reject) => {
            const readableStream = fs.createReadStream(this.options.input);

            const tsReadableConnector = new aribts.TsReadableConnector();
            const tsPacketParser = new aribts.TsPacketParser({ packetSize: this.options.packetSize });

            tsPacketParser.once("finish", () => {
                reject(new Error("Can't find start"));
            });

            tsPacketParser.on("data", packet => {
                const objAF = packet.decodeAdaptationField();

                if (objAF === null) return;
                if (!objAF.PCR_flag) return;

                resolve(objAF.program_clock_reference_base);

                readableStream.unpipe(tsReadableConnector);
                tsReadableConnector.end();
            });

            readableStream.pipe(tsReadableConnector);

            tsReadableConnector.pipe(tsPacketParser);
        });

        const endPcr = await new Promise((resolve, reject) => {
            let pcr = null;

            const readableStream = fs.createReadStream(this.options.input, {
                start: stats.size - this.options.packetSize * 65535
            });

            const tsReadableConnector = new aribts.TsReadableConnector();
            const tsPacketParser = new aribts.TsPacketParser({ packetSize: this.options.packetSize });

            tsPacketParser.once("finish", () => {
                if (pcr === null) {
                    reject(new Error("Can't find end"));
                    return;
                }

                resolve(pcr);
            });

            tsPacketParser.on("data", packet => {
                const objAF = packet.decodeAdaptationField();

                if (objAF === null) return;
                if (!objAF.PCR_flag) return;

                pcr = objAF.program_clock_reference_base;
            });

            readableStream.pipe(tsReadableConnector);

            tsReadableConnector.pipe(tsPacketParser);
        });

        const actualDuration = Math.floor((endPcr - startPcr + (startPcr > endPcr ? 0x200000000 : 0)) / 90);
        const programDuration = this.program.endTime.getTime() - this.program.startTime.getTime();

        if (actualStartTime > programStartTime) {
            throw new Error(`Invalid start time(actual: ${actualStartTime}, program: ${programStartTime})`);
        }

        if (actualDuration < programDuration) {
            throw new Error(`Invalid duration(actual: ${Math.floor(actualDuration / 1000)} sec, program: ${Math.floor(programDuration / 1000)} sec)`);
        }
    }

    getMacro() {
        console.log("Get Macro...");

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
            firstStartMM: program.firstStartMonth === null ? "" : program.firstStartMonth.toString().padStart(2, "0"),
            firstStartQuarter: program.firstStartMonth === null ? "" : (Math.floor((program.firstStartMonth - 1) / 3) + 1).toString(),
            firstStartSeason: program.firstStartMonth === null ? "" : ["春", "夏", "秋", "冬"][Math.floor((program.firstStartMonth - 1) / 3)],
            firstEndYYYY: program.firstEndYear === null ? "" : program.firstEndYear.toString(),
            firstEndYY: program.firstEndYear === null ? "" : program.firstEndYear.toString().slice(-2),
            firstEndM: program.firstEndMonth === null ? "" : program.firstEndMonth.toString(),
            firstEndMM: program.firstEndMonth === null ? "" : program.firstEndMonth.toString().padStart(2, "0"),
            firstEndQuarter: program.firstEndMonth === null ? "" : (Math.floor((program.firstEndMonth - 1) / 3) + 1).toString(),
            firstEndSeason: program.firstEndMonth === null ? "" : ["春", "夏", "秋", "冬"][Math.floor((program.firstEndMonth - 1) / 3)],
            count: program.count === null ? "" : program.count.toString(),
            count2: program.count === null ? "" : program.count.toString().padStart(2, "0"),
            count3: program.count === null ? "" : program.count.toString().padStart(3, "0"),
            count4: program.count === null ? "" : program.count.toString().padStart(4, "0"),
            YYYY: program.startTime.getFullYear().toString(),
            YY: program.startTime.getFullYear().toString().slice(-2),
            M: (program.startTime.getMonth() + 1).toString(),
            MM: (program.startTime.getMonth() + 1).toString().padStart(2, "0"),
            D: program.startTime.getDate().toString(),
            DD: program.startTime.getDate().toString().padStart(2, "0"),
            h: program.startTime.getHours().toString(),
            hh: program.startTime.getHours().toString().padStart(2, "0"),
            m: program.startTime.getMinutes().toString(),
            mm: program.startTime.getMinutes().toString().padStart(2, "0"),
            s: program.startTime.getSeconds().toString(),
            ss: program.startTime.getSeconds().toString().padStart(2, "0"),
            _YYYY: program.endTime.getFullYear().toString(),
            _YY: program.endTime.getFullYear().toString().slice(-2),
            _M: (program.endTime.getMonth() + 1).toString(),
            _MM: (program.endTime.getMonth() + 1).toString().padStart(2, "0"),
            _D: program.endTime.getDate().toString(),
            _DD: program.endTime.getDate().toString().padStart(2, "0"),
            _h: program.endTime.getHours().toString(),
            _hh: program.endTime.getHours().toString().padStart(2, "0"),
            _m: program.endTime.getMinutes().toString(),
            _mm: program.endTime.getMinutes().toString().padStart(2, "0"),
            _s: program.endTime.getSeconds().toString(),
            _ss: program.endTime.getSeconds().toString().padStart(2, "0"),
            channelName: program.channelName,
            channelUserName: program.channelUserName || ""
        };
    }

    setMacro() {
        console.log("Set Macro...");

        let dir = this.replaceMacro(this.options.dir);
        let file = this.replaceMacro(this.options.file);

        if (dir !== "") {
            dir = Lib.escape(dir).replace(/[\/\\]/g, path.sep);
        }

        if (file === "") {
            file = path.parse(this.options.input).name;
        } else {
            file = Lib.escape(file, true);
        }

        this.output.dir = dir;
        this.output.file = file;
        this.output.path = path.join(this.options.parent, dir, file + path.parse(this.options.input).ext);

        console.log(" - Output");
        console.log(`   - dir : ${this.output.dir}`);
        console.log(`   - file: ${this.output.file}`);
    }

    async checkDuplication() {
        console.log("Check Duplication...");

        if (await exists(this.output.path)) {
            throw new Error("File already exists");
        }
    }

    async checkOutput() {
        console.log("Check Output...");

        if (await exists(this.output.path)) {
            this.output.file += `_${Math.random().toString(16).slice(2)}`;
            this.output.path = path.join(this.options.parent, this.output.dir, this.output.file + path.parse(this.options.input).ext);

            console.log(" - Output (Checked)");
            console.log(`   - dir : ${this.output.dir}`);
            console.log(`   - file: ${this.output.file}`);
        }
    }

    async checkDrop() {
        console.log("Check Drop...");

        const stats = await stat(this.options.input);
        const size = stats.size;

        await new Promise((resolve, reject) => {
            let bytesRead = 0;
            let count = 0;

            const readableStream = fs.createReadStream(this.options.input);
            const transformStream = new stream.Transform({
                transform: function (chunk, encoding, done) {
                    bytesRead += chunk.length;

                    if (++count === 10) {
                        process.stdout.write("\r\u001b[K");
                        process.stdout.write(` - Check ${bytesRead} of ${size} [${Math.floor(bytesRead / size * 100)}%]`);
                        count = 0;
                    }

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
            const tsPacketParser = new aribts.TsPacketParser({ packetSize: this.options.packetSize });
            const tsPacketAnalyzer = new aribts.TsPacketAnalyzer();

            tsPacketAnalyzer.once("finish", () => {
                resolve();
            });

            tsPacketAnalyzer.once("packetDrop", pid => {
                if (pid < 0x30) return;

                process.stdout.write("\r\u001b[K");
                console.log(`Find drop at PID 0x${pid.toString(16)}`);

                reject(new Error("Find drop"));

                readableStream.unpipe(transformStream);
                transformStream.end();
            });

            readableStream.pipe(transformStream);
            transformStream.pipe(tsReadableConnector);

            tsReadableConnector.pipe(tsPacketParser);
            tsPacketParser.pipe(tsPacketAnalyzer);
        });
    }

    getErrorMacro(err) {
        console.log("Get Error Macro...");

        let error;

        if (err.message.includes("Can't find information")) {
            error = "information";
        } else if (err.message.includes("Can't find service")) {
            error = "service";
        } else if (err.message.includes("Can't find program")) {
            error = "program";
        } else if (err.message.includes("Can't find start") || err.message.includes("Can't find end") || err.message.includes("Invalid time")) {
            error = "time";
        } else if (err.message.includes("File already exists")) {
            error = "duplication";
        } else if (err.message.includes("Find drop")) {
            error = "drop";
        } else {
            error = "unknown";
        }

        this.macro = {
            original: path.parse(this.options.input).name,
            error: error
        };
    }

    setErrorMacro() {
        console.log("Set Error Macro...");

        let dir = this.replaceMacro(this.options.errorDir);
        let file = this.replaceMacro(this.options.errorFile);

        if (dir !== "") {
            dir = Lib.escape(dir).replace(/[\/\\]/g, path.sep);
        }

        if (file === "") {
            file = path.parse(this.options.input).name;
        } else {
            file = Lib.escape(file, true);
        }

        this.output.dir = dir;
        this.output.file = file;
        this.output.path = path.join(this.options.parent, dir, file + path.parse(this.options.input).ext);

        console.log(" - Output");
        console.log(`   - dir : ${this.output.dir}`);
        console.log(`   - file: ${this.output.file}`);
    }

    async makeDirectory() {
        console.log("Make Directory...");

        const parsed = path.parse(this.output.path);
        const dirs = parsed.dir.replace(parsed.root, "").split(path.sep).filter(value => value !== "");

        let _path = parsed.root;

        for (const dir of dirs) {
            _path = path.join(_path, dir);

            if (await exists(_path)) continue;

            await mkdir(_path);
        }
    }

    async rename() {
        console.log("Rename...");

        try {
            await rename(this.options.input, this.output.path);
        } catch (err) {
            if (err.message.includes("EXDEV")) {
                await new Promise((resolve, reject) => {
                    const readableStream = fs.createReadStream(this.options.input);
                    const writableStream = fs.createWriteStream(this.output.path);

                    readableStream.on("error", err2 => {
                        reject(err2);
                    });

                    readableStream.on("end", () => {
                        resolve();
                    });

                    readableStream.pipe(writableStream);
                });

                await unlink(this.options.input);
            } else {
                throw err;
            }
        }
    }

    replaceMacro(str) {
        const macro = this.macro;

        const reg = /\${(.*?)}/g;
        const reg2 = /\(\[(.*?)\]\)/g;

        function rep(p0, p1) {
            if (!macro.hasOwnProperty(p1)) return p0;

            return Lib.escape(macro[p1], true);
        }

        function rep2(p0, p1) {
            let flag = true;

            p1 = p1.replace(reg, p3 => {
                p3 = p3.replace(reg, rep);

                if (p3 === "") flag = false;

                return p3;
            });

            if (!flag) return "";

            return p1;
        }

        str = str.replace(reg2, rep2);
        str = str.replace(reg, rep);

        return str;
    }
}

module.exports = Renamer;

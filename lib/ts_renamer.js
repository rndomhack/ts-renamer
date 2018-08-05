"use strict";

const path = require("path");
const stream = require("stream");

const aribts = require("aribts");
const fse = require("fs-extra");
const syobocal = require("syobocal");

function toHalf(str) {
    return str.replace(/[\uff01-\uff5e]/g, match => {
        return String.fromCharCode(match.charCodeAt(0) - 0xFEE0);
    }).split("\u3000").join(" ");
}

function toFull(str) {
    return str.replace(/[\!-\~]/g, match => {
        return String.fromCharCode(match.charCodeAt(0) + 0xFEE0);
    }).split(" ").join("\u3000");
}

class TsRenamer {
    constructor(options) {
        this.options = options.options;
        this.keywords = options.keywords;
        this.services = options.services;

        this.output = "";

        this.information = null;
        this.service = null;
        this.program = null;
        this.macro = null;
    }

    async execute() {
        await this.checkInput();

        let name = "";

        try {
            name = "information";
            await this.getInformation();

            name = "service";
            this.getService();

            name = "program";
            await this.getProgram();

            if (this.options.checkTime) {
                name = "time";
                await this.checkTime();
            }

            name = "macro";
            this.getMacro();
            this.setMacro();

            if (this.options.checkDuplication) {
                name = "duplication";
                await this.checkDuplication();
            } else {
                name = "output";
                await this.checkOutput();
            }

            if (this.options.checkDrop) {
                name = "drop";
                await this.checkDrop();
            }
        } catch (err) {
            if (this.options.errorOutput) {
                console.error(`Error: ${err.message}`);
                console.error(" - Continue");

                this.getErrorMacro(name);
                this.setErrorMacro();
                await this.checkOutput();
            } else {
                throw err;
            }
        }

        await this.rename();
    }

    async checkInput() {
        console.log("Check Input...");

        if (this.options.input === void 0) {
            throw new Error("Invalid input");
        }

        if (!await fse.pathExists(this.options.input)) {
            throw new Error("Can't find input");
        }
    }

    async getInformation() {
        console.log("Get Information...");

        const stats = await fse.stat(this.options.input);

        await new Promise((resolve, reject) => {
            const readableStream = fse.createReadStream(this.options.input, {
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
                const information = {};

                for (const tsDescriptor of tsDescriptors) {
                    switch (tsDescriptor.getDescriptorTag()) {
                        case 0x48: {
                            // Service event
                            const objDescriptor = tsDescriptor.decode();

                            information.serviceName = new aribts.TsChar(objDescriptor.service_name).decode();

                            break;
                        }

                        case 0x4D: {
                            // Short event
                            const objDescriptor = tsDescriptor.decode();

                            information.eventName = new aribts.TsChar(objDescriptor.event_name).decode();

                            break;
                        }

                        case 0xC3: {
                            // Partial transport stream time
                            const objDescriptor = tsDescriptor.decode();

                            information.startTime = new aribts.TsDate(objDescriptor.event_start_time).decode();

                            break;
                        }
                    }
                }

                if (!information.hasOwnProperty("serviceName") || !information.hasOwnProperty("eventName") || !information.hasOwnProperty("startTime")) return;

                this.information = information;

                console.log(" - Information");
                console.log(`   - serviceName: ${this.information.serviceName}`);
                console.log(`   - eventName  : ${this.information.eventName}`);
                console.log(`   - startTime  : ${this.information.startTime}`);

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

                this.information = {
                    serviceName: services[sid].serviceName,
                    eventName: tsEvent.getShortEvent().eventName,
                    startTime: eventInfo.startTime,
                    duration: eventInfo.duration
                };

                console.log(" - Information");
                console.log(`   - serviceName: ${this.information.serviceName}`);
                console.log(`   - eventName  : ${this.information.eventName}`);
                console.log(`   - startTime  : ${this.information.startTime}`);

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

    getService() {
        console.log("Get Service...");

        let serviceName = this.information.serviceName;

        // Convert from full to half
        serviceName = toHalf(serviceName);

        // Find service
        const service = this.services.find(_service => serviceName.includes(toHalf(_service.name)));

        if (service === void 0) {
            if (this.options.checkService) {
                throw new Error("Can't find service");
            } else {
                console.log("Can't find service");
                return;
            }
        }

        // Update options
        for (const key of ["checkTime", "checkDuplication", "checkDrop", "startTimeOffset", "durationOffset"]) {
            if (service.hasOwnProperty(key)) {
                this.options[key] = service[key];
            }
        }

        this.service = {
            channelId: service.channelId,
            channelName: service.channelName
        };

        console.log(" - Service");
        console.log(`   - channelId  : ${this.service.channelId}`);
        console.log(`   - channelName: ${this.service.channelName}`);
    }

    async getProgram() {
        console.log("Get Program...");

        const syobocalRss2 = new syobocal.Rss2();
        const syobocalJson = new syobocal.Json();

        let eventName = this.information.eventName;

        // Convert from full to half
        eventName = toHalf(eventName);

        // Replace brackets
        eventName = eventName.replace(/\[.+?\]/g, "");
        eventName = eventName.replace(/【.+?】/g, "");
        eventName = eventName.replace(/<.+?>/g, "");
        eventName = eventName.replace(/\(.+?\)/g, "");
        eventName = eventName.replace(/「(.+?)」/g, " $1 ");
        eventName = eventName.replace(/『(.+?)』/g, " $1 ");

        for (const keyword of this.keywords) {
            if (eventName.includes(keyword.name)) {
                // Replace keywords
                if (keyword.hasOwnProperty("replace")) {
                    eventName = eventName.split(keyword.name).join(keyword.replace);
                }

                // Update options
                for (const key of ["checkTime", "checkDuplication", "checkDrop", "startTimeOffset", "durationOffset"]) {
                    if (keyword.hasOwnProperty(key)) {
                        this.options[key] = keyword[key];
                    }
                }
            }
        }

        // Trim space
        eventName = eventName.trim();

        // Slice
        const spaceIndex = eventName.indexOf(" ");

        eventName = eventName.slice(0, spaceIndex > 0 && spaceIndex < 5 ? spaceIndex : 5);

        console.log(" - Search");
        console.log(`   - title    : ${eventName}`);

        if (this.service !== null) {
            console.log(`   - channelId: ${this.service.channelId}`);
        }

        let programs;
        try {
            programs = await syobocalRss2.request({
                start: new Date(this.information.startTime.getTime() - 60 * 60 * 1000),
                end: new Date(this.information.startTime.getTime() + 60 * 60 * 1000),
                usr: "node_syobocal"
            });
        } catch (err) {
            console.log(" - Retry after 60 seconds...");

            await new Promise(resolve => setTimeout(() => resolve(), 60 * 1000));

            programs = await syobocalRss2.request({
                start: new Date(this.information.startTime.getTime() - 60 * 60 * 1000),
                end: new Date(this.information.startTime.getTime() + 60 * 60 * 1000),
                usr: "node_syobocal"
            });
        }

        programs = programs.filter(program => toHalf(program.Title).replace(/ /g, "").includes(eventName));

        if (this.service !== null) {
            programs = programs.filter(program => program.ChID === this.service.channelId);
        }

        if (programs.length === 0) {
        	try {
	            programs = await syobocalRss2.request({
	                start: new Date(this.information.startTime.getTime()),
	                end: new Date(this.information.startTime.getTime() + this.information.duration * 1000),
	                usr: "node_syobocal"
	            });
	        } catch (err) {
	            console.log(" - Retry after 60 seconds...");

	            await new Promise(resolve => setTimeout(() => resolve(), 60 * 1000));

	            programs = await syobocalRss2.request({
	                start: new Date(this.information.startTime.getTime()),
	                end: new Date(this.information.startTime.getTime() + this.information.duration * 1000),
	                usr: "node_syobocal"
	            });
	        }
	        if (this.service !== null) {
	            programs = programs.filter(program => program.ChID === this.service.channelId);
	        }
	        if (programs.length === 0)
            	throw new Error("Can't find program");
        }

        const program = programs.reduce((prev, current) => {
            const prev_diff = Math.abs(this.information.startTime.getTime() - prev.StTime.getTime());
            const current_diff = Math.abs(this.information.startTime.getTime() - current.StTime.getTime());

            return prev_diff > current_diff ? current : prev;
        });

        let titles;

        try {
            titles = await syobocalJson.getTitleFull({
                TID: program.TID
            });
        } catch (err) {
            console.log(" - Retry after 60 seconds...");

            await new Promise(resolve => setTimeout(() => resolve(), 60 * 1000));

            titles = await syobocalJson.getTitleFull({
                TID: program.TID
            });
        }

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
            channelName: program.ChName
        };

        console.log(" - Program");
        console.log(`   - title      : ${this.program.title}`);
        console.log(`   - subTitle   : ${this.program.subTitle}`);
        console.log(`   - count      : ${this.program.count}`);
        console.log(`   - channelName: ${this.program.channelName}`);
    }

    async checkTime() {
        console.log("Check Time...");

        const stats = await fse.stat(this.options.input);

        const actualStartTime = await new Promise((resolve, reject) => {
            const readableStream = fse.createReadStream(this.options.input);

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
            const readableStream = fse.createReadStream(this.options.input);

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

            const readableStream = fse.createReadStream(this.options.input, {
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

        if (actualStartTime > programStartTime + this.options.startTimeOffset * 1000) {
            throw new Error(`Invalid start time(actual: ${actualStartTime}, program: ${programStartTime}, offset: ${this.options.startTimeOffset})`);
        }

        if (actualDuration < programDuration + this.options.durationOffset * 1000) {
            throw new Error(`Invalid duration(actual: ${Math.floor(actualDuration / 1000)} sec, program: ${Math.floor(programDuration / 1000)} sec, offset: ${this.options.durationOffset})`);
        }
    }

    getMacro() {
        console.log("Get Macro...");

        const re = /[<>:"\/\\\|\?\*]/g;

        this.macro = {
            original: path.parse(this.options.input).name,
            title: this.program.title.replace(re, toFull),
            shortTitle: this.program.shortTitle.replace(re, toFull) || this.program.title.replace(re, toFull),
            subTitle: this.program.subTitle === null ? "" : this.program.subTitle.replace(re, toFull),
            titleYomi: this.program.titleYomi.replace(re, toFull),
            titleEnglish: this.program.titleEnglish.replace(re, toFull),
            firstStartYYYY: this.program.firstStartYear === null ? "" : this.program.firstStartYear.toString(),
            firstStartYY: this.program.firstStartYear === null ? "" : this.program.firstStartYear.toString().slice(-2),
            firstStartM: this.program.firstStartMonth === null ? "" : this.program.firstStartMonth.toString(),
            firstStartMM: this.program.firstStartMonth === null ? "" : this.program.firstStartMonth.toString().padStart(2, "0"),
            firstStartQuarter: this.program.firstStartMonth === null ? "" : (Math.floor((this.program.firstStartMonth - 1) / 3) + 1).toString(),
            firstStartSeason: this.program.firstStartMonth === null ? "" : ["春", "夏", "秋", "冬"][Math.floor((this.program.firstStartMonth - 1) / 3)],
            firstEndYYYY: this.program.firstEndYear === null ? "" : this.program.firstEndYear.toString(),
            firstEndYY: this.program.firstEndYear === null ? "" : this.program.firstEndYear.toString().slice(-2),
            firstEndM: this.program.firstEndMonth === null ? "" : this.program.firstEndMonth.toString(),
            firstEndMM: this.program.firstEndMonth === null ? "" : this.program.firstEndMonth.toString().padStart(2, "0"),
            firstEndQuarter: this.program.firstEndMonth === null ? "" : (Math.floor((this.program.firstEndMonth - 1) / 3) + 1).toString(),
            firstEndSeason: this.program.firstEndMonth === null ? "" : ["春", "夏", "秋", "冬"][Math.floor((this.program.firstEndMonth - 1) / 3)],
            count: this.program.count === null ? "" : this.program.count.toString(),
            count2: this.program.count === null ? "" : this.program.count.toString().padStart(2, "0"),
            count3: this.program.count === null ? "" : this.program.count.toString().padStart(3, "0"),
            count4: this.program.count === null ? "" : this.program.count.toString().padStart(4, "0"),
            YYYY: this.program.startTime.getFullYear().toString(),
            YY: this.program.startTime.getFullYear().toString().slice(-2),
            M: (this.program.startTime.getMonth() + 1).toString(),
            MM: (this.program.startTime.getMonth() + 1).toString().padStart(2, "0"),
            D: this.program.startTime.getDate().toString(),
            DD: this.program.startTime.getDate().toString().padStart(2, "0"),
            h: this.program.startTime.getHours().toString(),
            hh: this.program.startTime.getHours().toString().padStart(2, "0"),
            m: this.program.startTime.getMinutes().toString(),
            mm: this.program.startTime.getMinutes().toString().padStart(2, "0"),
            s: this.program.startTime.getSeconds().toString(),
            ss: this.program.startTime.getSeconds().toString().padStart(2, "0"),
            _YYYY: this.program.endTime.getFullYear().toString(),
            _YY: this.program.endTime.getFullYear().toString().slice(-2),
            _M: (this.program.endTime.getMonth() + 1).toString(),
            _MM: (this.program.endTime.getMonth() + 1).toString().padStart(2, "0"),
            _D: this.program.endTime.getDate().toString(),
            _DD: this.program.endTime.getDate().toString().padStart(2, "0"),
            _h: this.program.endTime.getHours().toString(),
            _hh: this.program.endTime.getHours().toString().padStart(2, "0"),
            _m: this.program.endTime.getMinutes().toString(),
            _mm: this.program.endTime.getMinutes().toString().padStart(2, "0"),
            _s: this.program.endTime.getSeconds().toString(),
            _ss: this.program.endTime.getSeconds().toString().padStart(2, "0"),
            channelName: this.program.channelName.replace(re, toFull),
            userChannelName: this.service === null ? "" : this.service.channelName.replace(re, toFull)
        };
    }

    setMacro() {
        console.log("Set Macro...");

        let output = this.replaceMacro(this.options.output);

        output = path.resolve(output);

        this.output = output;

        console.log(` - Output: ${this.output}`);
    }

    getErrorMacro(name) {
        console.log("Get Error Macro...");

        this.macro = {
            original: path.parse(this.options.input).name,
            error: name
        };
    }

    setErrorMacro() {
        console.log("Set Error Macro...");

        let output = this.replaceMacro(this.options.errorOutput);

        output = path.resolve(output);

        this.output = output;

        console.log(` - Output: ${this.output}`);
    }

    async checkDuplication() {
        console.log("Check Duplication...");

        if (await fse.pathExists(this.output)) {
            throw new Error("File already exists");
        }
    }

    async checkOutput() {
        console.log("Check Output...");

        if (await fse.pathExists(this.output)) {
            let output = this.output;

            const parsed = path.parse(output);

            output = path.format({
                dir: parsed.dir,
                name: `${parsed.name}_${Math.random().toString(16).slice(2)}`,
                ext: parsed.ext
            });

            this.output = output;

            console.log(` - Output (Checked): ${this.output}`);
        }
    }

    async checkDrop() {
        console.log("Check Drop...");

        const stats = await fse.stat(this.options.input);
        const size = stats.size;

        await new Promise((resolve, reject) => {
            let bytesRead = 0;
            let count = 0;

            const readableStream = fse.createReadStream(this.options.input);
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
                console.log(` - Find drop at PID 0x${pid.toString(16)}`);

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

    async rename() {
        console.log("Rename...");
		if (this.options.dryRun === true) {
			console.log(this.output);
		}else{
        	await fse.move(this.options.input, this.output);
		}
    }

    replaceMacro(str) {
        const macro = this.macro;

        const re = /\${(.*?)}/g;
        const re2 = /\(\[(.*?)\]\)/g;

        function replacer(match, p1) {
            if (!macro.hasOwnProperty(p1)) return match;

            return macro[p1];
        }

        function replacer2(match, p1) {
            let flag = false;

            p1 = p1.replace(re, _macth => {
                _macth = _macth.replace(re, replacer);

                if (_macth === "") flag = true;

                return _macth;
            });

            if (flag) return "";

            return p1;
        }

        str = str.replace(re2, replacer2);
        str = str.replace(re, replacer);

        return str;
    }
}

module.exports = TsRenamer;

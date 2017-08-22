"use strict";

const child_process = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");

const Renamer = require("./lib/renamer");

const exec = util.promisify(child_process.exec);
const stat = util.promisify(fs.stat);
const readdir = util.promisify(fs.readdir);
const appendFile = util.promisify(fs.appendFile);

async function log(type, file, message) {
    if (process.env.log_file === void 0) return;

    await appendFile(process.env.log_file, `[${type}] "${file}", ${message}${os.EOL}`, "utf8");
}

(async () => {
    const options = {
        parent: process.env.parent || "",
        dir: process.env.dir || "",
        file: process.env.file || "",
        error_dir: process.env.error_dir || "",
        error_file: process.env.error_file || "",
        packet_size: Number.parseInt(process.env.packet_size, 10) || 188,
        check_service: process.env.check_service === "true",
        check_time: process.env.check_time === "true",
        check_dup: process.env.check_dup === "true",
        check_drop: process.env.check_drop === "true"
    };

    let args;

    if (process.platform === "win32" && process.env.get_args === "true") {
        const result = await exec(`chcp 65001 > nul&&powershell -Command "(Get-WmiObject Win32_Process -filter \\"ProcessId=${process.pid}\\").ParentProcessId"&&chcp 932 > nul`);
        const parentPid = Number.parseInt(result.stdout.replace(/\r\n|\r|\n/g, ""), 10);

        const result2 = await exec(`chcp 65001 > nul&&powershell -Command "(Get-WmiObject Win32_Process -filter \\"ProcessId=${parentPid}\\").CommandLine"&&chcp 932 > nul`);
        const cmdCommandLine = result2.stdout.replace(/\r\n|\r|\n/g, "");
        const batCommandLine = cmdCommandLine.match(/^.*?cmd\.exe \/c "(.*?)"$/)[1];

        const regExp = /"(.*?)"|([^ ]+)/g;
        const batArgs = [];
        let batArg;

        while ((batArg = regExp.exec(batCommandLine)) !== null) {
            batArgs.push(batArg[1] !== void 0 ? batArg[1] : batArg[2]);
        }

        batArgs.shift();

        args = batArgs;
    } else {
        args = process.argv.slice(2);
    }

    for (const arg of args) {
        let argStats;

        try {
            argStats = await stat(arg);
        } catch (err) {
            await log("error", arg, "File or Directory does not exist");

            continue;
        }

        const files = [];

        if (argStats.isFile()) {
            if (/\.(ts|m2ts)$/.test(arg)) {
                files.push(arg);
            }
        } else {
            const children = (await readdir(arg)).map(childName => path.join(arg, childName));

            for (const child of children) {
                let childStats;

                try {
                    childStats = await stat(child);
                } catch (err) {
                    await log("error", child, "File or Directory does not exist");

                    continue;
                }

                if (childStats.isFile()) {
                    if (/\.(ts|m2ts)$/.test(child)) {
                        files.push(child);
                    }
                }
            }
        }

        for (const file of files) {
            console.log(`[ ${file} ]`);

            const renamer = new Renamer(Object.assign({ input: file }, options));

            try {
                await renamer.execute();
            } catch (err) {
                console.error(`Error: ${err.message}`);
                console.log("");

                await log("error", file, err.message);

                process.exitCode = 1;

                continue;
            }

            console.log("File is renamed");
            console.log("");

            await log("info", file, "File is renamed");
        }
    }
})();

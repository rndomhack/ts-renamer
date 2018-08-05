"use strict";

const path = require("path");

const fse = require("fs-extra");
const program = require("commander");

const TsRenamer = require("./lib/ts_renamer");
const settings = require("./settings/settings");

async function readdirp(_path, level = 0) {
    const files = [];

    const items = (await fse.readdir(_path)).map(name => path.join(_path, name));

    for (const item of items) {
        const stats = await fse.stat(item);

        if (stats.isFile()) {
            files.push(item);
        } else if (level > 0) {
            files.push(...await readdirp(item, level - 1));
        }
    }

    return files;
}

program
    .usage("[options] <input>...")
    .option("-o, --output <path>", "Output file path")
    .option("-O, --error-output <path>", "Output file path (when error)")
    .option("-p, --packet-size <value>", "Packet size", Number.parseInt)
    .option("-r, --recursive-level <value>", "Recursive level", Number.parseInt)
    .option("-n, --dry-run", "Print re-named filename instead of really do the re-naming.")
    .option(`--${settings.options.checkService ? "no-" : ""}check-service`, `${settings.options.checkService ? "Disable" : "Enable"} check service`)
    .option(`--${settings.options.checkTime ? "no-" : ""}check-time`, `${settings.options.checkTime ? "Disable" : "Enable"} check time`)
    .option(`--${settings.options.checkDuplication ? "no-" : ""}check-duplication`, `${settings.options.checkDuplication ? "Disable" : "Enable"} check duplication`)
    .option(`--${settings.options.checkDrop ? "no-" : ""}check-drop`, `${settings.options.checkDrop ? "Disable" : "Enable"} check drop`)
    .option("--start-time-offset <value>", "Start time offset (check time)", Number.parseInt)
    .option("--duration-offset <value>", "Duration offset (check time)", Number.parseInt)
    .parse(process.argv);

(async () => {
    if (program.args.length === 0) {
        program.outputHelp();

        return;
    }

    const options = Object.assign(settings.options, program);

    let files = [];

    for (const arg of program.args) {
        try {
            const stats = await fse.stat(arg);

            if (stats.isFile()) {
                files.push(arg);
            } else {
                files.push(...await readdirp(arg, options.recursiveLevel));
            }
        } catch (err) {
            console.error(`Error: ${err.message}\n`);

            process.exitCode = 1;

            continue;
        }
    }

    files = files.filter(file => /^\.(ts|m2ts)$/.test(path.extname(file)));

    for (const file of files) {
        console.log(`[ ${file} ]`);

        const tsRenamer = new TsRenamer({
            options: Object.assign({ input: file }, options),
            keywords: settings.keywords,
            services: settings.services
        });

        try {
            await tsRenamer.execute();
        } catch (err) {
            console.error(`Error: ${err.message}\n`);

            process.exitCode = 1;

            continue;
        }

        console.log("File is renamed\n");
    }
})();

"use strict";

const cli = require("cli");
const Renamer = require("./lib/renamer");

cli.parse({
    input: [false, "Input file", "string", ""],
    parent: [false, "Parent folder", "string", ""],
    dir: [false, "Directory name", "string", ""],
    file: [false, "File name", "string", ""],
    error_dir: [false, "Directory name when error occurs", "string", ""],
    error_file: [false, "File name when error occurs", "string", ""],
    packet_size: [false, "Packet size", "number", 188],
    check_service: [false, "Check service", "boolean", false],
    check_time: [false, "Check time", "boolean", false],
    check_dup: [false, "Check duplication", "boolean", false],
    check_drop: [false, "Check drop", "boolean", false]
});

cli.main(async (args, options) => {
    if (options.input === "") {
        console.log(cli.getUsage());

        return;
    }

    const renamer = new Renamer(options);

    try {
        await renamer.execute();
    } catch (err) {
        console.error(`Error: ${err.message}`);

        process.exitCode = 1;

        return;
    }

    console.log("File is renamed");
});

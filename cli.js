"use strict";

const cli = require("cli");
const Renamer = require("./lib/renamer");

cli.parse({
    input: [false, "Input file", "string", ""],
    parent: [false, "Parent folder", "string", ""],
    dir: [false, "Directory name", "string", ""],
    file: [false, "File name", "string", ""],
    packet_size: [false, "Packet size", "number", 188],
    check_service: [false, "Check service", "boolean", false],
    check_dup: [false, "Check duplication", "boolean", false],
    check_drop: [false, "Check drop", "boolean", false]
});

cli.main((args, options) => {
    if (options.input === "") {
        console.log(cli.getUsage());

        return;
    }

    const renamer = new Renamer(options);

    renamer.execute().then(() => {
        console.log("Successful");
    }).catch(err => {
        console.error(`Error: ${err.message}`);

        process.exitCode = 1;
    });
});

"use strict";

const cli = require("cli");
const Renamer = require("./lib/renamer");

cli.parse({
    input: ["i", "Input file", "string", ""],
    parent: ["p", "Parent folder", "string", ""],
    dir: ["d", "Directory name", "string", ""],
    file: ["f", "File name", "string", ""],
    check: ["c", "Check file drop", "boolean", false],
    strict: ["s", "Strict mode", "boolean", false]
});

cli.main((args, options) => {
    if (options.input === "") {
        console.log(cli.getUsage());

        return;
    }

    var renamer = new Renamer(options);

    renamer.execute().then(() => {
        console.log("Successful");
    }).catch(err => {
        console.error("Error: " + err.message);

        process.exitCode = 1;
    });
});

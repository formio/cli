require('colors');
var fs = require('fs-extra');
var program = require('commander');

// Show welcome.
require(__dirname + '/src/welcome/welcome');

// Register all the commands.
require(__dirname + '/commands/commands')(program, function(err) {
    if (err) {
        console.log(err.toString().red);
    }
});

// Parse the command line tool.
program.parse(process.argv.splice(1));
require('colors');
var fs = require('fs-extra');
var program = require('commander');

// Print the welcome screen.
console.log(fs.readFileSync(__dirname + '/welcome.txt').toString().green);

// Register all the commands.
require(__dirname + '/commands/commands')(program, function(err) {
    if (err) {
        console.log(err.toString().red);
    }
});

// Parse the command line tool.
program.parse(process.argv.splice(1));
require('colors');
var fs = require('fs-extra');

// Create the Form.io service.
var formio = require('formio-service')({
    formio: 'http://formio.localhost:3000',
    api: 'http://api.localhost:3000'
});

var program = require('commander');

// Print the welcome screen.
console.log(fs.readFileSync('./welcome.txt').toString().green);

// Register all the commands.
require('./commands/commands')(formio, program, function(err) {
    if (err) {
        console.log(err.toString().red);
    }
});

// Parse the command line tool.
program.parse(process.argv.splice(1));
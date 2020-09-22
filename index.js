'use strict';

require('colors');
const { program } = require('commander');
var pkg = require(__dirname + '/package.json');

// Register all the commands.
require(__dirname + '/commands/commands')(program, function(err) {
  if (err) {
    console.log(err.toString().red);
  }
});

// The version of the CLI.
program.version(pkg.version);

// Show welcome.
require(__dirname + '/src/welcome/welcome')(function() {
  // Parse the command line tool.
  program.parse(process.argv);
});

require('colors');
var program = require('commander');

// Register all the commands.
require(__dirname + '/commands/commands')(program, function(err) {
    if (err) {
        console.log(err.toString().red);
    }
});

// Show welcome.
require(__dirname + '/src/welcome/welcome')(function() {

    // Parse the command line tool.
    program.parse(process.argv.splice(1));
});

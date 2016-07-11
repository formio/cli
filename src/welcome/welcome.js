'use strict';

var fs = require('fs-extra');
require('colors');

module.exports = function(next) {
  console.log('');
  var rl = require('readline').createInterface({
    input: fs.createReadStream(__dirname + '/logo.txt')
  });

  rl.on('line', function(line) {
    console.log(
      line.substring(0,4) +
      line.substring(4, 30).cyan.bold +
      line.substring(30, 33) +
      line.substring(33, 42).green.bold +
      line.substring(42)
    );
  });

  rl.on('close', function() {
    // Print the welcome screen.
    console.log('');
    console.log(fs.readFileSync(__dirname + '/welcome.txt').toString().green);
    next();
  });
};

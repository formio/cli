'use strict';

var exec = require('child_process').exec;

module.exports = function(command, next) {
  var child = exec(command);
  var error = null;
  console.log('Executing ' + command + '...');
  child.stdout.on('data', function(data) {
    console.log(data);
  });
  child.stderr.on('data', function(err) {
    error = err;
  });
  child.on('close', function() {
    next(error);
  });
};

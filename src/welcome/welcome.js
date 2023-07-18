'use strict';

var fs = require('fs-extra');
require('colors');

module.exports = function(next) {
  console.log('');
  console.log(fs.readFileSync(__dirname + '/logo.txt').toString());
  console.log('');
  console.log(fs.readFileSync(__dirname + '/welcome.txt').toString().green);
  next();
};

'use strict';

var fs = require('fs');

module.exports = function(options, next) {
  try {
    options.template = JSON.parse(fs.readFileSync(options.project));
    return next();
  }
  catch (err) {
    return next(err);
  }
};

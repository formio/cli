'use strict';

var express = require('express');
var app = express();

module.exports = function(options, next) {
  app.use(express.static(options.directory));
  options.port = options.port || 8081;
  var location = 'http://localhost:' + options.port;
  console.log('Serving application at ' + location.green);
  app.listen(options.port);
  next();
};

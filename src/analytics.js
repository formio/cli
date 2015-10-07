var ua = require('universal-analytics');
var visitor = ua('UA-58453303-2');
module.exports = function(command) {
  return function(options, next) {
      visitor.event({
          ec: "Command",
          ea: command,
          el: "parameter",
          ev: options.param
      }).send();
      next();
  };
};
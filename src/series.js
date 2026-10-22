'use strict';

var async = require('async');
var _ = require('lodash');
module.exports = function(series, next) {
  return function() {
    // The action arguments. Commander passes the arguments, then the options, then the command.
    var args = Array.prototype.slice.call(arguments);
    var command = args.pop();
    var options = (command && typeof command.opts === 'function') ? args.pop() : command;
    options.params = args;
    var actionSeries = [];
    _.each(series, function(action) {
      actionSeries.push(_.partial(action, options));
    });

    // Perform a series execution.
    async.series(actionSeries, function(err, result) {
      next(err, result);
    });
  };
};

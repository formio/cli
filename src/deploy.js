'use strict';

var async = require('async');
var _ = require('lodash');
var loadTemplate = require(__dirname + '/loadTemplate');
var exportTemplate = require(__dirname + '/exportTemplate');
var importTemplate = require(__dirname + '/importTemplate');

module.exports = function(options, next) {
  var steps = [];

  // Setup the source options.
  var srcOptions = _.clone(options);
  srcOptions.project = options.params[0];
  srcOptions.formio = options.srcFormio;
  if (srcOptions.project.indexOf('.json') !== -1) {
    steps.push(_.partial(loadTemplate, srcOptions));
  }
  else {
    steps.push(_.partial(exportTemplate, srcOptions));
  }

  // Setup the destination options.
  var dstOptions = _.clone(options);
  dstOptions.project = options.params[1];
  dstOptions.formio = options.formio;

  // Copy the template from source to destination.
  steps.push(_.partial(function(src, dst, next) {
    dst.template = src.template;
    next();
  }, srcOptions, dstOptions));

  // Import the template into the destination.
  steps.push(_.partial(importTemplate, dstOptions));
  async.series(steps, next);
};

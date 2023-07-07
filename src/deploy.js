'use strict';

const async = require('async');
const _ = require('lodash');
const loadTemplate = require(__dirname + '/loadTemplate');
const exportTemplate = require(__dirname + '/exportTemplate');
const importTemplate = require(__dirname + '/importTemplate');

module.exports = function(options, next) {
  const steps = [];

  // Setup the source options.
  const srcOptions = _.clone(options.srcOptions);
  srcOptions.project = options.params[0];
  if (srcOptions.project.indexOf('.json') !== -1) {
    steps.push(_.partial(loadTemplate, srcOptions));
  }
  else {
    steps.push(_.partial(exportTemplate, srcOptions));
  }

  // Setup the destination options.
  const dstOptions = _.clone(options.dstOptions);
  dstOptions.project = options.params[1];

  // Copy the template from source to destination.
  steps.push(_.partial(function(src, dst, next) {
    dst.template = src.template;
    next();
  }, srcOptions, dstOptions));

  // Import the template into the destination.
  steps.push(_.partial(importTemplate, dstOptions));
  async.series(steps, next);
};

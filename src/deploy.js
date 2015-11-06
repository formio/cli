var url = require('url');
var async = require('async');
var _ = require('lodash');
var loadTemplate = require(__dirname + '/loadTemplate');
var authenticate = require(__dirname + '/authenticate');
var exportTemplate = require(__dirname + '/exportTemplate');
var importTemplate = require(__dirname + '/importTemplate');
var checkProject = require(__dirname + '/checkProject');
module.exports = function(options, next) {
  var steps = [];

  var setOptions = function(options, serverOptions, done) {
    // Reset everything so we can authenticate against a new server.
    delete options.host;
    delete options.protocol;
    delete options.primary;
    delete options.username;
    delete options.password;
    delete options.formio;
    if (options.hasOwnProperty(part + 'Username')) {
      options.username = options[part + 'Username'];
    }
    if (options.hasOwnProperty(part + 'Password')) {
      options.password = options[part + 'Password'];
    }
    var index = (part === 'src' ? 0 : 1);

    done();
  }

  var getServerOptions = function(options) {
    if (options.project.indexOf('http') === 0) {
      var urlObject = url.parse(options.project);
      // Check if this is the format of http://project.server.com or http://project.localhost
      var hostParts = urlObject.hostname.split('.');
      var pathParts = urlObject.pathname.split('/');
      // Always starts with an empty element. Throw it away.
      if (pathParts.length > 0) {
        pathParts.shift();
      }
      if (hostParts.length > 3 || (hostParts.length == 2 && hostParts[1] == 'localhost')) {
        options.projectName = hostParts.shift();
        urlObject.hostname = hostParts.join('.');
        urlObject.host = urlObject.hostname + (urlObject.port != 80 ? ':' + urlObject.port : '');
      }
      // Check if this is the format of http://server.com/project/{projectId}
      else if(pathParts.length > 1 && pathParts[0] == 'project') {
        options.projectId = pathParts[1];
      }
      urlObject.path = urlObject.pathname = '';
      options.server = url.format(urlObject);
      options.host = urlObject.host;
      // Slice gets rid of the ":" at the end.
      options.protocol = urlObject.protocol.slice(0, -1);
    }
    else {
      options.projectName = options.project;
      options.project = 'https://' + options.project + '.form.io';
    }
    return options;
  }

  var srcOptions = _.clone(options);
  srcOptions.project = options.params[0];
  // Project could be a local file or a formio project.
  if (srcOptions.project.indexOf('.json') !== -1) {
    steps.push(_.partial(loadTemplate, srcOptions));
  }
  else {
    // Remove any trailing slash.
    srcOptions.project.replace(/\/$/, "");
    srcOptions = getServerOptions(srcOptions);
    if (srcOptions.srcUsername && srcOptions.srcPassword) {
      srcOptions.username = srcOptions.srcUsername;
      srcOptions.password = srcOptions.srcPassword;
    }

    steps.push(_.partial(authenticate, srcOptions));
    steps.push(_.partial(exportTemplate, srcOptions));
  }

  var dstOptions = _.clone(options);
  dstOptions.project = options.params[1];
  dstOptions = getServerOptions(dstOptions);
  if (dstOptions.dstUsername && dstOptions.dstPassword) {
    dstOptions.username = dstOptions.dstUsername;
    dstOptions.password = dstOptions.dstPassword;
  }
  // Copy the template from source to destination.
  steps.push(_.partial(function(src, dst, next) { dst.template = src.template; next(); }, srcOptions, dstOptions));
  // Authenticate again to the destination.
  steps.push(_.partial(authenticate, dstOptions));
  steps.push(_.partial(checkProject, dstOptions));
  steps.push(_.partial(importTemplate, dstOptions));
  async.series(steps, next);
};
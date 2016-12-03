'use strict';

var url = require('url');
var async = require('async');
var formioUtils = require('formio-utils');
var authenticate = require(__dirname + '/authenticate');
var _ = require('lodash');

module.exports = function(options, next) {
  // Get the form.io service.
  var formio = require('./formio')(options);
  var type = options.params[0];
  var src = options.params[1].split(',');
  var dest = options.params[2];

  if (!type) {
    return next('You must provide a type.');
  }

  if (!src.length) {
    return next('You must provide a source form to copy.');
  }

  if (!dest) {
    return next('You must provide a destination.');
  }

  var getServer = function(path) {
    var parts = path.match(/^(http[s]?:\/\/)([^\/]+)\/(.*)/);
    if (parts.length >= 2) {
      return parts[2];
    }
    return '';
  };

  var getServerOptions = function(path, options) {
    if (path.indexOf('http') === 0) {
      var urlObject = url.parse(path);
      // Check if this is the format of http://project.server.com or http://project.localhost
      var hostParts = urlObject.hostname.split('.');
      var pathParts = urlObject.pathname.split('/');
      // Always starts with an empty element. Throw it away.
      if (pathParts.length > 0) {
        pathParts.shift();
      }
      if (hostParts.length === 3 || (hostParts.length === 2 && hostParts[1] === 'localhost')) {
        options.projectName = hostParts.shift();
        urlObject.hostname = hostParts.join('.');
        urlObject.host = urlObject.hostname + (urlObject.port ? ':' + urlObject.port : '');
      }
      // Check if this is the format of http://server.com/project/{projectId}
      else if (pathParts.length > 1 && pathParts[0] === 'project') {
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

  // Set up the steps.
  var steps = [];

  var srcOptions = _.clone(options);
  getServerOptions(src[0], srcOptions);
  var dstOptions = _.clone(options);
  getServerOptions(dest, dstOptions);
  // If using the same destination server, allow using the same credentials.
  if (srcOptions.server === dstOptions.server) {
    dstOptions.key = options.key;
    dstOptions.username = options.username;
    dstOptions.password = options.password;
  }
  else {
    // If servers don't match, clear out the source credentials.
    delete dstOptions.username;
    delete dstOptions.password;
    delete dstOptions.key;
  }
  if (dstOptions.dstKey) {
    dstOptions.key = dstOptions.dstKey;
  }
  else if (dstOptions.dstUsername && dstOptions.dstPassword) {
    dstOptions.username = dstOptions.dstUsername;
    dstOptions.password = dstOptions.dstPassword;
  }
  getServerOptions(dest, dstOptions);

  steps.push(_.partial(authenticate, srcOptions));

  // Load forms.
  steps.push(_.partial(function(srcOptions, next) {
    if (type === 'form' || type === 'resource') {
      var components = [];
      var tags = [];
      var keys = {};
      var source = {};
      async.eachSeries(src, function(formUrl, done) {
        console.log('Loading form ' + formUrl);
        (new formio.Form(formUrl)).load().then(function(form) {
          source = form.toJson();

          // Ensure each component has a unique key.
          formioUtils.eachComponent(source.components, function(component) {
            if (component.key) {
              var i = 0;
              var key = component.key;
              while (keys.hasOwnProperty(key)) {
                i++;
                key = component.key + i;
              }
              component.key = key;
              keys[key] = true;
            }
          });

          // Append the components.
          tags = tags.concat(source.tags);
          components = components.concat(source.components);
          done();
        }).catch(done);
      }, function(err) {
        if (err) {
          return next(err);
        }
        srcOptions.tags = tags;
        srcOptions.components = components;
        next();
      });
    }
  }, srcOptions));

  // Copy components from old to new
  steps.push(_.partial(function(src, dst, next) {
    dst.tags = src.tags;
    dst.components = src.components;
    delete dst.formio;
    next();
  }, srcOptions, dstOptions));

  // Reauthenticate if needed.
  steps.push(_.partial(authenticate, dstOptions));

  // Save to new form
  steps.push(_.partial(function(dst, next) {
    console.log('Saving components to destination ' + type + ' ' + dest);
    var parts = dest.match(/^(http[s]?:\/\/)([^\/]+)\/(.*)/);
    if (parts.length < 4) {
      return next('Invalid destination: Must contain a ' + type + ' path');
    }

    // Load the form (if it exists)
    var project = parts[1] + parts[2];
    (new formio.Project(project)).form(parts[3]).then(function(form) {
      if (form) {
        console.log('Updating existing form');
        form.form.components = dst.components;
        form.form.tags = dst.tags;
        form.save().then(function() {
          console.log('Done!');
          next();
        }).catch(next);
      }
      else {
        console.log('Creating new form');
        (new formio.Form(project + '/form')).create({
          title: 'Copy of ' + source.title,
          name: _.camelCase(parts[3]),
          path: parts[3],
          type: type,
          tags: dstOptions.tags,
          components: components
        }).then(function() {
          console.log('Done!');
          next();
        }).catch(function(err) {
          console.log(err);
          next(err);
        });
      }
    });
  }, dstOptions));

  async.series(steps, next);
};

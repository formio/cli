'use strict';

/**
 * Provides a way to authenticate commands against Form.io
 */
var async = require('async');
var url = require('url');
var prompt = require('prompt');
prompt.start();
module.exports = function(config) {
  /**
   * Returns the server options.
   *
   * @param path
   * @param options
   * @returns {*}
   */
  var getServerOptions = function(path, options) {
    if (path.indexOf('http') === 0) {
      var urlObject = url.parse(path);
      var pathnameParts = urlObject.pathname.split('/').filter(Boolean);
      // If the url contains 'project' (ex. http://localhost:3000/project/63ac4f3768baf92d9bb0106f)
      // then we extract project id from it, else - get the project name
      if (urlObject.href.match(/http[s]?:\/\/[^/]+\/project\//)) {
        options.projectId = pathnameParts[1];
      }
      else {
        options.projectName = pathnameParts[0];
      }

      options.server = urlObject.href.replace(urlObject.pathname, '');
      options.host = urlObject.host;
      // Slice gets rid of the ":" at the end.
      options.protocol = urlObject.protocol.slice(0, -1);
    }
    else {
      options.projectName = options.project;
      options.project = 'https://' + options.project + '.form.io';
    }

    return options;
  };

  /**
   * Perform an authentication.
   *
   * @param options
   * @param next
   * @returns {*}
   */
  var authenticate = function(text, options, next) {
    // Let them know what is going on.
    console.log('');
    var serverName = text;
    if (serverName) {
      serverName += '::';
    }
    serverName += options.server + '.';
    console.log('This action requires a login to '.green + serverName.green);

    // If the API Key is provided.
    if (options.key || options.adminKey || (options.srcAdminKey && options.dstAdminKey)) {
      console.log('An API Key was provided for authentication');
      console.log('');
      return next(null);
    }

    if (options.server === 'https://form.io') {
      console.log('You can create a free account by going to https://portal.form.io/#/auth/register'.green);
    }

    return next('Either API key(s) or Admin key(s) should be provided to authenticate');
  };

  var getAuthOptions = function(prefix, options) {
    var authOptions = {
      key: options.key,
      adminKey: options.adminKey,
      srcAdminKey: options.srcAdminKey,
      dstAdminKey: options.dstAdminKey
    };

    if (config && (typeof config[prefix] === 'number')) {
      var paramIndex = config[prefix];
      var url = options.params[paramIndex];
      if (url.substr(0, 4) !== 'http') {
        // This is local and does not need authentication.
        return null;
      }
      getServerOptions(options.params[paramIndex], authOptions);
    }

    if (options[prefix + 'Key']) {
      authOptions.key = options[prefix + 'Key'];
    }
    if (options[prefix + 'AdminKey']) {
      authOptions.adminKey = options[prefix + 'AdminKey'];
    }
    return authOptions;
  };

  var srcOptions = {};
  var dstOptions = {};

  return function(options, done) {
    async.series([
      // Source authentication.
      function(next) {
        if (!config || !config.hasOwnProperty('src')) {
          return next();
        }

        // Authenticate to the source.
        srcOptions = getAuthOptions('src', options);
        if (!srcOptions) {
          return next();
        }

        authenticate('SOURCE', srcOptions, function(err) {
          if (err) {
            return next(err);
          }
          options.srcOptions = srcOptions;
          next();
        });
      },
      // Destination authentication.
      function(next) {
        dstOptions = getAuthOptions('dst', options);
        if (!dstOptions) {
          return next();
        }

        // Use the dstOptions if the servers are the same and the destination does not have creds.
        if (
          srcOptions &&
          srcOptions.server &&
          (srcOptions.server === dstOptions.server) &&
          (!dstOptions.key)
        ) {
          options.dstOptions = srcOptions;
          return next();
        }

        // Authenticate to the destination.
        var text = (srcOptions && srcOptions.server) ? 'DESTINATION' : '';
        authenticate(text, dstOptions, function(err) {
          if (err) {
            return next(err);
          }
          options.dstOptions = dstOptions;
          next();
        });
      }
    ], done);
  };
};

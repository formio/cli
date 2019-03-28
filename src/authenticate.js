'use strict';

/**
 * Provides a way to authenticate commands against Form.io
 */
var _ = require('lodash');
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
  };

  /**
   * Perform an authentication.
   *
   * @param options
   * @param next
   * @returns {*}
   */
  var authenticate = function(text, options, next) {
    var formio = require('./formio')(options);

    // Let them know what is going on.
    console.log('');
    var serverName = text;
    if (serverName) {
      serverName += '::';
    }
    serverName += options.server + '.';
    console.log('This action requires a login to '.green + serverName.green);

    // If the API Key is provided.
    if (options.key) {
      console.log('An API Key was provided. Authenticated as Project Owner.');
      console.log('');
      return next(null, formio);
    }

    if (options.server === 'https://form.io') {
      console.log('You can create a free account by going to https://portal.form.io/#/auth/register'.green);
    }
    console.log('');

    /**
     * Authenticate the user.
     * @param email
     * @param password
     * @private
     */
    var authExecute = function() {
      if (!options.username) {
        return next('Username is required to authenticate.');
      }

      if (!options.password) {
        return next('Password is required to authenticate.');
      }

      // First authenticate.
      console.log('Authenticating to ' + options.server);
      formio.authenticate(options.username, options.password).then(function() {
        console.log('Authentication successful');
        next(null, formio);
      }).catch(next);
    };

    // If they provide the username and password.
    if (options.username && options.password) {
      authExecute();
    }
    else {
      var properties = {};
      if (!options.username) {
        properties.username = {
          message: 'Enter your email',
          required: true
        };
      }

      if (!options.password) {
        properties.password = {
          message: 'Enter your password',
          required: true,
          hidden: true
        };
      }

      // First authenticate into Form.io.
      prompt.get({properties: properties}, function (err, result) {
        if (err) {
          return next(err);
        }
        options = _.assign(options, result);
        authExecute();
      });
    }
  };

  var getAuthOptions = function(prefix, options) {
    var authOptions = {
      username: options.username,
      password: options.password,
      key: options.key
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

    if (options[prefix + 'Password']) {
      authOptions.password = options[prefix + 'Password'];
    }
    if (options[prefix + 'Username']) {
      authOptions.username = options[prefix + 'Username'];
    }
    if (options[prefix + 'Key']) {
      authOptions.key = options[prefix + 'Key'];
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
        authenticate('SOURCE', srcOptions, function(err, formio) {
          if (err) {
            return next(err);
          }
          options.srcFormio = formio;
          next();
        });
      },
      // Destination authentication.
      function(next) {
        dstOptions = getAuthOptions('dst', options);
        if (!dstOptions) {
          return next();
        }

        // Use the source formio if the servers are the same and the destination does not have creds.
        if (
          srcOptions &&
          srcOptions.server &&
          (srcOptions.server === dstOptions.server) &&
          (!dstOptions.key)
        ) {
          options.dstFormio = options.formio = options.srcFormio;
          return next();
        }

        // Authenticate to the destination.
        var text = (srcOptions && srcOptions.server) ? 'DESTINATION' : '';
        authenticate(text, dstOptions, function(err, formio) {
          if (err) {
            return next(err);
          }
          options.dstFormio = options.formio = formio;
          next();
        });
      }
    ], done);
  };
};

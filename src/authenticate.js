/**
 * Provides a way to authenticate commands against Form.io
 */
var _ = require('lodash');
var prompt = require('prompt');
prompt.start();
module.exports = function (options, next) {
  // Get the formio server.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  var formio = require('./formio')(options);

  // Let them know what is going on.
  console.log('');
  console.log('This action requires a login to '.green + options.server.green + '.'.green);
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
  var authExecute = function () {
    if (!options.username) {
      return next('Username is required to authenticate.');
    }

    if (!options.password) {
      return next('Password is required to authenticate.');
    }

    // First authenticate.
    console.log('Authenticating to ' + options.server);
    formio.authenticate(options.username, options.password).then(function () {
      console.log('Authentication successful');
      next();
    }).catch(next);
  }

  // If they provide the username and password.
  if (options.hasOwnProperty('username') && options.hasOwnProperty('password')) {
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
'use strict';

var Formio = require('formio-service');

module.exports = function(options) {
  if (options.formio) {
    return options.formio;
  }

  options.server = options.server || 'https://form.io';
  var parts = options.server.split('://');
  options.protocol = options.protocol || parts[0];
  options.host = options.host || parts[1];
  options.primary = options.primary || 'formio';

  // Create the Form.io service.
  options.formio = Formio({
    formio: options.protocol + '://' + options.primary + '.' + options.host,
    api: options.protocol + '://api.' + options.host,
    key: options.key
  });

  // Return the formio service.
  return options.formio;
};

'use strict';
var JSONStream = require('JSONStream');
var transform = require('stream-transform');
var request = require('request');
module.exports = function(options, next) {
  var src = options.params[0];
  var eachSubmission = options.params[1];

  if (!src) {
    return next('You must provide a source form to load submissions.');
  }

  if (!options.formio) {
    return next('No Form.io server provided');
  }

  // Determine the stream based on the source type.
  var requestHeaders = {
    'content-type': 'application/json'
  };
  if (options.formio.apiKey) {
    requestHeaders['x-token'] = options.formio.apiKey;
  }
  else if (
    options.formio &&
    options.formio.currentUser &&
    options.formio.currentUser.token
  ) {
    requestHeaders['x-jwt-token'] = options.formio.currentUser.token;
  }

  // Create the submission request.
  var stream = request({
    method: 'GET',
    rejectUnauthorized: false,
    url: src + '/submission',
    qs: { limit: '10000000' },
    headers: requestHeaders
  });

  // See if they provided each submission handler.
  if (eachSubmission) {
    try {
      // Require the transformer.
      eachSubmission = require(process.cwd() + '/' + eachSubmission);
    }
    catch (err) {
      console.log(err);
      return;
    }

    // Pipe the record through the each handler.
    var index = 0;
    stream
      .pipe(JSONStream.parse('*'))
      .pipe(transform(function(record, next) {
        eachSubmission(record, index++, options, next);
      }));
  }
  else {
    // Pipe the stream through stdout.
    process.stdout.write('RESULT:');
    stream.pipe(process.stdout);
  }

  // Move on when the stream closes.
  stream.on('close', function() {
    return next();
  });
};

'use strict';
var JSONStream = require('JSONStream');
const path = require('path');

var transform = require('stream-transform');
var request = require('request');

module.exports =  function(options, next) {
  var src = options.params[0];
  var eachSubmission = options.params[1];

  if (!src) {
    return next('You must provide a source form to load submissions.');
  }

  // Determine the stream based on the source type.
  var requestHeaders = {
    'content-type': 'application/json'
  };

  if (options.dstOptions.key) {
    requestHeaders['x-token'] = options.key;
  }
  else if (options.dstOptions.adminKey) {
    requestHeaders['x-admin-key'] = options.adminKey;
  }

  // Create the submission request.
  var stream =  request({
    method: 'GET',
    rejectUnauthorized: false,
    url: src + '/submission',
    qs: {limit: '10000000'},
    headers: requestHeaders
  });

  // See if they provided each submission handler.
  if (eachSubmission) {
    try {
      // Require the transformer.
      eachSubmission = require(path.join(process.cwd(), eachSubmission));
    }
    catch (err) {
      console.log(err);
      return;
    }

    // Pipe the record through the each handler.
    var index = 0;
    stream
      .pipe(JSONStream.parse('*'))
      .pipe(transform(function(record) {
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

'use strict';
var fs = require('fs');
var parse = require('csv-parse');
var JSONStream = require('JSONStream');
var transform = require('stream-transform');
var request = require('request');
module.exports = function(options, next) {
  var src = options.params[0];
  var transformer = options.params[1];
  var dest = options.params[2];

  if (!src) {
    return next('You must provide a source form or CSV to copy.');
  }

  if (!transformer) {
    return next('You must provide a transformer middleware file to perform the migration.');
  }

  if (!dest) {
    return next('You must provide a destination form.');
  }

  try {
    // Require the transformer.
    transformer = require(transformer);
  }
  catch (err) {
    console.log(err);
    return;
  }

  // Create a form object.
  var destForm = new options.formio.Form(dest);

  // Determine the stream based on the source type.
  var stream = null;
  if (src.substr(-4) === '.csv') {
    stream = fs.createReadStream(src).pipe(parse());
  }
  else {
    var requestHeaders = {
      'content-type': 'application/json'
    };
    if (options.key) {
      requestHeaders['x-token'] = options.key;
    }
    else if (
      options.formio &&
      options.formio.currentUser &&
      options.formio.currentUser.token
    ) {
      requestHeaders['x-jwt-token'] = options.formio.currentUser.token;
    }
    stream = request({
      method: 'GET',
      url: src + '/submission',
      qs: { limit: '10000000' },
      headers: requestHeaders
    }).pipe(JSONStream.parse('*'));
  }

  // Pipe the stream through the transform.
  stream.pipe(transform(function(record, next) {
      transformer(record, function(err, transformed) {
        if (err) {
          console.log(err);
          return next(err);
        }

        if (!transformed) {
          return next();
        }

        // Submit to the destination form.
        destForm.submit(transformed).then(function(response) {
          if (parseInt(response.statusCode / 100, 10) != 2) {
            console.log('Invalid Record');
            console.log(transformed);
          }
          else {
            process.stdout.write('.');
          }
          next();
        }, next);
      });
    }, {parallel: 1}));

  // Log when we have an error.
  stream.on('error', function(err){
    console.log(err);
  });

  // Move on when the stream closes.
  stream.on('close', function(){
    return next();
  });
};

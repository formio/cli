'use strict';
var fs = require('fs');
var parse = require('csv-parse');
var JSONStream = require('JSONStream');
var transform = require('stream-transform');
var request = require('request');
var formTransform = require('./transforms/form');
module.exports = function(options, next) {
  var src = options.params[0];
  var transformer = (options.params.length === 2) ? 'form' : options.params[1];
  var dest = (options.params.length === 2) ? options.params[1] : options.params[2];

  if (!src) {
    return next('You must provide a source form or CSV to copy.');
  }

  if (!transformer) {
    return next('You must provide a transformer middleware file to perform the migration.');
  }

  if (!dest) {
    return next('You must provide a destination form.');
  }

  if (!options.formio) {
    return next('No Form.io server provided');
  }

  // If they provide a form as the transform, then just use the form
  // transform.
  if (transformer === 'form') {
    transformer = formTransform;
  }
  else {
    try {
      // Require the transformer.
      transformer = require(process.cwd() + '/' + transformer);
    }
    catch (err) {
      console.log(err);
      return;
    }
  }

  // Create a form object.
  var destForm = new options.formio.Form(dest);

  // Determine the stream based on the source type.
  var stream = null;
  if (src.substr(-4) === '.csv') {
    stream = fs.createReadStream(process.cwd() + '/' + src).pipe(parse());
  }
  else if (options.srcFormio) {
    var requestHeaders = {
      'content-type': 'application/json'
    };
    if (options.srcFormio.apiKey) {
      requestHeaders['x-token'] = options.srcFormio.apiKey;
    }
    else if (
      options.srcFormio &&
      options.srcFormio.currentUser &&
      options.srcFormio.currentUser.token
    ) {
      requestHeaders['x-jwt-token'] = options.srcFormio.currentUser.token;
    }
    stream = request({
      method: 'GET',
      rejectUnauthorized: false,
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
          console.log('');
          console.log(response.body);
          console.log(transformed);
          return next(response.body)
        }
        else {
          process.stdout.write('.');
        }
        next();
      }).catch(function(err) {
        console.log(JSON.stringify(err.response.body));
        return next(err);
      });
    });
  }));

  // Log when we have an error.
  stream.on('error', function(err){
    console.log(err);
  });

  // Move on when the stream closes.
  stream.on('close', function(){
    console.log('Done!');
    return next();
  });
};

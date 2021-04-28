'use strict';
const fs = require('fs');
const async = require('async');
const parse = require('csv-parse');
const JSONStream = require('JSONStream');
const transform = require('stream-transform');
const request = require('request');
const _ = require('lodash');
const formTransform = require('./transforms/form');

module.exports = function(options, next) {
  let isProject = false;
  let src = '';
  let dest = '';
  let transformer = '';
  if (options.params[1] === 'project') {
    isProject = true;
    transformer = 'form';
    src = options.params[0];
    dest = options.params[2];
  }
  else {
    src = options.params[0];
    transformer = (options.params.length === 2) ? 'form' : options.params[1];
    dest = (options.params.length === 2) ? options.params[1] : options.params[2];
  }

  const headers = {};
  function setHeaders(type, formio) {
    if (formio) {
      headers[type] = {};
      if (formio.apiKey) {
        headers[type]['x-token'] = formio.apiKey;
      }
      else if (formio.currentUser && formio.currentUser.token) {
        headers[type]['x-jwt-token'] = formio.currentUser.token;
      }
    }
    if (headers[type]) {
      headers[type]['content-type'] = 'application/json';
    }
  }

  setHeaders('src', options.srcFormio);
  setHeaders('dst', options.dstFormio);

  /**
   * Migrate a single form.
   *
   * @param _src
   * @param _dest
   * @param _transformer
   * @param done
   */
  const migrateForm = function(_src, _dest, _transformer, done) {
    if (!_src) {
      return done('You must provide a source form or CSV to copy.');
    }

    if (!_transformer) {
      return done('You must provide a transformer middleware file to perform the migration.');
    }

    if (!_dest) {
      return done('You must provide a destination form.');
    }

    if (!options.formio) {
      return done('No Form.io server provided');
    }

    // If they provide a form as the transform, then just use the form
    // transform.
    if (_transformer === 'form') {
      _transformer = formTransform;
    }
    else {
      try {
        // Require the transformer.
        _transformer = require(process.cwd() + '/' + _transformer);
      }
      catch (err) {
        console.log(err);
        return;
      }
    }

    // Create a form object.
    var destForm = new options.formio.Form(_dest);
    const migrateData = function() {
      console.log('');
      process.stdout.write(`Migrating to ${_dest}`);
      // Determine the stream based on the source type.
      var stream = null;
      if (src.substr(-4) === '.csv') {
        stream = fs.createReadStream(process.cwd() + '/' + _src).pipe(parse({
          ltrim: true,
          rtrim: true
        }));
      }
      else if (options.srcFormio) {
        try {
          stream = request({
            method: 'GET',
            rejectUnauthorized: false,
            url: _src + '/submission',
            qs: { limit: '10000000' },
            headers: headers.src
          }).pipe(JSONStream.parse('*'));
        }
        catch (err) {
          console.log(err);
        }
      }

      const streamTransform = transform(function(record, nextItem) {
        _transformer(record, function(err, transformed) {
          if (err) {
            console.log(err);
            return nextItem();
          }

          if (!transformed) {
            return nextItem();
          }

          // Submit to the destination form.
          destForm.submit(transformed).then(function(response) {
            if (parseInt(response.statusCode / 100, 10) != 2) {
              console.log('');
              console.log(response.body);
              console.log(transformed);
            }
            else {
              process.stdout.write('.');
            }
            nextItem();
          }).catch(function(err) {
            console.log(JSON.stringify(err.response.body));
            return nextItem();
          });
        });
      }, {
        parallel: isProject ? 1 : 100
      });

      streamTransform.on('error', (err) => {
        console.log(err.message);
        return done(err);
      });
      streamTransform.on('finish', () => {
        return done();
      });
      stream.pipe(streamTransform);
    };

    // Load the destination form to determine if it exists...
    destForm.load().then(() => migrateData()).catch(() => {
      console.log('');
      console.log(`Creating form ${_dest}`);
      const srcForm = new options.formio.Form(_src);
      srcForm.load().then(() => {
        // Create the missing form.
        const dstProject = _dest.replace(`/${srcForm.form.path}`, '');
        request({
          json: true,
          method: 'POST',
          url: `${dstProject}/form`,
          headers: headers.dst,
          body: {
            title: srcForm.form.title,
            path: srcForm.form.path,
            name: srcForm.form.name,
            components: srcForm.form.components
          }
        }, (err, resp) => {
          if (err) {
            return done(err);
          }

          // Migrate the data to this form.
          migrateData();
        });
      });
    });
  };

  if (!isProject) {
    return migrateForm(src, dest, transformer, next);
  }

  // Fetch all forms from the source.
  request({
    json: true,
    method: 'GET',
    url: `${src}/form`,
    qs: {
      limit: '10000000',
      select: '_id,path,title'
    },
    headers: headers.src
  }, (err, response) => {
    if (err) {
      return next(err.message || err);
    }

    if (!response.body || !response.body.length) {
      return next('No forms were found within the source project.');
    }

    // Iterate through each of the forms.
    async.eachSeries(response.body, (form, nextForm) => {
      if (!form || !form.path) {
        return nextForm();
      }
      migrateForm(
        `${src}/${form.path}`,
        `${dest}/${form.path}`,
        transformer,
        nextForm
      );
    }, (err) => {
      if (err) {
        return next(err.message || err);
      }

      return next();
    });
  })

};

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

    const deletePrevious = function(record, cb) {
      if (!options.deletePrevious) {
        return cb();
      }
      // Load a previous submission if exists.
      request({
        json: true,
        method: 'GET',
        rejectUnauthorized: false,
        url: _dest + '/submission',
        qs: {limit: 1000000, 'metadata.from': record._id.toString()},
        headers: headers.dst
      }, (err, response) => {
        if (err) {
          console.log(err);
          return cb();
        }
        if (response.statusCode !== 200) {
          console.log(response.statusMessage);
          return cb();
        }
        if (!response.body || !response.body.length || !response.body[0]._id) {
          return cb();
        }
        request({
          json: true,
          method: 'DELETE',
          rejectUnauthorized: false,
          url: _dest + '/submission/' + response.body[0]._id,
          headers: headers.dst
        }, (err) => {
          if (err) {
            return cb();
          }
          process.stdout.write('x');
          cb();
        });
      });
    };

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
            qs: { select: '_id', limit: '10000000' },
            headers: headers.src
          }).pipe(JSONStream.parse('*'));
        }
        catch (err) {
          console.log(err);
        }
      }

      const streamTransform = transform(function(record, nextItem) {
        request({
          json: true,
          method: 'GET',
          rejectUnauthorized: false,
          url: _src + '/submission/' + record._id,
          headers: headers.src
        }, (err, response) => {
          if (err) {
            console.log(err);
            return nextItem();
          }
          deletePrevious(record, () => {
            _transformer(response.body, function(err, transformed) {
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

    const deleteData = function() {
      if (!options.deleteBefore && !options.deleteAfter && !options.delete) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        console.log('');
        if (options.delete) {
          process.stdout.write(`Deleting all submissions from form ${_dest}`);
        }
        else if (options.deleteBefore && !options.deleteAfter) {
          process.stdout.write(`Deleting submissions from form ${_dest} before ${options.deleteBefore}`);
        }
        else if (!options.deleteBefore && options.deleteAfter) {
          process.stdout.write(`Deleting submissions from form ${_dest} after ${options.deleteAfter}`);
        }
        else {
          process.stdout.write(`Deleting submissions from form ${_dest} between ${options.deleteAfter} and ${options.deleteBefore}`);
        }
        const deleteQuery = {select: '_id', limit: '10000000'};
        if (options.deleteBefore) {
          deleteQuery.created__lt = options.deleteBefore;
        }
        if (options.deleteAfter) {
          deleteQuery.created__gt = options.deleteAfter;
        }
        request({
          json: true,
          method: 'GET',
          rejectUnauthorized: false,
          url: _dest + '/submission',
          qs: deleteQuery,
          headers: headers.dst
        }, (err, response) => {
          if (err) {
            console.log(err);
            return reject(err);
          }
          if (response.statusCode !== 200) {
            return reject(response.statusMessage);
          }
          if (!response) {
            return resolve();
          }
          let records = response.body;
          let deleteIndex = 0;
          function deleteNext() {
            if (deleteIndex < records.length) {
              request({
                json: true,
                method: 'DELETE',
                rejectUnauthorized: false,
                url: _dest + '/submission/' + records[deleteIndex]._id,
                headers: headers.dst
              }, () => {
                process.stdout.write('.');
                deleteIndex++;
                deleteNext();
              });
            }
            else {
              return resolve();
            }
          }
          deleteNext();
        });
      });
    }

    const deleteThenMigrate = function() {
      deleteData()
        .then(() => migrateData())
        .catch((err) => done(err));
    }

    // Load the destination form to determine if it exists...
    destForm.load().then(() => deleteThenMigrate()).catch(() => {
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
          deleteThenMigrate();
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

    let formFound = !options.startWith;

    // Iterate through each of the forms.
    async.eachSeries(response.body, (form, nextForm) => {
      if (!form || !form.path) {
        return nextForm();
      }
      if (!formFound && options.startWith) {
        formFound = (form.path === options.startWith);
      }
      if (!formFound) {
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

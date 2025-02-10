'use strict';
const fs = require('fs');
const async = require('async');
const parse = require('csv-parse');
const JSONStream = require('JSONStream');
const transform = require('stream-transform');
const request = require('request');
const formTransform = require('./transforms/form');
const fetch = require('./fetch');
const path = require('path');

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
  function setHeaders(type, options) {
    if (options) {
      headers[type] = {};
      if (options.key) {
        headers[type]['x-token'] = options.key;
      }
      else if (options.adminKey) {
        headers[type]['x-admin-key'] = options.adminKey;
      }
    }
    if (headers[type]) {
      headers[type]['content-type'] = 'application/json';
    }
  }

  setHeaders('src', options.srcOptions);
  setHeaders('dst', options.dstOptions);

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

    // If they provide a form as the transform, then just use the form
    // transform.
    if (_transformer === 'form') {
      _transformer = formTransform;
    }
    else {
      try {
        // Require the transformer.
        _transformer = require(path.join(process.cwd() + '/' + _transformer));
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

    const migrateData = function() {
      console.log('');
      process.stdout.write(`Migrating to ${_dest} `);
      // Determine the stream based on the source type.
      let stream = null;
      const isFile = src.trim().endsWith('.csv');

      if (isFile) {
        stream = fs.createReadStream(path.join(process.cwd(), '/', _src)).pipe(parse({
          ltrim: true,
          rtrim: true
        }));
      }
      else {
        try {
          stream = request({
            method: 'GET',
            rejectUnauthorized: false,
            url: _src + '/submission',
            qs: {select: '_id', limit: '10000000'},
            headers: headers.src
          }).pipe(JSONStream.parse('*'));
        }
        catch (err) {
          console.log(err);
        }
      }

      const transformAndSubmitRecord = (rec, next) => _transformer(rec, (err, transformed) => {
        if (err) {
          console.log(err);
          return next();
        }

        if (!transformed) {
          return next();
        }

        const dstFormSubmitUrl = `${_dest}/submission${transformed._id ? '/' + transformed._id : ''}`;

        // Submit to the destination form.
        fetch(options.dstOptions)({
          url: dstFormSubmitUrl,
          method: transformed._id ? 'PUT' : 'POST',
          body: transformed
        }).then(() => {
          next();
        }).catch((err) => {
          console.log(`Failed to submit form: ${err.message}`.red);
          return next();
        });
      });

      const streamTransform = transform(function(record, nextItem) {
        if (isFile) {
          transformAndSubmitRecord(record, nextItem);
        }
        else {
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
              transformAndSubmitRecord(response.body, nextItem);
            });
          });
        }
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
    };

    const deleteThenMigrate = function() {
      deleteData()
        .then(() => migrateData())
        .catch((err) => done(err))
        .finally(() => console.log('Done!'));
    };

    // Load the destination form to determine if it exists...
    fetch(options.dstOptions)({
      url: _dest
    }).then(() => {
      deleteThenMigrate();
    }).catch(() => {
      console.log('');
      console.log(`Creating form ${_dest}`.green);

      fetch(options.srcOptions)({
        url: _src
      }).then(({body}) => {
        const dstProject = _dest.replace(`/${body.path}`, '');
        request({
          json: true,
          method: 'POST',
          url: `${dstProject}/form`,
          headers: headers.dst,
          body: {
            title: body.title,
            path: body.path,
            name: body.name,
            type: body.type,
            components: body.components,
            settings: body.settings || {}
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
  });
};

'use strict';

var async = require('async');
var _ = require('lodash');
var fetch = require('node-fetch');

module.exports = function(options, done) {
  var type = options.params[0].trim();
  var src = options.params[1].trim();
  var dest = options.params[2].trim();

  if (!type) {
    return done('You must provide a type.');
  }

  if (!src) {
    return done('You must provide a source form to copy.');
  }

  if (!dest) {
    return done('You must provide a destination.');
  }

  var destForm = {};
  var sourceForms = src.split(',');

  async.series([
    // Load the form.
    function(next) {
      if (!options.srcFormio) {
        return next('Cannot find the source server.');
      }
      if (['form', 'resource'].indexOf(type) === -1) {
        return next('Invalid form type given: ' + type);
      }

      var copyComponents = function(form, cb) {
        if (options.full) {
          destForm = _.omit(form, ['_id', '_vid', 'created', 'modified', 'machineName']);
        }
        else {
          destForm = _.pick(form, ['title', 'components', 'tags', 'properties']);
        }
        return cb();
      };

      // For each source form, copy the components after uniquifying them.
      async.eachSeries(sourceForms, function(src, cb) {
        const headers = {
          'Content-Type': 'application/json'
        };
        if (options.srcKey) {
          headers['x-token'] = options.srcKey;
        }
        if (options.srcAdminKey) {
          headers['x-admin-key'] = options.srcAdminKey;
        }
        fetch(src, {
          headers
        })
          .then(resp => resp.json())
          .then((form) => {
            copyComponents(form, cb);
          })
          .catch(err => {
            console.log('Loading form ' + src + ' returned error: ' + err.message.red);
            cb(err);
          });
      }, function(err) {
        if (err) {
          return next(err);
        }

        return next();
      });
    },
    // Copy the form.
    function(next) {
      console.log('Saving components to destination ' + type + ' ' + dest);
      var parts = dest.match(/^(http[s]?:\/\/)([^\/]+)\/(.*)/);
      if (parts.length < 4) {
        return next('Invalid destination: Must contain a ' + type + ' path');
      }

      // Load the destination form.
      const headers = {
        'Content-Type': 'application/json'
      };
      if (options.dstKey) {
        headers['x-token'] = options.dstKey;
      }
      if (options.dstAdminKey) {
        headers['x-admin-key'] = options.dstAdminKey;
      }
      fetch(dest, {
        headers
      })
        .then((resp) => {
          if (resp.status === 200) {
            return resp.json();
          }
          else {
            return null;
          }
        })
        .then((form) => {
          if (form && form.components) {
            console.log('Updating existing ' + type);
            var updatedForm = _.assign(form, destForm);
            fetch(dest, {
              method: 'PUT',
              body: JSON.stringify(updatedForm),
              headers,
            })
              .then(resp => resp.json())
              .then((form) => {
                console.log('RESULT:' + JSON.stringify(form).green);
                next();
              })
              .catch(next);
          }
          else {
            var name = '';
            var projectUrl = parts[1] + parts[2];
            if (parts[2].match(/form\.io$/)) {
              name = parts[3];
            }
            else {
              var formPath = parts[3].split('/');
              var projectName = formPath.shift();
              projectUrl += '/' + projectName;
              if (formPath.length) {
                name = formPath.join('/').trim();
              }
              else {
                parts = src.match(/^(http[s]?:\/\/)([^\/]+)\/(.*)/);
                formPath = parts[3].split('/');
                formPath.shift();
                name = formPath.join('/').trim();
              }
            }
            var isSameProject = src.split('/')[3] === dest.split('/')[3];
            var newForm = _.assign({}, destForm, {
              title: isSameProject ? 'Copy of ' + destForm.title : destForm.title,
              name: _.camelCase(name.split('/').join(' ')),
              path: name,
              type: type
            });
            console.log('Creating new ' + type);
            fetch(projectUrl + '/form', {
              method: 'POST',
              body: JSON.stringify(newForm),
              headers
            })
              .then((resp) => {
                return resp.json();
              })
              .then((form) => {
                console.log('RESULT:' + JSON.stringify(form).green);
                next();
              })
              .catch(next);
          }
        })
        .catch((err) => {
          console.log(err);
        });
    }
  ], function(err) {
    if (err) {
      console.log(err);
      return done(err);
    }
    console.log('Done!');
    done();
  });
};

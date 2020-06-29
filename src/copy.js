'use strict';

var async = require('async');
var FormioUtils = require('formiojs/utils').default;
var _ = require('lodash');
var formio = require('formio-service')();

module.exports = function(options, done) {
  var type = options.params[0];
  var src = options.params[1];
  var dest = options.params[2];

  if (!type) {
    return done('You must provide a type.');
  }

  if (!src) {
    return done('You must provide a source form to copy.');
  }

  if (!dest) {
    return done('You must provide a destination.');
  }

  var destForm = {
    components: [],
    properties: null,
    tags: null,
    title: null
  };
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

      var keys = {};
      var copyComponents = function(form, cb) {
        // Ensure each component has a unique key.
        FormioUtils.eachComponent(form.components, function(component) {
          if (component.key) {
            var i = 0;
            var key = component.key;
            while (keys.hasOwnProperty(key)) {
              i++;
              key = component.key + i;
            }
            component.key = key;
            keys[key] = true;
          }
        }, true);

        // Append the components.
        destForm.title = destForm.title || form.title;
        destForm.components = destForm.components.concat(form.components);
        destForm.tags = destForm.tags || form.tags;
        destForm.properties = destForm.properties || form.properties;

        return cb();
      };

      var loadFormAnonymously = function(src, cb) {
        new formio.Form(src).load().then(function(result) {
          return copyComponents(result.form, cb);
        });
      };

      // For each source form, copy the components after uniquifying them.
      async.eachSeries(sourceForms, function(src, cb) {
        var formObj = new options.srcFormio.Form(src);
        formObj.load().then(function() {
          var form = formObj.toJson();
          if (form === 'Unauthorized') {
            return loadFormAnonymously(src, cb);
          }

          copyComponents(form, cb);
        }).catch(function(err) {
          if (err.message === 'Unauthorized') {
            loadFormAnonymously(src, cb);
          }
          else {
            console.log('Loading form ' + src + ' returned error: ' + err.message.red);
          }
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
      if (!options.formio) {
        return next('Cannot find the destination server.');
      }
      console.log('Saving components to destination ' + type + ' ' + dest);
      var parts = dest.match(/^(http[s]?:\/\/)([^\/]+)\/(.*)/);
      if (parts.length < 4) {
        return next('Invalid destination: Must contain a ' + type + ' path');
      }

      // Load the form (if it exists)
      var project = parts[1] + parts[2];
      (new options.formio.Project(project)).form(parts[3]).then(function(form) {
        if (form) {
          console.log('Updating existing form');
          form.form.components = destForm.components;
          form.form.tags = destForm.tags;
          form.form.properties = destForm.properties;
          form.save()
          .then(function(response) {
            console.log('RESULT:' + JSON.stringify(response.body).green);
            next();
          })
          .catch(next);
        }
        else {
          var newForm = {
            title: 'Copy of ' + destForm.title,
            name: _.camelCase(parts[3]),
            path: parts[3],
            type: type,
            tags: destForm.tags,
            components: destForm.components,
            properties: destForm.properties
          };
          console.log('Creating new form');
          (new options.formio.Project(project)).createForm(newForm).then(function(result) {
            console.log('RESULT:' + JSON.stringify(result.form).green);
            next();
          }).catch(next);
        }
      })
      .catch(next);
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

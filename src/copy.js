'use strict';

var url = require('url');
var async = require('async');
var formioUtils = require('formio-utils');
var authenticate = require(__dirname + '/authenticate');
var _ = require('lodash');

module.exports = function(options, done) {
  var type = options.params[0];
  var src = options.params[1];
  var dest = options.params[2];

  if (!type) {
    return done('You must provide a type.');
  }

  if (!src.length) {
    return done('You must provide a source form to copy.');
  }

  if (!dest) {
    return done('You must provide a destination.');
  }

  var destForm = {
    components: [],
    tags: [],
    title: ''
  };
  async.series([
    // Load the form.
    function(next) {
      if (!options.srcFormio) {
        return next('Cannot find the source server.');
      }
      if (type === 'form' || type === 'resource') {
        console.log('Loading form ' + src);
        var formObj = new options.srcFormio.Form(src);
        formObj.load().then(function() {
          var form = formObj.toJson();
          var keys = {};

          // Ensure each component has a unique key.
          formioUtils.eachComponent(form.components, function(component) {
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
          });

          // Append the components.
          destForm.title = form.title;
          destForm.components = form.components;
          destForm.tags = form.tags;
          next();
        }).catch(next);
      }
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
          form.save().then(function() {
            console.log('RESULT:' + JSON.stringify(form.form).green);
            next();
          }).catch(next);
        }
        else {
          var newForm = {
            title: 'Copy of ' + destForm.title,
            name: _.camelCase(parts[3]),
            path: parts[3],
            type: type,
            tags: destForm.tags,
            components: destForm.components
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

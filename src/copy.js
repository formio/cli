var async = require('async');
var formioUtils = require('formio-utils');
var _ = require('lodash');
module.exports = function(options, next) {

  // Get the form.io service.
  var formio = require('./formio')(options);
  var type = options.params[0];
  var src = options.params[1];
  var dest = options.params[2];

  if (!type) {
    return next('You must provide a type.');
  }

  if (!src) {
    return next('You must provide a source form to copy.');
  }

  if (!dest) {
    return next('You must provide a destination.');
  }

  // For now only support form copy.
  if (type === 'form') {
    var forms = src.split(',');
    var components = [];
    var keys = {};
    var source = {};
    async.eachSeries(forms, function(formUrl, done) {
      console.log('Loading form ' + formUrl);
      (new formio.Form(formUrl)).load().then(function(form) {
        source = form.toJson();

        // Ensure each component has a unique key.
        formioUtils.eachComponent(source.components, function(component) {
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
        components = components.concat(source.components);
        done();
      }).catch(done);
    }, function(err) {
      if (err) { return next(err); }
      console.log('Saving components to destination form ' + dest);
      var parts = dest.match(/^(http[s]?:\/\/)([^\/]+)\/(.*)/);
      if (parts.length < 4) {
        return next('Invalid destination: Must contain a form path');
      }

      // Load the form (if it exists)
      var project = parts[1] + parts[2];
      (new formio.Project(project)).form(parts[3]).then(function(form) {
        if (form) {
          form.form.components = components;
          form.save().then(function() {
            console.log('Done!');
            next();
          }).catch(next);
        }
        else {
          (new formio.Form(project + '/form')).create({
            title: 'Copy of ' + source.title,
            name: _.camelCase(parts[3]),
            path: parts[3],
            type: source.type,
            components: components
          }).then(function() {
            console.log('Done!');
            next();
          }).catch(next);
        }
      });
    });
  }
};
'use strict';

var async = require('async');
var _ = require('lodash');
var fetch = require('./fetch');

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

  var destForm = {components:[]};
  var sourceForms = src.split(',');

  async.series([
    // Load the form.
    function(next) {
      if (['form', 'resource'].indexOf(type) === -1) {
        return next('Invalid form type given: ' + type);
      }

      var copyComponents = function(form, cb) {
        if (options.full) {
          const formPart = _.omit(form, ['_id', '_vid', 'created', 'modified', 'machineName']);
          destForm = _.assign(formPart, {components: [...formPart.components, ...destForm.components]});
        }
        else {
          const formPart = _.pick(form, ['title', 'components', 'tags', 'properties', 'settings']);
          destForm = _.assign(formPart, {components: [...formPart.components, ...destForm.components]});
        }
        return cb();
      };

      // For each source form, copy the components after uniquifying them.
      async.eachSeries(sourceForms, function(src, cb) {
        fetch(options)({
          url: src
        }).then(({body: form}) => {
          copyComponents(form, cb);
        }).catch(err => {
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
      const fetchWithHeaders = fetch(options.dstOptions);

      fetchWithHeaders({
        url: dest
      }).then(({body: form}) => {
        if (form && form.components) {
          console.log('Updating existing ' + type);
          var updatedForm = _.assign(form, destForm);
          fetchWithHeaders({
            url: dest,
            method: 'PUT',
            body: updatedForm
          }).then(({body: form}) => {
            console.log('RESULT:' + JSON.stringify(form).green);
            next();
          }).catch(next);
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
          fetchWithHeaders({
            url: projectUrl + '/form',
            method: 'POST',
            body: newForm
          }).then(({body: form}) => {
            console.log('RESULT:' + JSON.stringify(form).green);
            next();
          }).catch(next);
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

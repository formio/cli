'use strict';

var _ = require('lodash');

module.exports = function(options, next) {
  if (!options.formio) {
    return next('Cannot connect to server');
  }
  var template = options.template;

  // If project exists, this is an update.
  console.log('Importing Template');
  var formioProject = null;

  formioProject = new options.formio.Project(options.project);
  formioProject.load(options.project)
    .then(function() {
      console.log('Updating Project');
      var project = formioProject.project;
      _.assign(project, {
        template: _.omit(template, 'title', 'description', 'name'),
        settings: template.settings
      });
      formioProject.update(project).then(function() {
        console.log('Project Updated');
        next();
      }).catch(next);
    })
    .catch(function(err) {
      // If the project doesn't exist, lets create it. Otherwise just throw the error.
      if (!err.response || err.response.statusCode !== 500) {
        return next(err);
      }

      console.log('Creating Project');
      formioProject = new options.formio.Project();
      template.settings = template.settings || {};
      if (!template.settings.cors) {
        template.settings.cors = '*';
      }

      // Create a project from a template.
      var project = {
        title: template.title,
        description: template.description,
        name: template.name,
        template: _.omit(template, 'title', 'description', 'name'),
        settings: template.settings
      };

      formioProject.create(project).then(function() {
        console.log('Project Created');
        next();
      }).catch(next);
    });
};

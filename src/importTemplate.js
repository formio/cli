var _ = require('lodash');
module.exports = function(options, next) {
  var formio = require('./formio')(options);
  var template = options.template;

  // If project exists, this is an update.
  console.log('Importing Template');
  if (options.projectId) {
    console.log('Updating Project');
    var formioProject = new formio.Project(options.project);
    formioProject.read(options.projectId).then(function() {
      var project = formioProject.project;
      _.assign(project, {
        title: template.title,
        description: template.description,
        template: _.omit(template, 'title', 'description', 'name'),
        settings: template.settings
      });
      formioProject.update(project).then(function() {
        console.log('Project Updated');
        next();
      }).catch(next);
    }).catch(next);
  }
  // Project doesn't yet exist. Create it.
  else {
    console.log('Creating Project');
    var formioProject = new formio.Project();
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
  }
};
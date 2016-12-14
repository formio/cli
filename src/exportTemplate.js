'use strict';

module.exports = function(options, next) {
  if (!options.formio) {
    return next('Cannot connect to server');
  }
  console.log('Exporting Template');
  var project = new options.formio.Project(options.project);
  project.export().then(function() {
    options.template = project.template;
    if (
      !process.env.TEST_SUITE &&
      project.template.plan &&
      (project.template.plan === 'basic')
    ) {
      return next('Deploy is only available for projects on a paid plan.');
    }
    next();
  }).catch(next);
};

'use strict';

module.exports = function(options, next) {
  var formio = require('./formio')(options);

  console.log('Exporting Template');
  var project = new formio.Project(options.project);
  project.export().then(function() {
    options.template = project.template;
    if (project.template.plan && project.template.plan === 'community') {
      return next('Deploy is only available for projects on a paid plan.');
    }
    next();
  }).catch(next);
};

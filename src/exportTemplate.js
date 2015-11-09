module.exports = function(options, next) {
  var formio = require('./formio')(options);

  console.log('Exporting Template');
  var project = new formio.Project(options.project);
  project.export().then(function() {
    options.template = project.template;
    next();
  }).catch(next);
};
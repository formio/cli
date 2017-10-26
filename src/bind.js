'use strict';

module.exports = function(options) {
  if (!options.formio) {
    return next('Cannot connect to server.');
  }
  var method = options.params[0];
  var middleware = options.params[2];
  var sync = !!middleware;
  if (middleware) {
    middleware = require(process.cwd() + '/' + middleware);
  }

  var project = new options.formio.Project(options.projectUrl);
  project.load().then(function() {
    project.bind(options.formPath, method, function(err, data, res) {
      if (err) {
        return console.log(err.red);
      }
      console.log(JSON.stringify(data.body).blue);
      if (middleware) {
        middleware(data, function(err) {
          if (err) {
            return console.log(err.red);
          }
          res(data);
        });
      }
    }, sync).then(function() {
      var msg = 'Succesfully bound to ' + options.params[1];
      console.log(msg.green);
    }).catch(function(err) {
      console.log(err.toString().red);
    });
  }).catch(function(err) {
    console.log(err.toString().red);
  });
};

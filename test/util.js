var cp = require('child_process');
var Formio = require('formio-service');
var async = require('async');
var Chance = require('chance');
var chance = new Chance();
var _ = require('lodash');

module.exports = {
  registerUser: function(formio, done) {
    formio.register({
      name: chance.word(),
      email: chance.email(),
      password: '123testing',
      verifyPassword: '123testing'
    }).then(function() {
      done()
    }).catch(done);
  },
  createProject: function(project, done) {
    project.create({
      title: 'Test Project'
    }).then(function() {
      done();
    }).catch(done);
  },
  createForms: function(project, forms, done) {
    project.forms = {};
    if (
      !forms ||
      ((typeof forms) === 'undefined') ||
      ((typeof forms) === 'string') ||
      !forms.length
    ) {
      return done();
    }
    async.eachSeries(forms, function(formName, next) {
      if (!formName) {
        return next('Form not found');
      }
      var form = require('./forms/' + formName + '.json');
      if (!form) {
        return next('Form not found');
      }
      project.createForm(form).then(function(formObj) {
        project.forms[formName] = formObj.form;
        next();
      }).catch(next);
    }, done);
  },
  project: function(params, done) {
    params.formio = this.url('formio', params.server);
    params.api = this.url('api', params.server);
    var formio = Formio({formio: params.formio, api: params.api});
    var project = new formio.Project();
    project.server = params.server;
    var pipeline = [];
    if (!params.user) {
      pipeline.push(async.apply(this.registerUser.bind(this), formio));
    }
    else {
      project.formio.currentUser = params.user;
    }
    pipeline.push(async.apply(this.createProject.bind(this), project));
    pipeline.push(async.apply(this.createForms.bind(this), project, params.forms));
    async.series(pipeline, function(err) {
      if (err) {
        return done(err);
      }
      done(null, project);
    });
  },
  form: function(project, form) {
    var path = form;
    if (
      project.forms &&
      project.forms.hasOwnProperty(form) &&
      project.forms[form].path
    ) {
      path = project.forms[form].path;
    }
    return this.url(
      project.project.name,
      project.server,
      path
    );
  },
  projectUrl: function(project) {
    return this.url(
      project.project.name,
      project.server
    );
  },
  url: function(subdomain, server, path) {
    var url = 'http://' + subdomain + '.' + server;
    if (path) {
      url += '/' + path;
    }
    return url;
  },
  execute: function(cmd, inputs, done) {
    var result = null;
    var output = '';
    var callDone = _.once(done);
    var process = cp.spawn('../bin/formio', cmd.split(' '), {
      cwd: __dirname
    });
    process.stderr.on('data', function(err) {
      console.log(err.toString());
    });
    process.stdout.on('data', function(data) {
      var line = data.toString();
      output += line;
      var input = '';
      if (line.indexOf('prompt:') === 0) {
        input = inputs.shift() + '\n';
        setTimeout(function() {
          if (inputs.length) {
            process.stdin.write(input);
          }
          else {
            process.stdin.end(input);
          }
        }, 10);
      }
      if (typeof result === 'boolean') {
        result = JSON.parse(line);
      }
      if (line.indexOf('RESULT:') === 0) {
        line = line.replace('RESULT:', '');
        if (line) {
          result = JSON.parse(line);
        }
        else {
          result = true;
        }
      }
    });
    process.on('close', function() {
      callDone(null, result, output);
    });
    process.on('disconnect', function() {
      callDone(null, result, output);
    });
    process.on('error', function(err) {
      callDone(err);
    });
  }
};

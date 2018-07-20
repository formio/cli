'use strict';
const fs = require('fs-extra');
const Formio = require('formio-service');

module.exports = function(options, done) {
  var action = options.params[0];
  var pdfFile = options.params[1];
  var dest = options.params[2];

  if (!action) {
    return done('You must provide an action (create, update).');
  }

  if (!pdfFile) {
    return done('You must provide a source pdf file.');
  }

  if (!dest) {
    return done('You must provide a destination.');
  }

  if (action !== 'update') {
    return done('Only update is currently supported');
  }

  let pdf = null;
  try {
    pdf = fs.readFileSync(pdfFile);
  }
  catch (err) {
    return done(err.message);
  }

  const getPDFSchema = function(form, done) {
    form.components = [
      {
        type: 'textfield',
        label: 'First Name',
        key: 'firstName',
        input: true,
        overlay: {
          page: 1,
          top: 100,
          left: 100,
          width: 200,
          height: 15
        }
      }

    ].concat(form.components);
    done();
  };

  // Load the form JSON.
  const form = (new options.formio.Form(dest));
  form.load().then(function(form) {
    getPDFSchema(form.form, (err, schema) => {
      if (err) {
        return done(err.message);
      }

      form.save().then(() => {
        done();
      });
    });
  });
};

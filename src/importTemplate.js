'use strict';

const _ = require('lodash');
const fetch = require('./fetch');

module.exports = function(options, next) {
  const fetchWithHeaders = fetch(options);
  const template = options.template;

  // If project exists, this is an update.
  console.log('Importing Template');

  fetchWithHeaders({
    url: options.project,
  }).then(res => {
    const project = res.body;

    _.assign(project, {
      template: _.omit(template, 'title', 'description', 'name', 'machineName'),
      settings: template.settings
    });

    fetchWithHeaders({
      url: `${options.server}/${project.name}/import`,
      method: 'POST',
      body: {template: project.template}
    }).then(() => {
      console.log('Project Updated');
      next();
    }).catch(next);
  }).catch((err) => {
    if (err.message.includes('500')) {
      return next(err);
    }

    template.settings = template.settings || {};

    if (!template.settings.cors) {
      template.settings.cors = '*';
    }

    // Create a project from a template.
    const project = {
      title: template.title,
      description: template.description,
      name: template.name,
      template: _.omit(template, 'title', 'description', 'name'),
      settings: template.settings
    };

    fetchWithHeaders({
      url: `${options.server}/project`,
      method: 'POST',
      body: project
    }).then(()=> {
      console.log('Project Created');
      next();
    }).catch(next);
  });
};

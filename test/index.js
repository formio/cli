/* globals describe */
'use strict';
require('dotenv').config({path: 'test.env'});

const template= {src:{forms: {}, submission:{textForm1: [], textForm2: [], textForm3: []}}, dst: {forms: {}}};

template.appSrc = process.env.API_SRC;
template.appDst = process.env.API_DST;

describe('Start tests',  function() {
  require('./clearData')();
  require('./createTemplate')(template);
  describe('Test commands',  function() {
    require('./submissions/submission')(template);
    require('./migrate/migrate')(template);
    require('./copy/copy')(template);
    require('./deploy/deploy')(template);
    // require('./clone');
  });
});


/* eslint-disable max-len */
/* eslint-disable no-prototype-builtins */
/* globals describe, it, before, after */
'use strict';
require('dotenv').config();

const template= {src:{forms: {}, submission:{textForm1: [], textForm2: [], textForm3: []}}, dst: {forms: {}}};

template.appScr = 'http://localhost:3001';
template.appDst ='http://localhost:3002';

describe('Start tests',  function() {
  require('./clearData')();
  require('./createTemplate')(template);
  describe('Test commands',  function() {
    require('./submissions/submission')(template);
    require('./migrate/migrate')(template);
    require('./copy/copy')(template);
    require('./deploy/deploy')(template);
  });
});


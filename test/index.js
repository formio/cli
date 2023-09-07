/* globals describe, before */
'use strict';
require('dotenv').config({path: 'test.env'});

const template = {
  src: {forms: {}, submission: {textForm1: [], textForm2: [], textForm3: []}},
  dst: {forms: {}}
};

template.appSrc = process.env.API_SRC;
template.appDst = process.env.API_DST;

describe('Start tests', () => {
  before(async() => {
    process.env.TEST_SUITE = '1';
    await require('./waitApisReady')();
  });

  require('./clearData')(process.env.MONGO_SRC, process.env.MONGO_DST);
  require('./createTemplate')(template);

  describe('CLI commands', () => {
    require('./submissions/submission')(template);
    require('./migrate/migrate')(template);
    require('./copy/copy')(template);
    require('./deploy/deploy')(template);
    require('./clone')();
  });
});

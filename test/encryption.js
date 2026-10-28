/* globals describe, it, before */
'use strict';
const assert = require('assert');
const Cloner = require('../src/Cloner');

// Ciphertexts produced by the legacy crypto.createCipher (Node 20), the format formio-server stores.
const legacy = {
  settings: 'hg5cd/GcUiStAlrLtX6UErtXfOLBg4UnwjtV1+bOEj9hxSGQpCzH3ZbcHWYFrcIt6Z+Lr7sUA12hA1AqUhiAtw==',
  field: 'ucekdmCGIwoJPYKfiFsLIU3gUOInqWh5Ul+BjUoBdqx4QXeg9T1mBbPELfDpr9cIQWhaHdeiW5qk07x5nRLrNw=='
};
const settings = {secret: 'projectSecret', email: {smtp: {pass: 'smtpPass'}}};

describe('Cloner encryption', function() {
  let cloner = null;
  before(() => {
    cloner = new Cloner('mongodb://src', 'mongodb://dst');
  });

  it('decrypts project settings encrypted by formio-server', () => {
    assert.deepEqual(cloner.decrypt('dbSecret', Buffer.from(legacy.settings, 'base64'), true), settings);
  });

  it('decrypts a salted field value encrypted by formio-server', () => {
    assert.equal(cloner.decrypt('projectSecret', Buffer.from(legacy.field, 'base64')), '123-45-6789');
  });

  it('encrypts project settings into the format formio-server reads', () => {
    assert.equal(cloner.encrypt('dbSecret', settings, true).toString('base64'), legacy.settings);
  });

  it('round-trips a salted field value', () => {
    const encrypted = cloner.encrypt('projectSecret', '123-45-6789');
    assert.equal(cloner.decrypt('projectSecret', encrypted), '123-45-6789');
  });
});

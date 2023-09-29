'use strict';
const fetch = require('../src/fetch');

module.exports = async() => {
  const maxRetries = 10;
  const retryInterval = 5000;

  console.log('Waiting for the API servers to start ...');

  for (let i = 0; i < maxRetries; i++) {
    try {
      await fetch()({url: 'http://localhost:4001/status'});
      await fetch()({url: 'http://localhost:4002/status'});

      console.log('API servers ready.');
      return;
    }
    catch (err) {
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
  }

  console.error('Timeout: API servers not started.');
  process.exit(1);
};

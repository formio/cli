'use strict';
const fetch = require('node-fetch');
const {Agent} = require('https');

module.exports = function(options = {}) {
  const baseHeaders = {
    'Accept': 'application/json, text/plain, */*',
  };

  if (options.key) {
    baseHeaders['x-token'] = options.key;
  }
  else if (options.adminKey) {
    baseHeaders['x-admin-key'] = options.adminKey;
  }

  const noThrowOnError = !!options.noThrowOnError;

  return function({url, method = 'GET', body, headers}) {
    const options = {
      method: method,
      headers: {...baseHeaders, ...headers},
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const httpsAgent = new Agent({
      rejectUnauthorized: false,
    });

    options.agent = httpsAgent;

    return fetch(url, options).then(response => {
      const res = {
        status: response.status,
        headers: response.headers,
        ok: response.ok,
      };

      if (response.headers.get('Content-Type').includes('json')) {
        return response.json().then(data => {
          res.body = data;

          // response.status < 200 && response.status > 300
          if (!response.ok && !noThrowOnError) {
            throw new Error(
              `HTTP Error: ${response.status} ${response.statusText} ${
                response.url
              } \n ${JSON.stringify(res.body)}`.red
            );
          }

          return res;
        });
      }
      else {
        return response.text().then(data => {
          res.body = data;
          // response.status < 200 && response.status > 300
          if (!response.ok && !noThrowOnError) {
            throw new Error(
              `HTTP Error: ${response.status} ${response.statusText} ${
                response.url
              } \n ${JSON.stringify(res.body)}`.red
            );
          }

          return res;
        });
      }
    });
  };
};

'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const vm = require('node:vm');
const axios = require('axios');
const followRedirects = require('follow-redirects');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

async function close(server) {
  if (!server || !server.listening) return;
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function redirectCapture(sendRequest) {
  let captured;
  const collector = http.createServer((req, res) => {
    req.resume();
    captured = req.headers;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ received: req.headers }));
  });
  const collectorPort = await listen(collector);

  const redirector = http.createServer((req, res) => {
    req.resume();
    res.writeHead(302, {
      location: `http://127.0.0.1:${collectorPort}/capture`
    });
    res.end();
  });

  try {
    const redirectPort = await listen(redirector);
    const result = await sendRequest(
      `http://127.0.0.1:${redirectPort}/redirect`
    );
    assert.ok(captured, 'redirect target must receive the redirected request');
    return result || captured;
  } finally {
    await close(redirector);
    await close(collector);
  }
}

function followRequest(url, options) {
  return new Promise((resolve, reject) => {
    const request = followRedirects.http.request({
      ...options,
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: Number(new URL(url).port),
      path: new URL(url).pathname,
      method: 'GET',
      maxRedirects: 1
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body).received);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
    request.end();
  });
}

(async () => {
  const arrayHeaders = await redirectCapture(url => followRequest(url, {
    headers: [
      'Authorization', 'Bearer ARRAY-HEADER-SECRET',
      'Cookie', 'session=ARRAY-COOKIE-SECRET',
      'X-Mira-Trace', 'trace-preserved'
    ]
  }));

  assert.equal(arrayHeaders.authorization, undefined,
    'array-form Authorization must be stripped on cross-origin redirect');
  assert.equal(arrayHeaders.cookie, undefined,
    'array-form Cookie must be stripped on cross-origin redirect');
  assert.equal(arrayHeaders['x-mira-trace'], 'trace-preserved',
    'non-sensitive array-form headers must remain intact');
  console.log('PASS: array-form Authorization/Cookie stripped; benign header preserved');

  const crossRealmSensitiveHeaders = vm.runInNewContext(
    '["X-Mira-Api-Key"]'
  );
  assert.equal(Array.isArray(crossRealmSensitiveHeaders), true);
  assert.equal(crossRealmSensitiveHeaders instanceof Array, false,
    'fixture must genuinely originate in another JavaScript realm');

  const customHeaders = await redirectCapture(url => followRequest(url, {
    headers: {
      'X-Mira-Api-Key': 'CROSS-REALM-SECRET',
      'X-Mira-Trace': 'custom-trace-preserved'
    },
    sensitiveHeaders: crossRealmSensitiveHeaders
  }));

  assert.equal(customHeaders['x-mira-api-key'], undefined,
    'cross-realm sensitiveHeaders must be honored during redirect stripping');
  assert.equal(customHeaders['x-mira-trace'], 'custom-trace-preserved',
    'unrelated custom headers must remain intact');
  console.log('PASS: cross-realm sensitiveHeaders strips custom credential');

  const axiosHeaders = await redirectCapture(async url => {
    const response = await axios.get(url, {
      headers: {
        Authorization: 'Bearer AXIOS-SECRET',
        Cookie: 'session=AXIOS-COOKIE-SECRET',
        'X-Mira-Trace': 'axios-trace-preserved'
      },
      maxRedirects: 1,
      proxy: false,
      timeout: 5000
    });
    return response.data.received;
  });

  assert.equal(axiosHeaders.authorization, undefined,
    'Axios cross-origin redirect must not forward Authorization');
  assert.equal(axiosHeaders.cookie, undefined,
    'Axios cross-origin redirect must not forward Cookie');
  assert.equal(axiosHeaders['x-mira-trace'], 'axios-trace-preserved',
    'Axios must preserve unrelated headers');
  console.log('PASS: Axios cross-origin redirect strips credentials');
  console.log('DEPENDENCY_REDIRECT_SECURITY=PASS');
})().catch(error => {
  console.error('DEPENDENCY_REDIRECT_SECURITY=FAIL');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

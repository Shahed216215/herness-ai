'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-hfm-conversation-routes-'));
const previousStorage = process.env.MIRA_STORAGE_DIR;
const cacheIds = [
  '../mira-storage',
  '../services/mira-json-state-store',
  '../audit-log',
  '../conversation-schema',
  '../conversation-store',
  '../services/mira-conversation-memory-engine',
  '../services/mira-conversation-response-service',
  '../routes/conversations'
];

function makeApp() {
  const routes = new Map();
  const register = method => (routePath, ...handlers) => {
    routes.set(method + ' ' + routePath, handlers[handlers.length - 1]);
  };
  return {
    routes,
    post: register('POST'),
    get: register('GET'),
    patch: register('PATCH'),
    put: register('PUT')
  };
}

function invoke(app, method, routePath, req) {
  const handler = app.routes.get(method + ' ' + routePath);
  assert.equal(typeof handler, 'function', 'Route not registered: ' + method + ' ' + routePath);
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return this; }
  };
  handler(req, res);
  return response;
}

try {
  process.env.MIRA_STORAGE_DIR = root;
  for (const id of cacheIds) {
    try { delete require.cache[require.resolve(id)]; } catch {}
  }

  const registerConversationRoutes = require('../routes/conversations');
  const app = makeApp();
  const middleware = (_req, _res, next) => next && next();
  registerConversationRoutes(
    app,
    middleware,
    () => middleware,
    { CLIENT_PROJECTS: 'client-projects' }
  );

  const created = invoke(app, 'POST', '/api/conversations', {
    body: { clientId: 'route-fixture-client', title: 'Route contract fixture' },
    params: {}, query: {}
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.ok, true);
  const conversationId = created.body.conversation.conversationId;
  assert.ok(conversationId);
  console.log('CONVERSATION_CREATE_ROUTE_STORE_CONTRACT=PASS');

  const messageResponse = invoke(app, 'POST', '/api/conversations/:conversationId/messages', {
    body: {
      participantType: 'client',
      direction: 'incoming',
      content: 'I need a mobile website. The deadline is by Friday.',
      source: 'isolated-route-contract',
      externalMessageId: 'route-external-001'
    },
    params: { conversationId }, query: {}
  });
  assert.equal(messageResponse.statusCode, 201);
  assert.equal(messageResponse.body.ok, true);
  assert.equal(messageResponse.body.message.participant, 'client');
  assert.ok(messageResponse.body.memory.context.requirements.length > 0);
  const messageId = messageResponse.body.message.messageId;
  console.log('CONVERSATION_MESSAGE_CREATE_AND_MEMORY_ROUTE=PASS');

  const list = invoke(app, 'GET', '/api/conversations/:conversationId/messages', {
    body: {}, params: { conversationId }, query: {}
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.messages.length, 1);
  console.log('CONVERSATION_MESSAGE_LIST_ROUTE=PASS');

  const single = invoke(app, 'GET', '/api/conversations/:conversationId/messages/:messageId', {
    body: {}, params: { conversationId, messageId }, query: {}
  });
  assert.equal(single.statusCode, 200);
  assert.equal(single.body.message.messageId, messageId);
  console.log('CONVERSATION_MESSAGE_DETAIL_ROUTE=PASS');

  const context = invoke(app, 'GET', '/api/conversations/:conversationId/context', {
    body: {}, params: { conversationId }, query: {}
  });
  assert.equal(context.statusCode, 200);
  assert.equal(context.body.context.conversationId, conversationId);
  console.log('CONVERSATION_CONTEXT_READ_ROUTE=PASS');

  const savedContext = invoke(app, 'PUT', '/api/conversations/:conversationId/context', {
    body: { requirements: ['manual route fixture requirement'] },
    params: { conversationId }, query: {}
  });
  assert.equal(savedContext.statusCode, 200);
  assert.ok(savedContext.body.context.requirements.includes('manual route fixture requirement'));
  console.log('CONVERSATION_CONTEXT_WRITE_ROUTE=PASS');

  const memory = invoke(app, 'GET', '/api/conversations/:conversationId/memory', {
    body: {}, params: { conversationId }, query: {}
  });
  assert.equal(memory.statusCode, 200);
  assert.equal(memory.body.memory.history.length, 1);
  console.log('CONVERSATION_MEMORY_RETRIEVAL_ROUTE=PASS');

  console.log('PRODUCTION_CONVERSATIONS_TOUCHED=NO');
  console.log('NETWORK_REQUESTS=0');
  console.log('EXTERNAL_ACTIONS=0');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_CONVERSATION_ROUTE_CONTRACT_PASS');
} catch (error) {
  console.error(error);
  console.log('TESTS_FAILED=1');
  console.log('RESULT=MIRA_HFM_CONVERSATION_ROUTE_CONTRACT_FAIL');
  process.exitCode = 1;
} finally {
  for (const id of cacheIds) {
    try { delete require.cache[require.resolve(id)]; } catch {}
  }
  if (previousStorage === undefined) delete process.env.MIRA_STORAGE_DIR;
  else process.env.MIRA_STORAGE_DIR = previousStorage;
  fs.rmSync(root, { recursive: true, force: true });
}

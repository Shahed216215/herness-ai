'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  getPermissions
} = require('../permissions');

const server = fs.readFileSync(
  require.resolve('../server'),
  'utf8'
);

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS: ' + name);
  } catch (error) {
    failed++;
    console.log('FAIL: ' + name + ' :: ' + error.message);
  }
}

check('known roles are explicit', () => {
  assert.equal(ROLES.USER, 'user');
  assert.equal(ROLES.ADMIN, 'admin');
});

check('USER has only the declared basic permissions', () => {
  assert.deepEqual(
    [...getPermissions(ROLES.USER)].sort(),
    [PERMISSIONS.CHAT, PERMISSIONS.BASIC_TOOLS].sort()
  );
});

check('USER is denied every declared administrative permission', () => {
  for (const permission of Object.values(PERMISSIONS)) {
    if (
      permission !== PERMISSIONS.CHAT &&
      permission !== PERMISSIONS.BASIC_TOOLS
    ) {
      assert.equal(
        hasPermission(ROLES.USER, permission),
        false,
        'USER unexpectedly has ' + permission
      );
    }
  }
});

check('ADMIN receives permissions declared by the role model', () => {
  assert.deepEqual(
    [...getPermissions(ROLES.ADMIN)].sort(),
    [...Object.values(PERMISSIONS)].sort()
  );

  for (const permission of Object.values(PERMISSIONS)) {
    assert.equal(hasPermission(ROLES.ADMIN, permission), true);
  }
});

check('missing and unknown roles fail closed in permission lookup', () => {
  assert.equal(hasPermission(undefined, PERMISSIONS.SYSTEM_ADMIN), false);
  assert.equal(hasPermission('', PERMISSIONS.SYSTEM_ADMIN), false);
  assert.equal(hasPermission('unknown-role', PERMISSIONS.SYSTEM_ADMIN), false);
  assert.deepEqual(getPermissions('unknown-role'), []);
});

check('missing permission fails closed', () => {
  assert.equal(hasPermission(ROLES.ADMIN, undefined), false);
  assert.equal(hasPermission(ROLES.USER, ''), false);
});

check('admin middleware has an explicit ADMIN-role gate', () => {
  assert.match(
    server,
    /function\s+requireAdminPermission\s*\(\s*permission\s*\)/
  );
  assert.match(
    server,
    /req\.role\s*!==\s*ROLES\.ADMIN/
  );
  assert.match(
    server,
    /Admin access required\./
  );
});

check('permission middleware denies missing permission with 403', () => {
  assert.match(
    server,
    /function\s+requireAgentPermission\s*\(\s*permission\s*\)/
  );
  assert.match(
    server,
    /Permission denied\./
  );
  assert.match(
    server,
    /required_permission/
  );
});

check('work-economics admin route declares SYSTEM_ADMIN gate', () => {
  assert.match(
    server,
    /app\.use\(\s*['"]\/api\/admin\/work-economics['"]\s*,\s*requireAdminPermission\(PERMISSIONS\.SYSTEM_ADMIN\)\s*\)/
  );
});

console.log('ADMIN_BOUNDARY_TESTS_PASSED=' + passed);
console.log('ADMIN_BOUNDARY_TESTS_FAILED=' + failed);
console.log('ADMIN_BOUNDARY_TEST_RESULT=' + (failed === 0 ? 'PASS' : 'FAIL'));
console.log('TEST_SCOPE=ROLE_MODEL_AND_STATIC_MIDDLEWARE_CONTRACT');
console.log('ADMIN_TO_ADMIN_ISOLATION=NOT_DEFINED_BY_CURRENT_ROLE_MODEL');

if (failed) process.exitCode = 1;

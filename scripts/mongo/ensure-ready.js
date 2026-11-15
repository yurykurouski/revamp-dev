// REV-198: makes the local MongoDB ready for the app. Runs in mongosh inside the `mongo` container:
//   docker compose exec -T -e MONGO_ROOT_PASSWORD … mongo mongosh --quiet --norc /revamp-scripts/ensure-ready.js
// (scripts/lib/dev-stack.mjs ensureMongoReady). Idempotent, safe on fresh and existing volumes:
//   1. log in as revamp_root, or, on a volume with no users yet, use the localhost exception to
//      initiate the rs0 replica set and create revamp_root;
//   2. make sure the replica set is initiated and this node is primary;
//   3. create or update revamp_app / revamp_read / revamp_admin (.env holds the passwords).
// Exit 2: the volume already has users and MONGO_ROOT_PASSWORD does not log in (see ENSURE_READY_EXIT).

const UNAUTHORIZED = 13;
const ALREADY_INITIALIZED = 23;
const NOT_YET_INITIALIZED = 94;
const ROOT_PASSWORD_MISMATCH = 2;

const REPLICA_SET = { _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] };
const ROOT_USER = 'revamp_root';
const APP_USERS = [
  { user: 'revamp_app', env: 'MONGO_APP_PASSWORD', roles: [{ role: 'readWrite', db: 'revamp' }] },
  { user: 'revamp_read', env: 'MONGO_READ_PASSWORD', roles: [{ role: 'read', db: 'revamp' }] },
  {
    user: 'revamp_admin',
    env: 'MONGO_ADMIN_PASSWORD',
    roles: [
      { role: 'dbAdmin', db: 'revamp' },
      { role: 'userAdmin', db: 'revamp' },
    ],
  },
];

const admin = db.getSiblingDB('admin');
const rootPassword = process.env.MONGO_ROOT_PASSWORD;

function rootMismatch() {
  print('MongoDB already has users and MONGO_ROOT_PASSWORD does not log in as revamp_root.');
  quit(ROOT_PASSWORD_MISMATCH);
}

function tryAuthAsRoot() {
  try {
    admin.auth(ROOT_USER, rootPassword);
    return true;
  } catch {
    return false;
  }
}

function initiateReplicaSet() {
  try {
    rs.initiate(REPLICA_SET);
  } catch (error) {
    if (error.code === ALREADY_INITIALIZED) return;
    if (error.code === UNAUTHORIZED) rootMismatch();
    throw error;
  }
}

function waitForPrimary() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (db.hello().isWritablePrimary) return;
    sleep(500);
  }
  throw new Error('The MongoDB replica set rs0 did not elect a primary within 30 s.');
}

if (!tryAuthAsRoot()) {
  // No login: either a volume with no users (the localhost exception allows rs.initiate and the
  // first user), or users created with another root password (both calls answer Unauthorized).
  initiateReplicaSet();
  waitForPrimary();
  try {
    admin.createUser({ user: ROOT_USER, pwd: rootPassword, roles: [{ role: 'root', db: 'admin' }] });
  } catch (error) {
    if (error.code === UNAUTHORIZED) rootMismatch();
    throw error;
  }
  admin.auth(ROOT_USER, rootPassword);
  print(`created ${ROOT_USER} (root@admin)`);
} else {
  try {
    rs.status();
  } catch (error) {
    if (error.code !== NOT_YET_INITIALIZED) throw error;
    initiateReplicaSet();
  }
  waitForPrimary();
}

for (const { user, env, roles } of APP_USERS) {
  const pwd = process.env[env];
  if (admin.getUser(user)) admin.updateUser(user, { pwd, roles });
  else admin.createUser({ user, pwd, roles });
  print(`ensured ${user} (${roles.map((r) => `${r.role}@${r.db}`).join(', ')})`);
}

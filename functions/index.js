const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const ALLOWED_ORIGINS = ['*'];

const ORDER_PERMISSION_KEYS = ['orders', '/ventes', '/commande/:tableId', 'tables'];

const resolvePermissionLevel = (permissionsObject, keys) => {
  let level = 'none';
  if (!permissionsObject || typeof permissionsObject !== 'object') {
    return level;
  }

  for (const key of keys) {
    const value = permissionsObject[key];
    if (value === 'editor') {
      return 'editor';
    }
    if (value === 'readonly' && level === 'none') {
      level = 'readonly';
    }
  }

  return level;
};

const mergePermissionLevel = (currentLevel, aggregatedLevel) => {
  if (aggregatedLevel === 'editor') {
    return 'editor';
  }
  if (aggregatedLevel === 'readonly') {
    return currentLevel === 'editor' ? 'editor' : 'readonly';
  }
  return currentLevel || 'none';
};

const buildPermissionClaims = (rawPermissions) => {
  const normalizedPermissions = rawPermissions && typeof rawPermissions === 'object'
    ? { ...rawPermissions }
    : {};

  const ordersLevel = resolvePermissionLevel(normalizedPermissions, ORDER_PERMISSION_KEYS);
  normalizedPermissions.orders = mergePermissionLevel(normalizedPermissions.orders, ordersLevel);

  return normalizedPermissions;
};

exports.verifyPinAndIssueToken = functions.region('us-central1').https.onRequest(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.set('Allow', 'POST, OPTIONS');
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }

  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);

  const pin = req.body && typeof req.body.pin === 'string' ? req.body.pin.trim() : '';
  if (!pin) {
    res.status(400).json({ error: 'invalid-pin' });
    return;
  }

  try {
    const rolesSnapshot = await admin.database().ref('roles').once('value');
    const roles = rolesSnapshot.val() || {};

    let matchedRoleId = null;
    let matchedRoleData = null;
    for (const [roleId, roleData] of Object.entries(roles)) {
      if (roleData && typeof roleData === 'object' && roleData.pin === pin) {
        matchedRoleId = roleId;
        matchedRoleData = roleData;
        break;
      }
    }

    if (!matchedRoleId || !matchedRoleData) {
      res.status(403).json({ error: 'invalid-pin' });
      return;
    }

    const permissions = buildPermissionClaims(matchedRoleData.permissions);

    // Rôles autorisés : tout rôle disposant d'au moins un accès `readonly` ou `editor`
    // sur `/ventes` ou `/commande/:tableId` (ex. `admin`, `mesero`) recevra le claim
    // `permissions.orders`. Les rôles dotés d'un accès `editor` obtiennent la capacité
    // de modifier tables et commandes, tandis qu'un accès `readonly` limite aux lectures.

    const customClaims = {
      roleId: matchedRoleId,
      permissions,
    };

    const token = await admin.auth().createCustomToken(`role_${matchedRoleId}`, customClaims);

    res.json({
      token,
      role: { id: matchedRoleId, ...matchedRoleData },
    });
  } catch (error) {
    console.error('verifyPinAndIssueToken failure', error);
    res.status(500).json({ error: 'internal-error' });
  }
});

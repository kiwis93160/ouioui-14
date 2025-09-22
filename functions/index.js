const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const ALLOWED_ORIGINS = ['*'];

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

    const customClaims = {
      roleId: matchedRoleId,
      permissions: matchedRoleData.permissions || {},
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

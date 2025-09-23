const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const ALLOWED_ORIGINS = [
  'https://admin.ouiouitacos.com',
  'https://ouiouitacos-admin.netlify.app',
  'https://main--ouiouitacos-admin.netlify.app',
  'https://posouioui.netlify.app',
];

const resolveOriginFromHeader = (originHeader) => {
  if (Array.isArray(originHeader)) {
    return originHeader[0];
  }
  return typeof originHeader === 'string' ? originHeader : '';
};

const isOriginAllowed = (origin) => ALLOWED_ORIGINS.includes(origin);

const applyCorsHeaders = (res, origin) => {
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
};

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
  const origin = resolveOriginFromHeader(req.headers.origin);
  const isAllowedOrigin = isOriginAllowed(origin);

  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin) {
      res.status(403).json({ error: 'origin-not-allowed' });
      return;
    }

    applyCorsHeaders(res, origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  if (!isAllowedOrigin) {
    res.status(403).json({ error: 'origin-not-allowed' });
    return;
  }

  if (req.method !== 'POST') {
    applyCorsHeaders(res, origin);
    res.set('Allow', 'POST, OPTIONS');
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }

  applyCorsHeaders(res, origin);

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

    const canonicalRoleId =
      typeof matchedRoleData.id === 'string' && matchedRoleData.id.trim()
        ? matchedRoleData.id.trim()
        : matchedRoleId;

    const permissions = buildPermissionClaims(matchedRoleData.permissions);

    // Rôles autorisés : tout rôle disposant d'au moins un accès `readonly` ou `editor`
    // sur `/ventes` ou `/commande/:tableId` (ex. `admin`, `mesero`) recevra le claim
    // `permissions.orders`. Les rôles dotés d'un accès `editor` obtiennent la capacité
    // de modifier tables et commandes, tandis qu'un accès `readonly` limite aux lectures.

    const customClaims = {
      roleId: canonicalRoleId,
      permissions,
    };

    const token = await admin.auth().createCustomToken(`role_${canonicalRoleId}`, customClaims);

    res.json({
      token,
      role: { ...matchedRoleData, id: canonicalRoleId },
    });
  } catch (error) {
    console.error('verifyPinAndIssueToken failure', error);
    res.status(500).json({ error: 'internal-error' });
  }
});

// --- Public menu replication -------------------------------------------------

const PUBLIC_MENU_PATH = 'public_menu';

const toNumeric = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const toTrimmedString = (value) => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
};

const sanitizeCategoryRecord = (categoryId, rawCategory) => {
  if (!rawCategory || typeof rawCategory !== 'object') {
    return null;
  }

  const nom = toTrimmedString(rawCategory.nom);
  if (!nom) {
    return null;
  }

  return { nom };
};

const sanitizeProductRecord = (productId, rawProduct) => {
  if (!rawProduct || typeof rawProduct !== 'object') {
    return null;
  }

  const nom_produit = toTrimmedString(rawProduct.nom_produit);
  if (!nom_produit) {
    return null;
  }

  const categoria_id = toTrimmedString(rawProduct.categoria_id);
  const estado = toTrimmedString(rawProduct.estado) || 'disponible';
  const prix_vente = toNumeric(rawProduct.prix_vente);

  const sanitizedProduct = {
    nom_produit,
    categoria_id,
    estado,
    prix_vente,
  };

  if (rawProduct.image_base64 && typeof rawProduct.image_base64 === 'string') {
    sanitizedProduct.image_base64 = rawProduct.image_base64;
  }

  return sanitizedProduct;
};

const sanitizeRecetteRecord = (productId, rawRecette, usedIngredientIds) => {
  const base = rawRecette && typeof rawRecette === 'object' ? rawRecette : {};
  const itemsSource = Array.isArray(base.items)
    ? base.items
    : base.items && typeof base.items === 'object'
      ? Object.values(base.items)
      : Array.isArray(base)
        ? base
        : [];

  const sanitizedItems = [];

  for (const item of itemsSource) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const ingredientId = toTrimmedString(item.ingredient_id);
    if (!ingredientId) {
      continue;
    }

    usedIngredientIds.add(ingredientId);
    sanitizedItems.push({ ingredient_id: ingredientId, qte_utilisee: 0 });
  }

  return {
    produit_id: productId,
    items: sanitizedItems,
  };
};

const sanitizeIngredientRecord = (ingredientId, rawIngredient) => {
  if (!rawIngredient || typeof rawIngredient !== 'object') {
    return null;
  }

  const nom = toTrimmedString(rawIngredient.nom);
  if (!nom) {
    return null;
  }

  const unite = toTrimmedString(rawIngredient.unite) || 'unidad';

  return {
    nom,
    unite,
  };
};

const buildPublicMenuPayload = async () => {
  const db = admin.database();
  const [productsSnap, categoriesSnap, recettesSnap, ingredientsSnap, siteConfigSnap] = await Promise.all([
    db.ref('products').once('value'),
    db.ref('categories').once('value'),
    db.ref('recettes').once('value'),
    db.ref('ingredients').once('value'),
    db.ref('site_configuration').once('value'),
  ]);

  const rawProducts = productsSnap.val() || {};
  const rawCategories = categoriesSnap.val() || {};
  const rawRecettes = recettesSnap.val() || {};
  const rawIngredients = ingredientsSnap.val() || {};
  const siteAssets = siteConfigSnap.val() || {};

  const sanitizedProducts = {};
  const usedCategoryIds = new Set();

  for (const [productId, productValue] of Object.entries(rawProducts)) {
    const sanitizedProduct = sanitizeProductRecord(productId, productValue);
    if (!sanitizedProduct) {
      continue;
    }

    sanitizedProducts[productId] = sanitizedProduct;
    if (sanitizedProduct.categoria_id) {
      usedCategoryIds.add(sanitizedProduct.categoria_id);
    }
  }

  const sanitizedCategories = {};
  for (const [categoryId, categoryValue] of Object.entries(rawCategories)) {
    if (usedCategoryIds.size > 0 && !usedCategoryIds.has(categoryId)) {
      continue;
    }
    const sanitizedCategory = sanitizeCategoryRecord(categoryId, categoryValue);
    if (!sanitizedCategory) {
      continue;
    }
    sanitizedCategories[categoryId] = sanitizedCategory;
  }

  const usedIngredientIds = new Set();
  const sanitizedRecettes = {};
  for (const [recetteKey, recetteValue] of Object.entries(rawRecettes)) {
    if (!sanitizedProducts[recetteKey]) {
      continue;
    }
    const sanitizedRecette = sanitizeRecetteRecord(recetteKey, recetteValue, usedIngredientIds);
    sanitizedRecettes[recetteKey] = sanitizedRecette;
  }

  const sanitizedIngredients = {};
  for (const ingredientId of usedIngredientIds) {
    const rawIngredient = rawIngredients[ingredientId];
    const sanitizedIngredient = sanitizeIngredientRecord(ingredientId, rawIngredient);
    if (!sanitizedIngredient) {
      continue;
    }
    sanitizedIngredients[ingredientId] = sanitizedIngredient;
  }

  return {
    updatedAt: admin.database.ServerValue.TIMESTAMP,
    categories: sanitizedCategories,
    products: sanitizedProducts,
    recettes: sanitizedRecettes,
    ingredients: sanitizedIngredients,
    site_assets: siteAssets,
  };
};

const syncPublicMenuData = async () => {
  const payload = await buildPublicMenuPayload();
  await admin.database().ref(PUBLIC_MENU_PATH).set(payload);
};

const buildPublicMenuTrigger = (path) =>
  functions
    .region('us-central1')
    .database.ref(path)
    .onWrite(async () => {
      try {
        await syncPublicMenuData();
      } catch (error) {
        console.error(`public_menu sync failed after change in ${path}`, error);
        throw error;
      }
    });

const PUBLIC_MENU_TRIGGER_PATHS = [
  { exportName: 'publicMenuOnProductsWrite', path: '/products/{productId}' },
  { exportName: 'publicMenuOnCategoriesWrite', path: '/categories/{categoryId}' },
  { exportName: 'publicMenuOnRecettesWrite', path: '/recettes/{recetteId}' },
  { exportName: 'publicMenuOnIngredientsWrite', path: '/ingredients/{ingredientId}' },
  { exportName: 'publicMenuOnSiteConfigWrite', path: '/site_configuration/{configKey}' },
];

for (const { exportName, path } of PUBLIC_MENU_TRIGGER_PATHS) {
  exports[exportName] = buildPublicMenuTrigger(path);
}

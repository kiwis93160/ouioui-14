
import { auth, database, storage, ensureFirebaseUser } from './firebaseConfig';
import { ref, get, set, update, remove, push } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type {
    Ingredient, Produit, Recette, Vente, Achat, RecetteItem,
    IngredientPayload, ProduitPayload, Table, Commande, CommandeItem,
    Categoria, Role, TablePayload, TimeEntry, EntityId
} from '../types';

// --- Helper Functions for Firebase Database ---

// Helper to transform snapshot data into an array, adding the key as an ID.
const snapshotToArray = (snapshot: any) => {
    const data: any[] = [];
    if (snapshot.exists()) {
        snapshot.forEach((childSnapshot: any) => {
            data.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });
    }
    return data;
};

const snapshotToObject = (snapshot: any) => {
    if (snapshot.exists()) {
        return { id: snapshot.key, ...snapshot.val() };
    }
    return null;
};

const TAKEAWAY_TABLE_ID: EntityId = '99';

type DatabaseAuthOptions = {
    requireRole?: boolean;
    ensureAuth?: boolean;
};

class AccessDeniedError extends Error {
    constructor(message: string = 'access-denied') {
        super(message);
        this.name = 'AccessDeniedError';
    }
}

const ACCESS_DENIED_MESSAGE = 'Accès refusé. Veuillez vous reconnecter pour continuer.';
let accessDeniedAlertShown = false;

const getStoredRoleId = (): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const roleId = window.sessionStorage.getItem('userRoleId');
        if (roleId && roleId.trim() !== '') {
            accessDeniedAlertShown = false;
            return roleId;
        }
    } catch (error) {
        console.error('Impossible de lire userRoleId depuis la session', error);
    }

    return null;
};

const notifyAccessDenied = (): void => {
    if (typeof window === 'undefined') {
        return;
    }

    if (!accessDeniedAlertShown) {
        accessDeniedAlertShown = true;
        window.alert(ACCESS_DENIED_MESSAGE);
    }

    try {
        window.sessionStorage.removeItem('userRoleId');
    } catch (error) {
        console.error('Impossible de supprimer userRoleId de la session', error);
    }

    if (window.location.hash !== '#/login') {
        window.location.hash = '#/login';
    }
};

const isPermissionDeniedError = (error: unknown): boolean => {
    if (!error) {
        return false;
    }

    const codeCandidate = (error as { code?: unknown }).code;
    if (typeof codeCandidate === 'string') {
        const normalizedCode = codeCandidate.toLowerCase();
        if (normalizedCode.includes('permission_denied') || normalizedCode.includes('permission-denied')) {
            return true;
        }
    }

    const messageCandidate = (error as { message?: unknown }).message;
    if (typeof messageCandidate === 'string') {
        const normalizedMessage = messageCandidate.toLowerCase();
        if (normalizedMessage.includes('permission denied') || normalizedMessage.includes('permission_denied')) {
            return true;
        }
    }

    return false;
};

const withDatabaseAuth = async <T>(
    operation: () => Promise<T>,
    options: DatabaseAuthOptions = {},
): Promise<T> => {
    const { requireRole = true, ensureAuth = requireRole } = options;

    if (requireRole) {
        const storedRoleId = getStoredRoleId();
        if (!storedRoleId) {
            notifyAccessDenied();
            throw new AccessDeniedError('missing-role');
        }

        if (ensureAuth) {
            await ensureFirebaseUser();
        }

        const currentUser = auth.currentUser;
        if (!currentUser || currentUser.isAnonymous) {
            notifyAccessDenied();
            throw new AccessDeniedError('missing-firebase-user');
        }
    } else if (ensureAuth) {
        await ensureFirebaseUser();
    }

    try {
        return await operation();
    } catch (error) {
        if (requireRole && isPermissionDeniedError(error)) {
            notifyAccessDenied();
            throw new AccessDeniedError((error as Error).message);
        }
        throw error;
    }
};

const parseNumericValue = (value: unknown): number => {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return Number.NaN;
};

const normalizeEntityId = (value: unknown): EntityId | null => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed !== '' ? trimmed : null;
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
        return String(value);
    }
    return null;
};

const normalizeEntityIdArray = (value: unknown): EntityId[] => {
    if (Array.isArray(value)) {
        return value
            .map(normalizeEntityId)
            .filter((id): id is EntityId => id !== null);
    }
    if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>)
            .map(normalizeEntityId)
            .filter((id): id is EntityId => id !== null);
    }
    return [];
};

const normalizeRecetteItems = (rawItems: unknown): RecetteItem[] => {
    const itemsArray = Array.isArray(rawItems)
        ? rawItems
        : rawItems && typeof rawItems === 'object'
            ? Object.values(rawItems as Record<string, unknown>)
            : [];

    return itemsArray
        .map(item => {
            if (!item || typeof item !== 'object') return null;
            const ingredientId = normalizeEntityId((item as { ingredient_id?: unknown }).ingredient_id);
            const quantity = parseNumericValue((item as { qte_utilisee?: unknown }).qte_utilisee);

            if (!ingredientId) {
                return null;
            }

            return {
                ingredient_id: ingredientId,
                qte_utilisee: Number.isNaN(quantity) ? 0 : quantity,
            };
        })
        .filter((item): item is RecetteItem => item !== null);
};

const resolveRecetteProduitId = (nodeKey: string, rawRecette: unknown): EntityId => {
    if (rawRecette && typeof rawRecette === 'object' && 'produit_id' in (rawRecette as Record<string, unknown>)) {
        const produitIdValue = (rawRecette as { produit_id?: unknown }).produit_id;
        const normalized = normalizeEntityId(produitIdValue);
        if (normalized) {
            return normalized;
        }
    }

    return normalizeEntityId(nodeKey) ?? nodeKey;
};

const normalizeCommandeRecord = (commandeData: any | null): Commande | null => {
    if (!commandeData) return null;

    const rawItems = Array.isArray(commandeData.items)
        ? commandeData.items
        : commandeData.items
            ? Object.values(commandeData.items)
            : [];

    const normalizedItems = (rawItems.filter(Boolean) as CommandeItem[]).map(item => {
        const produitId = item?.produit ? normalizeEntityId((item.produit as { id?: unknown }).id) : null;
        const quantiteValue = parseNumericValue((item as { quantite?: unknown }).quantite);
        const excluded = normalizeEntityIdArray((item as { excluded_ingredients?: unknown }).excluded_ingredients);

        const normalizedItem: CommandeItem = {
            ...item,
            quantite: Number.isNaN(quantiteValue) ? 0 : quantiteValue,
            excluded_ingredients: excluded.length > 0 ? excluded : [],
        };

        if (produitId && item?.produit) {
            normalizedItem.produit = { ...item.produit, id: produitId };
        }

        return normalizedItem;
    });

    const tableId = normalizeEntityId(commandeData.table_id);
    const couvertsCandidate = parseNumericValue(commandeData.couverts);

    const normalizedCommande: Commande = {
        ...commandeData,
        table_id: tableId ?? '',
        couverts: Number.isNaN(couvertsCandidate)
            ? normalizedItems.reduce((sum, item) => sum + (item.quantite || 0), 0)
            : couvertsCandidate,
        items: normalizedItems,
    };

    return normalizedCommande;
};

const normalizeCommandesArray = (commandesData: any[]): Commande[] =>
    commandesData
        .map(normalizeCommandeRecord)
        .filter((commande): commande is Commande => commande !== null);

const fetchAllCommandes = async (): Promise<Commande[]> => withDatabaseAuth(async () => {
    const snapshot = await get(ref(database, 'commands'));
    const rawCommandes = snapshotToArray(snapshot);
    return normalizeCommandesArray(rawCommandes);
});

const uploadFileAndGetURL = async (path: string, file: File): Promise<string> => withDatabaseAuth(async () => {
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file);
    return getDownloadURL(fileRef);
});

const safeDeleteStorageObject = async (path: string): Promise<void> => withDatabaseAuth(async () => {
    try {
        await deleteObject(storageRef(storage, path));
    } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'storage/object-not-found') {
            throw error;
        }
    }
});

export const api = {
    // --- Core Data Getters ---
    getIngredients: async (): Promise<Ingredient[]> => withDatabaseAuth(async () =>
        snapshotToArray(await get(ref(database, 'ingredients')))
    ),
    getProduits: async (): Promise<Produit[]> => withDatabaseAuth(async () =>
        snapshotToArray(await get(ref(database, 'products')))
    ),
    getRecettes: async (): Promise<Recette[]> => withDatabaseAuth(async () => {
        const recettesRef = ref(database, 'recettes');
        const snapshot = await get(recettesRef);
        if (!snapshot.exists()) {
            return [];
        }

        const recettes: Recette[] = [];
        const updates: Record<string, unknown> = {};

        snapshot.forEach(childSnapshot => {
            const key = childSnapshot.key;
            if (!key) {
                return;
            }

            const rawRecette = childSnapshot.val();
            const produitId = resolveRecetteProduitId(key, rawRecette);
            const normalizedItems = normalizeRecetteItems(rawRecette?.items);

            recettes.push({ produit_id: produitId, items: normalizedItems });

            const baseRecette: Record<string, unknown> =
                rawRecette && typeof rawRecette === 'object'
                    ? rawRecette as Record<string, unknown>
                    : {};

            const currentProduitId = (baseRecette as { produit_id?: unknown }).produit_id;
            const hasProduitId = currentProduitId !== undefined && currentProduitId !== null;
            const shouldBackfill = !hasProduitId || currentProduitId !== produitId;

            if (shouldBackfill) {
                const { items: existingItems, ...rest } = baseRecette as { items?: unknown } & Record<string, unknown>;
                updates[key] = {
                    ...rest,
                    produit_id: produitId,
                    items: existingItems !== undefined ? existingItems : normalizedItems,
                };
            }
        });

        if (Object.keys(updates).length > 0) {
            await update(recettesRef, updates);
        }

        return recettes;
    }),
    getVentes: async (): Promise<Vente[]> => withDatabaseAuth(async () =>
        snapshotToArray(await get(ref(database, 'sales')))
    ),
    getAchats: async (): Promise<Achat[]> => withDatabaseAuth(async () =>
        snapshotToArray(await get(ref(database, 'purchases')))
    ),
    getCategories: async (): Promise<Categoria[]> => withDatabaseAuth(async () =>
        snapshotToArray(await get(ref(database, 'categories')))
    ),
    getTables: async (): Promise<Table[]> => withDatabaseAuth(async () =>
        snapshotToArray(await get(ref(database, 'tables')))
    ),
    getSiteAssets: async (): Promise<any> => withDatabaseAuth(
        async () => (await get(ref(database, 'site_configuration'))).val(),
        { requireRole: false, ensureAuth: false },
    ),
    getTimeEntries: async (): Promise<TimeEntry[]> => withDatabaseAuth(async () =>
        snapshotToArray(await get(ref(database, 'time_entries')))
    ),

    // --- Site Editor ---
    updateSiteAsset: async (assetKey: string, data: File | string): Promise<void> => withDatabaseAuth(async () => {
        if (typeof data === 'string') {
            await update(ref(database, 'site_configuration'), { [assetKey]: data });
        } else {
            const fileRef = storageRef(storage, `site_assets/${assetKey}`);
            await uploadBytes(fileRef, data);
            const url = await getDownloadURL(fileRef);
            await update(ref(database, 'site_configuration'), { [assetKey]: url });
        }
    }),

    // --- Auth & Roles ---
    getRoles: async (): Promise<Role[]> => withDatabaseAuth(async () => {
        try {
            return snapshotToArray(await get(ref(database, 'roles')));
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (code === 'PERMISSION_DENIED') {
                return [];
            }
            throw error;
        }
    }),
    saveRoles: (newRoles: Role[]): Promise<void> => withDatabaseAuth(async () =>
        set(ref(database, 'roles'), newRoles)
    ), // Assumes newRoles is the full list

    // --- POS - Commande ---
    getCommandeByTableId: async (tableId: EntityId): Promise<Commande | null> => withDatabaseAuth(async () => {
        const tablesSnapshot = await get(ref(database, `tables/${tableId}`));
        const table = tablesSnapshot.val();
        if (!table || !table.commandeId) return null;
        return api.getCommandeById(table.commandeId);
    }),
    getCommandeById: async (commandeId: string): Promise<Commande | null> => withDatabaseAuth(async () => {
        const snapshot = await get(ref(database, `commands/${commandeId}`));
        return normalizeCommandeRecord(snapshotToObject(snapshot));
    }),
    createCommande: async (tableId: EntityId, couverts: number): Promise<Commande> => withDatabaseAuth(async () => {
        const newCommandeRef = push(ref(database, 'commands'));
        const normalizedTableId = String(tableId);
        const newCommande: Commande = {
            id: newCommandeRef.key!,
            table_id: normalizedTableId,
            couverts,
            items: [],
            statut: 'en_cours',
            date_creation: new Date().toISOString(),
            payment_status: 'impaye',
            estado_cocina: null,
        };
        await set(newCommandeRef, newCommande);
        await update(ref(database, `tables/${normalizedTableId}`), { commandeId: newCommande.id, statut: 'occupee' });
        return newCommande;
    }),
    updateCommande: async (commandeId: string, updates: Partial<Commande>): Promise<Commande> => withDatabaseAuth(async () => {
        const commandeRef = ref(database, `commands/${commandeId}`);
        await update(commandeRef, updates);
        return snapshotToObject(await get(commandeRef));
    }),
    finaliserCommande: (commandeId: string): Promise<void> => withDatabaseAuth(async () =>
        update(ref(database, `commands/${commandeId}`), { statut: 'finalisee' })
    ),
    markCommandeAsPaid: (commandeId: string): Promise<void> => withDatabaseAuth(async () =>
        update(ref(database, `commands/${commandeId}`), { payment_status: 'paye' })
    ),
    cancelUnpaidCommande: async (commandeId: string): Promise<void> => withDatabaseAuth(async () => {
        const commande = await api.getCommandeById(commandeId);
        if (!commande) return;
        await update(ref(database, `tables/${commande.table_id}`), { statut: 'libre', commandeId: null });
        await remove(ref(database, `commands/${commandeId}`));
    }),
    cancelEmptyCommande: (commandeId: string): Promise<void> => api.cancelUnpaidCommande(commandeId), // Same logic for now

    // --- POS - Kitchen ---
    sendOrderToKitchen: async (commandeId: string): Promise<Commande> => withDatabaseAuth(async () => {
        const updates = {
            estado_cocina: 'recibido',
            date_envoi_cuisine: new Date().toISOString(),
        };
        await update(ref(database, `commands/${commandeId}`), updates);
        return api.getCommandeById(commandeId);
    }),
    getKitchenOrders: async (): Promise<Commande[]> => withDatabaseAuth(async () => {
        const allCommands = await fetchAllCommandes();
        return allCommands.filter(c => c.estado_cocina && c.estado_cocina !== 'servido');
    }),
    markOrderAsReady: (commandeId: string): Promise<void> => withDatabaseAuth(async () =>
        update(ref(database, `commands/${commandeId}`), { estado_cocina: 'listo', date_listo_cuisine: new Date().toISOString() })
    ),
    acknowledgeOrderReady: (commandeId: string): Promise<void> => withDatabaseAuth(async () =>
        update(ref(database, `commands/${commandeId}`), { estado_cocina: 'servido', date_servido: new Date().toISOString() })
    ),

    // --- POS - Takeaway ---
    getReadyTakeawayOrders: async (): Promise<Commande[]> => withDatabaseAuth(async () => {
        const commandes = await fetchAllCommandes();
        return commandes.filter(cmd =>
            cmd.table_id === TAKEAWAY_TABLE_ID &&
            cmd.statut === 'en_cours' &&
            cmd.estado_cocina === 'listo'
        );
    }),
    getPendingTakeawayOrders: async (): Promise<Commande[]> => withDatabaseAuth(async () => {
        const commandes = await fetchAllCommandes();
        return commandes.filter(cmd =>
            cmd.table_id === TAKEAWAY_TABLE_ID &&
            cmd.statut === 'pendiente_validacion'
        );
    }),
    getActiveCommandes: async (): Promise<Commande[]> => withDatabaseAuth(async () => {
        const commandes = await fetchAllCommandes();
        return commandes.filter(cmd => cmd.statut === 'en_cours' || cmd.statut === 'pendiente_validacion');
    }),
    submitTakeawayOrderForValidation: async (
        items: CommandeItem[],
        customerInfo: { fullName: string, address: string, paymentMethod: string, receipt: File }
    ): Promise<Commande> => withDatabaseAuth(async () => {
        const newCommandeRef = push(ref(database, 'commands'));
        const commandeId = newCommandeRef.key;
        if (!commandeId) {
            throw new Error('Impossible de créer la commande.');
        }

        let receiptUrl: string | undefined;
        if (customerInfo.receipt) {
            receiptUrl = await uploadFileAndGetURL(`takeaway_receipts/${commandeId}`, customerInfo.receipt);
        }

        const sanitizedItems = items.map(item => ({
            ...item,
            produit: { ...item.produit, id: String(item.produit.id) },
            excluded_ingredients: item.excluded_ingredients?.map(id => String(id)) ?? [],
        }));
        const itemsCount = sanitizedItems.reduce((sum, item) => sum + (item.quantite || 0), 0);
        const nowIso = new Date().toISOString();

        const newCommandeData: Commande = {
            id: commandeId,
            table_id: TAKEAWAY_TABLE_ID,
            items: sanitizedItems,
            statut: 'pendiente_validacion',
            date_creation: nowIso,
            couverts: itemsCount > 0 ? itemsCount : 1,
            estado_cocina: null,
            payment_status: 'impaye',
            customer_name: customerInfo.fullName,
            customer_address: customerInfo.address,
            payment_method: customerInfo.paymentMethod,
            ...(receiptUrl ? { receipt_image_base64: receiptUrl } : {}),
        };

        await set(newCommandeRef, newCommandeData);

        return normalizeCommandeRecord(newCommandeData)!;
    }),
    validateAndSendTakeawayOrder: async (commandeId: string): Promise<void> => withDatabaseAuth(async () => {
        const nowIso = new Date().toISOString();
        await update(ref(database, `commands/${commandeId}`), {
            statut: 'en_cours',
            estado_cocina: 'recibido',
            date_envoi_cuisine: nowIso,
            date_dernier_envoi_cuisine: nowIso,
        });
    }),

    // --- Management - Ingredients ---
    recordAchat: (ingredient_id: EntityId, quantite_achetee: number, prix_total: number): Promise<Achat> => withDatabaseAuth(async () => {
        const newAchatRef = push(ref(database, 'purchases'));
        const achatData = { ingredient_id, quantite_achetee, prix_total, date_achat: new Date().toISOString() };
        await set(newAchatRef, achatData);
        return { id: newAchatRef.key!, ...achatData };
    }),
    addIngredient: async (payload: IngredientPayload): Promise<Ingredient> => withDatabaseAuth(async () => {
        const newIngredientRef = push(ref(database, 'ingredients'));
        if (!newIngredientRef.key) {
            throw new Error('Impossible de créer l\'ingrédient.');
        }

        const {
            stock_actuel,
            prix_unitaire,
            lots,
            date_below_minimum,
            last_known_price,
            ...baseFields
        } = payload;

        const optionalMetadata: Partial<Pick<Ingredient, 'date_below_minimum' | 'last_known_price'>> = {};
        if (date_below_minimum !== undefined) {
            optionalMetadata.date_below_minimum = date_below_minimum;
        }
        if (last_known_price !== undefined) {
            optionalMetadata.last_known_price = last_known_price;
        }

        const ingredientRecord: Omit<Ingredient, 'id'> = {
            ...baseFields,
            stock_actuel: stock_actuel ?? 0,
            prix_unitaire: prix_unitaire ?? 0,
            lots: lots ? [...lots] : [],
            ...optionalMetadata,
        };

        await set(newIngredientRef, ingredientRecord);

        return { id: newIngredientRef.key!, ...ingredientRecord };
    }),
    updateIngredient: (id: EntityId, payload: IngredientPayload): Promise<Ingredient> => withDatabaseAuth(async () => {
        await update(ref(database, `ingredients/${id}`), payload);
        const ingredients = await api.getIngredients();
        return ingredients.find(i => i.id === id)!;
    }),
    deleteIngredient: (id: EntityId): Promise<void> => withDatabaseAuth(async () => {
        await remove(ref(database, `ingredients/${id}`));
    }),

    // --- Management - Products ---
    updateRecette: (produit_id: EntityId, newItems: RecetteItem[]): Promise<Recette> => withDatabaseAuth(async () => {
        const sanitizedItems = newItems.map(item => ({
            ingredient_id: String(item.ingredient_id),
            qte_utilisee: item.qte_utilisee,
        }));
        const recetteData: Recette = { produit_id, items: sanitizedItems };
        await set(ref(database, `recettes/${produit_id}`), recetteData);
        return recetteData;
    }),
    addProduct: async (payload: ProduitPayload, items: RecetteItem[], imageFile?: File): Promise<Produit> => withDatabaseAuth(async () => {
        const newProductRef = push(ref(database, 'products'));
        const productData = { ...payload, estado: 'disponible' };
        await set(newProductRef, productData);
        await api.updateRecette(newProductRef.key!, items);
        let imageUrl: string | undefined;
        if (imageFile) {
            imageUrl = await uploadFileAndGetURL(`product_images/${newProductRef.key}`, imageFile);
            await update(newProductRef, { image_base64: imageUrl });
        }
        return { id: newProductRef.key!, ...productData, ...(imageUrl ? { image_base64: imageUrl } : {}) };
    }),
    updateProduct: (id: EntityId, payload: ProduitPayload): Promise<Produit> => withDatabaseAuth(async () => {
        await update(ref(database, `products/${id}`), payload);
        const produits = await api.getProduits();
        return produits.find(p => p.id === id)!;
    }),
    updateProductImage: async (productId: EntityId, imageFile: File | null): Promise<void> => withDatabaseAuth(async () => {
        const productRef = ref(database, `products/${productId}`);
        if (imageFile) {
            const imageUrl = await uploadFileAndGetURL(`product_images/${productId}`, imageFile);
            await update(productRef, { image_base64: imageUrl });
        } else {
            await update(productRef, { image_base64: null });
            await safeDeleteStorageObject(`product_images/${productId}`);
        }
    }),
    updateProductStatus: (productId: EntityId, status: Produit['estado']): Promise<Produit> => withDatabaseAuth(async () => {
        await update(ref(database, `products/${productId}`), { estado: status });
        const produits = await api.getProduits();
        return produits.find(p => p.id === productId)!;
    }),
    deleteProduct: async (id: EntityId): Promise<void> => withDatabaseAuth(async () => {
        await remove(ref(database, `products/${id}`));
        await remove(ref(database, `recettes/${id}`));
    }),

    // --- Management - Categories ---
    addCategory: (nom: string): Promise<Categoria> => withDatabaseAuth(async () => {
        const newCatRef = push(ref(database, 'categories'));
        await set(newCatRef, { nom });
        return { id: newCatRef.key!, nom };
    }),
    deleteCategory: (id: EntityId): Promise<void> => withDatabaseAuth(async () => {
        await remove(ref(database, `categories/${id}`));
    }),

    // --- Management - Tables ---
    addTable: (data: TablePayload): Promise<void> => withDatabaseAuth(async () => {
        await set(ref(database, `tables/${data.id}`), data);
    }),
    updateTable: (id: EntityId, data: Omit<TablePayload, 'id'>): Promise<void> => withDatabaseAuth(async () => {
        await update(ref(database, `tables/${id}`), data);
    }),
    deleteTable: (id: EntityId): Promise<void> => withDatabaseAuth(async () => {
        await remove(ref(database, `tables/${id}`));
    }),
};


import { database, storage } from './firebaseConfig';
import { ref, get, set, update, remove, push } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type { 
    Ingredient, Produit, Recette, Vente, Achat, RecetteItem,
    IngredientPayload, ProduitPayload, Table, Commande, CommandeItem,
    Categoria, Role, TablePayload, TimeEntry
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
}

const TAKEAWAY_TABLE_ID = 99;

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

const normalizeRecetteItems = (rawItems: unknown): RecetteItem[] => {
    const itemsArray = Array.isArray(rawItems)
        ? rawItems
        : rawItems && typeof rawItems === 'object'
            ? Object.values(rawItems as Record<string, unknown>)
            : [];

    return itemsArray
        .map(item => {
            if (!item || typeof item !== 'object') return null;
            const ingredientId = parseNumericValue((item as { ingredient_id?: unknown }).ingredient_id);
            const quantity = parseNumericValue((item as { qte_utilisee?: unknown }).qte_utilisee);

            if (Number.isNaN(ingredientId)) {
                return null;
            }

            return {
                ingredient_id: ingredientId,
                qte_utilisee: Number.isNaN(quantity) ? 0 : quantity,
            };
        })
        .filter((item): item is RecetteItem => item !== null);
};

const resolveRecetteProduitId = (nodeKey: string, rawRecette: unknown): string | number => {
    if (rawRecette && typeof rawRecette === 'object' && 'produit_id' in (rawRecette as Record<string, unknown>)) {
        const produitIdValue = (rawRecette as { produit_id?: unknown }).produit_id;
        const parsed = parseNumericValue(produitIdValue);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
        if (typeof produitIdValue === 'string' && produitIdValue.trim() !== '') {
            return produitIdValue;
        }
    }

    const parsedKey = parseNumericValue(nodeKey);
    if (!Number.isNaN(parsedKey)) {
        return parsedKey;
    }

    return nodeKey;
};

const normalizeCommandeRecord = (commandeData: any | null): Commande | null => {
    if (!commandeData) return null;

    const rawItems = Array.isArray(commandeData.items)
        ? commandeData.items
        : commandeData.items
            ? Object.values(commandeData.items)
            : [];

    const normalizedItems = (rawItems.filter(Boolean) as CommandeItem[]).map(item => {
        if (item?.produit?.id !== undefined) {
            const parsedId = parseNumericValue(item.produit.id as unknown);
            if (!Number.isNaN(parsedId)) {
                return {
                    ...item,
                    produit: { ...item.produit, id: parsedId }
                };
            }
        }
        return item;
    });

    const tableId = parseNumericValue(commandeData.table_id);
    const couvertsCandidate = parseNumericValue(commandeData.couverts);

    const normalizedCommande: Commande = {
        ...commandeData,
        table_id: Number.isNaN(tableId) ? Number.NaN : tableId,
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

const fetchAllCommandes = async (): Promise<Commande[]> => {
    const snapshot = await get(ref(database, 'commands'));
    const rawCommandes = snapshotToArray(snapshot);
    return normalizeCommandesArray(rawCommandes);
};

const uploadFileAndGetURL = async (path: string, file: File): Promise<string> => {
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file);
    return getDownloadURL(fileRef);
};

const safeDeleteStorageObject = async (path: string): Promise<void> => {
    try {
        await deleteObject(storageRef(storage, path));
    } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'storage/object-not-found') {
            throw error;
        }
    }
};

export const api = {
    // --- Core Data Getters ---
    getIngredients: async (): Promise<Ingredient[]> => snapshotToArray(await get(ref(database, 'ingredients'))),
    getProduits: async (): Promise<Produit[]> => snapshotToArray(await get(ref(database, 'products'))),
    getRecettes: async (): Promise<Recette[]> => {
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
    },
    getVentes: async (): Promise<Vente[]> => snapshotToArray(await get(ref(database, 'sales'))),
    getAchats: async (): Promise<Achat[]> => snapshotToArray(await get(ref(database, 'purchases'))),
    getCategories: async (): Promise<Categoria[]> => snapshotToArray(await get(ref(database, 'categories'))),
    getTables: async (): Promise<Table[]> => snapshotToArray(await get(ref(database, 'tables'))),
    getSiteAssets: async (): Promise<any> => (await get(ref(database, 'site_configuration'))).val(),
    getTimeEntries: async (): Promise<TimeEntry[]> => snapshotToArray(await get(ref(database, 'time_entries'))),

    // --- Site Editor ---
    updateSiteAsset: async (assetKey: string, data: File | string): Promise<void> => {
        if (typeof data === 'string') {
            await update(ref(database, 'site_configuration'), { [assetKey]: data });
        } else {
            const fileRef = storageRef(storage, `site_assets/${assetKey}`);
            await uploadBytes(fileRef, data);
            const url = await getDownloadURL(fileRef);
            await update(ref(database, 'site_configuration'), { [assetKey]: url });
        }
    },

    // --- Auth & Roles ---
    getRoles: async (): Promise<Role[]> => snapshotToArray(await get(ref(database, 'roles'))),
    saveRoles: (newRoles: Role[]): Promise<void> => set(ref(database, 'roles'), newRoles), // Assumes newRoles is the full list
    loginWithPin: async (pin: string): Promise<Role | null> => {
        const rolesSnapshot = await get(ref(database, 'roles'));
        if (!rolesSnapshot.exists()) return null;
        const roles = rolesSnapshot.val();
        for (const roleId in roles) {
            if (roles[roleId].pin === pin) {
                return { id: roleId, ...roles[roleId] };
            }
        }
        return null;
    },

    // --- POS - Commande ---
    getCommandeByTableId: async (tableId: number): Promise<Commande | null> => {
        const tablesSnapshot = await get(ref(database, `tables/${tableId}`));
        const table = tablesSnapshot.val();
        if (!table || !table.commandeId) return null;
        return api.getCommandeById(table.commandeId);
    },
    getCommandeById: async (commandeId: string): Promise<Commande | null> => {
        const snapshot = await get(ref(database, `commands/${commandeId}`));
        return normalizeCommandeRecord(snapshotToObject(snapshot));
    },
    createCommande: async (tableId: number, couverts: number): Promise<Commande> => {
        const newCommandeRef = push(ref(database, 'commands'));
        const newCommande: Commande = {
            id: newCommandeRef.key!,
            table_id: tableId,
            couverts,
            items: [],
            statut: 'en_cours',
            date_creation: new Date().toISOString(),
            payment_status: 'impaye',
            estado_cocina: null,
        };
        await set(newCommandeRef, newCommande);
        await update(ref(database, `tables/${tableId}`), { commandeId: newCommande.id, statut: 'occupee' });
        return newCommande;
    },
    updateCommande: async (commandeId: string, updates: Partial<Commande>): Promise<Commande> => {
        const commandeRef = ref(database, `commands/${commandeId}`);
        await update(commandeRef, updates);
        return snapshotToObject(await get(commandeRef));
    },
    finaliserCommande: (commandeId: string): Promise<void> => update(ref(database, `commands/${commandeId}`), { statut: 'finalisee' }),
    markCommandeAsPaid: (commandeId: string): Promise<void> => update(ref(database, `commands/${commandeId}`), { payment_status: 'paye' }),
    cancelUnpaidCommande: async (commandeId: string): Promise<void> => {
        const commande = await api.getCommandeById(commandeId);
        if (!commande) return;
        await update(ref(database, `tables/${commande.table_id}`), { statut: 'libre', commandeId: null });
        await remove(ref(database, `commands/${commandeId}`));
    },
    cancelEmptyCommande: (commandeId: string): Promise<void> => api.cancelUnpaidCommande(commandeId), // Same logic for now

    // --- POS - Kitchen ---
    sendOrderToKitchen: async (commandeId: string): Promise<Commande> => {
        const updates = {
            estado_cocina: 'recibido',
            date_envoi_cuisine: new Date().toISOString(),
        };
        await update(ref(database, `commands/${commandeId}`), updates);
        return api.getCommandeById(commandeId);
    },
    getKitchenOrders: async (): Promise<Commande[]> => {
        const allCommands = await fetchAllCommandes();
        return allCommands.filter(c => c.estado_cocina && c.estado_cocina !== 'servido');
    },
    markOrderAsReady: (commandeId: string): Promise<void> => update(ref(database, `commands/${commandeId}`), { estado_cocina: 'listo', date_listo_cuisine: new Date().toISOString() }),
    acknowledgeOrderReady: (commandeId: string): Promise<void> => update(ref(database, `commands/${commandeId}`), { estado_cocina: 'servido', date_servido: new Date().toISOString() }),

    // --- POS - Takeaway ---
    getReadyTakeawayOrders: async (): Promise<Commande[]> => {
        const commandes = await fetchAllCommandes();
        return commandes.filter(cmd =>
            Number(cmd.table_id) === TAKEAWAY_TABLE_ID &&
            cmd.statut === 'en_cours' &&
            cmd.estado_cocina === 'listo'
        );
    },
    getPendingTakeawayOrders: async (): Promise<Commande[]> => {
        const commandes = await fetchAllCommandes();
        return commandes.filter(cmd =>
            Number(cmd.table_id) === TAKEAWAY_TABLE_ID &&
            cmd.statut === 'pendiente_validacion'
        );
    },
    getActiveCommandes: async (): Promise<Commande[]> => {
        const commandes = await fetchAllCommandes();
        return commandes.filter(cmd => cmd.statut === 'en_cours' || cmd.statut === 'pendiente_validacion');
    },
    submitTakeawayOrderForValidation: async (
        items: CommandeItem[],
        customerInfo: { fullName: string, address: string, paymentMethod: string, receipt: File }
    ): Promise<Commande> => {
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
            produit: { ...item.produit },
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
    },
    validateAndSendTakeawayOrder: async (commandeId: string): Promise<void> => {
        const nowIso = new Date().toISOString();
        await update(ref(database, `commands/${commandeId}`), {
            statut: 'en_cours',
            estado_cocina: 'recibido',
            date_envoi_cuisine: nowIso,
            date_dernier_envoi_cuisine: nowIso,
        });
    },

    // --- Management - Ingredients ---
    recordAchat: (ingredient_id: number, quantite_achetee: number, prix_total: number): Promise<Achat> => {
        const newAchatRef = push(ref(database, 'purchases'));
        const achatData = { ingredient_id, quantite_achetee, prix_total, date_achat: new Date().toISOString() };
        return set(newAchatRef, achatData).then(() => ({ id: newAchatRef.key!, ...achatData }));
    },
    addIngredient: (payload: IngredientPayload): Promise<Ingredient> => {
        const newIngredientRef = push(ref(database, 'ingredients'));
        return set(newIngredientRef, payload).then(() => ({ id: newIngredientRef.key!, ...payload, stock_actuel: 0, lots: [] }));
    },
    updateIngredient: (id: number, payload: IngredientPayload): Promise<Ingredient> => {
        return update(ref(database, `ingredients/${id}`), payload).then(() => api.getIngredients().then(ings => ings.find(i => i.id === id)!));
    },
    deleteIngredient: (id: number): Promise<void> => remove(ref(database, `ingredients/${id}`)),
    
    // --- Management - Products ---
    updateRecette: (produit_id: number | string, newItems: RecetteItem[]): Promise<Recette> => {
        const sanitizedItems = newItems.map(item => ({
            ingredient_id: item.ingredient_id,
            qte_utilisee: item.qte_utilisee,
        }));
        const recetteData: Recette = { produit_id, items: sanitizedItems };
        return set(ref(database, `recettes/${produit_id}`), recetteData).then(() => recetteData);
    },
    addProduct: async (payload: ProduitPayload, items: RecetteItem[], imageFile?: File): Promise<Produit> => {
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
    },
    updateProduct: (id: number, payload: ProduitPayload): Promise<Produit> => {
        return update(ref(database, `products/${id}`), payload).then(() => api.getProduits().then(prods => prods.find(p => p.id === id)!));
    },
    updateProductImage: async (productId: number, imageFile: File | null): Promise<void> => {
        const productRef = ref(database, `products/${productId}`);
        if (imageFile) {
            const imageUrl = await uploadFileAndGetURL(`product_images/${productId}`, imageFile);
            await update(productRef, { image_base64: imageUrl });
        } else {
            await update(productRef, { image_base64: null });
            await safeDeleteStorageObject(`product_images/${productId}`);
        }
    },
    updateProductStatus: (productId: number, status: Produit['estado']): Promise<Produit> => {
        return update(ref(database, `products/${productId}`), { estado: status }).then(() => api.getProduits().then(prods => prods.find(p => p.id === productId)!));
    },
    deleteProduct: async (id: number): Promise<void> => {
        await remove(ref(database, `products/${id}`));
        await remove(ref(database, `recettes/${id}`));
    },

    // --- Management - Categories ---
    addCategory: (nom: string): Promise<Categoria> => {
        const newCatRef = push(ref(database, 'categories'));
        return set(newCatRef, { nom }).then(() => ({ id: newCatRef.key!, nom }));
    },
    deleteCategory: (id: number): Promise<void> => remove(ref(database, `categories/${id}`)),

    // --- Management - Tables ---
    addTable: (data: TablePayload): Promise<void> => set(ref(database, `tables/${data.id}`), data),
    updateTable: (id: number, data: Omit<TablePayload, 'id'>): Promise<void> => update(ref(database, `tables/${id}`), data),
    deleteTable: (id: number): Promise<void> => remove(ref(database, `tables/${id}`)),
};

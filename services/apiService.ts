
import { database, storage } from './firebaseConfig';
import { ref, get, set, update, remove, push, child } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { 
    Ingredient, Produit, Recette, Vente, Achat, RecetteItem, 
    IngredientPayload, ProduitPayload, Table, Commande, CommandeItem, 
    Categoria, Role, TablePayload 
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

export const api = {
    // --- Core Data Getters ---
    getIngredients: async (): Promise<Ingredient[]> => snapshotToArray(await get(ref(database, 'ingredients'))),
    getProduits: async (): Promise<Produit[]> => snapshotToArray(await get(ref(database, 'products'))),
    getRecettes: async (): Promise<Recette[]> => snapshotToArray(await get(ref(database, 'recettes'))),
    getVentes: async (): Promise<Vente[]> => snapshotToArray(await get(ref(database, 'sales'))),
    getAchats: async (): Promise<Achat[]> => snapshotToArray(await get(ref(database, 'purchases'))),
    getCategories: async (): Promise<Categoria[]> => snapshotToArray(await get(ref(database, 'categories'))),
    getTables: async (): Promise<Table[]> => snapshotToArray(await get(ref(database, 'tables'))),
    getSiteAssets: async (): Promise<any> => (await get(ref(database, 'site_configuration'))).val(),

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
    getCommandeById: async (commandeId: string): Promise<Commande | null> => snapshotToObject(await get(ref(database, `commands/${commandeId}`))),
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
        const allCommands = snapshotToArray(await get(ref(database, 'commands')));
        return allCommands.filter(c => c.estado_cocina && c.estado_cocina !== 'servido');
    },
    markOrderAsReady: (commandeId: string): Promise<void> => update(ref(database, `commands/${commandeId}`), { estado_cocina: 'listo', date_listo_cuisine: new Date().toISOString() }),
    acknowledgeOrderReady: (commandeId: string): Promise<void> => update(ref(database, `commands/${commandeId}`), { estado_cocina: 'servido', date_servido: new Date().toISOString() }),

    // --- POS - Takeaway (Simplified for Firebase) ---
    // Assuming logic for takeaway is similar to table orders but without a table_id

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
    updateRecette: (produit_id: number, newItems: RecetteItem[]): Promise<Recette> => set(ref(database, `recettes/${produit_id}`), { items: newItems }).then(() => ({ produit_id, items: newItems })),
    addProduct: async (payload: ProduitPayload, items: RecetteItem[]): Promise<Produit> => {
        const newProductRef = push(ref(database, 'products'));
        const productData = { ...payload, estado: 'disponible' };
        await set(newProductRef, productData);
        await api.updateRecette(newProductRef.key as any, items);
        return { id: newProductRef.key!, ...productData };
    },
    updateProduct: (id: number, payload: ProduitPayload): Promise<Produit> => {
        return update(ref(database, `products/${id}`), payload).then(() => api.getProduits().then(prods => prods.find(p => p.id === id)!));
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
